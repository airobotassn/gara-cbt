-- 랭킹 화면을 '전체 TOP N + 내 순위'로 단순화. DB에서 전체 순위를 윈도우 함수로 계산해
-- 상위 N명(프로필 포함) + 내 순위/총원/내 정보를 한 번에 반환. (max_rows 영향 없음)
create or replace function public.global_top(p_uid uuid, p_limit int default 10)
returns jsonb
language sql
stable
as $$
with base as (
  select p.user_id, p.rank as lvl,
         coalesce(s.rating, 0)::numeric as rating,
         coalesce(s.attempts_count, 0) as attempts
  from user_progress p
  left join user_level_skill s on s.user_id = p.user_id and s.level = p.rank
),
ranked as (
  select user_id, lvl, rating, attempts,
         row_number() over (order by lvl desc, rating desc, attempts asc) as grank,
         count(*) over () as gtotal
  from base
)
select jsonb_build_object(
  'top', coalesce((
    select jsonb_agg(jsonb_build_object(
      'rank', r.grank,
      'name', coalesce(nullif(pr.display_name, ''), '익명'),
      'level', r.lvl,
      'rating', round(r.rating)::int,
      'avatar', pr.avatar_url,
      'me', (r.user_id = p_uid)
    ) order by r.grank)
    from ranked r left join profiles pr on pr.id = r.user_id
    where r.grank <= p_limit
  ), '[]'::jsonb),
  'total', coalesce((select gtotal from ranked limit 1), 0),
  'me', (
    select jsonb_build_object(
      'rank', r.grank, 'level', r.lvl, 'rating', round(r.rating)::int,
      'name', coalesce(nullif(pr.display_name, ''), '익명'), 'avatar', pr.avatar_url
    )
    from ranked r left join profiles pr on pr.id = r.user_id
    where r.user_id = p_uid
  )
);
$$;
