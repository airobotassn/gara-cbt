-- 칭호(자격증 배지)를 **사용자가 고른다** — 최상위 자동 선정을 걷어낸다.
--
-- 무엇이 틀어져 있었나:
--   배지에 뜨는 칭호를 `exam_tiers.sort` 내림차순 [0] 으로 서버가 정했다. 급수가 서열이 아니라
--   **각각 독립된 자격**인데(2026-07 개편 · 20260807130000), 그중 하나를 코드가 골라 주고 있었다.
--   비기너로 딴 자격을 달고 싶은 사람에게 방법이 없다.
--
-- 바뀌는 것:
--   · 고른 값은 `user_characters.equipped->>'title'` 에 담는다 — 캐릭터·스킨과 같은 자리다.
--     ⚠️ profiles 가 아닌 이유: 칭호를 읽는 세 곳(get-hub·leaderboard·room)이 **이미 이 행을 읽고 있어서**
--        조회가 한 번도 안 늘어난다. 쓰기도 hub_equip 옆에 붙어 브라우저 직접 update 경로가 안 생긴다.
--   · `user_titles` 반환 **계약은 그대로**([{tier, exam_title}] 배열, [0] 이 화면에 뜨는 칭호).
--     정렬 근거만 `sort 내림차순` → **고른 것 우선, 나머지는 최근 합격순** 으로 바뀐다.
--     그래서 소비처 세 곳은 주석만 고치면 되고, 아직 안 고른 사람은 **가장 최근에 합격한 급수**가 뜬다.
--   · 합격 판정이 응시 시점 값을 본다 — `coalesce(pass_ratio_snapshot, 0.6)`.
--     여태 0.60 하드코딩이었다(스냅샷 칸은 있는데 아무도 안 썼다). 관리자 화면이 급수별 합격선을
--     약속하고 있었으므로 여기가 그 약속을 지키는 자리다.
--     ⚠️ 스냅샷이 빈 옛 응시는 0.6 이다 — 그때는 그 값이 유일한 규칙이었다. 지금 급수 설정을 끌어다
--        쓰면 관리자가 합격선을 고칠 때마다 **과거 합격이 흔들린다**.
--
-- 안 바뀌는 것: 구매·뽑기 불가(응시 기록에서만 파생), certificates 표 없음, service_role 전용 실행권.
--
-- ⚠️ `exam_tiers.sort` 는 이 마이그레이션이 **안 지운다** — 지우는 건 20260904210000 이고,
--    그건 **코드 배포가 끝난 뒤에** 적용해야 한다(배포 전 코드가 이름으로 select 하면 PostgREST 400).

-- ── 합격한 급수 목록 — 합격 판정의 SQL 단일 출처 ──────────────────────────────
-- user_titles(보여주기)와 hub_equip_title(고르기)이 같은 술어를 봐야 한다. 두 벌이 되면
-- "화면에는 있는데 고르면 거절당하는" 급수가 생긴다.
create or replace function public.user_earned_tiers(p_uid uuid)
returns table (tier text, exam_title text, submitted_at timestamptz)
language sql stable security definer set search_path = public as $$
  -- 같은 급수를 여러 회차에서 합격했을 수 있다 → 급수당 1행(가장 최근 합격).
  select distinct on (t.tier) t.tier, e.title, ea.submitted_at
  from exam_attempts ea
  join exams e on e.id = ea.exam_id
  -- inner join 이 의도다: exam_tiers 에 없는 옛/오타 급수는 칭호로 만들지 않는다
  -- (exams.tier 에는 CHECK 이 없어서 실제로 들어갈 수 있다 — 20260807090000 주석 참고).
  join exam_tiers t on t.tier = e.tier
  where ea.user_id = p_uid
    and ea.status = 'submitted'
    and ea.total_questions > 0
    and ea.total_correct >= ceil(ea.total_questions * coalesce(ea.pass_ratio_snapshot, 0.6))
  order by t.tier, ea.submitted_at desc nulls last;
$$;
comment on function public.user_earned_tiers(uuid) is
  '합격한 급수(응시 시점 합격선 기준). user_titles·hub_equip_title 이 같이 본다.';
revoke execute on function public.user_earned_tiers(uuid) from public, anon, authenticated;
grant  execute on function public.user_earned_tiers(uuid) to service_role;

-- ── 칭호 목록 — [0] 이 지금 달고 있는 칭호 ────────────────────────────────────
create or replace function public.user_titles(p_uid uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('tier', tier, 'exam_title', exam_title)
      -- 고른 것 먼저 → 그다음 최근 합격순. tier 는 동점(같은 시각) 때 순서를 못 박는 tiebreak.
      order by is_active desc, submitted_at desc nulls last, tier),
    '[]'::jsonb)
  from (
    select e.tier, e.exam_title, e.submitted_at,
           -- ⚠️ coalesce 로 감싸는 게 핵심이다 — 아무것도 안 고른 사람은 비교가 null 이 되고,
           --    `order by ... desc` 는 null 을 맨 앞에 두므로 정렬이 통째로 뒤집힌다.
           coalesce(e.tier = (select nullif(uc.equipped ->> 'title', '')
                                from user_characters uc where uc.user_id = p_uid), false) as is_active
    from public.user_earned_tiers(p_uid) e
  ) x;
$$;
comment on function public.user_titles(uuid) is
  '구매/뽑기 불가 — exam_attempts 합격에서만 파생. [0] = 사용자가 고른 칭호(안 골랐으면 최근 합격).';
revoke execute on function public.user_titles(uuid) from public, anon, authenticated;
grant  execute on function public.user_titles(uuid) to service_role;

-- ── 칭호 장착 ────────────────────────────────────────────────────────────────
-- hub_equip 을 재사용하지 않는 이유: 그건 shop_catalog 에서 kind 를 확인한다(사는 물건 전용).
-- 칭호는 파는 물건이 아니라 **합격으로만 얻는 것**이라 검증 자리가 다르다.
create or replace function public.hub_equip_title(p_uid uuid, p_tier text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  -- ⚠️ equipped 를 통째로 덮어쓰지 않고 `||` 로 한 키만 갱신한다(hub_equip 과 같은 이유) —
  --    통째로 쓰면 칭호를 바꾸는 요청이 입고 있던 스킨을 지운다.
  insert into user_characters (user_id) values (p_uid) on conflict (user_id) do nothing;
  update user_characters
     set equipped   = coalesce(equipped, '{}'::jsonb) || jsonb_build_object('title', p_tier),
         updated_at = now()
   where user_id = p_uid;

  return jsonb_build_object('title', p_tier);
end;
$$;
comment on function public.hub_equip_title(uuid, text) is
  '칭호 장착 — 합격한 급수만. equipped.title 한 키만 갱신한다.';
revoke all    on function public.hub_equip_title(uuid, text) from public, anon, authenticated;
grant  execute on function public.hub_equip_title(uuid, text) to service_role;
