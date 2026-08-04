-- 레벨테스트 레벨1~3: 숨겨져 있던 5번째 보기를 DB에서 실제로 제거
--
-- 배경: 레벨1~3은 4지선다로 전환하면서 표시만 잘라왔다(_shared/scoring.ts 의 VISIBLE_OPTIONS_BY_LEVEL).
--       DB 에는 5번째 보기가 그대로 남아 관리자 문항수정·문항분석·번역탭·CSV 에 계속 노출됐다.
--       (2026-08-04 실측: 레벨2 활성 79 + 비활성 48, 레벨3 활성 104 + 비활성 23 = 5지 잔재)
--
-- 방식: 1) 정답이 5번(correct_index=4)인 문항은 먼저 정답을 1~4번 자리로 스왑 — 안 하면 삭제 시 정답이 날아간다
--       2) 레벨1~3 전 문항의 보기 배열을 6개 언어 전부 앞 4개로 자름
--       3) 해설 앞머리 "(N)" 정답 번호를 correct_index+1 로 재동기화
-- ⚠️ active / deleted_at 은 건드리지 않는다. 출제 풀 구성은 그대로.
-- 채점은 correct_index 로만 하므로 과거 응시 기록(is_correct)·점수·등급에는 영향 없음.
-- 재실행해도 대상이 남지 않아 no-op.

begin;

-- ── 0) 안전장치 ──────────────────────────────────────────────
-- 스왑 대상은 모든 언어 보기 배열이 정확히 5개여야 성립한다.
do $$
declare bad int;
begin
  select count(*) into bad
  from test_questions q, lateral jsonb_each(q.options_i18n) as e(k, v)
  where q.level between 1 and 3 and q.correct_index = 4
    and (jsonb_typeof(v) <> 'array' or jsonb_array_length(v) <> 5);
  if bad > 0 then
    raise exception '보기 5개가 아닌 언어 배열 % 건 — 중단', bad;
  end if;
end $$;

-- 되돌리기용 스냅샷(레벨1~3 전체, 삭제분 포함). 이미 있으면 만들지 않는다.
create table if not exists test_questions_backup_20260804 as
select * from test_questions where level between 1 and 3;

-- ── 1) 정답=5번 → 1~4번으로 스왑 ─────────────────────────────
-- 5번 보기 ↔ 목표 슬롯 보기를 6개국어 전부 같은 위치로 교환하고 correct_index 를 목표 슬롯으로 옮긴다.
-- 밀려난 오답은 5번으로 가고, 바로 다음 단계에서 잘려 나간다.
-- 목표 슬롯은 정답 위치가 쏠리지 않게 라운드로빈.
with tgt as (
  select id, (((row_number() over (order by level, code, id)) - 1) % 4)::int as slot
  from test_questions
  where level between 1 and 3 and correct_index = 4
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

-- ── 2) 보기 배열을 앞 4개로 자르기 ───────────────────────────
-- 언어별로 길이가 다를 가능성까지 감안해 "4개 초과인 배열만" 자른다(4개 이하는 그대로).
update test_questions q
set options_i18n = (
      select jsonb_object_agg(
               e.k,
               case
                 when jsonb_typeof(e.v) = 'array' and jsonb_array_length(e.v) > 4 then (
                   select coalesce(jsonb_agg(el.value order by el.ord), '[]'::jsonb)
                   from jsonb_array_elements(e.v) with ordinality as el(value, ord)
                   where el.ord <= 4
                 )
                 else e.v
               end
             )
      from jsonb_each(q.options_i18n) as e(k, v)
    )
where q.level between 1 and 3
  and exists (
    select 1 from jsonb_each(q.options_i18n) as e(k, v)
    where jsonb_typeof(e.v) = 'array' and jsonb_array_length(e.v) > 4
  );

-- ── 3) 해설 "(N)" 정답 번호 재동기화 ─────────────────────────
-- 해설은 "(5) 검색 증강 생성(RAG)이/가 정답입니다." 형태로 앞머리에 정답 번호를 달고 있다.
-- 위 스왑으로 번호가 바뀐 문항 + 이전 레벨3 스왑(20260723110000)이 놓치고 간 문항
-- + 번역본만 어긋난 문항 + 단순 오타를 한꺼번에 정정한다. 전 레벨 대상.
update test_questions q
set explanation_i18n = (
      select jsonb_object_agg(
               e.k,
               to_jsonb(regexp_replace(e.v #>> '{}', '^(\s*)\(\d+\)', '\1(' || (q.correct_index + 1)::text || ')'))
             )
      from jsonb_each(q.explanation_i18n) as e(k, v)
    )
where q.explanation_i18n is not null
  and q.correct_index is not null
  and exists (
    select 1 from jsonb_each(q.explanation_i18n) as e(k, v)
    where jsonb_typeof(e.v) = 'string'
      and substring(e.v #>> '{}' from '^\s*\((\d+)\)') is not null
      and substring(e.v #>> '{}' from '^\s*\((\d+)\)')::int <> q.correct_index + 1
  );

commit;
