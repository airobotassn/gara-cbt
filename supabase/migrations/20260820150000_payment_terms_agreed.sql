-- 결제 전 환불규정 동의 (2026-08-20)
--   결제창에서 취소·환불 규정에 동의해야 결제 버튼이 열린다. 그 동의를 **결제 건마다 기록**한다 —
--   "동의를 안 받았다" 는 분쟁에서 화면 로직은 증거가 못 되기 때문이다.
-- ⚠️ 값이 null 인 옛 결제는 규정 도입 전 건이다. 소급해서 채우지 않는다(안 받은 동의를 받은 것처럼
--    만들면 기록 자체의 신빙성이 사라진다).
alter table public.payments add column if not exists terms_agreed_at timestamptz;

comment on column public.payments.terms_agreed_at is
  '구매자가 취소·환불 규정에 동의한 시각. null = 규정 동의 도입(2026-08-20) 이전 결제';
