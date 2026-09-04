-- 2026-09-04 · exam_tickets.created_at 제거 (2026-09-04 지시)
--
--   issued_at 과 **값이 늘 같았다** — 둘 다 발급 시점에 now() 로 같이 찍혔고, 17장 전부 일치했다.
--   원래 의도는 "행이 만들어진 순간(created)" 과 "응시권이 유효해진 순간(issued)" 을 가르는 것이었을
--   텐데, 지금 코드는 두 값을 갈라 쓰는 경로가 없다.
--
--   남긴 쪽이 issued_at 인 이유 = **실제로 읽는 게 그쪽**이다:
--     · 목록 정렬(admin · my-attempts · start-exam · _shared/exam-tickets)
--     · 화면의 '발급일'(마이페이지 · 관리자 응시권 목록) · API 응답의 issuedAt
--   created_at 은 select 목록과 타입 정의에만 있고 읽는 코드가 0곳이었다.
--
--   ⛔ **코드 배포 뒤에 적용할 것.** _shared/exam-tickets.ts 의 EXAM_TICKET_COLS 가 컬럼을 이름으로
--      나열해서, 먼저 지우면 그 상수를 쓰는 함수 전부(admin·my-attempts·start-exam·payments·
--      seb-handoff·ebooks·leaderboard)가 PostgREST 400 을 낸다.

begin;

alter table exam_tickets drop column if exists created_at;

commit;
