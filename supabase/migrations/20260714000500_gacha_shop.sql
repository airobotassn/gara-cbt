-- Phase2 경제 — 서버권위 뽑기(gacha)·상점(shop) 원자 트랜잭션.
--  · supabase-js 는 다중문 트랜잭션이 없으므로 차감→지급→로그를 하나의 plpgsql 호출로 원자화한다.
--  · cosmetic-only 하드 불변식: 이 함수들은 user_progress / user_level_skill 을 절대 읽거나 쓰지 않는다.
--    (실력/진화/티어 데이터와 무관한 순수 꾸미기·재화 레이어)
--  · 수치(비용/환급/천장)는 plpgsql 상수로 하드코딩 — 추후 config 로 이관.
--  · 모든 함수: SECURITY DEFINER + set search_path=public + public/anon/authenticated 실행권 회수 + service_role 만 grant.

-- 뽑기 풀 — 풀별 파츠 가중치/희귀 플래그. service-role 전용(RLS enable + 정책 미부여).
create table if not exists gacha_pool (
  pool_key text not null,
  part_key text not null,
  weight int not null default 1,
  is_rare boolean not null default false,
  primary key (pool_key, part_key)
);
alter table gacha_pool enable row level security;

-- 'default' 풀 시드(~6 파츠). 흔함 4 + 희귀 2. weight = 상대 가중치.
insert into gacha_pool (pool_key, part_key, weight, is_rare) values
  ('default', 'hat_common_01',   40, false),
  ('default', 'hat_common_02',   40, false),
  ('default', 'shoe_common_01',  30, false),
  ('default', 'glasses_common_01',30, false),
  ('default', 'wing_rare_01',     5, true),
  ('default', 'crown_rare_01',    5, true)
on conflict (pool_key, part_key) do nothing;

-- ============================================================================
-- gacha_draw: 원자 뽑기. 멱등(user_id,client_nonce). 차감 먼저 → 지급 → 로그.
--   반환 jsonb: {part_key, was_dupe, refund_points, pity_before, points_after}
--   NEVER blank — 항상 파츠 하나를 반환한다(가중 랜덤 + 천장 시 희귀 강제).
-- ============================================================================
create or replace function gacha_draw(p_uid uuid, p_pool text, p_nonce text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- 추후 config 로 이관할 수치 상수
  c_draw_cost    constant int := 100;  -- 1회 뽑기 비용
  c_dupe_refund  constant int := 20;   -- 중복 파츠 환급
  c_pity_ceiling constant int := 50;   -- 천장(이 값 이상이면 희귀 강제)

  v_existing     record;
  v_points       bigint;
  v_pity_before  int;
  v_force_rare   boolean;
  v_rand         double precision;
  v_total        bigint;
  v_part         text;
  v_is_rare      boolean;
  v_was_dupe     boolean := false;
  v_refund       int := 0;
  v_points_after bigint;
begin
  -- (0) 멱등: 이미 처리된 nonce 면 저장된 결과를 재구성해 반환(중복 차감/지급 방지).
  select gl.result_part_key, gl.was_dupe, gl.refund_points, gl.pity_before
    into v_existing
    from gacha_log gl
   where gl.user_id = p_uid and gl.client_nonce = p_nonce;
  if found then
    select coalesce(uc.points, 0) into v_points_after from user_currency uc where uc.user_id = p_uid;
    return jsonb_build_object(
      'part_key',      v_existing.result_part_key,
      'was_dupe',      v_existing.was_dupe,
      'refund_points', v_existing.refund_points,
      'pity_before',   v_existing.pity_before,
      'points_after',  coalesce(v_points_after, 0)
    );
  end if;

  -- (1) 재화 행 보장 + 현재 포인트 잠금.
  insert into user_currency (user_id) values (p_uid) on conflict (user_id) do nothing;
  select points into v_points from user_currency where user_id = p_uid for update;

  -- (2) 비용 확인 — 부족하면 원자 롤백.
  if v_points < c_draw_cost then
    raise exception 'insufficient_points';
  end if;

  -- (3) 차감 먼저(지급 전).
  update user_currency set points = points - c_draw_cost, updated_at = now() where user_id = p_uid;
  v_points_after := v_points - c_draw_cost;

  -- (4) 천장 카운터 읽기.
  select coalesce(counter, 0) into v_pity_before from user_gacha_pity where user_id = p_uid and pool_key = p_pool;
  v_pity_before := coalesce(v_pity_before, 0);
  v_force_rare  := v_pity_before >= c_pity_ceiling;  -- 천장 도달 시 희귀 강제(no-blank)

  -- (5) 가중 랜덤 파츠 선택. 강제 희귀면 희귀 파츠만 후보.
  --     cum(누적합) >= v_rand*total 인 첫 행 = 가중 표본. total 이상은 반드시 존재 → NEVER blank.
  v_rand := random();
  select coalesce(sum(weight), 0) into v_total
    from gacha_pool where pool_key = p_pool and (not v_force_rare or is_rare);
  if coalesce(v_total, 0) <= 0 then
    -- 풀에 후보가 없으면(설정 오류) 강제 희귀를 풀어 전체 풀에서 선택.
    v_force_rare := false;
    select coalesce(sum(weight), 0) into v_total from gacha_pool where pool_key = p_pool;
  end if;

  select s.part_key, s.is_rare into v_part, v_is_rare
    from (
      select gp.part_key, gp.is_rare,
             sum(gp.weight) over (order by gp.part_key rows between unbounded preceding and current row) as cum
        from gacha_pool gp
       where gp.pool_key = p_pool and (not v_force_rare or gp.is_rare)
    ) s
   where s.cum >= v_rand * v_total
   order by s.cum
   limit 1;

  -- 방어적: 부동소수 경계로 못 골랐으면 마지막(최대 cum) 파츠 — 여전히 NEVER blank.
  if v_part is null then
    select gp.part_key, gp.is_rare into v_part, v_is_rare
      from gacha_pool gp
     where gp.pool_key = p_pool and (not v_force_rare or gp.is_rare)
     order by gp.part_key desc
     limit 1;
  end if;

  -- (6) 중복 판정 → 환급 or 신규 지급.
  if exists (select 1 from user_cosmetics where user_id = p_uid and part_key = v_part) then
    v_was_dupe := true;
    v_refund   := c_dupe_refund;
    update user_currency set points = points + c_dupe_refund, updated_at = now() where user_id = p_uid;
    v_points_after := v_points_after + c_dupe_refund;
  else
    insert into user_cosmetics (user_id, part_key, source) values (p_uid, v_part, 'gacha')
      on conflict (user_id, part_key) do nothing;
  end if;

  -- (7) 천장 갱신: 희귀면 0 리셋, 아니면 +1.
  insert into user_gacha_pity (user_id, pool_key, counter)
    values (p_uid, p_pool, case when v_is_rare then 0 else 1 end)
  on conflict (user_id, pool_key) do update
    set counter = case when v_is_rare then 0 else user_gacha_pity.counter + 1 end;

  -- (8) 감사 로그(멱등 가드 = unique(user_id, client_nonce)).
  insert into gacha_log (user_id, pool_key, client_nonce, result_part_key, was_dupe, refund_points, pity_before)
    values (p_uid, p_pool, p_nonce, v_part, v_was_dupe, v_refund, v_pity_before);

  return jsonb_build_object(
    'part_key',      v_part,
    'was_dupe',      v_was_dupe,
    'refund_points', v_refund,
    'pity_before',   v_pity_before,
    'points_after',  v_points_after
  );
end;
$$;

-- 상점 카탈로그 — 구매 가능 파츠/가격/활성. 가격은 공개 조회(상점 UI), 권위는 서버.
create table if not exists shop_catalog (part_key text primary key, price int not null, active boolean not null default true);
alter table shop_catalog enable row level security;
drop policy if exists "shop_catalog_select_all" on shop_catalog;
create policy "shop_catalog_select_all" on shop_catalog for select using (true);
insert into shop_catalog(part_key,price) values ('hat_common_01',200),('hat_common_02',200),('shoe_common_01',200),('glasses_common_01',200),('wing_rare_01',800),('crown_rare_01',800) on conflict (part_key) do nothing;

-- ============================================================================
-- shop_buy: 원자 구매. 멱등(user_id,client_nonce). 차감 → 지급 → 로그.
--   반환 jsonb: {part_key, spent_points, points_after}
-- ============================================================================
create or replace function shop_buy(p_uid uuid, p_part text, p_nonce text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing     record;
  v_points       bigint;
  v_points_after bigint;
  v_price        int;
begin
  -- (0) 멱등: 이미 처리된 nonce 면 저장된 결과 반환.
  select sp.part_key, sp.spent_points into v_existing
    from shop_purchase sp
   where sp.user_id = p_uid and sp.client_nonce = p_nonce;
  if found then
    select coalesce(uc.points, 0) into v_points_after from user_currency uc where uc.user_id = p_uid;
    return jsonb_build_object(
      'part_key',     v_existing.part_key,
      'spent_points', v_existing.spent_points,
      'points_after', coalesce(v_points_after, 0)
    );
  end if;

  -- (0.5) 카탈로그 가격 조회 — 서버 권위. 클라이언트 값 무시. 없으면 invalid_part.
  select price into v_price from shop_catalog where part_key = p_part and active;
  if v_price is null then
    raise exception 'invalid_part';
  end if;

  -- (1) 재화 행 보장 + 잠금.
  insert into user_currency (user_id) values (p_uid) on conflict (user_id) do nothing;
  select points into v_points from user_currency where user_id = p_uid for update;

  -- (2) 잔액 확인.
  if v_points < v_price then
    raise exception 'insufficient_points';
  end if;

  -- (3) 차감.
  update user_currency set points = points - v_price, updated_at = now() where user_id = p_uid;
  v_points_after := v_points - v_price;

  -- (4) 파츠 지급(중복이면 무시 — 결제는 유효, 멱등 로그로 재구매 차단).
  insert into user_cosmetics (user_id, part_key, source) values (p_uid, p_part, 'shop')
    on conflict (user_id, part_key) do nothing;

  -- (5) 결제 로그(멱등 가드 = unique(user_id, client_nonce)).
  insert into shop_purchase (user_id, client_nonce, part_key, spent_points)
    values (p_uid, p_nonce, p_part, v_price);

  return jsonb_build_object(
    'part_key',     p_part,
    'spent_points', v_price,
    'points_after', v_points_after
  );
end;
$$;

-- 실행권한: public/anon/authenticated 회수 → service_role(Edge Function) 만 실행.
revoke all on function gacha_draw(uuid, text, text) from public;
revoke all on function gacha_draw(uuid, text, text) from anon;
revoke all on function gacha_draw(uuid, text, text) from authenticated;
grant execute on function gacha_draw(uuid, text, text) to service_role;

revoke all on function shop_buy(uuid, text, text) from public;
revoke all on function shop_buy(uuid, text, text) from anon;
revoke all on function shop_buy(uuid, text, text) from authenticated;
grant execute on function shop_buy(uuid, text, text) to service_role;
