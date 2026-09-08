// 적립 정책 — 관리자 › 적립 정책 화면(`reward_policy` 표)이 **실제 적립을 정한다**(2026-09-07 지시).
//
// ⛔ **여태는 표시용 사본이었다.** 화면은 "출석 +10 · 미니게임 하루 6회" 를 보여주는데 실제 적립은
//    코드의 상수표가 했다. 관리자가 숫자를 바꿔도 아무 일도 안 일어났고, 두 벌이라 조용히 갈릴 수 있었다 —
//    실제로 `complete-daily` 안의 사본이 두 달간 규격의 절반(출석 5 · 퀴즈 2)이었는데 아무도 못 알아챘다.
//    이제 이 파일 하나가 적립값의 단일 출처다.
//
// ⛔ **`_shared/scoring.ts` 를 import 하지 않는다.** `complete-daily` 가 이걸 쓰는데,
//    그 함수는 cosmetic-only 불변식(실력·랭킹 데이터 무접촉)이 걸려 있어 scoring.ts import 가 금지다
//    (`tests/cosmetic-only-gate.mjs`). 그래서 폴백 숫자를 여기 직접 들고 있다 — scoring.ts 의
//    ACTIVITY_DELTA/ACTIVITY_PER_DAY 와 **같은 값**이어야 하고, `tests/db/t-reward-policy.mjs` 가 대조한다.
//
// ⚠️ **못 읽으면 폴백이다 — 0 이 아니다.** DB 가 잠깐 안 되거나 행이 없다고 적립을 멈추면
//    사용자는 이유를 모른 채 점수를 잃는다(그 손실은 되돌리기도 어렵다). 반대로 `active=false` 는
//    관리자가 **일부러 끈 것**이라 그때만 0 이다.
//
// ⚠️ **범위를 강제한다.** 관리자 오타(출석 10 → 1000)가 그대로 통과하면 시즌 상한이 무너지고
//    아레나 레벨 밴드(16,125 기준)가 통째로 틀어진다. 저장할 때도 막고(admin/reform.ts) 여기서도 접는다 —
//    이미 저장된 이상한 값이 적립까지 가면 안 되기 때문이다.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

export type ActivityKind = 'attendance' | 'daily_learn' | 'minigame'
export type RewardRule = { delta: number; perDay: number }

/** 폴백 = 2026-09-03 규격표. ⚠️ scoring.ts 의 ACTIVITY_DELTA/ACTIVITY_PER_DAY 와 같은 값이어야 한다. */
export const REWARD_FALLBACK: Record<ActivityKind, RewardRule> = {
  attendance: { delta: 10, perDay: 1 },
  daily_learn: { delta: 3, perDay: 1 },
  minigame: { delta: 2, perDay: 6 },
}

/** '오늘의 완료' 코인. 시즌 점수와 별개 지갑이라 랭킹에 안 섞인다. */
export const COIN_DAILY_FALLBACK = 10

/** 관리자가 넣을 수 있는 범위. 위쪽은 랭킹 밴드를 지키는 선, 아래쪽은 0(=안 줌) 허용. */
export const REWARD_MAX_DELTA = 100
export const REWARD_MAX_PER_DAY = 50

export function clampDelta(n: unknown): number {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(REWARD_MAX_DELTA, v))
}
export function clampPerDay(n: unknown): number {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v)) return 1
  return Math.max(1, Math.min(REWARD_MAX_PER_DAY, v))
}

type Row = { wallet: string; kind: string; amount: number; per_day: number; active: boolean }

/**
 * 활동 적립 규칙을 DB 에서 읽는다. 한 번의 조회로 세 종류를 다 받는다.
 *  · 행 없음 / 조회 실패 → 폴백(적립은 계속된다)
 *  · active=false      → delta 0 (관리자가 일부러 끈 것)
 * ⚠️ `minigame:<gameId>` 행은 **안 본다** — 하루 캡이 게임과 무관한 전역 회차 슬롯
 *    (`activity_ledger.source_ref = 'play:1'…'play:N'`)이라 게임별로 나눌 수가 없다.
 *    그 6줄은 2026-09-07 마이그레이션에서 지웠다.
 */
export async function loadRewardPolicy(admin: SupabaseClient): Promise<Record<ActivityKind, RewardRule>> {
  const out: Record<ActivityKind, RewardRule> = {
    attendance: { ...REWARD_FALLBACK.attendance },
    daily_learn: { ...REWARD_FALLBACK.daily_learn },
    minigame: { ...REWARD_FALLBACK.minigame },
  }
  const { data, error } = await admin
    .from('reward_policy')
    .select('wallet, kind, amount, per_day, active')
    .eq('wallet', 'score')
  if (error || !data) return out
  for (const r of data as Row[]) {
    if (!(r.kind in out)) continue
    const k = r.kind as ActivityKind
    out[k] = r.active
      ? { delta: clampDelta(r.amount), perDay: clampPerDay(r.per_day) }
      : { delta: 0, perDay: clampPerDay(r.per_day) }
  }
  return out
}

/** '오늘의 완료' 코인 적립값. 꺼져 있으면 0, 못 읽으면 폴백. */
export async function loadCoinDaily(admin: SupabaseClient): Promise<number> {
  const { data, error } = await admin
    .from('reward_policy')
    .select('amount, active')
    .eq('wallet', 'coin')
    .eq('kind', 'daily_complete')
    .maybeSingle()
  if (error || !data) return COIN_DAILY_FALLBACK
  return (data as { amount: number; active: boolean }).active ? clampDelta((data as { amount: number }).amount) : 0
}
