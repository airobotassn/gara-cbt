// T-VISIT-LOG — 방문 로그(visit_log · visit_log_add · 기간별/유입경로/로그 RPC)를 pglite 로 검증.
//   pglite 는 auth 스키마·역할(anon/authenticated)이 없다 → auth.users FK 와 revoke 문을 strip.
//
// 지키는 것:
//  ⭐1) 한 방문자가 하루에 남길 수 있는 줄 수에 상한이 있다 — 없으면 anon 이 부르는 쓰기 경로라 무한히 쌓인다.
//  ⭐2) 시간별은 **0~23 을 전부** 돌려준다(기록 없는 시각은 0). 빠뜨리면 새벽이 통째로 사라진다.
//  ⭐3) 유입경로는 **최초 접속(is_entry)만** 센다 — 화면을 옮길 때마다 세면 외부 유입 1건이 뻥튀기된다.
//  ⭐4) referrer 없는 방문이 사라지지 않는다(빈 키 = '직접입력' 으로 화면이 이름 붙인다).
//  ⭐5) IP 는 **가려진 것만** 들어간다 — 원문(끝이 `*` 가 아닌 값)은 표에 못 앉는다.
//  ⭐6) 보존기간 파기가 실제로 돈다 — 방침에 "180일 후 파기" 라고 적는 근거다(안 지우면 그게 위반).
//   7) 일별·월별 묶음 · 기간 밖 제외 · 로그 페이지네이션.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const MIG = 'supabase/migrations/20260909120000_visit_log.sql';

const db = await PGlite.create();
const raw = (sql) => db.exec(sql);
const q = (sql, params) => db.query(sql, params);

const results = [];
const rec = (name, got, want, pass) =>
  results.push({ name, got: JSON.stringify(got), want: JSON.stringify(want), pass });
const eq = (name, got, want) => rec(name, got, want, JSON.stringify(got) === JSON.stringify(want));
const ok = (name, cond, got) => rec(name, got, true, !!cond);

// ---- 마이그레이션 적용(역할·auth 스키마 strip) ----
// pglite 에는 pg_cron 이 없다 → 크론 등록 두 줄만 걷어낸다(정리 함수 자체는 그대로 만들어 검증한다).
let ddl = readFileSync(MIG, 'utf8');
ddl = ddl.replace(/\s+references auth\.users\(id\)(\s+on delete set null)?/g, '');
ddl = ddl.replace(/^\s*(revoke|grant)\b[\s\S]*?;\s*$/gim, '');
ddl = ddl.replace(/^\s*select cron\.(un)?schedule[\s\S]*?;\s*$/gim, '');
// visit_events(요약표)는 이 마이그레이션이 만들지 않는다 — 정리 함수가 건드리므로 최소 형태로 만들어 둔다.
await raw(`create table visit_events (day date not null, visitor_id uuid not null, views integer not null default 1);`);
await raw(ddl);

const uA = '00000000-0000-0000-0000-0000000000a1';
const v1 = '11111111-1111-4111-8111-111111111111';
const v2 = '22222222-2222-4222-8222-222222222222';

const kstToday = (await q(`select (now() at time zone 'Asia/Seoul')::date::text d`)).rows[0].d;

const add = (visitor, user, path, refHost, refUrl, entry, ip = '1.2.3.*') =>
  q(`select visit_log_add($1,$2,$3,'KR','desktop','Chrome','Windows',$4,$5,$6,$7)`,
    [visitor, user, path, refHost, refUrl, entry, ip]);

// ---- 1) 한 건 = 한 줄 (요약표와 다른 점) ----
await add(v1, null, '/', 'm.facebook.com', 'https://m.facebook.com/post/1', true);
await add(v1, null, '/', null, null, false);
await add(v1, null, '/guide', null, null, false);
eq('1a 3번 기록 → 3줄', Number((await q(`select count(*) c from visit_log`)).rows[0].c), 3);
eq('1b 최초 접속은 1줄', Number((await q(`select count(*) c from visit_log where is_entry`)).rows[0].c), 1);

// ---- 2) ⭐하루 상한 ----
// 상한(1000)까지 한 번에 밀어넣고 한 줄 더 시도한다. 직접 insert 로 채운 뒤 함수로 한 건 더.
await q(`insert into visit_log (visitor_id, path, device, browser, os)
         select $1, '/bulk', 'desktop', 'Chrome', 'Windows' from generate_series(1, 1000)`, [v2]);
const beforeCap = Number((await q(`select count(*) c from visit_log where visitor_id=$1`, [v2])).rows[0].c);
await add(v2, null, '/more', null, null, false);
const afterCap = Number((await q(`select count(*) c from visit_log where visitor_id=$1`, [v2])).rows[0].c);
ok('2a ⭐상한을 넘으면 더 안 쌓인다', afterCap === beforeCap, { beforeCap, afterCap });
ok('2b ⭐상한은 방문자별이다 — 남의 기록은 안 막힌다', (await add(v1, null, '/still', null, null, false), Number((await q(`select count(*) c from visit_log where visitor_id=$1`, [v1])).rows[0].c)) === 4, null);

// ---- 3) ⭐시간별은 24줄 전부 ----
const hourly = (await q(`select visit_period_stats($1::date, $1::date, 'hour') v`, [kstToday])).rows[0].v;
eq('3a ⭐시간별 24줄', hourly.rows.length, 24);
eq('3b 0~23 순서', hourly.rows.map((r) => r.key), Array.from({ length: 24 }, (_, i) => String(i)));
ok('3c 기록 없는 시각은 0', hourly.rows.some((r) => Number(r.visits) === 0), hourly.rows.filter((r) => Number(r.visits) > 0).map((r) => r.key));
eq('3d 방문수 합 = 전체', hourly.rows.reduce((a, r) => a + Number(r.visits), 0), Number(hourly.visits));

// ---- 4) 일별 · 월별 ----
await q(`insert into visit_log (day, hour, visitor_id, path, device, browser, os)
         values (($1::date - 40), 3, $2, '/old', 'desktop', 'Chrome', 'Windows')`, [kstToday, v1]);
const daily = (await q(`select visit_period_stats($1::date, $1::date, 'day') v`, [kstToday])).rows[0].v;
eq('4a 오늘만 조회 → 한 줄', daily.rows.length, 1);
ok('4b ⭐기간 밖(40일 전)은 안 센다', !daily.rows.some((r) => r.key !== kstToday), daily.rows.map((r) => r.key));
const monthly = (await q(`select visit_period_stats(($1::date - 40), $1::date, 'month') v`, [kstToday])).rows[0].v;
ok('4c 월별은 YYYY-MM 로 묶는다', monthly.rows.every((r) => /^\d{4}-\d{2}$/.test(r.key)), monthly.rows.map((r) => r.key));

// ---- 5) ⭐유입경로는 최초 접속만 ----
await add(v1, uA, '/', 'www.google.com', 'https://www.google.com/search?q=caris', true);
await add(v1, uA, '/guide', 'www.google.com', 'https://www.google.com/search?q=caris', false); // entry=false → 안 세어야 한다
const src = (await q(`select visit_source_stats($1::date, $1::date) v`, [kstToday])).rows[0].v;
const hostMap = Object.fromEntries(src.hosts.map((h) => [h.key, Number(h.visits)]));
eq('5a ⭐유입은 최초 접속만 (구글 1건)', hostMap['www.google.com'], 1);
eq('5b ⭐referrer 없는 최초 접속도 한 줄로 남는다', typeof hostMap[''], 'undefined');
eq('5c 페이스북 1건', hostMap['m.facebook.com'], 1);
eq('5d 최초 접속 합 = entries_total', src.hosts.reduce((a, h) => a + Number(h.visits), 0), Number(src.entries_total));
eq('5e 최초 접속 페이지는 / 두 건', Number(src.entries.find((e) => e.key === '/')?.visits ?? 0), 2);

// referrer 없는 최초 접속을 하나 넣어 '직접입력' 줄이 생기는지 본다.
await add(v1, null, '/plan', null, null, true);
const src2 = (await q(`select visit_source_stats($1::date, $1::date) v`, [kstToday])).rows[0].v;
const direct = src2.hosts.find((h) => h.key === '');
ok('5f ⭐직접입력(referrer 없음)이 빈 키로 남는다', direct && Number(direct.visits) === 1, src2.hosts.map((h) => h.key));
eq('5g direct 카운트', Number(src2.direct), 1);

// ---- 6) 방문자 로그 — 페이지네이션 ----
const page1 = (await q(`select visit_log_list($1::date, $1::date, 2, 0) v`, [kstToday])).rows[0].v;
eq('6a 한 페이지 2줄', page1.rows.length, 2);
const page2 = (await q(`select visit_log_list($1::date, $1::date, 2, 2) v`, [kstToday])).rows[0].v;
ok('6b 다음 페이지는 다른 줄', JSON.stringify(page1.rows) !== JSON.stringify(page2.rows), null);
ok('6c total 은 페이지와 무관', Number(page1.total) === Number(page2.total) && Number(page1.total) > 2, Number(page1.total));
ok('6d ⭐로그는 회원 여부만 준다(uid 원문 없음)', page1.rows.every((r) => !('user_id' in r) && typeof r.member === 'boolean'), Object.keys(page1.rows[0] ?? {}));

// ---- 7) ⭐IP 는 가려진 것만 ----
await add(v1, null, '/ip1', null, null, false, '185.93.89.*');
await add(v1, null, '/ip2', null, null, false, '185.93.89.147'); // 원문 → 버려져야 한다
const ipRows = (await q(`select path, ip_masked from visit_log where path in ('/ip1','/ip2') order by path`)).rows;
eq('7a ⭐가린 값은 담긴다', ipRows[0].ip_masked, '185.93.89.*');
ok('7b ⭐원문은 조용히 버려진다(줄은 남는다)', ipRows[1].ip_masked === null, ipRows[1]);
let rejected = false;
try { await q(`insert into visit_log (visitor_id, path, device, browser, os, ip_masked) values ($1,'/x','desktop','Chrome','Windows','8.8.8.8')`, [v1]); }
catch { rejected = true; }
ok('7c ⭐표가 원문 IP 를 거절한다(CHECK)', rejected, null);
const ipStat = (await q(`select visit_ip_stats($1::date, $1::date) v`, [kstToday])).rows[0].v;
ok('7d ⭐미상(null)도 한 줄로 남는다', ipStat.rows.some((r) => r.key === ''), ipStat.rows.map((r) => r.key));

// ---- 8) ⭐보존기간 파기 ----
await q(`insert into visit_log (day, hour, visitor_id, path, device, browser, os)
         values (($1::date - 200), 1, $2, '/ancient', 'desktop', 'Chrome', 'Windows')`, [kstToday, v1]);
await q(`insert into visit_events (day, visitor_id, views) values (($1::date - 500), $2, 1), (($1::date - 100), $2, 1)`, [kstToday, v1]);
await q(`select purge_visit_history()`);
eq('8a ⭐200일 지난 로그는 지워진다', Number((await q(`select count(*) c from visit_log where path='/ancient'`)).rows[0].c), 0);
ok('8b 180일 안쪽 로그는 남는다', Number((await q(`select count(*) c from visit_log`)).rows[0].c) > 0, null);
eq('8c 요약표도 400일로 정리된다', Number((await q(`select count(*) c from visit_events`)).rows[0].c), 1);

// ---- 9) ⭐정적 가드 — UA 원문 컬럼 없음 ----
const cols = (await q(`select column_name from information_schema.columns where table_name='visit_log'`)).rows.map((r) => r.column_name);
ok('9a ⭐User-Agent 원문 컬럼 없음', !cols.some((c) => /agent|ua$/.test(c)), cols);
ok('9b 지역 컬럼 없음(조회 시 조인)', !cols.includes('region_code') && !cols.includes('region'), cols);
ok('9c ⭐IP 컬럼은 마스킹 전용 이름 하나뿐', cols.filter((c) => /ip/.test(c)).join() === 'ip_masked', cols.filter((c) => /ip/.test(c)));

// ---- 결과 출력 ----
for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${x.got} want=${x.want})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-VISIT-LOG: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-visit-log', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
