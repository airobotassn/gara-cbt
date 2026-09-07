-- 2026-09-04 · 시즌 번호를 실제로 채운다 + 올해를 0시즌으로 (2026-09-04 지시)
--
--   ⛔ **뿌리 문제: user_progress.season_id 를 채우는 코드가 한 줄도 없었다.**
--      컬럼은 2026-07-21(20260721010000)에 만들었는데 연결을 안 해서 두 달간 21명 전부 null 이었다.
--      그 값을 snapshot_ranking_history 가 그대로 복사하므로 ranking_history 526건도 전부 null 이다.
--
--   왜 문제가 되나 — 시즌 리셋 크론(`season-reset-halfyear`, `0 0 1 1,7 *`)이 **2027-01-01 에 돈다.**
--   그때 활동점수가 0으로 밀리는데, 순위 기록에 시즌 번호가 없으면 순위 추이 그래프가 작년 기록과
--   올해 기록을 **한 줄로 이어서** 그린다 — 시즌 리셋을 '순위 폭락'으로 보여준다.
--
--   고치는 것 셋:
--     ① 지금 회원 21명 + 옛 순위 526건에 활성 시즌 id 백필
--     ② reset_season 이 새 시즌을 만들 때 user_progress.season_id 도 같이 박게 한다
--     ③ 시즌 코드 정리 — 올해는 **0시즌(테스트)**, 내년부터 1시즌(2026-09-04 지시)
--
--   ③ 관련 ⚠️ 옛 reset_season 은 다음 코드를 `연도 || '-S' || **직전 시즌 id**` 로 만들었다.
--      지금 id 가 1이라 우연히 `2027-S1` 이 나오지만, 그 다음엔 `2028-S2` 처럼 한 칸씩 밀린다
--      (새 시즌 id 는 3인데 코드는 S2). **새로 만든 시즌의 id** 로 짓도록 바꾼다.

begin;

-- ── ③ 올해 = 0시즌 ────────────────────────────────────────────────
--   id 는 1이지만 코드는 S0 다 — 사람이 읽는 이름과 내부 순번은 별개다(내부 id 를 0부터 시작시킬 수 없다).
update ranking_season set code = '2026-S0' where id = 1 and code = '2026Q3';

-- ── ① 백필 ────────────────────────────────────────────────────────
update user_progress up
   set season_id = s.id
  from ranking_season s
 where s.status = 'active' and up.season_id is null;

update ranking_history h
   set season_id = s.id
  from ranking_season s
 where s.status = 'active' and h.season_id is null;

-- ── ② 리셋할 때 새 시즌 id 를 회원 점수에도 박는다 ────────────────
create or replace function public.reset_season()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_season_id int;
  v_next_code text;
  v_next_id int;
begin
  perform pg_advisory_xact_lock(923874165);

  select id into v_season_id from ranking_season where status = 'active' order by id desc limit 1;
  if v_season_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_active_season');
  end if;

  insert into ranking_season_result (season_id, user_id, final_tier, final_rank, skill_score, activity_score, season_total, archived_at)
  select
    v_season_id,
    up.user_id,
    ranking_tier((cume_dist() over (order by up.season_total desc))::numeric),
    row_number() over (order by up.season_total desc, up.updated_at asc),
    up.skill_score, up.activity_score, up.season_total, now()
  from user_progress up
  join profiles pr on pr.id = up.user_id and pr.deactivated_at is null
  on conflict (season_id, user_id) do nothing;

  update ranking_season set status = 'archived', ends_on = current_date where id = v_season_id;

  -- 새 시즌 먼저 만든다 — 아래에서 그 id 를 회원 점수에 박아야 한다.
  --   ⛔ **시즌 번호 = 내부 id − 1 이다.** 올해(id=1)가 '2026-S0'(테스트 시즌)이라 한 칸 밀려 있다.
  --      새 id 는 max(id)+1 이므로 번호는 그냥 max(id) 다 → 다음은 id 2 · 코드 '2027-S1'.
  --      ⚠️ 옛 코드는 **직전 시즌 id** 를 그대로 번호로 썼다. 지금은 우연히 같은 값이 나오지만
  --         두 번째 리셋부터 어긋난다(새 id 3 인데 코드는 S2 가 아니라 S1 이 됨).
  insert into ranking_season (code, starts_on, status)
    values (to_char(current_date, 'YYYY') || '-S' || coalesce((select max(id) from ranking_season), 0)::text,
            current_date, 'active')
    on conflict (code) do nothing
    returning id, code into v_next_id, v_next_code;
  if v_next_id is null then
    select id, code into v_next_id, v_next_code from ranking_season where status = 'active' order by id desc limit 1;
  end if;

  -- ⭐ 활동점수 리셋 + **새 시즌 귀속**을 한 문장으로. 옛 코드는 season_id 를 안 박아서
  --    순위 기록이 시즌 경계 없이 이어졌다(snapshot_ranking_history 가 이 값을 복사해 간다).
  update user_progress set activity_score = 0, season_id = v_next_id, updated_at = now();

  -- 레벨업 연출 워터마크 재동기화(2026-08-26). 위 UPDATE 가 트리거를 태운 **뒤**라 arena_level 은 이미 새 값이다.
  update user_characters uc
     set arena_level_seen = up.arena_level
    from user_progress up
   where up.user_id = uc.user_id
     and uc.arena_level_seen is distinct from up.arena_level;

  return jsonb_build_object('ok', true, 'archived_season_id', v_season_id, 'next_season_id', v_next_id, 'next_code', v_next_code);
end
$function$;

commit;
