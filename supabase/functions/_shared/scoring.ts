// _shared/scoring.ts — CARIS ARENA 스코어링/레벨 엔진 (Deno).
// ⚠️ 프론트 src/lib/scoring.ts 의 <scoring-sync> 영역과 항상 같이 고칠 것.
// 인증·클라이언트·다국어(pick/proj) 헬퍼는 ./lib.ts 를 재수출한다(CARIS ARENA 함수는 이 파일만 import).
import { type SupabaseClient, type User } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { projOptions } from './lib.ts'
export * from './lib.ts'

// ----- 공통 상수 -----
/** @deprecated 문항 수는 레벨 구간별(questionsForLevel). 이 값은 구코드 폴백용으로만 남긴다. */
export const QUESTIONS_PER_TEST = 20
// 시험 규모: 레벨 구간별 문항 수 = 제한시간(분). Lv.1 = 10 · Lv.2~4 = 20 · Lv.5~7 = 30.
//   ⚠️ 프론트 src/lib/scoring.ts 의 동명 함수와 항상 같이 고칠 것.
//   ⚠️ 2026-08-27 사다리 밀기(옛 2~5 → 3~6)로 경계가 Lv.3/4 → Lv.4/5 로 옮겨졌다.
//      옛 L3 문항(=지금 L4)은 보기가 4개뿐이라 경계를 안 밀면 5지선다 규칙에 걸려 보기가 빈다.
export function questionsForLevel(level: number): number {
  if (level <= 1) return 10
  if (level <= 4) return 20
  return 30
}
export function durationMinutesForLevel(level: number): number {
  return questionsForLevel(level)
}
// 하루 응시 가능 횟수(정식 회원). 그날 승급할 때마다 1회씩 추가된다 — start-test 참고.
export const DAILY_ATTEMPTS_BASE = 2
export const COOLDOWN_DAYS = 3
export const ATTEMPT_TTL_MINUTES = 120
export const MIN_LEVEL = 1
export const MAX_LEVEL = 7

// 층화추출: 6축 × 3 + 랜덤 2축 +1 = 20 (아래 axisQuota 의 6축 결과와 동일)
export const BASE_PER_AXIS = 3
export const EXTRA_AXES = 2

// 축 수도(Lv.1 = 3축) 문항 수도(10/20/30) 레벨마다 달라서 축당 문항 수는 상수가 아니라 여기서 계산한다.
//   예) Lv.1 3축·10문항 → 3개씩 + 랜덤 1축이 +1 · Lv.2 6축·10문항 → 1개씩 + 랜덤 4축이 +1
export function axisQuota(axisCount: number, total: number = QUESTIONS_PER_TEST): { base: number; extraAxes: number } {
  if (axisCount <= 0) return { base: 0, extraAxes: 0 }
  const base = Math.floor(total / axisCount)
  return { base, extraAxes: total - base * axisCount }
}

// 오늘(KST) 남은 응시 횟수 = 기본 2회 + 그날 승급 수 − 그날 시작 수.
//   · 별도 테이블 없이 test_attempts 로만 센다. 시작만 하고 이탈한 in_progress/expired 도 '소모'로 친다
//     (시작→이탈 반복으로 무한 응시하는 걸 막으려면 이 방법뿐).
//   · 승급하면 소모분을 돌려받는 셈이라 그날 안에 한 번 더 도전할 수 있다.
//   · 게스트(익명)·관리자는 애초에 제한 대상이 아니므로 호출부에서 걸러 쓸 것.
//   ⚠️ start-test(강제)와 list-attempts(표시)가 같은 값을 써야 해서 여기 한 곳에 둔다.
export async function dailyAttemptsLeft(
  admin: SupabaseClient,
  userId: string,
): Promise<{ left: number; used: number; allowed: number }> {
  const kstToday = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
  const { data } = await admin
    .from('test_attempts')
    .select('id, rank_dir')
    .eq('user_id', userId)
    .gte('started_at', `${kstToday}T00:00:00+09:00`)
  const used = data?.length ?? 0
  const promoted = (data ?? []).filter((a) => a.rank_dir === 'up').length
  const allowed = DAILY_ATTEMPTS_BASE + promoted
  return { left: allowed - used, used, allowed }
}

// ----- 레벨별 축 코드 (categories.ts 와 동일하게 유지!) — Lv.1 만 3축, 나머지는 6축 -----
// 2026-08-27 사다리 밀기: 옛 2~5 → 3~6(축 코드도 같이 밀었다 — 옛 l2_principle = 지금 l3_principle).
//   L1·L7 은 제자리. 옛 L6 축(l6_reasoning 등)은 폐기.
export const LEVEL_AXES: Record<number, string[]> = {
  // 2026-07-27 l1_problem(AI를 활용한 문제해결) 추가 — 프론트 categories.ts 와 순서까지 동일하게 유지할 것.
  1: ['l1_prompt', 'l1_tools', 'l1_problem'],
  // Lv.2 = 빈 레벨(축·문항 미정). 문항을 넣기 전에 categories.ts 와 여기 6축을 먼저 정의할 것.
  2: [],
  3: ['l3_principle', 'l3_security', 'l3_ethics', 'l3_responsibility', 'l3_llm_eco', 'l3_prompt'],
  4: ['l4_genai', 'l4_api', 'l4_algo', 'l4_sensor', 'l4_block', 'l4_python'],
  5: ['l5_rag', 'l5_llm_ctrl', 'l5_vision_eval', 'l5_vision_data', 'l5_c_basic', 'l5_c_adv'],
  6: ['l6_preproc', 'l6_stm32', 'l6_ros2', 'l6_plc', 'l6_sim', 'l6_smartfactory'],
  // L7 = 최종 단계(2026-08-27 용어 정리 + 6개국어). 코드는 그대로 — 문항 95개가 달려 있다.
  7: ['l7_swarm', 'l7_hrc', 'l7_dtwin', 'l7_orchestration', 'l7_process_opt', 'l7_robosec'],
}
export function axisKeysForLevel(level: number): string[] {
  return LEVEL_AXES[level] ?? []
}

export type AxisMap = Record<string, number>

// <scoring-sync> ⚠️ 이 영역(채점 공식)은 src/lib/scoring.ts 의 <scoring-sync> 영역과 항상 같이 고칠 것.
// ----- 스코어링 계수 (scoring.ts 와 동일) -----
const EWMA_K_UP = 0.6
const EWMA_K_DOWN = 0.15
const PLACEMENT_K = 1
const RATIO_EXPONENT = 1.2
const GUESS_BASELINE = 0.25

// 축 점수 정규화: 그 레벨 만점 = 100 (추측 보정 포함)
export function axisPerf(ratio: number): number {
  const r = Math.max(0, Math.min(1, ratio))
  const adj = Math.max(0, (r - GUESS_BASELINE) / (1 - GUESS_BASELINE))
  return 100 * Math.pow(adj, RATIO_EXPONENT)
}
export function updateAxis(prev: number, perf: number, placed: boolean): number {
  if (!placed) return prev + PLACEMENT_K * (perf - prev)
  const k = perf >= prev ? EWMA_K_UP : EWMA_K_DOWN
  return prev + k * (perf - prev)
}

// ----- 등급(레벨) 변동 (scoring.ts 와 동일하게 유지!) -----
// 승급컷: 레벨1~4 = 70%, 레벨5~7 = 80%. (2026-08-04 완화 — 이전 80/90% · 2026-08-27 경계 한 칸 밀기)
//   → Lv.1 7개(10문) / Lv.2~4 14개(20문) / Lv.5~7 24개(30문).
//   강등은 없다(2026-07 제거) — 등급은 오르거나 유지만 된다.
//   문항 수가 레벨 구간마다 달라(10/20/30) 절대 개수가 아니라 비율로 판정한다.
export const PROMOTE_RATE_LOW = 0.7
export const PROMOTE_RATE_HIGH = 0.8
export function promoteCut(level: number, total: number = questionsForLevel(level)): number {
  return Math.ceil(total * (level <= 4 ? PROMOTE_RATE_LOW : PROMOTE_RATE_HIGH))
}
export type RankDir = 'up' | 'stay'
export interface RankChange {
  nextRank: number
  dir: RankDir
}
export function computeRankChange(
  currentRank: number,
  testLevel: number,
  correct: number,
  total: number = questionsForLevel(testLevel),
): RankChange {
  if (testLevel >= currentRank && correct >= promoteCut(testLevel, total)) {
    const next = Math.min(MAX_LEVEL, currentRank + 1)
    return { nextRank: next, dir: next > currentRank ? 'up' : 'stay' }
  }
  return { nextRank: currentRank, dir: 'stay' }
}

// ── 시즌 점수 체계 (2026-08-04 원안 반영) ──
// 시즌 총점(user_progress.season_total) = 레벨테스트 트랙(skill_score) + 활동 트랙(activity_score).
//   레벨테스트 : 레벨 클리어 1회당 +1,000 · 7단계 전부 = 7,000
//   활동      : 미니게임 +2(일 3회) · 오늘의 학습 +2(일 1회) · 출석 +5(일 1회)
//               → 시즌(365일) 상한 2,190 + 730 + 1,825 = 4,745
//   전체 상한  = 7,000 + 4,745 = 11,745  (= ARENA Lv.7 최고점. 아래 밴드표와 맞물린다)
// ⚠️ 친구 초대는 **이 표에 없다**(2026-08-24). 보상이 시즌 점수 +5 에서 **코인 50(양쪽)** 으로 옮겨갔다 —
//    코인은 상점 지갑이라 랭킹에 안 섞인다. 지급은 RPC `redeem_referral`(20260824120000) 하나가 한다.
//    ⛔ 여기에 referral 을 되살리면 화면이 "친구 초대 +5점" 이라고 말하면서 실제로는 코인만 나간다.
// ⚠️ 시즌 길이가 365일이 아니면 ACTIVITY_SEASON_MAX 가 실제 도달 가능 상한과 어긋난다 —
//    reset_season() 주기를 바꾸면 이 표를 다시 계산할 것.
export const SEASON_DAYS = 365

// 랭킹 점수(0~10000) — 옛 트랙, points 컬럼 전용. 레벨당 1/MAX_LEVEL, 레벨 내부는 승급컷 정규화.
export const MAX_POINTS = 10000
/** @deprecated skill_score/computeSkillScore 로 전환 예정. 보존 사유는 FE 폴백이 아니라 백엔드
 *  applyAttempt() 가 여전히 이 값으로 points 컬럼을 채우기 때문(아래 computePoints(nextRank, latestCorrect)
 *  호출부 참조) — points 컬럼(및 이를 읽는 구코드)이 남아있는 동안은 계속 이 값을 반환해야 함 — 삭제 금지. */
export function computePoints(level: number, correct: number): number {
  const lv = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, level))
  const frac = Math.min(Math.max(0, correct) / promoteCut(lv), 1)
  return Math.round(((lv - 1 + frac) / MAX_LEVEL) * MAX_POINTS)
}
// ── 활동 트랙 ──
// 원안 표 그대로. 적립값·일일 횟수·시즌 상한 세 표가 한 벌이고, seasonMax = delta × perDay × SEASON_DAYS 로 떨어진다.
// ⚠️ 미니게임은 **참여 횟수당 고정 적립**이다(성적 무관) — 예전의 "게임별 정규화 점수 비례"는 원안 채택으로 제거됐다.
//    성적 반영안(게임당 0~2점 · 서로 다른 3종)은 보류 상태다.
// ⚠️ 옛 'referral'(친구 초대 +5) 은 2026-08-24 에 빠졌다 — 보상이 코인으로 옮겨갔다(위 주석 참고).
//    activity_ledger 의 kind CHECK 에는 아직 남아 있고 **이미 적립된 옛 행도 그대로 둔다**(받은 점수를
//    빼앗지 않는다). 새로 쌓는 곳만 없어졌다.
export type ActivityKind = 'attendance' | 'daily_learn' | 'minigame'
export const ACTIVITY_DELTA: Record<ActivityKind, number> = {
  attendance: 5,
  daily_learn: 2,
  minigame: 2,
}
export const ACTIVITY_PER_DAY: Record<ActivityKind, number> = {
  attendance: 1,
  daily_learn: 1,
  minigame: 3,
}
export const ACTIVITY_SEASON_MAX: Record<ActivityKind, number> = {
  attendance: 1825,
  daily_learn: 730,
  minigame: 2190,
}
export function activityDelta(kind: ActivityKind): number {
  return ACTIVITY_DELTA[kind]
}
export function activityPerDay(kind: ActivityKind): number {
  return ACTIVITY_PER_DAY[kind]
}
/** 활동 트랙 시즌 상한 합 = 4,745 */
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
// 원안 표 그대로 1,000점 균등 밴드: Lv.1 0~999 · Lv.2 1,000~1,999 · … · Lv.6 5,000~5,999 · Lv.7 6,000~11,745.
// ⚠️ 이건 **표시용 레벨**이고, 시험 사다리 등급(user_progress.rank — 승급으로만 오름)과는 별개 축이다.
//    결과창의 승급 연출은 계속 rank 기준이다.
export const ARENA_BAND_STEP = 1000
/** 시즌 총점 상한 = 레벨테스트 7,000 + 활동 4,745 = 11,745 (= Lv.7 최고점) */
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

export function emptyAxis(keys: string[]): AxisMap {
  const out: AxisMap = {}
  for (const k of keys) out[k] = 0
  return out
}
// jsonb / 임의 객체 → AxisMap (주어진 키만 안전 추출)
export function toAxisMap(obj: unknown, keys: string[]): AxisMap {
  const out = emptyAxis(keys)
  if (obj && typeof obj === 'object') {
    for (const k of keys) {
      const v = (obj as Record<string, unknown>)[k]
      if (typeof v === 'number') out[k] = v
      else if (v != null && !isNaN(Number(v))) out[k] = Number(v)
    }
  }
  return out
}

// 레벨별 선택지 수. **문항이 아니라 레벨이 정한다** — 레벨1~4 4지선다, 레벨5~7 5지선다.
// 2026-08-05 DB 실측에서 예외 0건(그때 기준 Lv.1~3 232문항 전부 4개 / Lv.4~7 281문항 전부 5개).
// 2026-08-27 사다리 밀기로 경계가 Lv.3/4 → Lv.4/5 로 옮겨졌다 — 문항이 가진 보기 개수를 따라간 것이다.
//   옛 L3(4지선다) 문항이 L4 로 올라갔으므로 경계를 그대로 두면 L4 시험에 보기가 하나 빈 채로 나간다.
// ⚠️ 프론트 src/lib/scoring.ts 의 OPTIONS_BY_LEVEL 과 항상 같이 고칠 것.
// 이제 DB 도 실제로 4개다 — 옛 5지선다 시절 5번째 보기는 6개 언어 전부에서 제거했고,
// 정답이 5번이던 문항은 그 전에 1~4번으로 스왑했다
// (migrations/20260804120000_leveltest_l1_l3_drop_fifth_option.sql).
// 그래서 아래 slice 는 이제 사실상 no-op 이고, 옛 데이터·수동 입력에 대한 안전망으로만 남는다.
// 새로 넣는 것도 admin-test 의 upsert 검증이 보기 4개·정답 1~4번을 강제한다.
// (이 컷은 채점에 영향 없음: 채점은 correct_index 로만 함)
export const VISIBLE_OPTIONS_BY_LEVEL: Record<number, number> = { 1: 4, 2: 4, 3: 4, 4: 4, 5: 5, 6: 5, 7: 5 }
export function projOptionsForLevel(i18n: unknown, lang: string, level: number): string[] {
  const opts = projOptions(i18n, lang)
  const cap = VISIBLE_OPTIONS_BY_LEVEL[level]
  return typeof cap === 'number' ? opts.slice(0, cap) : opts
}

// 테스트 전용 계정: 3일 쿨다운 면제
const COOLDOWN_EXEMPT = ['ahnhyeongjun0111@gmail.com']
export function isCooldownExempt(email: string | null | undefined): boolean {
  return !!email && COOLDOWN_EXEMPT.includes(email.toLowerCase())
}

// 관리자 판별: 루트(ROOT_ADMIN) 또는 admin_users 테이블 등록 이메일.
const ROOT_ADMIN = (Deno.env.get('ROOT_ADMIN') ?? 'airobotassn@gmail.com').trim().toLowerCase()
export async function isAdminUser(
  admin: SupabaseClient,
  user: User | null,
): Promise<boolean> {
  const email = (user?.email ?? '').trim().toLowerCase()
  if (!email || user?.is_anonymous) return false
  if (email === ROOT_ADMIN) return true
  const { data } = await admin.from('admin_users').select('email').eq('email', email).maybeSingle()
  return !!data
}

export async function hasRecentSubmission(
  admin: SupabaseClient,
  userId: string,
  excludeAttemptId?: string,
): Promise<boolean> {
  const since = new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString()
  let q = admin
    .from('test_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'submitted')
    .gte('submitted_at', since)
  if (excludeAttemptId) q = q.neq('id', excludeAttemptId)
  const { count } = await q
  return (count ?? 0) > 0
}

// ----- 현재 등급 읽기 -----
export async function getRank(admin: SupabaseClient, userId: string): Promise<number> {
  const { data } = await admin
    .from('user_progress')
    .select('rank')
    .eq('user_id', userId)
    .maybeSingle()
  return (data?.rank as number) ?? MIN_LEVEL
}

// 6축 평균 레이팅(0~100). 랭킹 정렬용으로 user_level_skill.rating 컬럼에 저장(읽을 때 매번 평균내지 않게).
export function avgRating(ratings: AxisMap, keys: string[]): number {
  if (!keys.length) return 0
  let sum = 0
  for (const k of keys) sum += Math.max(0, Math.min(100, ratings[k] ?? 0))
  return Math.round((sum / keys.length) * 100) / 100
}

// ----- 레이팅 적용 (멱등성은 호출부의 applied 가드로 보장) -----
// 이번 시험 축별 perf 를 그 레벨 누적(user_level_skill)에 EWMA 반영 + 등급(user_progress) 이동.
export async function applyAttempt(
  admin: SupabaseClient,
  userId: string,
  level: number,
  perf: AxisMap,
  totalCorrect: number,
  // 실제 출제 문항 수. 승급컷이 비율이라 이 값이 판정 분모가 된다(생략 시 레벨 기준값).
  totalQuestions: number = questionsForLevel(level),
): Promise<{
  ratings: AxisMap
  deltas: AxisMap
  rankBefore: number
  rankAfter: number
  rankDir: RankDir
  points: number
  skillScore: number
}> {
  const keys = axisKeysForLevel(level)

  // 그 레벨 누적 레이팅
  const { data: row } = await admin
    .from('user_level_skill')
    .select('*')
    .eq('user_id', userId)
    .eq('level', level)
    .maybeSingle()
  const prev = toAxisMap(row?.ratings, keys)
  const placedBefore = (row?.placed as boolean) ?? false

  const ratings = emptyAxis(keys)
  const deltas = emptyAxis(keys)
  for (const k of keys) {
    // 이번 시험에 출제된 축만 EWMA 갱신. 안 나온 축은 누적 유지(0으로 깎지 않음).
    if (Object.prototype.hasOwnProperty.call(perf, k)) {
      const next = updateAxis(prev[k], perf[k], placedBefore)
      ratings[k] = Math.round(next * 100) / 100
      deltas[k] = Math.round((next - prev[k]) * 100) / 100
    } else {
      ratings[k] = Math.round(prev[k] * 100) / 100
      deltas[k] = 0
    }
  }
  await admin.from('user_level_skill').upsert(
    {
      user_id: userId,
      level,
      ratings,
      rating: avgRating(ratings, keys),
      attempts_count: ((row?.attempts_count as number) ?? 0) + 1,
      placed: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,level' },
  )

  // 등급(레벨) 이동 (승급 또는 유지 — 강등 없음)
  const { data: prog } = await admin
    .from('user_progress')
    .select('rank, skill_score')
    .eq('user_id', userId)
    .maybeSingle()
  const rankBefore = (prog?.rank as number) ?? MIN_LEVEL
  const { nextRank, dir } = computeRankChange(rankBefore, level, totalCorrect, totalQuestions)

  // 랭킹 점수 = 새 등급 + 그 레벨 '최신' 맞힌 수. (이번 응시가 그 레벨이면 이번 값, 아니면 DB 최신)
  let latestCorrect = 0
  if (nextRank === level) {
    latestCorrect = totalCorrect
  } else {
    const { data: la } = await admin
      .from('test_attempts')
      .select('total_correct')
      .eq('user_id', userId)
      .eq('level', nextRank)
      .eq('status', 'submitted')
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    latestCorrect = (la?.total_correct as number) ?? 0
  }
  const points = computePoints(nextRank, latestCorrect)
  // 실력점수(skill_score) — 레벨테스트 전용 트랙(활동점수와 별개). 클리어한 레벨 수 × LEVELTEST_CLEAR_POINTS(1,000).
  //  · 사다리가 순차(1회 응시 = 최대 +1등급)라 클리어 수 = 도달 등급 − 1 이다.
  //  · 예외는 천장뿐 — 이미 Lv.7 인 사람이 Lv.7 을 통과하면 등급은 그대로지만 클리어 수는 7이 되어 7,000 만점.
  //    (Lv.7 미만이 Lv.7 시험을 통과해도 승급은 +1 이라 여기 해당 없음 → rankBefore 조건이 필수)
  //  · 최고성취만 유지(GREATEST, 낮아지지 않음) — 부분점수는 없다(컷 미달 = 0).
  const clearedTop =
    rankBefore >= MAX_LEVEL && level >= MAX_LEVEL && totalCorrect >= promoteCut(level, totalQuestions)
  const skillScore = Math.max(
    (prog?.skill_score as number) ?? 0,
    computeSkillScore(clearedTop ? MAX_LEVEL : nextRank - 1),
  )

  // demotion_strikes 컬럼은 강등 제거로 vestigial — 읽지도 쓰지도 않는다(default 0 유지).
  await admin.from('user_progress').upsert(
    {
      user_id: userId,
      rank: nextRank,
      points,
      skill_score: skillScore,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )

  // 레벨 최초 도달마다 쿠폰 1장 발급(side-effect, 채점 공식 아님).
  // 유니크(user_id,issued_for_level) 라 같은 레벨 재도달은 무발급 → 최초 도달 1회만.
  if (nextRank > rankBefore) {
    await admin
      .from('user_coupons')
      .upsert(
        { user_id: userId, issued_for_level: nextRank, coupon_code: 'LEVELUP10' },
        { onConflict: 'user_id,issued_for_level', ignoreDuplicates: true },
      )
  }

  return {
    ratings,
    deltas,
    rankBefore,
    rankAfter: nextRank,
    rankDir: dir,
    points,
    skillScore,
  }
}

// 멱등 가드: applied=false → true 로 원자적으로 뒤집고, 실제로 뒤집은 경우만 true.
export async function claimApply(admin: SupabaseClient, attemptId: string): Promise<boolean> {
  const { data } = await admin
    .from('test_attempts')
    .update({ applied: true })
    .eq('id', attemptId)
    .eq('applied', false)
    .select('id')
  return !!(data && data.length > 0)
}

// ----- 응답 빌더 -----
export function lockedResult(
  attempt: {
    id: string
    level: number
    total_correct: number
    total_questions: number
    claim_token?: string | null
  },
  includeClaimToken: boolean,
) {
  return {
    attemptId: attempt.id,
    level: attempt.level,
    totalCorrect: attempt.total_correct,
    totalQuestions: attempt.total_questions,
    locked: true,
    rating: null,
    deltas: null,
    placed: null,
    rankBefore: null,
    rankAfter: null,
    rankDir: null,
    answers: [],
    claimToken: includeClaimToken ? attempt.claim_token ?? null : null,
  }
}

// 영구유저 전체 결과: (그 시험 시점) 그 레벨 누적 레이팅 스냅샷 + 변동 + 등급변동 + 해설(응시 언어)
export async function fullResult(
  admin: SupabaseClient,
  attempt: {
    id: string
    user_id: string
    level: number
    lang?: string | null
    total_correct: number
    total_questions: number
    deltas: unknown
    axis_perf?: unknown
    submitted_at?: string | null
    rating_after?: unknown
    rank_before?: number | null
    rank_after?: number | null
    rank_dir?: string | null
  },
) {
  const keys = axisKeysForLevel(attempt.level)

  let ratings: AxisMap
  let placed: boolean
  if (attempt.rating_after) {
    ratings = toAxisMap(attempt.rating_after, keys)
    placed = true
  } else {
    const { data: skill } = await admin
      .from('user_level_skill')
      .select('*')
      .eq('user_id', attempt.user_id)
      .eq('level', attempt.level)
      .maybeSingle()
    ratings = toAxisMap(skill?.ratings, keys)
    placed = (skill?.placed as boolean) ?? false
  }

  const rankAfter = attempt.rank_after ?? (await getRank(admin, attempt.user_id))
  const rankBefore = attempt.rank_before ?? rankAfter
  // 강등 제거 전 기록엔 rank_dir='down' 이 남아있다 → 'stay' 로 접어서 옛 결과창에도 강등이 안 보이게 한다.
  const rankDir: RankDir = attempt.rank_dir === 'up' ? 'up' : 'stay'

  // 직전 "동레벨" 시험의 per-test 축 성적(레이더 음영용). 없으면 null.
  let prevPerf: AxisMap | null = null
  {
    let q = admin
      .from('test_attempts')
      .select('axis_perf, submitted_at')
      .eq('user_id', attempt.user_id)
      .eq('level', attempt.level)
      .eq('status', 'submitted')
      .neq('id', attempt.id)
      .not('axis_perf', 'is', null)
      .order('submitted_at', { ascending: false })
      .limit(1)
    if (attempt.submitted_at) q = q.lt('submitted_at', attempt.submitted_at)
    const { data: prevRows } = await q
    const prev = prevRows?.[0]?.axis_perf
    if (prev) prevPerf = toAxisMap(prev, keys)
  }

  // ⛔ 문항별 오답노트(본문·보기·해설)는 **안 만든다**. 결과창에서 그 목록이 제거됐는데
  //    (Result.tsx 의 '오답노트는 제거됐다' 주석) 서버만 계속 만들어 보내고 있었다 —
  //    문항마다 prompt_i18n·options_i18n·explanation_i18n 을 6개국어로 조회해 응시 언어로
  //    투영한 뒤, 화면이 통째로 버렸다. 시험 한 번에 두 번(제출 직후 + 결과 재조회) 돌던 조회다.
  //    되살릴 땐 화면부터 만들 것 — 쓰는 데가 없으면 다시 같은 상태가 된다.

  return {
    attemptId: attempt.id,
    level: attempt.level,
    totalCorrect: attempt.total_correct,
    totalQuestions: attempt.total_questions,
    locked: false,
    rating: ratings,
    perf: attempt.axis_perf ? toAxisMap(attempt.axis_perf, keys) : null,
    prevPerf,
    deltas: attempt.deltas ? toAxisMap(attempt.deltas, keys) : emptyAxis(keys),
    placed,
    rankBefore,
    rankAfter,
    rankDir,
  }
}
