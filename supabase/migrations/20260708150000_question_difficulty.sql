-- 문항 난이도(상/중/하) — 과목 하위분류. 관리자 전용(응시/결과 화면 비노출).
-- 기존 문항은 값이 없으므로 nullable. 값이 있으면 상/중/하 중 하나만 허용.
alter table questions add column if not exists difficulty text;
alter table questions drop constraint if exists questions_difficulty_check;
alter table questions add constraint questions_difficulty_check
  check (difficulty is null or difficulty in ('상', '중', '하'));
