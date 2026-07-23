// 시험 공통 설정
import { MIN_LEVEL, MAX_LEVEL } from './categories'

export const QUESTIONS_PER_TEST = 20
export const COOLDOWN_DAYS = 3

// 시험 제한시간(분). 화면 카운트다운 + 0 도달 시 자동 제출.
export const TEST_DURATION_MINUTES = 20

// 층화추출: 20문항을 그 레벨의 축 수로 균등 배분한다(축 수는 레벨마다 다르다 — Lv.1 만 2축).
//   6축 → 3개씩 + 랜덤 2축이 +1 = 20 · 2축 → 10개씩 = 20
//   ⚠️ 실제 배분은 함수쪽 단일 출처: supabase/functions/_shared/scoring.ts 의 axisQuota()
export const AXES_PER_TEST = 6 // 표준 축 수(Lv.1 은 예외로 2)
export function axisQuota(axisCount: number): { base: number; extraAxes: number } {
  if (axisCount <= 0) return { base: 0, extraAxes: 0 }
  const base = Math.floor(QUESTIONS_PER_TEST / axisCount)
  return { base, extraAxes: QUESTIONS_PER_TEST - base * axisCount }
}

export { MIN_LEVEL, MAX_LEVEL }

// 문제은행이 아직 비어 있어 응시를 막아둔 레벨(레벨 선택 화면에서 '준비 중').
//   2026-07 사다리 한 칸 밀기로 신설된 Lv.1 — 문항이 들어오면 이 배열을 비울 것.
//   (없이 두면 start-test 가 '해당 레벨의 문제가 없습니다.' 로 400 을 낸다)
export const COMING_SOON_LEVELS: number[] = [1]

// 부정행위 방지 2층: 화면 이탈 N회 누적 시 자동 제출
export const MAX_VIOLATIONS = 3

// in_progress attempt 만료 시간(분). 서버측 안전장치(화면 타이머 아님).
export const ATTEMPT_TTL_MINUTES = 120
