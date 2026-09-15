-- 구매자 키(customer_key) 걷어내기 2/2 — 컬럼 드롭 (2026-09-15)
--
-- ⚠️ 20260915220000 + payments·payments-webhook·admin 배포 **뒤에** 적용할 것. 배포 전 코드는 이 컬럼을
--    이름으로 select 하므로(PAYMENT_COLS) 먼저 지우면 결제 조회가 통째로 400 이다.
-- 옛 토스 주문 행의 customer_key 값은 같이 사라진다 — 토스는 삭제됐고 그 값을 다시 쓸 일이 없다.

alter table public.payments drop column if exists customer_key;

drop index if exists public.profiles_payment_customer_key_uniq;
alter table public.profiles drop column if exists payment_customer_key;
