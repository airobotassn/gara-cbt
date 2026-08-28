// T-Ranking-History — 마이그레이션 20260825210000(랭킹 추이)을 pglite 에 적용해 검증한다.
//
// 이 기능이 지키려는 약속 셋:
//  · ⭐ **추이의 오늘 값 = 화면의 내 순위** — 스냅샷이 `scoped_top` 과 같은 풀·같은 정렬을 써야 한다.
//    다르면 같은 순간의 같은 순위인데 그래프 끝점과 아래 순위 바가 다른 숫자를 말한다.
//  · ⭐ **과거는 저장된 것에서 정확히 되짚는다** — 활동은 원장 누적합, 실력은 등급 스냅샷.
//    특히 **천장 예외**(Lv.7 이 Lv.7 을 통과 = 등급 그대로인데 +1,000)를 빠뜨리면
//    그 사람 과거가 통째로 1,000 낮게 재현된다.
//  · ⭐ **더미는 이력을 안 만든다** — 3만5천 × 365 행을 만들 이유가 없고, 애초에 점수가 안 변한다.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const strip = (sql) => sql.replace(/\s+references auth\.users\(id\)(\s+on delete cascade)?/g, '');
const noCron = (sql) => sql.replace(/select cron\.[\s\S]*?;\n/g, '');
const db = await PGlite.create();

await db.exec(`create role anon; create role authenticated; create role service_role;`);

await db.exec(`
  create table regions (code text primary key, country_code text);
  create table profiles (
    id uuid primary key, display_name text, avatar_url text,
    is_anonymous boolean default false, deactivated_at timestamptz,
    country_code text, region_code text
  );
  create table user_progress (
    user_id uuid primary key, rank int not null default 1,
    skill_score numeric not null default 0, activity_score numeric not null default 0,
    season_total numeric generated always as (skill_score + activity_score) stored,
    season_id int, updated_at timestamptz default now()
  );
  create table arena_seed_buckets (
    scope text, code text, country_code text, member_count int, avg_level numeric,
    active_today int, label text, note text, primary key (scope, code)
  );
  -- 활동 원장 — 추이가 과거 활동 점수를 되짚는 유일한 출처.
  create table activity_ledger (
    id bigserial primary key, user_id uuid not null, season_id int not null,
    kind text not null, delta numeric not null, day date not null, source_ref text
  );
  -- 응시 이력 — 추이가 과거 실력 점수를 되짚는 유일한 출처.
  create table test_attempts (
    id uuid primary key default gen_random_uuid(), user_id uuid not null,
    level int not null, status text not null default 'submitted', submitted_at timestamptz,
    total_correct int, total_questions int, rank_before int, rank_after int, rank_dir text
  );
  create or replace function public.ranking_tier(p_pct numeric) returns text language sql immutable as $fn$
    select case when p_pct <= 0.05 then 'diamond' when p_pct <= 0.20 then 'platinum'
                when p_pct <= 0.45 then 'gold'    when p_pct <= 0.75 then 'silver' else 'bronze' end $fn$;
`);

await db.exec(strip(readFileSync('supabase/migrations/20260821130000_ranking_dummies.sql', 'utf8')));
await db.exec(noCron(readFileSync('supabase/migrations/20260821160000_scoped_page.sql', 'utf8')));

// ── 고정 데이터 ─────────────────────────────────────────────────────────────
// 더미는 시드 생성기를 돌리지 않고 손으로 몇 줄만 — 이 테스트가 보는 건 "줄을 제대로 세우나" 지
// 시드 값 자체가 아니다(그건 t-ranking-dummies 소관).
const U1 = '11111111-1111-1111-1111-111111111111'; // 보통 사람(응시 3회 + 활동)
const U2 = '22222222-2222-2222-2222-222222222222'; // 천장 예외(Lv.7 이 Lv.7 통과)
const U3 = '33333333-3333-3333-3333-333333333333'; // 국가·지역 미설정
const U4 = '44444444-4444-4444-4444-444444444444'; // 탈퇴 — 풀에서 빠져야 한다

await db.exec(`
  insert into regions (code, country_code) values ('KR-11','KR'),('KR-26','KR'),('US-CA','US');
  insert into profiles (id, display_name, country_code, region_code) values
    ('${U1}','유저1','KR','KR-11'),
    ('${U2}','유저2','KR','KR-11'),
    ('${U3}','유저3',null,null);
  insert into profiles (id, display_name, country_code, region_code, deactivated_at) values
    ('${U4}','탈퇴','KR','KR-11', now());
  insert into user_progress (user_id, rank, skill_score, activity_score, season_id) values
    ('${U1}', 4, 3000,  120, 1),
    ('${U2}', 7, 7000,   40, 1),
    ('${U3}', 1,    0,   10, 1),
    ('${U4}', 5, 4000, 1000, 1);
  -- 더미 8명: 전세계에 흩어져 있고 KR-11 에도 몇 명 있다.
  insert into ranking_dummies (display_name, country_code, region_code, rank, skill_score, activity_score) values
    ('d1','KR','KR-11', 6, 5000, 200),
    ('d2','KR','KR-11', 4, 3000, 500),
    ('d3','KR','KR-11', 2, 1000, 100),
    ('d4','KR','KR-26', 5, 4000,  50),
    ('d5','US','US-CA', 7, 6000, 300),
    ('d6','US','US-CA', 3, 2000,  10),
    ('d7','US','US-CA', 1,    0,  30),
    ('d8','KR','KR-26', 1,    0,   5);
`);

// U1 — Lv.1→2→3→4 로 세 번 승급(응시일이 다르다) + 활동 적립.
// U2 — Lv.6→7 승급 뒤, Lv.7 을 24/30 으로 통과(등급은 7 그대로, 클리어 수만 7).
await db.exec(`
  insert into test_attempts (user_id, level, submitted_at, total_correct, total_questions, rank_before, rank_after, rank_dir) values
    ('${U1}', 1, (now() at time zone 'Asia/Seoul')::date - 40, 8, 10, 1, 2, 'up'),
    ('${U1}', 2, (now() at time zone 'Asia/Seoul')::date - 30,16, 20, 2, 3, 'up'),
    ('${U1}', 3, (now() at time zone 'Asia/Seoul')::date - 20,15, 20, 3, 4, 'up'),
    ('${U2}', 6, (now() at time zone 'Asia/Seoul')::date - 25,25, 30, 6, 7, 'up'),
    ('${U2}', 7, (now() at time zone 'Asia/Seoul')::date - 10,24, 30, 7, 7, 'stay');
  insert into activity_ledger (user_id, season_id, kind, delta, day) values
    ('${U1}', 1, 'attendance', 100, (now() at time zone 'Asia/Seoul')::date - 35),
    ('${U1}', 1, 'attendance',  20, (now() at time zone 'Asia/Seoul')::date - 5),
    ('${U2}', 1, 'attendance',  40, (now() at time zone 'Asia/Seoul')::date - 26),
    ('${U3}', 1, 'attendance',  10, (now() at time zone 'Asia/Seoul')::date - 3);
`);

await db.exec(strip(noCron(readFileSync('supabase/migrations/20260825210000_ranking_history.sql', 'utf8'))));
// 첫 화면 최적화판. 아래 (2c~2e) 가 이력의 순위를 **화면이 실제로 쓰는 함수**와 대조하려면 이게 있어야 한다.
await db.exec(readFileSync('supabase/migrations/20260827130000_scoped_top_fast.sql', 'utf8'));

const results = [];
const rec = (name, got, want, pass) => results.push({ name, got, want, pass: pass ?? (got === want) });
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const all = async (sql, params) => (await db.query(sql, params)).rows;

// ── 1. 표·권한 ──────────────────────────────────────────────────────────────
{
  const r = await one(`select relrowsecurity as rls from pg_class where relname = 'ranking_history'`);
  rec('1a RLS 켜짐', r.rls, true);
  const p = await one(`select count(*)::int as n from pg_policies where tablename = 'ranking_history'`);
  rec('1b 정책 없음(= service role 전용)', p.n, 0);
  for (const fn of ['snapshot_ranking_history', 'backfill_ranking_history', 'ranking_trend']) {
    const g = await one(
      `select bool_or(has_function_privilege('authenticated', p.oid, 'execute')) as ok
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname='public' and p.proname=$1`, [fn]);
    rec(`1c ${fn} 은 일반 사용자가 못 부른다`, g.ok, false);
  }
}

// ── 2. 오늘 스냅샷 ──────────────────────────────────────────────────────────
{
  const today = (await one(`select ((now() at time zone 'Asia/Seoul')::date)::text as d`)).d;

  const n = await one(`select public.snapshot_ranking_history() as n`);
  // 4명 중 3명 — 탈퇴자(U4)는 풀에 없으니 순위 자체가 없고, 행도 안 만든다.
  rec('2a 살아있는 실회원 수만큼 행이 생긴다', n.n, 3);

  const rows = await all(`select user_id::text as u, rank_global, rank_country, rank_region
                          from ranking_history where day = $1 order by rank_global`, [today]);
  rec('2b 더미는 이력을 안 만든다(3만5천 × 365 행을 만들 이유가 없다)', rows.length, 3);

  // ⭐ 화면(scoped_top)이 말하는 내 순위와 같아야 한다.
  for (const [label, uid] of [['U1', U1], ['U2', U2], ['U3', U3]]) {
    const st = await one(`select (public.scoped_top($1, 0, null, null) -> 'me' ->> 'rank')::int as r`, [uid]);
    const hi = await one(`select rank_global as r from ranking_history where user_id = $1 and day = $2`, [uid, today]);
    rec(`2c ⭐ ${label} 전세계 순위 = scoped_top`, hi.r, st.r);
  }
  // 국가·지역 보드도 같은 방식으로 대조.
  const stC = await one(`select (public.scoped_top($1, 0, 'KR', null) -> 'me' ->> 'rank')::int as r`, [U1]);
  const hiC = await one(`select rank_country as r from ranking_history where user_id = $1 and day = $2`, [U1, today]);
  rec('2d ⭐ U1 국가 순위 = scoped_top(KR)', hiC.r, stC.r);
  const stR = await one(`select (public.scoped_top($1, 0, 'KR', 'KR-11') -> 'me' ->> 'rank')::int as r`, [U1]);
  const hiR = await one(`select rank_region as r from ranking_history where user_id = $1 and day = $2`, [U1, today]);
  rec('2e ⭐ U1 지역 순위 = scoped_top(KR-11)', hiR.r, stR.r);

  // 국가·지역 미설정이면 그 보드에 없다 → null.
  const u3 = await one(`select rank_country, rank_region from ranking_history where user_id = $1 and day = $2`, [U3, today]);
  rec('2f 국가 미설정 → rank_country null', u3.rank_country, null);
  rec('2g 지역 미설정 → rank_region null', u3.rank_region, null);

  // 탈퇴 계정은 풀에 없다 → 그 사람 때문에 남의 순위가 밀리지 않는다.
  //   (탈퇴자 본인 행은 user_progress 에 있으니 생기지만 순위는 풀 밖 기준이다)
  const u4 = await one(`select rank_global from ranking_history where user_id = $1 and day = $2`, [U4, today]);
  rec('2h 탈퇴 계정은 풀에서 빠진다(행 자체가 없다)', u4?.rank_global ?? null, null);

  // 점수는 user_progress 의 권위값 그대로.
  const s = await one(`select season_total::int as t from ranking_history where user_id = $1 and day = $2`, [U1, today]);
  rec('2i 점수 = user_progress.season_total', s.t, 3120);

  // 다시 불러도 행이 안 늘고 값만 갱신된다.
  await db.exec(`update user_progress set activity_score = 130 where user_id = '${U1}'`);
  await db.query(`select public.snapshot_ranking_history()`);
  const dup = await one(`select count(*)::int as n from ranking_history where day = $1`, [today]);
  rec('2j 재실행해도 행이 안 늘어난다', dup.n, 3);
  const upd = await one(`select season_total::int as t from ranking_history where user_id = $1 and day = $2`, [U1, today]);
  rec('2k 재실행하면 값이 갱신된다', upd.t, 3130);
  await db.exec(`update user_progress set activity_score = 120 where user_id = '${U1}'`);
  await db.query(`select public.snapshot_ranking_history()`);
}

// ── 3. 과거 채우기 ──────────────────────────────────────────────────────────
{
  // 마이그레이션 끝에서 이미 한 번 돌았으므로(운영에서 바로 추이가 보이게) 여기서는 지우고 다시 본다.
  // 순서가 중요하다 — **오늘 스냅샷을 먼저** 찍어야 아래 3n(과거 채우기가 그걸 안 덮는다)이 의미가 있다.
  await db.exec(`delete from ranking_history`);
  await db.query(`select public.snapshot_ranking_history()`);
  const n = await one(`select public.backfill_ranking_history() as n`);
  rec('3a 과거 행이 생긴다', n.n > 0, true);

  const at = async (uid, ago) => one(
    `select season_total::int as t, rank_global as rg, rank_country as rc, rank_region as rr
       from ranking_history where user_id = $1 and day = (now() at time zone 'Asia/Seoul')::date - ($2::int)`, [uid, ago]);

  // U1 — 실력 트랙: 40일 전 Lv.1 통과(→등급2, 클리어 1) · 30일 전(→3, 2) · 20일 전(→4, 3).
  //      활동 트랙: 35일 전 +100 · 5일 전 +20.
  rec('3b U1 38일 전 = 1,000(클리어1) + 0',        (await at(U1, 38)).t, 1000);
  rec('3c U1 33일 전 = 1,000 + 100(활동)',          (await at(U1, 33)).t, 1100);
  rec('3d U1 25일 전 = 2,000 + 100',                (await at(U1, 25)).t, 2100);
  rec('3e U1 15일 전 = 3,000 + 100',                (await at(U1, 15)).t, 3100);
  rec('3f U1 3일 전 = 3,000 + 120',                 (await at(U1, 3)).t, 3120);

  // ⭐ U2 천장 예외 — 25일 전 Lv.6 통과로 등급 7(클리어 6 = 6,000).
  //    10일 전 Lv.7 을 24/30 으로 통과 → **등급은 7 그대로인데** 클리어 7 = 7,000.
  rec('3g U2 20일 전 = 6,000 + 40',                 (await at(U2, 20)).t, 6040);
  rec('3h ⭐ U2 5일 전 = 7,000 + 40 (천장 예외 반영)', (await at(U2, 5)).t, 7040);

  // 그 예외를 빼먹으면 오늘 값과 어제 값이 1,000 어긋난다 — 그걸 직접 본다.
  const yst = await one(`select season_total::int as t from ranking_history
    where user_id = $1 and day = (now() at time zone 'Asia/Seoul')::date - 1`, [U2]);
  const tdy = await one(`select season_total::int as t from ranking_history
    where user_id = $1 and day = (now() at time zone 'Asia/Seoul')::date`, [U2]);
  rec('3i ⭐ 어제(되짚은 값)와 오늘(권위값)이 이어진다', yst.t, tdy.t);

  // 순위 — 더미 점수(5200/3500/1100/4050/6300/2010/30/5)와 대조.
  // 15일 전 U1 = 3,100 → 더미 중 위: 5200·3500·4050·6300 = 4명, 실회원 중 위: U2(6040) 1명 → 5위.
  rec('3j 15일 전 U1 전세계 = 6위',                  (await at(U1, 15)).rg, 6);
  // KR 안에서 위: 5200·3500·4050·5(x) → 3명 + U2 → 5위
  rec('3k 15일 전 U1 국가(KR) = 5위',                (await at(U1, 15)).rc, 5);
  // KR-11 안에서 위: 5200·3500 → 2명 + U2 → 4위
  rec('3l 15일 전 U1 지역(KR-11) = 4위',             (await at(U1, 15)).rr, 4);

  // 신호가 없는 사람은 이력을 안 만든다(U3 은 3일 전 적립 하나뿐).
  const u3n = await one(`select count(*)::int as n from ranking_history
    where user_id = $1 and day < (now() at time zone 'Asia/Seoul')::date`, [U3]);
  rec('3m 신호가 있는 날부터만 만든다(U3 = 3일)', u3n.n, 3);

  // ⛔ 오늘(정확한 스냅샷)을 덮지 않는다.
  const t0 = await one(`select season_total::int as t from ranking_history
    where user_id = $1 and day = (now() at time zone 'Asia/Seoul')::date`, [U1]);
  rec('3n ⛔ 오늘 스냅샷을 덮어쓰지 않는다', t0.t, 3120);

  // 되풀이해도 안전.
  const before = await one(`select count(*)::int as n from ranking_history`);
  await db.query(`select public.backfill_ranking_history()`);
  const after = await one(`select count(*)::int as n from ranking_history`);
  rec('3o 재실행 안전(행이 안 늘어난다)', after.n, before.n);
}

// ── 4. 읽기 RPC ─────────────────────────────────────────────────────────────
{
  const trend = async (uid, scope, days) =>
    (await one(`select public.ranking_trend($1, $2, $3) as j`, [uid, scope, days])).j;

  const g = await trend(U1, 'global', 180);
  rec('4a 전세계 추이가 나온다', g.length > 30, true);
  rec('4b 날짜 오름차순', g[0].day < g[g.length - 1].day, true);
  rec('4c 순위·점수를 같이 준다', typeof g[0].rank === 'number' && typeof g[0].score === 'number', true);

  const c = await trend(U1, 'country', 180);
  const r = await trend(U1, 'region', 180);
  rec('4d 국가 범위는 국가 순위를 준다', c[c.length - 1].rank, (await one(
    `select rank_country as x from ranking_history where user_id=$1 order by day desc limit 1`, [U1])).x);
  rec('4e 지역 범위는 지역 순위를 준다', r[r.length - 1].rank, (await one(
    `select rank_region as x from ranking_history where user_id=$1 order by day desc limit 1`, [U1])).x);

  // ⚠️ 국가·지역이 없는 사람은 그 보드에 아예 없다 → 0 이 아니라 **행이 빠져야** 한다.
  const u3g = await trend(U3, 'global', 180);
  const u3c = await trend(U3, 'country', 180);
  rec('4f 국가 미설정 → 전세계는 나온다', u3g.length > 0, true);
  rec('4g ⚠️ 국가 미설정 → 국가 추이는 빈 배열(0위로 그리면 안 된다)', u3c.length, 0);

  // 기간 자르기.
  const wk = await trend(U1, 'global', 7);
  rec('4h 7일 = 8개 이하(오늘 포함)', wk.length <= 8, true);
  rec('4i 7일 구간이 전체보다 짧다', wk.length < g.length, true);

  // 기록이 없는 사람은 빈 배열(에러 아님).
  const none = await trend('99999999-9999-9999-9999-999999999999', 'global', 180);
  rec('4j 기록 없으면 빈 배열', none.length, 0);
}

// ── 5. 걷어내기 ─────────────────────────────────────────────────────────────
{
  await db.exec(`delete from ranking_history`);
  const n = await one(`select count(*)::int as n from ranking_history`);
  rec('5a 한 줄로 걷어낼 수 있다', n.n, 0);
  const st = await one(`select (public.scoped_top($1, 0, null, null) -> 'me' ->> 'rank')::int as r`, [U1]);
  rec('5b 걷어내도 랭킹 화면은 그대로', st.r > 0, true);
}

// ── 리포트 ──────────────────────────────────────────────────────────────────
let fail = 0;
for (const r of results) {
  if (!r.pass) fail++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `  (got ${JSON.stringify(r.got)}, want ${JSON.stringify(r.want)})`}`);
}
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
