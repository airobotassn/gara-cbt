-- exam_tiers 정리 — 안 쓰는 칸을 지우고, 쓰기로 한 칸의 단위를 바로잡는다.
--
-- ⛔ **코드 배포가 끝난 뒤에 적용할 것.** 배포 전 코드가 아래 컬럼을 이름으로 select 하면
--    PostgREST 가 400 을 내고 관리자 화면이 통째로 멈춘다(20260904 에 같은 함정을 한 번 밟았다).
--    순서: 20260904200000 적용 → 함수 배포(admin·character·start-exam·my-attempts·payments·
--    get-exam-result·leaderboard·room·get-hub) → 프론트 push → **그다음** 이 파일.
--
-- 셋 다 6행 전부 null 인 채로 몇 주를 있었다. 관리자 화면과 DB 사이만 왕복하고 채점·발급 어디에도
-- 안 나갔다 — 그리고 화면은 "비워두면 기본값을 씁니다" 라고 적어 두고 있었다(비우든 채우든 기본값이었다).
--
--   · sort                       → **드롭.** 칭호를 사용자가 고르게 되면서(20260904200000) 급수를
--                                  줄 세울 이유가 없어졌다. 관리자 화면의 표시 순서는 코드
--                                  (_shared/exam-tickets.ts 의 TIER_ORDER)가 정한다.
--   · cert_available_after_days  → **드롭.** 발급 시점은 회차의 성적공개일(exam_attempts.result_release_at)
--                                  하나로 이미 고정돼 있다. 두 개를 두면 어느 쪽이 이기는지가 또 규칙이 된다.
--   · cert_fee_override          → **살린다. 단, 이름을 바꾼다.** 실제 발급비는 exam_fees.amount_usd_cents
--                                  (달러 센트)인데 이 칸은 화면 안내가 '원 단위'였다. 이름이 단위를
--                                  안 말하면 관리자가 3000 을 넣고 3,000원을 기대한다(실제론 $30).
--                                  값이 6행 전부 null 이라 지금이 이름을 바꿀 유일하게 싼 시점이다.

-- ⚠️ rename 은 `if not exists` 가 없다 — 재실행 안전하게 하려면 이 형태여야 한다.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'exam_tiers' and column_name = 'cert_fee_override'
  ) then
    alter table public.exam_tiers rename column cert_fee_override to cert_fee_usd_cents;
  end if;
end $$;

alter table public.exam_tiers drop column if exists sort;
alter table public.exam_tiers drop column if exists cert_available_after_days;

comment on column public.exam_tiers.pass_ratio is
  '급수별 합격선(0~1). null = 기본 0.6. 응시 시작 때 exam_attempts.pass_ratio_snapshot 에 박힌다 — 고쳐도 과거 판정은 안 흔들린다.';
comment on column public.exam_tiers.cert_fee_usd_cents is
  '자격증 발급비(달러 센트). null = 그 급수 응시료와 동일(exam_fees.amount_usd_cents).';
