-- 랭킹 통합 재설계 STAGE 1e — reset_season(): 시즌 종료 스냅샷 아카이브 + activity_score 리셋 + 신규 시즌 개시.
--  · 멱등: pg_advisory_xact_lock 으로 직렬화 + 활성 시즌 status='active' 가드(없으면 no-op) → 이중 아카이브·재-0 없음.
--  · final_tier 는 season_total 백분위 5티어(다이아≤5% · 플래≤20% · 골드≤45% · 실버≤75% · 브론즈)를 cume_dist 로 아카이브.
--    STAGE2 read-시점 티어(tierForPercentile)와 동일 밴드.
--  · final_rank 는 season_total 내림차순(동점=updated_at 오름차순) row_number, 탈퇴자(profiles.deactivated_at) 제외(global_top 과 동일 컨벤션).
--  · 스냅샷 → activity_score=0 → 시즌 롤오버 순서 보장(단일 트랜잭션).
--  · SECURITY DEFINER + set search_path=public + PUBLIC부터 revoke, service_role 만 grant.
--  멱등(재실행 안전). schema.sql 의 동명 블록과 DDL 동일.
create or replace function public.ranking_tier(p_pct numeric) returns text
  language sql immutable as $$
  select case
    when p_pct <= 0.05 then 'diamond'
    when p_pct <= 0.20 then 'platinum'
    when p_pct <= 0.45 then 'gold'
    when p_pct <= 0.75 then 'silver'
    else 'bronze'
  end
$$;

create or replace function public.reset_season() returns jsonb
  language plpgsql security definer set search_path = public as $$
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

  update user_progress set activity_score = 0, updated_at = now();

  update ranking_season set status = 'archived', ends_on = current_date where id = v_season_id;
  v_next_code := to_char(current_date, 'YYYY') || '-S' || v_season_id::text;
  insert into ranking_season (code, starts_on, status)
    values (v_next_code, current_date, 'active')
    on conflict (code) do nothing
    returning id into v_next_id;
  if v_next_id is null then
    select id into v_next_id from ranking_season where code = v_next_code;
  end if;

  return jsonb_build_object('ok', true, 'archived_season_id', v_season_id, 'next_season_id', v_next_id);
end
$$;

revoke all on function public.reset_season() from public, anon, authenticated;
grant execute on function public.reset_season() to service_role;
