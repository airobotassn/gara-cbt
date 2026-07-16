// T-Titles — 칭호(자격증 트랙·급수) ON READ 파생 함수 user_titles / has_title 를
//   pglite(WASM Postgres 18)에서 검증. certificates 테이블 없음 = exam_attempts 합격에서만 파생.
//  · 함수 DDL(20260714000800_titles.sql)을 적용하고 실제 함수를 호출한다.
//  · titles 마이그레이션은 exams / exam_attempts 를 참조하므로 최소 테이블을 먼저 만든다
//    (auth 스키마 없음 → user_id FK 미부여, 실 스키마는 references auth.users).
//  · Supabase 롤(anon/authenticated/service_role)은 revoke/grant 대상이므로 미리 생성.
//  검증:
//   1) 0.85(CARIS Pro, tier=pro) + 0.62(CARIS Master, tier=master) → Pro '2급' + Master '4급'
//   2) 0.55(불합격, <0.60) 만 있는 유저 → []
//   3) in_progress 0.99(제출 전) → [] (진짜 취득자만 — 부정/사전 조작 불가)
//   4) has_title 편의 함수
//   5) 구매/뽑기로 칭호 생성 불가 = 쓰기 경로 없음: 함수는 STABLE + SECURITY DEFINER (read-only),
//      certificates/titles 테이블 부재, authenticated 실행권 회수(클라 직접 호출 차단)
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

// ---- Supabase 롤 모형(revoke/grant 대상) ----
await raw(`create role anon; create role authenticated; create role service_role;`);
await raw(`-- pglite: pgcrypto 미지원이나 gen_random_uuid 는 내장이라 확장 불필요`);

// ---- titles 함수가 참조하는 최소 테이블(auth.users FK 미부여) ----
await raw(`
  create table exams (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    tier text
  );
  create table exam_attempts (
    id uuid primary key default gen_random_uuid(),
    exam_id uuid references exams(id),
    user_id uuid not null,
    status text not null default 'in_progress',
    total_questions int,
    total_correct int
  );
`);

// ---- 함수 DDL (exam_attempts/exams 참조 → auth 참조 없음, strip 불필요) ----
const fnraw = readFileSync('supabase/migrations/20260714000800_titles.sql', 'utf8');
await raw(fnraw);

// ---- 시드 ----
const uid = '00000000-0000-0000-0000-000000000001';  // 합격자 (Pro 0.85 + Master 0.62)
const uid2 = '00000000-0000-0000-0000-000000000002'; // 불합격 0.55 만
const uid3 = '00000000-0000-0000-0000-000000000003'; // 제출 전 in_progress 0.99

const examPro = (await q(`insert into exams (title, tier) values ('CARIS Pro', 'pro') returning id`)).rows[0].id;
const examMaster = (await q(`insert into exams (title, tier) values ('CARIS Master', 'master') returning id`)).rows[0].id;

// uid: 0.85(Pro) submitted, 0.62(Master) submitted
await q(`insert into exam_attempts (exam_id, user_id, status, total_questions, total_correct)
         values ($1,$2,'submitted',100,85)`, [examPro, uid]);
await q(`insert into exam_attempts (exam_id, user_id, status, total_questions, total_correct)
         values ($1,$2,'submitted',100,62)`, [examMaster, uid]);
// uid2: 0.55(Pro) submitted → 불합격
await q(`insert into exam_attempts (exam_id, user_id, status, total_questions, total_correct)
         values ($1,$2,'submitted',100,55)`, [examPro, uid2]);
// uid3: 0.99(Master) 제출 전(in_progress) → 미취득
await q(`insert into exam_attempts (exam_id, user_id, status, total_questions, total_correct)
         values ($1,$2,'in_progress',100,99)`, [examMaster, uid3]);

// ============================================================
// 1) 합격자: Pro '2급'(0.85) + Master '4급'(0.62)
// ============================================================
const t1 = (await q(`select public.user_titles($1) as r`, [uid])).rows[0].r;
ok('1a returns 2 titles (Pro + Master)', Array.isArray(t1) && t1.length === 2, t1);
const pro = (t1 || []).find((x) => x.track === 'Pro');
const master = (t1 || []).find((x) => x.track === 'Master');
eq('1b Pro grade = 2급 (ratio 0.85)', pro && pro.grade, '2급');
eq('1c Pro exam_title = CARIS Pro', pro && pro.exam_title, 'CARIS Pro');
eq('1d Master grade = 4급 (ratio 0.62)', master && master.grade, '4급');
eq('1e Master track present (tier ilike %master%)', master && master.track, 'Master');
eq('1f Master exam_title = CARIS Master', master && master.exam_title, 'CARIS Master');

// ============================================================
// 2) 불합격(0.55 < 0.60) 만 있는 유저 → []
// ============================================================
const t2 = (await q(`select public.user_titles($1) as r`, [uid2])).rows[0].r;
eq('2a fail-only user returns []', t2, []);

// ============================================================
// 3) 제출 전 in_progress 0.99 → [] (진짜 취득자만; 사전 조작/부정 불가)
// ============================================================
const t3 = (await q(`select public.user_titles($1) as r`, [uid3])).rows[0].r;
eq('3a in_progress attempt yields no title', t3, []);

// ============================================================
// 4) has_title 편의 함수
// ============================================================
const h1 = (await q(`select public.has_title($1) as b`, [uid])).rows[0].b;
const h2 = (await q(`select public.has_title($1) as b`, [uid2])).rows[0].b;
const h3 = (await q(`select public.has_title($1) as b`, [uid3])).rows[0].b;
eq('4a has_title true for 취득자', h1, true);
eq('4b has_title false for 불합격', h2, false);
eq('4c has_title false for in_progress', h3, false);

// ============================================================
// 5) 구매/뽑기 불가 = 쓰기 경로 없음(derive-on-read only)
//    · user_titles/has_title 는 STABLE(부작용 없음) + SECURITY DEFINER(read fn)
//    · certificates/titles 테이블 부재(파생만 존재)
//    · authenticated(클라) 실행권 회수 → 서버(service_role)만 호출
// ============================================================
const meta = (await q(`select proname, prosecdef, provolatile
                       from pg_proc where proname in ('user_titles','has_title') order by proname`)).rows;
const mUser = meta.find((m) => m.proname === 'user_titles');
const mHas = meta.find((m) => m.proname === 'has_title');
ok('5a user_titles is SECURITY DEFINER', mUser && mUser.prosecdef === true, mUser && mUser.prosecdef);
ok('5b user_titles is STABLE (no write side-effect)', mUser && mUser.provolatile === 's', mUser && mUser.provolatile);
ok('5c has_title is SECURITY DEFINER', mHas && mHas.prosecdef === true, mHas && mHas.prosecdef);
ok('5d has_title is STABLE', mHas && mHas.provolatile === 's', mHas && mHas.provolatile);

const noStore = (await q(`select count(*)::int n from information_schema.tables
                          where table_schema='public'
                            and table_name in ('certificates','titles','user_titles','user_titles_store')`)).rows[0].n;
eq('5e no certificates/titles storage table (derive-on-read only)', noStore, 0);

const authExec = (await q(`select has_function_privilege('authenticated','public.user_titles(uuid)','execute') as e`)).rows[0].e;
const svcExec = (await q(`select has_function_privilege('service_role','public.user_titles(uuid)','execute') as e`)).rows[0].e;
const anonExec = (await q(`select has_function_privilege('anon','public.user_titles(uuid)','execute') as e`)).rows[0].e;
eq('5f authenticated cannot execute (client blocked)', authExec, false);
eq('5g anon cannot execute', anonExec, false);
eq('5h service_role can execute (server-only)', svcExec, true);

// ---- 결과 출력 ----
for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${x.got} want=${x.want})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-TITLES: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-titles', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
