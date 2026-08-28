-- 의견함 제거 (2026-08-28 지시)
-- ──────────────────────────────────────────────────────────────
-- FAB 패널의 빨간 '의견 보내기' → `/feedback` → `feedback` 엣지 함수 → 이 표들, 로 이어지던 한 줄을
-- 통째로 걷어낸다. 화면·함수·테스트는 같은 커밋에서 지웠고 여기서는 DB 자국만 지운다.
--
-- ⛔ 되돌릴 수 없다. 지우는 시점의 프로덕션 데이터는 접수 3건(전부 우리 테스트 글)과 첨부 2개뿐이라
--    잃는 것이 없어서 백업을 뜨지 않았다. 나중에 이 기능을 되살릴 일이 생기면 표를 다시 만들어야 한다
--    (원본 정의는 `20260825120000_feedback.sql` · `20260826120000_feedback_files.sql` 에 그대로 남아 있다).
--
-- ⚠️ 스토리지 버킷 `feedback-files` 는 여기서 못 지운다 — `storage` 스키마는 pglite 에 없어서
--    마이그레이션에 섞으면 `test:db` 가 죽는다(`supabase/storage-buckets.sql` 이 따로 있는 이유와 같다).
--    버킷과 그 안의 객체는 프로덕션에서 직접 지운다.

-- 함수부터 — 표를 먼저 지우면 함수 본문이 없는 표를 가리킨 채 남는다.
drop function if exists public.feedback_post(uuid, text, text, text, text, text, text[]);
drop function if exists public.feedback_post(uuid, text, text, text, text, text);
drop function if exists public.feedback_upload_claim(text, text, text, bigint);

-- 첨부 원장이 `feedbacks` 를 참조하므로 순서가 있다(cascade 를 쓰지 않고 명시한다).
drop table if exists public.feedback_uploads;
drop table if exists public.feedbacks;
