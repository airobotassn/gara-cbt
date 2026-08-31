// T-VISIT-STATS — 방문 통계(visit_events · visit_track · visit_stats)를 pglite 로 검증.
//   pglite 는 auth 스키마·역할(anon/authenticated)이 없다 → auth.users FK 와 revoke 문을 strip.
//   `profiles` 는 이 마이그레이션이 만들지 않으므로(이미 있는 표) 조인에 필요한 최소 컬럼만 미리 만든다.
//
// 지키는 것:
//  ⭐1) 행이 무한히 늘지 않는다 — (day, visitor_id, path) 당 한 행, 재방문은 views 증분.
//  ⭐2) 방문 도중 로그인한 사람의 user_id·country 가 다음 익명 요청에 지워지지 않는다(coalesce).
//  ⭐3) 지역은 **회원만** — 지역 미설정 회원·비로그인 방문은 지역표에 안 들어간다(국가표와 모수가 다르다).
//   4) visitors = distinct visitor_id · views = sum(views) · 기간 밖은 안 센다.
//   5) 국가 미상(null)도 한 줄로 나온다 — 조용히 사라지면 합계가 안 맞는 이유를 아무도 못 찾는다.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const MIG = 'supabase/migrations/20260831130000_visit_stats.sql';
const migRaw = readFileSync(MIG, 'utf8');

const db = await PGlite.create();
const raw = (sql) => db.exec(sql);
const q = (sql, params) => db.query(sql, params);

const results = [];
const rec = (name, got, want, pass) =>
  results.push({ name, got: JSON.stringify(got), want: JSON.stringify(want), pass });
const eq = (name, got, want) => rec(name, got, want, JSON.stringify(got) === JSON.stringify(want));
// 그룹 집계는 정렬이 값에 따라 바뀐다(동률이면 key 순) → 키를 정렬해 비교한다.
const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
const eqMap = (name, got, want) => eq(name, sortKeys(got), sortKeys(want));
const ok = (name, cond, got) => rec(name, got, true, !!cond);

// ---- 선행: profiles(조인 대상) 최소 형태 ----
await raw(`create table profiles (
  id uuid primary key,
  country_code text,
  region_code text
);`);

// ---- 마이그레이션 적용(역할·auth 스키마 strip) ----
let ddl = migRaw;
ddl = ddl.replace(/\s+references auth\.users\(id\)(\s+on delete set null)?/g, '');
ddl = ddl.replace(/^\s*(revoke|grant)\b[\s\S]*?;\s*$/gim, '');
await raw(ddl);

const uA = '00000000-0000-0000-0000-0000000000a1'; // KR-11 회원
const uB = '00000000-0000-0000-0000-0000000000b2'; // 지역 미설정 회원
const v1 = '11111111-1111-4111-8111-111111111111';
const v2 = '22222222-2222-4222-8222-222222222222';
const v3 = '33333333-3333-4333-8333-333333333333';

await q(`insert into profiles(id, country_code, region_code) values ($1,'KR','KR-11'), ($2,'KR',null)`, [uA, uB]);

const track = (visitor, user, path, country, device, browser, os) =>
  q(`select visit_track($1,$2,$3,$4,$5,$6,$7)`, [visitor, user, path, country, device, browser, os]);

// ---- 1) 같은 (날짜·방문자·화면) = 한 행, views 만 오른다 ----
await track(v1, null, '/', 'KR', 'desktop', 'Chrome', 'Windows');
await track(v1, null, '/', 'KR', 'desktop', 'Chrome', 'Windows');
await track(v1, null, '/', 'KR', 'desktop', 'Chrome', 'Windows');
eq('1a 3번 방문 → 행은 1개', Number((await q(`select count(*) c from visit_events`)).rows[0].c), 1);
eq('1b views = 3', Number((await q(`select views from visit_events`)).rows[0].views), 3);
await track(v1, null, '/guide', 'KR', 'desktop', 'Chrome', 'Windows');
eq('1c 다른 화면 → 행 추가', Number((await q(`select count(*) c from visit_events`)).rows[0].c), 2);
const kstToday = (await q(`select (now() at time zone 'Asia/Seoul')::date::text d`)).rows[0].d;
eq('1d day = KST 오늘', (await q(`select day::text d from visit_events limit 1`)).rows[0].d, kstToday);

// ---- 2) ⭐coalesce — 로그인 뒤 다시 익명 요청이 와도 user_id·country 가 안 지워진다 ----
await track(v1, uA, '/', 'KR', 'desktop', 'Chrome', 'Windows'); // 방문 도중 로그인
eq('2a 로그인 후 user_id 기록', (await q(`select user_id from visit_events where visitor_id=$1 and path='/'`, [v1])).rows[0].user_id, uA);
await track(v1, null, '/', null, 'desktop', 'Chrome', 'Windows'); // 그 뒤 익명 요청
eq('2b ⭐익명 요청이 user_id 를 지우지 않는다', (await q(`select user_id from visit_events where visitor_id=$1 and path='/'`, [v1])).rows[0].user_id, uA);
eq('2c ⭐익명 요청이 country 를 지우지 않는다', (await q(`select country from visit_events where visitor_id=$1 and path='/'`, [v1])).rows[0].country, 'KR');

// ---- 3) 나머지 방문자들 ----
await track(v2, uB, '/', 'JP', 'mobile', 'Safari', 'iOS');       // 회원이지만 지역 미설정
await track(v2, uB, '/exam', 'JP', 'mobile', 'Safari', 'iOS');
await track(v3, null, '/', null, 'mobile', 'Samsung', 'Android'); // 비로그인 · 국가 미상

// ---- 4) 집계 ----
const s = (await q(`select visit_stats($1::date, $2::date) v`, [kstToday, kstToday])).rows[0].v;
eq('4a 방문자 = 브라우저 3', Number(s.visitors), 3);
eq('4b 조회수 = views 합 9', Number(s.views), 9); // v1: 5(/) + 1(/guide) · v2: 1+1 · v3: 1
eq('4c 로그인 방문자 2', Number(s.members), 2);
eq('4d 일별 한 줄', s.daily.length, 1);
eq('4e 일별 방문자 3', Number(s.daily[0].visitors), 3);

// ---- 5) ⭐국가 — 미상(null)도 한 줄 ----
const cmap = Object.fromEntries(s.countries.map((r) => [r.key ?? '(null)', Number(r.visitors)]));
eqMap('5a 국가별 방문자', cmap, { KR: 1, JP: 1, '(null)': 1 });
ok('5b ⭐미상이 사라지지 않는다', s.countries.some((r) => r.key === null), s.countries.map((r) => r.key));

// ---- 6) ⭐지역 — 지역을 설정한 회원만 ----
eq('6a 지역 줄은 하나(KR-11)', s.regions.map((r) => `${r.country}:${r.key}`), ['KR:KR-11']);
eq('6b 지역 방문자 1', Number(s.regions[0].visitors), 1);
ok('6c ⭐지역 미설정 회원은 안 들어간다', !s.regions.some((r) => r.key === null), s.regions);

// ---- 7) 기기·브라우저·OS ----
eqMap('7a 기기', Object.fromEntries(s.devices.map((r) => [r.key, Number(r.visitors)])), { desktop: 1, mobile: 2 });
eqMap('7b 브라우저', Object.fromEntries(s.browsers.map((r) => [r.key, Number(r.visitors)])), { Chrome: 1, Safari: 1, Samsung: 1 });
eqMap('7c OS', Object.fromEntries(s.os.map((r) => [r.key, Number(r.visitors)])), { Windows: 1, iOS: 1, Android: 1 });
eq('7d 많이 본 화면 = 조회수 내림차순 첫 줄 /', s.paths[0].key, '/');
eq('7e / 조회수 7', Number(s.paths[0].views), 7);

// ---- 8) 기간 밖은 안 센다 ----
await q(`insert into visit_events(day, visitor_id, path, device, browser, os, views)
         values (($1::date - 10), $2, '/old', 'desktop', 'Chrome', 'Windows', 5)`, [kstToday, v1]);
const sIn = (await q(`select visit_stats($1::date, $2::date) v`, [kstToday, kstToday])).rows[0].v;
eq('8a 오늘만 조회 → 옛 행 제외', Number(sIn.views), 9);
const sWide = (await q(`select visit_stats(($1::date - 10), $1::date) v`, [kstToday])).rows[0].v;
eq('8b 기간을 넓히면 포함', Number(sWide.views), 14);

// ---- 9) 정적 가드 — IP 컬럼도 UA 원문 컬럼도 없어야 한다 ----
const cols = (await q(`select column_name from information_schema.columns where table_name='visit_events'`)).rows.map((r) => r.column_name);
ok('9a ⭐IP 컬럼 없음', !cols.some((c) => /ip/.test(c)), cols);
ok('9b ⭐User-Agent 원문 컬럼 없음', !cols.some((c) => /agent|ua$/.test(c)), cols);
ok('9c ⭐지역 컬럼 없음(조회 시 조인)', !cols.includes('region_code') && !cols.includes('region'), cols);

// ---- 결과 출력 ----
for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${x.got} want=${x.want})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-VISIT-STATS: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-visit-stats', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
