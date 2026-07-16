// T6 schools seed 검증 — 마이그레이션 20260714000100_schools_seed.sql 을 pglite 에 적용해
// 행 수(중복 없음) + 모든 region_code 가 17 시도(KR-xx) 안에 있는지 확인.
// (pg_trgm 인덱스는 G001 마이그레이션 소관이고 seed 는 순수 INSERT 라 여기선 테이블만 최소 생성.)
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const REGION_CODES = ['KR-11','KR-26','KR-27','KR-28','KR-29','KR-30','KR-31','KR-41','KR-42','KR-43','KR-44','KR-45','KR-46','KR-47','KR-48','KR-49','KR-50'];

const db = await PGlite.create();
await db.exec(`create table schools (id text primary key, name text not null, kind text, region_code text, active boolean not null default true);`);
const seed = readFileSync('supabase/migrations/20260714000100_schools_seed.sql', 'utf8');
await db.exec(seed);

const results = [];
const rec = (name, got, want, pass) => results.push({ name, got, want, pass: pass ?? (got === want) });

const count = (await db.query(`select count(*)::int n from schools`)).rows[0].n;
rec('seed inserts rows', count > 0 && count >= 50, true, count >= 50);
rec('exact row count is 58', count, 58);

// 멱등: 두 번째 적용해도 행 수 불변(on conflict do nothing)
await db.exec(seed);
const count2 = (await db.query(`select count(*)::int n from schools`)).rows[0].n;
rec('idempotent re-apply (on conflict do nothing)', count2, count);

// 모든 region_code 가 17 시도 안에 있는지
const bad = (await db.query(`select id, region_code from schools where region_code is not null and region_code <> all($1::text[])`, [REGION_CODES])).rows;
rec('all region_code in 17 시도', bad.length, 0, bad.length === 0);
if (bad.length) console.log('  invalid region rows:', JSON.stringify(bad));

// kind 는 university|college
const badKind = (await db.query(`select count(*)::int n from schools where kind is not null and kind not in ('university','college')`)).rows[0].n;
rec('kind in {university,college}', badKind, 0);

// id 유니크(pk) + 이름 non-null 은 스키마가 보장 — 대표 학교 존재 확인
const snu = (await db.query(`select name from schools where id='snu'`)).rows[0];
rec("seed contains 'snu' 서울대학교", snu?.name, '서울대학교');

for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${JSON.stringify(x.got)} want=${JSON.stringify(x.want)})`);
const failed = results.filter(x => !x.pass).length;
console.log(`\nT6-SCHOOLS-SEED: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't6-schools-seed', pg: 'pglite/postgres-18', rows: count, total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
