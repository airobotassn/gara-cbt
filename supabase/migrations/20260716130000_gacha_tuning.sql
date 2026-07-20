-- Phase2 경제 v2 튜닝 — 한정템을 조금 더 귀하게.
--  · 천장 10→15회, 즉시 한정템 확률 8%→5%, 가루 교환가 150→250.
--  · 비용(20)·회당 가루(10~20)·천장 보너스(+50)는 유지.
--  · gacha_draw 는 함수 전체 재정의(create or replace) — 상수 2개만 변경.

-- (A) 교환가 상향(기존 150 → 250).
update gacha_exclusive set dust_price = 250 where dust_price = 150;

-- (B) gacha_draw 재정의 — c_pity_ceiling 15, c_lucky_pct 5.
create or replace function gacha_draw(p_uid uuid, p_pool text, p_nonce text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_draw_cost    constant int := 20;   -- 1회 뽑기 비용(코인)
  c_pity_ceiling constant int := 15;   -- 천장(이 뽑기가 n회째면 한정템 강제)
  c_dust_min     constant int := 10;   -- 회당 가루 최소
  c_dust_max     constant int := 20;   -- 회당 가루 최대
  c_lucky_pct    constant int := 5;    -- 일반 뽑기 한정템 즉시 획득 확률(%)
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

revoke all on function gacha_draw(uuid, text, text) from public;
revoke all on function gacha_draw(uuid, text, text) from anon;
revoke all on function gacha_draw(uuid, text, text) from authenticated;
grant execute on function gacha_draw(uuid, text, text) to service_role;
