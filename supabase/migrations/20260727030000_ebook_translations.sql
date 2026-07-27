-- 이북 다국어화: 언어별 본문·표지·스토어 메타를 한 컬럼(jsonb)에 담는다.
--   원문(ko)은 기존 컬럼(storage_path · cover_url · title/author/description)이 그대로 담당하고,
--   번역본만 여기 들어간다. 번역본이 없는 언어는 화면에서 한국어로 폴백한다.
--
--   translations = {
--     "en": {
--       "path": "<uuid>/en.html",        -- 비공개 버킷 'ebooks' 안 경로
--       "coverUrl": "https://.../en.webp",-- 공개 버킷 'ebook-covers' (그 언어 1페이지를 구운 표지)
--       "title": "...", "author": "...", "description": "...",
--       "failed": 0,                      -- 번역 실패해 한국어로 남은 조각 수
--       "overflowPages": [12],            -- 번역문이 길어져 잘린 페이지 번호(1부터)
--       "at": "2026-07-27T..."
--     }, ...
--   }
--
--   ⚠️ 별도 테이블을 두지 않은 이유: 언어 수가 5로 고정이고 행 단위로 조회할 일이 없다.
--      ebooks 는 이미 RLS 로 published 행만 공개되므로 이 컬럼도 같은 정책을 그대로 탄다.
alter table public.ebooks
  add column if not exists translations jsonb not null default '{}'::jsonb;

comment on column public.ebooks.translations is
  '언어코드 → { path, coverUrl, title, author, description, failed, overflowPages, at }. 원문(ko)은 제외.';
