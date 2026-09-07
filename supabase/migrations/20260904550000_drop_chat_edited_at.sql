-- 2026-09-04 · chat_messages.edited_at 드롭 (2026-09-04 지시)
--
--   글 수정 기능이 삭제되면서(옛 `chat-edit` 함수 — CLAUDE.md 운영 절에 "삭제됐으니 대시보드에
--   남아 있으면 지울 것" 으로 적혀 있다) 채우는 코드가 사라졌다. 95건 전부 null 이다.
--   ⛔ 수정을 되살릴 거면 컬럼도 같이 되살릴 것. chat-list 의 MSG_COLUMNS 주석에도 같이 적어 뒀다.
--
--   ⚠️ 같이 검토했지만 **남긴 것 둘** — 지우려다 말았다는 기록을 남긴다:
--     · hidden_by  0/95 지만 **살아 있는 칸**이다. 관리자 채팅 숨김이 `hidden_by='admin'` 을 남기고,
--       '숨김 해제' 가 그 값으로 **본인이 스스로 지운 글(self)을 되살리지 않는다**. 아직 숨긴 글이
--       없어서 0건일 뿐이다.
--     · is_anon   95건 전부 false 지만 스위치(`CHAT_REQUIRE_LOGIN`, 기본 true)의 나머지 반쪽이다.
--       지우려면 채팅 익명성 처리(아바타·국기 숨김 · user_id 비노출 · 색 시드 고정)를 통째로 걷어내야
--       한다. 불린 한 칸 얻자고 프라이버시 로직을 건드리는 건 손해다.
--
--   ⛔ 코드 배포 뒤에 적용할 것 — chat-list 가 MSG_COLUMNS 로 이름을 나열해 select 한다.

begin;

alter table chat_messages drop column if exists edited_at;

commit;
