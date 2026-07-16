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
