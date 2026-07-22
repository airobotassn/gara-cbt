-- ============================================================
-- 랭킹 통합 재설계 STAGE 2 슬라이스 B — global_top / my_rank_context / 집계 리더보드 RPC 재설계
--   · global_top: 정렬 season_total desc, updated_at asc(동점=먼저 도달). is_anonymous=false 게스트 응시자 제외.
--     tier/percentile 은 cume_dist() over (order by season_total desc) → ranking_tier() 5티어.
--     기존 반환 필드(rank/name/level/rating/avatar/me) 유지 — rating 은 season_total.
--   · my_rank_context: 게이지 전용 경량 RPC. 내 순위/티어/백분위 + 바로 윗사람과의 points_to_pass(1위면 null).
--     global_top 과 동일 노출 수준(SECURITY DEFINER 아님, PUBLIC 실행) — season_total/ranking_tier 정의 이후에 위치해야 한다.
--   · region_/country_/school_leaderboard 의 베이지안 개정은 이 파일이 아니라 원 마이그레이션
--     20260714000200_leaderboard_rpcs.sql 을 직접 개정했다(멱등 재실행 컨벤션 — parity 재정합 겸용).
--   · 의존성: user_progress.season_total(20260721010000), public.ranking_tier(20260721030000) 가 먼저 적용되어 있어야 한다.
--   멱등(재실행 안전). schema.sql 의 동명 블록과 DDL 동일.
-- ============================================================

-- (5) global_top — 명예의 전당 RPC: season_total 정렬(동점=먼저 도달), 탈퇴자·is_anonymous 게스트 제외.
create or replace function public.global_top(p_uid uuid, p_limit int default 10)
returns jsonb language sql stable as $$
with ranked as (
  select p.user_id, p.rank as lvl, p.season_total,
         row_number() over (order by p.season_total desc, p.updated_at asc) as grank,
         count(*) over () as gtotal,
         cume_dist() over (order by p.season_total desc)::numeric as pct
  from user_progress p
  join profiles pr0 on pr0.id = p.user_id and pr0.deactivated_at is null and pr0.is_anonymous = false
)
select jsonb_build_object(
  'top', coalesce((
    select jsonb_agg(jsonb_build_object(
      'rank', r.grank,
      'name', coalesce(nullif(pr.display_name, ''), '익명'),
      'level', r.lvl,
      'rating', r.season_total,
      'avatar', pr.avatar_url,
      'tier', ranking_tier(r.pct),
      'percentile', round(r.pct, 4),
      'me', (r.user_id = p_uid)
    ) order by r.grank)
    from ranked r left join profiles pr on pr.id = r.user_id
    where r.grank <= p_limit
  ), '[]'::jsonb),
  'total', coalesce((select gtotal from ranked limit 1), 0),
  'me', (
    select jsonb_build_object(
      'rank', r.grank, 'level', r.lvl, 'rating', r.season_total,
      'name', coalesce(nullif(pr.display_name, ''), '익명'), 'avatar', pr.avatar_url,
      'tier', ranking_tier(r.pct), 'percentile', round(r.pct, 4)
    )
    from ranked r left join profiles pr on pr.id = r.user_id
    where r.user_id = p_uid
  )
);
$$;

-- (6) my_rank_context — 게이지 전용 경량 RPC: 내 순위·티어·백분위 + 바로 윗사람과의 points_to_pass(1위면 null).
create or replace function public.my_rank_context(p_uid uuid)
returns jsonb language sql stable as $$
with ranked as (
  select p.user_id, p.season_total,
         row_number() over (order by p.season_total desc, p.updated_at asc) as grank,
         cume_dist() over (order by p.season_total desc)::numeric as pct
  from user_progress p
  join profiles pr0 on pr0.id = p.user_id and pr0.deactivated_at is null and pr0.is_anonymous = false
),
me as (select * from ranked where user_id = p_uid),
above as (select r.season_total from ranked r join me on r.grank = me.grank - 1)
select jsonb_build_object(
  'rank',            (select grank from me),
  'season_total',    (select season_total from me),
  'tier',            (select ranking_tier(pct) from me),
  'percentile',      (select round(pct, 4) from me),
  'points_to_pass',  (select season_total from above) - (select season_total from me)
);
$$;
