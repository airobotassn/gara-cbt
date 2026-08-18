-- ============================================================
-- 아레나 집계 버킷 — 시드(더미) + 실집계를 **미리 합쳐 스냅샷으로 들고 있는다**.
--
-- 왜 (2026-08-18):
--   ① 매 요청 재계산이었다. country_/region_/school_leaderboard 는 그냥 stable SQL 함수라
--      호출 한 번에 profiles ⨝ user_progress 를 두 번 훑었다(전체평균 prior + 버킷 group by).
--      그런데 이걸 부르는 자리가 **랜딩(`/`)의 지구본**이다 — 첫 화면 방문자 전원이 전 회원 집계를
--      돌린다. 지금은 회원이 적어 티가 안 날 뿐이고, 사람이 붙는 순간 제일 먼저 아플 자리였다.
--   ② 데모 순위가 **브라우저에 하드코딩**돼 있었다(`src/lib/arena/data.ts` 의 MOCK_TOP_COUNTRY 등).
--      실배포 초기에도 더미를 깔아야 하는데, 그게 프론트 소스에 있으면 값을 바꿀 때마다 배포를 타고
--      "서버가 말하는 순위"와 "화면이 말하는 순위"가 갈린다.
--
-- 그래서 둘을 한 구조로 푼다:
--   arena_seed_buckets   = 더미 기준값(손으로 넣고 안 변한다). 걷어낼 땐 delete 한 줄.
--   arena_bucket_scores  = 크론이 5분마다 시드+실집계를 합쳐 채우는 스냅샷. 읽기 RPC 는 여기서 select 만.
--
-- ⚠️ **개인 랭킹(scoped_top)은 손대지 않았다 — 계속 실시간이다.** 내 순위는 즉시 반영돼야 하고,
--    국가 평균은 5분 늦어도 아무도 모른다. 스냅샷은 집계 버킷 3종(국가·지역·학교)에만 건다.
--
-- ⚠️ **합치는 방식이 이 마이그레이션의 핵심 한 줄이다 — 덮어쓰기가 아니라 가중평균이다.**
--    점수가 avg(season_total) 이라 시드를 실집계로 갈아치우면, 신규 8명이 들어온 순간 국가 평균이
--    그 8명 쪽으로 끌려가 더미 순위가 통째로 무너진다(실제로 그래서 한국이 목표 4위가 아니라 15위였다).
--    시드를 "이미 있던 가상 회원 N명"으로 두고 (Ns*avg_s + Nr*avg_r) / (Ns+Nr) 로 합치면,
--    사람이 붙을수록 시드가 저절로 희석돼 더미를 걷어내는 날을 따로 잡을 필요가 없다.
--    이미 쓰던 베이지안 K=25(가상 회원 25명이 전체 평균을 든다)와 같은 개념이라 체계에도 맞는다.
-- ============================================================

-- ── 1) 시드(더미) 버킷 ────────────────────────────────────────
-- 실데이터가 아니라 "이미 있던 가상 회원"이다. 점수 하나가 아니라 (인원·평균·오늘활동) 한 벌을
-- 들고 있어야 한다 — 평균 체계에서 가중평균을 하려면 인원이 필요하고, 일간창 참여율
-- (active_today/member_count)은 인원만 크고 활동이 0이면 점수를 0으로 만들기 때문이다.
create table if not exists arena_seed_buckets (
  scope        text    not null check (scope in ('country','region','school')),
  code         text    not null,                                   -- 국가=alpha2, 지역=region_code, 학교=school_id
  country_code text,                                               -- region/school 이 속한 나라(country 스코프는 null)
  member_count integer not null check (member_count >= 0),
  avg_level    numeric not null check (avg_level >= 0),
  active_today integer not null default 0 check (active_today >= 0),
  label        text,                                               -- school 전용 표시명
  note         text,
  primary key (scope, code)
);
alter table arena_seed_buckets enable row level security;   -- 정책 없음 = service_role 전용

-- ── 2) 스냅샷 ────────────────────────────────────────────────
-- 읽기 RPC 가 보는 유일한 테이블. bayes·participation 을 나눠 저장하고 score 는 읽을 때
-- 조합한다(window 별로 컬럼을 둘로 늘리지 않기 위해서 — 곱셈 하나라 스캔이 아니다).
create table if not exists arena_bucket_scores (
  scope         text    not null,
  code          text    not null,
  country_code  text,
  label         text,
  member_count  integer not null,
  avg_level     numeric not null,
  active_today  integer not null,
  participation numeric not null,
  bayes         numeric not null,
  -- 실회원이 1명이라도 있나. `/arena` 툴팁의 '실집계' 배지가 이걸 본다 —
  -- 시드와 섞이면 member_count 만으로는 진짜 데이터인지 구분할 수 없다.
  has_real      boolean not null default false,
  real_members  integer not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (scope, code)
);
alter table arena_bucket_scores enable row level security;  -- 정책 없음 = service_role 전용

create index if not exists arena_bucket_scores_scope_idx
  on arena_bucket_scores (scope, country_code, bayes desc);

-- ── 3) 갱신 ──────────────────────────────────────────────────
-- 스코프 3종을 한 번에 다시 만든다. 통째로 지우고 새로 넣지 않고 upsert + 사라진 행만 삭제한다
-- (delete-then-insert 는 갱신 중 찰나에 스냅샷이 비어 화면이 깜빡인다).
create or replace function public.refresh_arena_buckets() returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  n integer;
  t0 timestamptz := clock_timestamp();
begin
  -- ⚠️ 두 번이 겹쳐 돌면 안 된다. 아래 청소가 "이번 실행(t0)보다 오래된 행"을 지우는데, 겹치면
  --    나중 실행이 앞 실행의 결과를 지워 스냅샷이 반쪽이 된다(지구본이 군데군데 캄캄해진다).
  --    pg_cron 은 앞 실행이 주기를 넘기면 겹쳐 띄운다 — 트랜잭션 락이라 커밋되면 자동으로 풀린다.
  perform pg_advisory_xact_lock(hashtext('refresh_arena_buckets'));

  with active as (
    select user_id from active_today_user_ids() as t(user_id)
  ),
  -- 실집계 — 스코프별로 같은 모양(code·country_code·label·members·avg·active)으로 모은다.
  real_rows as (
    select 'country'::text as scope, pr.country_code as code, null::text as country_code, null::text as label,
           count(*)::int as members, avg(up.season_total)::numeric as avg_level,
           count(*) filter (where a.user_id is not null)::int as active_today
    from profiles pr
    join user_progress up on up.user_id = pr.id
    left join active a on a.user_id = pr.id
    where pr.deactivated_at is null and pr.is_anonymous = false and pr.country_code is not null
    group by pr.country_code
    union all
    select 'region', pr.region_code, pr.country_code, null,
           count(*)::int, avg(up.season_total)::numeric,
           count(*) filter (where a.user_id is not null)::int
    from profiles pr
    join user_progress up on up.user_id = pr.id
    left join active a on a.user_id = pr.id
    where pr.deactivated_at is null and pr.is_anonymous = false
      and pr.country_code is not null and pr.region_code is not null
    group by pr.region_code, pr.country_code
    union all
    select 'school', pr.school_id::text, pr.country_code, max(s.name),
           count(*)::int, avg(up.season_total)::numeric,
           count(*) filter (where a.user_id is not null)::int
    from profiles pr
    join user_progress up on up.user_id = pr.id
    left join schools s on s.id = pr.school_id
    left join active a on a.user_id = pr.id
    where pr.deactivated_at is null and pr.is_anonymous = false
      and pr.country_code is not null and pr.school_id is not null
    group by pr.school_id, pr.country_code
  ),
  -- 시드 + 실집계 가중평균. full outer join 이라 시드만 있는 나라도, 시드 없는 신규 버킷도 다 남는다.
  merged as (
    select
      coalesce(s.scope, r.scope)                                              as scope,
      coalesce(s.code,  r.code)                                               as code,
      coalesce(r.country_code, s.country_code)                                as country_code,
      coalesce(r.label, s.label)                                              as label,
      (coalesce(s.member_count,0) + coalesce(r.members,0))                    as member_count,
      case when coalesce(s.member_count,0) + coalesce(r.members,0) = 0 then 0
           else (coalesce(s.member_count,0) * coalesce(s.avg_level,0)
               + coalesce(r.members,0)      * coalesce(r.avg_level,0))
              / (coalesce(s.member_count,0) + coalesce(r.members,0))
      end                                                                     as avg_level,
      (coalesce(s.active_today,0) + coalesce(r.active_today,0))               as active_today,
      coalesce(r.members,0)                                                   as real_members
    from arena_seed_buckets s
    full outer join real_rows r on r.scope = s.scope and r.code = s.code
  ),
  -- 프라이버시 floor. 원래는 실회원 5명 미만 버킷을 통째로 뺐다 — 집계값으로 개인이 드러나서다.
  -- 시드가 깔린 버킷은 실회원 1명이 들어와도 그 사람 점수가 시드 인원에 희석돼 안 드러나므로
  -- **합쳐진 인원** 기준으로 본다. 시드가 없는 버킷은 예전 그대로 실회원 5명이 필요하다.
  kept as (
    select * from merged where member_count >= 5
  ),
  -- 사전분포(prior) — 스코프 안 전체 평균. 원래 avg(season_total) 은 인원 가중평균과 같은 값이라
  -- 시드를 섞은 뒤에도 **인원 가중**으로 내야 의미가 유지된다(버킷 단순평균으로 내면 소국이 과대대표된다).
  prior as (
    select scope,
           case when sum(member_count) = 0 then 0
                else sum(member_count * avg_level) / sum(member_count) end as global_avg
    from kept group by scope
  ),
  scored as (
    select k.*,
           -- K=25 베이지안 shrinkage — 기존 RPC 3종과 같은 상수·같은 식.
           (k.member_count * k.avg_level + 25 * p.global_avg) / (k.member_count + 25) as bayes,
           case when k.member_count = 0 then 0
                else k.active_today::numeric / k.member_count end                      as participation
    from kept k join prior p on p.scope = k.scope
  ),
  upserted as (
    insert into arena_bucket_scores as t
      (scope, code, country_code, label, member_count, avg_level, active_today,
       participation, bayes, has_real, real_members, updated_at)
    select scope, code, country_code, label, member_count, round(avg_level, 4), active_today,
           round(participation, 6), round(bayes, 6), real_members > 0, real_members, t0
    from scored
    on conflict (scope, code) do update set
      country_code  = excluded.country_code,
      label         = excluded.label,
      member_count  = excluded.member_count,
      avg_level     = excluded.avg_level,
      active_today  = excluded.active_today,
      participation = excluded.participation,
      bayes         = excluded.bayes,
      has_real      = excluded.has_real,
      real_members  = excluded.real_members,
      updated_at    = excluded.updated_at
    returning t.scope, t.code
  )
  select count(*)::int into n from upserted;

  -- 이번 갱신에 안 들어온 행 청소(시드를 지웠거나 floor 아래로 내려간 버킷).
  -- ⚠️ now() 가 아니라 t0(이번 실행 시각)로 판별한다 — now() 는 트랜잭션 시작 시각이라 upsert 가
  --    찍은 값과 같아져서 조건이 한 행도 안 잡거나 전부 잡는다.
  delete from arena_bucket_scores where updated_at < t0;

  return n;
end;
$fn$;
revoke execute on function public.refresh_arena_buckets() from public, anon, authenticated;
grant  execute on function public.refresh_arena_buckets() to service_role;

-- ── 4) 읽기 RPC — 스캔이 사라지고 스냅샷 select 만 남는다 ──────
-- 응답 JSON 모양은 **예전과 동일** + `has_real` 한 칸만 늘었다(프론트 배지용).
create or replace function public.country_leaderboard(p_window text default 'daily')
returns jsonb
language sql stable security definer set search_path = public as $fn$
select coalesce(jsonb_agg(jsonb_build_object(
    'code',          code,
    'member_count',  member_count,
    'avg_level',     round(avg_level, 2),
    'active_today',  active_today,
    'participation', round(participation, 4),
    'has_real',      has_real,
    'score',         round(case p_window when 'season' then bayes else bayes * participation end, 4)
  ) order by (case p_window when 'season' then bayes else bayes * participation end) desc), '[]'::jsonb)
from arena_bucket_scores where scope = 'country';
$fn$;
revoke execute on function public.country_leaderboard(text) from public, anon, authenticated;
grant  execute on function public.country_leaderboard(text) to service_role;

create or replace function public.region_leaderboard(p_country text default 'KR', p_window text default 'daily')
returns jsonb
language sql stable security definer set search_path = public as $fn$
select coalesce(jsonb_agg(jsonb_build_object(
    'code',          code,
    'member_count',  member_count,
    'avg_level',     round(avg_level, 2),
    'active_today',  active_today,
    'participation', round(participation, 4),
    'has_real',      has_real,
    'score',         round(case p_window when 'season' then bayes else bayes * participation end, 4)
  ) order by (case p_window when 'season' then bayes else bayes * participation end) desc), '[]'::jsonb)
from arena_bucket_scores where scope = 'region' and country_code = p_country;
$fn$;
revoke execute on function public.region_leaderboard(text, text) from public, anon, authenticated;
grant  execute on function public.region_leaderboard(text, text) to service_role;

create or replace function public.school_leaderboard(p_country text default 'KR', p_window text default 'daily')
returns jsonb
language sql stable security definer set search_path = public as $fn$
select coalesce(jsonb_agg(jsonb_build_object(
    'code',          code,
    'label',         label,
    'member_count',  member_count,
    'avg_level',     round(avg_level, 2),
    'active_today',  active_today,
    'participation', round(participation, 4),
    'has_real',      has_real,
    'score',         round(case p_window when 'season' then bayes else bayes * participation end, 4)
  ) order by (case p_window when 'season' then bayes else bayes * participation end) desc), '[]'::jsonb)
from arena_bucket_scores where scope = 'school' and country_code = p_country;
$fn$;
revoke execute on function public.school_leaderboard(text, text) from public, anon, authenticated;
grant  execute on function public.school_leaderboard(text, text) to service_role;

-- ── 5) 크론 ──────────────────────────────────────────────────
-- ⚠️ pg_cron 이 없거나 권한이 없어도 마이그레이션이 죽으면 안 된다 — 그때는 스냅샷이 갱신만 안 될 뿐
--    화면은 마지막 값으로 정상 동작한다. 수동 갱신은 select refresh_arena_buckets(); 하나다.
do $do$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule('arena-buckets') from cron.job where jobname = 'arena-buckets';
  perform cron.schedule('arena-buckets', '*/5 * * * *', 'select public.refresh_arena_buckets()');
exception when others then
  raise notice 'pg_cron 미설정 — refresh_arena_buckets() 를 수동/외부 스케줄러로 돌릴 것 (%)', sqlerrm;
end;
$do$;
