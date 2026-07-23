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

// 문제은행이 비어 있어 응시를 막아둘 레벨(레벨 선택 화면에서 '오픈 예정'). 비어 있으면 전 레벨 응시 가능.
//   문항 없는 레벨을 여기 빼두면 start-test 가 '해당 레벨의 문제가 없습니다.' 로 400 을 낸다.
//   2026-07-23 Lv.1 문항 등록(l1_prompt 20 · l1_tools 13) 완료 → 잠금 해제.
export const COMING_SOON_LEVELS: number[] = []

// 부정행위 방지 2층: 화면 이탈 N회 누적 시 자동 제출
export const MAX_VIOLATIONS = 3

// in_progress attempt 만료 시간(분). 서버측 안전장치(화면 타이머 아님).
export const ATTEMPT_TTL_MINUTES = 120
