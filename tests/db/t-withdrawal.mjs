// T-Withdrawal — 마이그레이션 20260825140000_withdrawal.sql 을 pglite 에 얹어 **회원탈퇴의 방어선**을 본다.
//
// 이 기능에서 실제로 사고가 나는 자리는 화면이 아니라 파기 쪽이다. 그래서 보는 것:
//  · ⭐ 파기해도 결제 원장·응시 기록이 살아 있다 (옛 purge 는 auth.users 를 지워서 CASCADE 로 같이 날렸다.
//    전자상거래법 5년 보존 + /verify 진위확인이 여기 달려 있다 — 이 테스트가 그 회귀를 막는 유일한 장치다)
//  · ⭐ 파기하면 사람을 알아볼 값이 하나도 안 남는다 (이름·아바타·국가·지역·연령대·이메일·구글 연결)
//  · ⭐ 구글 연결(auth.identities)이 끊긴다 = 같은 구글 계정으로 들어와도 이 계정에 못 닿는다
//  · 보관기간 안 계정은 건드리지 않는다 (하루라도 남았으면 대상이 아니다)
//  · ⭐ 복구가 닉네임 충돌에서 죽지 않는다 (탈퇴하면 닉네임이 남에게 풀리는 부분 유니크 인덱스)
//  · 이미 파기된 계정은 복구 불가
//  · 실행권한 — 사용자 토큰으로 파기 함수를 직접 못 부른다
//  · 옛 삭제형 purge_deactivated_accounts 가 사라졌다
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const db = await PGlite.create();

// auth 스키마는 GoTrue 소유라 마이그레이션에 없다 — 파기가 실제로 건드리는 모양만 세운다.
// payments·exam_attempts 의 FK 를 **운영과 똑같이 on delete cascade** 로 걸어두는 것이 이 테스트의 핵심이다:
// 누가 파기를 다시 '행 삭제' 로 바꾸면 여기서 원장이 사라져 바로 빨간불이 난다.
await db.exec(`
  create schema if not exists auth;
  create role anon;
  create role authenticated;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    email_change text default '',
    phone text,
    raw_user_meta_data jsonb default '{}'::jsonb,
    raw_app_meta_data jsonb default '{}'::jsonb
  );
  create table auth.identities (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    provider text not null
  );
  create table auth.sessions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade
  );

  create table profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text,
    avatar_url text,
    is_anonymous boolean default false,
    deactivated_at timestamptz,
    country_code text,
    region_code text,
    school_id uuid,
    region_locked_at timestamptz,
    nickname_set_at timestamptz,
    nickname_changed_at timestamptz,
    referral_code text,
    referred_by uuid references auth.users(id) on delete set null,
    age_band text,
    payment_customer_key text,
    suspended_until timestamptz,
    suspended_reason text,
    region_changed_at timestamptz
  );
  -- 운영과 같은 부분 유니크 — 탈퇴하면 닉네임이 남에게 풀린다(복구 충돌의 원인).
  create unique index profiles_nickname_key_uniq on profiles
    (lower(regexp_replace(display_name, '\\s+', '', 'g')))
    where nickname_set_at is not null and deactivated_at is null;

  create table payments (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    amount int not null,
    status text not null default 'paid'
  );
  create table exam_attempts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    cert_no text
  );

  -- auth.uid() 스텁 — 세션 대신 GUC 로 '지금 누구' 를 흉내낸다.
  create schema if not exists _t;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('t.uid', true), '')::uuid
  $$;
`);

// pg_cron 은 pglite 에 없다. 마이그레이션이 DO 블록 + exception 으로 감싸 두었지만 pglite 는
// `create extension` 실패를 트랜잭션 중단으로 올려서 여기서만 그 블록을 떼고 넣는다
// (t-arena-buckets 와 같은 처리 — 크론은 '언제 부르냐' 일 뿐 규칙의 의미가 아니다).
const migration = readFileSync('supabase/migrations/20260825140000_withdrawal.sql', 'utf8');
const CRON_MARK = '-- ── 4) 크론';
const body = migration.slice(0, migration.indexOf(CRON_MARK));
await db.exec(body);

const results = [];
const rec = (name, got, want, pass) => results.push({ name, got, want, pass: pass ?? (JSON.stringify(got) === JSON.stringify(want)) });
const q = (sql, args = []) => db.query(sql, args);
const one = async (sql, args = []) => (await q(sql, args)).rows[0];

const uid = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
async function addUser(n, { nick, days = null, purged = false } = {}) {
  const id = uid(n);
  await q(`insert into auth.users (id, email, raw_user_meta_data) values ($1,$2,$3)`,
    [id, `u${n}@example.com`, JSON.stringify({ full_name: '실명', picture: 'https://x/y.png' })]);
  await q(`insert into auth.identities (user_id, provider) values ($1,'google')`, [id]);
  await q(`insert into auth.sessions (user_id) values ($1)`, [id]);
  await q(
    `insert into profiles (id, display_name, avatar_url, country_code, region_code, age_band,
                           nickname_set_at, referral_code, deactivated_at, purged_at)
     values ($1,$2,'img:https://x/a.png','KR','KR-11','20s', now(), $3,
             case when $4::int is null then null else now() - make_interval(days => $4::int) end,
             case when $5 then now() else null end)`,
    [id, nick ?? `유저${n}`, `CARI${n}`, days, purged],
  );
  return id;
}

// --- (1) 파기 대상 고르기 ---
{
  await addUser(1, { nick: '아직안됨', days: 89 }); // 보관기간 안
  await addUser(2, { nick: '파기대상', days: 91 }); // 지났다
  await addUser(3, { nick: '멀쩡한사람' });          // 탈퇴 안 함

  const n = await one(`select anonymize_deactivated_accounts() as n`);
  rec('보관기간 지난 1명만 파기', n.n, 1);
  rec('89일차는 안 건드린다', (await one(`select display_name from profiles where id=$1`, [uid(1)])).display_name, '아직안됨');
  rec('탈퇴 안 한 사람은 안 건드린다', (await one(`select display_name from profiles where id=$1`, [uid(3)])).display_name, '멀쩡한사람');
  rec('두 번 돌려도 이미 파기한 건 다시 안 센다', (await one(`select anonymize_deactivated_accounts() as n`)).n, 0);
}

// --- (2) ⭐ 파기해도 결제·응시 기록이 남는다 (옛 purge 가 CASCADE 로 날리던 자리) ---
{
  const id = await addUser(10, { nick: '결제한사람', days: 100 });
  await q(`insert into payments (user_id, amount) values ($1, 3000)`, [id]);
  await q(`insert into exam_attempts (user_id, cert_no) values ($1, 'CARIS-2026-0001')`, [id]);

  await q(`select anonymize_deactivated_accounts()`);

  rec('⭐ 결제 원장 보존(전자상거래법 5년)', (await one(`select count(*)::int n from payments where user_id=$1`, [id])).n, 1);
  rec('⭐ 응시·자격증 기록 보존(/verify 진위확인)', (await one(`select cert_no from exam_attempts where user_id=$1`, [id])).cert_no, 'CARIS-2026-0001');
  rec('auth.users 행 자체는 남는다(FK 대상)', (await one(`select count(*)::int n from auth.users where id=$1`, [id])).n, 1);
}

// --- (3) ⭐ 파기하면 사람을 알아볼 값이 하나도 안 남는다 ---
{
  const id = uid(10);
  const p = await one(`select * from profiles where id=$1`, [id]);
  rec('이름 지움', p.display_name, null);
  rec('아바타 지움', p.avatar_url, null);
  rec('국가 지움', p.country_code, null);
  rec('지역 지움', p.region_code, null);
  rec('연령대 지움', p.age_band, null);
  rec('닉네임 확정 표식 지움', p.nickname_set_at, null);
  rec('추천인 코드 풀어줌', p.referral_code, null);
  rec('파기 시각 기록', p.purged_at != null, true);
  rec('탈퇴 시각은 남긴다(랭킹 제외·분쟁 대응)', p.deactivated_at != null, true);

  const u = await one(`select email, raw_user_meta_data from auth.users where id=$1`, [id]);
  rec('이메일 되돌릴 수 없게 덮음', u.email, `deleted-${id}@invalid`);
  rec('구글 실명·사진 든 메타 비움', u.raw_user_meta_data, {});
  rec('⭐ 구글 연결 끊김(다시 로그인해도 이 계정에 못 닿는다)',
    (await one(`select count(*)::int n from auth.identities where user_id=$1`, [id])).n, 0);
  rec('살아있던 세션도 끊김', (await one(`select count(*)::int n from auth.sessions where user_id=$1`, [id])).n, 0);
}

// --- (4) 복구 ---
{
  const id = await addUser(20, { nick: '돌아온사람', days: 3 });
  await q(`select set_config('t.uid', $1, false)`, [id]);
  const r = await one(`select restore_account() as r`);
  rec('복구 성공', r.r.ok, true);
  rec('닉네임은 그대로', r.r.nicknameReset, false);
  rec('탈퇴 플래그 해제', (await one(`select deactivated_at from profiles where id=$1`, [id])).deactivated_at, null);
  rec('이름 보존', (await one(`select display_name from profiles where id=$1`, [id])).display_name, '돌아온사람');

  // 이미 정상인 계정이 또 불러도 조용히 성공한다(더블클릭·새로고침).
  rec('멱등', (await one(`select restore_account() as r`)).r.ok, true);
}

// --- (5) ⭐ 탈퇴한 사이 남이 닉네임을 가져간 경우 ---
// 부분 유니크 인덱스가 `deactivated_at is null` 이라, 탈퇴하는 순간 그 닉네임이 풀린다.
// 그대로 되돌리면 23505 로 복구가 통째로 실패한다 → 닉네임만 놓아주고 계정은 살려야 한다.
{
  const gone = await addUser(30, { nick: '인기닉', days: 5 });
  await addUser(31, { nick: '인기닉' }); // 탈퇴한 사이 남이 같은 닉네임을 씀

  await q(`select set_config('t.uid', $1, false)`, [gone]);
  const r = await one(`select restore_account() as r`);
  rec('⭐ 닉네임이 겹쳐도 계정은 살아난다', r.r.ok, true);
  rec('⭐ 닉네임만 놓아준다', r.r.nicknameReset, true);
  rec('탈퇴 플래그 해제됨', (await one(`select deactivated_at from profiles where id=$1`, [gone])).deactivated_at, null);
  rec('닉네임 게이트가 다시 뜨도록 확정 표식 비움',
    (await one(`select nickname_set_at from profiles where id=$1`, [gone])).nickname_set_at, null);
  rec('먼저 쓴 사람 것은 그대로', (await one(`select display_name from profiles where id=$1`, [uid(31)])).display_name, '인기닉');
}

// --- (6) 이미 파기된 계정은 복구 불가 ---
{
  await q(`select set_config('t.uid', $1, false)`, [uid(10)]); // (2)(3) 에서 파기된 사람
  let msg = '';
  try { await q(`select restore_account()`); } catch (e) { msg = String(e.message ?? e); }
  rec('파기된 계정 복구 거절', /purged/.test(msg), true);

  let amsg = '';
  try { await q(`select admin_restore_account($1)`, [uid(10)]); } catch (e) { amsg = String(e.message ?? e); }
  rec('관리자 복구도 같은 판정', /purged/.test(amsg), true);
}

// --- (7) 관리자 복구는 남의 계정을 되돌린다 ---
{
  const id = await addUser(40, { nick: '관리자가살림', days: 10 });
  await q(`select set_config('t.uid', '', false)`); // 세션 없음 — 관리자 경로는 auth.uid() 를 안 본다
  const r = await one(`select admin_restore_account($1) as r`, [id]);
  rec('관리자 복구 성공', r.r.ok, true);
  rec('탈퇴 플래그 해제', (await one(`select deactivated_at from profiles where id=$1`, [id])).deactivated_at, null);
}

// --- (8) 실행권한 ---
{
  const can = async (role, sig) => (await one(`select has_function_privilege($1, $2, 'execute') as ok`, [role, sig])).ok;
  rec('사용자 복구는 authenticated 가 부른다', await can('authenticated', 'public.restore_account()'), true);
  rec('anon 은 복구도 못 부른다', await can('anon', 'public.restore_account()'), false);
  rec('⭐ 파기 함수는 authenticated 가 못 부른다',
    await can('authenticated', 'public.anonymize_deactivated_accounts(int)'), false);
  rec('⭐ 관리자 복구도 authenticated 가 못 부른다',
    await can('authenticated', 'public.admin_restore_account(uuid)'), false);
}

// --- (9) 옛 삭제형 purge 가 사라졌다 ---
{
  const n = await one(`select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
                       where ns.nspname='public' and p.proname='purge_deactivated_accounts'`);
  rec('⭐ 삭제형 purge 제거됨(켜면 결제 원장이 날아간다)', n.n, 0);
}

// --- (10) 재실행 안전 ---
{
  let ok = true;
  try { await db.exec(body); } catch { ok = false; }
  rec('마이그레이션 재실행 안전', ok, true);
  rec('재실행해도 데이터 보존', (await one(`select count(*)::int n from profiles`)).n > 0, true);
}

for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${JSON.stringify(x.got)} want=${JSON.stringify(x.want)})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-WITHDRAWAL: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-withdrawal', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
