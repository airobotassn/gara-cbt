// 레벨별 누적 6축 레이팅(EWMA) + 등급(레벨) 변동 규칙. 모든 튜닝값은 여기 한 곳.
// (Edge Function 의 _shared/lib.ts 와 동일한 수식을 유지할 것)
import { MIN_LEVEL, MAX_LEVEL } from './categories'

export type AxisMap = Record<string, number>

// <scoring-sync> ⚠️ 이 영역(채점 공식)은 supabase/functions/_shared/lib.ts 의 <scoring-sync> 영역과 항상 같이 고칠 것. 가드(guard.mjs)가 한쪽만 바뀌면 커밋을 막는다.
// ── 축 점수 정규화: 그 레벨에서 만점 = 100 ──
// (예전엔 LEVEL_WEIGHT 로 레벨이 천장이었으나, 이제 레벨별 레이더라 각 레벨 만점이 100)
export const RATIO_EXPONENT = 1.2 // 실수 페널티(완화: 부분 정답도 점수 인정 ↑)
export const GUESS_BASELINE = 0.25 // 4지선다 무작위 정답 기댓값(추측 보정용)

// 비대칭 EWMA: 올라갈 땐 빠르게, 내려갈 땐 천천히(한 판 망쳐도 살짝만 하락)
export const EWMA_K_UP = 0.6
export const EWMA_K_DOWN = 0.15
export const PLACEMENT_K = 1 // 그 레벨 첫 응시(배치)는 perf를 그대로 박음
// 강등 시 내려간 레벨을 이 점수로 시드(롤식: 하위 티어 상단에서 시작). 실제 적용은 서버(_shared/lib.ts applyAttempt).
export const DEMOTE_SEED = 85

// 한 축 성적(0~100). ratio = 그 축 정답률(0~1).
// 추측 보정: 무작위 기댓값(25%)을 깎아 순수 찍기는 0에 수렴.
export function axisPerf(ratio: number): number {
  const r = Math.max(0, Math.min(1, ratio))
  const adj = Math.max(0, (r - GUESS_BASELINE) / (1 - GUESS_BASELINE))
  return 100 * Math.pow(adj, RATIO_EXPONENT)
}

// EWMA 갱신: 그 레벨 첫 응시(미배치)면 perf 그대로, 이후엔 상승 빠르게/하락 천천히
export function updateAxis(prev: number, perf: number, placed: boolean): number {
  if (!placed) return prev + PLACEMENT_K * (perf - prev)
  const k = perf >= prev ? EWMA_K_UP : EWMA_K_DOWN
  return prev + k * (perf - prev)
}
// </scoring-sync>

// 레벨별 평균(레이더 채움 정도 표시용)
export function levelAverage(rating: AxisMap, keys: string[]): number {
  if (keys.length === 0) return 0
  return keys.reduce((s, k) => s + (rating[k] ?? 0), 0) / keys.length
}

// 절대 최저축(처방용: 가장 약한 축)
export function weakestAxis(rating: AxisMap, keys: string[]): string {
  let k = keys[0]
  for (const key of keys) if ((rating[key] ?? 0) < (rating[k] ?? 0)) k = key
  return k
}

// <scoring-sync> ⚠️ 등급/점수 공식 — _shared/lib.ts 의 <scoring-sync> 영역과 항상 같이 고칠 것.
// ── 등급(레벨) 변동 규칙 ──
// 승급컷: 레벨1~3 = 16개, 레벨4~7 = 18개 (원점수 20점 만점).
export function promoteCut(level: number): number {
  return level <= 3 ? 16 : 18
}
// 강등: 4개 이하(=5개 미만)를 연속 3번 받으면 한 단계 강등. 그 전 2번은 경고.
//       중간에 5개 이상 맞히면 경고 리셋(연속 끊김). 레벨이 바뀌면 경고 리셋. Lv.1은 강등 없음.
export const DEMOTE_MAX = 4 // 이 이하면 '부진'(경고 1회)
export const DEMOTE_STRIKES = 3 // 경고가 이 횟수에 도달하면 강등

export type RankDir = 'up' | 'down' | 'stay'

export interface RankChange {
  nextRank: number
  dir: RankDir
  nextStrikes: number // 갱신된 강등 경고 누적(승급/강등/리셋 시 0)
  warned: boolean // 이번 응시에서 강등 경고가 누적됐는가(아직 강등은 아님)
}

// 등급 변동 + 강등 경고(3진 아웃):
//   승급: 응시레벨 ≥ 내등급 & 그 레벨 승급컷 이상  → +1 (경고 리셋)
//   강등: 응시레벨 ≤ 내등급 & 4개 이하 & 내등급 > 최저 → 경고 +1, 3회째면 −1
//   그 외(5개 이상 등) → 유지 + 경고 리셋
export function computeRankChange(
  currentRank: number,
  testLevel: number,
  correct: number,
  strikes: number,
): RankChange {
  // 승급
  if (testLevel >= currentRank && correct >= promoteCut(testLevel)) {
    const next = Math.min(MAX_LEVEL, currentRank + 1)
    return { nextRank: next, dir: next > currentRank ? 'up' : 'stay', nextStrikes: 0, warned: false }
  }
  // 강등 경고(3진 아웃)
  if (testLevel <= currentRank && correct <= DEMOTE_MAX && currentRank > MIN_LEVEL) {
    const s = strikes + 1
    if (s >= DEMOTE_STRIKES) {
      return { nextRank: currentRank - 1, dir: 'down', nextStrikes: 0, warned: false }
    }
    return { nextRank: currentRank, dir: 'stay', nextStrikes: s, warned: true }
  }
  // 그 외 → 유지 + 경고 리셋
  return { nextRank: currentRank, dir: 'stay', nextStrikes: 0, warned: false }
}

// ── 랭킹 점수(0~10000) ──
// 사다리 전체를 0~MAX_POINTS 로. 레벨당 1/MAX_LEVEL, 레벨 내부는 그 레벨 승급컷으로 정규화
// (→ 승급하는 순간이 다음 밴드 바닥과 이어져 빈 천장이 사라짐).
export const MAX_POINTS = 10000
export function computePoints(level: number, correct: number): number {
  const lv = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, level))
  const frac = Math.min(Math.max(0, correct) / promoteCut(lv), 1)
  return Math.round(((lv - 1 + frac) / MAX_LEVEL) * MAX_POINTS)
}
// </scoring-sync>

// ── 등급(레벨) 표시 메타 ──
// 색은 TierEmblem(엠블렘) 팔레트와 일치시킨다(엠블렘 ↔ 배경/이름색 꼬임 방지).
export const LEVEL_COLOR: Record<number, string> = {
  1: '#8b9099', // iron
  2: '#b8763e', // bronze
  3: '#aeb9c8', // silver
  4: '#e3b23c', // gold
  5: '#3fb8ad', // platinum
  6: '#4aa0e8', // diamond
  7: '#a566e0', // master
}
export function levelColor(level: number): string {
  return LEVEL_COLOR[level] ?? '#9ca3af'
}

// 레벨 → 엠블렘 비주얼 키(TierEmblem 재활용). 네이밍은 추후 확정.
export const LEVEL_EMBLEM: Record<number, string> = {
  1: 'iron',
  2: 'bronze',
  3: 'silver',
  4: 'gold',
  5: 'platinum',
  6: 'diamond',
  7: 'master',
}
export function emblemKeyForLevel(level: number): string {
  return LEVEL_EMBLEM[level] ?? 'iron'
}
