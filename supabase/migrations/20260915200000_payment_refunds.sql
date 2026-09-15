-- 환불 원장 (2026-08-21 작성 · 2026-09-15 번호 교체)
--
-- ⛔ **이 파일은 원래 20260821140000 이었는데 프로덕션에 적용된 적이 없다.** 같은 날 `ranking_dummies_seed`
--    가 같은 번호를 달고 들어와 장부(schema_migrations)엔 그 번호가 한 번만 찍혔고, 이 표는 만들어지지 않았다.
--    쓰는 코드가 0 이라 아무도 몰랐다(2026-09-15 에 `to_regclass` 로 확인 — payment_refunds 없음 ·
--    payments.refunded_amount 없음). 환불 API(_shared/refunds.ts)를 붙이면서 새 번호(20260915200000)로 옮겨 실제로 적용한다 — 0915 낮 번호대는 허브 스킨 작업이 쓰고 있어 한 번 더 피했다.
--    내용은 그대로다(전부 if not exists 라 혹시 어디선가 만들어졌어도 안전).
--
-- 왜 표를 새로 파나 — 지금까지 환불은 **사람이 PG 대시보드에서** 했고 우리 DB 에는 `status='refunded'` 한 글자만
-- 남았다. 그래서 답할 수 없는 게 많았다: 얼마를 돌려줬나, 무엇 때문에(응시료? 교재?), 누가 승인했나,
-- 두 번 눌린 건 아닌가. 부분 환불이 들어오면 그 한 글자로는 아예 표현이 안 된다.
--
-- ⚠️ **결제 행에 금액 칸 하나 더 붙이는 걸로 끝내지 않는다.** 환불은 여러 번 나뉠 수 있고(응시료 절반 →
--    나중에 교재), 각각이 별개의 PG 호출이라 **건별 기록**이 있어야 대사가 성립한다. payments 에는 합계만 둔다.
--
-- 📌 Spring 이관 시: 이 표와 계산 규칙(_shared/refunds.ts)은 그대로 옮기면 된다. PG 호출부만 바뀐다.

create table if not exists public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  -- PG 에 보낸 멱등키(엑심베이 refund_id). **중복 불가라 두 번 눌러도 돈이 두 번 안 나간다.**
  -- ⚠️ unique 는 우리 쪽 방어이기도 하다 — 같은 키로 두 행이 생기면 합계가 틀어진다.
  refund_key text not null unique,
  -- 실제로 돌려준 금액·통화 = **청구 통화 기준**(payments.charge_amount 와 같은 단위·같은 타입).
  -- ⚠️ 정가(amount, 달러 센트)로 적지 말 것 — 한국 결제는 원화로 빠졌으므로 돌려주는 것도 원화다.
  -- ⚠️ integer 가 아니라 numeric(12,2) 다 — 달러 청구는 소수 둘째 자리까지 간다($1.05). 정수로 두면 깎인다.
  amount numeric(12,2) not null check (amount > 0),
  currency text not null,
  -- 무엇을 돌려줬나. [{line:'exam'|'ebook', amount:number, rate:int, reason:text}]
  -- ⚠️ 줄 단위로 남겨야 "응시료만 절반" 과 "교재만 전액" 이 구분된다. 합계만 두면 나중에 못 되짚는다.
  lines jsonb not null default '[]'::jsonb,
  -- 사람이 고른 사유(규정 예외 포함). PG 에도 같이 보낸다.
  reason text not null,
  -- 승인한 관리자. 되돌릴 수 없는 조작이라 누가 했는지가 남아야 한다.
  actor_id uuid references auth.users(id) on delete set null,
  -- PG 가 돌려준 식별자(엑심베이 refund_transaction_id) — 대사 때 저쪽 원장과 맞춰본다.
  provider_ref text,
  created_at timestamptz not null default now()
);

-- RLS 켜고 정책 없음 = service role(엣지 함수) 전용. 결제 계열 표의 관례 그대로다.
alter table public.payment_refunds enable row level security;

create index if not exists payment_refunds_payment_idx on public.payment_refunds (payment_id, created_at desc);

comment on table public.payment_refunds is
  '환불 원장(건별). payments.refunded_amount 는 이 표의 합계다.';

-- 결제 행에는 **합계만** 둔다(빠른 판정용). 진실은 위 표다.
--   0            = 환불 없음
--   0 < x < 청구액 = 부분 환불   ← status 는 'paid' 그대로다(아래 주석 참고)
--   x = 청구액     = 전액 환불   ← 이때만 status 를 'refunded' 로 바꾼다
-- ⛔ 부분 환불에 새 status 값을 만들지 않았다. status 는 결제·지급 게이트 곳곳이 읽는 값이라
--    새 값을 끼우면 그 분기들을 전부 다시 봐야 한다. "얼마 돌려줬나" 는 금액이 답할 문제다.
alter table public.payments add column if not exists refunded_amount numeric(12,2) not null default 0
  check (refunded_amount >= 0);

comment on column public.payments.refunded_amount is
  '이 결제에서 돌려준 청구통화 합계(payment_refunds 의 합). 청구액과 같아지면 status=refunded';
