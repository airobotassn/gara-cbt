-- Phase2 캐릭터·성장 엔진 — cosmetic-only 경제.
--  · 이 테이블들은 user_progress / user_level_skill 과 무관(실력/진화 불변식 보존).
--  · 파츠/뽑기/상점/쇠퇴/스탬프/티켓/출석은 순수 꾸미기·재화 레이어일 뿐,
--    레벨(진화 모양)·자격증(칭호)·실력 데이터는 절대 건드리지 않는다.
--  · 확률/천장/임계 등 수치는 config-driven 상수(추후 확정) — DDL 에 하드코딩 금지.
--  · 모든 테이블: RLS enable + 클라 정책 미부여 = service-role(Edge Function) 전용.

-- 캐릭터: base_key = 진화/모양 포인터가 아니라 캐릭터 프리셋 키(꾸미기 베이스). equipped = 장착 파츠 맵.
create table if not exists user_characters (
  user_id uuid primary key references auth.users(id) on delete cascade,
  base_key text not null default 'default',
  equipped jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);
alter table user_characters enable row level security;

-- 재화: cosmetic 경제 포인트(실력 점수 아님). bigint = 누적 상한 여유.
create table if not exists user_currency (
  user_id uuid primary key references auth.users(id) on delete cascade,
  points bigint not null default 0,
  updated_at timestamptz default now()
);
alter table user_currency enable row level security;

-- 보유 파츠(꾸미기 아이템). source = gacha | shop | grant 등.
create table if not exists user_cosmetics (
  user_id uuid references auth.users(id) on delete cascade,
  part_key text not null,
  acquired_at timestamptz default now(),
  source text,
  primary key (user_id, part_key)
);
alter table user_cosmetics enable row level security;

-- 뽑기 천장(pity) 카운터 — 풀별 누적.
create table if not exists user_gacha_pity (
  user_id uuid references auth.users(id) on delete cascade,
  pool_key text not null,
  counter int not null default 0,
  primary key (user_id, pool_key)
);
alter table user_gacha_pity enable row level security;

-- 뽑기 로그 — 서버권위 결과 감사 + 멱등(client_nonce). was_dupe/refund_points = 중복환급.
create table if not exists gacha_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  pool_key text not null,
  client_nonce text not null,
  result_part_key text,
  was_dupe boolean not null default false,
  refund_points int not null default 0,
  pity_before int,
  created_at timestamptz default now(),
  unique (user_id, client_nonce)
);
alter table gacha_log enable row level security;

-- 상점 구매 로그 — 멱등(client_nonce) + 소비 포인트 감사.
create table if not exists shop_purchase (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  client_nonce text not null,
  part_key text not null,
  spent_points int not null default 0,
  created_at timestamptz default now(),
  unique (user_id, client_nonce)
);
alter table shop_purchase enable row level security;

-- 마일스톤 스탬프 — 누적 카운트(연속 아님).
create table if not exists user_stamps (
  user_id uuid references auth.users(id) on delete cascade,
  stamp_kind text not null,
  count int not null default 0,
  updated_at timestamptz default now(),
  primary key (user_id, stamp_kind)
);
alter table user_stamps enable row level security;

-- 티켓 재고(뽑기권 등) — 종류별 수량.
create table if not exists user_tickets (
  user_id uuid references auth.users(id) on delete cascade,
  kind text not null,
  qty int not null default 0,
  primary key (user_id, kind)
);
alter table user_tickets enable row level security;

-- 하루완료(출석) — 오늘의 콘텐츠 소비 1/일(KST day). pk(user_id, day) = 1/day 보장.
create table if not exists daily_activity (
  user_id uuid references auth.users(id) on delete cascade,
  day date not null,
  first_seen_at timestamptz default now(),
  primary key (user_id, day)
);
alter table daily_activity enable row level security;
