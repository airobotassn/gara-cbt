-- 응시 복구를 "실제로 다시 볼 수 있는" 복구로 만든다.
--
-- 앞선 20260810140000 의 복구는 **같은 응시로 돌아가되 started_at 을 그대로 뒀다.** 그래서:
--   · 밤 8시에 PC 가 뻗어 문의 → 다음 날 아침 처리 → 그 사이 12시간이 제한시간에서 흘러가 **이미 만료**
--   · 응시 마지막 날 사고 → 처리 시점엔 **응시 기간 자체가 닫혀** 아예 못 들어감
-- 관리자가 24시간 상주하지 않는 한 복구가 이름만 복구였다. 두 컬럼으로 고친다.
alter table public.exam_attempts
  -- 중단 시점까지 **실제로 쓴 시간(초)**. 복구하면 시계를 여기서 다시 시작한다
  -- (= 끊긴 순간 시계를 멈췄다가, 응시자가 돌아오면 그때부터 다시 튼다).
  -- ⚠️ 복구 시점이 아니라 **재진입 시점**에 started_at 을 되계산해야 한다. 복구를 눌러놓고
  --    응시자가 몇 시간 뒤에 들어오면, 복구 때 계산한 값은 이미 다 흘러가 있다.
  add column if not exists elapsed_sec integer,
  -- 복구된 응시가 들어갈 수 있는 기한. **회차의 응시 기간과 무관하게** 이 시각까지는 열어준다.
  -- 이게 없으면 마지막 날 사고를 복구해줘도 응시창이 닫혀 못 들어간다.
  add column if not exists resume_deadline timestamptz;

-- 재진입 판정이 매번 훑는 조건 — 복구된 채 아직 기한이 남은 응시.
create index if not exists exam_attempts_resume_idx
  on public.exam_attempts (user_id, resume_deadline)
  where reinstated_at is not null;
