-- 문항 변경 이력 (관리자 "문항 이력" 탭의 원천). admin-test 가 수정/비활성/삭제 시 한 줄씩 적재.
-- question_id 는 FK 아님(문항 삭제돼도 로그 남김) — code 가 안정 참조.
create table if not exists question_events (
  id uuid primary key default gen_random_uuid(),
  question_id uuid,
  code text,
  level int,
  action text not null,
  actor text,
  detail jsonb,
  created_at timestamptz default now()
);
create index if not exists question_events_created_idx on question_events(created_at desc);
create index if not exists question_events_code_idx on question_events(code);
alter table question_events enable row level security;
