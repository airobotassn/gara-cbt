// 아레나 집계 버킷 스냅샷 검증 — pglite(WASM Postgres)에 실제 마이그레이션
// (supabase/migrations/20260818140000_arena_bucket_snapshot.sql)을 그대로 적용하고
//   · 시드(더미) + 실집계를 **가중평균**으로 합치는가 (덮어쓰기가 아니라)
//   · 시드만 있는 버킷·실집계만 있는 버킷 둘 다 남는가
//   · has_real 이 "진짜 사람이 1명이라도 있나"를 말하는가 (member_count 로는 알 수 없다)
//   · 프라이버시 floor(합쳐진 인원 5명 미만 제외)
//   · 시드를 지우면 스냅샷에서도 사라지는가 (걷어내기 경로)
//   · 읽기 RPC 3종의 응답 모양·정렬·season/daily 규칙이 예전과 같은가
//   · revoke → authenticated 실행 차단
//   · **회귀: 실제 시드 데이터로 지구본 상위 10개국 순서와 대한민국 4위**
// 를 검증한다.
//
// 왜 t7-leaderboard-rpcs.mjs 로 안 되나: 그 스위트는 **옛 정의**(20260714000200)를 적용해
// 매 요청 재계산 RPC 를 검증한다. 프로덕션의 지금 정의는 이 마이그레이션이 덮어쓴 스냅샷 판이다.
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
const close = (name, got, want, eps = 1e-3) => rec(name, got, want, Math.abs(Number(got) - Number(want)) < eps);

// ---- Supabase 모형: 롤 ----
raw(`create role anon; create role authenticated; create role service_role;`);

// ---- 최소 스키마 ----
raw(`
  create table schools ( id text primary key, name text not null );
  create table profiles (
    id uuid primary key,
    country_code   text,
    region_code    text,
    school_id      text,
    is_anonymous   boolean not null default false,
    deactivated_at timestamptz
  );
  create table user_progress (
    user_id      uuid primary key,
    season_total numeric not null default 0
  );
  create table daily_activity ( user_id uuid, day date, primary key (user_id, day) );
`);
raw(`insert into schools (id, name) values ('snu','서울대학교');`);

// active_today_user_ids() — 원 정의(20260714000200)와 같은 계약.
raw(`
  create or replace function public.active_today_user_ids() returns setof uuid
    language sql stable security definer set search_path = public as $$
    select user_id from daily_activity where day = (now() at time zone 'Asia/Seoul')::date
  $$;
`);

// ---- 마이그레이션 적용 ----
// pg_cron 은 pglite 에 없다. 마이그레이션 자체가 DO 블록 + exception 으로 감싸 두었지만,
// pglite 는 `create extension` 실패를 트랜잭션 중단으로 올려서 여기서만 그 블록을 떼고 넣는다.
// (그 블록이 없어도 나머지 DDL 의 의미는 그대로다 — 크론은 갱신을 '언제' 부르냐일 뿐이다.)
const migration = readFileSync('supabase/migrations/20260818140000_arena_bucket_snapshot.sql', 'utf8');
const CRON_MARK = '-- ── 5) 크론';
await db.exec(migration.slice(0, migration.indexOf(CRON_MARK)));
ok('마이그레이션 적용 성공', true, 'ok');

// ---- 데이터 ----
const uid = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
const addUser = async (n, country, region, total, active = false, school = null) => {
  await q(`insert into profiles (id, country_code, region_code, school_id) values ($1,$2,$3,$4)`,
    [uid(n), country, region, school]);
  await q(`insert into user_progress (user_id, season_total) values ($1,$2)`, [uid(n), total]);
  if (active) await q(`insert into daily_activity (user_id, day) values ($1, (now() at time zone 'Asia/Seoul')::date)`, [uid(n)]);
};

// 시드: KR = 가상 100명 × 평균 2000, JP = 가상 100명 × 평균 1000, MX = 가상 10명 × 평균 500(실집계 없음)
raw(`
  insert into arena_seed_buckets (scope, code, country_code, member_count, avg_level, active_today) values
    ('country','KR', null, 100, 2000, 10),
    ('country','JP', null, 100, 1000, 10),
    ('country','MX', null,  10,  500,  1),
    ('region','KR-11','KR', 100, 2000, 10);
`);

// 실집계: KR 에 사람 10명(평균 100 — 시드보다 한참 낮다), US 는 시드 없이 실회원 6명, FR 은 실회원 2명뿐
for (let i = 1; i <= 10; i++) await addUser(i, 'KR', 'KR-11', 100, i <= 3);
for (let i = 11; i <= 16; i++) await addUser(i, 'US', null, 800, false, 'snu');
for (let i = 17; i <= 18; i++) await addUser(i, 'FR', null, 5000);
// 탈퇴자·익명은 모수에서 빠진다.
await addUser(19, 'KR', 'KR-11', 99999);
await q(`update profiles set deactivated_at = now() where id = $1`, [uid(19)]);
await addUser(20, 'KR', 'KR-11', 99999);
await q(`update profiles set is_anonymous = true where id = $1`, [uid(20)]);

const refresh = () => q(`select public.refresh_arena_buckets() as n`);
await refresh();

const bucket = async (scope, code) =>
  (await q(`select * from arena_bucket_scores where scope=$1 and code=$2`, [scope, code])).rows[0];

// ---- 1) 가중평균 (이 마이그레이션의 핵심) ----
const kr = await bucket('country', 'KR');
eq('KR 인원 = 시드 100 + 실회원 10', Number(kr.member_count), 110);
// (100*2000 + 10*100) / 110 = 1827.2727…
close('KR 평균 = 가중평균이지 실집계 덮어쓰기가 아니다', Number(kr.avg_level), 201000 / 110);
ok('KR 평균이 실집계(100)로 무너지지 않았다', Number(kr.avg_level) > 1800, Number(kr.avg_level));
eq('KR 실회원 수 기록', Number(kr.real_members), 10);
eq('KR has_real = true', kr.has_real, true);

// ---- 2) 시드만 있는 버킷 / 실집계만 있는 버킷 ----
const jp = await bucket('country', 'JP');
eq('JP(시드만) 도 스냅샷에 남는다', Number(jp.member_count), 100);
eq('JP has_real = false (더미뿐)', jp.has_real, false);
close('JP 평균 = 시드 그대로', Number(jp.avg_level), 1000);

const us = await bucket('country', 'US');
eq('US(시드 없이 실회원만) 도 남는다', Number(us.member_count), 6);
eq('US has_real = true', us.has_real, true);
close('US 평균 = 실집계 그대로', Number(us.avg_level), 800);

// ---- 3) 프라이버시 floor ----
ok('FR(실회원 2명·시드 없음)은 floor 로 제외', !(await bucket('country', 'FR')), 'excluded');
ok('MX(시드 10명)는 floor 통과 — 합쳐진 인원 기준', !!(await bucket('country', 'MX')), 'kept');

// ---- 4) 탈퇴·익명 제외 ----
ok('탈퇴자·익명(각 99999점)이 KR 평균을 끌어올리지 않았다', Number(kr.avg_level) < 2000, Number(kr.avg_level));

// ---- 5) 참여율 ----
// 시드 active 10 + 실제 활동 3 = 13 / 110
close('KR 참여율 = (시드활동 + 실활동) / 합쳐진 인원', Number(kr.participation), 13 / 110);

// ---- 6) 읽기 RPC ----
const cl = (await q(`select public.country_leaderboard('season') as j`)).rows[0].j;
eq('country_leaderboard 는 floor 통과 버킷만 준다 (KR·JP·MX·US)', cl.length, 4);
ok('정렬 = score 내림차순', cl.every((b, i) => i === 0 || Number(cl[i - 1].score) >= Number(b.score)), cl.map((b) => b.code));
// ⚠️ 인원이 작은 버킷은 K=25 shrinkage 로 전체 평균(여기선 약 1375) 쪽으로 끌려 올라간다 —
//    평균이 더 낮은 US(800·6명)·MX(500·10명)가 평균 1000 짜리 JP(100명)를 앞지른다.
//    **이게 시드 member_count 를 전부 5,000 이상으로 준 이유다**(tools/gen-arena-seed.mjs 주석).
//    인원을 제각각 주면 하위권이 위로 끌려 올라가 의도한 순위가 뒤집힌다.
eq('작은 버킷은 전체 평균 쪽으로 shrink 된다 (시드 인원을 크게 주는 이유)', cl.map((b) => b.code), ['KR', 'US', 'MX', 'JP']);
ok('응답에 has_real 이 실린다', cl.every((b) => 'has_real' in b), cl[0]);
ok('개인 식별 필드 없음', cl.every((b) => !('user_id' in b) && !('name' in b)), Object.keys(cl[0]));

const clDaily = (await q(`select public.country_leaderboard('daily') as j`)).rows[0].j;
const krS = cl.find((b) => b.code === 'KR'), krD = clDaily.find((b) => b.code === 'KR');
close('daily = season × 참여율', Number(krD.score), Number(krS.score) * (13 / 110), 1e-2);

const rl = (await q(`select public.region_leaderboard('KR','season') as j`)).rows[0].j;
eq('region_leaderboard 는 그 나라 것만', rl.map((b) => b.code), ['KR-11']);
eq('다른 나라 지역은 안 나온다', (await q(`select public.region_leaderboard('JP','season') as j`)).rows[0].j.length, 0);

const sl = (await q(`select public.school_leaderboard('US','season') as j`)).rows[0].j;
eq('school_leaderboard: 학교 라벨이 붙는다', sl.map((b) => b.label), ['서울대학교']);

// ---- 7) 시드 걷어내기 ----
raw(`delete from arena_seed_buckets where scope='country' and code='JP';`);
await refresh();
ok('시드를 지우면 스냅샷에서도 사라진다', !(await bucket('country', 'JP')), 'gone');
ok('남은 버킷은 그대로', !!(await bucket('country', 'KR')), 'kept');
// 실집계가 남아 있으면 시드를 지워도 버킷은 살아 있어야 한다.
raw(`delete from arena_seed_buckets where scope='country' and code='KR';`);
await refresh();
const krAfter = await bucket('country', 'KR');
eq('시드를 지우면 KR 은 순수 실집계가 된다', Number(krAfter.member_count), 10);
close('시드 제거 후 평균 = 실집계 평균', Number(krAfter.avg_level), 100);

// ---- 8) 권한 ----
const failsWith = async (fn) => { try { await fn(); return null; } catch (e) { return String(e.message || e); } };
raw(`set role authenticated;`);
const e1 = await failsWith(() => q(`select public.country_leaderboard('season')`));
const e2 = await failsWith(() => q(`select public.refresh_arena_buckets()`));
raw(`reset role;`);
ok('revoke: authenticated 는 country_leaderboard 실행 불가', /permission denied/i.test(e1 || ''), e1);
ok('revoke: authenticated 는 refresh_arena_buckets 실행 불가', /permission denied/i.test(e2 || ''), e2);

// ---- 9) 회귀: 실제 시드 데이터로 지구본 상위 10개국 ----
// 생성물(20260818140100_arena_seed_data.sql)을 그대로 넣고, 실회원이 없는 상태의 순서를 본다.
// ⚠️ 대한민국 4위는 요구사항이다 — 시드 점수(2550)를 건드리면 여기서 잡힌다.
raw(`delete from arena_seed_buckets; delete from profiles; delete from user_progress; delete from daily_activity;`);
const seed = readFileSync('supabase/migrations/20260818140100_arena_seed_data.sql', 'utf8');
await db.exec(seed.slice(0, seed.indexOf('select public.refresh_arena_buckets()')));
await refresh();
const top = (await q(`select public.country_leaderboard('season') as j`)).rows[0].j.slice(0, 10).map((b) => b.code);
eq('지구본 상위 10개국', top, ['US', 'CN', 'IN', 'KR', 'GB', 'ES', 'AE', 'JP', 'CA', 'IL']);

// ⚠️ **나라 안 지역 순서가 점수 순서와 같아야 한다.** 베이지안 보정은 인원이 작을수록 전체 평균 쪽으로
//    세게 끌어당기는데, 지역 인원을 점수 비율로 쪼개면 점수가 낮아 인원까지 적은 지역이 더 크게
//    끌려 올라가 1등을 먹는다(꼬리 국가 17개국에서 실제로 뒤집혔다 — tools/gen-arena-seed.mjs 주석).
//    생성기가 나라 안 인원을 고르게 두어 막는데, 그 규칙을 되돌리면 여기서 잡힌다.
const invert = (await q(`
  with r as (
    select country_code, avg_level, bayes,
           rank() over (partition by country_code order by avg_level desc) as by_score,
           rank() over (partition by country_code order by bayes     desc) as by_shown
    from arena_bucket_scores where scope = 'region'
  )
  select count(distinct country_code)::int as n from r where by_score <> by_shown
`)).rows[0].n;
eq('나라 안 지역 순서 = 점수 순서 (보정이 순서를 못 흔든다)', Number(invert), 0);
const overflow = (await q(`
  select count(*)::int as n from (
    select r.country_code, sum(r.member_count) as s, max(c.member_count) as c
    from arena_bucket_scores r
    join arena_bucket_scores c on c.scope='country' and c.code = r.country_code
    where r.scope='region' group by r.country_code
  ) t where t.s > t.c * 2.5
`)).rows[0].n;
eq('지역 인원 합이 나라 인원을 2.5배 넘는 나라는 없다', Number(overflow), 0);

// 실회원이 0점으로 들어오면 시드가 희석된다.
//   ⚠️ **시드 인원을 1/24 로 줄인 뒤(2026-08-21) 이 방어력도 24배 줄었다** — 대한민국이 4위를 지키는
//      한계는 이제 약 230명이다(옛 2.5만 시드에서는 5,000명이었다). 그게 인원을 줄인 대가고,
//      사람이 모이면 더미가 밀려나는 건 의도한 동작이다.
//   ⚠️ 다만 **언제 밀리는지를 모르면** 어느 날 순위가 바뀐 걸 버그로 오해한다. 그래서 경계를
//      양쪽에서 박아 둔다 — 아래 두 검사가 같이 움직여야 시드를 다시 손댈 때 값이 드러난다.
for (let i = 100; i < 250; i++) await addUser(i, 'KR', null, 0);   // 150명 — 경계 아래
await refresh();
const top2 = (await q(`select public.country_leaderboard('season') as j`)).rows[0].j.map((b) => b.code);
eq('실회원 150명(0점) 유입 후에도 대한민국 4위', top2.indexOf('KR'), 3);

for (let i = 250; i < 400; i++) await addUser(i, 'KR', null, 0);   // 누적 300명 — 경계 위
await refresh();
const top2b = (await q(`select public.country_leaderboard('season') as j`)).rows[0].j.map((b) => b.code);
eq('실회원 300명(0점)이면 대한민국이 5위로 밀린다(축소의 대가)', top2b.indexOf('KR'), 4);
const krNow = await bucket('country', 'KR');
eq('그때도 has_real = true', krNow.has_real, true);

// ---- 출력 ----
let passed = 0;
for (const r of results) {
  if (r.pass) passed++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'} | ${r.name}\n       want=${r.want} got=${r.got}`);
}
const failed = results.length - passed;
console.log(`\nT-ARENA-BUCKETS SUMMARY: ${passed}/${results.length} passed, ${failed} failed`);
console.log(JSON.stringify({ suite: 't-arena-buckets', pg: 'pglite', total: results.length, passed, failed, ts: new Date().toISOString() }));
if (failed) process.exit(1);
