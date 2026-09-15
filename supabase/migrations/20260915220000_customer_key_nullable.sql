-- 구매자 키(customer_key) 걷어내기 1/2 — NOT NULL 만 푼다 (2026-09-15)
--
-- 토스 규격이 요구하던 값이다(카드 저장을 계정에 붙이는 식별자). 엑심베이로 옮긴 뒤엔 PG 에 보내지도 않고
-- 읽는 코드도 없다 — 계정마다 랜덤값을 만들어 profiles 에 박고 주문마다 복사해 넣기만 했다.
--
-- 두 단계로 나누는 이유: 컬럼이 NOT NULL 이라 코드가 먼저 값을 안 보내면 insert 가 깨지고,
-- 컬럼을 먼저 지우면 옛 배포본의 select(PAYMENT_COLS)가 400 이다. 그래서 ① NOT NULL 해제 → ② 함수 배포 →
-- ③ 컬럼 드롭(20260915230000) 순서다.

alter table public.payments alter column customer_key drop not null;
