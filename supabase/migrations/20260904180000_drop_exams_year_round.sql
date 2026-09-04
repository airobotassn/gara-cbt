-- 2026-09-04 · exams 에서 죽은 컬럼 year·round 제거 (2026-09-04 지시)
--
--   회차를 별도 표(exam_rounds)로 빼기 전에는 시험 행에 연도(2026)·회차번호(3)를 직접 적었다.
--   그런데 회차 하나에 급수가 3개(Beginner·Pro·Elite)라 **같은 회차 정보가 3줄에 복사**된다 —
--   시험날짜·접수기간·6개국어 회차명까지 3벌이 되고, 날짜 하나 고치면 3줄을 같이 고쳐야 한다.
--   그래서 회차를 표로 빼고 exams 는 round_id 하나로 가리키게 했다. 이 두 칸은 그때 버려진 자리다.
--
--   실측: 6행 전부 null. 코드에서 읽거나 쓰는 곳 0곳(exams 를 다루는 select/insert/update 전수 확인),
--   참조하는 SQL 함수도 없다(user_titles 가 exams 를 쓰지만 이 두 컬럼은 안 본다).
--
--   배포 순서 제약 없음 — 아무도 이름으로 부르지 않아서 먼저 지워도 깨지는 곳이 없다.

begin;

alter table exams drop column if exists year;
alter table exams drop column if exists round;

commit;
