-- 2026-09-04 · 규격의 절반만 적립된 활동점수 백필 (2026-09-04 지시)
--
--   1cea477 이 complete-daily 의 적립값을 규격표대로 고쳤다(출석 5→10 · DAILY QUIZ 2→3).
--   그 전 두 달간(8/4~9/4) 쌓인 행은 절반 값 그대로라 여기서 올린다.
--
--   대상 (실측):
--     attendance   delta 5 → 10   104건   +520
--     daily_learn  delta 2 →  3    51건    +51
--                                   합계   +571  (영향 인원 21명 = 전 회원)
--
--   ⛔ **더 준 것은 안 건드린다** — daily_learn delta 30 짜리 8건(7/27~8/4)이 규격(3)보다 높지만
--      내리면 받은 점수를 빼앗는 게 된다. 이 저장소 관례가 그렇다(친구 초대 점수 폐지 때도
--      "이미 적립된 옛 행은 그대로 둔다 — 받은 점수를 빼앗지 않는다" 로 처리했다).
--      같은 이유로 미니게임의 규격 밖 delta 7건(1·3·7·8·20 — 성적 연동이던 더 옛 설계의 흔적)도 둔다.
--
--   ⭐ **user_progress.activity_score 를 직접 건드리지 않는다.** activity_ledger 의 UPDATE 트리거
--      (activity_ledger_apply)가 `new.delta - old.delta` 차액을 그 자리에서 반영한다. 원장과 합계를
--      따로 고치면 둘이 어긋날 수 있고, 그 어긋남은 화면에 안 드러난다.
--      ⚠️ season_total 은 생성열(skill+activity)이라 자동으로 따라오고, arena_level 은 그 트리거가 다시 계산한다.
--      ⚠️ 그래서 이 파일은 **UPDATE 한 문장**이 전부다. 트리거를 우회하는 방식으로 바꾸지 말 것.
--
--   ⚠️ 아레나 레벨이 오르는 사람이 생길 수 있다. 그건 정상이다 — 레벨업 축하는 워터마크
--      (user_characters.arena_level_seen)가 낮으면 다음 진입에 한 번 뜬다. 원래 받았어야 할 점수다.

begin;

update activity_ledger set delta = 10 where kind = 'attendance'  and delta = 5;
update activity_ledger set delta = 3  where kind = 'daily_learn' and delta = 2;

-- 검산 — 규격보다 낮은 행이 하나라도 남으면 통째로 롤백한다.
do $$
declare n int;
begin
  select count(*) into n from activity_ledger
   where (kind = 'attendance' and delta < 10) or (kind = 'daily_learn' and delta < 3);
  if n > 0 then
    raise exception '규격 미달 행이 남았다: %건', n;
  end if;
end $$;

commit;
