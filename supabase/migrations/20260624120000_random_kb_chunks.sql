-- kb-generate 가 셀(레벨×축)의 청크를 "전체 풀에서 무작위로" 뽑게 하는 RPC.
-- 주의: .limit() 만 쓰면 처음 적재된 N개만 잡혀 나중에 넣은 자료(응용 출처 등)가 영영 안 뽑힘.
--       → ORDER BY random() 으로 셀 전체에서 무작위 추출(변별·다양성 + 신규 자료 도달).
create or replace function random_kb_chunks(p_level int, p_axes text[], p_limit int)
returns setof kb_chunks language sql stable as $$
  select * from kb_chunks
  where level = p_level and (p_axes is null or axis = any(p_axes))
  order by random()
  limit greatest(p_limit, 1);
$$;
