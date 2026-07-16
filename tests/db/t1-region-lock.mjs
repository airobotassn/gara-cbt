// T1 락 통합검증 — pglite(WASM Postgres 18) 에 Supabase 롤 모형을 세우고
// 실제 마이그레이션 DDL(supabase/migrations/20260714000000_region_onboarding.sql)을
// 적용해 컬럼-권한 락 + 트리거 방어심층 + FK + 재활성/탈퇴 회귀를 검증한다.
// pglite 는 pg_trgm 미지원이라 학교 trgm 인덱스/확장 라인만 스트립(락과 무관).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const db = await PGlite.create();
const raw = async (sql) => db.exec(sql);
const q = async (sql, params) => db.query(sql, params);

const results = [];
async function expectOk(name, fn) {
  try { await fn(); results.push({ name, expect: 'ok', got: 'ok', pass: true }); }
  catch (e) { results.push({ name, expect: 'ok', got: 'ERROR: ' + (e.message || e), pass: false }); }
}
async function expectErr(name, needle, fn) {
  try { await fn(); results.push({ name, expect: `error~"${needle}"`, got: 'ok(NO ERROR)', pass: false }); }
  catch (e) {
    const m = String(e.message || e);
    results.push({ name, expect: `error~"${needle}"`, got: m.slice(0, 80), pass: m.toLowerCase().includes(needle.toLowerCase()) });
  }
}
async function asRole(role, uid, guc, fn) {
  await raw('reset role;');
  await q(`select set_config('test.uid', $1, false)`, [uid ?? '']);
  await q(`select set_config('app.allow_region_change', $1, false)`, [guc ?? '']);
  await raw(`set role ${role};`);
  try { await fn(); } finally { await raw('reset role;'); }
}

// ---- Supabase 모형: 롤 + auth.uid() ----
await raw(`create role anon; create role authenticated; create role service_role bypassrls;`);
await raw(`create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid $$;`);

// ---- 실제 profiles(관련 컬럼) + RLS + 기본 grant(Supabase 기본 부여 모형) ----
await raw(`create table profiles (
  id uuid primary key, display_name text, avatar_url text,
  is_anonymous boolean default false, created_at timestamptz default now(),
  deactivated_at timestamptz);`);
await raw(`alter table profiles enable row level security;
  create policy profiles_select_own on profiles for select using (auth.uid() = id);
  create policy profiles_update_own on profiles for update using (auth.uid() = id);`);
// Supabase 는 public 테이블에 authenticated/anon 에게 기본 테이블 grant 를 준다(락 no-op 원인).
await raw(`grant select, insert, update, delete on profiles to authenticated, anon;
  grant select, insert, update, delete on profiles to service_role;`);

// ---- 실제 마이그레이션 DDL 적용(pg_trgm 확장/인덱스만 스트립) ----
let ddl = readFileSync('supabase/migrations/20260714000000_region_onboarding.sql', 'utf8');
const before = ddl;
ddl = ddl
  .replace(/create extension if not exists pg_trgm;/g, '-- [pglite: pg_trgm 미지원 → 스킵]')
  .replace(/create index if not exists schools_name_trgm[\s\S]*?gin_trgm_ops\);/g, '-- [pglite: trgm 인덱스 스킵]');
if (ddl === before) throw new Error('pg_trgm strip failed — check migration text');
await raw(ddl);
await raw(`grant select, insert, update, delete on schools to service_role;
  grant select on schools, regions to authenticated, anon;`);

// ---- 테스트 데이터 ----
const U1 = '11111111-1111-1111-1111-111111111111';
await q(`insert into profiles (id, display_name) values ($1, 'kim')`, [U1]);
await q(`insert into schools (id, name, kind) values ('snu','서울대학교','university')`);

// ====== 수용 매트릭스 ======
// (A) UNLOCKED 행 — authenticated 는 지역 3컬럼 쓰기 불가(컬럼 권한), 락 여부 무관.
await asRole('authenticated', U1, null, async () => {
  await expectErr('unlocked: update region_code (deny col)', 'permission denied', () => q(`update profiles set region_code='KR-11' where id=$1`, [U1]));
  await expectErr('unlocked: update country_code (deny col)', 'permission denied', () => q(`update profiles set country_code='KR' where id=$1`, [U1]));
  await expectErr('unlocked: update region_locked_at (deny col)', 'permission denied', () => q(`update profiles set region_locked_at=now() where id=$1`, [U1]));
  // 허용 컬럼(재활성/탈퇴/아바타/이름/학교)은 성공해야 함
  await expectOk('unlocked: update display_name (allow)', () => q(`update profiles set display_name='lee' where id=$1`, [U1]));
  await expectOk('unlocked: update avatar_url (allow)', () => q(`update profiles set avatar_url='gem:#abc' where id=$1`, [U1]));
  await expectOk('unlocked: update school_id (allow)', () => q(`update profiles set school_id='snu' where id=$1`, [U1]));
  await expectOk('unlocked: update deactivated_at (allow, 탈퇴)', () => q(`update profiles set deactivated_at=now() where id=$1`, [U1]));
  await expectOk('unlocked: update deactivated_at=null (allow, 재활성)', () => q(`update profiles set deactivated_at=null where id=$1`, [U1]));
});

// (B) service_role(=set-region) 만 지역 컬럼 쓰기. UNLOCKED → 락 설정 성공.
await asRole('service_role', null, null, async () => {
  await expectOk('service_role: set region on unlocked (=set-region lock)', () => q(`update profiles set country_code='KR', region_code='KR-11', region_locked_at=now() where id=$1 and region_locked_at is null`, [U1]));
});

// (C) LOCKED 행 — 비지역 컬럼(재활성/탈퇴)은 트리거 통과(NEW-3 회귀).
await asRole('authenticated', U1, null, async () => {
  await expectOk('locked: update deactivated_at (재활성/탈퇴 not blocked)', () => q(`update profiles set deactivated_at=null where id=$1`, [U1]));
  await expectOk('locked: update display_name (allow)', () => q(`update profiles set display_name='park' where id=$1`, [U1]));
  await expectErr('locked: update region_code (deny col)', 'permission denied', () => q(`update profiles set region_code='KR-26' where id=$1`, [U1]));
});

// (D) 트리거 방어심층 — service_role 이라도 락 이후 지역 변경은 GUC 없이는 차단.
await asRole('service_role', null, null, async () => {
  await expectErr('locked: service_role region change w/o GUC → trigger', 'region is locked', () => q(`update profiles set region_code='KR-26' where id=$1`, [U1]));
});
// (E) 어드민 우회 — GUC on 이면 지역 변경 허용.
await asRole('service_role', null, 'on', async () => {
  await expectOk('locked: service_role region change WITH GUC (admin)', () => q(`update profiles set region_code='KR-26' where id=$1`, [U1]));
});

// (F) FK — 무효 지역 코드는 어떤 특권 경로로도 거부.
await asRole('service_role', null, 'on', async () => {
  await expectErr('invalid region_code → FK violation', 'foreign key', () => q(`update profiles set region_code='KR-99' where id=$1`, [U1]));
});

// (G) 음성 대조군 — rev2 의 잘못된 접근(테이블 grant + 컬럼-only revoke)은 no-op 임을 증명.
//   has_column_privilege 로 확인: 컬럼-only revoke 후에도 update 권한 잔존 → 실제 update 성공.
//   (WHERE 절이 SELECT 를 요구하므로 select 도 grant 해야 컬럼 의미가 드러난다.)
await raw(`create table ctl(id int, a text, b text); insert into ctl values (1,'x','y');
  grant select, update on ctl to authenticated;      -- 테이블 grant(Supabase 기본 부여 모형)
  revoke update (b) on ctl from authenticated;`);      // 컬럼-only revoke (rev2 의 잘못된 접근)
const ctlPriv = (await q("select has_column_privilege('authenticated','ctl','b','update') as u")).rows[0].u;
results.push({ name: 'CONTROL: has_column_privilege(b) still true after column-only revoke (no-op 확인)', expect: 'true', got: String(ctlPriv), pass: ctlPriv === true });
await asRole('authenticated', null, null, async () => {
  await expectOk('CONTROL: update b succeeds after column-only revoke (proves table-REVOKE needed)', () => q(`update ctl set b='z' where id=1`));
});

// (H) anon 롤 — 지역 컬럼은 물론 어떤 컬럼도 쓰기 불가(revoke 후 재부여 없음).
await asRole('anon', null, null, async () => {
  await expectErr('anon: update region_code denied (no grant)', 'permission denied', () => q(`update profiles set region_code='KR-11' where id=$1`, [U1]));
  await expectErr('anon: update display_name denied (no grant)', 'permission denied', () => q(`update profiles set display_name='x' where id=$1`, [U1]));
});

// (I) INSERT 경로 — authenticated 는 profiles INSERT 정책이 없어 RLS 로 차단(지역 자가주입 불가).
await asRole('authenticated', U1, null, async () => {
  await expectErr('authenticated: INSERT profile with region denied (no INSERT RLS policy)', 'row-level security', () => q(`insert into profiles (id, region_code, region_locked_at) values ('22222222-2222-2222-2222-222222222222','KR-11', now())`));
});

// ---- 리포트 ----
const passed = results.filter(r => r.pass).length;
const failed = results.length - passed;
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} | ${r.name}\n       expect=${r.expect} got=${r.got}`);
console.log(`\nT1-LOCK SUMMARY: ${passed}/${results.length} passed, ${failed} failed`);
console.log(JSON.stringify({ suite: 't1-region-lock', pg: 'pglite/postgres-18', total: results.length, passed, failed, ts: new Date().toISOString() }));
process.exit(failed === 0 ? 0 : 1);
