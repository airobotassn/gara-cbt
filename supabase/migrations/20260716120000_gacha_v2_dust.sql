-- Phase2 경제 v2 — 뽑기 개편(가루 재화 + 뽑기 전용 한정템).
--  · 문제의식: 기존엔 뽑기 6종 = 상점 6종이 완전 동일 → 뽑기/천장이 무의미.
--  · 해법: 레어 2종(날개·왕관)을 상점에서 내리고 "뽑기 전용 한정템"으로. 뽑기는 '가루' 재화를 적립.
--     - 코인(출석/활동) → 상점 기본템 구매
--     - 가루(뽑기)       → 뽑기 한정템 교환(gacha_exchange) / 천장 자동 확정
--  · cosmetic-only 하드 불변식 유지: 이 함수들은 user_progress / user_level_skill 을 절대 읽거나 쓰지 않는다.
--  · 이미 원격에 적용된 20260714000500_gacha_shop.sql 은 건드리지 않고, 여기서 스키마/함수를 재정의(replace)한다.

-- ─────────────────────────────────────────────────────────────────────────────
-- (A) 재화/로그 스키마 확장 — 가루(dust) 칼럼 + 뽑기 로그 가루 기록.
-- ─────────────────────────────────────────────────────────────────────────────
alter table user_currency add column if not exists dust bigint not null default 0;
alter table gacha_log     add column if not exists dust_gained int not null default 0;

-- (B) 뽑기 전용 한정템 카탈로그(권위). dust_price = 가루 교환가.
create table if not exists gacha_exclusive (
  part_key   text primary key,
  dust_price int  not null,
  active     boolean not null default true
);
alter table gacha_exclusive enable row level security;
drop policy if exists "gacha_exclusive_select_all" on gacha_exclusive;
create policy "gacha_exclusive_select_all" on gacha_exclusive for select using (true);
insert into gacha_exclusive(part_key, dust_price) values
  ('wing_rare_01', 150),
  ('crown_rare_01', 150)
on conflict (part_key) do nothing;

-- (C) 가루 교환 멱등 로그(user_id, client_nonce).
create table if not exists dust_exchange (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  client_nonce text not null,
  part_key text not null,
  spent_dust int not null default 0,
  created_at timestamptz default now(),
  unique (user_id, client_nonce)
);
alter table dust_exchange enable row level security;

-- (D) 레어 2종을 상점에서 내림(뽑기 전용화). 커먼 4종만 코인 상점에 남긴다.
update shop_catalog set active = false where part_key in ('wing_rare_01', 'crown_rare_01');

-- ─────────────────────────────────────────────────────────────────────────────
-- (E) gacha_draw v2 — 20코인/회. 항상 가루 10~20 적립 + (럭키 8% or 천장10) 시 미보유 한정템 확정.
--     반환 jsonb: {part_key(nullable), dust_gained, pity_before, pity_after, points_after, dust_after, duplicate}
--     cosmetic-only: user_currency/user_cosmetics/user_gacha_pity/gacha_log/gacha_exclusive 만 접근.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function gacha_draw(p_uid uuid, p_pool text, p_nonce text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_draw_cost    constant int := 20;   -- 1회 뽑기 비용(코인)
  c_pity_ceiling constant int := 10;   -- 천장(이 뽑기가 n회째면 한정템 강제)
  c_dust_min     constant int := 10;   -- 회당 가루 최소
  c_dust_max     constant int := 20;   -- 회당 가루 최대
  c_lucky_pct    constant int := 8;    -- 일반 뽑기 한정템 즉시 획득 확률(%)
  c_pity_bonus   constant int := 50;   -- 천장인데 이미 다 보유 시 가루 보너스

  v_existing     record;
  v_points       bigint;
  v_pity_before  int;
  v_force_part   boolean;
  v_dust_gain    int;
  v_part         text;
  v_got_part     boolean := false;
  v_reset        boolean;
  v_points_after bigint;
  v_dust_after   bigint;
  v_pity_after   int;
begin
  -- (0) 멱등: 이미 처리된 nonce면 저장 결과를 현재 잔액과 함께 재구성.
  select gl.result_part_key, gl.dust_gained, gl.pity_before
    into v_existing
    from gacha_log gl
   where gl.user_id = p_uid and gl.client_nonce = p_nonce;
  if found then
    select coalesce(points,0), coalesce(dust,0) into v_points_after, v_dust_after
      from user_currency where user_id = p_uid;
    select coalesce(counter,0) into v_pity_after
      from user_gacha_pity where user_id = p_uid and pool_key = p_pool;
    return jsonb_build_object(
      'part_key',     v_existing.result_part_key,
      'dust_gained',  v_existing.dust_gained,
      'pity_before',  v_existing.pity_before,
      'pity_after',   coalesce(v_pity_after, 0),
      'points_after', coalesce(v_points_after, 0),
      'dust_after',   coalesce(v_dust_after, 0),
      'duplicate',    true
    );
  end if;

  -- (1) 재화 행 보장 + 포인트 잠금.
  insert into user_currency (user_id) values (p_uid) on conflict (user_id) do nothing;
  select points into v_points from user_currency where user_id = p_uid for update;

  -- (2) 비용 확인 — 부족하면 원자 롤백.
  if v_points < c_draw_cost then
    raise exception 'insufficient_points';
  end if;

  -- (3) 천장 카운터. 이번 뽑기가 c_pity_ceiling 회째면 한정템 강제.
  select coalesce(counter, 0) into v_pity_before
    from user_gacha_pity where user_id = p_uid and pool_key = p_pool;
  v_pity_before := coalesce(v_pity_before, 0);
  v_force_part  := (v_pity_before + 1) >= c_pity_ceiling;

  -- (4) 가루는 항상 지급(꽝 없음 — 매 뽑기 진행감).
  v_dust_gain := c_dust_min + floor(random() * (c_dust_max - c_dust_min + 1))::int;

  -- (5) 한정템 지급 판정: 천장 강제 or 럭키 롤. 미보유 한정템 중 랜덤 1개.
  if v_force_part or (floor(random() * 100)::int < c_lucky_pct) then
    select ge.part_key into v_part
      from gacha_exclusive ge
     where ge.active
       and not exists (select 1 from user_cosmetics uc where uc.user_id = p_uid and uc.part_key = ge.part_key)
     order by random()
     limit 1;
    if v_part is not null then
      v_got_part := true;
    elsif v_force_part then
      -- 천장인데 이미 전부 보유 → 파츠 대신 가루 보너스.
      v_dust_gain := v_dust_gain + c_pity_bonus;
    end if;
  end if;

  -- (6) 차감(코인) + 지급(가루) 원자.
  update user_currency
     set points = points - c_draw_cost,
         dust   = dust + v_dust_gain,
         updated_at = now()
   where user_id = p_uid
   returning points, dust into v_points_after, v_dust_after;

  if v_got_part then
    insert into user_cosmetics (user_id, part_key, source) values (p_uid, v_part, 'gacha')
      on conflict (user_id, part_key) do nothing;
  end if;

  -- (7) 천장 갱신: 한정템 획득 또는 천장 소진(다보유 포함) 시 0 리셋, 아니면 +1.
  v_reset := v_got_part or v_force_part;
  insert into user_gacha_pity (user_id, pool_key, counter)
    values (p_uid, p_pool, case when v_reset then 0 else 1 end)
  on conflict (user_id, pool_key) do update
    set counter = case when v_reset then 0 else user_gacha_pity.counter + 1 end;
  select counter into v_pity_after from user_gacha_pity where user_id = p_uid and pool_key = p_pool;

  -- (8) 감사 로그(멱등 가드 = unique(user_id, client_nonce)).
  insert into gacha_log (user_id, pool_key, client_nonce, result_part_key, was_dupe, refund_points, pity_before, dust_gained)
    values (p_uid, p_pool, p_nonce, v_part, false, 0, v_pity_before, v_dust_gain);

  return jsonb_build_object(
    'part_key',     v_part,
    'dust_gained',  v_dust_gain,
    'pity_before',  v_pity_before,
    'pity_after',   v_pity_after,
    'points_after', v_points_after,
    'dust_after',   v_dust_after,
    'duplicate',    false
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (F) gacha_exchange — 가루로 원하는 미보유 한정템 지정 확정. 멱등(user_id, client_nonce).
--     반환 jsonb: {part_key, spent_dust, dust_after}
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function gacha_exchange(p_uid uuid, p_part text, p_nonce text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing   record;
  v_price      int;
  v_dust       bigint;
  v_dust_after bigint;
begin
  -- (0) 멱등: 이미 처리된 nonce면 저장 결과 반환.
  select de.part_key, de.spent_dust into v_existing
    from dust_exchange de
   where de.user_id = p_uid and de.client_nonce = p_nonce;
  if found then
    select coalesce(dust,0) into v_dust_after from user_currency where user_id = p_uid;
    return jsonb_build_object('part_key', v_existing.part_key, 'spent_dust', v_existing.spent_dust, 'dust_after', coalesce(v_dust_after,0));
  end if;

  -- (0.5) 한정템/가격 조회 — 서버 권위. 없으면 invalid_part.
  select dust_price into v_price from gacha_exclusive where part_key = p_part and active;
  if v_price is null then
    raise exception 'invalid_part';
  end if;

  -- (0.6) 이미 보유면 교환 불가(가루 낭비 방지).
  if exists (select 1 from user_cosmetics where user_id = p_uid and part_key = p_part) then
    raise exception 'already_owned';
  end if;

  -- (1) 재화 행 보장 + 가루 잠금.
  insert into user_currency (user_id) values (p_uid) on conflict (user_id) do nothing;
  select dust into v_dust from user_currency where user_id = p_uid for update;

  -- (2) 가루 잔액 확인.
  if v_dust < v_price then
    raise exception 'insufficient_dust';
  end if;

  -- (3) 멱등 로그 선기록(unique 가드로 동시/재시도 방어).
  insert into dust_exchange (user_id, client_nonce, part_key, spent_dust)
    values (p_uid, p_nonce, p_part, v_price);

  -- (4) 차감 + 지급.
  update user_currency set dust = dust - v_price, updated_at = now() where user_id = p_uid
    returning dust into v_dust_after;
  insert into user_cosmetics (user_id, part_key, source) values (p_uid, p_part, 'dust')
    on conflict (user_id, part_key) do nothing;

  return jsonb_build_object('part_key', p_part, 'spent_dust', v_price, 'dust_after', v_dust_after);
end;
$$;

-- (G) 실행권한: public/anon/authenticated 회수 → service_role(Edge Function) 만.
revoke all on function gacha_draw(uuid, text, text) from public;
revoke all on function gacha_draw(uuid, text, text) from anon;
revoke all on function gacha_draw(uuid, text, text) from authenticated;
grant execute on function gacha_draw(uuid, text, text) to service_role;

revoke all on function gacha_exchange(uuid, text, text) from public;
revoke all on function gacha_exchange(uuid, text, text) from anon;
revoke all on function gacha_exchange(uuid, text, text) from authenticated;
grant execute on function gacha_exchange(uuid, text, text) to service_role;
