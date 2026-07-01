-- 문항생성(kb-*) 파이프라인용 지식베이스 청크 + 무작위 추출 RPC
-- (옛 프로젝트에서 kb_chunks 2832행 이관 예정 · 함수 kb-generate 가 random_kb_chunks 사용)
create extension if not exists vector;

create table if not exists kb_chunks (
  id uuid primary key default gen_random_uuid(),
  level int,
  axis text,
  topic text,
  text text,
  embedding vector(768),
  source_url text,
  source_title text,
  created_at timestamptz default now()
);
create index if not exists kb_chunks_level_axis_idx on kb_chunks(level, axis);
create index if not exists kb_chunks_embedding_idx on kb_chunks using hnsw (embedding vector_cosine_ops);

-- 클라 직접접근 금지(정책 없음 = service role 전용)
alter table kb_chunks enable row level security;

-- level(+선택 axes)의 청크를 전체 풀에서 무작위로 뽑기 (kb-generate 가 호출)
create or replace function random_kb_chunks(p_level int, p_axes text[], p_limit int)
returns setof kb_chunks language sql stable as $$
  select * from kb_chunks
  where level = p_level and (p_axes is null or axis = any(p_axes))
  order by random()
  limit greatest(p_limit, 1);
$$;
