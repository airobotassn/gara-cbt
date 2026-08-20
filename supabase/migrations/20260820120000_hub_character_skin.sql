-- ============================================================================
-- 허브 캐릭터 선택 · 튜토리얼 · 스킨 (2026-08-20)
--
-- 신규 가입자가 /hub 에 처음 들어오면 캐릭터를 고르고 튜토리얼을 본다.
-- 그 뒤로는 상점에서 캐릭터·스킨을 코인으로 사서 인벤토리에서 갈아입는다.
--
-- 설계 요점
--  · 소유는 **`user_cosmetics` 하나**로 통일한다(가구·캐릭터·스킨이 전부 part_key 다).
--    표를 따로 파면 상점·인벤토리·환불이 종류마다 두 벌이 된다.
--  · 장착은 `user_characters` 한 행 — 캐릭터는 `base_key`, 나머지는 `equipped` jsonb.
--    ⚠️ 스킨을 별도 컬럼으로 빼지 않는다. 나중에 종류(테두리·이펙트…)가 늘면 컬럼이 계속 는다.
--  · 첫 선택이 무료인 대상은 **`price = 0` 인 캐릭터로만** 한정한다.
--    ⚠️ "kind='character' 면 첫 선택 무료" 로 두면 나중에 넣을 유료 캐릭터를
--       첫 선택 한 번으로 공짜로 가져간다. 값이 곧 자격이라 조건을 따로 관리하지 않는다.
--  · 그림·9패치 자르는 값은 여기 없다 — 코드/에셋이다(`src/lib/hubCosmetics.ts` · `hub.css`).
--    DB 는 **가격·판매여부·진열순서**만 안다(관리자가 만지는 것도 그 셋뿐).
-- ============================================================================

-- ── 1) 장착 행에 진행 표시 두 칸 ────────────────────────────────────────────
--  chosen_at        = 캐릭터를 한 번이라도 골랐나(=첫 선택 무료를 이미 썼나)
--  tutorial_done_at = 튜토리얼을 끝냈나(건너뛰기도 '끝'으로 친다 — 다시 강제하지 않는다)
--  ⚠️ 둘 다 서버에 둔다. localStorage 로 판정하면 브라우저를 바꾸거나 지우는 순간 다시 강제된다.
alter table user_characters add column if not exists chosen_at        timestamptz;
alter table user_characters add column if not exists tutorial_done_at timestamptz;

-- ── 2) 상점 카탈로그: 종류·진열순서 보강 ────────────────────────────────────
-- kind·sort_order 는 방 꾸미기(20260814090000)에서 들어왔지만, 그 마이그레이션을
-- 안 탄 DB 도 있을 수 있어 여기서 한 번 더 보장한다(이미 있으면 무시된다).
alter table shop_catalog add column if not exists kind       text not null default 'part';
alter table shop_catalog add column if not exists surface    text;
alter table shop_catalog add column if not exists sort_order int  not null default 0;

-- ⚠️ CHECK 을 걸지 않는다 — 종류가 늘 때마다 마이그레이션이 필요해지고,
--    모르는 kind 는 화면이 그냥 안 그리므로(각 화면이 자기 kind 만 필터) 사고가 아니다.

-- ── 3) 시드: 캐릭터 6종(3계열 × 남/여) + 스킨 1벌 ───────────────────────────
-- ⚠️ **키는 만들 때만 정한다.** 나중에 바꾸면 그 캐릭터를 산 사람의 user_cosmetics 행이
--    통째로 고아가 되고, 장착값(base_key)도 가리킬 곳을 잃는다.
--    계열을 a·b·c 로 둔 이유 = 그림이 아직 없어 이름을 확정할 수 없어서다.
--    표시 이름은 사전(`hub.char.<key>`)이 정하므로 이름은 나중에 얼마든지 바꿀 수 있다.
--
-- 첫 선택 대상이므로 여섯 종 전부 price = 0 이다. 유료 캐릭터를 추가할 땐 price > 0 으로 넣으면
-- 첫 선택 화면에서 자동으로 빠지고 상점에만 뜬다(코드에 목록을 또 두지 않는다).
insert into shop_catalog (part_key, price, kind, sort_order, active) values
  ('char_a_m', 0, 'character', 10, true),
  ('char_a_f', 0, 'character', 11, true),
  ('char_b_m', 0, 'character', 20, true),
  ('char_b_f', 0, 'character', 21, true),
  ('char_c_m', 0, 'character', 30, true),
  ('char_c_f', 0, 'character', 31, true)
on conflict (part_key) do nothing;

-- 기본 스킨(palace)은 **판매하지 않는다** — 전원이 처음부터 쓰는 바탕이라 살 물건이 아니다.
-- 상점에는 안 뜨지만(active=false) 인벤토리에는 항상 있는 것으로 화면이 취급한다.
insert into shop_catalog (part_key, price, kind, sort_order, active) values
  ('skin_palace', 0, 'skin', 100, false)
on conflict (part_key) do nothing;

-- ============================================================================
-- hub_choose_character: 캐릭터 선택(첫 선택 = 무료 지급 + 장착 / 이후 = 소유한 것만 장착)
--   반환 jsonb: {base_key, first}
--
-- ⚠️ 두 가지를 한 트랜잭션에서 한다 — 지급과 장착이 갈리면 "샀는데 못 입는" 상태가 남는다.
-- ⚠️ 첫 선택 판정은 잠금(for update) 뒤에 본다. 앞에서 보면 동시 2발이 나란히 통과해
--    무료 캐릭터를 두 개 가져간다.
-- ============================================================================
create or replace function hub_choose_character(p_uid uuid, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chosen timestamptz;
  v_price  int;
  v_first  boolean;
begin
  if p_uid is null then
    raise exception 'unauthorized';
  end if;

  -- (0) 실재하는 캐릭터인가. 가격도 같이 읽는다(첫 선택 무료 자격 판정에 쓴다).
  --     active 를 보지 않는 이유 — 진열에서 내린 캐릭터도 **이미 가진 사람은 계속 입어야** 한다.
  select price into v_price
    from shop_catalog where part_key = p_key and kind = 'character';
  if v_price is null then
    raise exception 'invalid_character';
  end if;

  -- (1) 장착 행 보장 + 잠금. 이 잠금이 아래 '첫 선택인가' 판정의 유일한 근거다.
  insert into user_characters (user_id) values (p_uid) on conflict (user_id) do nothing;
  select chosen_at into v_chosen from user_characters where user_id = p_uid for update;
  v_first := v_chosen is null;

  if v_first then
    -- (2a) 첫 선택 — 무료 지급 대상(price = 0)만. 유료 캐릭터를 첫 선택으로 가져가지 못하게 막는다.
    if v_price <> 0 then
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

-- ============================================================================
-- hub_equip: 캐릭터 외 꾸미기(스킨 등) 장착. 소유한 것만.
--   p_kind = equipped jsonb 의 키('skin' …). 캐릭터는 hub_choose_character 를 쓴다.
--
-- ⚠️ equipped 를 통째로 덮어쓰지 않고 `||` 로 한 키만 갱신한다 — 통째로 쓰면
--    나중에 종류가 늘었을 때 한 종류를 바꾸는 요청이 나머지를 전부 지운다.
-- ============================================================================
create or replace function hub_equip(p_uid uuid, p_kind text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row_kind text;
begin
  if p_uid is null then
    raise exception 'unauthorized';
  end if;
  if p_kind is null or p_kind = '' or p_kind = 'character' then
    -- 캐릭터는 첫 선택 무료 규칙이 걸려 있어 전용 함수로만 바꾼다.
    raise exception 'invalid_kind';
  end if;

  -- 종류가 맞는 물건인가 — 스킨 자리에 가구를 꽂는 걸 막는다.
  select kind into v_row_kind from shop_catalog where part_key = p_key;
  if v_row_kind is null or v_row_kind <> p_kind then
    raise exception 'invalid_part';
  end if;

  -- 기본 스킨(price 0 · 비판매)은 전원이 가진 것으로 친다 — 살 수 없는 물건이라
  -- 소유 검사를 그대로 적용하면 아무도 기본으로 되돌아갈 수 없다.
  if not exists (select 1 from shop_catalog where part_key = p_key and price = 0)
     and not exists (select 1 from user_cosmetics where user_id = p_uid and part_key = p_key) then
    raise exception 'not_owned';
  end if;

  insert into user_characters (user_id) values (p_uid) on conflict (user_id) do nothing;
  update user_characters
     set equipped   = coalesce(equipped, '{}'::jsonb) || jsonb_build_object(p_kind, p_key),
         updated_at = now()
   where user_id = p_uid;

  return jsonb_build_object('kind', p_kind, 'key', p_key);
end;
$$;
revoke all on function hub_equip(uuid, text, text) from public, anon, authenticated;

-- ============================================================================
-- hub_tutorial_done: 튜토리얼 완료 표시. 건너뛰기도 완료로 친다.
--   ⚠️ 이미 찍혀 있으면 덮지 않는다 — '처음 끝낸 시각'이 흔들릴 이유가 없다.
-- ============================================================================
create or replace function hub_tutorial_done(p_uid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_uid is null then
    raise exception 'unauthorized';
  end if;
  insert into user_characters (user_id) values (p_uid) on conflict (user_id) do nothing;
  update user_characters
     set tutorial_done_at = coalesce(tutorial_done_at, now()),
         updated_at       = now()
   where user_id = p_uid;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function hub_tutorial_done(uuid) from public, anon, authenticated;

-- ── 4) 첫 진입 상태 초기화(관리자)에 캐릭터·튜토리얼도 포함 ──────────────────
-- 관리자 › 회원 상세 › '첫 진입 상태로 초기화'(20260819170000)는 신규 가입 흐름을 다시 태우는
-- 조작이다. 캐릭터 선택·튜토리얼이 그 흐름에 새로 들어왔으므로 여기도 같이 비워야
-- "초기화했는데 캐릭터 선택은 안 뜨는" 반쪽 상태가 안 생긴다.
--   ⚠️ **소유(user_cosmetics)는 지우지 않는다.** 산 물건을 뺏는 건 초기화가 아니라 몰수다.
--      첫 선택 무료만 되살아나고, 이미 가진 캐릭터는 그대로 인벤토리에 있다.
-- ⚠️ 반환형(void)·인자를 그대로 둔다 — `create or replace` 는 반환형을 못 바꾸고,
--    이전 값 로그와 '회원 없음' 판정은 이미 `admin` 함수(resetOnboarding)가 하고 있다.
create or replace function admin_reset_onboarding(p_uid uuid)
  returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.allow_region_change', 'on', true);
  update profiles
     set nickname_set_at  = null,
         region_locked_at = null,
         region_changed_at = null,
         country_code     = null,
         region_code      = null,
         age_band         = null
   where id = p_uid;

  -- 캐릭터 선택·튜토리얼도 가입 직후로 되돌린다. 행이 없으면 만들지 않는다 — 없는 게 곧 미선택이다.
  update user_characters
     set base_key         = 'default',
         chosen_at        = null,
         tutorial_done_at = null,
         updated_at       = now()
   where user_id = p_uid;
end $$;

revoke all on function admin_reset_onboarding(uuid) from public, anon, authenticated;
