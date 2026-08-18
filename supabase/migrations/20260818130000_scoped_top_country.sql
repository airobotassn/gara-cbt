-- scoped_top: TOP 행에 country 추가 — 시상대(/ranking TOP3) 이름 뒤에 국기를 붙이기 위해서다.
--
-- 왜 필요했나 (2026-08-18)
--   base CTE 는 country_code 를 이미 뽑아 놓고(범위 필터용) top 행 JSON 에는 안 담고 있었다.
--   그래서 프론트에는 국가가 도달하지 못했고, 국기를 그리려면 이 한 줄이 선행이다.
--
--   ⚠️ 새로 공개되는 정보가 아니다 — 채팅(chat-list)이 이미 작성자 country_code 를 그대로 내려주고,
--     랭킹 자체에 '내 국가' 탭이 있다. TOP 10 은 어차피 공개 보드다.
--
--   me 행에는 안 넣는다 — 호출자 본인이라 이미 안다(uid 를 뺀 것과 같은 이유).
--   나머지 DDL 은 20260814100000 과 **한 글자도 다르지 않다**(country 한 줄만 추가).
create or replace function public.scoped_top(
  p_uid uuid,
  p_limit int default 10,
  p_country text default null,
  p_region text default null
)
returns jsonb language sql stable as $$
with base as (
  select p.user_id, p.rank as lvl, p.season_total, p.updated_at,
         pr0.country_code, pr0.region_code,
         cume_dist() over (order by p.season_total desc)::numeric as gpct
  from user_progress p
  join profiles pr0 on pr0.id = p.user_id and pr0.deactivated_at is null and pr0.is_anonymous = false
),
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
      'uid', r.user_id,
      'name', coalesce(nullif(pr.display_name, ''), '익명'),
      'level', r.lvl,
      'rating', r.season_total,
      'avatar', pr.avatar_url,
      'country', r.country_code,
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
