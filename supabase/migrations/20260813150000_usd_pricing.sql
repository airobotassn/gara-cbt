-- 정가를 달러로 바꾼다 + 환율 저장소 — 2026-08-13.
--
-- 왜: 지금까지 정가는 원화였고 화면의 `$1` 은 **고정환율 $1=1,500원**으로 만든 표시용 글자였다.
--   실제 환율이 1,417원까지 내려오면서 $10 짜리를 팔면 15,000원이 아니라 14,170원이 들어온다 —
--   정가가 클수록 우리가 덜 받는다(5%대). 그래서 **정가의 기준을 달러로 옮긴다.**
--
--   해외 결제 = 달러 그대로 청구.
--   국내 결제 = 그때 환율로 원화 환산해 청구(원화 숫자가 딱 떨어지지 않아도 된다 — 기준이 달러다).
--
-- ⚠️ 옛 컬럼(price·amount)을 **지우지 않는다.** 원화 정수라는 전제로 읽는 코드가 아직 남아 있을 수 있어
--    한 번에 갈아엎으면 어디서 조용히 틀리는지 알 수 없다. 새 컬럼으로 옮기고, 소비처를 다 옮긴 뒤 지운다.

-- ── 환율 ──────────────────────────────────────────────────────
-- 통화당 한 행. 이력은 여기 쌓지 않는다 — 감사에 필요한 "그 결제에 무슨 환율을 썼나"는
-- payments.fx_rate 에 건별로 박히므로, 여기엔 '지금 값' 하나만 있으면 된다.
create table if not exists public.exchange_rates (
  currency text primary key,                        -- 'KRW' — USD 1 당 이 통화가 얼마인가
  rate numeric(14,6) not null check (rate > 0),
  -- 어디서 온 값인가. 사람이 손으로 넣은 값을 자동 수집이 덮어쓰면 안 되므로 구분한다.
  source text not null default 'auto',              -- 'auto' | 'manual'
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.exchange_rates is
  'USD 1 기준 환율. 주 1회 자동 수집(open.er-api.com), 관리자가 손으로 덮어쓸 수 있다. 결제는 주문 생성 시점 값을 payments.fx_rate 에 박아 쓴다.';

-- 첫 값. 수집이 한 번이라도 돌면 갱신된다 — 수집 전에도 결제가 막히지 않도록 씨앗을 심어둔다.
insert into public.exchange_rates (currency, rate, source)
values ('KRW', 1417, 'auto')
on conflict (currency) do nothing;

-- 잠금 테이블(RLS 정책 없음 = service role 전용). 환율은 금액을 정하는 값이라 클라가 못 읽고 못 쓴다.
alter table public.exchange_rates enable row level security;

-- ── 정가(달러) ────────────────────────────────────────────────
-- **센트 정수**로 든다. 소수(numeric)로 두면 0.1+0.2 류의 오차와 반올림 규칙이 코드마다 갈린다.
--   100 = $1.00 · 250 = $2.50
alter table public.ebooks     add column if not exists price_usd_cents  integer check (price_usd_cents  is null or price_usd_cents  >= 0);
alter table public.exam_fees  add column if not exists amount_usd_cents integer check (amount_usd_cents is null or amount_usd_cents >= 0);

comment on column public.ebooks.price_usd_cents is
  '정가(달러 센트). 100 = $1.00. 옛 price(원화 정수)를 대체한다.';
comment on column public.exam_fees.amount_usd_cents is
  '응시료(달러 센트). 100 = $1.00. 옛 amount(원화 정수)를 대체한다.';

-- 기존 값 이관 — 옛 고정환율이 정확히 1,500 이었으므로 1500·3000·4500 이 $1·$2·$3 으로 딱 떨어진다.
-- (안 떨어지는 값이 있으면 올림한다. 내림은 우리가 손해 보는 쪽이다.)
update public.ebooks    set price_usd_cents  = ceil(price::numeric  * 100 / 1500) where price_usd_cents  is null;
update public.exam_fees set amount_usd_cents = ceil(amount::numeric * 100 / 1500) where amount_usd_cents is null;

-- ── 결제에 쓴 환율 스냅샷 ─────────────────────────────────────
-- ⚠️ 주문을 만들 때의 환율을 여기 박는다. 승인은 결제창을 다녀온 뒤라 그 사이 환율이 갱신될 수 있는데,
--    그때 금액을 다시 계산하면 화면에 뜬 금액과 청구액이 달라져 **금액 대조가 통째로 깨진다.**
--    null = 환산이 없었던 주문(달러 그대로 청구).
alter table public.payments add column if not exists fx_rate numeric(14,6) check (fx_rate is null or fx_rate > 0);
comment on column public.payments.fx_rate is
  '주문 생성 시점의 USD→해당통화 환율. 원화 청구건에만 들어간다. 승인 때 다시 계산하지 않는다.';
