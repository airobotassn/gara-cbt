-- 2026-09-07 · 적립 정책을 실제로 쓰게 한다 — 못 지키는 줄은 지운다 (2026-09-07 지시)
--
--   `reward_policy` 는 여태 **표시용 사본**이었다. 관리자 › 적립 정책 화면이 이 표를 읽어 보여주는데
--   실제 적립은 코드 상수가 했다 — 여기서 숫자를 바꿔도 아무 일도 안 일어났고, 값이 두 벌이라
--   조용히 갈릴 수 있었다(실제로 8/4~9/4 두 달간 출석·DAILY QUIZ 가 규격의 절반만 적립됐다).
--
--   이제 적립도 이 표를 읽는다(`_shared/reward-policy.ts` → complete-daily · submit-minigame · get-hub).
--   그래서 **못 지키는 줄은 남겨두면 안 된다** — 화면에 있는데 아무 효과가 없으면 같은 거짓말이 된다.
--
--   ① score/referral (친구 초대 +5) 삭제
--      2026-08-24 에 친구 초대 보상이 **코인 500**(양쪽)으로 옮겨갔다. 시즌 점수는 이제 안 준다.
--      화면에 "+5점" 이라고 떠 있는데 실제로는 코인만 나가고 있었다.
--      ⛔ `activity_ledger` 의 kind CHECK 에 남아 있는 'referral' 과 **이미 적립된 옛 행은 건드리지 않는다**
--         (받은 점수를 빼앗지 않는다 — 이 저장소 관례). 새로 쌓는 곳만 없다.
--
--   ② score/minigame:<gameId> 6줄 삭제 (beat·shoot·pick·reach·build·program)
--      게임별로 적립값을 다르게 줄 수가 없다. 하루 캡을 `activity_ledger` 의
--      unique(user_id, day, source_ref) 를 **게임과 무관한 전역 회차 슬롯**('play:1'…'play:N')으로 걸기
--      때문이다 — 게임마다 횟수를 나누면 그 슬롯 체계가 통째로 깨진다(2026-09-03 설계, submit-minigame 주석).
--      6줄 전부 값이 같았고(2점/6회) 총괄 줄 `score/minigame` 과 중복이라 정보량도 0이었다.
--      ⛔ 게임별로 나눌 거면 이 줄들을 되살리지 말고 **슬롯 체계부터** 다시 짤 것.
--
--   남는 줄 = 실제로 적립을 정하는 4개:
--      score/attendance   10점 · 하루 1회
--      score/daily_learn   3점 · 하루 1회
--      score/minigame      2점 · 하루 6회
--      coin/daily_complete 10코인 · 하루 1회
--
--   ⛔ **함수 배포가 끝난 뒤에 적용할 것** (complete-daily · submit-minigame · get-hub · admin).
--      순서를 뒤집어도 지금은 안 깨진다(옛 코드는 이 표를 안 읽으므로) — 다만 배포 전에는
--      관리자가 값을 바꿔도 여전히 반영이 안 되니 같은 묶음으로 나가는 게 맞다.
--
--   ⚠️ 값 자체는 안 건드린다 — 지금 4줄이 규격표(2026-09-03)와 이미 같다.
--      `tests/db/t-reward-policy.mjs` 가 이 표의 기본값과 코드 폴백이 같은지 본다.

begin;

delete from reward_policy where wallet = 'score' and kind = 'referral';
delete from reward_policy where wallet = 'score' and kind like 'minigame:%';

-- 검산 — 적립을 정하는 4줄이 그대로 있어야 한다(하나라도 없으면 폴백으로 도는 셈이라 화면이 거짓말을 한다).
do $$
declare n int;
begin
  select count(*) into n from reward_policy
   where (wallet, kind) in (('score','attendance'), ('score','daily_learn'), ('score','minigame'), ('coin','daily_complete'));
  if n <> 4 then
    raise exception '적립을 정하는 4줄 중 %개만 있다', n;
  end if;
end $$;

commit;
