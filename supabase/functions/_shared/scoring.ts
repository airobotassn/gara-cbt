// _shared/scoring.ts — CARIS ARENA 스코어링/레벨 엔진 (Deno).
// ⚠️ 프론트 src/lib/scoring.ts 의 <scoring-sync> 영역과 항상 같이 고칠 것.
// 인증·클라이언트·다국어(pick/proj) 헬퍼는 ./lib.ts 를 재수출한다(CARIS ARENA 함수는 이 파일만 import).
import { type SupabaseClient, type User } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { pickLang, projText, projOptions } from './lib.ts'
export * from './lib.ts'

// ----- 공통 상수 -----
export const QUESTIONS_PER_TEST = 20
export const COOLDOWN_DAYS = 3
export const ATTEMPT_TTL_MINUTES = 120
export const MIN_LEVEL = 1
export const MAX_LEVEL = 7

// 층화추출: 6축 × 3 + 랜덤 2축 +1 = 20
export const BASE_PER_AXIS = 3
export const EXTRA_AXES = 2

// ----- 레벨별 6축 코드 (categories.ts 와 동일하게 유지!) -----
export const LEVEL_AXES: Record<number, string[]> = {
  // 1: 2026-07 사다리 한 칸 밀기로 신설된 레벨 — 6축 미정(비워둠). categories.ts 와 같이 채울 것.
  2: ['l2_principle', 'l2_security', 'l2_ethics', 'l2_responsibility', 'l2_llm_eco', 'l2_prompt'],
  3: ['l3_genai', 'l3_api', 'l3_algo', 'l3_sensor', 'l3_block', 'l3_python'],
  4: ['l4_rag', 'l4_llm_ctrl', 'l4_vision_eval', 'l4_vision_data', 'l4_c_basic', 'l4_c_adv'],
  5: ['l5_preproc', 'l5_stm32', 'l5_ros2', 'l5_plc', 'l5_sim', 'l5_smartfactory'],
  6: ['l6_reasoning', 'l6_edge', 'l6_iiot', 'l6_dtwin', 'l6_sysopt', 'l6_ros2'],
  // L7 = 임시(더미). categories.ts 와 동일하게 유지.
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
const DEMOTE_SEED = 85 // 강등 시 내려간 레벨을 이 점수로 시드(롤식: 하위 티어 상단에서 시작)

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
// 승급컷: 레벨1~3 = 16, 레벨4~7 = 18. 강등: 4개 이하 연속 3번(앞 2번 경고). Lv.1 강등 없음.
export function promoteCut(level: number): number {
  return level <= 3 ? 16 : 18
}
export const DEMOTE_MAX = 4
export const DEMOTE_STRIKES = 3
export type RankDir = 'up' | 'down' | 'stay'
export interface RankChange {
  nextRank: number
  dir: RankDir
  nextStrikes: number
  warned: boolean
}
export function computeRankChange(
  currentRank: number,
  testLevel: number,
  correct: number,
  strikes: number,
): RankChange {
  if (testLevel >= currentRank && correct >= promoteCut(testLevel)) {
    const next = Math.min(MAX_LEVEL, currentRank + 1)
    return { nextRank: next, dir: next > currentRank ? 'up' : 'stay', nextStrikes: 0, warned: false }
  }
  if (testLevel <= currentRank && correct <= DEMOTE_MAX && currentRank > MIN_LEVEL) {
    const s = strikes + 1
    if (s >= DEMOTE_STRIKES) {
      return { nextRank: currentRank - 1, dir: 'down', nextStrikes: 0, warned: false }
    }
    return { nextRank: currentRank, dir: 'stay', nextStrikes: s, warned: true }
  }
  return { nextRank: currentRank, dir: 'stay', nextStrikes: 0, warned: false }
}

// 랭킹 점수(0~10000) — 레벨당 1/MAX_LEVEL, 레벨 내부는 승급컷 정규화.
export const MAX_POINTS = 10000
/** @deprecated skill_score/computeSkillScore 로 전환 예정. 보존 사유는 FE 폴백이 아니라 백엔드
 *  applyAttempt() 가 여전히 이 값으로 points 컬럼을 채우기 때문(아래 computePoints(nextRank, latestCorrect)
 *  호출부 참조) — points 컬럼(및 이를 읽는 구코드)이 남아있는 동안은 계속 이 값을 반환해야 함 — 삭제 금지. */
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
//   가정(assumption, 튜닝 필요시 갱신): 시즌 ≈ 60일, 활성 미니게임 2종(src/lib/minigames.ts 기준).
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

// 레벨별 노출 선택지 수 상한. 레벨1만 4지선다(5번째 선택지 숨김), 그 외는 제한 없음.
// ⚠️ 정답이 잘리면 안 됨 → 레벨1은 정답=5번(correct_index 4) 문항을 비활성화해 둠.
//    (이 표시 컷은 채점에 영향 없음: 채점은 correct_index 로만 함)
export const VISIBLE_OPTIONS_BY_LEVEL: Record<number, number> = { 1: 4 }
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
): Promise<{
  ratings: AxisMap
  deltas: AxisMap
  rankBefore: number
  rankAfter: number
  rankDir: RankDir
  points: number
  skillScore: number
  demotionStrikes: number // 갱신된 경고 누적
  warned: boolean // 이번에 강등 경고가 떴는가
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

  // 등급(레벨) 이동 + 강등 경고(3진 아웃)
  const { data: prog } = await admin
    .from('user_progress')
    .select('rank, demotion_strikes, skill_score')
    .eq('user_id', userId)
    .maybeSingle()
  const rankBefore = (prog?.rank as number) ?? MIN_LEVEL
  const strikesBefore = (prog?.demotion_strikes as number) ?? 0
  const { nextRank, dir, nextStrikes, warned } = computeRankChange(
    rankBefore,
    level,
    totalCorrect,
    strikesBefore,
  )

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
  // 실력점수(skill_score) — 레벨테스트 전용 트랙(활동점수와 별개). 최고성취만 유지(GREATEST, 강등으로 낮아지지 않음).
  const skillScore = Math.max((prog?.skill_score as number) ?? 0, computeSkillScore(nextRank, latestCorrect))

  await admin.from('user_progress').upsert(
    {
      user_id: userId,
      rank: nextRank,
      demotion_strikes: nextStrikes,
      points,
      skill_score: skillScore,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )

  // 레벨 최초 도달마다 쿠폰 1장 발급(side-effect, 채점 공식 아님).
  // 강등 후 재승급은 유니크(user_id,issued_for_level) 충돌로 무발급 → 최초 도달 1회만.
  if (nextRank > rankBefore) {
    await admin
      .from('user_coupons')
      .upsert(
        { user_id: userId, issued_for_level: nextRank, coupon_code: 'LEVELUP10' },
        { onConflict: 'user_id,issued_for_level', ignoreDuplicates: true },
      )
  }

  // 강등이면: 내려간 레벨을 그 티어 상단(DEMOTE_SEED)으로 시드 — 위에서 내려온 값이라 0이 아닌 높은 데서 시작(롤식).
  if (dir === 'down') {
    const lkeys = axisKeysForLevel(nextRank)
    const seeded: AxisMap = {}
    for (const k of lkeys) seeded[k] = DEMOTE_SEED
    await admin.from('user_level_skill').upsert(
      { user_id: userId, level: nextRank, ratings: seeded, rating: avgRating(seeded, lkeys), placed: true, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,level' },
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
    demotionStrikes: nextStrikes,
    warned,
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
    warnStrikes: 0,
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
    warn_strikes?: number | null
  },
) {
  const keys = axisKeysForLevel(attempt.level)
  const lang = pickLang(attempt.lang)

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
  const rankDir = (attempt.rank_dir as RankDir) ?? 'stay'

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

  // 해설/오답 (응시 언어로 투영)
  const { data: rows } = await admin
    .from('test_answers')
    .select(
      'question_id, category, selected_index, is_correct, test_questions(code, prompt_i18n, options_i18n, explanation_i18n, correct_index)',
    )
    .eq('attempt_id', attempt.id)
  // 비활성·삭제된 문항도 과거 결과창엔 내용 그대로 보인다(행 보존). 차이는 통계/출제뿐.
  const answers = (rows ?? []).map((r: any) => ({
    questionId: r.question_id,
    code: r.test_questions?.code ?? null,
    category: r.category,
    prompt: projText(r.test_questions?.prompt_i18n, lang),
    options: projOptionsForLevel(r.test_questions?.options_i18n, lang, attempt.level),
    selectedIndex: r.selected_index,
    correctIndex: r.test_questions?.correct_index ?? -1,
    isCorrect: r.is_correct,
    explanation: projText(r.test_questions?.explanation_i18n, lang),
  }))

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
    warnStrikes: attempt.warn_strikes ?? 0, // 0 = 경고 없음, 1~2 = 강등 경고 N/3
    answers,
  }
}
