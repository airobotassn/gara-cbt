-- 2026-09-04 · 학교(school) 기능 잔해 제거
--   학교 입력 UI 는 2026-07-28 에 이미 뗐는데(MyPage 주석) DB 쪽이 그대로 남아 있었다:
--   schools 표 · profiles.school_id · school_leaderboard() RPC · refresh_arena_buckets() 의
--   'school' 스코프 · leaderboard 함수의 scope 분기 · 사전 키 rank.tab_school.
--   실측: profiles 185명 중 school_id 가 채워진 사람 **0명**. 고를 화면이 없으니 영영 안 찬다.
--
--   ⚠️ 되살릴 거면 표를 다시 만드는 게 아니라 **온보딩/마이페이지에 학교 선택을 먼저** 붙여야 한다.
--      순서를 뒤집어서 표만 남겨둔 게 이 상태다.

begin;

-- 1) 학교 리더보드 RPC — 읽는 곳은 leaderboard 함수의 scope='school' 뿐이고 같이 뗀다.
drop function if exists public.school_leaderboard(text, text);

-- 2) 집계 스냅샷에서 학교 버킷 제거(실회원 0명이라 어차피 프라이버시 floor 에 걸려 비어 있다)
delete from arena_bucket_scores where scope = 'school';
delete from arena_seed_buckets  where scope = 'school';

-- 3) 집계 함수에서 'school' union 블록 제거 — 나머지는 손대지 않는다
create or replace function public.refresh_arena_buckets()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  --   ⚠️ 2026-09-04 에 'school' 스코프를 뺐다(학교 기능 제거). 되살리면 여기에 union 을 다시 얹는다.
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
$function$;

-- 4) 탈퇴 파기 함수에서 school_id 제거
--    ⛔ 이걸 빼먹으면 컬럼을 드롭한 뒤 **탈퇴 파기가 런타임에 터진다.** plpgsql 은 본문을 실행할 때
--       이름을 푸므로 drop column 이 조용히 지나가고, 90일 뒤 크론이 돌 때야 알게 된다.
create or replace function public.anonymize_deactivated_accounts(retention_days integer default 90)
returns integer
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  n       int;
  victims uuid[];
begin
  -- ⚠️ 대상을 먼저 확정해서 배열로 든다. 단계마다 같은 where 절을 다시 쓰면 (a) 가 purged_at 을
  --    찍는 순간 (b)·(c) 의 대상이 0건이 되어 **인증 쪽이 통째로 안 지워진다**.
  select array_agg(id) into victims from profiles
   where deactivated_at is not null
     and purged_at is null
     and deactivated_at < now() - make_interval(days => retention_days);
  if victims is null then return 0; end if;

  -- (a) 프로필에서 사람을 알아볼 수 있는 값 전부.
  --     deactivated_at 은 남긴다 — 랭킹 제외가 그 값을 보고, 언제 탈퇴했는지는 분쟁 대응에 필요하다.
  --     ⚠️ 2026-09-04 에 school_id 를 뺐다(컬럼 자체가 없어졌다).
  update profiles p
     set display_name        = null,
         avatar_url          = null,
         country_code        = null,
         region_code         = null,
         age_band            = null,
         nickname_set_at     = null,
         nickname_changed_at = null,
         region_locked_at    = null,
         region_changed_at   = null,
         referral_code       = null,  -- 남이 이 코드를 다시 쓸 수 있게 풀어준다
         referred_by         = null,  -- 누구 소개로 왔는지 = 관계 정보
         suspended_reason    = null,
         purged_at           = now()
   where p.id = any(victims);
  get diagnostics n = row_count;

  -- (b) 인증 쪽. auth.users 행을 지우지 않는 이유는 이 파일 머리 참고(CASCADE).
  --     이메일은 unique 라 비울 수 없어 되돌릴 수 없는 값으로 덮는다.
  --     raw_user_meta_data 에 구글 실명·프로필 사진·이메일이 들어 있다 → 통째로 비운다.
  --     raw_app_meta_data 는 provider 이름뿐이라 GoTrue 가 쓰도록 남긴다.
  update auth.users u
     set email              = 'deleted-' || u.id || '@invalid',
         email_change       = '',
         phone              = null,
         raw_user_meta_data = '{}'::jsonb
   where u.id = any(victims);

  -- (c) 구글 연결 끊기 — 이게 실질적인 '파기' 다. 같은 구글 계정으로 다시 로그인하면
  --     이 uid 와 이어지지 않고 **새 계정**이 만들어진다(옛 기록에 닿을 길이 사라진다).
  delete from auth.identities i where i.user_id = any(victims);
  -- 살아 있는 세션도 끊는다 — 안 끊으면 이미 로그인해 둔 브라우저가 파기 후에도 돌아다닌다.
  delete from auth.sessions s where s.user_id = any(victims);

  return n;
end $function$;

-- 5) 컬럼 제거 — FK(profiles.school_id → schools)와 브라우저 update 권한이 같이 딸려 내려간다
alter table profiles drop column if exists school_id;

-- 6) 표 제거
drop table if exists schools;

commit;
