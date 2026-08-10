// T-Payments — 마이그레이션 20260806170000_payments.sql 을 pglite 에 적용해 **결제 원장의 방어선**을 검증한다.
//
// 여기서 보는 건 "코드가 잘 짜였나"가 아니라 **코드가 실수해도 DB 가 막아주나**다.
// 결제에서 복구 불가능한 사고는 하나뿐 — 어긋난 걸 모르는 상태 — 이고, 아래 제약들이 그걸 없앤다.
//  · 같은 사람이 같은 상품을 두 번 '결제 완료'로 가질 수 없다 (부분 유니크 인덱스)
//  · 같은 상품의 승인이 동시에 두 건 PG 로 나갈 수 없다 (선점 상태 'confirming' + 부분 유니크)
//  · 환불된 뒤에는 다시 살 수 있다 (부분 인덱스라 refunded 는 대상에서 빠진다)
//  · 0원/음수 금액 행이 원장에 못 들어온다
//  · status 는 정해진 값만 (오타 상태가 조용히 저장되면 대사가 그 행을 영영 못 본다)
//  · payments 는 RLS 켜고 정책 0개 = service role(엣지 함수) 전용
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const raw = readFileSync('supabase/migrations/20260806170000_payments.sql', 'utf8');
// 자격증 발급비(cert) — product_type 을 넓히는 후속 마이그레이션. 같이 적용해야 원장이 실제 운영과 같은 모양이 된다.
const rawCert = readFileSync('supabase/migrations/20260807130000_payments_cert.sql', 'utf8');
// 승인 선점(confirming) — 같은 상품의 동시 승인이 둘 다 PG 로 나가는 걸 막는 후속 마이그레이션.
const rawClaim = readFileSync('supabase/migrations/20260810180000_payments_confirming.sql', 'utf8');

// pglite 엔 auth 스키마가 없다 — FK 만 떼고 나머지 DDL 은 원본 그대로 적용한다.
const strip = (sql) => sql.replace(/\s+references auth\.users\(id\)(\s+on delete cascade)?/g, '');

const db = await PGlite.create();

// 마이그레이션이 alter 하는 선행 테이블만 최소 형태로 세운다(실제 스키마의 해당 부분과 같은 모양).
await db.exec(`
  create table profiles (id uuid primary key);
  create table ebooks (id uuid primary key default gen_random_uuid());
  create table ebook_purchases (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    ebook_id uuid not null,
    price_paid integer not null default 0,
    source text not null default 'demo',
    payment_ref text,
    created_at timestamptz not null default now(),
    unique (user_id, ebook_id)
  );
`);
await db.exec(strip(raw));
await db.exec(strip(rawCert));
await db.exec(strip(rawClaim));

const results = [];
const rec = (name, got, want, pass) => results.push({ name, got, want, pass: pass ?? (got === want) });

const U1 = '00000000-0000-0000-0000-0000000000a1';
const U2 = '00000000-0000-0000-0000-0000000000a2';
const BOOK = '00000000-0000-0000-0000-0000000000b1';

let seq = 0;
const insertPayment = (userId, { status = 'pending', amount = 3000, ref = BOOK, orderId = null } = {}) =>
  db.query(
    `insert into payments (user_id, order_id, order_name, product_type, product_ref, amount, status, customer_key)
     values ($1, $2, '테스트 교재', 'ebook', $3, $4, $5, 'cus-test') returning id`,
    [userId, orderId ?? `ebook-order-${++seq}`, ref, amount, status],
  );

const failsWith = async (fn) => {
  try { await fn(); return null; } catch (e) { return e.message || String(e); }
};

// --- (1) 테이블·컬럼 ---
const cols = (await db.query(
  `select column_name from information_schema.columns where table_schema='public' and table_name='payments'`,
)).rows.map((r) => r.column_name);
rec('payments 테이블 생성됨', cols.length > 0, true);
for (const c of ['provider', 'order_id', 'product_type', 'product_ref', 'amount', 'currency', 'status', 'payment_key', 'customer_key', 'fulfilled_at', 'confirmed_at', 'raw']) {
  rec(`payments.${c} 존재`, cols.includes(c), true);
}
// provider 컬럼은 해외 PG 를 나중에 얹을 때 테이블을 안 갈아엎으려고 처음부터 둔 것
const providerDefault = (await db.query(
  `select column_default from information_schema.columns where table_name='payments' and column_name='provider'`,
)).rows[0].column_default;
rec("provider 기본값 'toss'", /'toss'/.test(providerDefault ?? ''), true);

// --- (2) 금액 가드 — 0원/음수는 원장에 못 들어온다 ---
rec('amount = 0 거부', (await failsWith(() => insertPayment(U1, { amount: 0 }))) !== null, true);
rec('amount < 0 거부', (await failsWith(() => insertPayment(U1, { amount: -100 }))) !== null, true);

// --- (3) status 는 정해진 값만 ---
rec('알 수 없는 status 거부', (await failsWith(() => insertPayment(U1, { status: 'weird' }))) !== null, true);
for (const s of ['pending', 'waiting_deposit', 'paid', 'canceled', 'refunded', 'failed', 'expired']) {
  const err = await failsWith(() => insertPayment(U2, { status: s, ref: `ref-${s}` }));
  rec(`status '${s}' 허용`, err, null);
}

// --- (3-b) product_type 은 세 가지만 ---
// cert(자격증 발급비)는 지급물이 없어 "결제 행 자체가 발급 게이트"다 — 오타 타입이 저장되면
// my-attempts 의 게이트 조회가 조용히 빗나가 발급비를 낸 사람이 발급을 못 받는다.
const insertTyped = (type, ref) =>
  db.query(
    `insert into payments (user_id, order_id, order_name, product_type, product_ref, amount, status, customer_key)
     values ($1, $2, '테스트', $3, $4, 3000, 'pending', 'cus-test') returning id`,
    [U2, `type-order-${++seq}`, type, ref],
  );
for (const ty of ['ebook', 'exam', 'cert']) {
  rec(`product_type '${ty}' 허용`, await failsWith(() => insertTyped(ty, `tref-${ty}`)), null);
}
rec('알 수 없는 product_type 거부', (await failsWith(() => insertTyped('lecture', 'tref-x'))) !== null, true);
// 같은 응시(product_ref)에 발급비를 두 번 낼 수 없다 — cert 도 기존 부분 유니크가 그대로 막는다.
const ATT = '00000000-0000-0000-0000-0000000000c1';
await db.query(
  `insert into payments (user_id, order_id, order_name, product_type, product_ref, amount, status, customer_key)
   values ($1, 'cert-order-1', '자격증 발급', 'cert', $2, 3000, 'paid', 'cus-test')`,
  [U1, ATT],
);
const dupCert = await failsWith(() =>
  db.query(
    `insert into payments (user_id, order_id, order_name, product_type, product_ref, amount, status, customer_key)
     values ($1, 'cert-order-2', '자격증 발급', 'cert', $2, 3000, 'paid', 'cus-test')`,
    [U1, ATT],
  ),
);
rec('⭐ 같은 응시의 발급비 이중 결제 거부', dupCert !== null, true);

// --- (4) order_id 유니크 ---
await insertPayment(U1, { orderId: 'ebook-dup-order' });
rec('order_id 중복 거부', (await failsWith(() => insertPayment(U1, { orderId: 'ebook-dup-order' }))) !== null, true);

// --- (5) ⭐ 중복 지급 방어의 본체 — 같은 사람+같은 상품의 'paid' 는 하나뿐 ---
await insertPayment(U1, { status: 'paid' });
const dupPaid = await failsWith(() => insertPayment(U1, { status: 'paid' }));
rec('같은 상품 두 번째 paid 거부', dupPaid !== null && /unique|중복/i.test(dupPaid), true);

// 부분 인덱스라 미완결 주문은 여러 개 만들 수 있어야 한다(사용자가 결제창을 닫고 다시 시도하는 경우).
const pend1 = await failsWith(() => insertPayment(U2, { status: 'pending', ref: 'ref-retry' }));
const pend2 = await failsWith(() => insertPayment(U2, { status: 'pending', ref: 'ref-retry' }));
rec('같은 상품 pending 은 여러 개 허용(재시도)', pend1 === null && pend2 === null, true);

// 다른 사람은 같은 상품을 당연히 살 수 있다
rec('다른 사용자의 paid 는 허용', (await failsWith(() => insertPayment(U2, { status: 'paid' }))), null);

// --- (6) 환불되면 다시 살 수 있다 ---
await db.exec(`update payments set status='refunded' where user_id='${U1}' and status='paid'`);
rec('환불 후 재구매 허용', (await failsWith(() => insertPayment(U1, { status: 'paid' }))), null);

// --- (7) customerKey 는 계정당 하나(고정) ---
await db.exec(`insert into profiles (id) values ('${U1}'), ('${U2}')`);
rec('profiles.payment_customer_key 컬럼 추가됨',
  (await db.query(`select 1 from information_schema.columns where table_name='profiles' and column_name='payment_customer_key'`)).rows.length, 1);
await db.exec(`update profiles set payment_customer_key='cus-aaa' where id='${U1}'`);
const dupCus = await failsWith(() => db.exec(`update profiles set payment_customer_key='cus-aaa' where id='${U2}'`));
rec('customer_key 중복 거부', dupCus !== null, true);
// null 은 여럿 허용돼야 한다(아직 결제 안 해본 회원들)
await db.exec(`insert into profiles (id) values ('00000000-0000-0000-0000-0000000000a3'), ('00000000-0000-0000-0000-0000000000a4')`);
rec('payment_customer_key null 은 여러 행 허용',
  (await db.query(`select count(*)::int c from profiles where payment_customer_key is null`)).rows[0].c >= 2, true);

// --- (8) 이북 구매 ↔ 결제 연결 ---
rec('ebook_purchases.payment_id 컬럼 추가됨',
  (await db.query(`select 1 from information_schema.columns where table_name='ebook_purchases' and column_name='payment_id'`)).rows.length, 1);

// --- (9) 잠금 테이블 — RLS 켜고 정책 0개 = service role 전용 ---
const rls = (await db.query(`select relrowsecurity from pg_class where relname='payments'`)).rows[0];
rec('payments RLS 활성화', rls?.relrowsecurity, true);
const pol = (await db.query(`select count(*)::int c from pg_policies where tablename='payments'`)).rows[0].c;
rec('payments 정책 0개(클라 직접 접근 불가)', pol, 0);

// --- (10) 대사(sweep) 대상 인덱스 — 없으면 미완결 결제 훑기가 풀스캔이 된다 ---
const idxDefs = (await db.query(`select indexname, indexdef from pg_indexes where tablename='payments'`)).rows;
const names = idxDefs.map((r) => r.indexname);
rec('미완결(pending/waiting_deposit) 부분 인덱스 존재', names.includes('payments_unsettled_idx'), true);
rec('미지급(paid & fulfilled_at is null) 부분 인덱스 존재', names.includes('payments_unfulfilled_idx'), true);
rec('paid 상품 부분 유니크 인덱스 존재', names.includes('payments_paid_product_uniq'), true);
const paidUniq = idxDefs.find((r) => r.indexname === 'payments_paid_product_uniq')?.indexdef ?? '';
rec("paid 유니크가 (user_id, product_type, product_ref) where status='paid'",
  /user_id, product_type, product_ref/.test(paidUniq) && /status = 'paid'/.test(paidUniq), true);

// --- (10-b) 승인 선점(confirming) — **돈이 두 번 빠지는 것**을 DB 가 막는 자리 ---
//   주문은 pending 으로 생기고 중복 유니크는 paid 에만 걸린다. 그래서 결제창을 두 개 띄우고 동시에
//   승인하면 두 요청이 나란히 "완료된 결제 없음"을 보고 통과해 토스가 두 건 다 승인한다.
//   payments/index.ts 는 PG 를 부르기 직전에 주문을 'confirming' 으로 선점하고, 아래 유니크가
//   (사람 × 상품) 단위로 그 선점을 하나로 제한한다 — 진 쪽은 결제가 아예 시작되지 않는다.
{
  rec("confirming 이 status 허용값에 있음", (await db.query(
    `select 1 c from pg_constraint where conname='payments_status_check'
      and pg_get_constraintdef(oid) like '%confirming%'`)).rows.length, 1);
  rec('선점 부분 유니크 인덱스 존재', names.includes('payments_confirming_product_uniq'), true);
  const claimUniq = idxDefs.find((r) => r.indexname === 'payments_confirming_product_uniq')?.indexdef ?? '';
  rec("선점 유니크가 (user_id, product_type, product_ref) where status='confirming'",
    /user_id, product_type, product_ref/.test(claimUniq) && /status = 'confirming'/.test(claimUniq), true);

  const CLAIM = '00000000-0000-0000-0000-0000000c0001';
  await insertPayment(U2, { status: 'pending', ref: CLAIM, orderId: 'claim-a' });
  await insertPayment(U2, { status: 'pending', ref: CLAIM, orderId: 'claim-b' });
  const idA = (await db.query(`select id from payments where order_id='claim-a'`)).rows[0].id;
  const idB = (await db.query(`select id from payments where order_id='claim-b'`)).rows[0].id;

  // 첫 승인이 선점한다 — 여기까지는 두 주문 다 pending 이라 코드 검사로는 구분이 안 된다.
  await db.query(`update payments set status='confirming' where id=$1 and status='pending'`, [idA]);
  rec('첫 승인 선점 성공', (await db.query(`select status from payments where id=$1`, [idA])).rows[0].status, 'confirming');

  // 두 번째가 같은 상품을 선점하려 한다 → DB 가 막는다(= PG 를 부르기 전에 끊긴다).
  let blocked = false;
  try {
    await db.query(`update payments set status='confirming' where id=$1 and status='pending'`, [idB]);
  } catch (e) {
    blocked = /unique|중복|duplicate/i.test(String(e?.message ?? ''));
  }
  rec('⭐ 같은 상품 동시 승인 선점이 막힘(돈이 두 번 안 빠진다)', blocked, true);

  // 실패로 접으면 잠금이 풀려야 한다 — 안 그러면 그 상품은 영영 다시 결제할 수 없다.
  await db.query(`update payments set status='failed' where id=$1 and status in ('pending','confirming')`, [idA]);
  await db.query(`update payments set status='confirming' where id=$1 and status='pending'`, [idB]);
  rec('선점 해제 후 다음 주문이 선점 가능', (await db.query(`select status from payments where id=$1`, [idB])).rows[0].status, 'confirming');

  // 선점된 채로 완료되는 정상 경로: confirming → paid 는 paid 유니크만 보면 된다.
  await db.query(`update payments set status='paid' where id=$1`, [idB]);
  rec('선점 후 승인 완료(confirming → paid)', (await db.query(`select status from payments where id=$1`, [idB])).rows[0].status, 'paid');
}

// --- (11) 환불 자동 회수 — **결제 링크(payment_id)로 특정한 것 하나만** 지워지는가 ---
//     settleFromProvider→revokeForRefund 이 실제로 쓰는 삭제문의 타깃팅을 SQL 수준에서 검증한다.
//     제일 무서운 건 "환불 한 건 회수하다 남의 구매까지 지우는 것" → 그게 안 되는지 본다.
{
  const bookX = '00000000-0000-0000-0000-0000000b0011', bookY = '00000000-0000-0000-0000-0000000b0022';
  await db.query(`insert into payments (user_id, order_id, order_name, product_type, product_ref, amount, status, customer_key)
    values ($1,'rev-x','x','ebook',$2,3000,'refunded','k'), ($1,'rev-y','y','ebook',$3,3000,'paid','k')`,
    [U1, bookX, bookY]);
  const idX = (await db.query(`select id from payments where order_id='rev-x'`)).rows[0].id;
  const idY = (await db.query(`select id from payments where order_id='rev-y'`)).rows[0].id;
  // 같은 유저가 두 책을 각각 다른 결제로 샀다. payX 만 환불됐다.
  await db.query(`insert into ebook_purchases (user_id, ebook_id, payment_id, source) values ($1,$2,$3,'pg'),($1,$4,$5,'pg')`,
    [U1, bookX, idX, bookY, idY]);
  // revokeForRefund 의 이북 삭제문 그대로: payment_id + user_id 로만.
  await db.query(`delete from ebook_purchases where payment_id=$1 and user_id=$2`, [idX, U1]);
  rec('환불건 이북만 회수됨(payX 삭제)', (await db.query(`select count(*)::int c from ebook_purchases where payment_id=$1`, [idX])).rows[0].c, 0);
  rec('⭐ 다른 결제의 이북은 무사(payY 유지)', (await db.query(`select count(*)::int c from ebook_purchases where payment_id=$1`, [idY])).rows[0].c, 1);
}

for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${JSON.stringify(x.got)} want=${JSON.stringify(x.want)})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-PAYMENTS: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-payments', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
