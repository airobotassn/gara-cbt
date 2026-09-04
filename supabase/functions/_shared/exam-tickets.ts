// 응시권(exam_tickets) 공용 헬퍼 — "결제했다"와 "응시했다" 사이를 담는 유일한 행을 다룬다.
//   payments(주문·승인) · payments-webhook · start-exam(응시 게이트) · my-attempts(구매자 화면) ·
//   admin(수기 발급·회수)이 **같은 코드**를 쓴다. 판정이 함수마다 갈리면 한쪽에서만 뚫린다.
//
// 이 파일이 지키는 5가지(전부 검증에서 실제로 뚫렸던 자리다):
//   ① 판매 가능 판정과 금액은 **DB 값으로만** 정한다 — 클라가 보낸 문자열은 조회 키로만 쓰고 저장하지 않는다
//   ② 폴백 금액을 절대 지어내지 않는다 — exam_fees 에 **행이 없으면** 판매 자체를 막는다
//      ⚠️ **'행이 없다(미설정)'와 '0으로 저장했다(무료)'는 다른 말이다**(2026-08-25). 예전엔 둘 다 0으로
//         뭉뚱그려 판매 불가였는데, 그러면 무료 시험을 열 방법이 아예 없다. 지금은 lookupExamFee 가
//         미설정을 **null** 로 돌려주고 0 은 "관리자가 무료로 정했다"는 뜻이다(관리자 화면이 확인을 한 번 받는다).
//         이 구분이 무너지면(미설정이 다시 0이 되면) **오타 한 번이 무제한 무료 응시권**이 된다 — 그게 원래 이유였다.
//   ③ **상시(rolling) 회차는 2026-09-04 에 없어졌다** — 되살리지 말 것. 회차 행이 안 바뀌어
//      product_ref 가 영구 고정이라 계정당 평생 1회만 결제되고, exam_date 가 없어 응시창·만료 근거도 없다
//   ④ 시간 판정은 전부 KST — exam_date 는 bare date 라 new Date() 와 그냥 비교하면 9시간 어긋난다
//   ⑤ 소진(consume)은 **소유자 술어를 포함한** 조건부 UPDATE 한 문장 — 빠지면 남의 응시권이 소진된다
//
// ⚠️ supabase-js 버전 핀은 _shared/lib.ts·payments.ts 와 **같아야** 한다. 다르면 Deno 가 모듈을 두 벌 받아
//    adminClient() 가 준 클라이언트와 여기 타입이 서로 안 맞는다.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { projText } from './lib.ts'

// ---------- 행 모양 ----------

export type ExamTicketStatus = 'issued' | 'consumed' | 'void' | 'expired'
export type ExamTicketSource = 'pg' | 'admin' | 'free'

export interface ExamTicketRow {
  id: string
  user_id: string
  round_id: string
  tier: string
  status: ExamTicketStatus
  source: ExamTicketSource
  payment_id: string | null
  price_paid: number
  granted_by: string | null
  note: string | null
  expires_at: string | null
  issued_at: string
  consumed_at: string | null
  voided_at: string | null
  void_reason: string | null
  // ⚠️ created_at 은 2026-09-04 에 뺐다 — issued_at 과 값이 늘 같았고(둘 다 now() 로 같이 찍혔다)
  //    읽는 코드는 issued_at 쪽뿐이었다(목록 정렬 · 화면의 '발급일' · API 의 issuedAt).
}

/** 응시권 select 컬럼 — 한 곳에 모아 함수마다 어긋나는 걸 막는다(PAYMENT_COLS 와 같은 관례). */
export const EXAM_TICKET_COLS =
  'id, user_id, round_id, tier, status, source, payment_id, price_paid, granted_by, note, expires_at, issued_at, consumed_at, voided_at, void_reason'

/** '살아있는' 응시권 = 슬롯을 차지하는 상태. exam_tickets_live_uniq 의 부분 조건과 **반드시 같아야** 한다. */
export const LIVE_TICKET_STATUSES: ExamTicketStatus[] = ['issued', 'consumed']

export interface ExamRoundRow {
  id: string
  title_i18n: Record<string, string> | null
  exam_date: string | null
  apply_start_at: string | null
  apply_end_at: string | null
  exam_start_at: string | null
  exam_end_at: string | null
  published: boolean
  open_tiers: string[] | null
}

/** 회차 select 컬럼. ⚠️ exam_start_at·exam_end_at·open_tiers 는 20260807090000 마이그레이션이 만든다. */
export const EXAM_ROUND_COLS =
  'id, title_i18n, exam_date, apply_start_at, apply_end_at, exam_start_at, exam_end_at, published, open_tiers'

/** 티어 key → 표시명. 브랜드 고유명이라 **언어 무관 고정**이고, 그래서 서버에 복제해도 번역 동기화 부담이 없다.
 *  단일 출처는 src/lib/caris.ts 의 T1_TIERS/T2_TIERS — 거기에 티어를 추가하면 여기와 exam_tiers 시드도 같이 채울 것.
 *  (Deno 는 src/ 를 못 읽는다. 이 지도를 안 두면 결제창·카드 명세서에 'grandmaster' 같은 내부 키가 찍힌다.) */
export const TIER_LABEL: Record<string, string> = {
  beginner: 'Beginner',
  pro: 'Pro',
  elite: 'Elite',
  master: 'Master',
  grandmaster: 'Grand Master',
  zenith: 'Zenith',
}

/** 급수의 표시 순서. 옛 `exam_tiers.sort` 를 대신한다(20260904210000 이 그 컬럼을 드롭했다) —
 *  칭호를 사용자가 고르게 되면서 DB 가 급수를 줄 세울 이유가 없어졌고, 남은 용도는 관리자 화면의
 *  표시 순서 하나뿐이라 이름·잠금과 같은 자리(코드)에 두는 게 맞다.
 *  ⚠️ TIER_LABEL 과 같은 목록이어야 한다 — 빠진 급수는 정렬에서 맨 뒤로 밀린다. */
export const TIER_ORDER: readonly string[] = ['beginner', 'pro', 'elite', 'master', 'grandmaster', 'zenith']
export const tierRank = (key: string) => {
  const i = TIER_ORDER.indexOf(key)
  return i < 0 ? TIER_ORDER.length : i
}

// ---------- 합격선 ----------
//
// ⛔ **판정은 응시 시점 값(exam_attempts.pass_ratio_snapshot)으로 한다.** 급수별 합격선은
//    exam_tiers.pass_ratio 에 있지만 그건 **앞으로의 응시**에 쓰는 값이고, 이미 친 시험의 합격 여부는
//    start-exam 이 박아둔 스냅샷이 정한다. 지금 설정을 끌어다 쓰면 관리자가 합격선을 한 칸 올리는 순간
//    **어제 합격한 사람이 오늘 불합격**이 되고, 자격증은 이미 나가 있다.
// ⚠️ 스냅샷이 빈 옛 응시는 0.6 이다 — 그때는 그 값이 유일한 규칙이었다.
export const DEFAULT_PASS_RATIO = 0.6

/**
 * 합격 최소 정답 수. **판정하는 모든 자리가 이 함수를 부른다**(admin·my-attempts·payments·프론트 결과창).
 *
 * ⛔ `Math.ceil(total * ratio)` 를 직접 쓰지 말 것 — 이진 부동소수 오차로 한 문제가 더 붙는다.
 *    실측: `Math.ceil(100 * 0.55)` = **56**(정답은 55). 그런데 SQL 은 numeric 이라 `ceil(100 * 0.55)` = 55 다
 *    → 같은 응시를 두고 `user_titles`(SQL)는 합격, `my-attempts`(JS)는 불합격이라고 말한다.
 *    0.55 는 관리자 화면이 예시로 적어 둔 바로 그 값이다.
 */
export function passMark(totalQuestions: number, ratio: number): number {
  // 1e-6 자리에서 한 번 접어 오차만 걷어낸다(0.1% 단위 합격선까지 안전 — 컬럼이 numeric(4,3) 이다).
  return Math.ceil(Math.round(totalQuestions * ratio * 1e6) / 1e6)
}

/** 이 응시가 합격인가. 점수가 아직 없으면 null(판정 자체가 없다 — false 로 접지 말 것). */
export function attemptPassed(
  totalCorrect: number | null | undefined,
  totalQuestions: number | null | undefined,
  snapshot: number | null | undefined,
): boolean | null {
  if (totalCorrect == null || !totalQuestions) return null
  return totalCorrect >= passMark(totalQuestions, snapshot ?? DEFAULT_PASS_RATIO)
}

/** 지금 이 급수로 시험을 시작하면 박힐 합격선. start-exam 만 부른다. */
export async function tierPassRatio(admin: SupabaseClient, tier: string): Promise<number> {
  const { data } = await admin
    .from('exam_tiers')
    .select('pass_ratio')
    .eq('tier', String(tier ?? '').trim().toLowerCase())
    .maybeSingle()
  const raw = data?.pass_ratio
  const n = Number(raw)
  // 0 은 "전부 합격" 이라 합격선으로 성립하지 않는다 — 미설정과 같이 기본값으로 접는다.
  return raw != null && Number.isFinite(n) && n > 0 && n <= 1 ? n : DEFAULT_PASS_RATIO
}

/** 아직 열지 않은 급수(CARIS-Ⅱ 전부). 관리자가 **새로 여는 것**만 막는다 — 회차의 '열리는 급수' 체크와
 *  응시료 입력. 화면 짝은 src/lib/caris.ts 의 LOCKED_TIERS 이고, 여기가 그 최종 게이트다
 *  (화면 disabled 만으로는 요청을 직접 쏘면 그대로 통과한다).
 *  ⚠️ 이미 열려 있는 (회차×급수)는 여기서 손대지 않는다 — 판정 기준은 "그 회차의 exams 행이 살아 있나"다. */
export const LOCKED_TIERS: readonly string[] = ['master', 'grandmaster', 'zenith']
export const isTierLocked = (key: string) => LOCKED_TIERS.includes(key)

// ---------- product_ref 규약 ----------
//   product_ref = "<round_id>:<tier>"   예) "3f2a91c8-5d10-4e77-9b03-0c1e8a4f6d22:pro"
// 구분자가 ':' 하나인 이유 = UUID 에도 티어 key 에도 ':' 가 없어 indexOf 2조각 분해가 항상 성립한다.
// 이 문자열이 payments_paid_product_uniq(user_id, product_type, product_ref) 의 비교 대상이라
// **표기가 흔들리면 중복결제 방어가 통째로 무력화된다** → 저장하는 값은 반드시 buildExamRef(DB 값)로 만든다.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function buildExamRef(roundId: string, tier: string): string {
  return `${roundId}:${tier}`
}

/** 조회 키로 쓸 (roundId, tier) 분해. 여기서 소문자로 접는 건 **조회용**이다 —
 *  저장용 ref 는 resolveExamOffer 가 DB 에서 읽은 값으로 다시 만든다(대소문자 표기 차이 차단). */
export function parseExamRef(ref: unknown): { roundId: string; tier: string } | null {
  const s = String(ref ?? '').trim()
  const i = s.indexOf(':')
  if (i <= 0) return null
  const roundId = s.slice(0, i).trim().toLowerCase()
  const tier = s.slice(i + 1).trim().toLowerCase()
  if (!UUID_RE.test(roundId)) return null
  if (!tier || !/^[a-z]+$/.test(tier)) return null
  return { roundId, tier }
}

// ---------- 시간 판정 (전부 KST) ----------

/** 한국은 서머타임이 없어 +09:00 이 상수다. 그래서 Intl 없이 문자열로 붙여도 정확하다. */
const KST_OFFSET = '+09:00'

function parseAt(iso: string | null): number {
  if (!iso) return NaN
  const t = Date.parse(iso)
  return Number.isNaN(t) ? NaN : t
}

/** bare date('YYYY-MM-DD') → 그 날의 KST 00:00 / 23:59:59.999 순간.
 *  ⚠️ `${ymd}T00:00:00` 처럼 오프셋 없이 붙이면 UTC 로 해석돼 9시간 어긋난다(H20). */
function kstDayRange(ymd: string): { start: number; end: number } | null {
  const start = Date.parse(`${ymd}T00:00:00.000${KST_OFFSET}`)
  const end = Date.parse(`${ymd}T23:59:59.999${KST_OFFSET}`)
  return Number.isNaN(start) || Number.isNaN(end) ? null : { start, end }
}

/**
 * 접수(결제) 창이 열려 있는가.
 * 지금까지 이 판정이 프론트 src/lib/rounds.ts 에만 있어서 curl 로 마감 회차를 결제할 수 있었다.
 *
 * ⚠️ 접수기간 미설정은 false. "미설정 = 무제한 판매"로 열면 관리자가 날짜를 안 넣은 회차가 곧 상시 판매가 된다.
 */
export function applyWindowOpen(round: ExamRoundRow, at: number = Date.now()): boolean {
  const s = parseAt(round.apply_start_at)
  const e = parseAt(round.apply_end_at)
  if (Number.isNaN(s) && Number.isNaN(e)) return false
  if (!Number.isNaN(s) && at < s) return false
  if (!Number.isNaN(e) && at > e) return false
  return true
}

/**
 * 응시 창(시험을 실제로 볼 수 있는 구간).
 * 결정 D1: 정기시험은 월 3구간(1–10 접수 / 11–20 시험 / 21–말일 채점)이라 "시험일 하루"가 아니라 10일 창이다.
 * 정본은 exam_rounds.exam_start_at·exam_end_at 두 컬럼이고, 회차마다 다를 수 있어 상수로 박지 않는다.
 *
 * 두 컬럼이 비어 있으면 exam_date 하루(KST)로 접는다 — 마이그레이션 백필이 채우므로 정상 경로에선 안 쓰이지만,
 * 관리자가 새 회차를 만들며 응시창을 비워둔 경우에 판정 불가로 응시가 통째로 막히는 것보다 낫다.
 */
export function examWindow(round: ExamRoundRow): { start: number; end: number } | null {
  const s = parseAt(round.exam_start_at)
  const e = parseAt(round.exam_end_at)
  if (!Number.isNaN(s) && !Number.isNaN(e)) return { start: s, end: e }
  if (round.exam_date) return kstDayRange(round.exam_date)
  return null
}

/** 'before'(아직 시험 기간 전) | 'open' | 'closed' | 'unknown'(일정 미설정).
 *  사유 코드가 필요한 화면(my-attempts 의 usableReason)이 있어 boolean 이 아니라 상태로 돌려준다. */
export function examWindowState(
  round: ExamRoundRow,
  at: number = Date.now(),
): 'before' | 'open' | 'closed' | 'unknown' {
  const w = examWindow(round)
  if (!w) return 'unknown'
  if (at < w.start) return 'before'
  if (at > w.end) return 'closed'
  return 'open'
}

export function examWindowOpen(round: ExamRoundRow, at: number = Date.now()): boolean {
  return examWindowState(round, at) === 'open'
}

/** 이 응시권이 만료됐는가(조회 시점 lazy 판정 · 크론 만들지 말 것).
 *  expires_at 이 있으면 그게 우선(수기 발급 override), 없으면 회차의 응시창 종료가 만료를 정한다.
 *  ⚠️ 응시창 판정이 불가(unknown)면 만료로 접지 않는다 — 일정 미설정 때문에 산 응시권을 죽이면 안 된다. */
export function ticketExpired(ticket: ExamTicketRow, round: ExamRoundRow | null, at: number = Date.now()): boolean {
  const own = parseAt(ticket.expires_at)
  if (!Number.isNaN(own)) return at > own
  if (!round) return false
  const w = examWindow(round)
  return w ? at > w.end : false
}

// ---------- 판매 가능 판정 ----------

/**
 * (트랙 × 급수) → 정가(달러 센트). **정가 단일 소스 = exam_fees** 이고 키 규칙 `${track}_${tier}` 는
 * src/lib/fees.ts 의 feeKey() 와 같은 규칙이다.
 *
 * ⛔ **null 과 0 은 다른 말이다.**
 *    · `null` = 행이 없거나 값이 비었다 = **아직 금액을 안 정했다** → 호출부가 판매 불가(`no_fee`)로 접는다.
 *    · `0`    = 관리자가 **무료로 정했다** → 결제창을 타지 않고 응시권을 그 자리에서 준다.
 *    예전엔 미설정도 0으로 돌려줘서 둘을 구분할 수 없었고, 그래서 "0이면 무조건 판매 불가"가 유일한
 *    안전판이었다(오타 한 번 = 무제한 무료 응시권). 이 함수가 null 을 잃는 순간 그 위험이 그대로 돌아온다 —
 *    `?? 0` 같은 걸 여기든 호출부든 넣지 말 것.
 * ⚠️ 폴백 금액을 지어내는 코드도 마찬가지다. 돈 받는 값이라 폴백이 곧 사고다.
 */
export async function lookupExamFee(
  admin: SupabaseClient,
  track: string,
  tier: string,
): Promise<number | null> {
  // 정가는 **달러 센트**다(2026-08-13 전환). 옛 amount(원화 정수)는 읽지 않는다.
  const { data } = await admin
    .from('exam_fees')
    .select('amount_usd_cents')
    .eq('key', `${track}_${tier}`)
    .maybeSingle()
  const raw = data?.amount_usd_cents
  if (raw === null || raw === undefined) return null // 행 없음 / 컬럼 null = 미설정
  const amount = Math.floor(Number(raw))
  // 숫자가 아닌 값이 들어있다 = 정가를 못 읽었다. 0(무료)으로 접으면 조용히 공짜가 되므로 미설정으로 본다.
  return Number.isFinite(amount) && amount >= 0 ? amount : null
}

export type ExamFeeErrorCode = 'tier_unknown' | 'no_fee'

export type ExamFeeResult =
  | { ok: true; tier: string; track: string; amount: number }
  | { ok: false; code: ExamFeeErrorCode; error: string; status: number }

/**
 * 급수 하나의 정가만 뽑는다 — **회차·접수창과 무관**하다.
 *
 * ⚠️ 자격증 발급비(payments 의 cert)가 이걸 쓴다. 발급비는 "그 급수의 응시료와 같은 금액"인데,
 *    발급 시점은 성적 공개 후 = **접수 기간이 이미 끝난 뒤**라 resolveExamOffer 를 쓰면
 *    apply_closed 로 막혀 자격증을 영영 못 산다. 판매 가능 판정(회차·접수창·1인1권)은
 *    응시권 갈래의 규칙이지 발급비의 규칙이 아니다.
 */
export async function resolveExamFee(admin: SupabaseClient, tier: string): Promise<ExamFeeResult> {
  const tkey = String(tier ?? '').trim().toLowerCase()
  const { data: tierRow } = await admin.from('exam_tiers').select('tier, track').eq('tier', tkey).maybeSingle()
  if (!tierRow) return { ok: false, code: 'tier_unknown', error: '알 수 없는 급수입니다.', status: 404 }
  const tierKey = tierRow.tier as string
  const track = tierRow.track as string
  // ⚠️ `<= 0` 이 아니라 `== null` 이다 — 0 은 관리자가 정한 무료값이고 미설정만 막는다.
  const amount = await lookupExamFee(admin, track, tierKey)
  if (amount === null) {
    return { ok: false, code: 'no_fee', error: '아직 금액이 책정되지 않은 급수입니다.', status: 400 }
  }
  return { ok: true, tier: tierKey, track, amount }
}

/**
 * 자격증 **발급비**. 기본은 그 급수의 응시료와 같고, 관리자가 급수별로 따로 정할 수 있다
 * (관리자 › 인증서 관리 › 급수별 발급 조건 → `exam_tiers.cert_fee_usd_cents`).
 *
 * ⚠️ 단위는 **달러 센트**다 — 응시료(`exam_fees.amount_usd_cents`)와 같은 단위여야 한 상품처럼 계산된다.
 *    옛 컬럼 이름은 `cert_fee_override` 였고 화면 안내가 '원 단위'라 단위가 어긋나 있었다(20260904210000).
 * ⚠️ 0 은 "무료로 발급한다"는 관리자의 결정이다 — 미설정(null)과 구분해서, 0 이면 그대로 0 을 쓴다.
 *    미설정이 0 으로 접히면 오타 한 번이 전 급수 무료 발급이 된다(응시료 쪽과 같은 규칙).
 */
export async function resolveCertFee(admin: SupabaseClient, tier: string): Promise<ExamFeeResult> {
  const tkey = String(tier ?? '').trim().toLowerCase()
  const { data: tierRow } = await admin
    .from('exam_tiers')
    .select('tier, track, cert_fee_usd_cents')
    .eq('tier', tkey)
    .maybeSingle()
  if (!tierRow) return { ok: false, code: 'tier_unknown', error: '알 수 없는 급수입니다.', status: 404 }
  const tierKey = tierRow.tier as string
  const track = tierRow.track as string
  const raw = tierRow.cert_fee_usd_cents
  if (raw !== null && raw !== undefined) {
    const n = Math.floor(Number(raw))
    if (Number.isFinite(n) && n >= 0) return { ok: true, tier: tierKey, track, amount: n }
    // 숫자가 아닌 값 = 별도지정을 못 읽었다. 응시료로 떨어진다(지어내지 않는다).
  }
  return resolveExamFee(admin, tierKey)
}

export type ExamOfferErrorCode =
  | 'bad_ref'
  | 'round_not_found'
  | 'tier_unknown'
  | 'not_open_tier'
  | 'apply_closed'
  | 'no_fee'

export interface ExamOffer {
  round: ExamRoundRow
  examId: string
  tier: string
  track: string
  amount: number
  orderName: string
  /** payments.product_ref 에 저장할 **정규화된** 값. insert 는 이 값만 쓴다. */
  ref: string
}

export type ExamOfferResult =
  | ({ ok: true } & ExamOffer)
  | { ok: false; code: ExamOfferErrorCode; error: string; status: number }

/**
 * (회차 × 급수)가 지금 팔 수 있는 상품인지 한 번에 확인하고 금액·주문명·정규화 ref 를 돌려준다.
 * **주문 생성(create)과 지급(grant) 양쪽이 같은 함수를 부른다** — 접수 마감 뒤에 승인이 들어오거나
 * 그 사이 관리자가 급수를 내린 결제가 그대로 지급되던 구멍(H-CRIT-2/H15)을 여기 한 곳에서 막는다.
 *
 * 확인 순서: 회차 존재·published → exam_tiers(트랙) → exams(active) → 접수창 → exam_fees.
 * 하나라도 실패하면 400/404. **폴백 금액은 어떤 경우에도 지어내지 않는다.**
 */
export async function resolveExamOffer(
  admin: SupabaseClient,
  roundId: string,
  tier: string,
  lang: string,
  at: number = Date.now(),
): Promise<ExamOfferResult> {
  // 조회 키는 여기서 한 번만 정규화한다(uuid 컬럼 비교는 대소문자를 안 가리지만, 로그·에러 문구가 갈리는 걸 막는다).
  const rid = String(roundId ?? '').trim().toLowerCase()
  const tkey = String(tier ?? '').trim().toLowerCase()
  if (!UUID_RE.test(rid) || !/^[a-z]+$/.test(tkey)) {
    return { ok: false, code: 'bad_ref', error: '상품 정보가 올바르지 않습니다.', status: 400 }
  }

  const { data: roundRow } = await admin
    .from('exam_rounds')
    .select(EXAM_ROUND_COLS)
    .eq('id', rid)
    .eq('published', true)
    .maybeSingle()
  const round = roundRow as ExamRoundRow | null
  // 미발행 회차와 없는 회차를 같은 문구로 접는다 — 준비 중인 회차의 존재를 id 대입으로 떠보지 못하게.
  if (!round) return { ok: false, code: 'round_not_found', error: '접수 중인 시험 회차가 아닙니다.', status: 404 }

  const { data: tierRow } = await admin
    .from('exam_tiers')
    .select('tier, track')
    .eq('tier', tkey)
    .maybeSingle()
  if (!tierRow) return { ok: false, code: 'tier_unknown', error: '알 수 없는 급수입니다.', status: 404 }
  const tierKey = tierRow.tier as string // ← 저장·발급에 쓰는 건 클라 문자열이 아니라 이 DB 값이다
  const track = tierRow.track as string

  // ⚠️ exams 행은 관리자가 회차 편집에서 급수 체크박스를 켠 **그 순간** 생기고, 실제 문항 세트(exam_questions)는
  //    나중에 별도 '추출' 작업으로 채워진다. 즉 여기를 통과해도 문항이 0건일 수 있다(그건 start-exam 이 막는다).
  //    판매 가능 = 회차가 그 급수를 열었다까지이고, 문항 준비는 운영 책임으로 남긴다.
  const { data: exam } = await admin
    .from('exams')
    .select('id')
    .eq('round_id', round.id)
    .eq('tier', tierKey)
    .eq('active', true)
    .maybeSingle()
  if (!exam) {
    return { ok: false, code: 'not_open_tier', error: '이 회차에서 열리지 않은 급수입니다.', status: 404 }
  }

  if (!applyWindowOpen(round, at)) {
    return { ok: false, code: 'apply_closed', error: '접수 기간이 아닙니다.', status: 400 }
  }

  // 정가 단일 소스 = exam_fees(위 lookupExamFee 가 키 규칙의 유일한 정의처).
  // ⚠️ **행이 없으면(null)** 판매 불가다 — CARIS-Ⅱ(t2_*)는 일부러 행이 없다(결제 미개방).
  //    **0 은 판매한다** — 관리자가 확인을 한 번 받고 무료로 정한 값이다(2026-08-25).
  //    그 경우 payments/create 가 결제창을 타지 않고 응시권을 바로 준다(payments.amount 는 >0 제약이라
  //    0원 주문 행 자체가 만들어지지 않는다 — 이북 무료와 같은 경로다).
  const amount = await lookupExamFee(admin, track, tierKey)
  if (amount === null) {
    return { ok: false, code: 'no_fee', error: '아직 응시료가 책정되지 않은 급수입니다.', status: 400 }
  }

  // 주문명은 결제창·카드 명세서에 그대로 뜬다(토스 상한 100자).
  // exams.title 은 관리자가 넣은 한국어 고정 문자열이라 쓰지 않고, 회차명을 사용자 언어로 투영해 조립한다.
  const roundTitle = projText(round.title_i18n, lang) || '자격검정'
  const orderName = `${roundTitle} · ${TIER_LABEL[tierKey] ?? tierKey}`.slice(0, 100)

  return {
    ok: true,
    round,
    examId: exam.id as string,
    tier: tierKey,
    track,
    amount,
    orderName,
    ref: buildExamRef(round.id, tierKey), // ← 저장은 반드시 이 값(DB 원본)으로
  }
}

// ---------- 조회 ----------

/** 여러 회차를 한 번에 읽어 id→행 지도로. (응시권 목록 화면이 회차 수만큼 왕복하지 않게) */
export async function loadRounds(admin: SupabaseClient, ids: string[]): Promise<Map<string, ExamRoundRow>> {
  const uniq = [...new Set(ids.filter(Boolean))]
  const map = new Map<string, ExamRoundRow>()
  if (uniq.length === 0) return map
  // ⚠️ published 로 거르지 않는다 — 관리자가 회차를 내려도 이미 판 응시권은 화면에 보여야 한다.
  const { data } = await admin.from('exam_rounds').select(EXAM_ROUND_COLS).in('id', uniq)
  for (const r of (data ?? []) as ExamRoundRow[]) map.set(r.id, r)
  return map
}

/**
 * 이 사람의 '살아있는' 응시권(기본 issued+consumed).
 * 소진(consumeTicket)은 자기 SQL 에 소유자 술어를 따로 갖는다 — 여기서 걸렀다는 이유로 빼면 안 된다.
 */
export async function findLiveTickets(
  admin: SupabaseClient,
  userId: string,
  filter: { roundId?: string; tier?: string; statuses?: ExamTicketStatus[] } = {},
): Promise<ExamTicketRow[]> {
  let q = admin
    .from('exam_tickets')
    .select(EXAM_TICKET_COLS)
    .eq('user_id', userId)
    .in('status', filter.statuses ?? LIVE_TICKET_STATUSES)
  if (filter.roundId) q = q.eq('round_id', filter.roundId)
  if (filter.tier) q = q.eq('tier', filter.tier)
  const { data, error } = await q.order('issued_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as ExamTicketRow[]
}

/** 만료 눕히기(lazy). 조회 시점에만 부른다 — 크론을 만들지 않는 게 이 프로젝트 관례다. */
export async function expireTickets(admin: SupabaseClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const now = new Date().toISOString()
  await admin
    .from('exam_tickets')
    .update({ status: 'expired', updated_at: now })
    .in('id', ids)
    .eq('status', 'issued') // 그 사이 소진됐으면 건드리지 않는다
}

// ---------- 발급 ----------

export interface GrantExamTicketInput {
  userId: string
  roundId: string
  tier: string
  source?: ExamTicketSource
  paymentId?: string | null
  pricePaid?: number
  grantedBy?: string | null
  note?: string | null
  /** 만료 override. 비우면 회차의 응시창 종료가 만료를 정한다(D2 로 '무기한' 경로는 존재하지 않는다). */
  expiresAt?: string | null
}

export type GrantExamTicketResult =
  | { ok: true; ticket: ExamTicketRow; already: boolean }
  | { ok: false; code: 'live_conflict' | 'bad_ref' | 'error'; error: string }

/** 유니크 위반이 어느 인덱스에서 났는지. PostgREST 는 제약 이름을 message/details 에 문자열로 담아준다. */
function violatedConstraint(err: unknown): string {
  const e = (err ?? {}) as { message?: string; details?: string }
  return `${e.message ?? ''} ${e.details ?? ''}`
}

/**
 * 응시권 발급. 결제 승인 · 웹훅 · 대사 셋이 같은 결제로 동시에 부를 수 있어 **멱등**이어야 한다.
 *
 * ⚠️ 23505 를 전부 '이미 지급'으로 흡수하면 안 된다(H1). exam_tickets 에는 성격이 완전히 다른 유니크가 둘이다:
 *   · exam_tickets_payment_uniq — 같은 결제의 재시도. 이건 흡수가 맞다(이미 그 결제분 응시권이 있다).
 *   · exam_tickets_live_uniq    — 다른 출처(수기 발급·다른 결제)가 이미 그 (회차×급수) 슬롯을 차지했다.
 *     흡수하면 **이 결제분 응시권은 0장인데** 호출부가 fulfilled_at 을 찍어버려, 돈만 받고 아무것도 안 준 건이
 *     원장상 '정상 지급'으로 남아 대사 어느 목록에도 안 걸린다. 그래서 실패로 돌려준다.
 */
export async function grantExamTicket(
  admin: SupabaseClient,
  input: GrantExamTicketInput,
): Promise<GrantExamTicketResult> {
  const row = {
    user_id: input.userId,
    round_id: input.roundId,
    tier: input.tier,
    status: 'issued',
    source: input.source ?? 'pg',
    payment_id: input.paymentId ?? null,
    price_paid: Math.max(0, Math.floor(Number(input.pricePaid ?? 0))),
    granted_by: input.grantedBy ?? null,
    note: input.note ?? null,
    expires_at: input.expiresAt ?? null,
  }

  const { data, error } = await admin.from('exam_tickets').insert(row).select(EXAM_TICKET_COLS).single()
  if (!error && data) return { ok: true, ticket: data as ExamTicketRow, already: false }

  const code = (error as { code?: string } | null)?.code
  if (code === '23505') {
    // ⚠️ 제약 이름이 어느 쪽으로 오는지에 기대지 않는다 — 같은 결제의 재시도는 payment_uniq 와 live_uniq 를
    //    **동시에** 위반하고, 그때 Postgres 가 어느 인덱스를 보고할지는 보장되지 않는다.
    //    "이 결제로 발급된 행이 실제로 있나"를 직접 확인하는 게 유일하게 확실한 판별이다.
    if (input.paymentId) {
      const { data: mine } = await admin
        .from('exam_tickets')
        .select(EXAM_TICKET_COLS)
        .eq('payment_id', input.paymentId)
        .maybeSingle()
      if (mine) return { ok: true, ticket: mine as ExamTicketRow, already: true }
    }
    // 이 결제분 행이 없는데 유니크에 걸렸다 = 다른 출처가 슬롯을 차지했다 → **이 결제분 응시권은 0장**이다.
    if (violatedConstraint(error).includes('exam_tickets_live_uniq')) {
      return {
        ok: false,
        code: 'live_conflict',
        error: '이미 이 회차·급수의 응시권을 보유하고 있어 발급하지 못했습니다.',
      }
    }
    // 어느 인덱스인지 못 읽은 23505 — 흡수하지 않는다(모르면 '줬다'고 기록하지 않는 쪽이 안전하다).
    return { ok: false, code: 'error', error: '응시권 발급이 중복 제약에 걸렸습니다.' }
  }
  if (code === '23503') {
    // FK — 없는 회차이거나 exam_tiers 에 없는 급수 키.
    return { ok: false, code: 'bad_ref', error: '알 수 없는 회차 또는 급수입니다.' }
  }
  return { ok: false, code: 'error', error: (error as { message?: string } | null)?.message ?? '응시권 발급 실패' }
}

// ---------- 소진 ----------

/**
 * 응시 시작 시 응시권을 소진한다. **조건부 UPDATE 한 문장**이고 되돌리지 않는다.
 *
 * ⚠️ `user_id` 술어는 장식이 아니다. ticketId 는 my-attempts 응답·start-exam 응답·화면 state 를 타고
 *    클라이언트 표면에 상시 노출되는 값이라, 소유자 술어가 빠지면 **id 를 아는 사람이 남의 응시권을 소진시킬 수 있다.**
 *    "앞에서 SELECT 로 소유자를 확인했다"에 기대지 말 것 — 그 SELECT 와 이 UPDATE 사이에 트랜잭션이 없다.
 *
 * 0행이면 (a) 다른 요청이 먼저 가져갔거나 (b) 내 것이 아니거나 (c) 이미 소진/무효/만료다.
 * 호출부는 다시 읽어 `consumed` + 본인 + 응시 미완료면 재진입 경로로 계속 간다(새로고침·네트워크 끊김 대비).
 * 최종 잠금은 exam_attempts insert 의 exam_attempts_ticket_live_uniq 다.
 */
export async function consumeTicket(
  admin: SupabaseClient,
  ticketId: string,
  userId: string,
): Promise<{ consumed: boolean }> {
  const now = new Date().toISOString()
  const { data } = await admin
    .from('exam_tickets')
    .update({ status: 'consumed', consumed_at: now, updated_at: now })
    .eq('id', ticketId)
    .eq('user_id', userId) // ⚠️ 절대 빼지 말 것
    .eq('status', 'issued')
    .select('id')
    .maybeSingle()
  return { consumed: Boolean(data) }
}

/**
 * 무효화(관리자 회수·부정 응시). issued/consumed 어느 쪽에서든 간다.
 * 상태 전이를 이 파일 밖에서 손으로 쓰면 voided_at·void_reason 을 빼먹기 쉬워 헬퍼로 둔다.
 *
 * ⚠️ 이건 응시권만 죽인다. payments 는 status='paid' 그대로라 payments_paid_product_uniq 가 계속 걸려
 *    **그 사람은 같은 회차·급수를 다시 살 수 없다.** 재판매까지 열려면 결제 행도 같이 정리해야 한다.
 * ⚠️ 이미 친 성적·발급된 인증서는 건드리지 않는다(범위 밖 — 사람이 판단).
 */
export async function voidTicket(
  admin: SupabaseClient,
  ticketId: string,
  reason: string,
): Promise<{ voided: boolean }> {
  const now = new Date().toISOString()
  const { data } = await admin
    .from('exam_tickets')
    .update({ status: 'void', voided_at: now, void_reason: reason.slice(0, 500), updated_at: now })
    .eq('id', ticketId)
    .in('status', ['issued', 'consumed'])
    .select('id')
    .maybeSingle()
  return { voided: Boolean(data) }
}

/**
 * 이 응시의 근거(응시권·그 결제)가 아직 살아 있나. **자격증 갈래 전용 판정**이다.
 *
 * start-exam 은 응시 시작 시점에 응시권을 강제하지만, 환불(차지백)·관리자 회수(void)는 그보다 뒤라
 * 자격증을 팔거나(payments/create) 발급할(my-attempts) 때 다시 봐야 한다. 자격번호는 한번 나가면
 * 회수가 안 되고, 돈은 받았는데 발급을 거절하면 환불거리가 되므로 **두 곳이 같은 판정을 써야 한다**
 * (한쪽에만 있으면 결제는 통과하고 발급만 막히는 구간이 생긴다).
 *
 * ticketId 가 없는 응시(응시권 도입 전 기록·SEB 익명 경로 잔재)는 막지 않는다 — 근거가 없는 것과
 * 근거가 죽은 것은 다르고, 옛 합격자의 자격증을 소급해 막을 이유가 없다.
 */
export async function ticketSourceAlive(
  admin: SupabaseClient,
  ticketId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!ticketId) return { ok: true }
  const { data: tk } = await admin
    .from('exam_tickets')
    .select('status, source, payment_id')
    .eq('id', ticketId)
    .maybeSingle()
  if (!tk) return { ok: true } // 응시권 행이 사라진 건 판정 불가 — 자격증을 막을 근거로 쓰지 않는다
  if (tk.status === 'void') return { ok: false, error: '취소·회수된 응시권의 자격증은 발급할 수 없습니다.' }
  if (tk.source === 'pg' && tk.payment_id) {
    const { data: pay } = await admin.from('payments').select('status').eq('id', tk.payment_id).maybeSingle()
    if (pay && pay.status !== 'paid') {
      return { ok: false, error: '결제가 취소·환불된 응시의 자격증은 발급할 수 없습니다.' }
    }
  }
  return { ok: true }
}

/** 단건 조회(소유자 확인 포함). 소진 실패 후 재진입 판정에 쓴다. */
export async function getTicket(
  admin: SupabaseClient,
  ticketId: string,
  userId: string,
): Promise<ExamTicketRow | null> {
  const { data } = await admin
    .from('exam_tickets')
    .select(EXAM_TICKET_COLS)
    .eq('id', ticketId)
    .eq('user_id', userId)
    .maybeSingle()
  return (data as ExamTicketRow | null) ?? null
}
