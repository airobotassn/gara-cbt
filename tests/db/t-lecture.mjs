// T-Lecture — Phase 4 Lecture AI 엔타이틀먼트·per-lecture 쿼터·mandatory-filter 를 pglite(PostgreSQL 18) 로 검증.
//  · pglite 는 pgvector 미지원 → 벡터 유사도(<=>)/hnsw/match_lecture_chunks 는 로컬 실행 불가.
//    → 마이그레이션 텍스트에서 (a)create extension vector, (b)embedding vector(768) 컬럼,
//      (c)lecture_chunks_embedding_idx(hnsw), (d)match_lecture_chunks fn+revoke/grant 를 regex 로 strip 후 적용.
//    → role(anon/authenticated/service_role) 미존재 + auth.users 미존재 → revoke/grant 및 FK 도 strip.
//  검증(벡터 없이 가능한 부분만):
//   1) is_entitled: 행 있을 때만 true, 미보유 유저/타강의 → false.
//   2) consume_quota: KST day 별 원자 증분. p_limit 미만이면 true, 한도 도달이면 FALSE + 증분 없음.
//   3) 쿼터는 per (user,lecture,day) — 다른 강의/다른 날은 독립 카운터.
//   4) (정적) 마이그레이션 파일의 match_lecture_chunks 본문에 `where lecture_id = p_lecture_id` 존재
//      = 교차강의 누출 가드가 RPC 에 baked-in.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const MIG = 'supabase/migrations/20260714000900_lecture_ai.sql';
const migRaw = readFileSync(MIG, 'utf8');

const db = await PGlite.create();
const raw = (sql) => db.exec(sql);
const q = (sql, params) => db.query(sql, params);

const results = [];
const rec = (name, got, want, pass) =>
  results.push({ name, got: JSON.stringify(got), want: JSON.stringify(want), pass });
const eq = (name, got, want) => rec(name, got, want, JSON.stringify(got) === JSON.stringify(want));
const ok = (name, cond, got) => rec(name, got, true, !!cond);

// ---- pgvector 미지원 → 벡터/hnsw/RPC strip ----
let ddl = migRaw;
ddl = ddl.replace(/create extension if not exists vector;/g, '');           // (a) 확장
ddl = ddl.replace(/\n\s*embedding vector\(768\),/g, '');                     // (b) embedding 컬럼(text placeholder = 컬럼 생략)
ddl = ddl.replace(/create index if not exists lecture_chunks_embedding_idx[\s\S]*?;/g, ''); // (c) hnsw 인덱스
ddl = ddl.replace(/create or replace function match_lecture_chunks[\s\S]*?to service_role;/g, ''); // (d) 벡터 RPC + revoke/grant
// role/auth 미존재 → 나머지 revoke/grant 및 auth.users FK strip
ddl = ddl.replace(/^\s*(revoke|grant)\b.*$/gim, '');
ddl = ddl.replace(/\s+references auth\.users\(id\)(\s+on delete cascade)?/g, '');
await raw(ddl);

const uA = '00000000-0000-0000-0000-0000000000a1';
const uB = '00000000-0000-0000-0000-0000000000b2';
const LEC1 = 'lecture-ai-101';
const LEC2 = 'lecture-ai-202';

// ---- 1) is_entitled ----
eq('1a unentitled user → false', (await q(`select is_entitled($1,$2) v`, [uA, LEC1])).rows[0].v, false);
await q(`insert into lecture_entitlements(user_id,lecture_id,source) values ($1,$2,'purchase')`, [uA, LEC1]);
eq('1b after grant → true', (await q(`select is_entitled($1,$2) v`, [uA, LEC1])).rows[0].v, true);
eq('1c entitled to LEC1 but not LEC2 → false', (await q(`select is_entitled($1,$2) v`, [uA, LEC2])).rows[0].v, false);
eq('1d other user (no row) → false', (await q(`select is_entitled($1,$2) v`, [uB, LEC1])).rows[0].v, false);

// ---- 2) consume_quota (한도=3) ----
const LIMIT = 3;
const consume = async (uid, lec) => (await q(`select consume_quota($1,$2,$3) v`, [uid, lec, LIMIT])).rows[0].v;
eq('2a consume #1 under limit → true', await consume(uA, LEC1), true);
eq('2b consume #2 under limit → true', await consume(uA, LEC1), true);
eq('2c consume #3 reaches limit-th allowed → true', await consume(uA, LEC1), true);
eq('2d consume #4 at limit → false (blocked)', await consume(uA, LEC1), false);
eq('2e consume #5 still false (no increment past limit)', await consume(uA, LEC1), false);
// 카운터가 한도에서 멈춰있음(3 초과 증분 없음)
const cnt = Number((await q(
  `select count from lecture_quota where user_id=$1 and lecture_id=$2 and day=(now() at time zone 'Asia/Seoul')::date`,
  [uA, LEC1])).rows[0].count);
eq('2f count capped at limit (=3, no over-increment)', cnt, LIMIT);

// ---- 3) per (user,lecture,day) 독립 ----
// 다른 강의 = 독립 카운터(방금 소진된 LEC1 과 무관하게 true).
eq('3a different lecture independent → true', await consume(uA, LEC2), true);
// 다른 유저 = 독립 카운터.
eq('3b different user independent → true', await consume(uB, LEC1), true);
// 다른 날(어제) 행을 한도까지 미리 채워도 오늘은 새 행 → true (per-day 격리).
const uC = '00000000-0000-0000-0000-0000000000c3';
await q(
  `insert into lecture_quota(user_id,lecture_id,day,count)
   values ($1,$2,((now() at time zone 'Asia/Seoul')::date - 1),$3)`, [uC, LEC1, LIMIT]);
eq('3c yesterday exhausted, today fresh → true', await consume(uC, LEC1), true);
const rowsC = (await q(
  `select day::text d, count from lecture_quota where user_id=$1 and lecture_id=$2 order by day`, [uC, LEC1])).rows;
eq('3d two separate day rows for user', rowsC.length, 2);
// 오늘 KST 날짜가 쿼터 행에 정확히 기록됨.
const kstToday = (await q(`select (now() at time zone 'Asia/Seoul')::date::text d`)).rows[0].d;
eq('3e today row day = KST date', rowsC[1].d, kstToday);

// ---- 4) 정적: mandatory cross-lecture filter guard ----
const fnMatch = migRaw.match(/create or replace function match_lecture_chunks[\s\S]*?\$\$;/);
ok('4a match_lecture_chunks fn present in migration', fnMatch != null, fnMatch?.[0]?.slice(0, 60));
ok('4b match body bakes in `where lecture_id = p_lecture_id` (leak guard)',
  fnMatch != null && /where\s+lecture_id\s*=\s*p_lecture_id/.test(fnMatch[0]),
  fnMatch ? /where\s+lecture_id\s*=\s*p_lecture_id/.test(fnMatch[0]) : null);

// ---- 결과 출력 ----
for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${x.got} want=${x.want})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-LECTURE: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-lecture', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
