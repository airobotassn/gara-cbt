-- 방 꾸미기(미니룸) — /hub 무대를 '방'으로 바꾸고, 산 가구를 고정 슬롯에 놓는다.
--
-- 왜 이걸 만드나 (2026-08-14)
--   여기 있던 파츠 6종(모자·신발·안경·날개·왕관)은 **화면 어디에도 그려지지 않았다.**
--   무대는 /hub-char.png 한 장이었고 user_characters.equipped 를 읽는 코드가 프론트에 없었다.
--   즉 상점·뽑기는 "사도 안 보이는 물건"을 팔고 있었다. 방+가구가 그 구멍을 메운다.
--
-- 설계 결정
--   · 소유는 **기존 user_cosmetics 를 그대로 쓴다**(가구도 part_key 하나로 취급).
--     그래서 shop_buy·gacha_draw·gacha_exchange RPC 를 한 줄도 안 고친다 — 이미 카탈로그에서
--     가격을 읽고 user_cosmetics 에 넣는 구조라 품목 종류를 모른다.
--   · 파츠 6종은 상점·뽑기에서 **내리기만** 한다(active=false / 풀에서 제거). 소유 기록은 지우지 않는다
--     — 이미 산 사람의 것을 없애는 건 환불 없는 회수다.
--   · 배치는 user_rooms.slots jsonb 한 컬럼({슬롯키: part_key}). user_characters.equipped 와 같은 모양이다.
alter table shop_catalog add column if not exists kind       text not null default 'part';
alter table shop_catalog add column if not exists surface    text;
alter table shop_catalog add column if not exists sort_order int  not null default 0;

-- 가구는 반드시 놓일 면이 있어야 하고, 그 외 품목은 면이 없어야 한다.
-- ⚠️ 면이 없는 가구를 허용하면 배치 검증이 "면을 모르는 물건"을 만나 조용히 통과시킨다.
--
-- ⚠️ **`surface in (...)` 를 그냥 쓰면 안 된다 — 3값 논리에 뚫린다.**
--   surface 가 null 이면 `null in ('floor','wall')` 이 false 가 아니라 **null** 이고,
--   CHECK 은 결과가 null 이면 **통과**시킨다. 즉 막으려던 바로 그 행(면 없는 가구)만 빠져나간다.
--   coalesce 로 null 을 실제 값으로 떨어뜨려야 false 가 된다(tests/db/t-room.mjs A3a 가 이걸 잡았다).
alter table shop_catalog drop constraint if exists shop_catalog_kind_surface_chk;
alter table shop_catalog add constraint shop_catalog_kind_surface_chk check (
  (kind = 'furniture' and coalesce(surface, '') in ('floor', 'wall'))
  or (kind <> 'furniture' and surface is null)
);

-- ── 파츠 정리: 상점에서 내린다(소유는 유지) ─────────────────────────────────
update shop_catalog set active = false where kind = 'part';

-- ── 가구 카탈로그 ────────────────────────────────────────────────────────────
-- 아직 그림이 없다 — 화면은 CSS 방 + 이모지로 그린다(2026-08-14 결정: 구조부터).
-- 그림이 생기면 프론트 art 매핑 한 곳(src/lib/room.ts 의 FURNITURE_ART)만 갈면 되고 이 표는 안 바뀐다.
insert into shop_catalog (part_key, price, kind, surface, sort_order, active) values
  ('fur_plant_01',    150, 'furniture', 'floor', 10, true),
  ('fur_lamp_01',     200, 'furniture', 'floor', 20, true),
  ('fur_chair_01',    250, 'furniture', 'floor', 30, true),
  ('fur_sofa_01',     400, 'furniture', 'floor', 40, true),
  ('fur_wardrobe_01', 500, 'furniture', 'floor', 50, true),
  ('fur_bed_01',      600, 'furniture', 'floor', 60, true),
  ('fur_frame_01',    150, 'furniture', 'wall',  70, true),
  ('fur_clock_01',    200, 'furniture', 'wall',  80, true),
  ('fur_shelf_01',    350, 'furniture', 'wall',  90, true),
  ('fur_window_01',   450, 'furniture', 'wall', 100, true),
  -- 뽑기 전용 한정 2종 — 상점에는 안 보인다(옛 wing/crown 과 같은 취급).
  ('fur_aquarium_01', 0,   'furniture', 'floor', 900, false),
  ('fur_neon_01',     0,   'furniture', 'wall',  910, false)
on conflict (part_key) do update
  set price      = excluded.price,
      kind       = excluded.kind,
      surface    = excluded.surface,
      sort_order = excluded.sort_order,
      active     = excluded.active;

-- ── 뽑기 풀도 가구로 갈아끼운다 ──────────────────────────────────────────────
-- ⚠️ 안 바꾸면 뽑기가 계속 **안 보이는 파츠**를 준다 — 상점만 정리하면 구멍이 반만 막힌다.
--   구조(흔함 4 + 희귀 2, 가중치)는 그대로 둔다: gacha_draw 의 천장·환급 계산이 이 모양을 전제한다.
delete from gacha_pool where pool_key = 'default';
insert into gacha_pool (pool_key, part_key, weight, is_rare) values
  ('default', 'fur_plant_01',    40, false),
  ('default', 'fur_lamp_01',     40, false),
  ('default', 'fur_frame_01',    30, false),
  ('default', 'fur_clock_01',    30, false),
  ('default', 'fur_aquarium_01',  5, true),
  ('default', 'fur_neon_01',      5, true)
on conflict (pool_key, part_key) do nothing;

-- 가루 교환 한정템도 같이 이동(교환가 150 유지 — 천장 설계 전제값이라 건드리지 않는다).
update gacha_exclusive set active = false where part_key in ('wing_rare_01', 'crown_rare_01');
insert into gacha_exclusive (part_key, dust_price, active) values
  ('fur_aquarium_01', 150, true),
  ('fur_neon_01',     150, true)
on conflict (part_key) do update set dust_price = excluded.dust_price, active = excluded.active;

-- ── 방 배치 ──────────────────────────────────────────────────────────────────
-- slots = {"floor:1":"fur_sofa_01", "wall:2":"fur_clock_01"} — 빈 슬롯은 키 자체가 없다.
-- RLS enable + 정책 미부여 = service role 전용(다른 잠금 테이블과 동일).
--   ⚠️ 사용자에게 직접 UPDATE 를 열면 안 된다 — 소유하지 않은 가구를 꽂을 수 있고,
--     방은 공개라 남들이 그걸 본다. 쓰기 경로는 room 함수 하나뿐이다.
create table if not exists user_rooms (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  slots      jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table user_rooms enable row level security;

revoke all on user_rooms from public, anon, authenticated;
grant all on user_rooms to service_role;
