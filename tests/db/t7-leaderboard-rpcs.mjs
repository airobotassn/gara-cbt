// T7 집계 리더보드 RPC 검증 — pglite(WASM Postgres 18)에 Supabase 롤 모형을 세우고
// 실제 마이그레이션 DDL(supabase/migrations/20260714000200_leaderboard_rpcs.sql)을 적용해
//   · 버킷 집계(member_count/avg_level/active_today/participation/score)의 정확성
//   · MIN_BUCKET_USERS=5 프라이버시 floor(n<5 버킷 미노출)
//   · 탈퇴자(deactivated_at) 카운트 제외
//   · daily vs season score 규칙
//   · 개인 식별 필드(user_id/name) 무노출 — 집계 키만
//   · revoke execute → authenticated 실행 차단(permission denied)
// 을 검증한다. (이 마이그레이션은 pg_trgm 미사용 → 스트립 불필요)
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

// ---- Supabase 모형: 롤 (service_role = 엣지fn 호출자) ----
raw(`create role anon; create role authenticated; create role service_role;`);

// ---- 최소 스키마: profiles / user_progress / test_attempts / regions / schools ----
raw(`
  create table regions ( code text primary key );
  create table schools ( id text primary key, name text not null );
  create table profiles (
    id uuid primary key,
    display_name   text,
    country_code   text,
    region_code    text,
    school_id      text,
    deactivated_at timestamptz
  );
  create table user_progress (
    user_id    uuid primary key,
    rank       int not null,
    points     int not null default 0,
    updated_at timestamptz default now()
  );
  create table test_attempts (
    user_id    uuid,
    status     text,
    created_at timestamptz default now()
  );
  create table daily_activity (
    user_id uuid,
    day     date,
    primary key (user_id, day)
  );
`);
raw(`insert into regions (code) values ('KR-11'),('KR-26');`);
raw(`insert into schools (id, name) values ('snu','서울대학교');`);

// ---- 마이그레이션 DDL 적용(RPC 3종 + 헬퍼 + revoke/grant) ----
const ddl = readFileSync('supabase/migrations/20260714000200_leaderboard_rpcs.sql', 'utf8');
await raw(ddl);

// ============================================================
// 시나리오 시딩
//   KR-11: 활성 6명 rank=[3,3,4,4,5,5] → avg_level=4.0, 그중 3명 오늘 응시(active=3)
//          + 탈퇴자 1명(rank=7, deactivated) → 카운트/평균에서 제외되어야 함
//   KR-26: 활성 3명 rank=[5,5,5] → n<5 이므로 floor 로 미노출
//   6명 모두 school_id='snu' (school_leaderboard 라벨 조인 검증용)
// ============================================================
// 명시적 uuid 목록(가독성 우선)
const KR11 = [
  '11111111-1111-1111-1111-111111111101',
  '11111111-1111-1111-1111-111111111102',
  '11111111-1111-1111-1111-111111111103',
  '11111111-1111-1111-1111-111111111104',
  '11111111-1111-1111-1111-111111111105',
  '11111111-1111-1111-1111-111111111106',
];
const KR11_RANKS = [3, 3, 4, 4, 5, 5]; // sum 24 / 6 = 4.0
const KR11_DEACT = '11111111-1111-1111-1111-1111111111d0'; // 탈퇴자(제외 대상), rank 7
const KR26 = [
  '26262626-2626-2626-2626-262626262601',
  '26262626-2626-2626-2626-262626262602',
  '26262626-2626-2626-2626-262626262603',
];

// KR-11 활성 6명
for (let i = 0; i < KR11.length; i++) {
  await q(`insert into profiles (id, display_name, country_code, region_code, school_id) values ($1,$2,'KR','KR-11','snu')`, [KR11[i], `kr11_${i}`]);
  await q(`insert into user_progress (user_id, rank, points) values ($1,$2,$3)`, [KR11[i], KR11_RANKS[i], KR11_RANKS[i] * 100]);
}
// KR-11 탈퇴자 (deactivated) — 카운트/평균에서 빠져야 함
await q(`insert into profiles (id, display_name, country_code, region_code, school_id, deactivated_at) values ($1,'gone','KR','KR-11','snu', now())`, [KR11_DEACT]);
await q(`insert into user_progress (user_id, rank, points) values ($1, 7, 700)`, [KR11_DEACT]);
// KR-26 활성 3명 (floor 미달)
for (let i = 0; i < KR26.length; i++) {
  await q(`insert into profiles (id, display_name, country_code, region_code) values ($1,$2,'KR','KR-26')`, [KR26[i], `kr26_${i}`]);
  await q(`insert into user_progress (user_id, rank, points) values ($1, 5, 500)`, [KR26[i]]);
}
// 오늘(KST) 참여: KR-11 6명 중 3명만 daily_activity 기록 → active_today=3 (Phase-2 스왑: 헬퍼가 daily_activity 조회)
for (const u of [KR11[0], KR11[1], KR11[2]]) {
  await q(`insert into daily_activity (user_id, day) values ($1, (now() at time zone 'Asia/Seoul')::date)`, [u]);
}
// 방해자극: 어제 참여 1건(오늘 아님) — active 로 세면 안 됨
await q(`insert into daily_activity (user_id, day) values ($1, (now() at time zone 'Asia/Seoul')::date - 1)`, [KR11[3]]);
// 방해자극: 탈퇴자도 오늘 참여했지만 profiles 조인에서 제외 → 카운트 무영향
await q(`insert into daily_activity (user_id, day) values ($1, (now() at time zone 'Asia/Seoul')::date)`, [KR11_DEACT]);

// ---- helper: RPC → 파싱된 버킷 배열 ----
async function callArr(sql, params) {
  const v = (await q(sql, params)).rows[0].j;
  return typeof v === 'string' ? JSON.parse(v) : v;
}
const ALLOWED_KEYS = new Set(['code', 'label', 'member_count', 'avg_level', 'active_today', 'participation', 'score']);

// ============================================================
// (A) region_leaderboard daily
// ============================================================
const rDaily = await callArr(`select region_leaderboard('KR','daily') as j`);
const kr11 = rDaily.find((b) => b.code === 'KR-11');
const kr26 = rDaily.find((b) => b.code === 'KR-26');

ok('region(daily): KR-11 버킷 존재', !!kr11, kr11);
ok('region(daily): KR-26 버킷 미노출 (n=3 < floor 5)', !kr26, kr26 ?? null);
eq('region(daily): KR-11 member_count = 6 (탈퇴자 제외)', Number(kr11?.member_count), 6);
eq('region(daily): KR-11 avg_level = 4.0 (탈퇴자 rank7 제외)', Number(kr11?.avg_level), 4);
eq('region(daily): KR-11 active_today = 3 (오늘 KST 응시자만)', Number(kr11?.active_today), 3);
eq('region(daily): KR-11 participation = 3/6 = 0.5', Number(kr11?.participation), 0.5);
eq('region(daily): KR-11 daily score = avg*part = 4.0*0.5 = 2.0', Number(kr11?.score), 2);

// 개인 식별 필드 무노출 — 집계 키만
const keys = Object.keys(kr11 ?? {});
ok('region: 버킷 키가 허용 집계키뿐 (user_id/name 무노출)', keys.every((k) => ALLOWED_KEYS.has(k)), keys);
ok('region: user_id/name/display 문자열 미포함', !JSON.stringify(rDaily).match(/user_id|display_name|"name"|"id"/), JSON.stringify(rDaily));

// ============================================================
// (B) region_leaderboard season — score = avg_level (참여율 미반영)
// ============================================================
const rSeason = await callArr(`select region_leaderboard('KR','season') as j`);
const kr11s = rSeason.find((b) => b.code === 'KR-11');
eq('region(season): KR-11 score = avg_level = 4.0 (참여율 미반영)', Number(kr11s?.score), 4);
eq('region(season): KR-11 avg_level 여전히 4.0', Number(kr11s?.avg_level), 4);
ok('region(season): KR-26 여전히 미노출', !rSeason.find((b) => b.code === 'KR-26'), rSeason.map((b) => b.code));

// ============================================================
// (C) school_leaderboard — label = schools.name 조인, floor 동일 적용
// ============================================================
const sDaily = await callArr(`select school_leaderboard('KR','daily') as j`);
const snu = sDaily.find((b) => b.code === 'snu');
ok('school(daily): snu 버킷 존재 (6 >= floor)', !!snu, snu);
eq('school(daily): snu label = 서울대학교 (schools 조인)', snu?.label, '서울대학교');
eq('school(daily): snu member_count = 6', Number(snu?.member_count), 6);
eq('school(daily): snu daily score = 2.0', Number(snu?.score), 2);

// ============================================================
// (D) country_leaderboard — 국가 버킷
// ============================================================
const cDaily = await callArr(`select country_leaderboard('daily') as j`);
const kr = cDaily.find((b) => b.code === 'KR');
// 전 KR 활성 = KR-11 6명 + KR-26 3명 = 9 (>= floor)
eq('country(daily): KR member_count = 9 (KR-11 6 + KR-26 3, 탈퇴자 제외)', Number(kr?.member_count), 9);
eq('country(daily): KR active_today = 3', Number(kr?.active_today), 3);
ok('country: user_id/name 무노출', !JSON.stringify(cDaily).match(/user_id|display_name|"name"|"id"/), JSON.stringify(cDaily));

// ============================================================
// (E) revoke execute — authenticated 롤은 실행 불가 (permission denied)
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
