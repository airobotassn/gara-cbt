-- 강의를 이북과 **같은 상품**으로 만든다(2026-08-25) — 사면 마이페이지 서재에서 본다.
--
-- 여태 강의는 파는 물건이 아니었다(유튜브 임베드 = 목록에 뜨면 누구나 재생). 그래서 값 컬럼도
-- 구매·소유 표도 없었고, /ebooks 전체구매에서도 0원으로 잡혀 결제 대상에서 빠져 있었다.
--
-- ⛔ **이 표가 생겨도 유튜브 공개 영상은 유료화가 성립하지 않는다.** 링크(=영상 id)만 알면 누구나
--    무료로 본다. 파는 강의는 반드시 **미등록(unlisted) 업로드**여야 하고, 그래서 아래 thumb_url 이
--    있다 — 미소유자에게는 서버가 youtube_id 를 아예 안 내려주는데, 폴백인 유튜브 썸네일 주소
--    (img.youtube.com/vi/<id>/…)에는 그 id 가 그대로 박혀 있기 때문이다. 관리자가 썸네일을 따로
--    올리면 그 구멍이 닫힌다.
-- ⛔ **영상 파일을 우리 스토리지에 올리지 말 것.** 그 순간부터 영상 트래픽이 전부 우리 몫이 된다
--    (lectures 표를 만들 때부터의 규칙 — 20260811120000 주석 참고).

-- ---------- ① 값 · 썸네일 ----------
-- 정가는 이북과 같은 단위다: **달러 센트 정수**(100 = $1.00). 0 = 무료(결제창을 안 타고 바로 지급).
--   ⚠️ 옛 이북의 price(원화)처럼 통화가 섞이지 않게 처음부터 센트 하나만 둔다.
alter table public.lectures add column if not exists price_usd_cents integer not null default 0;
alter table public.lectures drop constraint if exists lectures_price_chk;
alter table public.lectures add constraint lectures_price_chk check (price_usd_cents >= 0);

-- 목록용 썸네일. 비우면 유튜브 썸네일로 폴백한다(그때는 위 ⛔ 대로 영상 id 가 노출된다).
alter table public.lectures add column if not exists thumb_url text;

-- ---------- ② 구매(= 시청 권한) ----------
-- ebook_purchases 와 **같은 모양**이다. 결제·환불 회수 경로가 두 표를 똑같이 다루므로
-- 컬럼 이름을 맞추지 않으면 _shared/payments.ts 가 갈래마다 다른 코드를 들고 있게 된다.
create table if not exists public.lecture_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lecture_id uuid not null references public.lectures(id) on delete cascade,
  price_paid integer not null default 0,
  source text not null default 'free',     -- free | pg | admin
  payment_id uuid references public.payments(id) on delete set null,
  payment_ref text,
  created_at timestamptz not null default now(),
  -- 한 사람이 같은 강의를 두 번 사지 않는다. **중복 지급의 최종 방어선이 이 한 줄이다**
  -- (코드가 아니라 DB 가 막는다 — ebook_purchases 와 같은 규칙).
  unique (user_id, lecture_id)
);

-- RLS 켜고 정책은 부여하지 않는다 = service role(엣지 함수) 전용. 소유 판정은 ebooks 함수에서만 한다.
alter table public.lecture_purchases enable row level security;

create index if not exists lecture_purchases_user_idx on public.lecture_purchases (user_id, created_at desc);
create index if not exists lecture_purchases_lec_idx on public.lecture_purchases (lecture_id);
-- 환불 회수가 payment_id 로 이 결제분만 짚는다(revokeForRefund).
create index if not exists lecture_purchases_payment_idx on public.lecture_purchases (payment_id);

-- ---------- ③ 결제 상품 유형 ----------
-- 단품 강의.
alter table public.payments drop constraint if exists payments_product_type_check;
alter table public.payments
  add constraint payments_product_type_check check (product_type in ('ebook', 'exam', 'cert', 'bundle', 'lecture'));

-- 묶음의 줄에도 강의가 담긴다.
--   ⛔ **응시권(exam)은 여전히 담지 않는다** — 응시권 이중결제를 막는 건
--      payments_paid_product_uniq(user_id, product_type, product_ref) 하나뿐이라, 같은 (회차×급수)를
--      exam 으로 한 번 + bundle 로 한 번 결제할 수 있게 되면 그 방어가 통째로 새 나간다
--      (20260819120000 주석 참고). 강의는 lecture_purchases 의 unique 가 최종 방어선이라 안전하다.
--   ⚠️ 한 묶음에는 **한 종류만** 담긴다(교재 묶음 / 강의 묶음). 화면이 종류별로 따로 세고 할인도 따로
--      붙이기 때문이고, product_ref 접두사('ebook:' / 'lecture:')가 그 구분을 담는다.
alter table public.payment_items drop constraint if exists payment_items_product_type_check;
alter table public.payment_items
  add constraint payment_items_product_type_check check (product_type in ('ebook', 'lecture'));

comment on table public.lecture_purchases is '강의 시청권. ebook_purchases 와 같은 모양(결제·환불 회수가 두 표를 같은 코드로 다룬다).';
comment on column public.lectures.price_usd_cents is '정가(달러 센트, 100=$1.00). 0 = 무료.';
comment on column public.lectures.thumb_url is '목록 썸네일. 비우면 유튜브 썸네일 폴백(그 주소에 영상 id 가 노출된다).';
