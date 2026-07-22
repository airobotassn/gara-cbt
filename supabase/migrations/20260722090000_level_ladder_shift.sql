-- 2026-07-22 · 레벨 사다리 한 칸 밀기
--   옛 Lv.7 폐기(문항 40개·KB 청크 286개) → 옛 1~6 이 2~7 로 이동 → Lv.1 신설(임시 축, 문항 0).
--   축 코드도 같이 밀린다: 옛 l1_principle = 지금 l2_principle. 옛 l7_* 는 폐기.
--   프론트/함수 짝: src/lib/categories.ts · supabase/functions/_shared/scoring.ts (LEVEL_AXES).
--
--   ⚠️ 되돌리려면 _bak_20260722_* 스냅샷에서 복원할 것(이 파일은 되돌리기를 포함하지 않는다).
--   레벨 컬럼은 반드시 내림차순(6→7, 5→6 …)으로 갱신한다:
--     · test_questions_level_check(level<=7) 위반 방지(그래서 L7 삭제가 먼저다)
--     · user_level_skill PK(user_id, level) 중복 방지

begin;

-- ── 0) 스냅샷 백업 ────────────────────────────────────────────────
create table if not exists _bak_20260722_test_questions   as select * from test_questions;
create table if not exists _bak_20260722_test_answers     as select * from test_answers;
create table if not exists _bak_20260722_test_attempts    as select * from test_attempts;
create table if not exists _bak_20260722_user_level_skill as select * from user_level_skill;
create table if not exists _bak_20260722_user_progress    as select * from user_progress;
create table if not exists _bak_20260722_question_events  as select * from question_events;
create table if not exists _bak_20260722_kb_chunks        as select * from kb_chunks;

-- ── 1) 옛 Lv.7 제거 (응시 답안이 참조 중이면 중단) ────────────────
do $$
begin
  if exists (
    select 1 from test_answers a join test_questions q on q.id = a.question_id where q.level = 7
  ) then
    raise exception 'L7 문항을 참조하는 응시 답안이 있습니다 — 수동 확인 필요';
  end if;
end $$;

delete from test_questions where level = 7;
delete from kb_chunks      where level = 7;

-- ── 2) 레벨 한 칸 밀기 (내림차순) ─────────────────────────────────
do $$
declare lv int;
begin
  for lv in reverse 6..1 loop
    update test_questions   set level = lv + 1 where level = lv;
    update test_attempts    set level = lv + 1 where level = lv;
    update user_level_skill set level = lv + 1 where level = lv;
    update question_events  set level = lv + 1 where level = lv;
    update kb_chunks        set level = lv + 1 where level = lv;
  end loop;
end $$;

-- ── 3) 문항 번호 재부여: L{새 레벨}-{기존 일련번호} ────────────────
update test_questions
   set code = 'L' || level || '-' || substring(code from '-(\d+)$')
 where code ~ '^L\d+-\d+$';

-- ── 4) 축 코드 한 칸 밀기 (내림차순: l6_→l7_ … l1_→l2_) ───────────
do $$
declare lv int;
begin
  for lv in reverse 6..1 loop
    update test_questions
       set category = 'l' || (lv + 1) || substring(category from 3)
     where category like 'l' || lv || '\_%';
    update test_answers
       set category = 'l' || (lv + 1) || substring(category from 3)
     where category like 'l' || lv || '\_%';
  end loop;
end $$;

-- ── 5) JSONB 키(축 코드) 한 칸 밀기 ───────────────────────────────
create or replace function _shift_axis_keys(j jsonb) returns jsonb language sql immutable as $$
  select case
    when j is null then null
    else coalesce((
      select jsonb_object_agg(
        case when key ~ '^l[1-6]_'
             then 'l' || ((substring(key from 2 for 1))::int + 1) || substring(key from 3)
             else key end,
        value)
      from jsonb_each(j)), '{}'::jsonb)
  end
$$;

update test_attempts
   set axis_perf   = _shift_axis_keys(axis_perf),
       deltas      = _shift_axis_keys(deltas),
       rating_after= _shift_axis_keys(rating_after);
update user_level_skill set ratings = _shift_axis_keys(ratings);

drop function _shift_axis_keys(jsonb);

-- ── 6) 유저 등급 +1 (상한 7) + 점수 재계산 ────────────────────────
--   points/skill_score = ((rank-1 + frac)/7)*10000 이고 frac(그 레벨 정답비율)은 안 바뀌므로
--   레벨 한 칸 = 10000/7 만큼 가산. season_total 은 generated 라 자동 반영.
update user_progress
   set rank        = least(7, rank + 1),
       points      = case when rank >= 7 then points
                          else least(10000, round(points + 10000.0 / 7)) end,
       skill_score = case when rank >= 7 then skill_score
                          else least(10000, round(skill_score + 10000.0 / 7)) end;

commit;
