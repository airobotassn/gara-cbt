-- ============================================================
-- GARA 자격검정 (CBT) — DB 스키마 + RLS
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
  is_anonymous boolean default false,   -- 레벨테스트 게스트 응시용(자격검정은 start-exam이 익명 차단)
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

-- ---------- exams (시험 회차) ----------
create table if not exists exams (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  year int,
  round int,
  total_questions int not null default 100,
  duration_minutes int not null default 120,
  active boolean not null default true,
  created_at timestamptz default now()
);
create index if not exists exams_active_idx on exams(active);

-- ---------- questions (문제은행) ----------
-- 문항 1개 = 1행. correct_index 는 절대 클라에 노출하지 않음(Edge Function 채점 전용).
create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid references exams(id) on delete cascade,
  number int not null,                 -- 1..N 표시 순서
  subject text not null,               -- 예: '전기자기학 · 정전계'
  topic text not null,                 -- 예: '전위'
  prompt text not null,
  choices jsonb not null,              -- 4지선다 보기(문자열 배열)
  correct_index int not null check (correct_index between 0 and 3),  -- 0..3, 클라 비노출
  active boolean not null default true,
  unique (exam_id, number)
);
create index if not exists questions_exam_idx on questions(exam_id) where active;

-- ---------- exam_attempts (응시) ----------
create table if not exists exam_attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid references exams(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'in_progress',  -- in_progress | submitted | voided | expired
  started_at timestamptz default now(),
  submitted_at timestamptz,
  result_release_at timestamptz,         -- 이 시각 이후에만 점수/오답 공개(제출 +7일)
  total_questions int,
  total_correct int,
  created_at timestamptz default now()
);
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
  selected_index int,
  is_correct boolean,
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
alter table exams           enable row level security;
alter table questions       enable row level security;
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
-- 레벨테스트 모듈 (/test/*) — 자격검정과 한 프로젝트 공존.
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

-- test_attempts (레벨테스트 응시)
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

-- test_answers (레벨테스트 응답)
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

-- question_reports (레벨테스트 문항 오류 제보)
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

-- ---------- 레벨테스트 후속 객체 (랭킹/소프트삭제) ----------
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
