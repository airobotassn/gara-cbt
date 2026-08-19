-- 묶음 결제(bundle) — 이북 여러 권을 한 번에. /ebooks 전체구매 화면의 '선택 항목 구매' 가 이걸 쓴다.
--
-- 왜 새 유형인가
--   payments 는 한 결제에 상품 **1건**(+응시료의 곁다리 교재 1권)까지만 알았다. 줄이 여러 개인 주문을
--   담을 자리가 없어서 "고른 것만 한 번에" 가 통째로 불가능했다.
--
-- ⛔ **응시권(exam)은 이 유형에 담지 않는다.** 응시권 이중결제를 실제로 막는 건
--    payments_paid_product_uniq(user_id, product_type, product_ref) 하나뿐인데, 같은 (회차×급수)를
--    exam 으로 한 번 + bundle 로 한 번 결제할 수 있게 되면 그 방어가 통째로 새 나간다
--    (2026-08-14 곁다리 교재에서 번들 유형을 안 만든 이유가 정확히 이것이다).
--    그래서 payment_items.product_type 은 'ebook' 만 허용한다 — 넓힐 땐 위 문단을 먼저 다시 읽을 것.
--
-- product_ref = 'ebook:<catalog>:<정렬한 이북 id 를 + 로 이은 것>'
--   ⚠️ 카탈로그만 넣으면 안 된다. paid 부분 유니크가 (user_id, type, ref) 라서, 3권을 묶어 산 사람이
--      나머지 4권을 나중에 묶어 사려 할 때 영영 막힌다. 담은 목록까지 ref 에 넣으면 **같은 조합 재구매**
--      만 막히고 다른 조합은 열린다. (권별 중복은 ebook_purchases 의 unique 가 최종 방어선이다.)

alter table public.payments drop constraint if exists payments_product_type_check;
alter table public.payments
  add constraint payments_product_type_check check (product_type in ('ebook', 'exam', 'cert', 'bundle'));

-- 주문 한 건의 줄 목록.
--   **합계만 남기면 원장이 "무엇을 팔았는지" 를 못 말한다** — 곁다리 교재에서 addon_amount 를 따로 둔 것과 같은 이유다.
--   list_amount = 정가, amount = 실제 배분액(묶음 할인 반영). 배분액의 합 = payments.amount 여야 한다.
--   할인액은 sum(list_amount) - sum(amount) 로 언제든 되짚을 수 있다.
create table if not exists public.payment_items (
  payment_id   uuid not null references public.payments(id) on delete cascade,
  product_type text not null check (product_type in ('ebook')),
  product_ref  text not null,
  list_amount  integer not null check (list_amount >= 0),
  amount       integer not null check (amount >= 0),
  created_at   timestamptz not null default now(),
  -- 한 주문에 같은 책이 두 줄로 들어오지 않는다(프론트가 중복을 보내도 여기서 걸린다).
  primary key (payment_id, product_type, product_ref)
);

-- ⚠️ RLS 정책을 부여하지 않는다 = service role(엣지 함수) 전용. payments 와 같은 취급이다.
alter table public.payment_items enable row level security;

-- 지급·환불 회수가 결제 한 건의 줄을 통째로 읽는다(payment_id 로만 조회한다 — PK 앞자리라 별도 색인 불필요).
comment on table public.payment_items is '묶음 결제(payments.product_type=''bundle'')의 줄 목록. 지금은 이북만.';
