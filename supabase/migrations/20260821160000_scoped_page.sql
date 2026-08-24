-- 전체 랭킹 무한 스크롤 — 커서 페이징 + 티어 컷 캐시 (2026-08-21)
--
-- 왜 필요한가: 랭킹이 TOP 10 에서 끊겨 3만5천 명 중 나머지를 볼 방법이 없었다.
--
-- ⛔ **offset 페이징은 쓰지 않는다.** 순위를 매기려면 앞부터 다 훑어야 해서 뒤로 갈수록 느려진다 —
--    실측 offset 10 = 24ms · 5,000 = 171ms · 30,000 = **616ms**. 무한 스크롤은 끝까지 내려가는
--    기능이라 그게 그대로 사용자가 겪는 버벅임이 된다.
--    커서(마지막으로 본 점수보다 낮은 것부터 N명)는 색인이 그 지점으로 바로 점프하므로
--    **몇 페이지째든 시간이 일정하다.** 순위 번호는 이어붙인다(이전 페이지 마지막 + 1).
--
-- ⛔ **티어를 페이지마다 계산하지 않는다.** 티어는 전세계 백분위에서 나오는데(`ranking_tier`),
--    그걸 구하려면 3만5천 행 전체를 훑어야 한다(`scoped_top` 이 285ms 인 이유가 이것이다).
--    게다가 국가·지역 보드의 순위는 **그 보드 안 순위**라 그 값으로는 티어를 낼 수도 없다.
--    그래서 백분위 경계에 해당하는 **점수 컷 네 개를 미리 계산해 캐시**하고, 각 행은 점수 비교만 한다.
--    ⚠️ 컷이 5분 낡아도 티어가 틀리지 않는다 — 백분위 경계는 사람이 늘어도 천천히 움직인다.

-- ── 티어 컷 캐시 ────────────────────────────────────────────────────────────
-- 한 행만 있는 표(`only_row` 가 true 고정 + PK). 여러 행이 생기면 어느 게 최신인지 다투게 된다.
create table if not exists public.ranking_tier_cuts (
  only_row   boolean primary key default true check (only_row),
  cut_dia    numeric not null default 0,   -- 이 점수 이상이면 다이아(상위 5%)
  cut_plat   numeric not null default 0,   -- 플래티넘(상위 20%)
  cut_gold   numeric not null default 0,   -- 골드(상위 45%)
  cut_silver numeric not null default 0,   -- 실버(상위 75%) · 그 아래는 브론즈
  total      integer not null default 0,   -- 그때의 전세계 총원(화면의 '상위 N%' 계산용)
  updated_at timestamptz not null default now()
);

-- ⚠️ RLS 켜고 정책 없음 = service role(엣지 함수) 전용. 다른 랭킹 표와 같은 취급이다.
alter table public.ranking_tier_cuts enable row level security;

comment on table public.ranking_tier_cuts is
  '전세계 티어 경계 점수 캐시(한 행). 랭킹 페이지 조회가 전체 스캔 없이 티어를 내기 위한 것.';

create or replace function public.refresh_ranking_tier_cuts()
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into ranking_tier_cuts as t (only_row, cut_dia, cut_plat, cut_gold, cut_silver, total, updated_at)
  select true, c.d, c.p, c.g, c.s, c.n, now()
  from (
    select
      -- ⚠️ `within group (order by season_total desc)` 라 0.05 는 **위에서** 5% 지점이다.
      --    ranking_tier() 의 `pct <= 0.05 → diamond` 와 같은 경계를 점수로 옮긴 것.
      coalesce(percentile_disc(0.05) within group (order by season_total desc), 0) as d,
      coalesce(percentile_disc(0.20) within group (order by season_total desc), 0) as p,
      coalesce(percentile_disc(0.45) within group (order by season_total desc), 0) as g,
      coalesce(percentile_disc(0.75) within group (order by season_total desc), 0) as s,
      count(*)::int as n
    from (
      select p.season_total from user_progress p
      join profiles pr on pr.id = p.user_id and pr.deactivated_at is null and pr.is_anonymous = false
      union all
      select d.season_total from ranking_dummies d
    ) pool
  ) c
  on conflict (only_row) do update set
    cut_dia = excluded.cut_dia, cut_plat = excluded.cut_plat,
    cut_gold = excluded.cut_gold, cut_silver = excluded.cut_silver,
    total = excluded.total, updated_at = excluded.updated_at;
end $$;

revoke all on function public.refresh_ranking_tier_cuts() from public, anon, authenticated;
grant execute on function public.refresh_ranking_tier_cuts() to service_role;

-- 점수 → 티어. ⚠️ `ranking_tier(백분위)` 와 **같은 5단계·같은 경계**여야 한다(두 함수가 한 쌍이다).
create or replace function public.tier_by_score(p_score numeric)
returns text language sql stable as $$
  select case
    when p_score >= c.cut_dia    then 'diamond'
    when p_score >= c.cut_plat   then 'platinum'
    when p_score >= c.cut_gold   then 'gold'
    when p_score >= c.cut_silver then 'silver'
    else 'bronze'
  end
  from ranking_tier_cuts c where c.only_row
$$;

-- ── 국가·지역 보드도 커서로 훑는다 ─────────────────────────────────────────
-- ⚠️ "국가 보드는 인원이 적어 한 번에 받으면 된다" 는 **틀린 전제였다** — 지역 수가 많은 나라가
--    더 크다(우간다 1,110명 · 러시아 860명 · 북마케도니아 840명. 미국은 510명으로 8위였다).
--    실회원이 늘면 더 커지므로 국가·지역도 같은 경로를 쓴다.
create index if not exists ranking_dummies_country_score_idx
  on public.ranking_dummies (country_code, season_total desc, created_at asc);
create index if not exists ranking_dummies_region_score_idx
  on public.ranking_dummies (region_code, season_total desc, created_at asc);

-- ── 페이지 조회 ─────────────────────────────────────────────────────────────
--   p_after_score / p_after_at = 마지막으로 받은 행의 점수·동점 기준값(커서). null 이면 처음부터.
--   p_start_rank              = 이 페이지 첫 행에 붙일 순위 번호.
--   ⛔ 커서는 **세 값이 한 벌**이다(점수·시각·id). 점수와 시각만으로 자르면 **동점자가 통째로
--      건너뛰어진다** — 더미는 한 번에 insert 되어 시각이 같고, 낮은 점수대에는 동점이 많다.
--      실제로 끝까지 걸어보니 35,048명 중 27,629명에서 멈춰 7,419명이 누락됐다.
--      id 까지 넣으면 순서가 유일해져 한 명도 빠지지 않는다.
create or replace function public.scoped_page(
  p_uid uuid,
  p_after_score numeric default null,
  p_after_at timestamptz default null,
  p_after_id uuid default null,
  p_start_rank int default 1,
  p_limit int default 50,
  p_country text default null,
  p_region text default null
)
returns jsonb language sql stable as $$
with pool as (
  select p.user_id, p.rank as lvl, p.season_total, p.updated_at,
         pr0.country_code, pr0.region_code,
         coalesce(nullif(pr0.display_name, ''), '익명') as name,
         pr0.avatar_url
  from user_progress p
  join profiles pr0 on pr0.id = p.user_id and pr0.deactivated_at is null and pr0.is_anonymous = false
  union all
  select d.id, d.rank, d.season_total, d.created_at, d.country_code, d.region_code,
         d.display_name, d.avatar_url
  from ranking_dummies d
),
page as (
  select pool.*
  from pool
  where (p_country is null or country_code = p_country)
    and (p_region  is null or region_code  = p_region)
    -- ⚠️ 정렬 방향이 섞여 있으면(점수 내림·시각 오름) 행 비교 `(a,b,c) > (d,e,f)` 를 못 쓴다.
    --    점수에 마이너스를 붙여 **세 값을 전부 오름차순**으로 만들면 행 비교가 그대로 성립한다.
    and (p_after_score is null
         or (-season_total, updated_at, user_id) > (-p_after_score, p_after_at, p_after_id))
  order by -season_total, updated_at, user_id
  limit p_limit
),
-- ⚠️ 순위는 여기서 미리 매긴다 — `jsonb_agg` 안에서는 윈도 함수를 못 쓴다(42803).
numbered as (
  select page.*, p_start_rank + row_number() over (order by -season_total, updated_at, user_id) - 1 as rk
  from page
)
select jsonb_build_object(
  'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'rank', n.rk,
      'uid', n.user_id,
      'name', n.name,
      'level', n.lvl,
      'rating', n.season_total,
      'avatar', n.avatar_url,
      'country', n.country_code,
      'tier', tier_by_score(n.season_total),
      'me', (n.user_id = p_uid)
    ) order by n.rk)
    from numbered n
  ), '[]'::jsonb),
  -- 다음 요청에 그대로 돌려줄 커서 = 이 페이지 **마지막 행**. 더 없으면 null 이라 프론트가 멈춘다.
  'cursor', (
    select jsonb_build_object('score', n.season_total, 'at', n.updated_at, 'id', n.user_id, 'rank', n.rk)
    from numbered n order by n.rk desc limit 1
  )
);
$$;

-- ── 컷 갱신 크론 ────────────────────────────────────────────────────────────
-- 아레나 버킷과 **같은 5분 주기**에 얹는다(별도 잡을 파면 두 개를 따로 관리하게 된다).
--   ⚠️ 컷이 낡아도 티어가 틀리지 않는다 — 백분위 경계는 사람이 늘어도 천천히 움직인다.
--      그래서 실시간 계산(페이지마다 285ms)을 감수할 이유가 없다.
select cron.unschedule('arena-buckets') where exists (select 1 from cron.job where jobname = 'arena-buckets');
select cron.schedule('arena-buckets', '*/5 * * * *',
  'select public.refresh_arena_buckets(); select public.refresh_ranking_tier_cuts();');

-- 지금 한 번 채워 둔다 — 안 하면 크론이 처음 도는 5분 동안 모두 브론즈로 보인다.
select public.refresh_ranking_tier_cuts();

-- ── 첫 화면(scoped_top)과 맞물리게 ──────────────────────────────────────────
-- ⛔ 두 함수의 **정렬 기준이 같아야** 한다. `scoped_top` 은 (점수 내림, 시각 오름)이었는데
--    그것만으로는 동점·동시각에서 순서가 불확정이라, 이어보기가 그 경계에서 같은 사람을
--    두 번 주거나 건너뛴다. 세 값(점수·시각·id)으로 통일한다.
-- ⛔ 그리고 첫 화면이 **커서를 같이 내려줘야** 프론트가 어디서부터 이어받을지 알 수 있다.
--    (응답에 updated_at 이 없어서 클라가 커서를 조립할 수 없다.)
create or replace function public.scoped_top(
  p_uid uuid,
  p_limit int default 10,
  p_country text default null,
  p_region text default null
)
returns jsonb language sql stable as $$
with pool as (
  select p.user_id, p.rank as lvl, p.season_total, p.updated_at,
         pr0.country_code, pr0.region_code,
         coalesce(nullif(pr0.display_name, ''), '익명') as name,
         pr0.avatar_url
  from user_progress p
  join profiles pr0 on pr0.id = p.user_id and pr0.deactivated_at is null and pr0.is_anonymous = false
  union all
  select d.id, d.rank, d.season_total, d.created_at,
         d.country_code, d.region_code, d.display_name, d.avatar_url
  from ranking_dummies d
),
base as (
  select pool.*, cume_dist() over (order by season_total desc)::numeric as gpct from pool
),
ranked as (
  select b.*,
         row_number() over (order by -b.season_total, b.updated_at, b.user_id) as grank,
         count(*) over ()                                                     as gtotal,
         cume_dist() over (order by b.season_total desc)::numeric             as pct
  from base b
  where (p_country is null or b.country_code = p_country)
    and (p_region  is null or b.region_code  = p_region)
),
me as (select * from ranked where user_id = p_uid),
above as (select r.season_total from ranked r join me on r.grank = me.grank - 1)
select jsonb_build_object(
  'top', coalesce((
    select jsonb_agg(jsonb_build_object(
      'rank', r.grank, 'uid', r.user_id, 'name', r.name, 'level', r.lvl,
      'rating', r.season_total, 'avatar', r.avatar_url, 'country', r.country_code,
      'tier', ranking_tier(r.gpct), 'percentile', round(r.pct, 4), 'me', (r.user_id = p_uid)
    ) order by r.grank)
    from ranked r where r.grank <= p_limit
  ), '[]'::jsonb),
  'total', coalesce((select gtotal from ranked limit 1), 0),
  -- 이어보기 시작점 = 첫 화면 **마지막 행**. 프론트가 이 값을 그대로 되돌려주면 그 다음부터 온다.
  'cursor', (
    select jsonb_build_object('score', r.season_total, 'at', r.updated_at, 'id', r.user_id, 'rank', r.grank)
    from ranked r where r.grank <= p_limit order by r.grank desc limit 1
  ),
  'me', (
    select jsonb_build_object(
      'rank', r.grank, 'level', r.lvl, 'rating', r.season_total,
      'name', r.name, 'avatar', r.avatar_url,
      'tier', ranking_tier(r.gpct), 'percentile', round(r.pct, 4),
      'points_to_pass', (select season_total from above) - r.season_total
    )
    from ranked r where r.user_id = p_uid
  )
);
$$;
