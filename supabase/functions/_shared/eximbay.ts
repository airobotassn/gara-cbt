// 엑심베이(Eximbay) 코어 API 래퍼 + PaymentProvider 포트의 엑심베이 어댑터 — **해외(외화) 결제용**.
//   공식 문서: https://developer.eximbay.com/eng/eximbay/api_list/reference.html
//
// 왜 있나: 국내는 토스(원화), 해외는 엑심베이(달러). payments.ts·payments 함수는 포트만 알고 PG 를 모른다.
//   이 파일을 추가하고 payment-provider 의 PROVIDERS 에 등록하면 토스 코드를 한 줄도 안 열고 해외 결제가 붙는다.
//
// **실검증 상태(2026-08-11, 문서용 공개 테스트키 mid=1849705C64 / api-test.eximbay.com):**
//    ✅ 인증 형태 = `base64(apikey:)` (문서 본문 'mid:apikey' 는 틀림 — 실측으로 확정)
//    ✅ /ready → rescode 0000 + fgkey 정상 발급. **KRW 로도 통과한다** — 달러 환산이 필요 없다.
//    ✅ 조회 '주문 없음' = rescode Q004 + status NONE → absent 정규화
//    ✅ confirm(= /verify 위변조검증 + /retrieve 상태확인) 배선 완료
//    아직 **미확정** — 실제 카드로 완주해야 확인되는 것:
//      · 금액 단위(KRW "1000" 이 1,000원인지 — /ready 는 통과했지만 매출 확정 전엔 모른다)
//      · status_url(서버-서버 통지)의 본문 형식 — payments-webhook 이 JSON·폼 양쪽을 견디게는 해뒀다
//    ⚠️ 위 공개 테스트키는 **여러 사람이 공유하는 샌드박스**다(토스 문서키와 같은 성격). 계약 후 전용 키로 재확인할 것.
//
// ⚠️ 통화: 이 어댑터는 넘겨받은 amount·currency 를 그대로 PG 규격으로 보낼 뿐이다. 나중에 해외 카드용으로
//    달러를 받게 되면 "원화 정가 → 달러 환산" 은 여기가 아니라 **결제 레이어(resolveProduct/create)** 소관이다.
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

/**
 * 결제수단 코드 → 사람이 읽는 이름. 엑심베이는 `payment_method` 를 **`P101` 같은 코드**로 준다.
 *
 * 왜 여기서 이름으로 바꾸나 — `payments.method` 는 대사·분쟁 때 **사람이 읽는 칸**이고, 토스 어댑터는
 * 이미 `카드`·`가상계좌` 처럼 읽히는 값을 넣는다. 한쪽만 코드로 두면 같은 컬럼을 볼 때마다 코드표를
 * 찾아야 하고, 화면에 그대로 내보내면 사용자에게 `P101` 이 보인다.
 * ⚠️ 원문이 사라지는 건 아니다 — PG 응답 전체는 `payments.raw` 에 그대로 저장된다.
 * ⚠️ 모르는 코드는 **코드 그대로 남긴다**(빈칸·'기타'로 만들면 새 수단이 붙었을 때 알아챌 방법이 없다).
 *
 * 출처: developer.eximbay.com 의 결제수단 코드표(2026-08-11 확인). 엑심베이가 수단을 추가하면 여기 추가.
 */
const METHOD_NAMES: Record<string, string> = {
  // 공통·해외 카드
  P000: '신용카드', P101: 'VISA', P102: 'MasterCard', P103: 'AMEX', P104: 'JCB',
  P106: 'Diners', P107: 'Discover', P108: 'Mir', P109: 'UnionPay',
  // 국내 카드사
  P110: 'BC카드', P111: 'KB카드', P112: '하나카드', P113: '삼성카드', P114: '신한카드',
  P115: '현대카드', P116: '롯데카드', P117: '농협카드', P119: '씨티카드', P120: '우리카드',
  P121: '수협카드', P122: '제주카드', P123: 'JB카드', P124: '광주은행카드',
  P125: '카카오뱅크', P126: '케이뱅크', P127: '미래에셋대우', P128: '코나카드',
  P129: '토스카드', P130: '차이카드',
  // 국내 간편결제·이체
  P301: '실시간 계좌이체', P302: '카카오페이', P303: '토스', P304: 'PAYCO', P305: '가상계좌',
  P015: '네이버페이', P307: '네이버페이(카드)', P308: '네이버페이(포인트)',
  // 해외 간편결제
  P001: 'PayPal', P002: 'CUP(UPOP)', P003: 'Alipay', P006: 'ECONTEXT',
  P141: 'WeChat Pay(PC)', P142: 'WeChat Pay(모바일)', P143: 'WeChat Pay(POP)', P144: 'WeChat Pay(MINI)',
  P174: 'Alipay+(Alipay CN)', P175: 'Alipay+(TrueMoney)', P176: 'Alipay+(DANA)',
  P177: 'Alipay+(Alipay HK)', P178: 'Alipay+(TNG)', P179: 'Alipay+(GCash)', P195: 'Alipay+(MINI)',
  P197: 'Klarna',
  P198: 'Apple Pay', P091: 'Apple Pay(VISA)', P092: 'Apple Pay(MasterCard)',
  P093: 'Apple Pay(AMEX)', P094: 'Apple Pay(JCB)', P095: 'Apple Pay(UnionPay)',
  P199: '삼성페이', P096: '삼성페이(VISA)', P097: '삼성페이(MasterCard)', P098: '삼성페이(AMEX)',
  P300: 'Unifipay', P310: '가상계좌(해외)',
  P350: 'GrabPay(MYR)', P351: 'GrabPay(SGD)', P352: 'ShopeePay(THB)', P353: 'JKOPAY(TWD)', P354: 'PayPay',
}

/** 코드표에 없으면 받은 값을 그대로 돌려준다(정보를 지우지 않는다). */
export function eximbayMethodName(code: string | null | undefined): string | null {
  const c = (code ?? '').trim()
  if (!c) return null
  return METHOD_NAMES[c.toUpperCase()] ?? c
}

function normalize(p: EximbayPayment): ProviderPayment {
  return {
    providerKey: p.transaction_id ?? null,
    orderId: p.order_id ?? '',
    status: mapStatus(p.status),
    method: eximbayMethodName(p.payment_method as string | undefined),
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

/** 프론트 JS SDK(`EXIMBAY.request_pay`)에 그대로 넘길 페이로드. /ready 에 보낸 것과 **글자 하나까지 같아야** 한다. */
export interface EximbayReadyPayload {
  payment: { transaction_type: string; order_id: string; currency: string; amount: string; lang: string }
  merchant: { mid: string }
  buyer: { name: string; email: string }
  url: { return_url: string; status_url: string }
}

/**
 * 결제 준비 — 엑심베이 전용. **create 단계**에서 부른다(토스엔 없는 단계).
 *   FGKey 를 받아 프론트 JS SDK 가 결제창을 띄운다. 포트 인터페이스엔 없다(엑심베이만 필요) — create 분기에서 직접 부른다.
 *
 * ⚠️ **FGKey 는 여기 보낸 값들에 대한 서명이다.** 프론트가 `request_pay` 에 조금이라도 다른 값을 넣으면
 *    (금액 형식·언어·URL 끝의 슬래시 하나까지) FGKey 불일치로 결제창이 그냥 실패한다. 그래서 프론트가
 *    페이로드를 직접 조립하게 두지 않고, **서버가 /ready 에 보낸 그 객체를 통째로 돌려준다.**
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
}): Promise<
  { ok: true; fgkey: string; payload: EximbayReadyPayload } | { ok: false; code: string; message: string }
> {
  const payload: EximbayReadyPayload = {
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
  }
  const { data } = await call('/v1/payments/ready', payload)
  if (data?.rescode === '0000' && data.fgkey) return { ok: true, fgkey: data.fgkey, payload }
  return { ok: false, code: data?.rescode ?? 'UNKNOWN', message: data?.resmsg ?? '결제 준비 실패' }
}

/** 프론트가 로드할 SDK 스크립트. 호스트가 test/live 로 갈리는 건 API 와 같다. */
export function eximbaySdkUrl(): string {
  return `${apiBase()}/v2/javascriptSDK.js`
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
   * 승인 — 토스의 confirm 자리이지만 하는 일이 다르다. 엑심베이는 결제창에서 **승인·매입까지 이미 끝내고**
   * 그 결과를 return_url 쿼리스트링으로 브라우저에 돌려준다. 그래서 여기서 할 일은 "승인시키기"가 아니라
   * **돌아온 결과가 진짜인지 확인하기** 두 단계다:
   *
   *   ① `/verify` — 받은 쿼리스트링 **원문**을 통째로 넘기면 엑심베이가 fgkey 로 위변조를 판정한다.
   *      브라우저를 거쳐 온 값이라 이 검증 없이는 `rescode=0000` 을 손으로 붙여 무료 지급을 만들 수 있다.
   *   ② `/retrieve` — **실제 상태(SALE/AUTH/REGISTERED)는 return_url 에 없다.** 매출확정인지 승인만인지
   *      가르는 값이 조회에만 있어서, 검증을 통과해도 상태는 서버-서버로 다시 물어야 한다.
   *      (AUTH 를 paid 로 읽으면 매입 전 건에 물건을 준다.)
   */
  confirm: async (a) => {
    const raw = (a.rawQuery ?? '').replace(/^\?/, '')
    if (!raw) {
      return {
        ok: false,
        error: {
          code: 'CALLBACK_MISSING',
          message: '엑심베이 결제 결과가 전달되지 않았습니다.',
          httpStatus: 400,
          absent: false,
        },
      }
    }

    // 결제창이 실패로 돌아온 경우 — 검증할 것도 없다. PG 사유를 그대로 올려 사용자에게 보여준다.
    const q = new URLSearchParams(raw)
    const cbCode = q.get('rescode') ?? ''
    if (cbCode && cbCode !== '0000') {
      return errResult(400, { rescode: cbCode, resmsg: q.get('resmsg') ?? '결제가 완료되지 않았습니다.' })
    }

    // ① 위변조 검증. 원문을 **그대로** 넘긴다(파싱 후 재조립하면 인코딩·순서가 달라져 fgkey 가 어긋난다).
    const ver = await call('/v1/payments/verify', { data: raw })
    if (ver.data?.rescode !== '0000') {
      return errResult(ver.http, ver.data ?? { rescode: 'VERIFY_FAILED', resmsg: '결제 결과 검증에 실패했습니다.' })
    }

    // ② 실제 상태 조회. 우리 주문 기준값(저장된 금액·통화)으로 묻는다 — 콜백이 준 금액으로 물으면
    //    검증을 통과한 값이라도 우리 원장과 어긋난 건을 그대로 승인해버린다.
    return retrieve('order_id', a.orderId, { currency: a.currency, amount: String(a.amount) })
  },

  // 엑심베이 retrieve 는 currency·amount 가 **필수**다(실검증 확인). opts 없이 부르면 그 둘이 빠져 실패하므로,
  // 호출부(resettle·reconcile)는 저장된 주문 행의 값을 반드시 같이 넘긴다.
  queryByKey: (transactionId, opts) =>
    retrieve('transaction_id', transactionId, opts && { currency: opts.currency, amount: String(opts.amount) }),
  queryByOrderId: (orderId, opts) =>
    retrieve('order_id', orderId, opts && { currency: opts.currency, amount: String(opts.amount) }),
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
