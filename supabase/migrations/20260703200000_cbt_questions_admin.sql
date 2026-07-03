-- CBT 문항 관리(목록·이력·엑셀 임포트) 지원.
--  · questions 에 소프트삭제(deleted_at) 추가 — 삭제해도 행 보존(이력/복구).
--  · CBT 전용 변경 이력 테이블(cbt_question_events) — 레벨테스트 question_events 와 분리.
-- correct_index 는 여전히 클라 비노출(공개 read 정책 없음 = service role/admin 함수 전용).

alter table questions add column if not exists deleted_at timestamptz;

-- CBT 문항 변경 이력 — admin 함수가 import/edit/activate/deactivate/delete/restore 시 한 줄 적재.
-- question_id 는 FK 아님(문항 삭제돼도 로그 남김).
create table if not exists cbt_question_events (
  id uuid primary key default gen_random_uuid(),
  question_id uuid,
  exam_id uuid,
  number int,
  action text not null,     -- import | edit | activate | deactivate | delete | restore
  actor text,
  detail jsonb,
  created_at timestamptz default now()
);
create index if not exists cbt_question_events_created_idx on cbt_question_events(created_at desc);
create index if not exists cbt_question_events_exam_idx on cbt_question_events(exam_id);
alter table cbt_question_events enable row level security;
