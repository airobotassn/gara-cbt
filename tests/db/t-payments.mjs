// T-Payments — 마이그레이션 20260806170000_payments.sql 을 pglite 에 적용해 **결제 원장의 방어선**을 검증한다.
//
// 여기서 보는 건 "코드가 잘 짜였나"가 아니라 **코드가 실수해도 DB 가 막아주나**다.
// 결제에서 복구 불가능한 사고는 하나뿐 — 어긋난 걸 모르는 상태 — 이고, 아래 제약들이 그걸 없앤다.
//  · 같은 사람이 같은 상품을 두 번 '결제 완료'로 가질 수 없다 (부분 유니크 인덱스)
//  · 환불된 뒤에는 다시 살 수 있다 (부분 인덱스라 refunded 는 대상에서 빠진다)
//  · 0원/음수 금액 행이 원장에 못 들어온다
//  · status 는 정해진 값만 (오타 상태가 조용히 저장되면 대사가 그 행을 영영 못 본다)
//  · payments 는 RLS 켜고 정책 0개 = service role(엣지 함수) 전용
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const raw = readFileSync('supabase/migrations/20260806170000_payments.sql', 'utf8');

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

for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${JSON.stringify(x.got)} want=${JSON.stringify(x.want)})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-PAYMENTS: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-payments', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
