-- 랭킹 첫 화면(scoped_top) — 3만5천 행 정렬을 걷어내고 인덱스로 바꾼다.
--
-- ■ 왜
--   50명을 보여주려고 풀 전체(실회원 + 더미 35,040)를 **윈도 함수로 3~4번 정렬**하고 있었다.
--   메모리에 안 들어가 매 호출마다 temp 로 3.5MB 씩 샜다. 실측 warm 325ms · cold 1,100ms 로
--   다른 조회(16~36ms)의 10~30배였고, **이 쿼리 하나가 RDS 등급을 한 단계 밀어올리고 있었다.**
--
-- ■ 무엇을 바꿨나 (값의 운명이 셋 다 다르다)
--   · 상위 N   : 양쪽에서 각자 인덱스로 N 개만 뽑아 합친 뒤 다시 N 개 → 35,050행 정렬이 51행 읽기로.
--   · 전체 인원: count(*) over () (전 행 적재) → 인덱스 전용 스캔(Heap Fetches: 0).
--   · 백분위   : cume_dist() (전체 정렬) → `count(점수 >= 그 행)` 인덱스 범위 카운트.
--                cume_dist 의 정의가 곧 그 비율이라 **값이 수학적으로 동일**하다(대조로 확인).
--   · 티어     : ⛔ **계산을 걷어냈다.** 2026-08-04 에 화면에서 제거돼 프론트가 읽지 않는다
--                (Ranking.tsx 머리 주석). 아무도 안 읽는 값을 내려고 전체를 한 번 더 정렬하고 있었다.
--                키는 남기고 null 을 넣는다 — leaderboard 의 mapUser 가 `u.tier ?? null` 이라 모양이 안 바뀐다.
--                되살리려면 tier_by_score(점수) 를 쓸 것(경계표 ranking_tier_cuts 를 5분 크론이 갱신한다).
--                ⚠️ ranking_tier(백분위) 로 되돌리지 말 것 — 그게 전체 정렬을 다시 불러온다.
--
-- ■ me 블록은 my_rank_context 와 **같은 규칙**이다(gt/eq/tie/nxt 카운트).
--   그쪽이 이미 이 방식으로 24ms 에 돌고 있어서, 검증된 패턴을 첫 화면에도 적용한 것이다.
--   ⛔ 두 함수의 동점 해소(at 오름 → id 오름)와 백분위 정의('나 이상' / 전체)를 **글자 그대로 맞출 것.**
--      어긋나면 허브의 내 순위와 랭킹 화면의 내 순위가 같은 순간에 다른 값을 말한다.
--
-- ■ 정렬 기준은 한 글자도 안 건드렸다: (점수 내림, 시각 오름, id 오름).
--   ⛔ scoped_page 와 **같아야 한다** — 다르면 첫 화면과 이어보기 경계에서 같은 사람이 두 번 나오거나 빠진다.
--
-- ■ 남은 한계 — 지역 탭은 1.3배에 그친다(118ms → 88ms).
--   `(p_country is null or country_code = p_country)` 는 파라미터가 null 일 수 있어 플래너가
--   인덱스를 못 쓴다(값을 리터럴로 박으면 같은 조각이 1~2ms 다). 더 줄이려면 스코프별로 쿼리를
--   3벌로 나눠야 하는데, 랭킹은 기본이 전세계 탭이라 CPU 절감의 대부분이 이미 나온다고 보고 두었다.
--
-- 실측(중앙값, 운영 DB): 전세계 335→33ms(10.3배) · 국가 126→23ms(5.4배) · 지역 118→88ms
-- 정확성: 34개 케이스(전세계·국가·지역 × 1위/중간/꼴찌/동점/없는국가, me 포함) 전부 일치.

create or replace function public.scoped_top(
  p_uid uuid,
  p_limit integer default 10,
  p_country text default null,
  p_region text default null
) returns jsonb
language sql
stable
as $fn$
with
-- ① 상위 N — 한쪽의 상위 N 안에 전체 상위 N 이 반드시 들어 있으므로, 각자 N 개만 뽑아 합쳐도 정확하다.
top_n as (
  select b.*, row_number() over (order by b.st desc, b.at, b.id) as rk
  from (
    ( select p.user_id as id, p.rank as lvl, p.season_total as st, p.updated_at as at,
             pr.country_code as cc,
             coalesce(nullif(pr.display_name, ''), '익명') as nm, pr.avatar_url as av
      from user_progress p
      join profiles pr on pr.id = p.user_id and pr.deactivated_at is null and pr.is_anonymous = false
      where (p_country is null or pr.country_code = p_country)
        and (p_region  is null or pr.region_code  = p_region)
      order by p.season_total desc, p.updated_at, p.user_id
      limit p_limit )
    union all
    ( select d.id, d.rank, d.season_total, d.created_at, d.country_code, d.display_name, d.avatar_url
      from ranking_dummies d
      where (p_country is null or d.country_code = p_country)
        and (p_region  is null or d.region_code  = p_region)
      order by d.season_total desc, d.created_at, d.id
      limit p_limit )
  ) b
  order by b.st desc, b.at, b.id
  limit p_limit
),
-- ② 전체 인원 — count 는 실제 행을 안 읽는다(인덱스 전용 스캔).
tot as (
  select ( select count(*) from user_progress p
             join profiles pr on pr.id = p.user_id and pr.deactivated_at is null and pr.is_anonymous = false
            where (p_country is null or pr.country_code = p_country)
              and (p_region  is null or pr.region_code  = p_region) )
       + ( select count(*) from ranking_dummies d
            where (p_country is null or d.country_code = p_country)
              and (p_region  is null or d.region_code  = p_region) ) as n
),
-- ③ 나 — 실회원이거나 더미다(더미는 at 자리에 created_at 을 쓴다. 위 pool 과 같은 규칙).
m as (
  select p.season_total as st, p.updated_at as at, p.user_id as id,
         p.rank as lvl, coalesce(nullif(pr.display_name, ''), '익명') as nm, pr.avatar_url as av
  from user_progress p
  join profiles pr on pr.id = p.user_id and pr.deactivated_at is null and pr.is_anonymous = false
  where p.user_id = p_uid
    and (p_country is null or pr.country_code = p_country)
    and (p_region  is null or pr.region_code  = p_region)
  union all
  select d.season_total, d.created_at, d.id, d.rank, d.display_name, d.avatar_url
  from ranking_dummies d
  where d.id = p_uid
    and (p_country is null or d.country_code = p_country)
    and (p_region  is null or d.region_code  = p_region)
),
-- 나보다 점수가 높은 사람 수 — 순위의 몸통이고 백분위 분자의 절반이다.
gt as (
  select ( select count(*) from user_progress p
             join profiles pr on pr.id = p.user_id and pr.deactivated_at is null and pr.is_anonymous = false
            where p.season_total > (select st from m)
              and (p_country is null or pr.country_code = p_country)
              and (p_region  is null or pr.region_code  = p_region) )
       + ( select count(*) from ranking_dummies d
            where d.season_total > (select st from m)
              and (p_country is null or d.country_code = p_country)
              and (p_region  is null or d.region_code  = p_region) ) as c
),
-- 나와 동점인 사람 수(나 포함) — cume_dist 는 '나 이상'을 세므로 이게 필요하다.
eq as (
  select ( select count(*) from user_progress p
             join profiles pr on pr.id = p.user_id and pr.deactivated_at is null and pr.is_anonymous = false
            where p.season_total = (select st from m)
              and (p_country is null or pr.country_code = p_country)
              and (p_region  is null or pr.region_code  = p_region) )
       + ( select count(*) from ranking_dummies d
            where d.season_total = (select st from m)
              and (p_country is null or d.country_code = p_country)
              and (p_region  is null or d.region_code  = p_region) ) as c
),
-- 동점자 중 **나보다 앞에 서는** 사람 수. 동점 해소 = 시각 오름 → id 오름(위 정렬과 동일).
tie as (
  select ( select count(*) from user_progress p
             join profiles pr on pr.id = p.user_id and pr.deactivated_at is null and pr.is_anonymous = false
            where p.season_total = (select st from m)
              and (p.updated_at, p.user_id) < ((select at from m), (select id from m))
              and (p_country is null or pr.country_code = p_country)
              and (p_region  is null or pr.region_code  = p_region) )
       + ( select count(*) from ranking_dummies d
            where d.season_total = (select st from m)
              and (d.created_at, d.id) < ((select at from m), (select id from m))
              and (p_country is null or d.country_code = p_country)
              and (p_region  is null or d.region_code  = p_region) ) as c
),
-- 바로 윗사람의 점수 = 나보다 높은 점수 중 가장 낮은 것. least 는 null 을 건너뛴다.
nxt as (
  select least(
    ( select min(p.season_total) from user_progress p
        join profiles pr on pr.id = p.user_id and pr.deactivated_at is null and pr.is_anonymous = false
       where p.season_total > (select st from m)
         and (p_country is null or pr.country_code = p_country)
         and (p_region  is null or pr.region_code  = p_region) ),
    ( select min(d.season_total) from ranking_dummies d
       where d.season_total > (select st from m)
         and (p_country is null or d.country_code = p_country)
         and (p_region  is null or d.region_code  = p_region) )
  ) as s
)
select jsonb_build_object(
  'top', coalesce((
    select jsonb_agg(jsonb_build_object(
      'rank', r.rk, 'uid', r.id, 'name', r.nm, 'level', r.lvl,
      'rating', r.st, 'avatar', r.av, 'country', r.cc,
      -- ⛔ 티어는 화면에서 제거됐다(머리말 참고). 자리만 남기고 계산하지 않는다.
      'tier', null,
      'percentile', round((
          ( select count(*) from user_progress p2
              join profiles pr2 on pr2.id = p2.user_id and pr2.deactivated_at is null and pr2.is_anonymous = false
             where p2.season_total >= r.st
               and (p_country is null or pr2.country_code = p_country)
               and (p_region  is null or pr2.region_code  = p_region) )
        + ( select count(*) from ranking_dummies d2
             where d2.season_total >= r.st
               and (p_country is null or d2.country_code = p_country)
               and (p_region  is null or d2.region_code  = p_region) )
      )::numeric / (select n from tot), 4),
      'me', (r.id = p_uid)
    ) order by r.rk)
    from top_n r
  ), '[]'::jsonb),
  'total', coalesce((select n from tot), 0),
  -- 이어보기 시작점 = 첫 화면 **마지막 행**. 프론트가 이 값을 그대로 되돌려주면 그 다음부터 온다.
  'cursor', (
    select jsonb_build_object('score', r.st, 'at', r.at, 'id', r.id, 'rank', r.rk)
    from top_n r order by r.rk desc limit 1
  ),
  'me', (
    select jsonb_build_object(
      'rank',   (select c from gt) + (select c from tie) + 1,
      'level',  x.lvl,
      'rating', x.st,
      'name',   x.nm,
      'avatar', x.av,
      'tier',   null,
      'percentile', round(((select c from gt) + (select c from eq))::numeric / (select n from tot), 4),
      -- 1위면 null(옛 판과 같다), 동점자가 위에 있으면 0, 아니면 윗점수와의 차.
      'points_to_pass', case
          when (select c from gt) + (select c from tie) = 0 then null
          when (select c from tie) > 0 then 0
          else (select s from nxt) - x.st end
    )
    from m x
  )
);
$fn$;

grant execute on function public.scoped_top(uuid, integer, text, text) to anon, authenticated, service_role;

-- 대조용으로 잠깐 만들었던 사본 정리(운영에 남기지 않는다).
drop function if exists public.scoped_top_v2(uuid, integer, text, text);
