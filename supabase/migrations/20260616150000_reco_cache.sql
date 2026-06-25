-- ============================================================
-- 레벨 추천 시맨틱 캐시 (섀도 모드부터)
--   key   = 입력 문장의 임베딩 벡터(뜻 좌표)
--   value = 그때 분류 AI가 매긴 레벨(1~7)
--   뜻이 가까운 과거 입력이 있으면 AI 없이 그 레벨을 재사용한다.
--   RLS: 잠금 테이블 일관 — 클라 정책 없음(= service role 전용, Edge Function만 접근).
-- ============================================================

create extension if not exists vector;

-- ---------- reco_cache (캐시 본체) ----------
create table if not exists reco_cache (
  id         bigserial primary key,
  embedding  vector(768) not null,   -- key: 입력 문장의 의미 좌표
  level      smallint not null,       -- value: 분류 AI가 매긴 레벨(1~7)
  sample     text,                    -- 원문(디버깅/확인용)
  created_at timestamptz default now()
);

-- 근접 검색 인덱스(코사인). hnsw 는 증분 insert 에 강하고 학습 데이터 불필요.
create index if not exists reco_cache_embedding_idx
  on reco_cache using hnsw (embedding vector_cosine_ops);

-- ---------- reco_shadow_log (섀도 측정 로그) ----------
-- "캐시였으면 뭐라 답했을지(level_cache)" vs "AI 실제답(level_llm)" + 그때 점수.
-- 이 로그로 안전한 임계값을 실측해 Live 전환 시점을 정한다. (전환 후엔 버려도 됨)
create table if not exists reco_shadow_log (
  id          bigserial primary key,
  sample      text,
  level_llm   smallint,
  level_cache smallint,
  similarity  real,
  created_at  timestamptz default now()
);

-- ---------- match_reco_cache (최근접 1개 + 유사도) ----------
-- Edge Function 이 호출. embedding <=> query = 코사인 거리, 1-거리 = 유사도(1에 가까울수록 비슷).
create or replace function match_reco_cache(query_embedding vector(768), match_count int default 1)
returns table (level smallint, similarity real)
language sql stable as $$
  select level, (1 - (embedding <=> query_embedding))::real as similarity
  from reco_cache
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- ---------- RLS (정책 없음 = service role 전용) ----------
alter table reco_cache      enable row level security;
alter table reco_shadow_log enable row level security;
