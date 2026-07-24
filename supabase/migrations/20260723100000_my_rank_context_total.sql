-- ============================================================
-- my_rank_context 에 total(전체 참가자 수) 추가 — 공유 카드의 "#127 / 3,410명 중" 표기용.
--   · 순위 분모는 global_top 의 'total' 과 같은 모수여야 한다(같은 ranked CTE = 탈퇴자·익명 게스트 제외).
--     따로 count(*) 를 세면 필터가 어긋나 "3,410명 중 #4,000위" 같은 모순이 난다.
--   · 기존 반환 키(rank/season_total/tier/percentile/points_to_pass)는 그대로 — 순수 추가라 back-compat.
--   · 소비처: get-hub(rank·rankTotal → 공유 카드), leaderboard(기존 키만 사용, 영향 없음).
--   멱등(재실행 안전). schema.sql 의 동명 블록과 DDL 동일.
-- ============================================================
create or replace function public.my_rank_context(p_uid uuid)
returns jsonb language sql stable as $$
with ranked as (
  select p.user_id, p.season_total,
         row_number() over (order by p.season_total desc, p.updated_at asc) as grank,
         count(*) over () as gtotal,
         cume_dist() over (order by p.season_total desc)::numeric as pct
  from user_progress p
  join profiles pr0 on pr0.id = p.user_id and pr0.deactivated_at is null and pr0.is_anonymous = false
),
me as (select * from ranked where user_id = p_uid),
above as (select r.season_total from ranked r join me on r.grank = me.grank - 1)
select jsonb_build_object(
  'rank',            (select grank from me),
  'total',           coalesce((select gtotal from ranked limit 1), 0),
  'season_total',    (select season_total from me),
  'tier',            (select ranking_tier(pct) from me),
  'percentile',      (select round(pct, 4) from me),
  'points_to_pass',  (select season_total from above) - (select season_total from me)
);
$$;
