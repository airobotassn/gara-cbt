// T9 admin_set_region 통합검증 — pglite(WASM Postgres 18).
//   어드민 CS 경로: 락된 profiles 의 국가/지역을 admin_set_region RPC 로 강제 정정.
//   · 함수-내부 set_config(is_local=true) GUC 로 enforce_region_lock 트리거를 우회.
//   · region_locked_at 은 coalesce 로 보존(최초 락 시각 유지).
//   · 함수 반환 후 GUC 는 트랜잭션-로컬이라 세션에 남지 않는다(락 재발효).
//   · 무효 region_code 는 regions FK 로 거부.
// 실제 마이그레이션 DDL(20260714000300_admin_set_region.sql) + T1 트리거를 적용해 검증한다.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const db = await PGlite.create();
const raw = (sql) => db.exec(sql);
const q = (sql, params) => db.query(sql, params);

const results = [];
const rec = (name, got, want) => results.push({ name, got: String(got), want: String(want), pass: got === want });
async function expectErr(name, needle, fn) {
  try { await fn(); results.push({ name, got: 'no error', want: `error ~ ${needle}`, pass: false }); }
  catch (e) { const m = String(e?.message ?? e); results.push({ name, got: m, want: `error ~ ${needle}`, pass: m.toLowerCase().includes(needle.toLowerCase()) }); }
}

// ---- profiles(관련 컬럼) + regions(FK 대상) ----
await raw(`create table profiles (
  id uuid primary key,
  display_name text,
  country_code text,
  region_code text,
  region_locked_at timestamptz,
  deactivated_at timestamptz);`);
await raw(`create table regions (code text primary key);
  insert into regions (code) values ('KR-11'),('KR-26'),('KR-27');`);
await raw(`alter table profiles add constraint profiles_region_fk foreign key (region_code) references regions(code);`);

// ---- T1 트리거(방어심층) — 락 이후 지역 변경은 GUC 없이 차단 ----
await raw(`create or replace function enforce_region_lock() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if OLD.region_locked_at is not null
     and (NEW.country_code       is distinct from OLD.country_code
          or NEW.region_code     is distinct from OLD.region_code
          or NEW.region_locked_at is distinct from OLD.region_locked_at)
     and coalesce(current_setting('app.allow_region_change', true), 'off') <> 'on' then
    raise exception 'region is locked';
  end if;
  return NEW;
end $$;
drop trigger if exists trg_region_lock on profiles;
create trigger trg_region_lock before update on profiles
  for each row execute function enforce_region_lock();`);

// ---- 실제 마이그레이션 DDL 적용(admin_set_region) ----
// revoke ... from public,anon,authenticated 는 pglite 에 해당 롤이 없어 스트립(권한은 T1/엣지fn 이 검증).
let ddl = readFileSync('supabase/migrations/20260714000300_admin_set_region.sql', 'utf8');
const before = ddl;
ddl = ddl.replace(/revoke all on function admin_set_region\(uuid, text, text\) from public, anon, authenticated;/g,
  '-- [pglite: 롤 없음 → revoke 스킵]');
if (ddl === before) throw new Error('revoke strip failed — check migration text');
await raw(ddl);

// ---- 시드: LOCKED 프로필(최초 락 KR-11) ----
const U = '11111111-1111-1111-1111-111111111111';
const LOCK = '2026-01-02 03:04:05+00';
await q(`insert into profiles (id, display_name, country_code, region_code, region_locked_at)
         values ($1, 'kim', 'KR', 'KR-11', $2::timestamptz)`, [U, LOCK]);

// (A) 정상 케이스 — 어드민이 락된 회원 지역을 KR-11 → KR-26 으로 정정(트리거 우회 성공)
await raw(`select admin_set_region('${U}'::uuid, 'KR', 'KR-26');`);
let row = (await q(`select country_code, region_code, region_locked_at from profiles where id=$1`, [U])).rows[0];
rec('admin_set_region: region changed KR-11 → KR-26 (bypass worked)', row.region_code, 'KR-26');
rec('admin_set_region: country_code stays KR', row.country_code, 'KR');
// region_locked_at 은 coalesce 로 원래 값 보존
rec('admin_set_region: region_locked_at preserved (coalesce kept original)',
    new Date(row.region_locked_at).getTime(), new Date(LOCK).getTime());

// (B) GUC 는 트랜잭션-로컬 → 함수 반환 후 세션에 남지 않음
const guc = (await q(`select current_setting('app.allow_region_change', true) as v`)).rows[0].v;
rec("admin_set_region: GUC not leaked to session (is_local=true)", guc === 'on', false);

// (C) 방어심층 확인 — 함수 밖 일반 UPDATE 는 여전히 트리거로 차단(GUC 안 남음 증명)
await expectErr('post-call: plain update on locked row still blocked by trigger',
  'region is locked', () => q(`update profiles set region_code='KR-27' where id=$1`, [U]));

// (D) 무효 region — regions FK 위반(어떤 특권 경로로도 거부)
await expectErr("admin_set_region: invalid region 'KR-99' → FK violation",
  'foreign key', () => raw(`select admin_set_region('${U}'::uuid, 'KR', 'KR-99');`));

// (E) 값 불변 확인 — FK 실패 후 지역은 KR-26 그대로(원자성)
row = (await q(`select region_code from profiles where id=$1`, [U])).rows[0];
rec('admin_set_region: region_code unchanged after FK failure', row.region_code, 'KR-26');

// ---- 리포트 ----
for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name}\n       want=${x.want} got=${x.got}`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT9-ADMIN-SET-REGION: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't9-admin-set-region', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
