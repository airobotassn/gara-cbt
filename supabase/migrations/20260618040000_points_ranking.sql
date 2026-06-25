-- 랭킹 점수(0~10000) 도입 + 강등 3진 아웃 경고 + 승급컷 16/18.
--  - 점수 = ((등급-1) + 그 등급 최신 맞힌수/승급컷) / 7 * 10000.  (scoring.ts / _shared/lib.ts 와 동일 수식)
--  - 랭킹은 이 점수로 정렬. 동점은 먼저 도달한 사람(updated_at asc) 우선.
--  - applyAttempt 가 매 응시마다 user_progress.points / demotion_strikes 를 갱신.

-- 1) 컬럼
alter table user_progress add column if not exists demotion_strikes int not null default 0;
alter table user_progress add column if not exists points int not null default 0;
alter table test_attempts add column if not exists warn_strikes int default 0;

-- 2) 기존 user_progress 점수 백필 — 현재 등급 + 그 등급의 최신 제출 맞힌수.
update user_progress p
set points = round(
  ( (p.rank - 1)
    + least(coalesce(la.total_correct, 0)::numeric / (case when p.rank <= 3 then 16 else 18 end), 1)
  ) / 7 * 10000
)::int
from user_progress up
left join lateral (
  select ta.total_correct
  from test_attempts ta
  where ta.user_id = up.user_id and ta.level = up.rank and ta.status = 'submitted'
  order by ta.submitted_at desc
  limit 1
) la on true
where p.user_id = up.user_id;

-- 3) 정렬 인덱스 (전체/리그 모두 points desc, 동점 updated_at asc)
create index if not exists user_progress_points_idx on user_progress (points desc, updated_at asc);

-- 4) 랭킹 RPC(global_top, 명예의 전당) 를 points 정렬로 교체.
--    기존 20260618030000 은 6축 rating 정렬이었음 → user_progress.points 정렬로 덮어쓴다.
--    정렬: points desc, 동점은 먼저 도달(updated_at asc). 반환 rating 필드에 points 를 담음.
create or replace function public.global_top(p_uid uuid, p_limit int default 10)
returns jsonb
language sql
stable
as $$
with ranked as (
  select p.user_id, p.rank as lvl, p.points,
         row_number() over (order by p.points desc, p.updated_at asc) as grank,
         count(*) over () as gtotal
  from user_progress p
)
select jsonb_build_object(
  'top', coalesce((
    select jsonb_agg(jsonb_build_object(
      'rank', r.grank,
      'name', coalesce(nullif(pr.display_name, ''), '익명'),
      'level', r.lvl,
      'rating', r.points,
      'avatar', pr.avatar_url,
      'me', (r.user_id = p_uid)
    ) order by r.grank)
    from ranked r left join profiles pr on pr.id = r.user_id
    where r.grank <= p_limit
  ), '[]'::jsonb),
  'total', coalesce((select gtotal from ranked limit 1), 0),
  'me', (
    select jsonb_build_object(
      'rank', r.grank, 'level', r.lvl, 'rating', r.points,
      'name', coalesce(nullif(pr.display_name, ''), '익명'), 'avatar', pr.avatar_url
    )
    from ranked r left join profiles pr on pr.id = r.user_id
    where r.user_id = p_uid
  )
);
$$;
