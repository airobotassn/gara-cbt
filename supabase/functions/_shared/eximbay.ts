// 엑심베이(Eximbay) 코어 API 래퍼 + PaymentProvider 포트의 엑심베이 어댑터 — **해외(외화) 결제용**.
//   공식 문서: https://developer.eximbay.com/eng/eximbay/api_list/reference.html
//
// 왜 있나: 국내는 토스(원화), 해외는 엑심베이(달러). payments.ts·payments 함수는 포트만 알고 PG 를 모른다.
//   이 파일을 추가하고 payment-provider 의 PROVIDERS 에 등록하면 토스 코드를 한 줄도 안 열고 해외 결제가 붙는다.
//
// **실검증 상태(2026-08-07, 문서용 공개 테스트키 mid=1849705C64 / api-test.eximbay.com):**
//    ✅ 인증 형태 = `base64(apikey:)` (문서 본문 'mid:apikey' 는 틀림 — 실측으로 확정)
//    ✅ /ready → rescode 0000 + fgkey 정상 발급
//    ✅ 조회 '주문 없음' = rescode Q004 + status NONE → absent 정규화
//    아직 **미확정(TODO)** — 결제를 실제로 완주해야 확인되는 것:
//      · 금액 단위(USD 100 이 $100 인지 $1.00 인지 — /ready 는 통과했지만 완주 전엔 모른다)
//      · confirm(=/verify)에 SDK 콜백 필드 배선(포트 confirm 인자 확장 필요)
//      · retrieve 의 currency/amount 를 resettle 이 넘기도록 포트 queryBy* 확장
//    ⚠️ 위 공개 테스트키는 **여러 사람이 공유하는 샌드박스**다(토스 문서키와 같은 성격). 계약 후 전용 키로 재확인할 것.
//
// ⚠️ 통화: 지금 시스템은 원(KRW) 전제다(exam_fees·표시·amount 전부). 엑심베이는 달러 고정으로 갈 것이라,
//    "원화 정가 → 달러 환산" 은 이 어댑터가 아니라 **결제 레이어(resolveProduct/create)** 에서 해야 한다.
//    이 어댑터는 넘겨받은 amount·currency 를 그대로 PG 규격으로 보낼 뿐이다.
import type { PaymentProvider, ProviderPayment, ProviderResult } from './payment-provider.ts'

// 환경별 호스트. 테스트/실서버가 **URL 로** 갈린다(토스처럼 키 접두사가 아니다).
const HOSTS = {
  test: 'https://api-test.eximbay.com',
  live: 'https://api.eximbay.com',
}

function env(): 'test' | 'live' {
  // 기본 test. 실서버는 EXIMBAY_ENV=live 로 명시(실수로 실결제 나가는 걸 막는 쪽으로 기본값을 잡는다).
  return (Deno.env.get('EXIMBAY_ENV') ?? '').toLowerCase() === 'live' ? 'live' : 'test'
}
function apiBase(): string {
  return HOSTS[env()]
}

function mid(): string {
  const v = (Deno.env.get('EXIMBAY_MID') ?? '').trim()
  if (!v) throw new Error('EXIMBAY_MID 가 설정되지 않았습니다.')
  return v
}
function secretKey(): string {
  const v = (Deno.env.get('EXIMBAY_SECRET_KEY') ?? '').trim()
  if (!v) throw new Error('EXIMBAY_SECRET_KEY 가 설정되지 않았습니다.')
  return v
}

/** ✅ 실검증 완료(2026-08-07, api-test.eximbay.com) — 인증은 **`base64(apikey:)`** 다(apikey + 콜론, 토스와 동일).
 *   문서 본문엔 `base64(mid:apikey)` 라고 써 있지만 **그건 틀렸다** — 그 형태로 보내면 `EC1000 Authorization is invalid`.
 *   문서의 Basic 예시 값을 디코드하면 `apikey:` 가 나오고, 그 형태만 200 을 받는다. mid 는 인증이 아니라 **본문**에 넣는다. */
function authHeader(): string {
  return `Basic ${btoa(`${secretKey()}:`)}`
}

// 엑심베이 결제 응답의 payment 블록 — 우리가 읽는 필드만.
interface EximbayPayment {
  order_id?: string
  currency?: string
  amount?: string
  transaction_id?: string
  auth_code?: string
  transaction_date?: string // YYYYMMDDHHMMSS
  status?: string // SALE | AUTH | REGISTERED | NONE
  [k: string]: unknown
}
interface EximbayResponse {
  rescode?: string // '0000' = 성공
  resmsg?: string
  mid?: string
  fgkey?: string
  payment?: EximbayPayment
  [k: string]: unknown
}

async function call(path: string, body: unknown): Promise<{ http: number; data: EximbayResponse | null }> {
  const res = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => null)) as EximbayResponse | null
  return { http: res.status, data }
}

// 엑심베이 status → 우리 CanonicalStatus.
//   SALE       = 매출 확정(결제 완료)                → paid
//   REGISTERED = 주문만 등록, 입금 후 확정(무통장/이체) → waiting_deposit (토스 가상계좌와 같은 취급)
//   AUTH       = 승인만 됨, 매입 전(수동 capture 필요) → pending (아직 돈이 확정 안 됨 → 지급하면 안 된다)
//   NONE       = 주문 없음                            → 조회 경로에서 '부재(absent)'로 처리(아래 retrieve 참고)
function mapStatus(s: string | undefined): ProviderPayment['status'] {
  switch (s) {
    case 'SALE':
      return 'paid'
    case 'REGISTERED':
      return 'waiting_deposit'
    case 'AUTH':
      return 'pending'
    default:
      return 'pending'
  }
}

function normalize(p: EximbayPayment): ProviderPayment {
  return {
    providerKey: p.transaction_id ?? null,
    orderId: p.order_id ?? '',
    status: mapStatus(p.status),
    method: (p.payment_method as string | undefined) ?? null,
    // REGISTERED(입금 후 확정)는 토스 가상계좌와 같은 성격 — 발급됐을 뿐 아직 돈이 안 들어온 상태.
    isVirtualAccount: p.status === 'REGISTERED',
    // YYYYMMDDHHMMSS → ISO 로 대충 변환(정확한 tz 는 실검증 때). 없으면 null.
    approvedAt: p.transaction_date ? isoFromEximbayDate(p.transaction_date) : null,
    raw: p,
  }
}

/** 'YYYYMMDDHHMMSS' → ISO. ⚠️ TODO(verify): 엑심베이 시각의 tz 를 문서에서 못 봤다. 실검증 때 KST/UTC 확인. */
function isoFromEximbayDate(s: string): string | null {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/)
  if (!m) return null
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`
}

/**
 * 결제 준비 — 엑심베이 전용. **create 단계**에서 부른다(토스엔 없는 단계).
 *   FGKey 를 받아 프론트 JS SDK 가 결제창을 띄운다. 포트 인터페이스엔 없다(엑심베이만 필요) — create 분기에서 직접 부른다.
 * ⚠️ 아직 create 에 배선하지 않았다(프론트 결제창·통화 환산과 같이 붙일 것). 여기선 API 호출 형태만 확정해 둔다.
 */
export async function eximbayReady(input: {
  orderId: string
  amount: string
  currency: string
  buyerName: string
  buyerEmail: string
  returnUrl: string
  statusUrl: string
  lang?: string
}): Promise<{ ok: true; fgkey: string } | { ok: false; code: string; message: string }> {
  const { data } = await call('/v1/payments/ready', {
    payment: {
      transaction_type: 'PAYMENT', // 준비→SDK→검증→승인→매입 자동 단일 플로우
      order_id: input.orderId,
      currency: input.currency,
      amount: input.amount,
      lang: input.lang ?? 'EN',
    },
    merchant: { mid: mid() },
    buyer: { name: input.buyerName, email: input.buyerEmail },
    url: { return_url: input.returnUrl, status_url: input.statusUrl },
  })
  if (data?.rescode === '0000' && data.fgkey) return { ok: true, fgkey: data.fgkey }
  return { ok: false, code: data?.rescode ?? 'UNKNOWN', message: data?.resmsg ?? '결제 준비 실패' }
}

/** rescode → ProviderResult 오류. absent(주문 부재 확정) 판정은 retrieve 의 status=NONE 에서 따로 한다. */
function errResult(http: number, data: EximbayResponse | null, absent = false): ProviderResult {
  return {
    ok: false,
    error: {
      code: data?.rescode ?? 'UNKNOWN',
      message: data?.resmsg ?? `엑심베이 오류 (${http})`,
      httpStatus: http,
      absent,
    },
  }
}

export const eximbayProvider: PaymentProvider = {
  name: 'eximbay',
  env,

  /**
   * 승인/검증 — 엑심베이는 SDK 콜백(status_url) 후 `/verify` 로 결과를 검증한다(토스의 confirm 자리).
   * ⚠️ TODO(verify): /verify 는 콜백에서 온 필드(fgkey·rescode·transaction_id·auth_code·email)를 같이 넘겨야 한다.
   *    그 값들은 포트의 confirm 인자에 아직 없다 — create/confirm 배선(+ 프론트 콜백 수신)을 붙일 때 포트 인자를
   *    optional raw 로 넓히고 여기서 꺼내 쓴다. 그 전엔 이 메서드를 실제로 부르면 안 된다(형태만 확정).
   */
  confirm: async (a) => {
    // 지금은 최소 필드만으로 호출 형태를 남겨둔다. 실제 배선 전 호출을 막기 위해 명시적으로 실패시킨다.
    void a
    return {
      ok: false,
      error: {
        code: 'NOT_WIRED',
        message: '엑심베이 confirm 은 SDK 콜백 필드 배선 후 사용 가능합니다(어댑터 주석 TODO 참고).',
        httpStatus: 501,
        absent: false,
      },
    }
  },

  // ⚠️ 엑심베이 retrieve 는 currency·amount 도 **필수**다(실검증 확인). 포트 queryBy* 는 값 하나만 받아서
  //    지금은 그 둘을 못 넘긴다 → resettle 에 엑심베이를 물리려면 포트 시그니처를 (value,{currency,amount})로
  //    넓혀야 한다(create/프론트 배선 때 같이). 그 전엔 엑심베이 조회가 필수필드 누락으로 실패한다.
  queryByKey: (transactionId) => retrieve('transaction_id', transactionId),
  queryByOrderId: (orderId) => retrieve('order_id', orderId),
}

/** 조회 — order_id 또는 transaction_id 로. status=NONE/Q004 이면 **주문 부재(absent)** 로 접어 resettle 규격에 맞춘다. */
async function retrieve(
  keyField: 'order_id' | 'transaction_id',
  value: string,
  extra?: { currency: string; amount: string },
): Promise<ProviderResult> {
  const { http, data } = await call('/v1/payments/retrieve', {
    mid: mid(),
    key_field: keyField,
    payment: { [keyField]: value, currency: extra?.currency, amount: extra?.amount, lang: 'EN' },
  })
  // ✅ 실검증(2026-08-07): "주문 없음"은 rescode **Q004**("No Transaction") + payment.status **NONE** 으로 온다
  //    (rescode 0000 + NONE 이 아니다 — 처음 가정이 틀렸다). 우리 포트에선 이걸 **absent 오류**로 정규화한다
  //    (그래야 resettle 이 '그런 결제 없음'으로 판정해 오래된 pending 을 만료로 접는다).
  const p = data?.payment ?? {}
  if ((p.status ?? 'NONE') === 'NONE' || data?.rescode === 'Q004') {
    return errResult(http, { rescode: data?.rescode ?? 'NONE', resmsg: data?.resmsg ?? '존재하지 않는 주문' }, true)
  }
  if (data?.rescode !== '0000') return errResult(http, data)
  return { ok: true, data: normalize(p) }
}
