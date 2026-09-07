-- 2026-09-04 · user_characters.equipped(jsonb) → skin_key · title_tier 컬럼 (2026-09-04 지시)
--
--   왜 — 안에 든 게 **값 하나짜리 둘**뿐인데 jsonb 를 쓰고 있었다(`{"skin":…, "title":…}`).
--   jsonb 는 키가 늘어날 수 있을 때 값어치가 있는데 꾸미기 슬롯은 고정이다. 컬럼으로 두면
--   이름이 곧 설명이고, 인덱스도 걸리고, 뭐가 들었는지 보려고 행을 열어볼 필요가 없다.
--
--   ⚠️ 성격이 다른 둘이 한 칸에 섞여 있던 것도 문제였다:
--        skin  = 코인으로 **사서 입는 것** (user_cosmetics 에 보유 기록이 남는다)
--        title = 시험에 붙어 **따서 다는 것** (보유 기록이라는 개념이 없다 — 합격 이력이 곧 소유다)
--
--   ⛔ **이 파일은 컬럼을 만들고 양쪽에 같이 쓰기만 한다.** equipped 드롭은 코드 배포 뒤에
--      20260904520000 이 한다 — 배포 전 엣지 함수(get-hub·leaderboard·room·admin/reform)가
--      equipped 를 이름으로 select 해서, 먼저 지우면 허브·랭킹·남의 방이 통째로 400 이다.
--      그 사이 hub_equip/hub_equip_title 이 **두 자리 다 갱신**하므로 옛 코드도 계속 맞는 값을 본다.

begin;

alter table user_characters add column if not exists skin_key   text;
alter table user_characters add column if not exists title_tier text;

-- 백필 — 지금 13행 중 skin 은 6행에 있고 title 은 0행이다(칭호를 고른 사람이 아직 없다).
update user_characters
   set skin_key   = nullif(equipped ->> 'skin', ''),
       title_tier = nullif(equipped ->> 'title', '')
 where equipped is not null;

-- ── 스킨 장착 ─────────────────────────────────────────────────────
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
  -- ⚠️ 지금 컬럼이 있는 종류는 skin 뿐이다. 새 슬롯을 열면 **컬럼을 하나 더 만들고** 여기에
  --    분기를 추가할 것 — jsonb 로 되돌리지 말 것(그게 이 마이그레이션이 없앤 것이다).
  if p_kind <> 'skin' then
    raise exception 'invalid_kind';
  end if;

  -- 종류가 맞는 물건인가 — 스킨 자리에 다른 것을 꽂는 걸 막는다.
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
  -- ⛔ 이행 기간 동안 **두 자리 다** 갱신한다 — 배포 전 엣지 함수가 아직 equipped 를 읽는다.
  --    20260904520000 이 equipped 를 드롭할 때 이 줄도 같이 없어진다.
  update user_characters
     set skin_key   = p_key,
         equipped   = coalesce(equipped, '{}'::jsonb) || jsonb_build_object(p_kind, p_key),
         updated_at = now()
   where user_id = p_uid;

  return jsonb_build_object('kind', p_kind, 'key', p_key);
end;
$function$;

-- ── 칭호 장착 ─────────────────────────────────────────────────────
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
  -- ⛔ 이행 기간 동안 두 자리 다 갱신(위와 같은 이유).
  --    ⚠️ equipped 는 `||` 로 한 키만 민다 — 통째로 쓰면 칭호를 바꾸는 요청이 스킨을 지운다.
  --       컬럼으로 갈라진 뒤에는 이 위험 자체가 없어진다(서로 다른 칸이라 덮을 수가 없다).
  update user_characters
     set title_tier = p_tier,
         equipped   = coalesce(equipped, '{}'::jsonb) || jsonb_build_object('title', p_tier),
         updated_at = now()
   where user_id = p_uid;

  return jsonb_build_object('title', p_tier);
end;
$function$;

-- ── 칭호 목록 ─────────────────────────────────────────────────────
--   반환 계약은 그대로다([0] 이 화면에 뜨는 칭호). 읽는 자리만 컬럼으로 바꾼다.
create or replace function public.user_titles(p_uid uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    jsonb_agg(jsonb_build_object('tier', tier, 'exam_title', exam_title)
      -- 고른 것 먼저 → 그다음 최근 합격순. tier 는 동점(같은 시각) 때 순서를 못 박는 tiebreak.
      order by is_active desc, submitted_at desc nulls last, tier),
    '[]'::jsonb)
  from (
    select e.tier, e.exam_title, e.submitted_at,
           -- ⚠️ coalesce 로 감싸는 게 핵심이다 — 아무것도 안 고른 사람은 비교가 null 이 되고,
           --    `order by ... desc` 는 null 을 맨 앞에 두므로 정렬이 통째로 뒤집힌다.
           coalesce(e.tier = (select nullif(uc.title_tier, '')
                                from user_characters uc where uc.user_id = p_uid), false) as is_active
    from public.user_earned_tiers(p_uid) e
  ) x;
$function$;

commit;
