-- ============================================================
-- CARIS 자격검정 (CBT) — DB 스키마 + RLS
-- Supabase SQL Editor에 그대로 붙여넣어 실행(또는 supabase db push).
-- 핵심 원칙: questions.correct_index / exam_attempts / attempt_answers 는
--           클라이언트 직접 SELECT 금지(= service role 전용, RLS 정책 미부여).
--           모든 시험 출제·채점·결과 read 는 Edge Function(service role)으로만 서빙한다.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- profiles (auth 사용자 프로필 — 프론트/Auth 가 사용) ----------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  is_anonymous boolean default false,   -- SEMI-CARIS 게스트 응시용(자격검정은 start-exam이 익명 차단)
  created_at timestamptz default now()
);

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url, is_anonymous)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.raw_user_meta_data->>'avatar_url',
    coalesce(new.is_anonymous, false)
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- 2층 모델: 문제은행(question_banks) ↔ 등록시험(exams) ----------
-- 문제은행 = 급수(tier)별 문항 풀. 문항은 여기 소속. 회차 무관.
create table if not exists question_banks (
  id uuid primary key default gen_random_uuid(),
  tier text not null unique,            -- beginner|pro|elite|master|grandmaster|zenith (getTracks 티어 key)
  title text not null,
  active boolean not null default true,
  created_at timestamptz default now()
);

-- exams = 등록시험(회차×급수). round_id + tier 로 식별. 뽑힌 문항 세트는 exam_questions.
create table if not exists exams (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  round_id uuid references exam_rounds(id),  -- 소속 회차(등록시험은 NOT NULL 운영)
  tier text,                                 -- 급수 key
  year int,
  round int,
  total_questions int not null default 0,    -- 뽑힌 세트 크기
  duration_minutes int not null default 120,
  active boolean not null default true,
  created_at timestamptz default now(),
  unique (round_id, tier)
);
create index if not exists exams_active_idx on exams(active);
create index if not exists exams_round_idx on exams(round_id);

-- ---------- questions (문제은행 문항) ----------
-- 문항 1개 = 1행, 은행(bank_id) 소속. correct_index·answer_key·explanation 은 절대 클라 비노출.
create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references question_banks(id),
  number int not null,                 -- 은행 내 1..N
  subject text not null,               -- 예: 'AI 리터러시'
  difficulty text,                     -- 난이도 '상'|'중'|'하'(과목 하위분류·관리자 전용·비노출), 미지정 null
  topic text not null,
  prompt text not null,
  kind text not null default 'mc',     -- 'mc'(객관식) | 'short'(주관식)
  choices jsonb not null,              -- 4지선다 보기(주관식은 [])
  correct_index int,                   -- 객관식 0..3(클라 비노출), 주관식 null
  answer_key text,                     -- 주관식 모범답안/채점 기준(관리자 검수 참고, 비노출)
  explanation text,                    -- 정답 해설/풀이(관리자·검수 전용, 절대 비노출)
  deleted_at timestamptz,              -- 소프트삭제
  active boolean not null default true,
  unique (bank_id, number),
  constraint questions_kind_check check (kind in ('mc', 'short')),
  constraint questions_difficulty_check check (difficulty is null or difficulty in ('상', '중', '하')),
  constraint questions_correct_index_check check (
    (kind = 'mc' and correct_index between 0 and 3)
    or (kind = 'short' and correct_index is null)
  )
);
create index if not exists questions_bank_idx on questions(bank_id) where active;

-- ---------- exam_questions (등록시험이 은행에서 뽑은 세트, N:M) ----------
create table if not exists exam_questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references exams(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  number int not null,                 -- 출제 표시 순서 1..N
  created_at timestamptz default now(),
  unique (exam_id, question_id),
  unique (exam_id, number)
);
create index if not exists exam_questions_exam_idx on exam_questions(exam_id);

-- ---------- exam_attempts (응시) ----------
create table if not exists exam_attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid references exams(id),
  round_id uuid references exam_rounds(id),   -- 응시한 회차(정기시험 회차별 채점/집계). 상시·미배정은 null
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'in_progress',  -- in_progress | submitted | voided | expired
  started_at timestamptz default now(),
  submitted_at timestamptz,
  result_release_at timestamptz,         -- 이 시각 이후에만 점수/오답 공개(제출 +7일)
  total_questions int,
  total_correct int,
  created_at timestamptz default now()
);
create index if not exists exam_attempts_round_idx on exam_attempts(round_id);
create index if not exists exam_attempts_user_idx on exam_attempts(user_id);
create index if not exists exam_attempts_status_idx on exam_attempts(status);
create index if not exists exam_attempts_user_status_idx on exam_attempts(user_id, status);

-- ---------- attempt_answers (응답) ----------
-- start-exam 이 출제 문항을 1행씩 고정(부정 제출 방지). submit-exam 이 채점해 채움.
create table if not exists attempt_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid references exam_attempts(id) on delete cascade,
  question_id uuid references questions(id),
  number int,
  selected_index int,                  -- 객관식 선택(0..3), 미응답 null
  answer_text text,                    -- 주관식 응답
  is_correct boolean,                  -- 채점 결과(주관식 검수 전 null)
  review_status text not null default 'auto',  -- auto(객관식 자동) | pending(주관식 검수대기) | graded(검수완료)
  graded_by text,                      -- 검수 관리자 이메일
  graded_at timestamptz,
  time_spent int default 0,
  unique (attempt_id, question_id)
);
create index if not exists attempt_answers_attempt_idx on attempt_answers(attempt_id);

-- ---------- admin_users (관리자 allowlist) ----------
-- 루트 관리자(ROOT_ADMIN)는 함수 상수로 고정. 일반 관리자는 여기에 이메일을 추가한다.
-- service role 전용(클라 정책 없음).
create table if not exists admin_users (
  email text primary key,
  added_by text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- RLS: 잠금 테이블엔 클라 정책을 두지 않는다(= service role 전용).
--   exams/questions/exam_attempts/attempt_answers/admin_users 직접 쿼리 시 0행/거부.
--   모든 read/write 는 Edge Function(service role)이 수행.
-- ============================================================
alter table profiles        enable row level security;
alter table question_banks  enable row level security;
alter table exams           enable row level security;
alter table questions       enable row level security;
alter table exam_questions  enable row level security;
alter table exam_attempts   enable row level security;
alter table attempt_answers enable row level security;
alter table admin_users     enable row level security;

-- profiles: 본인 것만 read/update (그 외 테이블은 정책 없음 → service role 전용)
drop policy if exists "profiles_select_own" on profiles;
create policy "profiles_select_own" on profiles
  for select using (auth.uid() = id);
drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own" on profiles
  for update using (auth.uid() = id);

-- ============================================================
-- SEMI-CARIS 모듈 (/test/*) — 자격검정과 한 프로젝트 공존.
--   충돌 회피 리네임: questions→test_questions, attempt_answers→test_answers.
--   델타 마이그레이션: migrations/20260701120000_add_leveltest_tables.sql
-- ============================================================
create extension if not exists vector;

do $$ begin
  create type attempt_status as enum ('in_progress','submitted','expired','voided');
exception when duplicate_object then null; end $$;

-- test_questions (다국어 레벨 문제은행)
create table if not exists test_questions (
  id uuid primary key default gen_random_uuid(),
  code text,
  level int not null check (level between 1 and 7),
  category text not null,              -- 그 레벨의 6축 코드
  correct_index int not null,          -- 클라 비노출
  prompt_i18n jsonb not null,
  options_i18n jsonb not null,
  explanation_i18n jsonb not null default '{}'::jsonb,
  active boolean default true,
  created_at timestamptz default now()
);
create index if not exists test_questions_level_cat_idx on test_questions(level, category) where active;
create index if not exists test_questions_code_idx on test_questions(code);

-- test_attempts (SEMI-CARIS 응시)
create table if not exists test_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  level int not null check (level between 1 and 7),
  lang text not null default 'ko',
  status attempt_status not null default 'in_progress',
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  total_correct int default 0,
  total_questions int default 0,
  axis_perf jsonb,
  deltas jsonb,
  rating_after jsonb,
  rank_before int,
  rank_after int,
  rank_dir text,
  warn_strikes int default 0,
  applied boolean not null default false,
  violation_count int default 0,
  claim_token uuid not null default gen_random_uuid(),  -- 게스트→로그인 결과 이관용
  created_at timestamptz default now()
);
create index if not exists test_attempts_user_idx on test_attempts(user_id, status, submitted_at);

-- test_answers (SEMI-CARIS 응답)
create table if not exists test_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references test_attempts(id) on delete cascade,
  question_id uuid not null references test_questions(id),
  category text not null,
  selected_index int,
  is_correct boolean not null default false,
  time_spent int default 0,
  created_at timestamptz default now()
);
create index if not exists test_answers_attempt_idx on test_answers(attempt_id);

-- user_level_skill (레벨별 누적 6축 레이팅)
create table if not exists user_level_skill (
  user_id uuid not null references auth.users(id) on delete cascade,
  level int not null,
  ratings jsonb not null default '{}'::jsonb,
  attempts_count int not null default 0,
  placed boolean not null default false,
  updated_at timestamptz default now(),
  primary key (user_id, level)
);

-- user_progress (현재 등급 = 레벨 + 랭킹 점수)
create table if not exists user_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rank int not null default 1,
  demotion_strikes int not null default 0,
  points int not null default 0,
  updated_at timestamptz default now()
);
create index if not exists user_progress_points_idx on user_progress (points desc, updated_at asc);

-- question_reports (SEMI-CARIS 문항 오류 제보)
create table if not exists question_reports (
  id uuid primary key default gen_random_uuid(),
  question_id uuid references test_questions(id) on delete set null,
  code text,
  attempt_id uuid,
  user_id uuid,
  lang text,
  message text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

alter table test_questions   enable row level security;
alter table test_attempts    enable row level security;
alter table test_answers     enable row level security;
alter table user_level_skill enable row level security;
alter table user_progress    enable row level security;
alter table question_reports enable row level security;
-- test_* / user_* / question_reports: 클라 정책 없음 → service role(Edge Function)만 접근.

-- reco_cache / reco_shadow_log — 레벨 추천 시맨틱 캐시 (key=입력 임베딩, value=레벨)
create table if not exists reco_cache (
  id         bigserial primary key,
  embedding  vector(768) not null,
  level      smallint not null,
  sample     text,
  created_at timestamptz default now()
);
create index if not exists reco_cache_embedding_idx
  on reco_cache using hnsw (embedding vector_cosine_ops);

create table if not exists reco_shadow_log (
  id          bigserial primary key,
  sample      text,
  level_llm   smallint,
  level_cache smallint,
  similarity  real,
  created_at  timestamptz default now()
);

create or replace function match_reco_cache(query_embedding vector(768), match_count int default 1)
returns table (level smallint, similarity real)
language sql stable as $$
  select level, (1 - (embedding <=> query_embedding))::real as similarity
  from reco_cache
  order by embedding <=> query_embedding
  limit match_count;
$$;

alter table reco_cache      enable row level security;
alter table reco_shadow_log enable row level security;

-- ---------- SEMI-CARIS 후속 객체 (랭킹/소프트삭제) ----------
-- user_level_skill.rating: applyAttempt가 매 응시 기록(랭킹 정렬용 6축 평균)
alter table user_level_skill add column if not exists rating numeric(6,2) not null default 0;
create index if not exists user_level_skill_lvl_rating_idx
  on user_level_skill (level, rating desc, attempts_count asc);
-- test_questions.deleted_at: 문항 소프트 삭제
alter table test_questions add column if not exists deleted_at timestamptz;
create index if not exists test_questions_deleted_idx
  on test_questions (deleted_at) where deleted_at is not null;
-- profiles.deactivated_at: 회원 탈퇴 소프트 삭제(랭킹 제외 + 보관 후 purge)
alter table profiles add column if not exists deactivated_at timestamptz;
create index if not exists profiles_deactivated_idx
  on profiles (deactivated_at) where deactivated_at is not null;

-- 명예의 전당 RPC: user_progress.points 정렬(동점=먼저 도달), 탈퇴자 제외. leaderboard 함수가 호출.
create or replace function public.global_top(p_uid uuid, p_limit int default 10)
returns jsonb language sql stable as $$
with ranked as (
  select p.user_id, p.rank as lvl, p.points,
         row_number() over (order by p.points desc, p.updated_at asc) as grank,
         count(*) over () as gtotal
  from user_progress p
  join profiles pr0 on pr0.id = p.user_id and pr0.deactivated_at is null
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

-- 보관기간(기본 90일) 지난 탈퇴 계정 완전 삭제(auth.users → cascade).
create or replace function public.purge_deactivated_accounts(retention_days int default 90)
returns int language plpgsql security definer set search_path = public, auth as $$
declare n int;
begin
  with del as (
    delete from auth.users u using profiles p
    where p.id = u.id and p.deactivated_at is not null
      and p.deactivated_at < now() - make_interval(days => retention_days)
    returning u.id
  )
  select count(*) into n from del;
  return n;
end;
$$;
revoke all on function public.purge_deactivated_accounts(int) from public, anon, authenticated;

-- ============================================================
-- 온보딩: 국가·지역·학교 + 지역 락 (Phase 1 · T1)
--   · profiles 확장: country_code / region_code / school_id / region_locked_at
--   · 지역 = ISO 3166-2 (regions 참조테이블 FK) · 학교 = schools(정규화, 공개 read)
--   · 락(불변식): country_code / region_code / region_locked_at 는 service-role
--     (set-region 함수)만 쓰기. RLS profiles_update_own 이 병렬 쓰기경로이므로
--     UI 숨김이 아니라 컬럼 권한으로 강제한다.
--     ⚠️ 컬럼-only REVOKE 는 Supabase 기본 테이블 UPDATE grant 에 무력화되므로
--        반드시 [테이블 REVOKE] + [허용 컬럼만 GRANT] 로 emit 한다.
--     ⚠️ 트리거는 방어심층: 락 이후 지역 컬럼 변경을 차단(GUC 로만 우회 = 어드민 CS).
--   멱등(재실행 안전). migrations/20260714000000_region_onboarding.sql 과 DDL 동일.
-- ============================================================

-- (1) pg_trgm: 학교명 자동완성(유사도 검색)
create extension if not exists pg_trgm;

-- (2) schools (정규화 — 학교 대항 순위 대비, 목록은 공개 read)
create table if not exists schools (
  id          text primary key,   -- 공공데이터 학교ID(학교코드) or 자체 slug
  name        text not null,
  kind        text,               -- university | college
  region_code text,               -- 학교 소재 시도(선택)
  active      boolean not null default true
);
alter table schools enable row level security;
drop policy if exists "schools_select_all" on schools;
create policy "schools_select_all" on schools for select using (true);
create index if not exists schools_name_trgm on schools using gin (name gin_trgm_ops);

-- (3) regions (ISO 3166-2:KR 17 시도 — 지역 코드 유효성의 단일출처 = FK 대상)
create table if not exists regions (
  code text primary key
);
insert into regions (code) values
  ('KR-11'),('KR-26'),('KR-27'),('KR-28'),('KR-29'),('KR-30'),('KR-31'),
  ('KR-41'),('KR-42'),('KR-43'),('KR-44'),('KR-45'),('KR-46'),('KR-47'),
  ('KR-48'),('KR-49'),('KR-50')
on conflict (code) do nothing;
alter table regions enable row level security;
drop policy if exists "regions_select_all" on regions;
create policy "regions_select_all" on regions for select using (true);

-- (4) profiles 확장 — regions/schools 생성 이후에 FK 추가
alter table profiles add column if not exists country_code     text;
alter table profiles add column if not exists region_code      text references regions(code);
alter table profiles add column if not exists school_id        text references schools(id) on delete set null;
alter table profiles add column if not exists region_locked_at timestamptz;

-- (5) 부분 인덱스 (탈퇴자 제외)
create index if not exists profiles_region_idx  on profiles (region_code)  where deactivated_at is null;
create index if not exists profiles_country_idx on profiles (country_code) where deactivated_at is null;
create index if not exists profiles_school_idx  on profiles (school_id)    where deactivated_at is null;

-- (6) 락 1차 — 컬럼 권한. set-region(service role)만 지역 3컬럼 쓰기.
--   ⚠️ school_id 컬럼 추가(4) 이후에 emit (GRANT 목록이 school_id 를 참조).
--   ⚠️ 테이블 REVOKE 후 허용 컬럼만 재부여 (컬럼-only revoke 는 무력화됨).
--   service_role 은 revoke 대상이 아니므로 여전히 전 컬럼 쓰기 가능.
revoke update on public.profiles from authenticated, anon;
grant  update (display_name, avatar_url, school_id, deactivated_at) on public.profiles to authenticated;

-- (7) 락 방어심층 — 트리거. 락 이후 지역 컬럼이 실제 변경될 때만 차단(GUC 우회).
--   deactivated_at 등 비지역 컬럼만 바뀌는 update(재활성/탈퇴)는 통과.
create or replace function enforce_region_lock() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if OLD.region_locked_at is not null
     and (NEW.country_code       is distinct from OLD.country_code
          or NEW.region_code     is distinct from OLD.region_code
          or NEW.region_locked_at is distinct from OLD.region_locked_at)
     and coalesce(current_setting('app.allow_region_change', true), 'off') <> 'on' then
    raise exception 'region is locked';
  end if;
  return NEW;
end $$;
drop trigger if exists trg_region_lock on profiles;
create trigger trg_region_lock before update on profiles
  for each row execute function enforce_region_lock();


-- ============================================================
-- 집계 리더보드 RPC (Phase 1 · T7)
--   · 지역/국가/학교 버킷 집계만 반환(개인 식별 필드 절대 미노출).
--   · SECURITY DEFINER + set search_path=public. service-role(엣지fn)만 호출:
--     PUBLIC/anon/authenticated 는 revoke execute → service_role 에만 grant.
--     ⚠️ Postgres 는 함수 생성 시 PUBLIC 에 EXECUTE 기본부여 → anon/authenticated
--        만 revoke 하면 PUBLIC 경유로 무력화(T1 CONTROL 과 동일 함정). PUBLIC 부터 revoke.
--   · MIN_BUCKET_USERS=5 프라이버시 floor — member_count<5 버킷 제외
--     (학교 n=1 레벨 유출 방지). 아래 having 절의 리터럴 5 (추후 config-driven).
--   · 참여율 단일출처 = active_today_user_ids() 헬퍼 한 곳만 Phase-2 스왑.
--   · KST 경계: (ts at time zone 'Asia/Seoul')::date.
--   · score = daily? avg_level*participation : avg_level(season 누적).
--   멱등(재실행 안전). schema.sql 의 동명 블록과 DDL 동일.
-- ============================================================

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
buckets as (
  select pr.region_code                                          as code,
         count(*)                                                as member_count,
         avg(up.rank)::numeric                                   as avg_level,
         count(*) filter (where a.user_id is not null)           as active_today
  from profiles pr
  join user_progress up on up.user_id = pr.id
  left join active a     on a.user_id = pr.id
  where pr.deactivated_at is null
    and pr.country_code = p_country
    and pr.region_code is not null
  group by pr.region_code
  having count(*) >= 5   -- MIN_BUCKET_USERS 프라이버시 floor (추후 config-driven)
)
select coalesce(jsonb_agg(jsonb_build_object(
    'code',          code,
    'member_count',  member_count,
    'avg_level',     round(avg_level, 2),
    'active_today',  active_today,
    'participation', round(active_today::numeric / member_count, 4),
    'score',         round(case p_window when 'season' then avg_level
                                         else avg_level * (active_today::numeric / member_count) end, 4)
  ) order by (case p_window when 'season' then avg_level
                            else avg_level * (active_today::numeric / member_count) end) desc), '[]'::jsonb)
from buckets;
$$;
revoke execute on function public.region_leaderboard(text, text) from public, anon, authenticated;
grant  execute on function public.region_leaderboard(text, text) to service_role;

-- (3) country_leaderboard — country_code 버킷(전 국가).
create or replace function public.country_leaderboard(p_window text default 'daily')
returns jsonb
language sql stable security definer set search_path = public as $$
with active as (select user_id from active_today_user_ids() as t(user_id)),
buckets as (
  select pr.country_code                                         as code,
         count(*)                                                as member_count,
         avg(up.rank)::numeric                                   as avg_level,
         count(*) filter (where a.user_id is not null)           as active_today
  from profiles pr
  join user_progress up on up.user_id = pr.id
  left join active a     on a.user_id = pr.id
  where pr.deactivated_at is null
    and pr.country_code is not null
  group by pr.country_code
  having count(*) >= 5   -- MIN_BUCKET_USERS 프라이버시 floor (추후 config-driven)
)
select coalesce(jsonb_agg(jsonb_build_object(
    'code',          code,
    'member_count',  member_count,
    'avg_level',     round(avg_level, 2),
    'active_today',  active_today,
    'participation', round(active_today::numeric / member_count, 4),
    'score',         round(case p_window when 'season' then avg_level
                                         else avg_level * (active_today::numeric / member_count) end, 4)
  ) order by (case p_window when 'season' then avg_level
                            else avg_level * (active_today::numeric / member_count) end) desc), '[]'::jsonb)
from buckets;
$$;
revoke execute on function public.country_leaderboard(text) from public, anon, authenticated;
grant  execute on function public.country_leaderboard(text) to service_role;

-- (4) school_leaderboard — country_code=p_country, school_id 버킷(label=schools.name).
create or replace function public.school_leaderboard(p_country text default 'KR', p_window text default 'daily')
returns jsonb
language sql stable security definer set search_path = public as $$
with active as (select user_id from active_today_user_ids() as t(user_id)),
buckets as (
  select pr.school_id                                            as code,
         max(s.name)                                             as label,
         count(*)                                                as member_count,
         avg(up.rank)::numeric                                   as avg_level,
         count(*) filter (where a.user_id is not null)           as active_today
  from profiles pr
  join user_progress up on up.user_id = pr.id
  left join schools s    on s.id = pr.school_id
  left join active a     on a.user_id = pr.id
  where pr.deactivated_at is null
    and pr.country_code = p_country
    and pr.school_id is not null
  group by pr.school_id
  having count(*) >= 5   -- MIN_BUCKET_USERS 프라이버시 floor (추후 config-driven)
)
select coalesce(jsonb_agg(jsonb_build_object(
    'code',          code,
    'label',         label,
    'member_count',  member_count,
    'avg_level',     round(avg_level, 2),
    'active_today',  active_today,
    'participation', round(active_today::numeric / member_count, 4),
    'score',         round(case p_window when 'season' then avg_level
                                         else avg_level * (active_today::numeric / member_count) end, 4)
  ) order by (case p_window when 'season' then avg_level
                            else avg_level * (active_today::numeric / member_count) end) desc), '[]'::jsonb)
from buckets;
$$;
revoke execute on function public.school_leaderboard(text, text) from public, anon, authenticated;
grant  execute on function public.school_leaderboard(text, text) to service_role;

-- ---------- 어드민: 지역 오배정 정정 (T9) ----------
-- 락된 profiles 의 국가/지역을 어드민 CS 경로로 강제 정정. enforce_region_lock 트리거를
-- 함수-내부 GUC(set_config is_local=true → 트랜잭션-로컬, pgbouncer 누수 X)로 우회.
-- UPDATE 와 원자적. region_code 는 regions FK 로 유효성 보장. region_locked_at 은 coalesce 로 보존.
-- SECURITY DEFINER + revoke: service-role 엣지fn(admin) 만 호출.
create or replace function admin_set_region(p_uid uuid, p_country text, p_region text)
  returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.allow_region_change', 'on', true);
  update profiles
     set country_code = p_country,
         region_code = p_region,
         region_locked_at = coalesce(region_locked_at, now())
   where id = p_uid;
end $$;
revoke all on function admin_set_region(uuid, text, text) from public, anon, authenticated;

-- Phase2 캐릭터·성장 엔진 — cosmetic-only 경제.
--  · 이 테이블들은 user_progress / user_level_skill 과 무관(실력/진화 불변식 보존).
--  · 파츠/뽑기/상점/쇠퇴/스탬프/티켓/출석은 순수 꾸미기·재화 레이어일 뿐,
--    레벨(진화 모양)·자격증(칭호)·실력 데이터는 절대 건드리지 않는다.
--  · 확률/천장/임계 등 수치는 config-driven 상수(추후 확정) — DDL 에 하드코딩 금지.
--  · 모든 테이블: RLS enable + 클라 정책 미부여 = service-role(Edge Function) 전용.

-- 캐릭터: base_key = 진화/모양 포인터가 아니라 캐릭터 프리셋 키(꾸미기 베이스). equipped = 장착 파츠 맵.
create table if not exists user_characters (
  user_id uuid primary key references auth.users(id) on delete cascade,
  base_key text not null default 'default',
  equipped jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);
alter table user_characters enable row level security;

-- 재화: cosmetic 경제 포인트(실력 점수 아님). bigint = 누적 상한 여유.
create table if not exists user_currency (
  user_id uuid primary key references auth.users(id) on delete cascade,
  points bigint not null default 0,
  updated_at timestamptz default now()
);
alter table user_currency enable row level security;

-- 보유 파츠(꾸미기 아이템). source = gacha | shop | grant 등.
create table if not exists user_cosmetics (
  user_id uuid references auth.users(id) on delete cascade,
  part_key text not null,
  acquired_at timestamptz default now(),
  source text,
  primary key (user_id, part_key)
);
alter table user_cosmetics enable row level security;

-- 뽑기 천장(pity) 카운터 — 풀별 누적.
create table if not exists user_gacha_pity (
  user_id uuid references auth.users(id) on delete cascade,
  pool_key text not null,
  counter int not null default 0,
  primary key (user_id, pool_key)
);
alter table user_gacha_pity enable row level security;

-- 뽑기 로그 — 서버권위 결과 감사 + 멱등(client_nonce). was_dupe/refund_points = 중복환급.
create table if not exists gacha_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  pool_key text not null,
  client_nonce text not null,
  result_part_key text,
  was_dupe boolean not null default false,
  refund_points int not null default 0,
  pity_before int,
  created_at timestamptz default now(),
  unique (user_id, client_nonce)
);
alter table gacha_log enable row level security;

-- 상점 구매 로그 — 멱등(client_nonce) + 소비 포인트 감사.
create table if not exists shop_purchase (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  client_nonce text not null,
  part_key text not null,
  spent_points int not null default 0,
  created_at timestamptz default now(),
  unique (user_id, client_nonce)
);
alter table shop_purchase enable row level security;

-- 마일스톤 스탬프 — 누적 카운트(연속 아님).
create table if not exists user_stamps (
  user_id uuid references auth.users(id) on delete cascade,
  stamp_kind text not null,
  count int not null default 0,
  updated_at timestamptz default now(),
  primary key (user_id, stamp_kind)
);
alter table user_stamps enable row level security;

-- 티켓 재고(뽑기권 등) — 종류별 수량.
create table if not exists user_tickets (
  user_id uuid references auth.users(id) on delete cascade,
  kind text not null,
  qty int not null default 0,
  primary key (user_id, kind)
);
alter table user_tickets enable row level security;

-- 하루완료(출석) — 오늘의 콘텐츠 소비 1/일(KST day). pk(user_id, day) = 1/day 보장.
create table if not exists daily_activity (
  user_id uuid references auth.users(id) on delete cascade,
  day date not null,
  first_seen_at timestamptz default now(),
  primary key (user_id, day)
);
alter table daily_activity enable row level security;

-- Phase2 경제 — 서버권위 뽑기(gacha)·상점(shop) 원자 트랜잭션.
--  · supabase-js 는 다중문 트랜잭션이 없으므로 차감→지급→로그를 하나의 plpgsql 호출로 원자화한다.
--  · cosmetic-only 하드 불변식: 이 함수들은 user_progress / user_level_skill 을 절대 읽거나 쓰지 않는다.
--    (실력/진화/티어 데이터와 무관한 순수 꾸미기·재화 레이어)
--  · 수치(비용/환급/천장)는 plpgsql 상수로 하드코딩 — 추후 config 로 이관.
--  · 모든 함수: SECURITY DEFINER + set search_path=public + public/anon/authenticated 실행권 회수 + service_role 만 grant.

-- 뽑기 풀 — 풀별 파츠 가중치/희귀 플래그. service-role 전용(RLS enable + 정책 미부여).
create table if not exists gacha_pool (
  pool_key text not null,
  part_key text not null,
  weight int not null default 1,
  is_rare boolean not null default false,
  primary key (pool_key, part_key)
);
alter table gacha_pool enable row level security;

-- 'default' 풀 시드(~6 파츠). 흔함 4 + 희귀 2. weight = 상대 가중치.
insert into gacha_pool (pool_key, part_key, weight, is_rare) values
  ('default', 'hat_common_01',   40, false),
  ('default', 'hat_common_02',   40, false),
  ('default', 'shoe_common_01',  30, false),
  ('default', 'glasses_common_01',30, false),
  ('default', 'wing_rare_01',     5, true),
  ('default', 'crown_rare_01',    5, true)
on conflict (pool_key, part_key) do nothing;

-- ============================================================================
-- gacha_draw: 원자 뽑기. 멱등(user_id,client_nonce). 차감 먼저 → 지급 → 로그.
--   반환 jsonb: {part_key, was_dupe, refund_points, pity_before, points_after}
--   NEVER blank — 항상 파츠 하나를 반환한다(가중 랜덤 + 천장 시 희귀 강제).
-- ============================================================================
create or replace function gacha_draw(p_uid uuid, p_pool text, p_nonce text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- 추후 config 로 이관할 수치 상수
  c_draw_cost    constant int := 100;  -- 1회 뽑기 비용
  c_dupe_refund  constant int := 20;   -- 중복 파츠 환급
  c_pity_ceiling constant int := 50;   -- 천장(이 값 이상이면 희귀 강제)

  v_existing     record;
  v_points       bigint;
  v_pity_before  int;
  v_force_rare   boolean;
  v_rand         double precision;
  v_total        bigint;
  v_part         text;
  v_is_rare      boolean;
  v_was_dupe     boolean := false;
  v_refund       int := 0;
  v_points_after bigint;
begin
  -- (0) 멱등: 이미 처리된 nonce 면 저장된 결과를 재구성해 반환(중복 차감/지급 방지).
  select gl.result_part_key, gl.was_dupe, gl.refund_points, gl.pity_before
    into v_existing
    from gacha_log gl
   where gl.user_id = p_uid and gl.client_nonce = p_nonce;
  if found then
    select coalesce(uc.points, 0) into v_points_after from user_currency uc where uc.user_id = p_uid;
    return jsonb_build_object(
      'part_key',      v_existing.result_part_key,
      'was_dupe',      v_existing.was_dupe,
      'refund_points', v_existing.refund_points,
      'pity_before',   v_existing.pity_before,
      'points_after',  coalesce(v_points_after, 0)
    );
  end if;

  -- (1) 재화 행 보장 + 현재 포인트 잠금.
  insert into user_currency (user_id) values (p_uid) on conflict (user_id) do nothing;
  select points into v_points from user_currency where user_id = p_uid for update;

  -- (2) 비용 확인 — 부족하면 원자 롤백.
  if v_points < c_draw_cost then
    raise exception 'insufficient_points';
  end if;

  -- (3) 차감 먼저(지급 전).
  update user_currency set points = points - c_draw_cost, updated_at = now() where user_id = p_uid;
  v_points_after := v_points - c_draw_cost;

  -- (4) 천장 카운터 읽기.
  select coalesce(counter, 0) into v_pity_before from user_gacha_pity where user_id = p_uid and pool_key = p_pool;
  v_pity_before := coalesce(v_pity_before, 0);
  v_force_rare  := v_pity_before >= c_pity_ceiling;  -- 천장 도달 시 희귀 강제(no-blank)

  -- (5) 가중 랜덤 파츠 선택. 강제 희귀면 희귀 파츠만 후보.
  --     cum(누적합) >= v_rand*total 인 첫 행 = 가중 표본. total 이상은 반드시 존재 → NEVER blank.
  v_rand := random();
  select coalesce(sum(weight), 0) into v_total
    from gacha_pool where pool_key = p_pool and (not v_force_rare or is_rare);
  if coalesce(v_total, 0) <= 0 then
    -- 풀에 후보가 없으면(설정 오류) 강제 희귀를 풀어 전체 풀에서 선택.
    v_force_rare := false;
    select coalesce(sum(weight), 0) into v_total from gacha_pool where pool_key = p_pool;
  end if;

  select s.part_key, s.is_rare into v_part, v_is_rare
    from (
      select gp.part_key, gp.is_rare,
             sum(gp.weight) over (order by gp.part_key rows between unbounded preceding and current row) as cum
        from gacha_pool gp
       where gp.pool_key = p_pool and (not v_force_rare or gp.is_rare)
    ) s
   where s.cum >= v_rand * v_total
   order by s.cum
   limit 1;

  -- 방어적: 부동소수 경계로 못 골랐으면 마지막(최대 cum) 파츠 — 여전히 NEVER blank.
  if v_part is null then
    select gp.part_key, gp.is_rare into v_part, v_is_rare
      from gacha_pool gp
     where gp.pool_key = p_pool and (not v_force_rare or gp.is_rare)
     order by gp.part_key desc
     limit 1;
  end if;

  -- (6) 중복 판정 → 환급 or 신규 지급.
  if exists (select 1 from user_cosmetics where user_id = p_uid and part_key = v_part) then
    v_was_dupe := true;
    v_refund   := c_dupe_refund;
    update user_currency set points = points + c_dupe_refund, updated_at = now() where user_id = p_uid;
    v_points_after := v_points_after + c_dupe_refund;
  else
    insert into user_cosmetics (user_id, part_key, source) values (p_uid, v_part, 'gacha')
      on conflict (user_id, part_key) do nothing;
  end if;

  -- (7) 천장 갱신: 희귀면 0 리셋, 아니면 +1.
  insert into user_gacha_pity (user_id, pool_key, counter)
    values (p_uid, p_pool, case when v_is_rare then 0 else 1 end)
  on conflict (user_id, pool_key) do update
    set counter = case when v_is_rare then 0 else user_gacha_pity.counter + 1 end;

  -- (8) 감사 로그(멱등 가드 = unique(user_id, client_nonce)).
  insert into gacha_log (user_id, pool_key, client_nonce, result_part_key, was_dupe, refund_points, pity_before)
    values (p_uid, p_pool, p_nonce, v_part, v_was_dupe, v_refund, v_pity_before);

  return jsonb_build_object(
    'part_key',      v_part,
    'was_dupe',      v_was_dupe,
    'refund_points', v_refund,
    'pity_before',   v_pity_before,
    'points_after',  v_points_after
  );
end;
$$;

-- 상점 카탈로그 — 구매 가능 파츠/가격/활성. 가격은 공개 조회(상점 UI), 권위는 서버.
create table if not exists shop_catalog (part_key text primary key, price int not null, active boolean not null default true);
alter table shop_catalog enable row level security;
drop policy if exists "shop_catalog_select_all" on shop_catalog;
create policy "shop_catalog_select_all" on shop_catalog for select using (true);
insert into shop_catalog(part_key,price) values ('hat_common_01',200),('hat_common_02',200),('shoe_common_01',200),('glasses_common_01',200),('wing_rare_01',800),('crown_rare_01',800) on conflict (part_key) do nothing;

-- ============================================================================
-- shop_buy: 원자 구매. 멱등(user_id,client_nonce). 차감 → 지급 → 로그.
--   반환 jsonb: {part_key, spent_points, points_after}
-- ============================================================================
create or replace function shop_buy(p_uid uuid, p_part text, p_nonce text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing     record;
  v_points       bigint;
  v_points_after bigint;
  v_price        int;
begin
  -- (0) 멱등: 이미 처리된 nonce 면 저장된 결과 반환.
  select sp.part_key, sp.spent_points into v_existing
    from shop_purchase sp
   where sp.user_id = p_uid and sp.client_nonce = p_nonce;
  if found then
    select coalesce(uc.points, 0) into v_points_after from user_currency uc where uc.user_id = p_uid;
    return jsonb_build_object(
      'part_key',     v_existing.part_key,
      'spent_points', v_existing.spent_points,
      'points_after', coalesce(v_points_after, 0)
    );
  end if;

  -- (0.5) 카탈로그 가격 조회 — 서버 권위. 클라이언트 값 무시. 없으면 invalid_part.
  select price into v_price from shop_catalog where part_key = p_part and active;
  if v_price is null then
    raise exception 'invalid_part';
  end if;

  -- (1) 재화 행 보장 + 잠금.
  insert into user_currency (user_id) values (p_uid) on conflict (user_id) do nothing;
  select points into v_points from user_currency where user_id = p_uid for update;

  -- (2) 잔액 확인.
  if v_points < v_price then
    raise exception 'insufficient_points';
  end if;

  -- (3) 차감.
  update user_currency set points = points - v_price, updated_at = now() where user_id = p_uid;
  v_points_after := v_points - v_price;

  -- (4) 파츠 지급(중복이면 무시 — 결제는 유효, 멱등 로그로 재구매 차단).
  insert into user_cosmetics (user_id, part_key, source) values (p_uid, p_part, 'shop')
    on conflict (user_id, part_key) do nothing;

  -- (5) 결제 로그(멱등 가드 = unique(user_id, client_nonce)).
  insert into shop_purchase (user_id, client_nonce, part_key, spent_points)
    values (p_uid, p_nonce, p_part, v_price);

  return jsonb_build_object(
    'part_key',     p_part,
    'spent_points', v_price,
    'points_after', v_points_after
  );
end;
$$;

-- 실행권한: public/anon/authenticated 회수 → service_role(Edge Function) 만 실행.
revoke all on function gacha_draw(uuid, text, text) from public;
revoke all on function gacha_draw(uuid, text, text) from anon;
revoke all on function gacha_draw(uuid, text, text) from authenticated;
grant execute on function gacha_draw(uuid, text, text) to service_role;

revoke all on function shop_buy(uuid, text, text) from public;
revoke all on function shop_buy(uuid, text, text) from anon;
revoke all on function shop_buy(uuid, text, text) from authenticated;
grant execute on function shop_buy(uuid, text, text) to service_role;
-- Phase2 경제 — 일일 완료(출석) 적립 원자화.
--  · 기존 edge fn 은 select→절대값 upsert(read-modify-write) 라 동시 호출 시 적립이 유실될 수 있었다.
--    daily_activity 1/일 가드 + 재화/스탬프 증분(points = points + p_points)을 하나의 plpgsql 호출로 원자화한다.
--  · cosmetic-only 하드 불변식: 이 함수는 user_progress / user_level_skill 을 절대 읽거나 쓰지 않는다.
--  · SECURITY DEFINER + set search_path=public + public/anon/authenticated 실행권 회수 + service_role 만 grant.
create or replace function complete_daily(p_uid uuid, p_points int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'Asia/Seoul')::date;
  v_first boolean;
begin
  -- (1) 1/일 가드: 오늘 최초 삽입이면 found=true → 이때만 증분 적립(멱등).
  insert into daily_activity (user_id, day) values (p_uid, v_day)
    on conflict (user_id, day) do nothing;
  v_first := found;
  if v_first then
    -- (2) 재화 증분 — 절대값이 아니라 원자 증분(points = points + p_points).
    insert into user_currency (user_id, points) values (p_uid, p_points)
      on conflict (user_id) do update
        set points = user_currency.points + p_points, updated_at = now();
    -- (3) 스탬프 증분 — daily 종류 count + 1.
    insert into user_stamps (user_id, stamp_kind, count) values (p_uid, 'daily', 1)
      on conflict (user_id, stamp_kind) do update
        set count = user_stamps.count + 1, updated_at = now();
  end if;
  return jsonb_build_object('ok', true, 'day', v_day, 'first', v_first);
end
$$;

-- 실행권한: public/anon/authenticated 회수 → service_role(Edge Function) 만 실행.
revoke all on function complete_daily(uuid, int) from public, anon, authenticated;
grant execute on function complete_daily(uuid, int) to service_role;

-- ---------- 레벨업 쿠폰(coupons / user_coupons) — service role 전용 ----------
-- 발급: ARENA 레벨 최초 도달 1장(레벨 2..7, 최대 6장). 강등 후 재승급은 유니크 충돌로 무발급.
-- 사용(redemption)은 결제 DEMO 하드블록 — 모델만; 발급/차감 실장은 결제 실장 시.
create table if not exists coupons (
  code text primary key,
  discount int not null,
  issue_condition text,
  active boolean not null default true
);
alter table coupons enable row level security;

create table if not exists user_coupons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  issued_for_level int not null,
  coupon_code text references coupons(code),
  issued_at timestamptz default now(),
  used_at timestamptz,
  payment_id text,
  unique(user_id, issued_for_level)
);
alter table user_coupons enable row level security;

insert into coupons(code,discount,issue_condition) values ('LEVELUP10',10,'level_first_reach') on conflict (code) do nothing;

-- ============================================================
-- 칭호(자격증 트랙·급수) — exam_attempts 합격에서 ON READ 파생 (G006b).
--   · certificates 테이블 없음: 응시 기록(exam_attempts)에서 읽을 때마다 계산.
--   · 합격 = status='submitted' AND total_questions>0 AND 정답률>=0.60.
--   · 급수: 정답률 >=0.90 '1급' / >=0.80 '2급' / >=0.70 '3급' / else '4급'.
--   · 트랙: exams.tier 에 'master' 포함 → 'Master', 아니면 'Pro'.
--   · 트랙별 최고 급수 1개만(distinct on) → jsonb 배열 [{track, grade, exam_title}].
--   · 구매/뽑기 불가 — exam_attempts 합격에서만 파생(진짜 취득자만). 쓰기 경로 없음(read-only).
--   · SECURITY DEFINER + set search_path=public. service-role(엣지fn)만 실행:
--     PUBLIC/anon/authenticated 는 revoke → service_role 에만 grant.
--   멱등(재실행 안전). schema.sql 의 동명 블록과 DDL 동일.
-- ============================================================
create or replace function public.user_titles(p_uid uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'track',      track,
      'grade',      grade,
      'exam_title', exam_title
    ) order by track), '[]'::jsonb)
  from (
    select distinct on (track) track, grade, exam_title
    from (
      select
        case when e.tier ilike '%master%' then 'Master' else 'Pro' end as track,
        case when q.ratio >= 0.90 then '1급'
             when q.ratio >= 0.80 then '2급'
             when q.ratio >= 0.70 then '3급'
             else '4급' end                                            as grade,
        e.title                                                        as exam_title,
        q.ratio                                                        as ratio
      from (
        select ea.exam_id,
               ea.total_correct::numeric / ea.total_questions as ratio
        from exam_attempts ea
        where ea.user_id = p_uid
          and ea.status = 'submitted'
          and ea.total_questions > 0
          and ea.total_correct::numeric / ea.total_questions >= 0.60
      ) q
      join exams e on e.id = q.exam_id
    ) graded
    order by track, ratio desc
  ) best;
$$;
comment on function public.user_titles(uuid) is '구매/뽑기 불가 — exam_attempts 합격에서만 파생';
revoke execute on function public.user_titles(uuid) from public, anon, authenticated;
grant  execute on function public.user_titles(uuid) to service_role;

-- 편의 함수: 칭호 보유 여부(배지 노출용). user_titles 파생.
create or replace function public.has_title(p_uid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select jsonb_array_length(public.user_titles(p_uid)) > 0;
$$;
revoke execute on function public.has_title(uuid) from public, anon, authenticated;
grant  execute on function public.has_title(uuid) to service_role;

-- ============================================================
-- Phase 4 Lecture AI — 강의별 RAG(해당 강의 자료 한정) + 엔타이틀먼트 + per-lecture 서버 쿼터.
--   델타 마이그레이션: migrations/20260714000900_lecture_ai.sql
-- ============================================================
-- Phase 4 Lecture AI — 강의별 RAG(해당 강의 자료 한정) + 엔타이틀먼트 + per-lecture 서버 쿼터.
--  · match_lecture_chunks: p_lecture_id 필수 필터를 RPC 안에 내장 → 우발적 교차강의 누출 차단.
--  · 필터는 authz 경계가 아님 → lecture-qa 는 엔타이틀먼트 선검사 AND 쿼터 소비를 검색 前에 수행.
--  · embedding vector(768) — reco_cache/gemini-embedding-001 과 동일 차원. hnsw cosine.
--  · RLS: 클라 정책 없음(= service role/Edge Function 전용). 쿼터는 과금 방식과 무관하게 구축.

create extension if not exists vector;

create table if not exists lecture_chunks (
  id uuid primary key default gen_random_uuid(),
  lecture_id text not null,
  chunk_text text not null,
  embedding vector(768),
  created_at timestamptz default now()
);
create index if not exists lecture_chunks_lecture_idx on lecture_chunks(lecture_id);
create index if not exists lecture_chunks_embedding_idx on lecture_chunks using hnsw (embedding vector_cosine_ops);

create table if not exists lecture_entitlements (
  user_id uuid references auth.users(id) on delete cascade,
  lecture_id text not null,
  granted_at timestamptz default now(),
  source text,
  primary key(user_id, lecture_id)
);
alter table lecture_entitlements enable row level security;

create table if not exists lecture_quota (
  user_id uuid references auth.users(id) on delete cascade,
  lecture_id text not null,
  day date not null,
  count int not null default 0,
  primary key(user_id, lecture_id, day)
);
alter table lecture_quota enable row level security;

-- match_lecture_chunks — 강의 스코프(p_lecture_id) 를 RPC 안에 강제 내장. where 절 생략 불가 → 교차강의 누출 차단.
create or replace function match_lecture_chunks(p_lecture_id text, query_embedding vector(768), match_count int default 5)
returns table(id uuid, chunk_text text, similarity real)
language sql stable security definer set search_path = public as $$
  select id, chunk_text, (1 - (embedding <=> query_embedding))::real
  from lecture_chunks
  where lecture_id = p_lecture_id
  order by embedding <=> query_embedding
  limit match_count;
$$;
revoke execute on function public.match_lecture_chunks(text, vector, int) from public, anon, authenticated;
grant  execute on function public.match_lecture_chunks(text, vector, int) to service_role;

-- is_entitled — 유저×강의 엔타이틀먼트(수강/구매) 존재 여부. lecture-qa 가 검색·쿼터 前 선검사.
create or replace function is_entitled(p_uid uuid, p_lecture text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from lecture_entitlements
    where user_id = p_uid and lecture_id = p_lecture
  );
$$;
revoke execute on function public.is_entitled(uuid, text) from public, anon, authenticated;
grant  execute on function public.is_entitled(uuid, text) to service_role;

-- consume_quota — per (user,lecture,KST-day) 카운터 원자 증분. 한도 미만이면 +1 하고 true, 한도 도달이면 증분 없이 false.
create or replace function consume_quota(p_uid uuid, p_lecture text, p_limit int)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_ok boolean;
begin
  insert into lecture_quota (user_id, lecture_id, day, count)
  values (p_uid, p_lecture, (now() at time zone 'Asia/Seoul')::date, 1)
  on conflict (user_id, lecture_id, day) do update
    set count = lecture_quota.count + 1
    where lecture_quota.count < p_limit
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;
revoke execute on function public.consume_quota(uuid, text, int) from public, anon, authenticated;
grant  execute on function public.consume_quota(uuid, text, int) to service_role;
