-- CARIS 자격검정 문항 다국어 — 응시자가 자기 언어로 시험을 본다.
--
-- 여태 `questions.prompt`(text) · `choices`(jsonb) 단일 컬럼이라 번역을 담을 자리가 아예 없었다.
-- 무료 레벨테스트(test_questions.prompt_i18n)는 6개국어인데 돈 받는 CARIS 만 한국어였다.
--
-- ⛔ **한국어의 단일 출처는 여전히 `prompt`·`choices` 다 — *_i18n 에 ko 를 넣지 않는다.**
--    레벨테스트는 prompt_i18n 안에 ko 까지 담지만, CARIS 는 관리자 화면(문항목록·채점·분석·
--    미리보기·엑셀)이 이미 `prompt`·`choices` 를 열 곳 넘게 읽고 있다. ko 를 i18n 안으로 옮기면
--    그 자리를 하나라도 놓쳤을 때 **조용히 빈 문자열**이 되고, 옮겨도 ko 가 두 군데 생겨
--    동기화 페어가 늘어난다. 번역본만 여기 두면 중복이 0 이고 관리자 화면은 손댈 게 없다.
--    투영 규칙(_shared/lib.ts 의 projKoText/projKoOptions): ko 요청 → 원본 컬럼,
--    그 외 → i18n[lang] 이 있으면 그것, 없으면 원본(=미번역분은 한국어로 뜬다).
--
-- ⚠️ 보기 개수는 번역본도 원본과 같아야 한다. 어긋나면 정답 인덱스(correct_index)가 다른 보기를
--    가리켜 **아무도 못 맞히는 문항**이 된다 — 서버(admin questionTransSave)가 개수를 검사하고
--    개수가 다른 언어는 통째로 버린다. 여기 CHECK 을 걸지 않는 이유는 jsonb 안 배열 길이를
--    보려면 언어마다 풀어야 해서고, 검사 자리는 저장 경로 한 곳뿐이다.
alter table public.questions
  add column if not exists prompt_i18n  jsonb not null default '{}'::jsonb,
  add column if not exists choices_i18n jsonb not null default '{}'::jsonb;

comment on column public.questions.prompt_i18n  is '지문 번역본(ko 제외). {"en":"...","ja":"..."}';
comment on column public.questions.choices_i18n is '보기 번역본(ko 제외). {"en":["..",..]} — 개수는 choices 와 같아야 한다.';

-- 응시 언어 — 그 응시자가 실제로 어느 언어로 문제를 봤는지. test_attempts.lang 과 같은 자리.
-- ⚠️ 결과창(오답노트)이 이 값으로 투영한다. 화면 언어로 투영하면 응시 후 언어를 바꾼 사람에게
--    **시험 때 본 적 없는 지문**이 오답노트로 뜬다. 자격검정이라 분쟁 시 재현에도 이 값이 필요하다.
alter table public.exam_attempts
  add column if not exists lang text;

comment on column public.exam_attempts.lang is '응시 언어(ko/en/ja/zh/hi/vi). 시험 시작 시 고정 — 도중 화면 언어를 바꿔도 문항은 안 바뀐다.';
