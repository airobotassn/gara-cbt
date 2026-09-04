-- 2026-09-04 · exam_session_events.created_at 제거 (2026-09-04 지시)
--
--   at 과 값이 늘 같았다(5건 전부 일치). 기록하는 네 자리(start-exam · exam-session ·
--   _shared/exam-reentry · admin)가 **둘 다 안 넣어서** 양쪽 기본값 now() 가 같이 찍히기 때문이다.
--   읽는 쪽은 at 하나뿐이다 — 관리자 응시 이력 화면의 `select('kind, at, detail').order('at')`.
--
--   ⚠️ 원리상으로는 갈릴 수 있는 두 값이다 — at = 사건이 일어난 시각, created_at = 서버가 기록한 시각.
--      응시자가 오프라인이었다가 몰아서 보내면 달라진다. 그런데 지금 코드는 그 구분을 안 쓴다.
--      쓰지도 않는 구분을 칸으로 남겨두면 다음 사람이 "이 둘이 왜 다르지" 를 매번 확인하게 된다.
--   ⛔ 나중에 진짜로 클라이언트 시각을 받게 되면 created_at 을 되살리지 말고 `client_at` 처럼
--      **역할이 이름에 드러나는** 컬럼을 새로 만들 것. 그래야 at 과 헷갈리지 않는다.
--
--   배포 순서 제약 없음 — 코드가 이 컬럼을 이름으로 부르는 곳이 없다(읽지도 쓰지도 않는다).

begin;

alter table exam_session_events drop column if exists created_at;

commit;
