-- 결제(payments) — PG 결제의 단일 원장. 이북·응시료가 같은 테이블을 쓴다.
--
-- 설계 요지(왜 이렇게 생겼는지):
--   · provider 컬럼을 처음부터 둔다 — 1차는 국내 원화(토스)만 붙이지만, 나중에 해외(엑심베이 등)를
--     얹을 때 테이블을 갈아엎지 않기 위해서다. 주문 생성·금액 검증·지급은 공통, PG별로 갈리는 건
--     "결제 시작 방식"뿐이다(토스=위젯 임베드, 엑심베이=결제창 리다이렉트).
--   · 금액은 **서버가 상품ID로 다시 계산해서** 여기 박는다. 클라이언트가 보낸 금액은 저장하지 않는다.
--     저장된 금액과 successUrl 의 amount 를 대조하는 게 승인 전 마지막 관문이다.
--   · 지급(이북 열람권 등)은 confirm 성공 **이후에만**, 그리고 중복 지급은 코드가 아니라
--     아래 유니크 인덱스가 막는다. Idempotency-Key 는 토스 쪽 중복 승인만 막지 우리 DB 는 못 막는다.
--
-- ⚠️ RLS 정책을 부여하지 않는다 = service role(엣지 함수) 전용. 금액·결제키가 들어있어 클라 직접 SELECT 금지.

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  provider text not null default 'toss',            -- 'toss' | 향후 'eximbay' 등
  order_id text not null unique,                    -- 토스 규격: 6~64자, 영문·숫자·'-_=' 만
  order_name text not null,                         -- 결제창에 뜨는 상품명(최대 100자)

  product_type text not null check (product_type in ('ebook', 'exam')),
  product_ref text not null,                        -- ebook: ebooks.id / exam: 회차·티어 키
  amount integer not null check (amount > 0),       -- 원(KRW) 정수. 0원 상품은 결제창을 안 타므로 여기 안 들어온다.
  currency text not null default 'KRW',

  -- pending        : 주문만 만든 상태(결제창 진입 전/중)
  -- waiting_deposit: 가상계좌 발급됨 — 승인 API 는 성공했지만 **입금 전이라 지급하면 안 된다**
  -- paid           : 승인 완료. 지급 여부는 fulfilled_at 이 따로 본다.
  -- canceled       : 지급 전 취소 / refunded: 지급 후 취소(환불)
  -- failed         : 승인 실패 / expired: 결제창을 닫는 등으로 만료
  status text not null default 'pending'
    check (status in ('pending', 'waiting_deposit', 'paid', 'canceled', 'refunded', 'failed', 'expired')),

  payment_key text,                                 -- 토스가 발급(승인·조회·취소 키)
  customer_key text not null,                       -- 위젯 초기화용 구매자 식별자(profiles 에 고정 보관)
  method text,                                      -- 카드/가상계좌/간편결제 …(토스 응답 그대로)

  confirmed_at timestamptz,                         -- 승인 성공 시각
  fulfilled_at timestamptz,                         -- 지급(열람권 등) 완료 시각. null 이면 아직 안 줬다는 뜻.
  fail_code text,
  fail_message text,
  raw jsonb,                                        -- PG 응답 원문 — 대사·분쟁 때 이것만 믿는다

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payments enable row level security;

-- 내 결제 목록(마이페이지·관리자)
create index if not exists payments_user_idx on public.payments (user_id, created_at desc);
-- 결제키로 역조회(웹훅이 paymentKey 만 들고 온다)
create index if not exists payments_key_idx on public.payments (payment_key);
-- 미완결 수습(sweep) 대상 — 승인은 났는데 우리가 모르거나, 승인은 났는데 지급이 안 된 것들
create index if not exists payments_unsettled_idx on public.payments (status, created_at)
  where status in ('pending', 'waiting_deposit');
create index if not exists payments_unfulfilled_idx on public.payments (created_at)
  where status = 'paid' and fulfilled_at is null;

-- ⚠️ 중복 결제 방어의 본체 — 같은 사람이 같은 상품을 두 번 '결제 완료' 상태로 가질 수 없다.
--    코드에서 막는 게 아니라 여기서 막는다(동시 요청 두 개가 겹쳐도 하나는 23505 로 튕긴다).
--    환불(refunded)되면 인덱스 대상에서 빠지므로 재구매는 열린다.
create unique index if not exists payments_paid_product_uniq
  on public.payments (user_id, product_type, product_ref)
  where status = 'paid';

-- ---------- 구매자 식별자(customerKey) ----------
-- 토스 규격: 2~50자, 영문·숫자와 '-_=.@' 중 최소 1개 포함. **유추 가능한 값 금지**
-- (이메일·전화번호·회원ID·자동증가 숫자 전부 안 된다). 그래서 계정마다 UUID 를 한 번 만들어 고정 보관한다.
-- 매번 새로 만들면 저장된 카드가 계정에 안 붙으므로 반드시 고정이어야 한다.
alter table public.profiles add column if not exists payment_customer_key text;
create unique index if not exists profiles_payment_customer_key_uniq
  on public.profiles (payment_customer_key)
  where payment_customer_key is not null;

-- ---------- 이북 구매 ↔ 결제 연결 ----------
-- ebook_purchases 는 이미 unique(user_id, ebook_id) 라 이중 지급이 안 된다. 여기에 결제 원장을 연결해
-- "이 열람권이 어느 결제에서 나왔는지"를 남긴다(대사·환불 회수용). 데모/관리자 지급은 계속 null.
alter table public.ebook_purchases add column if not exists payment_id uuid references public.payments(id);
create index if not exists ebook_purchases_payment_idx on public.ebook_purchases (payment_id);
