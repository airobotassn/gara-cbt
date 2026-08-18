// ⚠️ **이 스위트는 옛 정의(매 요청 재계산)를 검증한다.** 2026-08-18 에 region_/country_/school_leaderboard
//    는 스냅샷 테이블(arena_bucket_scores)을 읽는 판으로 바뀌었다 — 지금 프로덕션에서 도는 정의의
//    검증은 `tests/db/t-arena-buckets.mjs` 다. 여기 남겨 두는 건 베이지안(K=25)·프라이버시 floor·
//    탈퇴/익명 제외 같은 **집계 의미론**이 그대로 유지되는지를 값으로 못박아 두기 때문이다.
//
// T7 집계 리더보드 RPC 검증 — pglite(WASM Postgres 18)에 Supabase 롤 모형을 세우고
// 실제 마이그레이션 DDL(supabase/migrations/20260714000200_leaderboard_rpcs.sql · 20260721060000_ranking_stage2_rpcs.sql)을 적용해
//   · STAGE2-B 베이지안 집계: score = (n*group_avg + K*global_avg)/(n+K), K=25 —
//     소수 그룹(n=6)은 global_avg 쪽으로 뚜렷이 shrink, 대형 그룹(n=30)은 K 영향이 미미(group_avg 에 근접)함을 실증.
//   · MIN_BUCKET_USERS=5 프라이버시 floor(n<5 버킷 미노출) — 베이지안 개정 후에도 유지.
//   · 탈퇴자(deactivated_at) + is_anonymous(게스트) 카운트/평균/global_top 모두에서 제외.
//   · daily vs season score 규칙(참여율 곱셈 여부)은 베이지안 보정평균 위에서도 동일하게 유지.
//   · global_top: season_total 내림차순(동점=updated_at 오름차순) 정렬 + ranking_tier() 5티어 밴드.
//   · 개인 식별 필드(user_id/name) 무노출 — 집계 키만.
//   · revoke execute → authenticated 실행 차단(permission denied).
// 을 검증한다. (이 마이그레이션들은 pg_trgm/pgcrypto 미사용 → 스트립 불필요. gen_random_uuid 는 pglite 내장.)
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const db = await PGlite.create();
const raw = (sql) => db.exec(sql);
const q = (sql, params) => db.query(sql, params);

const results = [];
const rec = (name, got, want, pass) =>
  results.push({ name, got: JSON.stringify(got), want: JSON.stringify(want), pass });
const eq = (name, got, want) => rec(name, got, want, JSON.stringify(got) === JSON.stringify(want));
const ok = (name, cond, got) => rec(name, got, true, !!cond);
const close = (name, got, want, eps = 1e-6) => rec(name, got, want, Math.abs(Number(got) - Number(want)) < eps);

// ---- Supabase 모형: 롤 (service_role = 엣지fn 호출자) ----
raw(`create role anon; create role authenticated; create role service_role;`);

// ---- 최소 스키마: profiles / user_progress / regions / schools / daily_activity ----
//      (실 스키마: user_progress.season_total 는 skill_score+activity_score 의 generated 컬럼이지만,
//       이 스위트는 STAGE2 RPC 만 검증하므로 season_total 을 직접 입력 가능한 plain 컬럼으로 단순화한다.)
raw(`
  create table regions ( code text primary key );
  create table schools ( id text primary key, name text not null );
  create table profiles (
    id uuid primary key,
    display_name   text,
    avatar_url     text,
    country_code   text,
    region_code    text,
    school_id      text,
    is_anonymous   boolean not null default false,
    deactivated_at timestamptz
  );
  create table user_progress (
    user_id      uuid primary key,
    rank         int not null default 1,
    season_total numeric not null default 0,
    updated_at   timestamptz default now()
  );
  create table daily_activity (
    user_id uuid,
    day     date,
    primary key (user_id, day)
  );
`);
raw(`insert into regions (code) values ('KR-11'),('KR-26'),('KR-27');`);
raw(`insert into schools (id, name) values ('snu','서울대학교');`);

// ---- ranking_tier() 선행 생성 — global_top/my_rank_context 가 참조(원 정의: 20260721050000_reset_season_fn.sql). ----
raw(`
  create or replace function public.ranking_tier(p_pct numeric) returns text
    language sql immutable as $$
    select case
      when p_pct <= 0.05 then 'diamond'
      when p_pct <= 0.20 then 'platinum'
      when p_pct <= 0.45 then 'gold'
      when p_pct <= 0.75 then 'silver'
      else 'bronze'
    end
  $$;
`);

// ---- 마이그레이션 DDL 적용(집계 리더보드 3종 + global_top·my_rank_context + revoke/grant) ----
const ddlBuckets = readFileSync('supabase/migrations/20260714000200_leaderboard_rpcs.sql', 'utf8');
await raw(ddlBuckets);
const ddlStage2 = readFileSync('supabase/migrations/20260721060000_ranking_stage2_rpcs.sql', 'utf8');
await raw(ddlStage2);

// ============================================================
// 시나리오 시딩 — 베이지안 shrink 실증용 3개 지역 + 탈퇴자 + is_anonymous 게스트.
//   KR-11: 활성 6명 season_total=[300,300,400,400,500,500] → group_avg=400 (n=6, floor 통과, 소수 그룹)
//   KR-26: 활성 3명 season_total=[500,500,500] → n<5 floor 미달(버킷 미노출이나 global_avg 모수에는 포함)
//   KR-27: 활성 30명 season_total=1000 (균질) → group_avg=1000 (n=30, K=25 대비 대형 그룹)
//   KR-11 탈퇴자 1명(season_total=700) + is_anonymous 게스트 1명(season_total=999999, KR-11) → 두 경우 모두
//     버킷 카운트/평균과 global_avg 모수에서 완전히 제외되어야 함(포함되면 평균이 크게 왜곡됨).
//   6명(KR-11 활성) 모두 school_id='snu' (school_leaderboard 라벨/베이지안 검증용).
// ============================================================
const KR11 = Array.from({ length: 6 }, (_, i) => `11111111-1111-1111-1111-11111111110${i + 1}`);
const KR11_TOTALS = [300, 300, 400, 400, 500, 500]; // sum 2400 / 6 = 400
const KR11_DEACT = '11111111-1111-1111-1111-1111111111d0'; // 탈퇴자(제외), season_total 700
const KR11_ANON = '11111111-1111-1111-1111-1111111111a0'; // is_anonymous 게스트(제외), season_total 999999(왜곡 유도)
const KR26 = Array.from({ length: 3 }, (_, i) => `26262626-2626-2626-2626-26262626260${i + 1}`);
const KR26_TOTAL = 500;
const KR27 = Array.from({ length: 30 }, (_, i) => `27272727-2727-2727-2727-${String(2727270000 + i + 1).padStart(12, '0')}`);
const KR27_TOTAL = 1000;
const K = 25; // migrations/20260714000200_leaderboard_rpcs.sql 의 scored CTE 리터럴과 동일해야 한다.

for (let i = 0; i < KR11.length; i++) {
  await q(`insert into profiles (id, display_name, country_code, region_code, school_id) values ($1,$2,'KR','KR-11','snu')`, [KR11[i], `kr11_${i}`]);
  await q(`insert into user_progress (user_id, rank, season_total) values ($1,1,$2)`, [KR11[i], KR11_TOTALS[i]]);
}
await q(`insert into profiles (id, display_name, country_code, region_code, school_id, deactivated_at) values ($1,'gone','KR','KR-11','snu', now())`, [KR11_DEACT]);
await q(`insert into user_progress (user_id, rank, season_total) values ($1, 7, 700)`, [KR11_DEACT]);
await q(`insert into profiles (id, display_name, country_code, region_code, school_id, is_anonymous) values ($1,'guest','KR','KR-11','snu', true)`, [KR11_ANON]);
await q(`insert into user_progress (user_id, rank, season_total) values ($1, 1, 999999)`, [KR11_ANON]);
for (let i = 0; i < KR26.length; i++) {
  await q(`insert into profiles (id, display_name, country_code, region_code) values ($1,$2,'KR','KR-26')`, [KR26[i], `kr26_${i}`]);
  await q(`insert into user_progress (user_id, rank, season_total) values ($1, 1, $2)`, [KR26[i], KR26_TOTAL]);
}
for (let i = 0; i < KR27.length; i++) {
  await q(`insert into profiles (id, display_name, country_code, region_code) values ($1,$2,'KR','KR-27')`, [KR27[i], `kr27_${i}`]);
  await q(`insert into user_progress (user_id, rank, season_total) values ($1, 1, $2)`, [KR27[i], KR27_TOTAL]);
}
// 오늘(KST) 참여: KR-11 6명 중 3명만 daily_activity 기록 → active_today=3
for (const u of [KR11[0], KR11[1], KR11[2]]) {
  await q(`insert into daily_activity (user_id, day) values ($1, (now() at time zone 'Asia/Seoul')::date)`, [u]);
}
// 방해자극: 어제 참여 1건(오늘 아님) — active 로 세면 안 됨
await q(`insert into daily_activity (user_id, day) values ($1, (now() at time zone 'Asia/Seoul')::date - 1)`, [KR11[3]]);
// 방해자극: 탈퇴자/게스트도 오늘 참여했지만 profiles 조인에서 제외 → 카운트 무영향
await q(`insert into daily_activity (user_id, day) values ($1, (now() at time zone 'Asia/Seoul')::date)`, [KR11_DEACT]);
await q(`insert into daily_activity (user_id, day) values ($1, (now() at time zone 'Asia/Seoul')::date)`, [KR11_ANON]);

// ---- helper: RPC → 파싱된 결과 ----
async function callArr(sql, params) {
  const v = (await q(sql, params)).rows[0].j;
  return typeof v === 'string' ? JSON.parse(v) : v;
}
async function callObj(sql, params) {
  return callArr(sql, params);
}
const ALLOWED_KEYS = new Set(['code', 'label', 'member_count', 'avg_level', 'active_today', 'participation', 'score']);

// global_avg(scope) 계산 헬퍼 — RPC 의 prior CTE 와 동일 술어(해당 스코프, group by 없음).
const globalAvgRegion = (KR11_TOTALS.reduce((a, b) => a + b, 0) + KR26_TOTAL * KR26.length + KR27_TOTAL * KR27.length) / (KR11.length + KR26.length + KR27.length);
const bayes = (n, groupAvg, globalAvg) => (n * groupAvg + K * globalAvg) / (n + K);
const round4 = (x) => Math.round(x * 10000) / 10000;

// ============================================================
// (A) region_leaderboard daily/season — 베이지안 보정평균 + is_anonymous/탈퇴자 제외 + floor 유지
// ============================================================
const rDaily = await callArr(`select region_leaderboard('KR','daily') as j`);
const kr11 = rDaily.find((b) => b.code === 'KR-11');
const kr26 = rDaily.find((b) => b.code === 'KR-26');
const kr27 = rDaily.find((b) => b.code === 'KR-27');

ok('region(daily): KR-11 버킷 존재', !!kr11, kr11);
ok('region(daily): KR-26 버킷 미노출 (n=3 < floor 5)', !kr26, kr26 ?? null);
ok('region(daily): KR-27 버킷 존재 (n=30 >= floor)', !!kr27, kr27);
eq('region(daily): KR-11 member_count = 6 (탈퇴자·게스트 제외)', Number(kr11?.member_count), 6);
eq('region(daily): KR-11 avg_level(group_avg) = 400 (탈퇴자 700·게스트 999999 제외)', Number(kr11?.avg_level), 400);
eq('region(daily): KR-11 active_today = 3 (오늘 KST 응시자만, 탈퇴자/게스트 응시 무영향)', Number(kr11?.active_today), 3);
eq('region(daily): KR-11 participation = 3/6 = 0.5', Number(kr11?.participation), 0.5);

const bayesKr11 = bayes(6, 400, globalAvgRegion);
const bayesKr27 = bayes(30, 1000, globalAvgRegion);
close('region(daily): KR-11 daily score = round(bayes*participation,4) (베이지안 공식 일치)', Number(kr11?.score), round4(bayesKr11 * 0.5), 5e-4);

const rSeason = await callArr(`select region_leaderboard('KR','season') as j`);
const kr11s = rSeason.find((b) => b.code === 'KR-11');
const kr27s = rSeason.find((b) => b.code === 'KR-27');
close('region(season): KR-11 score = 베이지안 보정평균(round4) 정확히 일치', Number(kr11s?.score), round4(bayesKr11), 5e-4);
close('region(season): KR-27 score = 베이지안 보정평균(round4) 정확히 일치', Number(kr27s?.score), round4(bayesKr27), 5e-4);

// 소수 그룹(n=6) shrink vs 대형 그룹(n=30) K영향 미미 — |score-group_avg| 비교로 실증.
const shrinkKr11 = Math.abs(bayesKr11 - 400);
const shrinkKr27 = Math.abs(bayesKr27 - 1000);
ok('베이지안: 소수 그룹(n=6)의 group_avg 이탈폭이 대형 그룹(n=30)보다 크다 (shrink 효과)', shrinkKr11 > shrinkKr27, { shrinkKr11, shrinkKr27 });
ok('베이지안: 대형 그룹(n=30)은 K=25 영향이 미미해 group_avg 근접(오차<10%, 소형 그룹 대비 훨씬 작음)', shrinkKr27 / 1000 < 0.1, { shrinkKr27, ratio: shrinkKr27 / 1000 });

// 개인 식별 필드 무노출 — 집계 키만.
const keys = Object.keys(kr11 ?? {});
ok('region: 버킷 키가 허용 집계키뿐 (user_id/name 무노출)', keys.every((k) => ALLOWED_KEYS.has(k)), keys);
ok('region: user_id/name/display 문자열 미포함', !JSON.stringify(rDaily).match(/user_id|display_name|"name"|"id"/), JSON.stringify(rDaily));

// ============================================================
// (B) school_leaderboard — label 조인 + 베이지안 + is_anonymous 게스트(school_id='snu') 제외
// ============================================================
const sDaily = await callArr(`select school_leaderboard('KR','daily') as j`);
const snu = sDaily.find((b) => b.code === 'snu');
ok('school(daily): snu 버킷 존재 (6 >= floor)', !!snu, snu);
eq('school(daily): snu label = 서울대학교 (schools 조인)', snu?.label, '서울대학교');
eq('school(daily): snu member_count = 6 (탈퇴자·게스트 제외)', Number(snu?.member_count), 6);
eq('school(daily): snu avg_level(group_avg) = 400', Number(snu?.avg_level), 400);

// ============================================================
// (C) country_leaderboard — 국가 버킷(전 지역 합산) + 베이지안 + is_anonymous/탈퇴자 제외
// ============================================================
const cDaily = await callArr(`select country_leaderboard('daily') as j`);
const kr = cDaily.find((b) => b.code === 'KR');
// 전 KR 활성 = KR-11 6 + KR-26 3 + KR-27 30 = 39 (탈퇴자·게스트 제외)
eq('country(daily): KR member_count = 39 (KR-11 6 + KR-26 3 + KR-27 30, 탈퇴자·게스트 제외)', Number(kr?.member_count), 39);
eq('country(daily): KR active_today = 3', Number(kr?.active_today), 3);
ok('country: user_id/name 무노출', !JSON.stringify(cDaily).match(/user_id|display_name|"name"|"id"/), JSON.stringify(cDaily));

// ============================================================
// (D) global_top — season_total 정렬 + ranking_tier 5티어 밴드 + 탈퇴자/is_anonymous 제외
//     20 활성 유저(u1..u20, season_total 내림차순)로 5개 밴드 전부 실증(t-season-reset.mjs 와 동일 컨벤션).
// ============================================================
// global_top 은 region/school/country 버킷과 무관하게 user_progress 전체를 스캔하므로,
// 위 버킷 시나리오의 시드 데이터를 비우고 이 섹션 전용 20명으로 다시 시작한다.
await raw(`truncate table user_progress, profiles cascade;`);
const uid = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const N = 20;
const gUsers = Array.from({ length: N }, (_, i) => ({ id: uid(i + 1), k: i + 1, total: (N + 1 - (i + 1)) * 100 })); // u1=2000 .. u20=100
const gGone = '00000000-0000-0000-0000-0000000000d0';
const gAnon = '00000000-0000-0000-0000-0000000000a0';
for (const u of gUsers) {
  await q(`insert into profiles (id, display_name, country_code) values ($1,$2,'KR')`, [u.id, `g_${u.k}`]);
  await q(`insert into user_progress (user_id, rank, season_total, updated_at) values ($1,1,$2, now())`, [u.id, u.total]);
}
await q(`insert into profiles (id, display_name, deactivated_at) values ($1,'gone', now())`, [gGone]);
await q(`insert into user_progress (user_id, rank, season_total) values ($1,1,999999)`, [gGone]);
await q(`insert into profiles (id, display_name, is_anonymous) values ($1,'guest', true)`, [gAnon]);
await q(`insert into user_progress (user_id, rank, season_total) values ($1,1,888888)`, [gAnon]);

const u1 = gUsers[0].id;   // top(2000) → cume_dist 1/20=0.05 → diamond
const u4 = gUsers[3].id;   // 4/20=0.20 → platinum
const u9 = gUsers[8].id;   // 9/20=0.45 → gold
const u15 = gUsers[14].id; // 15/20=0.75 → silver
const u20 = gUsers[19].id; // 20/20=1.00 → bronze

const top = await callObj(`select global_top($1, 20) as j`, [u1]);
eq('global_top: total = 20 (탈퇴자·게스트 제외)', Number(top.total), 20);
eq('global_top: top[0].rank = 1, rating = season_total(2000)', [top.top[0].rank, Number(top.top[0].rating)], [1, 2000]);
ok('global_top: season_total 내림차순 정렬 (연속 항목 rating 비증가)', top.top.every((r, i) => i === 0 || Number(top.top[i - 1].rating) >= Number(r.rating)), top.top.map((r) => r.rating));
ok('global_top: 999999/888888(탈퇴자·게스트) 미노출', !top.top.some((r) => Number(r.rating) === 999999 || Number(r.rating) === 888888), top.top.map((r) => r.rating));

const tierByUid = {};
for (const r of top.top) tierByUid[r.rank] = r.tier;
eq('global_top: rank1(u1) tier = diamond (pct<=0.05)', tierByUid[1], 'diamond');
eq('global_top: rank4(u4) tier = platinum (pct<=0.20)', tierByUid[4], 'platinum');
eq('global_top: rank9(u9) tier = gold (pct<=0.45)', tierByUid[9], 'gold');
eq('global_top: rank15(u15) tier = silver (pct<=0.75)', tierByUid[15], 'silver');
eq('global_top: rank20(u20) tier = bronze (pct<=1.00)', tierByUid[20], 'bronze');
eq('global_top: rank1(u1) percentile = round(cume_dist,4) = 0.05 (0~1 스케일, ×100 아님)', Number(top.top[0].percentile), 0.05);
eq('global_top: rank20(u20) percentile = 1 (최하위 cume_dist=1)', Number(top.top[19].percentile), 1);
ok('global_top: 모든 percentile 이 0~1 범위(옛 버그: ×100 스케일이면 최대 100까지 나감)', top.top.every((r) => Number(r.percentile) >= 0 && Number(r.percentile) <= 1), top.top.map((r) => r.percentile));
ok('global_top: 상위권(rank1) percentile 이 하위권(rank20)보다 작다', Number(top.top[0].percentile) < Number(top.top[19].percentile), [top.top[0].percentile, top.top[19].percentile]);

const meU9 = await callObj(`select global_top($1, 20) as j`, [u9]);
eq('global_top: me(u9).rank = 9, tier = gold', [meU9.me.rank, meU9.me.tier], [9, 'gold']);
eq('global_top: me(u9).percentile = 0.45', Number(meU9.me.percentile), 0.45);

// ============================================================
// (E) my_rank_context — 내 순위/티어/백분위 + 바로 윗사람과의 points_to_pass(1위면 null)
// ============================================================
const ctxU9 = await callObj(`select my_rank_context($1) as j`, [u9]);
eq('my_rank_context: u9 rank = 9', Number(ctxU9.rank), 9);
eq('my_rank_context: u9 season_total = 1200', Number(ctxU9.season_total), 1200);
eq('my_rank_context: u9 tier = gold', ctxU9.tier, 'gold');
eq('my_rank_context: u9 points_to_pass = 바로 윗사람(u8=1300) - 1200 = 100', Number(ctxU9.points_to_pass), 100);
eq('my_rank_context: u9 percentile = 0.45 (0~1 스케일, global_top 과 일치)', Number(ctxU9.percentile), 0.45);

const ctxU1 = await callObj(`select my_rank_context($1) as j`, [u1]);
eq('my_rank_context: 1위(u1)는 points_to_pass = null', ctxU1.points_to_pass, null);
eq('my_rank_context: 1위(u1) tier = diamond', ctxU1.tier, 'diamond');
eq('my_rank_context: 1위(u1) percentile = 0.05', Number(ctxU1.percentile), 0.05);

// ============================================================
// (F) revoke execute — authenticated 롤은 실행 불가 (permission denied) — 버킷 3종만 SECURITY DEFINER 대상.
//     ⚠️ PUBLIC 기본 EXECUTE 를 revoke 했기에 실제로 차단되어야 함.
// ============================================================
let denied = false, denyMsg = '';
try {
  raw(`set role authenticated`);
  await q(`select region_leaderboard('KR','daily')`);
} catch (e) {
  denyMsg = String(e.message || e);
  denied = /permission denied/i.test(denyMsg);
} finally {
  raw(`reset role`);
}
ok('revoke: authenticated 실행 차단 (permission denied for function)', denied, denyMsg);

// service_role 은 grant 로 실행 가능해야 함(엣지fn 경로 보존)
let svcOk = false, svcMsg = '';
try {
  raw(`set role service_role`);
  await q(`select region_leaderboard('KR','daily')`);
  svcOk = true;
} catch (e) {
  svcMsg = String(e.message || e);
} finally {
  raw(`reset role`);
}
ok('grant: service_role 실행 가능 (엣지fn 경로 보존)', svcOk, svcMsg || 'ok');

// ---- 리포트 ----
const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} | ${r.name}\n       want=${r.want} got=${r.got}`);
console.log(`\nT7-LEADERBOARD-RPCS SUMMARY: ${passed}/${results.length} passed, ${failed} failed`);
console.log(JSON.stringify({ suite: 't7-leaderboard-rpcs', pg: 'pglite/postgres-18', total: results.length, passed, failed, ts: new Date().toISOString() }));
process.exit(failed === 0 ? 0 : 1);
