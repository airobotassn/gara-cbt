-- 문항 소프트 삭제: deleted_at 세팅 = 출제 제외 + 관리자 목록/통계에서 숨김.
--  - 행은 보존하므로 과거 응시/결과창은 깨지지 않고, 결과창에선 "삭제된 문항입니다"로 표시.
--  - 삭제 시 active=false 도 같이 꺼서 출제 풀(active=true)에서 즉시 제외.
alter table questions add column if not exists deleted_at timestamptz;
create index if not exists questions_deleted_idx on questions (deleted_at) where deleted_at is not null;
