-- 2026-09-11 · 지식베이스 중복 검사 RPC 를 실제로 만든다 — 부르는 코드만 있고 함수가 없었다
--
--   `kb-save` 가 자료를 넣을 때 같은 레벨에 비슷한 조각(유사도 0.92 이상)이 있으면 건너뛰려고
--   `match_kb_chunks(query_embedding, p_level, p_axis, match_count)` 를 부른다.
--   그런데 이 함수는 **어느 마이그레이션에도 없다** — 2026-07-01 에 kb_chunks 를 만들 때
--   `random_kb_chunks` 만 만들고 이건 빠뜨렸다. 호출부가 `{ data: near }` 만 꺼내고 error 를 안 봐서
--   함수가 없다는 오류가 그대로 삼켜졌고, 중복 검사가 **처음부터 한 번도 돈 적이 없다**(2026-09-11 발견).
--
--   hnsw 코사인 인덱스(kb_chunks_embedding_idx)는 이미 있어서 이 함수만 있으면 된다.
--   ⚠️ `p_axis` 는 null 이면 축을 안 본다(호출부가 null 로 부른다 — 같은 레벨 전체와 비교).
--   ⚠️ 임베딩이 null 인 행은 비교 대상이 아니다(`embedding is not null`) — 없으면 코사인이 null 이라 정렬이 무너진다.
--   ⚠️ service role 전용 — 부르는 곳이 엣지 함수뿐이다(lecture 쪽 옛 RPC 와 같은 관례).

begin;

create or replace function public.match_kb_chunks(
  query_embedding vector(768),
  p_level int,
  p_axis text default null,
  match_count int default 1
)
returns table (id uuid, text text, similarity real)
language sql stable security definer set search_path = public as $$
  select id, text, (1 - (embedding <=> query_embedding))::real
  from kb_chunks
  where level = p_level
    and embedding is not null
    and (p_axis is null or axis = p_axis)
  order by embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

revoke execute on function public.match_kb_chunks(vector, int, text, int) from public, anon, authenticated;
grant  execute on function public.match_kb_chunks(vector, int, text, int) to service_role;

commit;
