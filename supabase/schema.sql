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
  is_anonymous boolean default false,
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
  subject text,                        -- 예: '전기자기학 · 정전계'
  topic text,                          -- 예: '전위'
  prompt text not null,
  options jsonb not null,              -- 정확히 4개의 문자열 배열
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
  violation_count int default 0,
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
