// 토스페이먼츠 코어 API 래퍼 — **서버 전용**(시크릿 키를 쓴다).
//   붙이기 전 필독: docs/토스페이먼츠-연동-가드레일.md (특히 §8 자주 틀리는 패턴)
//
// 여기 담긴 것은 "API 를 정확히 부르는 코드"까지다. 사고는 그다음, 우리 DB 의 상태 관리에서 난다 —
// 지급·멱등·수습은 _shared/payments.ts 가 맡는다.
//
// ⚠️ 취소(cancel) API 는 일부러 안 넣었다. 승인은 됐는데 지급이 불가능한 경우(관리자가 그 사이 책을
//    내렸다든지) 자동 환불이 맞아 보이지만, 돈을 되돌리는 건 되돌릴 수 없는 동작이라 자동화하지 않는다.
//    그런 결제는 paid + fulfilled_at=null 로 남겨 대사에 걸리게 하고 사람이 판단한다.

const API_BASE = 'https://api.tosspayments.com'

/** 시크릿 키. 테스트/실키는 **다른 환경변수 이름**을 쓰지 않는다 — 값의 접두사(test_/live_)로 구분한다.
 *  (같은 이름에 값만 바꿔 끼우면 어느 환경인지 로그로 알 수 없어서, 아래 tossEnv() 로 항상 같이 남긴다.) */
export function tossSecretKey(): string {
  const k = (Deno.env.get('TOSS_SECRET_KEY') ?? '').trim()
  if (!k) throw new Error('TOSS_SECRET_KEY 가 설정되지 않았습니다.')
  return k
}

/** 'test' | 'live' — 로그·응답에 실어 실키/테스트키 혼용 사고를 눈에 보이게 만든다. */
export function tossEnv(): 'test' | 'live' {
  return tossSecretKey().startsWith('live_') ? 'live' : 'test'
}

/** ⚠️ 시크릿 키 뒤에 **콜론 하나**를 붙인 뒤 base64. 콜론 누락이 가장 흔한 실수(→ UNAUTHORIZED_KEY). */
function authHeader(): string {
  return `Basic ${btoa(`${tossSecretKey()}:`)}`
}

/** 토스 Payment 객체 — 우리가 실제로 읽는 필드만 적는다(문서에 없는 필드를 지어내지 않는다). */
export interface TossPayment {
  paymentKey: string
  orderId: string
  /** READY | IN_PROGRESS | WAITING_FOR_DEPOSIT | DONE | CANCELED | PARTIAL_CANCELED | ABORTED | EXPIRED */
  status: string
  totalAmount: number
  balanceAmount: number
  currency?: string
  method?: string | null
  approvedAt?: string | null
  [k: string]: unknown
}

export interface TossError {
  code: string
  message: string
}

export type TossResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: TossError }

async function call<T>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string },
): Promise<TossResult<T>> {
  const headers: Record<string, string> = { Authorization: authHeader() }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  // 멱등키는 POST 에서만 의미가 있다(GET 은 무시된다). 15일간 유효하고, 같은 키면 첫 응답이 그대로 돌아온다.
  if (init.idempotencyKey && init.method === 'POST') headers['Idempotency-Key'] = init.idempotencyKey

  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const parsed = await res.json().catch(() => null)
  if (!res.ok) {
    const e = (parsed ?? {}) as Partial<TossError>
    return {
      ok: false,
      status: res.status,
      error: { code: e.code ?? 'UNKNOWN', message: e.message ?? `토스 API 오류 (${res.status})` },
    }
  }
  return { ok: true, data: parsed as T }
}

/**
 * 결제 승인. **이 호출이 성공해야만** 결제가 완결된다 — successUrl 에 도착한 것만으로는 아무것도 아니다.
 * @param amount 반드시 **서버에 저장된 주문 금액**을 넣는다. successUrl 쿼리의 amount 를 그대로 넘기면 안 된다.
 * @param idempotencyKey 같은 주문을 두 번 승인하지 않게 하는 토스 쪽 방어(우리 DB 이중지급은 유니크 인덱스가 따로 막는다).
 */
export function confirmPayment(args: {
  paymentKey: string
  orderId: string
  amount: number
  idempotencyKey: string
}): Promise<TossResult<TossPayment>> {
  return call<TossPayment>('/v1/payments/confirm', {
    method: 'POST',
    body: { paymentKey: args.paymentKey, orderId: args.orderId, amount: args.amount },
    idempotencyKey: args.idempotencyKey,
  })
}

/** paymentKey 로 결제 조회 — 웹훅 검증(일반 결제 웹훅엔 서명 헤더가 없다)과 미완결 수습에 쓴다. */
export function getPaymentByKey(paymentKey: string): Promise<TossResult<TossPayment>> {
  return call<TossPayment>(`/v1/payments/${encodeURIComponent(paymentKey)}`, { method: 'GET' })
}

/** orderId 로 결제 조회 — 우리는 pending 인데 토스에선 승인됐을 수 있는 경우를 잡는다(우리에겐 paymentKey 가 없다). */
export function getPaymentByOrderId(orderId: string): Promise<TossResult<TossPayment>> {
  return call<TossPayment>(`/v1/payments/orders/${encodeURIComponent(orderId)}`, { method: 'GET' })
}

/**
 * "그런 결제가 실제로 없다"가 **확인된** 코드. 주문을 만료로 접어도 되는 건 이때뿐이다.
 *
 * ⚠️ `NOT_FOUND_MERCHANT` 를 절대 여기 넣지 말 것. 그건 상점/키 설정 문제라 **결제가 멀쩡히 살아있어도**
 *    404 로 돌아온다. 실제로 문서용 공개 테스트 키(test_gsk_docs_…)는 조회 API 를 지원하지 않아
 *    모든 조회가 NOT_FOUND_MERCHANT 404 다 — 이걸 "주문 없음"으로 취급하면 **결제된 주문까지 만료로 접힌다.**
 *    (2026-08-06 실측으로 확인. 승인 API 는 같은 키로 정상 동작한다.)
 */
export const ORDER_ABSENT_CODES = new Set(['NOT_FOUND_PAYMENT', 'NOT_FOUND_PAYMENT_SESSION'])

/** 승인 실패 응답 중 "다시 시도해도 소용없는" 것들 — 사용자에게 재시도를 권하면 안 되는 코드. */
export const TERMINAL_CONFIRM_CODES = new Set([
  'NOT_FOUND_PAYMENT_SESSION', // 결제 요청 후 10분이 지나 승인 데이터가 사라짐
  'ALREADY_PROCESSED_PAYMENT',
  'FORBIDDEN_REQUEST', // orderId/paymentKey 가 최초 요청과 다름 (또는 키 불일치)
  'UNAUTHORIZED_KEY', // 우리 설정 문제 — 사용자 잘못이 아니다
])

/** 토스 status → 우리 payments.status. 매핑을 한 곳에만 둬서 함수마다 달라지는 걸 막는다. */
export function mapTossStatus(
  tossStatus: string,
  opts: { fulfilled: boolean },
): 'pending' | 'waiting_deposit' | 'paid' | 'canceled' | 'refunded' | 'failed' | 'expired' {
  switch (tossStatus) {
    case 'DONE':
      return 'paid'
    case 'WAITING_FOR_DEPOSIT':
      // 가상계좌는 승인 응답이 와도 **발급**됐을 뿐 입금 전이다. 여기서 지급하면 돈 안 받고 물건을 준다.
      return 'waiting_deposit'
    case 'READY':
    case 'IN_PROGRESS':
      return 'pending'
    case 'CANCELED':
    case 'PARTIAL_CANCELED':
      // 지급까지 갔다가 취소된 건 환불로 구분한다(회수 대상). 지급 전 취소는 그냥 취소.
      return opts.fulfilled ? 'refunded' : 'canceled'
    case 'ABORTED':
      return 'failed'
    case 'EXPIRED':
      return 'expired'
    default:
      return 'pending'
  }
}
