-- ============================================================
-- 지식 저장소 (문제 자동생성 INPUT) — 자료를 청크 단위로 저장.
--   청크 1개 = 1행. level/axis/topic 으로 분류, embedding 으로 검색·중복.
--   RLS: 잠금 테이블 일관 — 클라 정책 없음(= service role 전용, Edge Function만 접근).
-- ============================================================

create extension if not exists vector;

create table if not exists kb_chunks (
  id            uuid primary key default gen_random_uuid(),
  level         int,                    -- 레벨(1~7)
  axis          text,                   -- 그 레벨 축 코드 (예: l1_security). 미배정이면 빈문자/NULL
  topic         text,                   -- 소분류(토픽) 라벨
  text          text not null,          -- 청크 본문(원문 발췌)
  embedding     vector(768),            -- gemini-embedding-001 (768)
  source_url    text,                   -- 출처 URL(있으면)
  source_title  text,                   -- 출처 제목(있으면)
  created_at    timestamptz default now()
);
create index if not exists kb_chunks_embedding_idx on kb_chunks using hnsw (embedding vector_cosine_ops);
create index if not exists kb_chunks_level_axis_idx on kb_chunks(level, axis);

alter table kb_chunks enable row level security;
-- 정책 없음 → service role(Edge Function)만 접근.

-- 근접 검색(노드=level+axis 로 좁힌 뒤 유사도). 생성 시 근거검색·중복검사에 사용 예정.
create or replace function match_kb_chunks(
  query_embedding vector(768), p_level int default null, p_axis text default null, match_count int default 5
)
returns table (id uuid, text text, topic text, axis text, similarity real)
language sql stable as $$
  select id, text, topic, axis, (1 - (embedding <=> query_embedding))::real as similarity
  from kb_chunks
  where (p_level is null or level = p_level)
    and (p_axis  is null or axis  = p_axis)
  order by embedding <=> query_embedding
  limit match_count;
$$;
