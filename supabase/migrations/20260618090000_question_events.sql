-- 문항 변경 이력(audit log): 수정·비활성·활성·삭제 이벤트를 한 줄씩 적재.
--  - 관리자 "문항 이력" 탭의 원천. 메인 문항 목록은 활성&미삭제만 보이고, 변경 자취는 여기에 남는다.
--  - detail: 'edit' 이면 { 필드: {before, after} } 스냅샷, 그 외 액션은 null.
--  - 클라 직접 접근 차단(정책 없음 = service role 전용). admin Edge Function 으로만 읽고 쓴다.
create table if not exists question_events (
  id uuid primary key default gen_random_uuid(),
  question_id uuid references questions(id) on delete set null,
  code text,                              -- 이벤트 시점의 문항 번호 스냅샷
  level int,
  action text not null,                   -- 'edit' | 'deactivate' | 'activate' | 'delete'
  actor text,                             -- 작업한 관리자 이메일
  detail jsonb,                           -- edit: { field: { before, after } }
  created_at timestamptz not null default now()
);
create index if not exists question_events_created_idx on question_events (created_at desc);
create index if not exists question_events_qid_idx on question_events (question_id);
alter table question_events enable row level security;
