-- 2026-09-04 · exam_env_checks 에서 ua·screen·detail 제거 (2026-09-04 지시)
--
--   쓰기만 하고 **읽는 곳이 0곳**이었다. 이 표를 조회하는 자리는 둘뿐인데 셋 다 안 뽑는다:
--     · admin/reform.ts   envCheckList → select('ticket_id, user_id, checked_at')
--     · my-attempts       '점검했나' 판정 → select('ticket_id')
--   즉 이 표가 실제로 하는 일은 "이 응시권으로 점검을 마쳤다" 는 사실 하나이고,
--   그건 ticket_id · user_id · checked_at 세 칸이면 성립한다.
--
--   ⛔ **UA 원문을 다시 저장하지 말 것.** 방문 통계(visit_events)는 UA 를 기기/브라우저/OS 세 값으로
--      접어서 넣고 원문은 남기지 않기로 한 규칙이 있다(2026-08-31). 여기만 원문을 남기면 같은 값에
--      규칙이 두 벌이 된다. 부정행위 소명용으로 되살릴 거면 **읽는 화면을 같이 만들 것** —
--      아무도 안 보는 기록은 소명 근거가 되지 못한다(2026-09-04 판단: 이걸로 부정행위를 가릴 수 없다).
--
--   ⛔ **코드 배포 뒤에 적용할 것.** seb-handoff·exam-env-check 가 insert/upsert 에 이 세 칸을
--      이름으로 넣기 때문에, 먼저 지우면 환경점검 저장이 500 으로 죽는다(응시 준비가 막힌다).
--
--   화면의 점검 항목 표(전체화면·네트워크·해상도)는 그대로다 — 그건 브라우저에서 바로 읽는 값이고
--   DB 에 남기던 것과 별개다.

begin;

alter table exam_env_checks drop column if exists ua;
alter table exam_env_checks drop column if exists screen;
alter table exam_env_checks drop column if exists detail;

commit;
