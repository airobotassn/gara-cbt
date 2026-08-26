-- ─────────────────────────────────────────────────────────────
-- 강의(콘텐츠 관리) 제목·소개 다국어 — 2026-08-26
--
-- 여태 강의는 번역이 **아예 없었다**. 이북은 스토어 카드의 제목·소개를 언어별로 들고 있는데
-- 그 옆에 나란히 서는 강의는 한국어 제목 그대로라, 러닝 라이브러리를 영어로 보면 한 화면에서
-- 왼쪽 열만 영어고 오른쪽 열은 한국어였다.
--
-- ⛔ **한국어의 단일 출처는 원본 컬럼(title·description)이다 — 여기에 ko 를 넣지 않는다.**
--    CARIS 문항(prompt·choices ↔ prompt_i18n)과 같은 규칙이다. 관리자 목록·편집 화면이 원본
--    컬럼을 그대로 읽으므로, ko 를 i18n 안으로 옮기면 한 자리만 놓쳐도 조용히 빈 문자열이 되고
--    ko 가 두 군데 생겨 동기화할 짝만 늘어난다. 번역본만 담으면 중복이 0이고 관리자 화면은
--    손댈 게 없다.
--
-- ⚠️ 백필은 없다 — 번역은 Gemini 호출이라 SQL 로 채울 수 없다. 이미 등록된 강의는 관리자가
--    한 번 저장하면 그때 채워지고, 그 전까지는 사용자 화면이 한국어 원문으로 폴백한다(빈 화면 아님).
-- ─────────────────────────────────────────────────────────────
alter table public.lectures add column if not exists title_i18n jsonb not null default '{}'::jsonb;
alter table public.lectures add column if not exists description_i18n jsonb not null default '{}'::jsonb;

comment on column public.lectures.title_i18n is
  '제목 번역본(en·ja·zh·hi·vi). ko 는 담지 않는다 — 원본은 title 컬럼이 단일 출처.';
comment on column public.lectures.description_i18n is
  '소개 번역본(en·ja·zh·hi·vi). ko 는 담지 않는다 — 원본은 description 컬럼이 단일 출처.';
