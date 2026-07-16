-- 레벨업 쿠폰 — 모델 + 발급(issuance) 스켈레톤.
--  · 발급: ARENA 레벨 최초 도달 1장(레벨 2..7, 최대 6장). 강등 후 재승급은 유니크 충돌로 무발급.
--  · 사용(redemption)은 결제 DEMO 하드블록 — 모델만; 발급/차감 실장은 결제 실장 시.
--  · 1결제1쿠폰(payment_id 로 1:1 귀속). used_at/payment_id 는 결제 실장 전까지 항상 null.
--  · RLS: 클라 정책 없음(= service role/Edge Function 전용). exam_attempts 와 동일 정책.

create table if not exists coupons (
  code text primary key,
  discount int not null,
  issue_condition text,
  active boolean not null default true
);
alter table coupons enable row level security;

create table if not exists user_coupons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  issued_for_level int not null,
  coupon_code text references coupons(code),
  issued_at timestamptz default now(),
  used_at timestamptz,
  payment_id text,
  unique(user_id, issued_for_level)
);
alter table user_coupons enable row level security;

-- 기본 레벨업 쿠폰(10% 할인). 발급 조건 = 레벨 최초 도달.
insert into coupons(code,discount,issue_condition) values ('LEVELUP10',10,'level_first_reach') on conflict (code) do nothing;
