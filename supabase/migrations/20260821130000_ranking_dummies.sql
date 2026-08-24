-- 랭킹 더미(가상 랭커) — /ranking 세 탭이 비어 보이지 않게 하는 가상의 사람들.
--
-- 왜 필요한가 (2026-08-21)
--   ① 월드 랭킹이 전부 한국인이고 점수도 낮아서 세계 서비스로 안 보인다.
--   ② /arena 지도는 "이 지역에 회원이 있다"고 말하는데, 그 지역 사람이 랭킹을 열면 아무도 없다.
--      지도와 랭킹이 서로 다른 말을 하는 이 어긋남이 이 표가 없애려는 것이다.
--
-- ⛔ **auth.users 에 유령 계정을 만들지 않는다.** 그 스키마는 Supabase(GoTrue)가 소유한 영역이라
--    우리가 넣은 행이 인증 로그·MAU 집계에 섞이고, GoTrue 업그레이드 때 마이그레이션 대상이 되며,
--    되돌리기도 어렵다. 별도 표로 두면 걷어낼 때 `delete from ranking_dummies;` 한 줄이다.
--
-- ⛔ **profiles 를 건드리지 않는 것이 이 설계의 핵심이다.** 그래서 다음이 전부 **손댈 필요가 없다**:
--    · 관리자 회원 목록·회원 수 통계        (profiles 만 센다)
--    · reset_season()                        (user_progress 만 본다 → 더미는 시즌 리셋과 무관)
--    · refresh_arena_buckets() 의 실집계      (profiles ⨝ user_progress → has_real 이 안 켜진다)
--      ⚠️ 이게 중요하다 — 더미를 실집계로 잡으면 3,504개 지역 전부에 '실집계' 배지가 켜져서
--        가상인데 진짜 사람이 있다고 말하게 된다. arena 는 시드가, 랭킹은 이 표가 각자 담당한다.
--
-- ⚠️ 그 대가로 **더미가 합류하는 자리를 손으로 열어야 한다** — 아래 scoped_top 하나,
--    그리고 room 함수의 view 액션(남의 방 보기). 카드(공유 이미지)는 leaderboard 가 그리는데
--    캐릭터·스킨을 못 찾으면 폴백 그림으로 정상 동작하므로 안 열어도 깨지지 않는다.

create table if not exists public.ranking_dummies (
  id            uuid primary key default gen_random_uuid(),
  display_name  text not null,
  -- 아바타 규약은 실회원과 같다: 'gem:#hex'(젬 색) 또는 'img:<url>'. 해석은 src/lib/avatar.ts.
  avatar_url    text,
  country_code  text not null,
  -- ⚠️ regions FK — 지도에 없는 지역 코드가 들어가면 그 사람은 어느 지역 탭에도 안 뜨는 유령이 된다.
  region_code   text not null references public.regions(code),
  -- 시험 사다리 등급(1~7). user_progress.rank 와 같은 뜻이고 랭킹 행의 'level' 로 나간다.
  rank          int not null default 1 check (rank between 1 and 7),
  -- 점수 두 트랙도 실회원과 같은 구조다(scoring.ts). season_total 은 둘의 합이라 파생 컬럼이다.
  --   ⚠️ skill_score 는 레벨 클리어당 1,000 이라 1,000 의 배수여야 한다(부분점수가 없다).
  --      활동 트랙(activity_score)이 그 사이를 메운다 — 시즌 리셋 때 0이 되는 쪽도 이쪽이다.
  skill_score    numeric not null default 0 check (skill_score >= 0),
  activity_score numeric not null default 0 check (activity_score >= 0),
  season_total   numeric generated always as (skill_score + activity_score) stored,
  -- 장착한 캐릭터·스킨(user_characters 와 같은 규약). 비면 프론트가 폴백 그림을 쓴다.
  character_key text,
  skin          text,
  created_at    timestamptz not null default now()
);

-- ⚠️ RLS 켜고 정책은 부여하지 않는다 = service role(엣지 함수) 전용. user_progress 와 같은 취급이다.
alter table public.ranking_dummies enable row level security;

-- 랭킹 세 탭이 각각 전세계·국가·지역으로 자른다.
create index if not exists ranking_dummies_score_idx  on public.ranking_dummies (season_total desc, created_at asc);
create index if not exists ranking_dummies_region_idx on public.ranking_dummies (region_code);
create index if not exists ranking_dummies_country_idx on public.ranking_dummies (country_code);

comment on table public.ranking_dummies is
  '랭킹 더미(가상 랭커). profiles/auth.users 와 무관 — 걷어낼 땐 delete 한 줄. scoped_top 이 합류시킨다.';

-- ─────────────────────────────────────────────────────────────
-- scoped_top — 실회원과 더미를 한 줄에 세운다.
--
-- 20260818130000 판에서 바뀐 것은 **base 를 pool 로 감싼 것 하나**다:
--   · 옛 base 는 실회원만 뽑으면서 그 안에서 cume_dist() 를 계산했다. 윈도 함수는 UNION 보다
--     먼저 계산되므로, 더미를 합치려면 **먼저 합치고 나서** 순위·백분위를 내야 한다.
--   · 이름·아바타를 pool 이 들고 오므로 top/me 의 `left join profiles` 가 사라졌다
--     (더미는 profiles 에 행이 없어서 그 조인으로는 이름을 못 받는다).
--
-- ⚠️ 더미가 들어오면 **백분위와 티어가 더미 기준이 된다** — 실사용자 티어가 내려간다.
--    사람이 모이면 어차피 겪을 일이라 그대로 둔다(더미를 빼고 백분위를 내면 화면마다 값이 갈린다).
-- ⚠️ 더미는 '나'가 될 수 없다 — me 는 p_uid 로만 찾고, 더미 id 는 auth 계정 id 와 겹치지 않는다.
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
      'name', r.name,
      'level', r.lvl,
      'rating', r.season_total,
      'avatar', r.avatar_url,
      'country', r.country_code,
      'tier', ranking_tier(r.gpct),
      'percentile', round(r.pct, 4),
      'me', (r.user_id = p_uid)
    ) order by r.grank)
    from ranked r
    where r.grank <= p_limit
  ), '[]'::jsonb),
  'total', coalesce((select gtotal from ranked limit 1), 0),
  'me', (
    select jsonb_build_object(
      'rank', r.grank, 'level', r.lvl, 'rating', r.season_total,
      'name', r.name, 'avatar', r.avatar_url,
      'tier', ranking_tier(r.gpct), 'percentile', round(r.pct, 4),
      'points_to_pass', (select season_total from above) - r.season_total
    )
    from ranked r
    where r.user_id = p_uid
  )
);
$$;
