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
// 승급컷 비율: 레벨1~3 = 70%, 레벨4~7 = 80%. (2026-08-04 완화 — 이전 80/90%)
//   → Lv.1 7개(10문) / Lv.2·3 14개(20문) / Lv.4~7 24개(30문).
//   total 은 실제 출제 문항 수(문제은행이 모자라 덜 나간 경우 그 수)를 넘기면 그 기준으로 계산한다.
export const PROMOTE_RATE_LOW = 0.7 // Lv.1~3
export const PROMOTE_RATE_HIGH = 0.8 // Lv.4~7
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

// ── 시즌 점수 체계 (2026-08-04 원안 반영) ──
// 시즌 총점(user_progress.season_total) = 레벨테스트 트랙(skill_score) + 활동 트랙(activity_score).
//   레벨테스트 : 레벨 클리어 1회당 +1,000 · 7단계 전부 = 7,000
//   활동      : 미니게임 +2(일 3회) · 오늘의 학습 +2(일 1회) · 친구 초대 +5(일 1회) · 출석 +5(일 1회)
//               → 시즌(365일) 상한 2,190 + 730 + 1,825 + 1,825 = 6,570
//   전체 상한  = 7,000 + 6,570 = 13,570  (= ARENA Lv.7 최고점. 아래 밴드표와 맞물린다)
// ⚠️ 시즌 길이가 365일이 아니면 ACTIVITY_SEASON_MAX 가 실제 도달 가능 상한과 어긋난다 —
//    reset_season() 주기를 바꾸면 이 표를 다시 계산할 것.
export const SEASON_DAYS = 365

// ── 랭킹 점수(0~10000) — 옛 트랙, points 컬럼 전용 ──
// 사다리 전체를 0~MAX_POINTS 로. 레벨당 1/MAX_LEVEL, 레벨 내부는 그 레벨 승급컷으로 정규화.
export const MAX_POINTS = 10000
/** @deprecated skill_score/computeSkillScore 로 전환 예정. 보존 사유는 FE 폴백이 아니라 백엔드
 *  applyAttempt() 가 여전히 이 값으로 points 컬럼을 채우기 때문(_shared/scoring.ts 의 동일 함수·호출부 참조) —
 *  points 컬럼(및 이를 읽는 구코드)이 남아있는 동안은 계속 이 값을 반환해야 함 — 삭제 금지. */
export function computePoints(level: number, correct: number): number {
  const lv = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, level))
  const frac = Math.min(Math.max(0, correct) / promoteCut(lv), 1)
  return Math.round(((lv - 1 + frac) / MAX_LEVEL) * MAX_POINTS)
}
// ── 활동 트랙 ──
// 원안 표 그대로. 적립값·일일 횟수·시즌 상한 세 표가 한 벌이고, seasonMax = delta × perDay × SEASON_DAYS 로 떨어진다.
// ⚠️ 미니게임은 **참여 횟수당 고정 적립**이다(성적 무관) — 예전의 "게임별 정규화 점수 비례"는 원안 채택으로 제거됐다.
//    성적 반영안(게임당 0~2점 · 서로 다른 3종)은 보류 상태다.
// ⚠️ referral(친구 초대)은 점수 규칙만 선반영된 상태다 — 초대코드 발급·가입 귀속 플로우가 아직 없어 적립 호출부가 없다.
export type ActivityKind = 'attendance' | 'daily_learn' | 'minigame' | 'referral'
export const ACTIVITY_DELTA: Record<ActivityKind, number> = {
  attendance: 5,
  daily_learn: 2,
  minigame: 2,
  referral: 5,
}
export const ACTIVITY_PER_DAY: Record<ActivityKind, number> = {
  attendance: 1,
  daily_learn: 1,
  minigame: 3,
  referral: 1,
}
export const ACTIVITY_SEASON_MAX: Record<ActivityKind, number> = {
  attendance: 1825,
  daily_learn: 730,
  minigame: 2190,
  referral: 1825,
}
export function activityDelta(kind: ActivityKind): number {
  return ACTIVITY_DELTA[kind]
}
export function activityPerDay(kind: ActivityKind): number {
  return ACTIVITY_PER_DAY[kind]
}
/** 활동 트랙 시즌 상한 합 = 6,570 */
export const ACTIVITY_MAX = Object.values(ACTIVITY_SEASON_MAX).reduce((a, b) => a + b, 0)

// ── 레벨테스트 트랙 ──
// 레벨 하나를 클리어(승급컷 통과)할 때마다 +1,000. 부분점수 없다 — 컷을 못 넘으면 0이다.
// 사다리가 순차라 "클리어한 레벨 수" = 도달 등급 − 1 이고, 최고 레벨(Lv.7) 자체를 통과하면 7이 되어 7,000 이 만점이다.
export const LEVELTEST_CLEAR_POINTS = 1000
export const LEVELTEST_MAX = LEVELTEST_CLEAR_POINTS * MAX_LEVEL // 7,000
export function computeSkillScore(clearedLevels: number): number {
  const n = Math.max(0, Math.min(MAX_LEVEL, Math.floor(clearedLevels)))
  return n * LEVELTEST_CLEAR_POINTS
}

// ── ARENA 레벨 밴드 — 시즌 총점 → 표시 레벨 ──
// 원안 표 그대로 1,000점 균등 밴드: Lv.1 0~999 · Lv.2 1,000~1,999 · … · Lv.6 5,000~5,999 · Lv.7 6,000~13,570.
// ⚠️ 이건 **표시용 레벨**이고, 시험 사다리 등급(user_progress.rank — 승급으로만 오름)과는 별개 축이다.
//    결과창의 승급 연출은 계속 rank 기준이다.
export const ARENA_BAND_STEP = 1000
/** 시즌 총점 상한 = 레벨테스트 7,000 + 활동 6,570 = 13,570 (= Lv.7 최고점) */
export const SEASON_MAX_POINTS = LEVELTEST_MAX + ACTIVITY_MAX
export function arenaLevelForScore(total: number): number {
  const t = Math.max(0, Math.floor(total))
  return Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.floor(t / ARENA_BAND_STEP) + 1))
}
/** 그 밴드의 [최저점, 최고점]. 최상위(Lv.7)는 위가 열려 있어 시즌 상한까지. */
export function arenaBand(level: number): [number, number] {
  const lv = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, level))
  const lo = (lv - 1) * ARENA_BAND_STEP
  return [lo, lv >= MAX_LEVEL ? SEASON_MAX_POINTS : lo + ARENA_BAND_STEP - 1]
}

// (티어 5단계(브론즈~다이아)는 2026-08-04 제거됐다 — 엠블렘·티어명·티어색·티어사다리를 화면에서 통째로 뺐다.
//  DB 의 ranking_tier(pct) 함수와 ranking_season_result.final_tier 컬럼, 서버 응답의 tier/percentile 필드는
//  과거 시즌 기록 보존을 위해 남아있지만 클라이언트는 더 이상 읽지 않는다.)
// </scoring-sync>

// ── 등급(레벨) 표시 메타 ──
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

// (티어 표시 메타(TIER_COLOR/tierColor/TIER_ORDER)와 레벨→엠블렘 매핑은 모두 제거됐다 — 위 <scoring-sync> 끝 주석 참고.)

// ── 레벨별 보기 개수 고정 ──
// ⚠️ supabase/functions/_shared/scoring.ts 의 VISIBLE_OPTIONS_BY_LEVEL 과 항상 같이 고칠 것.
// 레벨1~3은 4지선다다. 옛 5지선다 시절 5번째 보기는 2026-08-04 마이그레이션으로 DB 에서 제거됐고
// (migrations/20260804120000_leveltest_l1_l3_drop_fifth_option.sql), 이 표는 다시 5번째가 생기는 걸 막는다.
// 값이 없는 레벨(4~7)은 제한 없음 = 5지선다 그대로.
export const OPTIONS_BY_LEVEL: Record<number, number> = { 1: 4, 2: 4, 3: 4 }
export function optionCapForLevel(level: number): number | null {
  return OPTIONS_BY_LEVEL[level] ?? null
}
