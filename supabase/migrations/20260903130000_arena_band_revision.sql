-- ARENA 밴드 개정 + 활동 적립값 상향 (2026-09-03)
--
-- 바꾸는 것 둘.
--   (a) 활동 적립값 — 출석 +5→+10 · DAILY QUIZ +2→+3 · 미니게임 하루 3회→6회.
--       활동 시즌 상한 4,745 → 9,125, 시즌 총점 상한 11,745 → 16,125.
--       ⚠️ 적립값 자체는 DB 가 아니라 scoring.ts 두 벌(프론트/엣지)이 단일 출처다 — 여기서 고치는 건
--          관리자 화면이 보여주는 reward_policy 표뿐이다(아래 (4)). 값을 읽어 채점하는 곳은 없다.
--   (b) ARENA 밴드 — **1,000점 균등 폐지**. 위로 갈수록 넓어지는 개정표로 교체.
--       Lv.1 0~1,000 · Lv.2 1,001~2,200 · Lv.3 2,201~3,700 · Lv.4 3,701~5,500
--       Lv.5 5,501~7,500 · Lv.6 7,501~10,000 · Lv.7 10,001~16,125
--
-- ⚠️ **기존 회원의 표시 레벨이 내려간다 — 의도된 것이다**(2026-09-03 지시: "표 그대로, 내려가도 둔다").
--    6,000점 = 옛 Lv.7 → 새 Lv.5, 1,000점 = 옛 Lv.2 → 새 Lv.1.
--    ARENA 레벨은 캐릭터 그림(lv1~lv7)도 같이 정하므로 캐릭터도 작은 그림으로 되돌아간다.
--
-- ⛔ **함수만 갈면 안 된다.** user_progress.arena_level 은 트리거가 채우는 **저장 컬럼**이라
--    기존 행은 그 행이 다시 UPDATE 될 때까지 옛 레벨을 들고 있는다 → 화면(파생 계산)과 DB 가 갈린다.
--    그래서 (2) 백필이 한 벌이다.

-- ============================================================================
-- (1) 레벨 공식 — scoring.ts 동기화 페어
-- ============================================================================
-- ⛔ **동기화 페어다.** src/lib/scoring.ts · supabase/functions/_shared/scoring.ts 의
--    arenaLevelForScore()·ARENA_BAND_MIN 과 **답이 같아야 한다**.
--    대조는 tests/db/t-arena-level.mjs 가 두 구현을 전 구간에서 맞춰 본다.
-- ⚠️ JS 쪽 순서와 같게: **floor 먼저, 0 클램프 나중**(음수 -100 → floor -100 → 0 → Lv.1).
create or replace function public.arena_level_of(p_total numeric) returns int
  language sql immutable as $fn$
  select case
           when s.t >= 10001 then 7
           when s.t >=  7501 then 6
           when s.t >=  5501 then 5
           when s.t >=  3701 then 4
           when s.t >=  2201 then 3
           when s.t >=  1001 then 2
           else 1
         end
    from (select greatest(0, floor(coalesce(p_total, 0))) as t) s
$fn$;

-- ============================================================================
-- (2) 기존 행 재계산
-- ============================================================================
update user_progress
   set arena_level = arena_level_of(season_total)
 where arena_level is distinct from arena_level_of(season_total);

-- ============================================================================
-- (3) 연출 워터마크 — 내려간 사람만 같이 내린다
-- ============================================================================
-- ⛔ 안 내리면 Lv.7→Lv.5 로 떨어진 사람이 다시 Lv.6·7 을 밟아도 level > seen 이 거짓이라
--    **축하가 영영 안 뜬다**(20260826150000 의 (6) 이 시즌 리셋에서 푸는 것과 같은 문제다).
-- ⛔ 올리지는 않는다(`>` 조건). seen < level 인 사람은 **아직 못 본 축하가 예약된 상태**라
--    여기서 맞춰버리면 그 축하를 삼킨다.
update user_characters uc
   set arena_level_seen = up.arena_level,
       updated_at = now()
  from user_progress up
 where up.user_id = uc.user_id
   and uc.arena_level_seen > up.arena_level;

-- ============================================================================
-- (4) reward_policy — 관리자 '적립 정책' 화면이 보여주는 표
-- ============================================================================
-- ⚠️ 이 표는 **읽어서 채점하는 곳이 없다**(admin/reform.ts 의 조회·저장뿐). 단일 출처는 scoring.ts 다.
--    그래도 안 맞추면 관리자 화면이 "출석 +5 · 미니게임 3회" 라고 거짓말한다.
update public.reward_policy set amount = 10, per_day = 1, updated_at = now()
 where wallet = 'score' and kind = 'attendance';
update public.reward_policy set amount = 3, per_day = 1, updated_at = now()
 where wallet = 'score' and kind = 'daily_learn';
-- 미니게임은 부모 행(`minigame`)과 게임별 행(`minigame:<gameId>`)이 같은 값을 들고 있다.
update public.reward_policy set amount = 2, per_day = 6, updated_at = now()
 where wallet = 'score' and (kind = 'minigame' or kind like 'minigame:%');
