-- route_cache — 홈 검색창 "의미 기반 페이지 라우터" 벡터DB
--   (레벨 추천 reco_cache 를 대체하는 재활용. key=입력 임베딩, value=목적지 페이지)
--   · source='seed' : 손으로 넣은 앵커(신뢰, 영구). 'llm' : MISS 때 LLM이 채운 학습분.
--   · 오염 예방: route-query 는 "LLM 답 == 최근접 dest" 일 때만 write-back → 틀린 섬이 안 생김.
--   · RLS = service role 전용(클라 직접 접근 금지). 출제·채점 테이블과 동일 원칙.
create extension if not exists vector;

create table if not exists route_cache (
  id         bigserial primary key,
  embedding  vector(768) not null,
  dest       text not null,               -- 라우팅 목적지 경로 (예: /test/select)
  sample     text,                         -- 원문(디버깅용)
  source     text not null default 'llm',  -- 'seed' | 'llm'
  created_at timestamptz default now()
);
create index if not exists route_cache_embedding_idx
  on route_cache using hnsw (embedding vector_cosine_ops);
create index if not exists route_cache_source_idx on route_cache(source);

-- 새 쿼리 벡터와 가장 가까운 N개 + 유사도(0~1) + 출처
create or replace function match_route(query_embedding vector(768), match_count int default 1)
returns table (dest text, similarity real, source text)
language sql stable as $$
  select dest, (1 - (embedding <=> query_embedding))::real as similarity, source
  from route_cache
  order by embedding <=> query_embedding
  limit match_count;
$$;

alter table route_cache enable row level security;
-- 클라 정책 미부여 = service role 전용.
