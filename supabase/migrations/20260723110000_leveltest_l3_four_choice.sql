-- 레벨테스트 레벨3 4지선다 전환 준비: 정답=5번(correct_index=4) 문항 번호 재배치
--
-- 배경: 레벨1~3은 5번째 보기를 숨겨 4지선다로 노출한다(VISIBLE_OPTIONS_BY_LEVEL).
--       정답이 5번이면 정답이 잘리므로, 레벨1·2는 해당 문항을 비활성화해 뒀고
--       레벨3은 문항 수 손실이 커서(활성 104개 중 21개) 비활성 대신 보기를 스왑한다.
--
-- 방식: 5번 보기 ↔ 목표 슬롯 보기를 6개국어 전부 같은 위치로 교환하고
--       correct_index 를 목표 슬롯으로 옮긴다. 밀려난 오답은 5번(숨김)으로 간다.
--       목표 슬롯은 레벨3 활성 문항의 정답 위치 분포가 균등해지도록 배분
--       (기존 1~4번 = 21/23/22/17 → 각 26).
-- 채점은 correct_index 로만 하므로 과거 응시 기록(is_correct)에는 영향 없음.
-- 재실행해도 대상이 남지 않아 no-op.

-- 안전장치: 대상 문항의 모든 언어 보기 배열이 정확히 5개여야 스왑이 성립한다.
do $$
declare bad int;
begin
  select count(*) into bad
  from test_questions q, lateral jsonb_each(q.options_i18n) as e(k, v)
  where q.level = 3 and q.correct_index = 4
    and (jsonb_typeof(v) <> 'array' or jsonb_array_length(v) <> 5);
  if bad > 0 then
    raise exception '보기 5개가 아닌 언어 배열 % 건 — 스왑 중단', bad;
  end if;
end $$;

-- 1) 활성 문항: 정답 위치가 균등해지도록 슬롯 배분
with tgt as (
  select id,
         (case when rn <= 5 then 0
               when rn <= 8 then 1
               when rn <= 12 then 2
               else 3 end)::int as slot
  from (
    select id, row_number() over (order by code, id) as rn
    from test_questions
    where level = 3 and active and correct_index = 4
  ) s
)
update test_questions q
set options_i18n = (
      select jsonb_object_agg(
               e.k,
               jsonb_set(jsonb_set(e.v, array[t.slot::text], e.v -> 4), '{4}', e.v -> t.slot)
             )
      from jsonb_each(q.options_i18n) as e(k, v)
    ),
    correct_index = t.slot
from tgt t
where q.id = t.id;

-- 2) 비활성 문항: 재활성화 대비해 같이 정리(분포 무관, 라운드로빈)
with tgt as (
  select id, (((row_number() over (order by code, id)) - 1) % 4)::int as slot
  from test_questions
  where level = 3 and not active and correct_index = 4
)
update test_questions q
set options_i18n = (
      select jsonb_object_agg(
               e.k,
               jsonb_set(jsonb_set(e.v, array[t.slot::text], e.v -> 4), '{4}', e.v -> t.slot)
             )
      from jsonb_each(q.options_i18n) as e(k, v)
    ),
    correct_index = t.slot
from tgt t
where q.id = t.id;
