// 금액 표시.
//
// **정가의 단일 단위는 달러 센트 정수**다(`ebooks.price_usd_cents`·`exam_fees.amount_usd_cents`).
// 2026-08-13 에 원화 기준에서 옮겼다 — 고정환율($1=1,500원)이 실제 환율(1,417원)과 벌어지면서
// 정가가 클수록 우리가 덜 받고 있었다($10 짜리에서 780원). 이제 달러가 기준이고 원화는 청구 시점에
// 환율로 계산되는 파생값이다.
//
//   usdc() = 정가. 구매자에게 보여주는 값이고 관리자가 입력하는 값이다.
//   krw()  = 국내 결제에서 **실제로 청구되는** 원화. 서버가 환율로 계산해 내려준 값만 넣을 것.
//
// ⚠️ 원화 금액을 여기서 만들지 마라. 환율은 서버가 주문마다 박아 쓰는 값이고(payments.fx_rate),
//    프론트가 따로 환산하면 화면과 청구액이 갈린다.

// 화면 언어와 통화는 별개다. lang 은 `Lang` 이 아니라 넓은 string 을 받는다 — 호출부가 lang 을
// string 으로 들고 다니는 데가 있고, Intl 은 모르는 로케일이면 알아서 폴백한다(try/catch 가 최종 방어).
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
 * 달러 센트 정수 → 표시 문자열. `100` → `$1` · `105` → `$1.05`
 *
 * ⚠️ 통화기호는 로케일에 맡기지 않고 `$` 로 고정한다 — Intl 은 같은 값을 ko/zh 에서 `US$1`,
 *    vi 에서 `1 US$` 로 찍는데, 고지문이 `$` 로 쓰여 있어 글자가 어긋난다. 숫자 서식만 로케일을 따른다.
 * ⚠️ 이름이 `usd` 가 아니라 `usdc` 인 이유 = 옛 `usd()` 는 **원화**를 받아 달러 문자열을 만들었다.
 *    이름을 그대로 두면 단위가 바뀐 걸 아무도 모른 채 원화 값이 그대로 흘러들어 100배 어긋난다.
 */
export function usdc(cents: number, lang: string = 'ko'): string {
  const c = Number.isFinite(cents) ? Math.max(0, Math.round(cents)) : 0
  const value = c / 100
  try {
    return `$${new Intl.NumberFormat(lang, { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value)}`
  } catch {
    return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  }
}

/** 관리자 입력칸(달러) → 저장할 센트 정수. `1.05` → `105` */
export function usdInputToCents(usdAmount: number): number {
  const v = Number.isFinite(usdAmount) ? Math.max(0, usdAmount) : 0
  return Math.round(v * 100)
}

/** 센트 정수 → 관리자 입력칸에 되돌려 넣을 숫자(문자열 아님). `105` → `1.05` */
export function centsToUsdInput(cents: number): number {
  const c = Number.isFinite(cents) ? Math.max(0, cents) : 0
  return Math.round(c) / 100
}
