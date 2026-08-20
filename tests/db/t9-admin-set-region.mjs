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

// ═══ admin_reset_onboarding — 첫 진입 상태로 되돌리기(20260819170000) ═══
//   같은 트리거를 같은 방식(트랜잭션-로컬 GUC)으로 우회한다. 여기서 보는 건 셋:
//     · 락을 풀고 온보딩 값을 비우나  · 이력·프로필의 다른 값은 그대로인가  · GUC 가 세션에 안 남나
await raw(`alter table profiles add column if not exists nickname_set_at timestamptz;
           alter table profiles add column if not exists region_changed_at timestamptz;
           alter table profiles add column if not exists age_band text;
           alter table profiles add column if not exists coins int not null default 0;`);
await raw(readFileSync('supabase/migrations/20260819170000_admin_reset_onboarding.sql', 'utf8')
  .replace(/^revoke .*$/gm, '')); // pglite 엔 anon/authenticated 롤이 없다 — DDL 만 적용한다.

const R = '00000000-0000-0000-0000-0000000000r1'.replace('r1', 'b1');
await q(`insert into profiles (id, display_name, country_code, region_code, region_locked_at,
                               nickname_set_at, region_changed_at, age_band, coins)
         values ($1,'홍길동','KR','KR-11', now(), now(), now(), '20s', 1234)`, [R]);

await raw(`select admin_reset_onboarding('${R}'::uuid);`);
let after = (await q(`select display_name, country_code, region_code, region_locked_at,
                             nickname_set_at, region_changed_at, age_band, coins
                        from profiles where id=$1`, [R])).rows[0];
rec('reset: 닉네임 확정 시각이 비었다(닉네임 화면 다시 뜸)', after.nickname_set_at, null);
rec('reset: 지역 락이 풀렸다(온보딩 화면 다시 뜸)', after.region_locked_at, null);
rec('reset: 국가가 비었다', after.country_code, null);
rec('reset: 지역이 비었다', after.region_code, null);
rec('reset: 연령대가 비었다', after.age_band, null);
rec('reset: 1회 변경권도 되돌아왔다', after.region_changed_at, null);
// ⭐ 온보딩 값만 비운다 — 이걸 어기면 "테스트하려고 눌렀는데 그 사람 것이 사라졌다" 가 된다.
rec('⭐ reset: display_name 은 그대로(가입 트리거가 넣은 실명)', after.display_name, '홍길동');
rec('⭐ reset: 코인 같은 다른 값은 안 건드린다', after.coins, 1234);

// 되돌린 뒤에는 다시 잠기지 않은 상태라 평범한 UPDATE 로 온보딩을 마칠 수 있다(사용자가 실제로 하는 것).
await q(`update profiles set country_code='KR', region_code='KR-27', region_locked_at=now() where id=$1`, [R]);
after = (await q(`select region_code from profiles where id=$1`, [R])).rows[0];
rec('reset 후 사용자가 스스로 다시 확정할 수 있다', after.region_code, 'KR-27');

// 다시 잠겼으니 일반 UPDATE 는 또 막혀야 한다(초기화가 잠금을 영구히 풀어버리면 안 된다).
await expectErr('reset 후 재확정하면 락이 다시 걸린다',
  'region is locked', () => q(`update profiles set region_code='KR-26' where id=$1`, [R]));

// 없는 회원을 초기화해도 조용히 지나간다(멱등) — 두 번 눌러도 같은 상태.
await raw(`select admin_reset_onboarding('${R}'::uuid);`);
await raw(`select admin_reset_onboarding('${R}'::uuid);`);
rec('reset: 두 번 눌러도 같은 상태(멱등)',
    (await q(`select nickname_set_at from profiles where id=$1`, [R])).rows[0].nickname_set_at, null);

const guc2 = (await q(`select current_setting('app.allow_region_change', true) as v`)).rows[0].v;
rec('reset: GUC 가 세션에 안 남는다', guc2 === 'on', false);

// ---- 리포트 ----
for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name}\n       want=${x.want} got=${x.got}`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT9-ADMIN-SET-REGION: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't9-admin-set-region', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
