-- 팝업 이미지 저장용 공개 버킷 (관리자 › 홈페이지 관리 › 팝업 관리에서 업로드, 사용자 화면이 읽음).
--
-- 예전엔 관리자가 **이미지 주소를 손으로 적는** 칸이었다. 운영자에게 없는 값을 요구하는 칸이라
-- 실제로는 쓸 수 없었다(2026-08-13 지적) → 파일 업로드로 바꾸면서 둘 자리가 필요해졌다.
--
-- ⚠️ 'notice-images' 를 재사용하지 않은 이유: 그 버킷은 insert 정책이 `to authenticated` 라
--    **로그인한 사람이면 누구나** 올릴 수 있다(그 마이그레이션 주석도 "추후 강화"라고 적어뒀다).
--    새로 만드는 자리까지 그 조건을 물려받을 이유가 없어서 처음부터 관리자만 쓰게 잠근다
--    (ebook-covers 와 같은 모양 — 공개 읽기 + is_admin_user() 쓰기).
insert into storage.buckets (id, name, public, file_size_limit)
values ('popup-images', 'popup-images', true, 5242880)  -- 5MB
on conflict (id) do nothing;

-- 공개 읽기 — 팝업은 로그인 없이도 보이는 화면(메인 등)에 뜬다.
drop policy if exists "popup_images_public_read" on storage.objects;
create policy "popup_images_public_read" on storage.objects
  for select using (bucket_id = 'popup-images');

-- 쓰기·삭제는 관리자만.
drop policy if exists "popup_images_admin_write" on storage.objects;
create policy "popup_images_admin_write" on storage.objects
  for all to authenticated
  using (bucket_id = 'popup-images' and public.is_admin_user())
  with check (bucket_id = 'popup-images' and public.is_admin_user());
