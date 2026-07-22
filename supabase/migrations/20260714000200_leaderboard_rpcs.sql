-- ============================================================
-- 집계 리더보드 RPC (Phase 1 · T7, STAGE2-B 베이지안 개정)
--   · 지역/국가/학교 버킷 집계만 반환(개인 식별 필드 절대 미노출).
--   · SECURITY DEFINER + set search_path=public. service-role(엣지fn)만 호출:
--     PUBLIC/anon/authenticated 는 revoke execute → service_role 에만 grant.
--     ⚠️ Postgres 는 함수 생성 시 PUBLIC 에 EXECUTE 기본부여 → anon/authenticated
--        만 revoke 하면 PUBLIC 경유로 무력화(T1 CONTROL 과 동일 함정). PUBLIC 부터 revoke.
--   · MIN_BUCKET_USERS=5 프라이버시 floor — member_count<5 버킷 제외
--     (학교 n=1 레벨 유출 방지). 아래 having 절의 리터럴 5 (추후 config-driven).
--   · 참여율 단일출처 = active_today_user_ids() 헬퍼 한 곳만 Phase-2 스왑.
--   · KST 경계: (ts at time zone 'Asia/Seoul')::date.
--   · score = 베이지안 보정평균 (n*group_avg + K*global_avg)/(n+K), daily 는 여기에 참여율(participation)을 곱한다.
--     group_avg=avg(season_total)(버킷), global_avg=버킷과 동일 술어(prior CTE, group by 없이 전체 평균).
--     K=25(shrinkage 상수, 아래 scored CTE 주석 참고 — 추후 config-driven). 소형 그룹은 global_avg 로 수렴, 대형 그룹은 K 영향 미미.
--   · is_anonymous=false — 게스트 응시자(SEMI-CARIS)는 버킷/평균 어디에도 반영하지 않는다.
--   멱등(재실행 안전). schema.sql 의 동명 블록과 DDL 동일.
-- ============================================================

-- (0) daily_activity 선행 생성 — active_today_user_ids() 가 참조하므로 이 마이그레이션에서 먼저 보장.
--     (원 정의는 20260714000400_phase2_character.sql; 둘 다 idempotent `create table if not exists`.)
create table if not exists daily_activity (
  user_id uuid references auth.users(id) on delete cascade,
  day date not null,
  first_seen_at timestamptz default now(),
  primary key (user_id, day)
);
alter table daily_activity enable row level security;

-- (1) 참여율 단일출처 헬퍼 — 오늘(KST) 응시 기록이 있는 distinct 유저.
--     Phase-2 에 daily_activity 로 교체하는 단일 지점(여기만 바꾸면 RPC 3종 반영).
--     RPC 3종이 definer 컨텍스트에서만 호출 → 외부 실행권한 전부 revoke.
create or replace function public.active_today_user_ids() returns setof uuid
  language sql stable security definer set search_path = public as $$
  -- Phase-2 스왑: test_attempts 프록시 → 실제 참여 신호 daily_activity(day=KST 캘린더일).
  select user_id from daily_activity
  where day = (now() at time zone 'Asia/Seoul')::date
$$;
revoke execute on function public.active_today_user_ids() from public, anon, authenticated;

-- (2) region_leaderboard — country_code=p_country, region_code 버킷.
create or replace function public.region_leaderboard(p_country text default 'KR', p_window text default 'daily')
returns jsonb
language sql stable security definer set search_path = public as $$
with active as (select user_id from active_today_user_ids() as t(user_id)),
scope as (
  select up.season_total
  from profiles pr
  join user_progress up on up.user_id = pr.id
  where pr.deactivated_at is null
    and pr.is_anonymous = false
    and pr.country_code = p_country
    and pr.region_code is not null
),
prior as (
  select avg(season_total)::numeric as global_avg from scope
),
buckets as (
  select pr.region_code                                          as code,
         count(*)                                                as member_count,
         avg(up.season_total)::numeric                           as avg_level,
         count(*) filter (where a.user_id is not null)           as active_today
  from profiles pr
  join user_progress up on up.user_id = pr.id
  left join active a     on a.user_id = pr.id
  where pr.deactivated_at is null
    and pr.is_anonymous = false
    and pr.country_code = p_country
    and pr.region_code is not null
  group by pr.region_code
  having count(*) >= 5   -- MIN_BUCKET_USERS 프라이버시 floor (추후 config-driven)
),
scored as (
  select b.*,
         -- K=25: 베이지안 shrinkage 상수(소형 그룹은 global_avg 로 강하게 수렴, n>>25 대형 그룹은 group_avg 지배). 추후 config-driven.
         (b.member_count * b.avg_level + 25 * p.global_avg) / (b.member_count + 25) as bayes
  from buckets b cross join prior p
)
select coalesce(jsonb_agg(jsonb_build_object(
    'code',          code,
    'member_count',  member_count,
    'avg_level',     round(avg_level, 2),
    'active_today',  active_today,
    'participation', round(active_today::numeric / member_count, 4),
    'score',         round(case p_window when 'season' then bayes
                                         else bayes * (active_today::numeric / member_count) end, 4)
  ) order by (case p_window when 'season' then bayes
                            else bayes * (active_today::numeric / member_count) end) desc), '[]'::jsonb)
from scored;
$$;
revoke execute on function public.region_leaderboard(text, text) from public, anon, authenticated;
grant  execute on function public.region_leaderboard(text, text) to service_role;

-- (3) country_leaderboard — country_code 버킷(전 국가).
create or replace function public.country_leaderboard(p_window text default 'daily')
returns jsonb
language sql stable security definer set search_path = public as $$
with active as (select user_id from active_today_user_ids() as t(user_id)),
scope as (
  select up.season_total
  from profiles pr
  join user_progress up on up.user_id = pr.id
  where pr.deactivated_at is null
    and pr.is_anonymous = false
    and pr.country_code is not null
),
prior as (
  select avg(season_total)::numeric as global_avg from scope
),
buckets as (
  select pr.country_code                                         as code,
         count(*)                                                as member_count,
         avg(up.season_total)::numeric                           as avg_level,
         count(*) filter (where a.user_id is not null)           as active_today
  from profiles pr
  join user_progress up on up.user_id = pr.id
  left join active a     on a.user_id = pr.id
  where pr.deactivated_at is null
    and pr.is_anonymous = false
    and pr.country_code is not null
  group by pr.country_code
  having count(*) >= 5   -- MIN_BUCKET_USERS 프라이버시 floor (추후 config-driven)
),
scored as (
  select b.*,
         -- K=25: 베이지안 shrinkage 상수(소형 그룹은 global_avg 로 강하게 수렴, n>>25 대형 그룹은 group_avg 지배). 추후 config-driven.
         (b.member_count * b.avg_level + 25 * p.global_avg) / (b.member_count + 25) as bayes
  from buckets b cross join prior p
)
select coalesce(jsonb_agg(jsonb_build_object(
    'code',          code,
    'member_count',  member_count,
    'avg_level',     round(avg_level, 2),
    'active_today',  active_today,
    'participation', round(active_today::numeric / member_count, 4),
    'score',         round(case p_window when 'season' then bayes
                                         else bayes * (active_today::numeric / member_count) end, 4)
  ) order by (case p_window when 'season' then bayes
                            else bayes * (active_today::numeric / member_count) end) desc), '[]'::jsonb)
from scored;
$$;
revoke execute on function public.country_leaderboard(text) from public, anon, authenticated;
grant  execute on function public.country_leaderboard(text) to service_role;

-- (4) school_leaderboard — country_code=p_country, school_id 버킷(label=schools.name).
create or replace function public.school_leaderboard(p_country text default 'KR', p_window text default 'daily')
returns jsonb
language sql stable security definer set search_path = public as $$
with active as (select user_id from active_today_user_ids() as t(user_id)),
scope as (
  select up.season_total
  from profiles pr
  join user_progress up on up.user_id = pr.id
  where pr.deactivated_at is null
    and pr.is_anonymous = false
    and pr.country_code = p_country
    and pr.school_id is not null
),
prior as (
  select avg(season_total)::numeric as global_avg from scope
),
buckets as (
  select pr.school_id                                            as code,
         max(s.name)                                             as label,
         count(*)                                                as member_count,
         avg(up.season_total)::numeric                           as avg_level,
         count(*) filter (where a.user_id is not null)           as active_today
  from profiles pr
  join user_progress up on up.user_id = pr.id
  left join schools s    on s.id = pr.school_id
  left join active a     on a.user_id = pr.id
  where pr.deactivated_at is null
    and pr.is_anonymous = false
    and pr.country_code = p_country
    and pr.school_id is not null
  group by pr.school_id
  having count(*) >= 5   -- MIN_BUCKET_USERS 프라이버시 floor (추후 config-driven)
),
scored as (
  select b.*,
         -- K=25: 베이지안 shrinkage 상수(소형 그룹은 global_avg 로 강하게 수렴, n>>25 대형 그룹은 group_avg 지배). 추후 config-driven.
         (b.member_count * b.avg_level + 25 * p.global_avg) / (b.member_count + 25) as bayes
  from buckets b cross join prior p
)
select coalesce(jsonb_agg(jsonb_build_object(
    'code',          code,
    'label',         label,
    'member_count',  member_count,
    'avg_level',     round(avg_level, 2),
    'active_today',  active_today,
    'participation', round(active_today::numeric / member_count, 4),
    'score',         round(case p_window when 'season' then bayes
                                         else bayes * (active_today::numeric / member_count) end, 4)
  ) order by (case p_window when 'season' then bayes
                            else bayes * (active_today::numeric / member_count) end) desc), '[]'::jsonb)
from scored;
$$;
revoke execute on function public.school_leaderboard(text, text) from public, anon, authenticated;
grant  execute on function public.school_leaderboard(text, text) to service_role;
