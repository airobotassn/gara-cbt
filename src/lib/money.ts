// 금액 표시 — DB·결제·정산의 단일 단위는 **원(KRW) 정수**다(`ebooks.price`·`exam_fees.amount`).
// 여기 두 함수 말고 다른 데서 금액 문자열을 만들지 말 것.
//
//   krw() = 실제로 청구되는 금액. **관리자 화면은 무조건 이쪽**이다 — 운영자는 통장에 찍히는 값을 봐야 한다.
//   usd() = 구매자에게 보여주는 표시가. 아래 고정 환산.

// ⚠️ 화면 언어와 통화는 별개다. 영어로 보고 있어도 결제는 원화로 일어나므로 `$` 를 찍으면 안 된다
//    (2026-08-06 이전 코드가 원화 값에 `$` 를 붙이고 있었다 — 해외 사용자가 금액을 100배 이상 오해한다).
//    Intl 이 로케일마다 알아서 붙여주는 통화 기호(₩)를 쓰면 어느 언어에서도 원화라는 게 드러난다.
//
// lang 은 `Lang` 이 아니라 넓은 string 을 받는다 — 호출부(Result.tsx 의 EbookPicks 등)가 lang 을
// string 으로 들고 다니는 데가 있고, Intl 은 모르는 로케일이면 알아서 폴백한다(아래 try/catch 가 최종 방어).
export function krw(amount: number, lang: string = 'ko'): string {
  try {
    return new Intl.NumberFormat(lang, {
      style: 'currency',
      currency: 'KRW',
      maximumFractionDigits: 0, // 원은 소수점이 없다
    }).format(amount)
  } catch {
    return `₩${amount.toLocaleString('en-US')}`
  }
}

/**
 * 표시가 환산율 — **이 파일이 유일한 정의처다.** 다른 파일에 1500 을 복사하지 말 것.
 * 시장 환율이 아니라 우리가 정한 고정값이라, 화면 문구에 "○월○일 기준 환율" 이라고 쓰면 거짓말이 된다.
 */
export const KRW_PER_USD = 1500

/**
 * 원화 정가를 **표시용** 달러 문자열로. 1,500원 → `$1` · 3,000원 → `$2` · 4,500원 → `$3`.
 * 결제·환불·정산은 계속 원화다 — 이 함수는 사용자에게 보여주는 글자만 만든다.
 *
 * ⚠️ 나누어떨어지지 않으면 **센트 단위 올림**이다(2,000원 → `$1.34`). 내림·반올림을 쓰면 표시가가
 *    실제 청구액보다 싸 보이는 구간이 생기고, 원화로 뜨는 결제창에서 그 차이를 본 사용자에겐
 *    "더 받았다"로 읽힌다. 반대 방향(조금 비싸 보임)은 실제 청구액이 늘 더 싸서 분쟁이 안 된다.
 *    정가는 1,500원 배수로 운영할 값이라, 이 분기는 관리자가 어중간한 금액을 넣었을 때만 탄다.
 * ⚠️ 통화기호는 로케일에 맡기지 않고 `$` 로 고정한다 — Intl 은 같은 값을 ko/zh 에서 `US$1`,
 *    vi 에서 `1 US$` 로 찍는데 체크아웃 고지문이 "$1 = 1,500원" 이라고 못박고 있어 글자가 어긋난다.
 *    숫자 서식(자릿수 구분·소수점)만 로케일을 따른다.
 */
/** 달러 입력 → 저장할 원화 정수. **관리자 이북 가격칸이 유일한 사용처**다.
 *  구매자 화면이 달러로만 말하는데 관리자만 원으로 입력하면, `2` 를 넣고 "$2 로 팔린다" 고 믿는
 *  사고가 난다(실제로 20원 = $0.01 짜리 책이 그렇게 생겼다). 입력 단위를 표시 단위와 같게 맞춘다.
 *  ⚠️ 저장·결제·환불의 단위는 계속 원이다 — 바뀐 건 관리자가 타이핑하는 단위뿐. */
export function usdToKrw(usdAmount: number): number {
  const v = Number.isFinite(usdAmount) ? Math.max(0, usdAmount) : 0
  return Math.round(v * KRW_PER_USD)
}

/** 원화 정수 → 달러 입력칸에 되돌려 넣을 숫자(문자열 아님). 소수 둘째 자리까지. */
export function krwToUsdInput(krwAmount: number): number {
  const won = Number.isFinite(krwAmount) ? Math.max(0, krwAmount) : 0
  return Math.round((won * 100) / KRW_PER_USD) / 100
}

export function usd(krwAmount: number, lang: string = 'ko'): string {
  const won = Number.isFinite(krwAmount) ? Math.max(0, krwAmount) : 0
  // 나눗셈보다 곱셈을 먼저 해 부동소수 오차를 없앤다 — 4,500 → 정확히 300센트라야 `$3.01` 이 안 나온다.
  const cents = Math.ceil((won * 100) / KRW_PER_USD)
  const value = cents / 100
  try {
    return `$${new Intl.NumberFormat(lang, { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value)}`
  } catch {
    return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  }
}
