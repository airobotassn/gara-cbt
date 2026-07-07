-- 공지 본문 이미지 저장용 공개 버킷 (관리자 WYSIWYG 에디터가 업로드, 공개 페이지가 읽음).
-- 공개 read(누구나) · 업로드는 로그인 사용자(관리자 화면에서만 호출). 필요 시 추후 edge function 경유로 admin 한정 강화.
insert into storage.buckets (id, name, public)
values ('notice-images', 'notice-images', true)
on conflict (id) do nothing;

-- 공개 읽기
drop policy if exists "notice_images_public_read" on storage.objects;
create policy "notice_images_public_read" on storage.objects
  for select using (bucket_id = 'notice-images');

-- 로그인 사용자 업로드
drop policy if exists "notice_images_auth_insert" on storage.objects;
create policy "notice_images_auth_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'notice-images');
