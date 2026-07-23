-- 이북(전자책) — 관리자가 HTML 1개 파일을 업로드하고, 회원이 /ebooks 에서 구매하면
-- 마이페이지 '이북 서재'에서 열람한다. 결제(PG)는 아직 없어 구매 = 즉시 지급(데모).
--   · 책 본문(HTML)은 비공개 버킷 'ebooks' → 소유자에게만 서명 URL 발급(ebooks 함수)
--   · 표지 이미지는 공개 버킷 'ebook-covers'
--   · 구매 내역(ebook_purchases)은 service role 전용(RLS 정책 미부여)

-- ---------- 관리자 판별(스토리지 정책용) ----------
-- storage.objects 정책 안에서 admin_users 를 조회해야 하는데 그 테이블도 RLS 라 security definer 로 감싼다.
create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    lower(coalesce(auth.jwt() ->> 'email', '')) <> ''
    and (
      exists (
        select 1 from admin_users a
        where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
      -- 루트 관리자(admin 함수의 ROOT_ADMIN 기본값) — admin_users 에 행이 없어도 통과
      or lower(coalesce(auth.jwt() ->> 'email', '')) = 'airobotassn@gmail.com'
    );
$$;

-- ---------- 이북 ----------
create table if not exists public.ebooks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  author text,
  description text,
  cover_url text,                          -- 표지 public URL (없으면 프론트 기본 표지)
  price integer not null default 0,        -- 원(KRW). 0 = 무료
  storage_path text not null,              -- 비공개 버킷 'ebooks' 안 경로 (예: <uuid>/book.html)
  published boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ebooks enable row level security;

-- 스토어 목록은 누구나 읽는다(공개된 책만). 본문 경로는 노출돼도 비공개 버킷이라 서명 URL 없이는 못 읽는다.
drop policy if exists "ebooks_public_read" on public.ebooks;
create policy "ebooks_public_read" on public.ebooks
  for select using (published = true);

-- ---------- 구매(= 열람 권한) ----------
-- 결제 붙이기 전까지는 source='demo' 로 즉시 지급. PG 연동 시 payment_ref 에 거래 식별자를 남긴다.
create table if not exists public.ebook_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ebook_id uuid not null references public.ebooks(id) on delete cascade,
  price_paid integer not null default 0,
  source text not null default 'demo',     -- demo | pg | admin
  payment_ref text,
  created_at timestamptz not null default now(),
  unique (user_id, ebook_id)
);

-- RLS 켜고 정책은 부여하지 않는다 = service role(엣지 함수) 전용. 소유 판정은 ebooks 함수에서만.
alter table public.ebook_purchases enable row level security;

create index if not exists ebook_purchases_user_idx on public.ebook_purchases (user_id, created_at desc);
create index if not exists ebook_purchases_book_idx on public.ebook_purchases (ebook_id);

-- ---------- 스토리지 ----------
-- 본문: 비공개. 업로드/삭제는 관리자만, 읽기는 service role 이 만든 서명 URL 로만.
insert into storage.buckets (id, name, public, file_size_limit)
values ('ebooks', 'ebooks', false, 52428800)          -- 50MB
on conflict (id) do nothing;

drop policy if exists "ebooks_admin_all" on storage.objects;
create policy "ebooks_admin_all" on storage.objects
  for all to authenticated
  using (bucket_id = 'ebooks' and public.is_admin_user())
  with check (bucket_id = 'ebooks' and public.is_admin_user());

-- 표지: 공개 읽기 + 관리자만 업로드.
insert into storage.buckets (id, name, public, file_size_limit)
values ('ebook-covers', 'ebook-covers', true, 5242880) -- 5MB
on conflict (id) do nothing;

drop policy if exists "ebook_covers_public_read" on storage.objects;
create policy "ebook_covers_public_read" on storage.objects
  for select using (bucket_id = 'ebook-covers');

drop policy if exists "ebook_covers_admin_write" on storage.objects;
create policy "ebook_covers_admin_write" on storage.objects
  for all to authenticated
  using (bucket_id = 'ebook-covers' and public.is_admin_user())
  with check (bucket_id = 'ebook-covers' and public.is_admin_user());
