-- 문항 해설(explanation) 추가 — 정답 풀이/설명.
--  · answer_key(주관식 채점기준)와 동일하게 클라 비노출 = 관리자·검수 전용.
--  · 객관식/주관식 공통(선택 입력). 출제(start-exam)·결과(get-exam-result)·채점(submit-exam) 서빙엔 절대 미포함.
alter table questions add column if not exists explanation text;
