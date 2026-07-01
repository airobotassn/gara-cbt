-- ============================================================
-- 레벨테스트 통합 — 레벨테스트 테이블을 CBT 프로젝트에 추가(네임스페이싱)
-- 원본: ai-level-test/supabase/schema.sql
-- 원칙: 잠금 테이블은 클라 직접 SELECT 금지(= service role 전용, RLS 정책 미부여).
-- ⚠️ 적용은 코드/함수 배포와 함께. 이 파일은 기존 CBT DB에 '추가'만 하는 멱등 마이그레이션.
--
-- [겹침 처리 요약]
--  · questions(레벨테스트) → test_questions  로 리네임 (CBT questions 와 이름 충돌 회피)
--  · attempt_answers(레벨테스트) → test_answers 로 리네임 (CBT attempt_answers 와 충돌 회피)
--  · test_attempts / user_level_skill / user_progress / question_reports / reco_* : 충돌 없어 그대로
--  · profiles.is_anonymous : CBT 정리 때 제거됐던 걸 되살림 (레벨테스트 게스트 응시에 필요).
--    → 시험 응시 자체는 start-exam 함수가 익명 유저를 막으므로 자격검정 보안은 영향 없음.
--  · profiles / admin_users : 공용(둘 다 사용). 신규 생성 안 함.
-- ============================================================

create extension if not exists vector;

-- ---------- attempt_status enum (레벨테스트 test_attempts 용) ----------
do $$ begin
  create type attempt_status as enum ('in_progress','submitted','expired','voided');
exception when duplicate_object then null; end $$;

-- ---------- profiles: is_anonymous 복구 + 가입 트리거 복원 ----------
alter table profiles add column if not exists is_anonymous boolean default false;

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

-- ---------- test_questions (다국어 레벨 문제은행) ----------
create table if not exists test_questions (
  id uuid primary key default gen_random_uuid(),
  code text,                           -- 사람용 문항 번호 (예: L3-045)
  level int not null check (level between 1 and 7),
  category text not null,              -- 그 레벨의 6축 코드 (예: l3_rag)
  correct_index int not null,          -- 클라 비노출. 언어 무관
  prompt_i18n jsonb not null,
  options_i18n jsonb not null,
  explanation_i18n jsonb not null default '{}'::jsonb,
  active boolean default true,
  created_at timestamptz default now()
);
create index if not exists test_questions_level_cat_idx on test_questions(level, category) where active;
create index if not exists test_questions_code_idx on test_questions(code);

-- ---------- test_attempts (레벨테스트 응시 = 누적 레이팅 갱신 + 등급 이동) ----------
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

-- ---------- test_answers (레벨테스트 응답) ----------
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

-- ---------- user_level_skill (레벨별 누적 6축 레이팅, 영구유저만) ----------
create table if not exists user_level_skill (
  user_id uuid not null references auth.users(id) on delete cascade,
  level int not null,
  ratings jsonb not null default '{}'::jsonb,
  attempts_count int not null default 0,
  placed boolean not null default false,
  updated_at timestamptz default now(),
  primary key (user_id, level)
);

-- ---------- user_progress (현재 등급 = 레벨 + 랭킹 점수) ----------
create table if not exists user_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rank int not null default 1,
  demotion_strikes int not null default 0,
  points int not null default 0,
  updated_at timestamptz default now()
);
create index if not exists user_progress_points_idx on user_progress (points desc, updated_at asc);

-- ---------- question_reports (레벨테스트 문항 오류 제보) ----------
create table if not exists question_reports (
  id uuid primary key default gen_random_uuid(),
  question_id uuid references test_questions(id) on delete set null,
  code text,
  attempt_id uuid,
  user_id uuid,
  lang text,
  message text not null,
  status text not null default 'open',   -- open | resolved | dismissed
  created_at timestamptz not null default now()
);

-- ---------- reco_cache / reco_shadow_log (레벨 추천 시맨틱 캐시) ----------
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

-- ============================================================
-- RLS: 신규 잠금 테이블 전부 활성화 + 클라 정책 미부여(= service role 전용).
--   (profiles 는 CBT 스키마에서 이미 RLS+본인정책 부여됨 → 건드리지 않음)
-- ============================================================
alter table test_questions   enable row level security;
alter table test_attempts    enable row level security;
alter table test_answers     enable row level security;
alter table user_level_skill enable row level security;
alter table user_progress    enable row level security;
alter table question_reports enable row level security;
alter table reco_cache       enable row level security;
alter table reco_shadow_log  enable row level security;

-- ============================================================
-- ai-level-test 후속 마이그레이션 반영 (base schema.sql엔 없던 것들)
--   leaderboard_rating · points_ranking · soft_delete · question_soft_delete
-- ============================================================

-- user_level_skill.rating: applyAttempt가 매 응시 기록(없으면 upsert 시 컬럼 에러)
alter table user_level_skill add column if not exists rating numeric(6,2) not null default 0;
create index if not exists user_level_skill_lvl_rating_idx
  on user_level_skill (level, rating desc, attempts_count asc);

-- test_questions.deleted_at: 문항 소프트 삭제(출제 제외 + 과거 결과 보존)
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

-- 보관기간(기본 90일) 지난 탈퇴 계정 완전 삭제(auth.users → cascade). 수동/스케줄 호출.
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
