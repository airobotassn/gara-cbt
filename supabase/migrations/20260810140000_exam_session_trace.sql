-- 응시 중단 정황 기록 — "재진입은 무효, 사고는 사람이 풀어준다" 를 성립시키는 자료.
--
-- 배경: 우리 시험은 **감독관이 없는 10일 자율응시**다. 응시 중 SEB 를 닫고 나갔다가 검색해보고
--   돌아오는 걸 서버가 자동으로 구분할 방법은 없다 — PC 가 뻗은 것과 일부러 나간 것이 서버에는
--   똑같이 "세션이 끊겼다 다시 들어왔다" 로만 보이기 때문이다. 그래서 판정을 자동화하지 않는다:
--     · 기본값은 엄격하게 — 재진입하면 그 응시는 무효(start-exam)
--     · 예외는 사람이 — 문의가 오면 아래 자료를 보고 관리자가 복구
--   여기 쌓는 건 **증거가 아니라 정황**이다(랜선을 뽑으면 종료 신호도 안 남는다). 그래도
--   아무 자료 없이 판단하는 것보다 낫고, 상습적인 사람은 패턴이 남는다.

-- ---------- exam_attempts: 살아있는 동안의 상태 ----------
alter table public.exam_attempts
  -- 하트비트가 갱신하는 '마지막으로 살아있던 시각'. 언제 끊겼는지가 여기서 나온다.
  -- ⚠️ 행마다 갱신만 한다(이력을 쌓지 않는다) — 50분 응시에 하트비트 이력을 남기면 응시당 100행이다.
  add column if not exists last_seen_at timestamptz,
  -- 끊긴 시점에 몇 문항까지 답했는지. "하나도 안 풀고 다 보기만 하고 나갔다" 가 드러나는 값이다.
  add column if not exists answered_count integer not null default 0,
  -- start-exam 진입 횟수(최초 1). 2 이상 = 재진입.
  add column if not exists entry_count integer not null default 1,
  -- 무효 사유 코드. 'reentry'(재진입) · 'quit'(응시자가 종료 버튼) · 'cheat'(부정행위) 등.
  -- ⚠️ 자동 판정 결과가 아니라 **무슨 일이 있었는지의 기록**이다. 복구 판단은 사람이 한다.
  add column if not exists void_reason text,
  -- 관리자 복구 감사 — 누가 언제 왜 풀었는지. 없으면 "왜 이 응시만 살아났나"에 답할 수 없다.
  add column if not exists reinstated_at timestamptz,
  add column if not exists reinstated_by text,
  add column if not exists reinstate_note text;

-- ---------- exam_session_events: 끊김·복귀의 이력 ----------
-- 하트비트는 위 컬럼을 덮어쓰지만, **사건**은 지워지면 안 되므로 따로 쌓는다.
create table if not exists public.exam_session_events (
  id bigserial primary key,
  attempt_id uuid not null references public.exam_attempts(id) on delete cascade,
  -- start    : 응시 시작(최초 진입)
  -- closed   : 응시 화면이 닫혔다고 **클라이언트가 알려온** 경우 = 사람이 창을 닫았다는 뜻
  --            ⚠️ 이 이벤트가 **없는데** 세션이 끊겼다면 전원 차단·PC 정지처럼 알릴 틈이 없었던 것이다.
  --               그 유무가 '일부러 나갔다'와 '사고'를 가르는 유일한 단서다(위장은 가능하다).
  -- reentry  : 끊긴 뒤 다시 들어옴 → 이 시점에 응시가 무효가 된다
  -- reinstate: 관리자가 무효를 풀어줌
  kind text not null check (kind in ('start', 'closed', 'reentry', 'reinstate')),
  at timestamptz not null default now(),
  -- 그 시점의 진행 상황·공백 길이 등. 판단에 필요한 값을 통째로 담는다(스키마를 자주 안 바꾸려고 jsonb).
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 한 응시의 이력을 시간순으로 훑는 게 유일한 조회 패턴이다.
create index if not exists exam_session_events_attempt_idx
  on public.exam_session_events (attempt_id, at);

-- ⚠️ RLS 켜고 정책 0개 = service role(엣지 함수) 전용.
--    응시자가 자기 중단 이력을 직접 고칠 수 있으면 이 자료는 아무 의미가 없다.
alter table public.exam_session_events enable row level security;
