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
// 응시료에 교재를 함께 담는 곁다리(addon) — 응시료 결제에만 붙고, 금액 없이는 못 붙는다.
const rawAddon = readFileSync('supabase/migrations/20260814110000_payment_addon_ebook.sql', 'utf8');
// 묶음 결제(bundle) — 이북 여러 권을 한 번에. 줄 목록은 payment_items 에 남는다.
const rawBundle = readFileSync('supabase/migrations/20260819120000_payments_bundle.sql', 'utf8');
// 강의 유료화(2026-08-25) — product_type 에 'lecture' 를 더하고 lecture_purchases 를 만든다.
//   묶음 줄에도 강의가 담긴다(교재 묶음 / 강의 묶음. 응시권은 여전히 못 담는다).
const rawLecture = readFileSync('supabase/migrations/20260825180000_lecture_purchases.sql', 'utf8');

// pglite 엔 auth 스키마가 없다 — FK 만 떼고 나머지 DDL 은 원본 그대로 적용한다.
const strip = (sql) => sql.replace(/\s+references auth\.users\(id\)(\s+on delete cascade)?/g, '');

const db = await PGlite.create();

// 마이그레이션이 alter 하는 선행 테이블만 최소 형태로 세운다(실제 스키마의 해당 부분과 같은 모양).
await db.exec(`
  create table profiles (id uuid primary key);
  create table ebooks (id uuid primary key default gen_random_uuid());
  create table lectures (id uuid primary key default gen_random_uuid());
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
await db.exec(strip(rawAddon));
await db.exec(strip(rawBundle));
await db.exec(strip(rawLecture));

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

// --- (3-b) product_type 은 정해진 다섯 가지만 ---
// cert(자격증 발급비)는 지급물이 없어 "결제 행 자체가 발급 게이트"다 — 오타 타입이 저장되면
// my-attempts 의 게이트 조회가 조용히 빗나가 발급비를 낸 사람이 발급을 못 받는다.
// ⚠️ 'lecture' 는 2026-08-25 에 들어왔다(강의 유료화). 그전엔 이 목록에 없어서 거부 대상이었다.
const insertTyped = (type, ref) =>
  db.query(
    `insert into payments (user_id, order_id, order_name, product_type, product_ref, amount, status, customer_key)
     values ($1, $2, '테스트', $3, $4, 3000, 'pending', 'cus-test') returning id`,
    [U2, `type-order-${++seq}`, type, ref],
  );
for (const ty of ['ebook', 'exam', 'cert', 'lecture']) {
  rec(`product_type '${ty}' 허용`, await failsWith(() => insertTyped(ty, `tref-${ty}`)), null);
}
rec('알 수 없는 product_type 거부', (await failsWith(() => insertTyped('course', 'tref-x'))) !== null, true);
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

// --- (12) 응시료에 함께 담는 교재(addon) ---
//     한 결제로 응시권 + 교재가 같이 나간다. 여기서 보는 건 "원장이 무엇을 팔았는지 잊지 않는가"다.
//     ⭐ 제일 중요한 건 **곁다리를 달아도 응시권 중복결제 방어가 그대로**라는 것 —
//        그래서 product_type/product_ref 를 건드리지 않는 설계를 골랐다(번들 상품 유형 X).
{
  const ADDON_BOOK = '00000000-0000-0000-0000-0000000b0033';
  await db.query(`insert into ebooks (id) values ($1)`, [ADDON_BOOK]);
  const EXAM_REF = '00000000-0000-0000-0000-0000000e0001:beginner';

  const cols = (await db.query(
    `select column_name from information_schema.columns where table_name='payments'
      and column_name in ('addon_ebook_id','addon_amount')`)).rows.map((r) => r.column_name).sort();
  rec('addon 컬럼 둘 다 추가됨', cols.join(','), 'addon_amount,addon_ebook_id');

  // 정상: 응시료 결제에 교재 한 권.
  await db.query(
    `insert into payments (user_id, order_id, order_name, product_type, product_ref, amount, status, customer_key, addon_ebook_id, addon_amount)
     values ($1,'addon-ok','시험+교재','exam',$2,200,'paid','k',$3,100)`, [U1, EXAM_REF, ADDON_BOOK]);
  const okRow = (await db.query(`select amount, addon_amount from payments where order_id='addon-ok'`)).rows[0];
  rec('합계는 amount, 책값은 addon_amount 에 따로 남는다', `${okRow.amount}/${okRow.addon_amount}`, '200/100');

  // ⭐ 곁다리를 달아도 같은 (사람×회차×급수)를 또 결제할 수 없다 — 응시권 이중결제 방어가 그대로다.
  let dupBlocked = false;
  try {
    await db.query(
      `insert into payments (user_id, order_id, order_name, product_type, product_ref, amount, status, customer_key)
       values ($1,'addon-dup','시험만','exam',$2,100,'paid','k')`, [U1, EXAM_REF]);
  } catch (e) { dupBlocked = /unique|duplicate/i.test(String(e?.message ?? '')); }
  rec('⭐ 교재를 담아 산 급수는 응시료만으로도 다시 못 산다(중복결제 방어 유지)', dupBlocked, true);

  // 이북 결제에 또 이북을 다는 모양은 없다 — 그건 그냥 두 건이다.
  let wrongType = false;
  try {
    await db.query(
      `insert into payments (user_id, order_id, order_name, product_type, product_ref, amount, status, customer_key, addon_ebook_id, addon_amount)
       values ($1,'addon-ebook','책+책','ebook',$2,200,'pending','k',$3,100)`, [U2, BOOK, ADDON_BOOK]);
  } catch (e) { wrongType = /payments_addon_exam_only|check/i.test(String(e?.message ?? '')); }
  rec('이북 결제에는 교재를 곁들일 수 없음', wrongType, true);

  // 금액 없이 책만 달면 원장이 "얼마짜리였는지"를 영영 모른다 → 막는다.
  let noAmount = false;
  try {
    await db.query(
      `insert into payments (user_id, order_id, order_name, product_type, product_ref, amount, status, customer_key, addon_ebook_id)
       values ($1,'addon-noamt','시험+교재','exam',$2,200,'pending','k',$3)`,
      [U2, '00000000-0000-0000-0000-0000000e0002:pro', ADDON_BOOK]);
  } catch (e) { noAmount = /payments_addon_exam_only|check/i.test(String(e?.message ?? '')); }
  rec('금액 없이 교재만 다는 행은 거부', noAmount, true);

  // 관리자가 책을 지워도 **결제 원장은 남는다**(on delete set null). 무엇을 팔았는지는 order_name 이 증언한다.
  await db.query(`delete from ebooks where id=$1`, [ADDON_BOOK]);
  const after = (await db.query(`select addon_ebook_id, order_name from payments where order_id='addon-ok'`)).rows[0];
  rec('⭐ 책을 지워도 결제 행은 살아있다', after?.order_name, '시험+교재');
  rec('지워진 책 참조는 null 로 끊긴다', after?.addon_ebook_id, null);
}

// --- (13) 묶음 결제(bundle) — 줄 목록 payment_items ---
//     보는 것: 새 상품 유형이 열렸나 · 줄이 결제에 매달려 있나(cascade) · 한 주문에 같은 책 두 줄이 안 되나
//              · **응시권은 줄로 못 들어가나**(이게 제일 중요하다 — 들어가면 응시권 이중결제 방어가 새 나간다)
{
  const B1 = '00000000-0000-0000-0000-0000000b0001';
  const B2 = '00000000-0000-0000-0000-0000000b0002';
  await db.query(`insert into ebooks (id) values ($1),($2)`, [B1, B2]);

  const BUNDLE_REF = `ebook:leveltest:${[B1, B2].sort().join('+')}`;
  const pid = (await db.query(
    `insert into payments (user_id, order_id, order_name, product_type, product_ref, amount, status, customer_key)
     values ($1,'bundle-ok','교재 외 1권','bundle',$2,180,'paid','k') returning id`, [U1, BUNDLE_REF])).rows[0].id;
  rec('product_type 에 bundle 이 허용됨', typeof pid, 'string');

  // 정가 합 200, 실제 청구 180 → 할인 20 이 원장에서 되짚인다.
  await db.query(
    `insert into payment_items (payment_id, product_type, product_ref, list_amount, amount)
     values ($1,'ebook',$2,100,90),($1,'ebook',$3,100,90)`, [pid, B1, B2]);
  const sums = (await db.query(
    `select sum(list_amount)::int as list, sum(amount)::int as amt from payment_items where payment_id=$1`, [pid])).rows[0];
  rec('줄 합계 = 정가 200 / 청구 180', `${sums.list}/${sums.amt}`, '200/180');
  const head = (await db.query(`select amount from payments where id=$1`, [pid])).rows[0];
  rec('⭐ 줄 배분액의 합 = payments.amount', sums.amt, head.amount);

  // 같은 주문에 같은 책이 두 줄로 들어오지 않는다(프론트가 중복을 보내도 여기서 걸린다).
  let dupLine = false;
  try {
    await db.query(
      `insert into payment_items (payment_id, product_type, product_ref, list_amount, amount)
       values ($1,'ebook',$2,100,90)`, [pid, B1]);
  } catch (e) { dupLine = /duplicate key|payment_items_pkey/i.test(String(e?.message ?? '')); }
  rec('한 주문에 같은 책 두 줄은 거부', dupLine, true);

  // ⭐ 응시권을 줄로 담을 수 없다 — 담기면 같은 (회차×급수)를 exam 으로 한 번 + bundle 로 한 번 결제할 수 있다.
  let examLine = false;
  try {
    await db.query(
      `insert into payment_items (payment_id, product_type, product_ref, list_amount, amount)
       values ($1,'exam','round:pro',100,100)`, [pid]);
  } catch (e) { examLine = /check|payment_items_product_type_check/i.test(String(e?.message ?? '')); }
  rec('⭐ 묶음 줄에 응시권은 못 들어감', examLine, true);

  // 음수 금액 줄은 원장에 못 들어온다(합계가 조용히 줄어드는 길을 막는다).
  let neg = false;
  try {
    await db.query(
      `insert into payment_items (payment_id, product_type, product_ref, list_amount, amount)
       values ($1,'ebook',$2,100,-10)`, [pid, '00000000-0000-0000-0000-0000000b0003']);
  } catch (e) { neg = /check/i.test(String(e?.message ?? '')); }
  rec('음수 배분액은 거부', neg, true);

  // 같은 조합을 또 결제할 수 없다(paid 부분 유니크). 다른 조합은 열려 있어야 한다.
  let sameSet = false;
  try {
    await db.query(
      `insert into payments (user_id, order_id, order_name, product_type, product_ref, amount, status, customer_key)
       values ($1,'bundle-dup','같은 묶음','bundle',$2,180,'paid','k')`, [U1, BUNDLE_REF]);
  } catch (e) { sameSet = /duplicate key|payments_paid_product_uniq/i.test(String(e?.message ?? '')); }
  rec('같은 묶음 조합 재결제는 거부', sameSet, true);
  await db.query(
    `insert into payments (user_id, order_id, order_name, product_type, product_ref, amount, status, customer_key)
     values ($1,'bundle-other','다른 묶음','bundle',$2,90,'paid','k')`, [U1, `ebook:leveltest:${B1}+zzz`]);
  const other = (await db.query(`select count(*)::int as n from payments where order_id='bundle-other'`)).rows[0];
  rec('⭐ 다른 조합은 그대로 살 수 있다', other.n, 1);

  // 결제를 지우면 줄도 같이 사라진다 — 줄만 남으면 어느 주문 것인지 모르는 고아가 된다.
  await db.query(`delete from payments where id=$1`, [pid]);
  const left = (await db.query(`select count(*)::int as n from payment_items where payment_id=$1`, [pid])).rows[0];
  rec('결제를 지우면 줄도 따라 지워진다(cascade)', left.n, 0);

  // payment_items 도 payments 와 같은 취급 — RLS 켜고 정책 0개(= service role 전용).
  const rls = (await db.query(
    `select relrowsecurity from pg_class where relname='payment_items'`)).rows[0];
  rec('payment_items RLS 켜짐', rls?.relrowsecurity, true);
  const pol = (await db.query(
    `select count(*)::int as n from pg_policies where tablename='payment_items'`)).rows[0];
  rec('payment_items 정책 0개(서비스롤 전용)', pol.n, 0);
}

// --- (14) 강의 유료화(2026-08-25) — lecture_purchases · 강의 묶음 ---
//     보는 것: 강의 시청권이 이북 열람권과 **같은 방어선**을 갖는가.
//     ⛔ 여기서 제일 중요한 건 '같은 강의를 두 번 못 산다'(unique)와 '응시권은 여전히 묶음에 못 담긴다'다.
{
  const L1 = '00000000-0000-0000-0000-0000000c0001';
  const L2 = '00000000-0000-0000-0000-0000000c0002';
  await db.query(`insert into lectures (id) values ($1),($2)`, [L1, L2]);

  // 단품 강의 결제 — 이북과 같은 부분 유니크가 그대로 적용된다.
  await db.query(
    `insert into payments (user_id, order_id, order_name, product_type, product_ref, amount, status, customer_key)
     values ($1,'lec-1','강의','lecture',$2,300,'paid','k')`, [U1, L1]);
  let dupLec = false;
  try {
    await db.query(
      `insert into payments (user_id, order_id, order_name, product_type, product_ref, amount, status, customer_key)
       values ($1,'lec-1b','강의','lecture',$2,300,'paid','k')`, [U1, L1]);
  } catch (e) { dupLec = /duplicate key|payments_paid_product_uniq/i.test(String(e?.message ?? '')); }
  rec('⭐ 같은 강의를 두 번 결제 완료할 수 없다', dupLec, true);

  // ⭐ 같은 카탈로그의 교재 묶음과 강의 묶음은 **서로 다른 상품**이다(접두사가 그 구분을 담는다).
  //    안 갈리면 교재를 통으로 산 사람이 강의를 통으로 살 때 부분 유니크에 걸려 영영 못 산다.
  const SET = `${[L1, L2].sort().join('+')}`;
  await db.query(
    `insert into payments (user_id, order_id, order_name, product_type, product_ref, amount, status, customer_key)
     values ($1,'lec-bundle','강의 외 1편','bundle',$2,540,'paid','k')`, [U2, `lecture:leveltest:${SET}`]);
  await db.query(
    `insert into payments (user_id, order_id, order_name, product_type, product_ref, amount, status, customer_key)
     values ($1,'book-bundle','교재 외 1권','bundle',$2,180,'paid','k')`, [U2, `ebook:leveltest:${SET}`]);
  const both = (await db.query(
    `select count(*)::int as n from payments where user_id=$1 and product_type='bundle' and status='paid'`, [U2])).rows[0];
  rec('⭐ 같은 목록이어도 교재 묶음 / 강의 묶음은 따로 산다', both.n, 2);

  // 묶음 줄에 강의가 담긴다(교재와 같은 자리).
  const lpid = (await db.query(`select id from payments where order_id='lec-bundle'`)).rows[0].id;
  rec('묶음 줄에 강의 허용', await failsWith(() => db.query(
    `insert into payment_items (payment_id, product_type, product_ref, list_amount, amount)
     values ($1,'lecture',$2,300,270),($1,'lecture',$3,300,270)`, [lpid, L1, L2])), null);
  // ⭐ 그래도 응시권은 여전히 못 담는다 — 넓힌 CHECK 이 exam 까지 열어버리면 이중결제 방어가 샌다.
  let examLine2 = false;
  try {
    await db.query(
      `insert into payment_items (payment_id, product_type, product_ref, list_amount, amount)
       values ($1,'exam','round:pro',100,100)`, [lpid]);
  } catch (e) { examLine2 = /check|payment_items_product_type_check/i.test(String(e?.message ?? '')); }
  rec('⭐ 강의 묶음에도 응시권은 못 들어감', examLine2, true);

  // lecture_purchases — 이북 구매표와 같은 모양(같은 코드가 두 표를 다룬다).
  const lcols = (await db.query(
    `select column_name from information_schema.columns where table_schema='public' and table_name='lecture_purchases'`,
  )).rows.map((r) => r.column_name);
  for (const c of ['user_id', 'lecture_id', 'price_paid', 'source', 'payment_id', 'payment_ref']) {
    rec(`lecture_purchases.${c} 존재`, lcols.includes(c), true);
  }
  await db.query(`insert into lecture_purchases (user_id, lecture_id, price_paid, source) values ($1,$2,300,'pg')`, [U1, L1]);
  let dupOwn = false;
  try {
    await db.query(`insert into lecture_purchases (user_id, lecture_id) values ($1,$2)`, [U1, L1]);
  } catch (e) { dupOwn = /duplicate key/i.test(String(e?.message ?? '')); }
  rec('⭐ 같은 강의를 두 번 보유할 수 없다(최종 방어선)', dupOwn, true);

  // ⭐ 환불 회수는 payment_id 로 이 결제분만 짚는다 → 결제를 지워도 시청권은 남고 참조만 끊긴다.
  //    (이북과 달리 cascade 로 지우면 "환불했더니 남의 구매까지 사라졌다" 를 만들 수 있다.)
  const p1 = (await db.query(`select id from payments where order_id='lec-1'`)).rows[0].id;
  await db.query(`update lecture_purchases set payment_id=$1 where user_id=$2 and lecture_id=$3`, [p1, U1, L1]);
  await db.query(`delete from payments where id=$1`, [p1]);
  const kept = (await db.query(
    `select payment_id from lecture_purchases where user_id=$1 and lecture_id=$2`, [U1, L1])).rows[0];
  rec('결제를 지워도 시청권은 남는다', kept !== undefined, true);
  rec('지워진 결제 참조는 null 로 끊긴다', kept?.payment_id, null);

  // RLS — payments 와 같은 취급(정책 0개 = 엣지 함수 전용). 열면 클라가 소유를 직접 만들 수 있다.
  const lrls = (await db.query(`select relrowsecurity from pg_class where relname='lecture_purchases'`)).rows[0];
  rec('lecture_purchases RLS 켜짐', lrls?.relrowsecurity, true);
  const lpol = (await db.query(`select count(*)::int as n from pg_policies where tablename='lecture_purchases'`)).rows[0];
  rec('lecture_purchases 정책 0개(서비스롤 전용)', lpol.n, 0);

  // 값 — 달러 센트 정수. 음수는 못 들어온다(lectures_price_chk).
  let negPrice = false;
  try {
    await db.query(`alter table lectures add column if not exists price_usd_cents integer not null default 0`);
    await db.query(`insert into lectures (id, price_usd_cents) values (gen_random_uuid(), -1)`);
  } catch (e) { negPrice = /check|lectures_price_chk/i.test(String(e?.message ?? '')); }
  rec('강의 가격 음수 거부', negPrice, true);
}

for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${JSON.stringify(x.got)} want=${JSON.stringify(x.want)})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-PAYMENTS: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-payments', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
