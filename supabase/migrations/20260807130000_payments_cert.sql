-- 자격증 발급비(cert) 결제 — payments.product_type 에 'cert' 추가.
--   발급비 = 응시료와 동일(resolveProduct 가 exam_fees 를 다시 읽어 계산). product_ref = exam_attempts.id.
--   ⚠️ 접수창(applyWindowOpen)은 보지 않는다 — 발급은 성적 공개 후라 접수가 이미 끝나 있다.
--   지급물은 없다(grant no-op) — my-attempts {issue} 가 이 cert 결제(paid)를 게이트로 자격번호를 채번한다.
--   중복 결제는 기존 payments_paid_product_uniq(user_id, product_type, product_ref) 가 그대로 막는다.
alter table public.payments drop constraint if exists payments_product_type_check;
alter table public.payments
  add constraint payments_product_type_check check (product_type in ('ebook', 'exam', 'cert'));
