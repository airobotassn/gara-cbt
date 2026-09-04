-- 2026-09-04 · 2026-08-27 사다리 밀기를 **사용자 쪽 표에도** 적용 (2026-09-04 지시)
--
--   배경: 밀기는 두 번 있었다.
--     · 20260722090000 (옛 1~6 → 2~7) — 문항과 **사용자 표를 같이** 밀었다.
--     · 20260827120000 (옛 2~5 → 3~6) — 문항만 밀고 **사용자 표는 일부러 안 밀었다**
--       ("전부 테스트 계정이라 나중에 밀면 된다"). 그 '나중'이 지금이다.
--
--   그래서 지금 응시 기록의 레벨·축이 새 편성과 어긋나 /test/record 레이더가 비어 있다.
--   실측(밀기 전): 답안 8,320건 중 4,020건 · 응시 426건 중 193건 · 레이팅 25행 중 8행이 어긋남.
--
--   ⭐ **날짜로 가르지 않는다 — 데이터가 스스로 말하게 한다.** 8/27 이후 새 기록이 이미 새 번호로
--      쌓이고 있어서(응시 56건·레이팅 11행), 날짜나 레벨 범위로 밀면 **멀쩡한 새 기록까지 또 민다.**
--      대신 판별을 이렇게 한다:
--        · test_answers  — 답안의 축 ≠ 그 문항의 지금 축      (문항이 정답이다)
--        · test_attempts — 응시의 레벨 ≠ 그 응시 문항의 지금 레벨
--        · user_level_skill — ratings 의 축이 그 레벨의 지금 축과 **한 개도 안 맞음**
--      실측으로 섞인 행이 0건임을 확인했다(옛 l2_principle… 묶음과 새 l2_biz_prompt… 묶음이
--      한 행에 같이 들어간 경우가 없다). 그래서 이 판별이 100% 갈린다.
--
--   ⛔ user_progress.rank(등급)는 **이 파일에서 안 건드린다.** 8월 밀기가 새 Lv.2 를 만들어 넣어서
--      "옛 Lv.2 를 깬 사람"의 새 등급이 3인지 4인지가 데이터로 정해지지 않는다(그 사람은 새 Lv.2 를
--      친 적이 없다). 시즌 점수(레벨 클리어 1,000점)까지 흔들리는 값이라 지시를 받고 따로 민다.
--
--   ⚠️ 되돌리려면 backup/20260904 의 test_answers.json · test_attempts.json · user_level_skill.json.

begin;

-- 축 코드 접두사 한 칸 밀기(jsonb 키). 20260722090000 이 쓰던 것과 같은 방식이다.
create or replace function _shift_axis_keys_1(j jsonb, from_lv int) returns jsonb language sql immutable as $$
  select case when j is null then null else coalesce((
    select jsonb_object_agg(
      case when key like 'l' || from_lv || '\_%'
           then 'l' || (from_lv + 1) || substring(key from 3)
           else key end, value)
    from jsonb_each(j)), '{}'::jsonb) end
$$;

-- ── 1) 답안: 축을 그 문항의 지금 축으로 맞춘다 ─────────────────────
--   문항이 옮겨간 것뿐이고 답안이 가리키는 문항(question_id)은 그대로다. 그러니 그 문항의
--   지금 축이 곧 정답이다 — 시기를 추측할 필요가 없다.
update test_answers a
   set category = q.category
  from test_questions q
 where q.id = a.question_id and a.category <> q.category;

-- ── 2) 응시: 레벨 + 6축 jsonb 세 벌을 같이 민다 ────────────────────
--   ⚠️ 레벨을 먼저 바꾸면 어느 접두사를 밀어야 하는지 알 수 없게 된다 — 한 문장에서 같이 한다.
--   ⚠️ 내림차순(5→6, 4→5 …)이라 같은 행을 두 번 밀지 않는다.
do $$
declare lv int; n int; total int := 0;
begin
  for lv in reverse 5..2 loop
    update test_attempts at
       set level        = lv + 1,
           axis_perf    = _shift_axis_keys_1(at.axis_perf,    lv),
           deltas       = _shift_axis_keys_1(at.deltas,       lv),
           rating_after = _shift_axis_keys_1(at.rating_after, lv)
     where at.level = lv
       and exists (  -- 이 응시가 낸 문항이 지금 다른 레벨에 있다 = 아직 안 민 옛 기록
             select 1 from test_answers a join test_questions q on q.id = a.question_id
              where a.attempt_id = at.id and q.level <> lv);
    get diagnostics n = row_count; total := total + n;
  end loop;
  if total <> 193 then
    raise exception '응시 밀기 대상이 예상과 다르다: % (예상 193)', total;
  end if;
end $$;

-- ── 3) 레이팅: 옛 Lv.6 행을 먼저 지우고, 내림차순으로 민다 ─────────
--   ⛔ PK 가 (user_id, level) 라 **옛 Lv.6 행이 있는 한 5→6 을 못 민다.** 옛 Lv.6 은 문항이
--      63건 전부 삭제돼 가리킬 내용이 없는 레벨이라(그 자리를 옛 Lv.5 가 이어받았다) 행을 지운다.
--   ⚠️ 판별을 "한 개도 안 맞음" 으로 하면 **옛 Lv.6 행이 안 걸린다** — 옛 축 6개 중 l6_ros2 하나가
--      새 Lv.6 의 l6_ros2(옛 l5_ros2)와 **코드가 겹치기 때문**이다(1/6 일치). 실제로 그렇게 짰다가
--      5→6 에서 PK 충돌로 롤백됐다. 그래서 **과반이 안 맞으면 옛 행**으로 본다.
create or replace function _stale_skill(s_level int, s_ratings jsonb) returns boolean language sql stable as $$
  select (select count(*) from jsonb_object_keys(s_ratings) k
           where exists (select 1 from test_questions q
                          where q.deleted_at is null and q.level = s_level and q.category = k)) * 2
         < (select count(*) from jsonb_object_keys(s_ratings))
$$;

delete from user_level_skill s
 where s.level = 6 and _stale_skill(s.level, s.ratings);

do $$
declare lv int;
begin
  for lv in reverse 5..2 loop
    -- ⛔ 옮겨갈 자리에 **이미 새 기록이 있으면** 옛 행을 버린다. 8/27 뒤에 그 레벨을 다시 친 사람이라,
    --    같은 내용에 대한 최신 레이팅이 이미 그 자리에 있다(옛 것이 이기면 최신 응시가 사라진다).
    --    ⚠️ 두 행을 합칠 수는 없다 — ratings 는 EWMA 누적이라 되돌려서 다시 섞을 방법이 없다.
    --    ⚠️ 내림차순이라 lv+1 은 이미 처리가 끝났다 = 거기 남아 있는 행은 확실히 '지금 값'이다.
    delete from user_level_skill s
     where s.level = lv and _stale_skill(s.level, s.ratings)
       and exists (select 1 from user_level_skill t where t.user_id = s.user_id and t.level = lv + 1);

    update user_level_skill s
       set level   = lv + 1,
           ratings = _shift_axis_keys_1(s.ratings, lv)
     where s.level = lv and _stale_skill(s.level, s.ratings);
  end loop;
end $$;

drop function _stale_skill(int, jsonb);

drop function _shift_axis_keys_1(jsonb, int);

-- ── 4) 검산 — 어긋난 게 하나라도 남으면 통째로 롤백 ────────────────
do $$
declare bad_ans int; bad_att int;
begin
  select count(*) into bad_ans from test_answers a join test_questions q on q.id = a.question_id
   where a.category <> q.category;
  select count(distinct at.id) into bad_att from test_attempts at
    join test_answers a on a.attempt_id = at.id join test_questions q on q.id = a.question_id
   where at.level <> q.level;
  if bad_ans > 0 or bad_att > 0 then
    raise exception '밀기 후에도 어긋남이 남았다: 답안 % · 응시 %', bad_ans, bad_att;
  end if;
end $$;

commit;
