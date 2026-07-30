-- ============================================================
-- scoped_top — 범위별 **개인** 리더보드 RPC
--   · /ranking 탭 재편(2026-07-30): 개인 / 지역 / 국가(집계 버킷) → 전세계 / 내 국가 / 내 지역.
--     세 탭 모두 개인 랭킹이고 모수만 다르다(전체 · 내 country_code · 내 region_code).
--     지역/국가 **집계 버킷** RPC(region_/country_/school_leaderboard)는 /arena 지도가 계속 쓰므로 그대로 둔다.
--   · p_country·p_region 이 둘 다 null 이면 global_top 과 동일 결과(= 전세계 탭). 반환 형태도 global_top 과 동일 +
--     me.points_to_pass(그 보드에서 바로 윗사람과의 점수차, 1위면 null).
--   · tier 는 항상 **전체(global) 백분위** 기준 — 티어는 사람 단위 속성이라 국가/지역 탭에서 바뀌면 안 된다
--     (허브·공유카드의 티어와 어긋나면 안 됨). percentile 은 **그 범위 안** 백분위(보드의 '상위 N%').
--   · 노출 수준·보안 모델은 global_top 과 동일: SECURITY DEFINER 아님 → RLS 없는 user_progress 를
--     읽으려면 service_role(엣지 함수) 이어야 한다. anon 이 직접 호출하면 빈 결과.
--   멱등(재실행 안전). schema.sql 의 동명 블록과 DDL 동일.
-- ============================================================
create or replace function public.scoped_top(
  p_uid uuid,
  p_limit int default 10,
  p_country text default null,
  p_region text default null
)
returns jsonb language sql stable as $$
-- base: 전체 모수(탈퇴자·익명 게스트 제외) — 여기서 뽑은 gpct 가 '전세계 기준 티어'의 근거다.
with base as (
  select p.user_id, p.rank as lvl, p.season_total, p.updated_at,
         pr0.country_code, pr0.region_code,
         cume_dist() over (order by p.season_total desc)::numeric as gpct
  from user_progress p
  join profiles pr0 on pr0.id = p.user_id and pr0.deactivated_at is null and pr0.is_anonymous = false
),
-- ranked: 범위로 좁힌 뒤 그 안에서 순위·총원·백분위를 다시 계산.
ranked as (
  select b.*,
         row_number() over (order by b.season_total desc, b.updated_at asc) as grank,
         count(*) over ()                                                   as gtotal,
         cume_dist() over (order by b.season_total desc)::numeric           as pct
  from base b
  where (p_country is null or b.country_code = p_country)
    and (p_region  is null or b.region_code  = p_region)
),
me as (select * from ranked where user_id = p_uid),
above as (select r.season_total from ranked r join me on r.grank = me.grank - 1)
select jsonb_build_object(
  'top', coalesce((
    select jsonb_agg(jsonb_build_object(
      'rank', r.grank,
      'name', coalesce(nullif(pr.display_name, ''), '익명'),
      'level', r.lvl,
      'rating', r.season_total,
      'avatar', pr.avatar_url,
      'tier', ranking_tier(r.gpct),
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
      'tier', ranking_tier(r.gpct), 'percentile', round(r.pct, 4),
      'points_to_pass', (select season_total from above) - r.season_total
    )
    from ranked r left join profiles pr on pr.id = r.user_id
    where r.user_id = p_uid
  )
);
$$;
