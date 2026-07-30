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
// ── 시험 규모: 레벨 구간별 문항 수 = 제한시간(분). 문항당 1분. ──
//   Lv.1 = 10문항/10분 · Lv.2~3 = 20문항/20분 · Lv.4~7 = 30문항/30분
//   ⚠️ 문항 수가 레벨마다 다르므로 승급컷은 절대 개수가 아니라 **비율**이다(아래).
//   ⚠️ 구간 경계가 승급컷 비율의 경계(Lv.3/Lv.4)와 맞물려 있다 — 한쪽만 옮기면 컷이 어긋난다.
export function questionsForLevel(level: number): number {
  if (level <= 1) return 10
  if (level <= 3) return 20
  return 30
}
export function durationMinutesForLevel(level: number): number {
  return questionsForLevel(level) // 문항당 1분
}

// ── 등급(레벨) 변동 규칙 ──
// ⚠️ 강등은 없다(2026-07 제거). 등급은 오르거나 유지만 된다 — 강등선/경고(DEMOTE_*)·강등 시드·rank_dir='down' 이
//    같이 사라졌다. DB 컬럼(user_progress.demotion_strikes · test_attempts.warn_strikes)은 남아있지만 읽지도 쓰지도 않는다.
// 승급컷 비율: 레벨1~3 = 80%, 레벨4~7 = 90%.
//   → Lv.1 8개(10문) / Lv.2·3 16개(20문) / Lv.4~7 27개(30문).
//   total 은 실제 출제 문항 수(문제은행이 모자라 덜 나간 경우 그 수)를 넘기면 그 기준으로 계산한다.
export const PROMOTE_RATE_LOW = 0.8 // Lv.1~3
export const PROMOTE_RATE_HIGH = 0.9 // Lv.4~7
export function promoteCut(level: number, total: number = questionsForLevel(level)): number {
  return Math.ceil(total * (level <= 3 ? PROMOTE_RATE_LOW : PROMOTE_RATE_HIGH))
}

export type RankDir = 'up' | 'stay'

export interface RankChange {
  nextRank: number
  dir: RankDir
}

// 등급 변동:
//   승급: 응시레벨 ≥ 내등급 & 그 레벨 승급컷(비율) 이상 → +1
//   그 외 → 유지(점수가 낮아도 등급은 내려가지 않는다)
//   total = 실제 출제 문항 수(생략 시 레벨 기준값). 문제은행 부족으로 덜 나간 시험도 같은 비율로 판정된다.
export function computeRankChange(
  currentRank: number,
  testLevel: number,
  correct: number,
  total: number = questionsForLevel(testLevel),
): RankChange {
  // 승급
  if (testLevel >= currentRank && correct >= promoteCut(testLevel, total)) {
    const next = Math.min(MAX_LEVEL, currentRank + 1)
    return { nextRank: next, dir: next > currentRank ? 'up' : 'stay' }
  }
  // 그 외 → 유지
  return { nextRank: currentRank, dir: 'stay' }
}

// ── 랭킹 점수(0~10000) ──
// 사다리 전체를 0~MAX_POINTS 로. 레벨당 1/MAX_LEVEL, 레벨 내부는 그 레벨 승급컷으로 정규화
// (→ 승급하는 순간이 다음 밴드 바닥과 이어져 빈 천장이 사라짐).
export const MAX_POINTS = 10000
/** @deprecated skill_score/computeSkillScore 로 전환 예정. 보존 사유는 FE 폴백이 아니라 백엔드
 *  applyAttempt() 가 여전히 이 값으로 points 컬럼을 채우기 때문(_shared/scoring.ts 의 동일 함수·호출부 참조) —
 *  points 컬럼(및 이를 읽는 구코드)이 남아있는 동안은 계속 이 값을 반환해야 함 — 삭제 금지. */
export function computePoints(level: number, correct: number): number {
  const lv = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, level))
  const frac = Math.min(Math.max(0, correct) / promoteCut(lv), 1)
  return Math.round(((lv - 1 + frac) / MAX_LEVEL) * MAX_POINTS)
}
export type ActivityKind = 'attendance' | 'daily_learn' | 'minigame'
// 활동 종류별 적립값(활동 최대 기여의 상한). attendance < daily_learn < minigame 부등호 유지.
// minigame 값은 "정규화 상한"이다 — 실제 적립값은 게임별 서버 정규화 점수를 이 상한 이하로 스케일해서 쓴다(게임별 스코어링은 이 파일 밖 관심사).
// 튜닝 근거(부등호 "실력 최고치 > 활동 최대 기여" 성립 확인):
//   실력 최고치 = computeSkillScore(MAX_LEVEL, promoteCut(MAX_LEVEL)) = SKILL_LEVEL_STEP*MAX_LEVEL = MAX_POINTS = 10000.
//   가정(assumption, 튜닝 필요시 갱신): 시즌 ≈ 60일, 점수 적립이 배선된 미니게임 2종
//   (기준은 레지스트리 개수가 아니라 submit-minigame 의 GAME_MAX — 레지스트리엔 6종이지만 나머지는 제출 배선이 없어 적립 0).
//   활동 일일 최대 = ATTENDANCE(10) + DAILY_LEARN(30) + MINIGAME(50)×2종 = 140 → 시즌 누적 ≈ 8,400 (< 10,000, 여유 16%).
//   ⚠️ 미니게임 종류가 늘어나면(예: 3종 이상) 이 여유가 줄거나 역전될 수 있다 — 레지스트리가 커지면 ACTIVITY_DELTA.minigame 을
//      낮추거나 시즌 단위 활동 캡(추후 스테이지 과제)을 도입해 이 부등호를 재검증할 것. (미해결/가정으로 명시)
export const ACTIVITY_DELTA: Record<ActivityKind, number> = {
  attendance: 10,
  daily_learn: 30,
  minigame: 50,
}
export function activityDelta(kind: ActivityKind): number {
  return ACTIVITY_DELTA[kind]
}

// 레벨가중 실력점수(최고성취 기반). computePoints 와 스케일 연속성 유지
// (SKILL_LEVEL_STEP*MAX_LEVEL === MAX_POINTS) — STAGE1 백필(points→skill_score 그대로 복사)과 이어짐.
// level 은 하한만 clamp(MIN_LEVEL)하고 상한은 두지 않는다("상한 없음") — 향후 MAX_LEVEL 이 늘어도 재작성 불필요.
export const SKILL_LEVEL_STEP = MAX_POINTS / MAX_LEVEL // 튜닝 대상: 레벨당 계단 폭
export function computeSkillScore(level: number, correct: number): number {
  const lv = Math.max(MIN_LEVEL, level)
  const frac = Math.min(Math.max(0, correct) / promoteCut(lv), 1)
  return Math.round(SKILL_LEVEL_STEP * (lv - 1) + SKILL_LEVEL_STEP * frac)
}

// 백분위(0~1, 낮을수록 상위) → 티어 5단계. DB ranking_tier(pct)(reset_season_fn.sql)와 동일 밴드 — FE/백엔드 단일 출처.
export type Tier = 'diamond' | 'platinum' | 'gold' | 'silver' | 'bronze'
export function tierForPercentile(pct: number): Tier {
  if (pct <= 0.05) return 'diamond'
  if (pct <= 0.2) return 'platinum'
  if (pct <= 0.45) return 'gold'
  if (pct <= 0.75) return 'silver'
  return 'bronze'
}
// </scoring-sync>

// ── 등급(레벨) 표시 메타 ──
// 레벨 색. 티어 엠블렘(public/emblems/*)과는 다른 축이다 — 엠블렘은 티어(5단계) 전용.
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

// (레벨→엠블렘 매핑 LEVEL_EMBLEM/emblemKeyForLevel 은 제거됐다 — 아이언·마스터가 없어지고
//  엠블렘이 티어 5단계 이미지 public/emblems/<tier>.webp 단일 체계가 되면서 쓸 곳이 사라졌다.)

// Tier(5단계) → 표시색. LEVEL_COLOR 팔레트와 동일 hex(엠블렘 ↔ 배경/이름색 꼬임 방지).
export const TIER_COLOR: Record<Tier, string> = {
  bronze: '#b8763e',
  silver: '#aeb9c8',
  gold: '#e3b23c',
  platinum: '#3fb8ad',
  diamond: '#4aa0e8',
}
export function tierColor(tier: Tier | null | undefined): string {
  return (tier && TIER_COLOR[tier]) || '#9ca3af'
}
/** 낮은 티어 → 높은 티어. 티어 사다리(대시보드) 노출 순서. */
export const TIER_ORDER: Tier[] = ['bronze', 'silver', 'gold', 'platinum', 'diamond']
