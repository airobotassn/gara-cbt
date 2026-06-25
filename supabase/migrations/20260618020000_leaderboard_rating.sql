-- 랭킹 성능 개선(D안): user_level_skill 에 6축 평균 레이팅을 숫자로 저장하고,
-- 순위/총원/리그목록을 윈도우 함수(RPC)로 DB에서 한 번에 계산.
--  - 기존엔 leaderboard 함수가 전 인원(~1000행)을 끌어와 JS로 평균·정렬 → 느림 + max_rows(1000) 누락 버그.
--  - 레이팅은 applyAttempt(_shared/lib.ts) 가 점수 반영 시 같이 기록. 아래는 컬럼/백필/인덱스/RPC.

-- 1) 평균 레이팅 컬럼
alter table user_level_skill add column if not exists rating numeric(6,2) not null default 0;

-- 2) 기존 행 백필 — ratings(JSONB) 값들의 평균(0~100 클램프).
--    applyAttempt 는 항상 그 레벨 6축을 다 채우므로 "값 평균" = "축 평균".
update user_level_skill s
set rating = sub.avg_rating
from (
  select s2.user_id, s2.level,
         round(coalesce(avg(least(100, greatest(0, (v.value)::numeric))), 0), 2) as avg_rating
  from user_level_skill s2
  cross join lateral jsonb_each_text(s2.ratings) v
  group by s2.user_id, s2.level
) sub
where s.user_id = sub.user_id and s.level = sub.level;

-- 3) 정렬 인덱스(리그: 레벨별 rating desc, 동점 시 응시수 asc)
create index if not exists user_level_skill_lvl_rating_idx
  on user_level_skill (level, rating desc, attempts_count asc);

-- 4) 랭킹 RPC: 리그(해당 레벨) 상위 100 + 내 리그순위/총원 + 전체순위/총원을 한 번에.
--    전체: 등급(rank=현재레벨) desc → 그 레벨 rating desc → 응시수 asc.
create or replace function public.leaderboard_v2(p_level int, p_uid uuid)
returns jsonb
language sql
stable
as $$
with base as (
  -- 모든 유저: 현재 등급(lvl) + 그 레벨 rating(없으면 0) + 응시수
  select p.user_id,
         p.rank as lvl,
         coalesce(s.rating, 0)::numeric as rating,
         coalesce(s.attempts_count, 0) as attempts
  from user_progress p
  left join user_level_skill s on s.user_id = p.user_id and s.level = p.rank
),
g as (
  select user_id,
         row_number() over (order by lvl desc, rating desc, attempts asc) as grank,
         count(*) over () as gtotal
  from base
),
lg as (
  select p.user_id,
         coalesce(s.rating, 0)::numeric as rating,
         coalesce(s.attempts_count, 0) as attempts,
         row_number() over (order by coalesce(s.rating,0) desc, coalesce(s.attempts_count,0) asc) as lrank,
         count(*) over () as ltotal
  from user_progress p
  left join user_level_skill s on s.user_id = p.user_id and s.level = p_level
  where p.rank = p_level
)
select jsonb_build_object(
  'users', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', coalesce(nullif(pr.display_name, ''), '익명'),
      'rating', round(lg.rating)::int,
      'avatar', pr.avatar_url,
      'me', (lg.user_id = p_uid)
    ) order by lg.lrank)
    from lg
    left join profiles pr on pr.id = lg.user_id
    where lg.lrank <= 100
  ), '[]'::jsonb),
  'myRank', coalesce((select lrank from lg where user_id = p_uid), 0),
  'total', coalesce((select ltotal from lg limit 1), 0),
  'myGlobalRank', coalesce((select grank from g where user_id = p_uid), 0),
  'globalTotal', coalesce((select gtotal from g limit 1), 0)
);
$$;
