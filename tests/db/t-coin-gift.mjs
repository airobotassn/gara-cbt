// T-Coin-Gift — 마이그레이션 20260807120000_coin_gift.sql 을 pglite 에 적용해
// **코인 선물의 방어선이 DB 에서 실제로 서는지** 검증한다.
//
// 코인 선물은 즉시 이체다 — 취소·회수 경로가 없다. 그래서 여기서 깨지는 것들은 전부 되돌릴 수 없다:
//   · 멱등이 안 걸리면 재시도 한 번이 두 번 보내기가 된다
//   · amount 하한이 없으면 음수 전송이 곧 '남의 코인 뺏기'다
//   · 잔액 검사가 잠금 밖에 있으면 두 창에서 동시에 보내 마이너스 잔액이 난다
//   · 원장이 cascade 로 지워지면 받은 사람이 "이 코인 왜 늘었지"에 영영 못 답한다
//
// ⚠️ pglite 는 단일 커넥션이라 **진짜 동시 실행(데드락·경합)은 재현할 수 없다.** 여기서 보는 건
//    "제약과 함수 로직이 서는가"까지고, 잠금 순서(least/greatest)의 데드락 회피는 코드 리뷰 사항이다.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const raw = readFileSync('supabase/migrations/20260807120000_coin_gift.sql', 'utf8');

const db = await PGlite.create();
await db.exec(`set timezone = 'UTC';`);

// 마이그레이션이 참조하는 선행 스키마만 실제와 같은 모양으로 세운다.
//   auth.users 를 stub 으로 진짜 만든다(다른 테스트처럼 references 를 문자열로 지우지 않는다) —
//   이 설계의 핵심 주장 중 하나가 "발신자가 탈퇴해도 원장은 남는다"(on delete set null)라서,
//   FK 를 지워버리면 정작 검증하고 싶은 동작이 사라진다.
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  create role anon;
  create role authenticated;
  create role service_role;

  create table profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text,
    referral_code text,
    deactivated_at timestamptz
  );
  create table user_currency (
    user_id uuid primary key references auth.users(id) on delete cascade,
    points bigint not null default 0,
    dust bigint not null default 0,
    updated_at timestamptz default now()
  );
`);

const U_A = '11111111-1111-1111-1111-111111111111'; // 보내는 사람
const U_B = '22222222-2222-2222-2222-222222222222'; // 받는 사람
const U_C = '33333333-3333-3333-3333-333333333333'; // 탈퇴 계정
const U_D = '44444444-4444-4444-4444-444444444444'; // 두 번째 수신자(쿨다운 회피용)

for (const [id, name, code] of [
  [U_A, '보낸이', 'CARIAAAA'],
  [U_B, '받는이', 'CARIBBBB'],
  [U_C, '탈퇴자', 'CARICCCC'],
  [U_D, '다른이', 'CARIDDDD'],
]) {
  await db.query(`insert into auth.users(id) values ($1)`, [id]);
  await db.query(`insert into profiles(id, display_name, referral_code) values ($1,$2,$3)`, [id, name, code]);
}
await db.query(`update profiles set deactivated_at = now() where id = $1`, [U_C]);
await db.query(`insert into user_currency(user_id, points) values ($1, 1000), ($2, 0)`, [U_A, U_B]);

await db.exec(raw);

const results = [];
const rec = (name, got, want, pass) => results.push({ name, got, want, pass: pass ?? (got === want) });
const failsWith = async (fn) => { try { await fn(); return null } catch (e) { return e.message || String(e) } };

const gift = (from, code, amount, nonce) =>
  db.query(`select coin_gift($1,$2,$3,$4) r`, [from, code, amount, nonce]).then((x) => x.rows[0].r);
const lookup = (from, code) =>
  db.query(`select coin_gift_lookup($1,$2) r`, [from, code]).then((x) => x.rows[0].r);
const balance = async (uid) =>
  Number((await db.query(`select points from user_currency where user_id=$1`, [uid])).rows[0].points);
const ledgerCount = async () =>
  (await db.query(`select count(*)::int c from coin_transfers`)).rows[0].c;

// --- (1) 잔액 하한 ---
// 이 CHECK 이 없으면 "차감은 됐는데 적립이 안 된" 종류의 버그가 조용히 마이너스 잔액으로 남는다.
rec('user_currency 음수 잔액 거부',
  (await failsWith(() => db.query(`update user_currency set points = -1 where user_id=$1`, [U_A]))) !== null, true);

// --- (2) 정상 이체 ---
const g1 = await gift(U_A, 'CARIBBBB', 300, 'nonce-1');
rec('이체 성공 — duplicate=false', g1.duplicate, false);
rec('이체 성공 — 수신자 이름 반환', g1.recipient_name, '받는이');
rec('보낸 사람 잔액 차감', await balance(U_A), 700);
rec('받은 사람 잔액 적립', await balance(U_B), 300);
rec('원장 1행', await ledgerCount(), 1);
const led = (await db.query(`select * from coin_transfers`)).rows[0];
rec('원장 — 발생 시점 발신 잔액 스냅샷', Number(led.sender_balance_after), 700);
rec('원장 — 발생 시점 수신 잔액 스냅샷', Number(led.recipient_balance_after), 300);
rec('원장 — 아직 미확인(seen_at null)', led.seen_at, null);

// --- (3) 멱등 — 같은 nonce 는 두 번 이체하지 않는다 ---
// 즉시 이체라 이게 뚫리면 타임아웃 후 재시도 한 번이 그대로 두 번 보내기다.
const g2 = await gift(U_A, 'CARIBBBB', 300, 'nonce-1');
rec('같은 nonce 재요청 — duplicate=true', g2.duplicate, true);
rec('같은 nonce 재요청 — 잔액 불변', await balance(U_A), 700);
rec('같은 nonce 재요청 — 원장도 그대로', await ledgerCount(), 1);
rec('같은 nonce 재요청 — 원래 결과를 그대로 반환', Number(g2.amount), 300);

// --- (4) 스팸 가드 ---
// 금액 한도는 없다(잔액이 곧 한도). 이건 돈이 아니라 **받는 사람의 알림**을 지키는 장치다.
rec('같은 사람에게 연속 전송 거부(too_fast)',
  (await failsWith(() => gift(U_A, 'CARIBBBB', 10, 'nonce-2')))?.includes('too_fast'), true);
rec('too_fast 는 잔액을 건드리지 않는다', await balance(U_A), 700);
// 다른 사람에게는 제한이 없다.
const g3 = await gift(U_A, 'CARIDDDD', 100, 'nonce-3');
rec('다른 사람에게는 즉시 전송 가능', g3.duplicate, false);
rec('두 번째 이체 후 잔액', await balance(U_A), 600);

// 쿨다운이 지나면 같은 사람에게 다시 보낼 수 있다.
await db.query(`update coin_transfers set created_at = now() - interval '1 minute'`);
const g4 = await gift(U_A, 'CARIBBBB', 100, 'nonce-4');
rec('쿨다운 경과 후 같은 사람에게 재전송 가능', g4.duplicate, false);
rec('재전송 후 수신자 잔액 누적', await balance(U_B), 400);

// --- (5) 금액 ---
// 음수를 통과시키면 `points - (-100)` 이 되어 선물하기가 남의 코인 뺏기가 된다.
rec('음수 금액 거부',
  (await failsWith(() => gift(U_A, 'CARIDDDD', -100, 'nonce-neg')))?.includes('invalid_amount'), true);
rec('0원 거부',
  (await failsWith(() => gift(U_A, 'CARIDDDD', 0, 'nonce-zero')))?.includes('invalid_amount'), true);
rec('음수 시도 후 상대 잔액 불변', await balance(U_D), 100);
rec('원장에 amount<=0 은 아예 못 들어간다',
  (await failsWith(() => db.query(
    `insert into coin_transfers(sender_id,recipient_id,amount,client_nonce,sender_balance_after,recipient_balance_after)
     values ($1,$2,0,'x',0,0)`, [U_A, U_B]))) !== null, true);

// --- (6) 잔액 부족 — 실패 시 통째로 롤백 ---
await db.query(`update coin_transfers set created_at = now() - interval '1 minute'`);
const beforeA = await balance(U_A);
const beforeB = await balance(U_B);
rec('잔액 초과 전송 거부',
  (await failsWith(() => gift(U_A, 'CARIBBBB', 999999, 'nonce-over')))?.includes('insufficient_points'), true);
rec('실패해도 보낸 사람 잔액 불변', await balance(U_A), beforeA);
rec('실패해도 받는 사람 잔액 불변', await balance(U_B), beforeB);
rec('실패는 원장에 남지 않는다', await ledgerCount(), 3);

// --- (7) 수신자 판정 ---
rec('나에게는 못 보낸다',
  (await failsWith(() => gift(U_A, 'CARIAAAA', 10, 'nonce-self')))?.includes('self_transfer'), true);
rec('없는 코드 거부',
  (await failsWith(() => gift(U_A, 'CARIZZZZ', 10, 'nonce-404')))?.includes('recipient_not_found'), true);
rec('형식이 틀린 코드 거부',
  (await failsWith(() => gift(U_A, 'nope', 10, 'nonce-bad')))?.includes('recipient_not_found'), true);
rec('탈퇴 계정에는 못 보낸다',
  (await failsWith(() => gift(U_A, 'CARICCCC', 10, 'nonce-dead')))?.includes('recipient_not_found'), true);
// 소문자·공백을 흡수해야 한다 — 사용자가 그대로 붙여넣는 값이다.
await db.query(`update coin_transfers set created_at = now() - interval '1 minute'`);
const g5 = await gift(U_A, '  caribbbb ', 10, 'nonce-lower');
rec('코드 대소문자·공백 흡수', g5.duplicate, false);

// --- (8) 조회(코드 → 닉네임) ---
// 오타 방지에 필요하지만 동시에 "이 코드가 실존하냐" 오라클이라 쿼터가 걸려 있다.
rec('조회 — 정상 코드는 닉네임 반환', (await lookup(U_A, 'CARIBBBB')).name, '받는이');
rec('조회 — 없는 코드', (await lookup(U_A, 'CARIZZZZ')).error, 'not_found');
rec('조회 — 내 코드', (await lookup(U_A, 'CARIAAAA')).error, 'self');
rec('조회 — 탈퇴 계정', (await lookup(U_A, 'CARICCCC')).error, 'not_found');
// 형식 오류는 쿼터를 소모하지 않는다(오타로 한도가 닳으면 안 된다).
const qBefore = (await db.query(`select n from coin_gift_lookup_quota where user_id=$1`, [U_A])).rows[0].n;
await lookup(U_A, 'zz');
rec('조회 — 형식 오류는 쿼터를 안 쓴다',
  (await db.query(`select n from coin_gift_lookup_quota where user_id=$1`, [U_A])).rows[0].n, qBefore);
// 30회를 넘기면 막힌다.
for (let i = 0; i < 30; i++) await lookup(U_A, 'CARIBBBB');
rec('조회 — 쿼터 초과 시 too_many', (await lookup(U_A, 'CARIBBBB')).error, 'too_many');
// 창이 지나면 리셋된다.
await db.query(`update coin_gift_lookup_quota set window_start = now() - interval '11 minutes' where user_id=$1`, [U_A]);
rec('조회 — 창이 지나면 리셋', (await lookup(U_A, 'CARIBBBB')).name, '받는이');

// --- (9) 원장은 지워지지 않는다 ---
// ⚠️ 여기가 다른 테이블과 다른 유일한 지점이다. cascade 였다면 보낸 사람이 탈퇴하는 순간
//    받은 사람의 이력이 같이 사라져 "이 코인 어디서 왔지"에 답할 수 없게 된다.
const totalBefore = await ledgerCount();
await db.query(`delete from auth.users where id=$1`, [U_A]);
rec('발신자 탈퇴 후에도 원장 행 보존', await ledgerCount(), totalBefore);
const kept = (await db.query(`select sender_id, sender_name from coin_transfers limit 1`)).rows[0];
rec('발신자 탈퇴 — sender_id 는 null 로', kept.sender_id, null);
rec('발신자 탈퇴 — 닉네임 스냅샷은 남는다', kept.sender_name, '보낸이');
// 양쪽 다 탈퇴해도 남아야 한다. self CHECK 을 `sender_id <> recipient_id` 로 썼다면
// `null <> null` 이 null 이 아니라 false 로 평가돼 여기서 ON DELETE SET NULL 자체가 실패한다.
await db.query(`delete from auth.users where id=$1`, [U_B]);
rec('양쪽 탈퇴해도 원장 보존(self CHECK 이 null 을 막지 않는다)', await ledgerCount(), totalBefore);

// --- (10) 잠금 테이블 ---
rec('coin_transfers RLS 활성화',
  (await db.query(`select relrowsecurity from pg_class where relname='coin_transfers'`)).rows[0].relrowsecurity, true);
rec('coin_transfers 정책 0개(service role 전용)',
  (await db.query(`select count(*)::int c from pg_policies where tablename='coin_transfers'`)).rows[0].c, 0);
// p_uid 를 인자로 받는 함수라 클라가 직접 부를 수 있으면 남의 지갑에서 돈을 빼낼 수 있다.
rec('coin_gift 는 authenticated 가 못 부른다',
  (await db.query(`select has_function_privilege('authenticated','coin_gift(uuid,text,int,text)','execute') p`)).rows[0].p, false);
rec('coin_gift 는 service_role 이 부른다',
  (await db.query(`select has_function_privilege('service_role','coin_gift(uuid,text,int,text)','execute') p`)).rows[0].p, true);

// --- (11) 재실행 안전 ---
rec('마이그레이션 재실행 안전', await failsWith(() => db.exec(raw)), null);

for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${JSON.stringify(x.got)} want=${JSON.stringify(x.want)})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-COIN-GIFT: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-coin-gift', pg: 'pglite', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
