-- PG 에 실제로 청구한 금액·통화를 따로 적는다 — 2026-08-13.
--
-- 왜 필요한가: 정가는 원화 하나인데(ebooks.price·exam_fees 전부 원 정수) **엑심베이는 달러로 청구**한다.
--   지금까지는 원화 1,500원을 그대로 보냈고, 엑심베이 결제창이 자기 환율로 다시 환산해 `$1.05` 를
--   띄웠다. 화면은 우리 고정환율로 `$1` 이라고 말하는데 결제창은 `$1.05` 라고 말하는 상태다.
--   → 우리가 정한 값($1)으로 직접 청구하고, **그 청구값을 원장에 남긴다.**
--
--   amount/currency        = 우리 정가(원화). 상품 가격·통계·환불 판단의 기준. 안 바뀐다.
--   charge_amount/currency = PG 에 실제로 보낸 값. 승인 대조와 조회(retrieve)에 쓴다.
--
-- ⚠️ amount 를 달러로 바꾸지 않는 이유: integer 컬럼이고(원은 소수점이 없다) 모든 상품 가격이 원 기준이다.
--    여기를 달러로 갈면 이북·응시료 정가 체계와 기존 행 전부가 같이 흔들린다.
-- ⚠️ null = "정가 그대로 청구했다"(토스). 코드가 coalesce 로 읽으므로 기존 행을 백필하지 않는다 —
--    백필하면 옛 행에 "그때 달러로 받았다"는 없는 사실이 생긴다.
alter table public.payments
  add column if not exists charge_amount numeric(12,2) check (charge_amount is null or charge_amount > 0),
  add column if not exists charge_currency text;

comment on column public.payments.charge_amount is
  'PG 에 실제 청구한 금액. null 이면 amount(원화 정가) 그대로 청구한 것.';
comment on column public.payments.charge_currency is
  'PG 에 실제 청구한 통화(예: USD). null 이면 currency 그대로.';

-- 둘은 항상 같이 있거나 같이 없어야 한다 — 한쪽만 있으면 "얼마를 무슨 돈으로 받았나"가 미정이 된다.
alter table public.payments drop constraint if exists payments_charge_pair_chk;
alter table public.payments add constraint payments_charge_pair_chk
  check ((charge_amount is null) = (charge_currency is null));
