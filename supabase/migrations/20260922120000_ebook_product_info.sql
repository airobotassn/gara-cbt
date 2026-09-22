-- 이북 상품 정보 (2026-09-22 지시)
--
-- 러닝 라이브러리 이북 카드의 소개 아래 빈자리에 상품 정보를 보여준다 — 상품 유형 · 언어 · 페이지 수 · 제공 방법 · 판매자.
-- 관리자 이북 등록/수정에서 고칠 수 있고, **null = 기본값**이다(화면이 사전의 기본 문구를 보는 사람 언어로 그린다).
--   ⚠️ 기본값을 문자열로 저장하면 안 된다 — 한국어 문장이 그대로 박혀 외국어 화면에서도 한국어로 뜬다.
--      서버(ebookUpsert)가 "기본값과 같은 값" 을 null 로 접어 저장한다. 관리자가 고쳐 쓴 글만 문자열로 남는다.
--   · product_langs = 이 상품이 제공되는 언어 코드 목록(ko·en·ja·zh·hi·vi). null = 6개 전부.
--   · page_count 는 기본값이 없다 — 비어 있으면 카드에서 그 칸을 안 그린다.

alter table public.ebooks add column if not exists product_type  text;
alter table public.ebooks add column if not exists product_langs text[];
alter table public.ebooks add column if not exists page_count    integer;
alter table public.ebooks add column if not exists delivery      text;
alter table public.ebooks add column if not exists seller        text;

alter table public.ebooks drop constraint if exists ebooks_page_count_chk;
alter table public.ebooks add constraint ebooks_page_count_chk check (page_count is null or page_count > 0);
alter table public.ebooks drop constraint if exists ebooks_product_langs_chk;
alter table public.ebooks add constraint ebooks_product_langs_chk
  check (product_langs is null or product_langs <@ array['ko','en','ja','zh','hi','vi']::text[]);

comment on column public.ebooks.product_type  is '상품 유형. null = 기본값(Digital E-BOOK)';
comment on column public.ebooks.product_langs is '제공 언어 코드. null = 6개 전부';
comment on column public.ebooks.page_count    is '페이지 수. null = 표시 안 함';
comment on column public.ebooks.delivery      is '제공 방법. null = 기본값(결제 후 웹뷰어에 열람 · 사전 6개국어)';
comment on column public.ebooks.seller        is '판매자. null = 기본값(글로벌AI로봇협회 · 사전 6개국어)';
