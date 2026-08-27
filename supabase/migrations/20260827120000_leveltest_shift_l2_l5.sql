-- 2026-08-27 · 레벨 사다리 두 번째 밀기 — 옛 Lv.2~5 → Lv.3~6
--   Lv.1 은 제자리, Lv.7 도 제자리(축 용어만 코드에서 다듬었다). 옛 Lv.6 은 살아있는 문항이 0개라
--   (63건 전부 삭제 상태) 그 자리를 옛 Lv.5 가 이어받는다. 결과로 **Lv.2 가 빈 레벨**이 된다.
--
--   축 코드도 같이 밀린다: 옛 l2_principle = 지금 l3_principle · 옛 l5_ros2 = 지금 l6_ros2.
--   프론트/함수 짝: src/lib/categories.ts · supabase/functions/_shared/scoring.ts (LEVEL_AXES).
--   시험 규격 경계도 코드에서 같이 밀었다(4지선다 Lv.1~4 · 문항수 Lv.2~4=20 · 승급컷 70% Lv.1~4) —
--   옛 L3 문항은 보기가 4개뿐이라 경계를 안 밀면 새 L4 시험에 보기가 하나 빈 채로 나간다.
--
--   ⛔ **사용자 쪽 표는 한 줄도 건드리지 않는다**(2026-08-27 지시 — 전부 테스트 계정이라 나중에 밀면 된다):
--      test_attempts · test_answers · user_level_skill · user_progress.
--      대가: 옛 응시 기록의 level·축 코드가 새 편성과 어긋나 /test/record 레이더가 빈다.
--      user_level_skill 은 PK(user_id, level) 라 어차피 옛 Lv.6 행이 있는 한 5→6 을 밀 수 없다.
--
--   ⛔ **옛 Lv.6 흔적도 그대로 둔다**: 삭제문항 63건(코드 L6-001~063, 축 l6_reasoning 등)과
--      KB 274개. 새 Lv.6 과 한 레벨에 공존한다 → 새로 올라오는 문항 번호는 L6-064 부터 매긴다.
--      옛 l6_ros2 는 새 l6_ros2(옛 l5_ros2)와 코드가 겹쳐 화면에 새 라벨로 뜬다.
--
--   ⚠️ 되돌리려면 _bak_20260827_* 스냅샷에서 복원할 것(이 파일은 되돌리기를 포함하지 않는다).
--   ⚠️ 레벨은 반드시 **내림차순**(5→6, 4→5 …)으로 갱신한다 — 오름차순이면 같은 행을 여러 번 민다.

begin;

-- ── 0) 스냅샷 백업 ────────────────────────────────────────────────
create table if not exists _bak_20260827_test_questions  as select * from test_questions;
create table if not exists _bak_20260827_question_events as select * from question_events;
create table if not exists _bak_20260827_kb_chunks       as select * from kb_chunks;

-- ── 1) 레벨 + 축 코드 한 칸 밀기 (내림차순) ───────────────────────
--   축 코드는 '지금 접두사 +1' 이 아니라 **목표 레벨로 다시 붙인다**(`'l' || (lv+1)`).
--   그래야 kb_chunks 처럼 접두사가 이미 어긋나 있던 데이터도 같이 바로잡힌다 —
--   2026-07 밀기가 kb_chunks.level 만 밀고 axis 를 안 밀어서 지금 전 레벨이 한 칸씩 밀려 있다
--   (level 2 의 축이 l1_*). 이번에 움직이는 2~5 는 여기서 정상화되고, 안 움직이는 6·7 은 그대로다.
do $$
declare lv int;
begin
  for lv in reverse 5..2 loop
    update test_questions
       set level    = lv + 1,
           category = 'l' || (lv + 1) || substring(category from 3)
     where level = lv;

    update question_events set level = lv + 1 where level = lv;

    update kb_chunks
       set level = lv + 1,
           axis  = case when axis ~ '^l\d+_' then 'l' || (lv + 1) || substring(axis from 3) else axis end
     where level = lv;
  end loop;
end $$;

-- ── 2) 문항 번호 재부여: L{새 레벨}-{기존 일련번호} ────────────────
--   Lv.3~5 는 옮겨온 문항만 있어 일련번호를 그대로 쓴다.
update test_questions
   set code = 'L' || level || '-' || substring(code from '-(\d+)$')
 where level between 3 and 5
   and code ~ '^L\d+-\d+$';

--   Lv.6 만 예외 — 옛 Lv.6 의 삭제문항(L6-001~063)이 그대로 남아 있어 번호가 겹친다.
--   옮겨온 문항(코드가 아직 L5-*)은 그 뒤 번호부터 이어 붙인다.
do $$
declare off_seq int;
begin
  select coalesce(max((substring(code from '-(\d+)$'))::int), 0)
    into off_seq
    from test_questions
   where level = 6 and code ~ '^L6-\d+$';

  update test_questions
     set code = 'L6-' || lpad(((substring(code from '-(\d+)$'))::int + off_seq)::text, 3, '0')
   where level = 6 and code ~ '^L5-\d+$';
end $$;

-- ── 2-b) Lv.7 KB 의 축 코드 바로잡기 (2026-07 밀기 누락분) ─────────
--   Lv.7 은 이번에 안 움직이지만 KB 축이 `l6_*` 로 한 칸 뒤에 남아 있었다(위 1) 주석 참고).
--   6개가 l7_* 로 1:1 로 떨어진다(dtwin·hrc·orchestration·process_opt·robosec·swarm).
--   ⚠️ Lv.6 에 남은 옛 274개(l5_*)는 폐기된 옛 L6 축의 것이라 그대로 둔다 — 새 L6 축(l6_*)과
--      이름이 안 겹쳐 조회에 안 걸리고, 되살릴 축도 아니다.
update kb_chunks set axis = 'l7' || substring(axis from 3)
 where level = 7 and axis ~ '^l6_';

-- ── 3) 문항 이력의 code 를 실제 문항 번호와 맞춘다 ─────────────────
--   2026-07 밀기는 question_events.level 만 밀고 code 를 안 고쳐서, 지금 이력 목록의 번호가
--   실제 문항 번호와 다르다(level 2 이력 66건이 L1-* 로 남아 있다). 관리자가 번호로 검색하는
--   화면이라 어긋나면 못 찾는다 → 문항이 살아있는 행은 전부 지금 번호로 맞춘다.
update question_events e
   set code = q.code
  from test_questions q
 where q.id = e.question_id
   and e.code is distinct from q.code;

-- ── 4) 검증 — 어긋나면 롤백 ───────────────────────────────────────
do $$
declare bad int;
begin
  select count(*) into bad from test_questions where category !~ ('^l' || level || '_');
  if bad > 0 then raise exception '축 코드와 레벨이 어긋난 문항 %건', bad; end if;

  select count(*) into bad from test_questions where level = 2;
  if bad > 0 then raise exception 'Lv.2 는 비어 있어야 하는데 %건 남았다', bad; end if;

  select count(*) into bad from test_questions where code !~ ('^L' || level || '-\d+$');
  if bad > 0 then raise exception '문항 번호 접두사가 레벨과 어긋난 문항 %건', bad; end if;

  select count(*) into bad
    from (select level, code from test_questions group by level, code having count(*) > 1) d;
  if bad > 0 then raise exception '같은 레벨에 중복된 문항 번호 %건', bad; end if;

  -- KB: 이번에 손댄 레벨(3~5, 7)은 축 접두사가 레벨과 맞아야 한다.
  --   Lv.6 은 새 것(l6_*)과 폐기된 옛 것(l5_*)이 섞여 있어 검사에서 뺀다.
  select count(*) into bad from kb_chunks
   where level in (3, 4, 5, 7) and axis is not null and axis !~ ('^l' || level || '_');
  if bad > 0 then raise exception 'KB 축 코드와 레벨이 어긋난 청크 %건', bad; end if;
end $$;

commit;
