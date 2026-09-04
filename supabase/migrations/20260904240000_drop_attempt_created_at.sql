-- 2026-09-04 · exam_attempts.created_at 제거 (2026-09-04 지시)
--
--   started_at 과 **값이 늘 같았다**(5건 전부 일치) — 응시 행을 만드는 순간 둘 다 찍히고,
--   두 값을 갈라 쓰는 경로가 코드에 없다. 응시권(exam_tickets)에서 같은 이유로 뺀 것과 같은 패턴이다.
--
--   읽던 곳 두 자리는 started_at 으로 옮겼다(값이 같으니 결과가 안 바뀐다):
--     · admin 홈 대시보드의 일별 응시 추이 — `submitted_at ?? created_at` 폴백
--     · admin 회원 상세의 응시 목록 — createdAt 필드
--   남긴 쪽이 started_at 인 이유 = 이름이 사실을 말한다("언제 시험을 시작했나").
--
--   ⛔ **코드 배포 뒤에 적용할 것.** 위 두 자리가 컬럼을 이름으로 select 해서, 먼저 지우면
--      관리자 홈 대시보드와 회원 상세가 PostgREST 400 으로 죽는다.

begin;

alter table exam_attempts drop column if exists created_at;

commit;
