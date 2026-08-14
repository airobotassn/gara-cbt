-- scoped_top: TOP 행에 uid 추가 — 랭킹에서 그 사람 **방**(/room/:handle)으로 들어가기 위해서다.
--
-- 왜 뒤집나 (2026-08-14)
--   원래 top 행은 user_id 를 일부러 뺐다(프라이버시). 그런데 채팅(chat-list)은 이미 user_id 를
--   그대로 내려주고 있어서 "uid 는 비공개" 라는 성질이 시스템 차원에서는 이미 성립하지 않았다.
--   방을 공개하기로 한 이상 랭킹에도 들어갈 길이 필요하고, uid 로 열 수 있는 건 방(공개 정보)뿐이다
--   — 잠금 테이블은 전부 RLS 미부여라 uid 를 안다고 읽히지 않는다.
--
--   ⚠️ 짧은 공개 코드로 바꾸고 싶으면 여기(top 의 'uid')와 room 함수의 handle 해석 두 곳만 고치면 된다.
--     라우트(/room/:handle)와 프론트는 handle 을 문자열로만 다룬다.
--
--   me 행에는 안 넣는다 — 호출자 본인이라 이미 안다.
--   나머지 DDL 은 20260730010000 과 **한 글자도 다르지 않다**(uid 한 줄만 추가).
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
