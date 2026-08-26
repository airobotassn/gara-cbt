-- 스토리지 버킷·정책 — **마이그레이션이 아니다.** 대시보드 SQL 에디터(또는 Management API)로 실행한다.
--
-- 왜 마이그레이션에 안 넣나: `storage` 스키마는 Supabase 가 소유하고, 우리 테스트(pglite)엔 그 스키마가
--   아예 없어서 마이그레이션에 섞으면 `test:db` 가 통째로 죽는다. 그래서 여기에 따로 모아 둔다.
--
-- ⛔ **이 파일이 곧 "실제로 만들어졌다"는 뜻은 아니다.** 실행은 사람이 한 번 해야 한다 —
--    2026-08-25 에 `avatars` 가 **없어서** 아바타 업로드가 통째로 실패하고 있었다(Bucket not found).
--    코드는 처음부터 그 버킷을 부르고 있었는데 만드는 단계만 아무도 안 밟은 것이다.
--    ⚠️ Supabase Storage 는 **버킷이 없을 때와 권한이 없을 때 똑같이 "Bucket not found"** 를 준다
--       (존재 여부를 숨긴다). 그래서 그 메시지만 보고 "정책 문제겠지" 로 넘겨짚으면 안 된다 —
--       `select id from storage.buckets` 로 먼저 있는지부터 확인할 것.
--
-- 지금 있는 것(2026-08-25 실측): notice-images · ebooks · ebook-covers · avatars.
--   · notice-images  (공개)  공지 본문 이미지
--   · ebooks         (비공개) 이북 본문 HTML — 서명 URL 로만 연다
--   · ebook-covers   (공개)  이북 표지 + 사이트 로고·파비콘(`site/`) + **강의 썸네일(`lecture/`)**
--   · avatars        (공개)  회원 프로필 이미지 — 경로 첫 칸이 본인 uid
--   · feedback-files (비공개) 의견함 첨부 — 정책 0개, 서명 URL 로만 오르내린다

-- ─────────────────────────────────────────────────────────────
-- avatars — 회원 프로필 이미지 (2026-08-25 생성)
--   경로 규칙: `<uid>/avatar_<타임스탬프>.webp` (src/lib/avatar.ts 의 uploadAvatar)
--   ⚠️ 폴더 첫 칸이 곧 소유자다 — 정책이 그 한 칸만 보고 남의 폴더를 막는다.
--   ⚠️ 3MB 상한은 화면(avatar.ts 의 MAX_UPLOAD_BYTES)과 **같은 값**이어야 한다. 버킷이 더 작으면
--      화면은 통과시킨 파일이 업로드에서만 실패해 사용자는 이유를 못 듣는다.
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 3145728, array['image/webp','image/png','image/jpeg','image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 읽기는 누구나 — 랭킹·채팅·남의 방에서 로그인 없이도 아바타가 보여야 한다.
drop policy if exists avatars_public_read on storage.objects;
create policy avatars_public_read on storage.objects
  for select using (bucket_id = 'avatars');

-- 쓰기는 **본인 폴더만**. ⚠️ upsert 로 올리므로 insert 와 update 가 **둘 다** 필요하다 —
--    하나만 열면 두 번째 업로드부터 조용히 실패한다.
drop policy if exists avatars_own_insert on storage.objects;
create policy avatars_own_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_own_update on storage.objects;
create policy avatars_own_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- 지우기도 본인 것만 — 옛 아바타를 정리할 길을 남긴다(지금 화면엔 삭제 버튼이 없다).
drop policy if exists avatars_own_delete on storage.objects;
create policy avatars_own_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ─────────────────────────────────────────────────────────────
-- feedback-files — 의견함 첨부 (2026-08-26)
--   경로 규칙: `<uuid>/<정리한 원본 파일명>` (supabase/functions/feedback/index.ts 가 정한다)
--
-- ⛔ **정책을 하나도 만들지 않는다.** 의견함은 비로그인이 쓰는 화면이라 anon insert 를 열면
--    그 순간 우리 스토리지가 가드 없는 무제한 업로드 엔드포인트가 된다. 대신 엣지 함수가
--    경로 하나짜리 **서명 업로드 URL** 을 발급하고(createSignedUploadUrl), 브라우저는 그 토큰으로만
--    올린다 — 서명 업로드는 RLS 를 보지 않으므로 정책 없이도 동작하고, 정책이 없으므로
--    토큰 없이는 아무도 못 올린다. 읽기도 관리자 함수가 발급하는 서명 URL 뿐이다.
--
-- ⚠️ 20MB 상한은 서버(functions/feedback/index.ts 의 MAX_FILE_BYTES)·DB CHECK
--    (feedback_uploads_size_chk)·화면(src/pages/Feedback.tsx 의 MAX_FILE_BYTES)과 **같은 값**이어야
--    한다. 버킷이 더 작으면 화면·서버가 통과시킨 파일이 업로드에서만 실패해 사용자는 이유를 못 듣는다.
-- ⚠️ allowed_mime_types 를 비워 둔다 — 브라우저가 보내는 content-type 은 믿을 값이 아니고(파일에
--    따라 빈 문자열로도 온다), 진짜 관문은 서버의 **확장자 화이트리스트**다. 여기서 mime 을 조이면
--    멀쩡한 pptx 가 브라우저에 따라 조용히 거절된다.
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-files', 'feedback-files', false, 20971520, null)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
