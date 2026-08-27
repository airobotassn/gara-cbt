// 시험 공통 설정
import { MIN_LEVEL, MAX_LEVEL } from './categories'

// 문항 수·제한시간은 레벨 구간별 — 단일 출처는 scoring.ts 의 questionsForLevel/durationMinutesForLevel.
//   Lv.1 = 10문항/10분 · Lv.2 = 15문항/15분 · Lv.3~4 = 20문항/20분 · Lv.5~7 = 30문항/30분 (문항당 1분)
export { questionsForLevel, durationMinutesForLevel } from './scoring'
/** @deprecated 레벨 구간별로 갈렸다. 레벨을 모르는 자리의 표시용 폴백으로만 쓸 것. */
export const QUESTIONS_PER_TEST = 20
export const COOLDOWN_DAYS = 3
// 하루 응시 가능 횟수(정식 회원 기준). 그날 승급하면 1회씩 추가된다 — 강제는 서버(start-test).
export const DAILY_ATTEMPTS_BASE = 2

// 층화추출: 그 레벨의 문항 수를 축 수로 균등 배분한다(축 수도 레벨마다 다르다 — Lv.1 만 3축).
//   ⚠️ 실제 배분은 함수쪽 단일 출처: supabase/functions/_shared/scoring.ts 의 axisQuota()
export const AXES_PER_TEST = 6 // 표준 축 수(Lv.1 은 예외로 3)
export function axisQuota(axisCount: number, total: number): { base: number; extraAxes: number } {
  if (axisCount <= 0) return { base: 0, extraAxes: 0 }
  const base = Math.floor(total / axisCount)
  return { base, extraAxes: total - base * axisCount }
}

export { MIN_LEVEL, MAX_LEVEL }

// 레벨 사다리 색(연두 → 빨강). 레벨 선택(/test/select)의 배지·사다리와 응시 전 경고 화면이 같이 쓴다.
//   ⚠️ scoring.ts 의 levelColor(티어 계열)와는 다른 축이라 따로 둔다 — 2026-07-27 한 번 통합했다가 되돌렸다.
export const LEVEL_COLORS: Record<number, string> = {
  1: '#86efac',
  2: '#5fd98a',
  3: '#d6c534',
  4: '#e0a526',
  5: '#f08a3f',
  6: '#ef6b5f',
  7: '#e0443a',
}

// 문제은행이 비어 있어 응시를 막아둘 레벨(레벨 선택 화면에서 '오픈 예정'). 비어 있으면 전 레벨 응시 가능.
//   문항 없는 레벨을 여기 빼두면 start-test 가 '해당 레벨의 문제가 없습니다.' 로 400 을 낸다.
//   2026-07-23 Lv.1 문항 등록(l1_prompt 20 · l1_tools 13) 완료 → 잠금 해제.
//   2026-07-27 Lv.1 에 l1_problem(AI를 활용한 문제해결) 축 추가 — 이 축은 아직 문항 0개라
//   출제 시 부족분을 다른 축에서 채운다(start-test 폴백). 문항을 채우기 전엔 레이더 삼각형의 한 꼭짓점이 0 이다.
//   2026-08-27 사다리 밀기(옛 2~5 → 3~6)로 Lv.2 가 비어 잠가뒀다가, 같은 날 6축 정의와
//   문항 30개(L2-001~030 · 6영역 × 5개 · 4지선다 · 6개국어)가 들어와 **잠금을 풀었다.**
//   ⛔ 잠금은 문항이 실제로 들어온 뒤에 푼다. 먼저 풀면 start-test 가 '해당 레벨의 문제가
//      없습니다.' 로 400 을 내고, 사용자는 이유를 모르는 오류만 본다.
export const COMING_SOON_LEVELS: number[] = []

// 부정행위 방지 2층: 화면 이탈 N회 누적 시 자동 제출
export const MAX_VIOLATIONS = 3

// in_progress attempt 만료 시간(분). 서버측 안전장치(화면 타이머 아님).
export const ATTEMPT_TTL_MINUTES = 120
