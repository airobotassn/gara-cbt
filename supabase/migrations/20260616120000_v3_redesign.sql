-- ============================================================
-- 마이그레이션 v2 → v3 (다국어 + 레벨별 6축 + 레벨별 누적 + 등급 사다리)
-- ⚠️ pre-launch 전용: 기존 문항/응시 데이터는 샘플이라 폐기한다.
--    실유저 데이터가 쌓인 뒤엔 이 파일 대신 ALTER 기반 무손실 마이그레이션을 써야 함.
--
-- 실행 순서:
--   1) 이 파일(migrate_v3.sql)  ← 변경/제거된 테이블 정리
--   2) schema.sql               ← v3 테이블 생성
--   3) seed.sql                 ← 샘플 문항(원하면)
-- profiles 는 유지(auth 연동). attempt_status enum 도 유지(schema.sql 이 if not exists 재사용).
-- ============================================================

-- 제거된 테이블(MMR 누적/티어평균)
drop table if exists tier_avg_profile cascade;
drop table if exists user_skill cascade;

-- 구조가 바뀐 테이블(category enum→text, 문항 다국어 jsonb, attempt 등급 컬럼 등)
drop table if exists attempt_answers cascade;
drop table if exists test_attempts cascade;
drop table if exists questions cascade;

-- 더 이상 쓰지 않는 enum(카테고리는 레벨별 텍스트 코드로 대체)
drop type if exists category cascade;

-- 이후 schema.sql 을 실행하면
--   questions / test_attempts / attempt_answers / user_level_skill / user_progress
-- 가 새로 생성된다.
-- ============================================================
-- AI 레벨테스트 — DB 스키마 + RLS  (v3: 다국어 + 레벨별 6축 + 레벨별 누적 + 등급 사다리)
-- Supabase SQL Editor에 그대로 붙여넣어 실행.
-- 핵심 원칙: questions / test_attempts / attempt_answers / user_level_skill / user_progress 는
--           클라이언트 직접 SELECT 금지(= service role 전용).
--           모든 결과 read 는 Edge Function 으로만 서빙한다.
-- ⚠️ v2 → v3 변경: category enum → text(레벨별 코드), 문항 다국어 jsonb,
--    user_skill/tier_avg_profile 제거 → user_level_skill + user_progress.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- enum ----------
do $$ begin
  create type attempt_status as enum ('in_progress','submitted','expired');
exception when duplicate_object then null; end $$;

-- ---------- profiles ----------
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

-- ---------- questions (다국어 문제은행) ----------
-- 문항 1개 = 1행. 정답/레벨/카테고리는 언어 무관 단일 컬럼(드리프트 방지).
-- 언어별 텍스트만 *_i18n jsonb 에 묶음: { ko, en, ja, zh, hi, vi }
create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  level int not null check (level between 1 and 7),
  category text not null,              -- 그 레벨의 6축 코드 (예: l3_rag)
  correct_index int not null,          -- 절대 클라에 노출 안 함. 언어 무관(보기 순서 고정)
  prompt_i18n jsonb not null,          -- { "ko":"...", "en":"...", ... }
  options_i18n jsonb not null,         -- { "ko":["..",".."], "en":[...], ... }
  explanation_i18n jsonb not null default '{}'::jsonb,
  active boolean default true,
  created_at timestamptz default now()
);
create index if not exists questions_level_cat_idx on questions(level, category) where active;

-- ---------- test_attempts ----------
-- 한 번의 시험 = 그 레벨 누적 레이팅을 갱신 + 등급(레벨) 이동 이벤트.
create table if not exists test_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  level int not null check (level between 1 and 7),  -- 응시한 레벨
  lang text not null default 'ko',                   -- 응시 언어(결과 재조회용)
  status attempt_status not null default 'in_progress',
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  total_correct int default 0,
  total_questions int default 0,
  axis_perf jsonb,                    -- 이 시험의 축별 perf(0~100) {코드:..}
  deltas jsonb,                       -- 이 시험으로 인한 축별 변동(+/-)
  rating_after jsonb,                 -- 반영 직후 그 레벨 누적 레이팅 스냅샷
  rank_before int,                    -- 시험 전 등급(레벨)
  rank_after int,                     -- 시험 후 등급(레벨)
  rank_dir text,                      -- 'up' | 'down' | 'stay'
  applied boolean not null default false,  -- 반영 여부(멱등성 가드)
  violation_count int default 0,
  claim_token uuid not null default gen_random_uuid(),
  created_at timestamptz default now()
);
create index if not exists attempts_user_idx on test_attempts(user_id, status, submitted_at);

-- ---------- attempt_answers ----------
create table if not exists attempt_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references test_attempts(id) on delete cascade,
  question_id uuid not null references questions(id),
  category text not null,             -- 그 레벨 6축 코드
  selected_index int,
  is_correct boolean not null default false,
  time_spent int default 0,
  created_at timestamptz default now()
);
create index if not exists answers_attempt_idx on attempt_answers(attempt_id);

-- ---------- user_level_skill (레벨별 누적 6축 레이팅, 영구유저만) ----------
-- 레벨마다 한 줄. ratings = { 축코드: 0~100 }. 레이더의 원천.
create table if not exists user_level_skill (
  user_id uuid not null references auth.users(id) on delete cascade,
  level int not null,
  ratings jsonb not null default '{}'::jsonb,
  attempts_count int not null default 0,
  placed boolean not null default false,   -- 그 레벨 배치 완료 여부
  updated_at timestamptz default now(),
  primary key (user_id, level)
);

-- ---------- user_progress (현재 등급 = 레벨) ----------
create table if not exists user_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rank int not null default 1,             -- 현재 등급(레벨 1~)
  updated_at timestamptz default now()
);

-- ============================================================
-- RLS: 잠금 테이블엔 클라 정책을 두지 않는다(=service role 전용).
-- ============================================================
alter table profiles          enable row level security;
alter table questions         enable row level security;
alter table test_attempts     enable row level security;
alter table attempt_answers   enable row level security;
alter table user_level_skill  enable row level security;
alter table user_progress     enable row level security;

-- profiles: 본인 것만 read/update
drop policy if exists "profiles_select_own" on profiles;
create policy "profiles_select_own" on profiles
  for select using (auth.uid() = id);
drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own" on profiles
  for update using (auth.uid() = id);

-- questions / test_attempts / attempt_answers / user_level_skill / user_progress:
--   클라 정책 없음 → 직접 쿼리 시 0행/거부. Edge Function(service role)만 사용.
-- ============================================================
-- 시드 (교체 필요) — v3 다국어/레벨별 6축 포맷
-- 레벨 1~5 × 6축 × 4문항 = 120 샘플. ko/en 만 채움(나머지 언어는 start-test 가 ko 폴백).
-- 실제 문항은 tools/문항번역기.html → 엑셀 → 임포트 스크립트로 교체.
-- 이미 데이터가 있으면 삽입하지 않음.
-- ============================================================

with axes(level, code) as (
  values
  (1,'l1_principle'),(1,'l1_security'),(1,'l1_ethics'),(1,'l1_responsibility'),(1,'l1_llm_eco'),(1,'l1_prompt'),
  (2,'l2_genai'),(2,'l2_api'),(2,'l2_algo'),(2,'l2_sensor'),(2,'l2_block'),(2,'l2_python'),
  (3,'l3_rag'),(3,'l3_llm_ctrl'),(3,'l3_vision_eval'),(3,'l3_vision_data'),(3,'l3_c_basic'),(3,'l3_c_adv'),
  (4,'l4_preproc'),(4,'l4_stm32'),(4,'l4_ros2'),(4,'l4_plc'),(4,'l4_sim'),(4,'l4_smartfactory'),
  (5,'l5_reasoning'),(5,'l5_edge'),(5,'l5_iiot'),(5,'l5_dtwin'),(5,'l5_sysopt'),(5,'l5_ros2')
)
insert into questions (level, category, correct_index, prompt_i18n, options_i18n, explanation_i18n)
select
  a.level,
  a.code,
  ((a.level + k) % 4),
  jsonb_build_object(
    'ko', format('[샘플·교체필요] L%s · %s 문제 #%s — 다음 중 가장 적절한 것은?', a.level, a.code, k),
    'en', format('[sample] L%s · %s Q#%s — Which is most appropriate?', a.level, a.code, k)
  ),
  jsonb_build_object(
    'ko', jsonb_build_array('보기 A', '보기 B', '보기 C', '보기 D'),
    'en', jsonb_build_array('Option A', 'Option B', 'Option C', 'Option D')
  ),
  jsonb_build_object(
    'ko', format('정답은 보기 %s 입니다. (샘플 해설 — 실제 문항으로 교체 예정)', chr(65 + ((a.level + k) % 4))),
    'en', format('The answer is option %s. (sample)', chr(65 + ((a.level + k) % 4)))
  )
from axes a
cross join generate_series(1, 4) as k
where not exists (select 1 from questions limit 1);
