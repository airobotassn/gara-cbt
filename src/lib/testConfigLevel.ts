// 시험 공통 설정
import { MIN_LEVEL, MAX_LEVEL } from './categories'

export const QUESTIONS_PER_TEST = 20
export const COOLDOWN_DAYS = 3

// 시험 제한시간(분). 화면 카운트다운 + 0 도달 시 자동 제출.
export const TEST_DURATION_MINUTES = 20

// 층화추출: 6축에서 3~4개씩 → 6×3=18 + 랜덤 2축이 +1 = 20
export const AXES_PER_TEST = 6
export const BASE_PER_AXIS = 3
export const EXTRA_AXES = 2 // +1 문항씩 더 받는 축 수

export { MIN_LEVEL, MAX_LEVEL }

// 부정행위 방지 2층: 화면 이탈 N회 누적 시 자동 제출
export const MAX_VIOLATIONS = 3

// in_progress attempt 만료 시간(분). 서버측 안전장치(화면 타이머 아님).
export const ATTEMPT_TTL_MINUTES = 120
