-- ============================================================
-- 채팅 검수 개편 — 누가 숨겼는지 기록 + 신고 큐 조회용 인덱스
--   · chat_messages.hidden_by: 'self'(작성자 본인 삭제) | 'admin'(관리자 강제 숨김) | null(옛 기록)
--     왜 필요한가: 지금까지 본인 삭제와 관리자 숨김이 deleted_at 한 컬럼을 공유해서,
--     관리자가 '숨김 해제'를 누르면 **사용자가 스스로 지운 글이 되살아났다.**
--     앞으로 관리자는 hidden_by <> 'self' 인 것만 되돌린다(옛 null 은 지금 동작 유지).
--   · chat_reports 부분 인덱스: 검수 큐가 "열린 신고가 달린 메시지"를 message_id 로 모은다.
--   멱등(재실행 안전) — schema.sql 에 동일 DDL 존재.
-- ============================================================

alter table chat_messages add column if not exists hidden_by text;

-- 열린 신고 → 메시지별 집계용. 큐 조회가 이 인덱스만 타면 되도록 status 를 조건으로 뺀다.
create index if not exists chat_reports_open_msg_idx
  on chat_reports (message_id) where status = 'open';

-- 검수 대기 큐의 다른 한 축 = 공개되지 않은(ok 가 아닌) 메시지.
create index if not exists chat_messages_modq_idx
  on chat_messages (mod_status, created_at desc) where deleted_at is null;
