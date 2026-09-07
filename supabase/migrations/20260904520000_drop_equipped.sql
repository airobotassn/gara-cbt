-- 2026-09-04 · user_characters.equipped(jsonb) 드롭 — 2단계
--   (1단계 = 20260904510000 이 skin_key·title_tier 를 만들고 백필했다. 그 사이에 코드를 배포했다.)
--
--   이제 읽는 자리가 없다 — get-hub·leaderboard·room·admin/reform 전부 컬럼을 본다.
--   hub_equip·hub_equip_title 의 '두 자리 다 쓰기' 도 여기서 한 자리로 줄인다.
--
--   ⛔ jsonb 로 되돌리지 말 것. 안에 든 게 값 하나짜리 둘뿐이라 얻는 게 없고, 실제로 사고가
--      하나 자라고 있었다 — 관리자 꾸미기 관리가 `Object.values(equipped)` 로 착용을 세는 바람에
--      **칭호(급수 키)가 '착용 중인 꾸미기' 로 세어질 참**이었다(칭호를 고른 사람이 0명이라 아직 안 터졌다).
--      슬롯이 늘면 컬럼을 하나 더 만들 것.

begin;

create or replace function public.hub_equip(p_uid uuid, p_kind text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  -- ⚠️ 지금 컬럼이 있는 종류는 skin 뿐이다. 새 슬롯을 열면 컬럼을 하나 더 만들고 여기에 분기를 추가할 것.
  if p_kind <> 'skin' then
    raise exception 'invalid_kind';
  end if;

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
  update user_characters set skin_key = p_key, updated_at = now() where user_id = p_uid;

  return jsonb_build_object('kind', p_kind, 'key', p_key);
end;
$function$;

create or replace function public.hub_equip_title(p_uid uuid, p_tier text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_uid is null then
    raise exception 'unauthorized';
  end if;
  if p_tier is null or p_tier = '' then
    raise exception 'invalid_title';
  end if;
  -- 안 딴 자격을 달 수 없다. 화면이 잠금 배지를 그려도 방어선은 여기다.
  if not exists (select 1 from public.user_earned_tiers(p_uid) t where t.tier = p_tier) then
    raise exception 'not_earned';
  end if;

  insert into user_characters (user_id) values (p_uid) on conflict (user_id) do nothing;
  -- ⚠️ 컬럼이 갈라진 뒤로는 "칭호를 바꾸다 스킨을 지운다" 는 위험 자체가 없다(서로 다른 칸이다).
  update user_characters set title_tier = p_tier, updated_at = now() where user_id = p_uid;

  return jsonb_build_object('title', p_tier);
end;
$function$;

alter table user_characters drop column if exists equipped;

commit;
