-- ============================================================================
-- 허브 캐릭터에 값 매기기 — 첫 선택은 공짜, 상점의 캐릭터는 500 (2026-08-24)
--
-- 무엇이 바뀌나
--   · 캐릭터 6종 전부 **500코인**(배경은 그대로 — 낮 0 · 밤 300).
--   · 첫 선택(신규 회원)은 **값과 무관하게 판매 중인 캐릭터 아무거나 한 종을 공짜로** 준다.
--     두 번째부터는 상점에서 500 을 내고 산 것만 갈아입는다.
--
-- 왜 규칙까지 손대야 했나
--   여태 '첫 선택 후보'의 자격이 **값 0** 이었다(값이 곧 자격이라 후보 목록을 따로 두지 않으려고).
--   그 상태로 6종을 500 으로 올리면 신규 회원이 첫 화면에서 고를 게 하나도 없어 **허브에 갇힌다** —
--   그래서 관리자 저장도 그걸 막고 있었고(무료 캐릭터 0종 금지), 값을 올릴 방법 자체가 없었다.
--   자격을 값에서 **판매 중(active)** 으로 옮기면 "첫 선택은 공짜, 그 뒤는 500" 이 그대로 성립한다.
--
-- ⚠️ **대가: 앞으로 넣는 비싼 캐릭터도 첫 선택으로는 공짜로 가져간다.** 그걸 막아야 할 때가 오면
--    `shop_catalog` 에 '첫 선택 후보' 플래그를 따로 만들어 자격을 값과 완전히 분리할 것 —
--    그때 아래 판정 한 줄(active → starter)만 갈면 된다.
-- ⚠️ 이미 캐릭터를 고른 사람은 아무 영향이 없다 — chosen_at 이 찍혀 있으면 (2b) 로만 간다.
-- ⚠️ 500 은 시작값이다(관리자 화면 WORLD ARENA > 꾸미기 관리에서 바꾼다). 코인 수입은
--    하루 1회 10코인(출석·학습 통틀어)이 유일하므로 500 ≒ 50일치 · 300 ≒ 30일치다.
-- ============================================================================

-- ── 1) 값 매기기 ────────────────────────────────────────────────────────────
-- 진열에서 내린 캐릭터(active=false)도 같이 올린다 — 다시 진열할 때 값이 0이면 그 순간
-- 상점에 공짜 캐릭터가 하나 서 있게 된다.
update shop_catalog set price = 500 where kind = 'character' and price = 0;

-- ============================================================================
-- hub_choose_character: 캐릭터 선택(첫 선택 = 무료 지급 + 장착 / 이후 = 소유한 것만 장착)
--   반환 jsonb: {base_key, first}
--
-- 20260820120000 의 것과 **첫 선택 자격 판정 한 줄만 다르다**(price = 0 → active).
-- ⚠️ 두 가지를 한 트랜잭션에서 한다 — 지급과 장착이 갈리면 "샀는데 못 입는" 상태가 남는다.
-- ⚠️ 첫 선택 판정은 잠금(for update) 뒤에 본다. 앞에서 보면 동시 2발이 나란히 통과해
--    캐릭터를 두 개 가져간다.
-- ============================================================================
create or replace function hub_choose_character(p_uid uuid, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chosen timestamptz;
  v_active boolean;
  v_first  boolean;
begin
  if p_uid is null then
    raise exception 'unauthorized';
  end if;

  -- (0) 실재하는 캐릭터인가. 판매 여부도 같이 읽는다(첫 선택 무료 자격 판정에 쓴다).
  --     여기서 active 로 **걸러내면 안 된다** — 진열에서 내린 캐릭터도 이미 가진 사람은
  --     계속 입어야 한다. 그래서 값만 읽고 판정은 첫 선택 분기 안에서 한다.
  select active into v_active
    from shop_catalog where part_key = p_key and kind = 'character';
  if v_active is null then
    raise exception 'invalid_character';
  end if;

  -- (1) 장착 행 보장 + 잠금. 이 잠금이 아래 '첫 선택인가' 판정의 유일한 근거다.
  insert into user_characters (user_id) values (p_uid) on conflict (user_id) do nothing;
  select chosen_at into v_chosen from user_characters where user_id = p_uid for update;
  v_first := v_chosen is null;

  if v_first then
    -- (2a) 첫 선택 — **판매 중인 캐릭터라면 값과 무관하게** 한 종을 공짜로 준다.
    --      진열에서 내린 것은 준다는 말을 한 적이 없으므로 거절한다(선택 화면도 안 보여준다 —
    --      get-hub 가 active 만 내려준다).
    if not v_active then
      raise exception 'not_owned';
    end if;
    insert into user_cosmetics (user_id, part_key, source)
      values (p_uid, p_key, 'starter')
      on conflict (user_id, part_key) do nothing;
  else
    -- (2b) 갈아입기 — 소유한 것만. 상점을 거치지 않고 장착하는 경로를 여기서 끊는다.
    if not exists (select 1 from user_cosmetics where user_id = p_uid and part_key = p_key) then
      raise exception 'not_owned';
    end if;
  end if;

  -- (3) 장착. chosen_at 은 **처음 값을 지킨다**(coalesce) — 갈아입을 때마다 밀면
  --     "첫 선택을 언제 했나"가 사라지고 첫 선택 무료가 다시 열린다.
  update user_characters
     set base_key   = p_key,
         chosen_at  = coalesce(chosen_at, now()),
         updated_at = now()
   where user_id = p_uid;

  return jsonb_build_object('base_key', p_key, 'first', v_first);
end;
$$;
revoke all on function hub_choose_character(uuid, text) from public, anon, authenticated;
