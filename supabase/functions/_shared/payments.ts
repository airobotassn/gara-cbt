// 결제 공통 로직 — 주문 생성 / 금액 재계산 / 상태 전이 / 지급.
//   payments 함수(사용자 흐름)와 payments-webhook(토스가 부르는 쪽)이 **같은 코드**를 쓴다.
//   두 경로가 각자 지급 로직을 들고 있으면 한쪽만 고쳐져서 이중지급·미지급이 난다.
//
// 이 파일이 지키는 5가지(토스 문서가 알려주지 않는, 우리 서버 몫):
//   ① 금액은 상품ID로 서버가 다시 뽑는다 — 클라가 보낸 금액은 쳐다보지도 않는다
//   ② 지급은 confirm 성공 이후에만, 중복 지급은 DB 유니크 제약이 막는다
//   ③ 미완결 결제는 토스에 다시 물어서 수렴시킨다(웹훅은 중복·역순·미도착이 다 가능)
//   ④ 어긋난 건을 자동으로 집어낸다(reconcile)
//   ⑤ **지급 직전에 상품을 다시 확인한다** — 승인이 create 보다 한참 뒤에 올 수 있어서다(접수 마감 후 승인 등).
//      확인에 실패하면 지급하지 않고 던진다 → payments 는 paid, fulfilled_at 은 null → 대사 목록에 걸린다.
// 상품은 ebook(이북 열람권)·lecture(강의 시청권)·exam(응시권)이고, 지급 경로만 갈린다(grant()).
// ⚠️ 버전은 _shared/lib.ts 와 **같은 핀**이어야 한다 — 다르면 Deno 가 모듈을 두 벌 받아
//    adminClient() 가 준 클라이언트와 여기 타입이 서로 안 맞는다.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { getProvider, type ProviderPayment } from './payment-provider.ts'
import { grantExamTicket, parseExamRef, resolveExamFee, resolveExamOffer, voidTicket } from './exam-tickets.ts'

export type ProductType = 'ebook' | 'exam' | 'cert' | 'bundle' | 'lecture'

/** 묶음 한 건에 담기는 종류. **한 묶음에는 한 종류만** 담긴다(교재 묶음 / 강의 묶음) —
 *  화면이 종류마다 따로 세고 할인도 따로 붙이기 때문이다(Ebooks.tsx 의 bundleKinds).
 *  ⚠️ 이 값이 product_ref 접두사('ebook:' / 'lecture:')가 된다 — 같은 카탈로그의 교재 묶음과
 *     강의 묶음이 paid 부분 유니크에서 서로 다른 상품으로 갈리려면 그 접두사가 필요하다. */
export type BundleKind = 'ebook' | 'lecture'

/** 종류별 표 이름 — 소유·지급·회수가 전부 이 두 표를 **같은 코드**로 다룬다.
 *  ⚠️ 컬럼 이름도 한 벌이다(user_id / <kind>_id / price_paid / source / payment_id / payment_ref).
 *     한쪽만 다르게 두면 갈래마다 다른 코드가 생기고, 그 순간 한쪽만 조용히 틀린다. */
export const PURCHASE_TABLE: Record<BundleKind, { table: string; col: string }> = {
  ebook: { table: 'ebook_purchases', col: 'ebook_id' },
  lecture: { table: 'lecture_purchases', col: 'lecture_id' },
}

/** 묶음 결제 할인율(%) — **한 카탈로그의 그 종류를 통으로 담았을 때만** 붙는다.
 *  ⚠️ 화면(src/pages/Ebooks.tsx 의 BUNDLE_OFF_PCT)과 **같은 값**이어야 한다. 어긋나면 화면에 뜬 금액과
 *     실제 청구액이 갈린다 — 결제에서 제일 나쁜 종류의 버그다. 값을 바꾸면 양쪽을 같이 고칠 것. */
export const BUNDLE_OFF_PCT = 10

export interface PaymentRow {
  id: string
  user_id: string
  provider: string
  order_id: string
  order_name: string
  product_type: ProductType
  product_ref: string
  /** 정가 — currency 의 **최소단위 정수**. 지금은 USD 라 센트다(100 = $1.00). 옛 행은 KRW 원 단위. */
  amount: number
  currency: string
  /** PG 에 실제로 청구한 금액·통화(주요 단위). 정가와 통화가 다를 수 있다(달러 정가 → 원화 청구). */
  charge_amount: number | null
  charge_currency: string | null
  /** 원화로 청구한 건의 주문 생성 시점 환율. 승인 때 다시 계산하지 않는다. */
  fx_rate: number | null
  status: string
  payment_key: string | null
  customer_key: string
  fulfilled_at: string | null
  confirmed_at: string | null
  created_at: string
  /** 응시료와 **함께 산 교재**(이북). 원서접수 화면의 '추천 교재 구매'. 없으면 null. */
  addon_ebook_id: string | null
  /** 그 교재의 정가(달러 센트). amount 에 이미 포함돼 있다 — 내역 표시·대사용이지 청구액이 아니다. */
  addon_amount: number | null
}

/** payments 행에서 읽어오는 컬럼 목록 — 한 곳에 모아 select 문이 함수마다 어긋나는 걸 막는다. */
export const PAYMENT_COLS =
  'id, user_id, provider, order_id, order_name, product_type, product_ref, amount, currency, charge_amount, charge_currency, fx_rate, status, payment_key, customer_key, fulfilled_at, confirmed_at, created_at, addon_ebook_id, addon_amount'

/**
 * **PG 에 말할 때 쓰는 금액·통화.** 승인 대조·조회·환불이 전부 이 값을 기준으로 해야 한다.
 * 정가(amount·KRW)와 다를 수 있다 — 엑심베이는 달러로 청구하기 때문이다.
 * ⚠️ 사용자에게 보여줄 가격이나 통계에는 쓰지 말 것. 그건 정가(amount) 소관이다.
 */
export function chargeOf(row: PaymentRow): { currency: string; amount: number } {
  return row.charge_amount != null && row.charge_currency
    ? { currency: row.charge_currency, amount: Number(row.charge_amount) }
    : { currency: row.currency, amount: row.amount }
}

/** 토스가 모르는 주문을 만료로 접기까지 기다리는 시간(분).
 *  결제 승인은 요청 후 10분 안에 해야 하므로, 그보다 넉넉히 지나야 "결제창까지 못 갔다"고 단정할 수 있다. */
const STALE_ORDER_MIN = 30

// ---------- ① 금액 재계산 ----------

export interface ResolvedProduct {
  ok: true
  /** 총 정가(달러 센트). **곁다리 교재가 있으면 그 값까지 더한 합계**다 — 결제창에 뜨는 금액이 이것이다. */
  amount: number
  orderName: string
  /** payments.product_ref 에 저장할 **정규화된** 값(DB 에서 읽은 원본). insert 는 반드시 이 값만 쓴다. */
  ref: string
  /** exam 전용 — create 사전검사(보유 응시권·응시 이력)가 exams.id 를 필요로 한다. ebook 에선 undefined. */
  exam?: { id: string; roundId: string; tier: string }
  /** 함께 담은 교재(응시료 전용). id 는 DB 에서 읽은 값이라 그대로 저장해도 된다. */
  addon?: { id: string; title: string; amount: number }
  /** 묶음(bundle) 전용 — payment_items 에 그대로 넣을 줄 목록. list=정가, amount=할인 반영 배분액.
   *  ⚠️ `kind` 가 줄의 상품 종류다(교재 묶음 / 강의 묶음). 한 묶음에 두 종류가 섞이지 않는다. */
  bundle?: { kind: BundleKind; catalog: string; discounted: boolean; lines: { itemId: string; list: number; amount: number }[] }
  /** 화면 주문요약에 줄 단위로 그릴 내역. 곁다리가 없으면 한 줄뿐이다. */
  items: { name: string; amount: number }[]
}

/**
 * 상품ID → **서버가 다시 뽑은** 가격과 상품명. 주문 생성과 (필요하면) 승인 직전에 여기만 쓴다.
 * 클라이언트가 보낸 금액을 저장해두고 그걸 비교하면 조작된 값끼리 비교하는 셈이라 의미가 없다.
 *
 * ⚠️ `ref` 를 돌려주는 이유 — payments_paid_product_uniq 는 product_ref **text 원문 비교**다.
 *    예전엔 클라가 보낸 문자열을 trim() 만 해서 저장했는데, UUID 대문자 표기나 공백 하나만 달라도
 *    같은 상품에 'paid' 행이 두 개 생겨 중복결제 방어가 통째로 무력화된다. 그래서 조회는 클라 문자열로 하되
 *    **저장은 DB 에서 읽은 값으로만** 한다(이북·응시료 둘 다).
 */
export async function resolveProduct(
  admin: SupabaseClient,
  productType: ProductType,
  productRef: string,
  lang: string,
  /** 응시료와 함께 담은 교재(이북) id. 응시료 결제에만 붙는다 — 다른 상품에 오면 400 으로 거절한다. */
  addonEbookId?: string | null,
  /** 묶음 결제로 담은 항목 id 들. bundle 에만 쓰인다(다른 유형에 오면 무시하지 않고 아래에서 거절). */
  bundleIds?: string[] | null,
  /** 묶음의 종류(교재/강의). bundle 에만 쓰인다. 안 주면 교재 — 옛 링크(kind 없음)가 그대로 동작해야 한다. */
  bundleKind?: BundleKind | null,
): Promise<ResolvedProduct | { ok: false; error: string; status: number }> {
  if (addonEbookId && productType !== 'exam') {
    // 조용히 무시하면 안 된다 — 사용자는 교재를 담았다고 믿는데 결제·지급에서만 사라진다.
    return { ok: false, error: '교재를 함께 담을 수 없는 상품입니다.', status: 400 }
  }
  if (bundleIds?.length && productType !== 'bundle') {
    return { ok: false, error: '묶음으로 담을 수 없는 상품입니다.', status: 400 }
  }

  // 묶음 결제 — productRef 는 카탈로그('leveltest' | 'caris'), 담은 목록은 bundleIds 로 온다.
  if (productType === 'bundle') {
    return resolveBundle(admin, bundleKind === 'lecture' ? 'lecture' : 'ebook', productRef, bundleIds ?? [], lang)
  }

  // 강의 시청권 — 이북과 같은 모양이다(단품 하나, 정가는 달러 센트).
  //   제목은 요청 언어로 준다(2026-08-26). 결제창·영수증에 뜨는 이름이라 화면에서 본 제목과 같아야 한다.
  if (productType === 'lecture') {
    const { data: lec } = await admin
      .from('lectures')
      .select('id, title, title_i18n, price_usd_cents, published')
      .eq('id', productRef)
      .maybeSingle()
    if (!lec || !lec.published) return { ok: false, error: '판매 중인 강의가 아닙니다.', status: 404 }

    const title = ((lec.title_i18n as Record<string, string> | null) ?? {})[lang] || (lec.title as string)
    const amount = (lec.price_usd_cents as number) ?? 0
    return {
      ok: true,
      amount,
      orderName: title.slice(0, 100),
      // ⚠️ DB 에서 읽은 id 로만 저장한다 — product_ref 는 text 원문 비교라 표기가 하나만 달라도
      //    같은 상품에 paid 행이 둘 생겨 중복결제 방어가 무력화된다(이북과 같은 이유).
      ref: lec.id as string,
      items: [{ name: title, amount }],
    }
  }

  if (productType === 'ebook') {
    const { data: book } = await admin
      .from('ebooks')
      .select('id, title, price_usd_cents, published, translations')
      .eq('id', productRef)
      .maybeSingle()
    if (!book || !book.published) return { ok: false, error: '판매 중인 이북이 아닙니다.', status: 404 }

    const tr = (book.translations as Record<string, { title?: string }> | null) ?? {}
    const title = tr[lang]?.title || (book.title as string)
    // 정가는 **달러 센트**다(2026-08-13 전환). 옛 price(원화 정수)는 읽지 않는다.
    const amount = (book.price_usd_cents as number) ?? 0
    return {
      ok: true,
      amount,
      // orderName 은 결제창·카드 명세서에 뜬다. 토스 상한 100자.
      orderName: title.slice(0, 100),
      ref: book.id as string,
      items: [{ name: title, amount }],
    }
  }

  // 자격증 발급비 — product_ref = attemptId(응시 하나). **발급비 = 그 응시 급수의 응시료와 동일**하다.
  //   금액을 여기서 지어내지 않고 exam_fees 를 그대로 다시 읽는다(정가 단일 출처).
  //   소유자·합격 판정은 create 핸들러가 uid 로 한다(여기선 금액만 뽑는다).
  //
  // ⚠️ **resolveExamOffer 를 쓰면 안 된다.** 그건 "응시권을 지금 팔 수 있나"까지 보는 함수라
  //    접수창(applyWindowOpen)을 강제하는데, 자격증 발급은 성적 공개 후 = 접수가 끝난 지 한참 뒤다.
  //    그대로 두면 모든 자격증 결제가 '접수 기간이 아닙니다'(400)로 막힌다. 급수 정가만 필요하다.
  // ⚠️ 응시권의 price_paid(실제 낸 돈)를 쓰지 않는 이유 = 관리자 수기 발급분이 0원이라 그대로 쓰면
  //    발급비 0원 = 무료 자격증이 된다. 정가표에 없는 급수는 아래에서 판매 불가로 접는다.
  if (productType === 'cert') {
    const { data: att } = await admin
      .from('exam_attempts')
      .select('id, exam_id')
      .eq('id', productRef)
      .maybeSingle()
    if (!att || !att.exam_id) return { ok: false, error: '응시 정보를 찾을 수 없습니다.', status: 404 }
    const { data: ex } = await admin
      .from('exams')
      .select('tier, title')
      .eq('id', att.exam_id as string)
      .maybeSingle()
    if (!ex) return { ok: false, error: '시험 정보를 찾을 수 없습니다.', status: 404 }
    const fee = await resolveExamFee(admin, ex.tier as string)
    if (!fee.ok) {
      // 정가 미책정 급수(관리자 수기 발급으로만 응시한 t2 등) — 임시 금액으로 때우지 않고 막는다.
      // 열려면 관리자 화면에서 그 급수 금액만 채우면 된다(코드 변경 불필요).
      const error = fee.code === 'no_fee' ? '자격증 발급비가 아직 책정되지 않았습니다.' : fee.error
      return { ok: false, error, status: fee.status }
    }
    // 결제창·카드 명세서에 뜨는 문구. exams.title 은 관리자가 넣은 한국어 고정값이라 그대로 쓴다
    // (회차명 다국어 투영은 응시료 쪽 규칙이고, 여기선 급수명이 곧 자격명이라 브랜드 표기가 맞다).
    const certName = `자격증 발급 · ${(ex.title as string) ?? ''}`.slice(0, 100)
    return {
      ok: true,
      amount: fee.amount,
      orderName: certName,
      ref: productRef, // attemptId(UUID) — 정규화 대상 아님
      items: [{ name: certName, amount: fee.amount }],
    }
  }

  // 응시료 — product_ref = "<round_id>:<tier>". 판매 가능 판정·금액·주문명은 전부 _shared/exam-tickets.ts 가 한다
  // (주문 생성과 지급이 같은 함수를 부르게 해서 "마감 뒤 승인"이 지급으로 이어지는 구멍을 한 곳에서 막는다).
  // ⚠️ 폴백 금액은 어떤 경우에도 지어내지 않는다 — 돈 받는 값이라 폴백이 곧 사고다.
  const parsed = parseExamRef(productRef)
  if (!parsed) return { ok: false, error: '상품 정보가 올바르지 않습니다.', status: 400 }
  const offer = await resolveExamOffer(admin, parsed.roundId, parsed.tier, lang)
  if (!offer.ok) return { ok: false, error: offer.error, status: offer.status }

  // 함께 담은 교재 — 금액도 제목도 **여기서 DB 를 다시 읽어** 뽑는다(클라가 보내는 건 책 id 하나뿐이다).
  const addon = addonEbookId ? await resolveEbookAddon(admin, addonEbookId, lang) : null
  if (addon && !addon.ok) return addon

  const items = [{ name: offer.orderName, amount: offer.amount }]
  if (addon?.ok) items.push({ name: addon.title, amount: addon.amount })

  return {
    ok: true,
    // 결제창에 뜨는 금액 = 합계. 응시권만 살 때와 같은 경로라 화면·서버가 다른 수를 말할 일이 없다.
    amount: offer.amount + (addon?.ok ? addon.amount : 0),
    // 카드 명세서엔 한 줄만 뜬다 — 두 개를 팔았다는 사실이 여기서 지워지면 안 되므로 제목을 이어 붙인다.
    orderName: (addon?.ok ? `${offer.orderName} + ${addon.title}` : offer.orderName).slice(0, 100),
    ref: offer.ref,
    exam: { id: offer.examId, roundId: offer.round.id, tier: offer.tier },
    addon: addon?.ok ? { id: addon.id, title: addon.title, amount: addon.amount } : undefined,
    items,
  }
}

/**
 * 묶음 결제 — 한 카탈로그의 **한 종류**(교재 여러 권 또는 강의 여러 편). **담은 목록·정가·할인을 전부
 * 서버가 다시 뽑는다.** 클라이언트가 보내는 건 종류·카탈로그·id 목록뿐이다(금액도 할인 여부도 요청에 없다).
 *
 * ⚠️ **할인 판정 때문에 그 카탈로그·그 종류의 전부를 읽어야 한다.** 담은 것만 읽으면 "전부 담았나" 를 알 수 없다.
 * ⛔ 할인 조건은 **판매 중인 전부를 다 담았을 때**다 — 이미 가진 것은 담을 수 없으므로, 하나라도
 *    보유한 사람은 이 할인을 못 받는다("7개를 통으로 사야만" — 2026-08-19 지시). 완화하려면 보유분을
 *    세트의 일부로 쳐야 하는데, 그건 화면(Ebooks.tsx)의 판정과 **한 벌로** 바꿔야 한다.
 * ⛔ **교재와 강의를 한 묶음에 섞지 않는다.** 섞으면 "한 종류를 통으로" 라는 할인 조건이 다른 말이 되고,
 *    화면에서도 어느 값이 어느 조건으로 깎였는지 안 갈린다(2026-08-19 결정).
 */
async function resolveBundle(
  admin: SupabaseClient,
  kind: BundleKind,
  catalog: string,
  ids: string[],
  lang: string,
): Promise<ResolvedProduct | { ok: false; error: string; status: number }> {
  if (catalog !== 'leveltest' && catalog !== 'caris') {
    return { ok: false, error: '상품 정보가 올바르지 않습니다.', status: 400 }
  }
  const isBook = kind === 'ebook'
  const notSelling = isBook ? '판매 중인 이북이 아닙니다.' : '판매 중인 강의가 아닙니다.'
  const want = [...new Set(ids.map((v) => String(v ?? '').trim()).filter(Boolean))]
  // 하나면 묶음이 아니다 — 단품 경로로 가야 정가·중복방어가 원래대로 동작한다.
  if (want.length < 2) return { ok: false, error: '묶음 결제는 두 개부터 담을 수 있습니다.', status: 400 }

  // 번역 제목이 담긴 자리가 서로 다르다 — 이북은 `translations[lang].title`(본문 번역과 한 덩어리),
  // 강의는 `title_i18n[lang]`(제목·소개 두 필드뿐이라 컬럼으로 둔다). 그래서 select 를 가른다.
  const { data } = await admin
    .from(isBook ? 'ebooks' : 'lectures')
    .select(isBook ? 'id, title, price_usd_cents, translations' : 'id, title, price_usd_cents, title_i18n')
    .eq('catalog', catalog)
    .eq('published', true)
  type Item = { id: string; title: string; price_usd_cents: number | null; translations?: unknown; title_i18n?: unknown }
  const all = (data ?? []) as Item[]
  const byId = new Map(all.map((b) => [b.id, b]))

  const picked = want.map((id) => byId.get(id))
  // 하나라도 그 카탈로그의 판매 중 목록에 없으면 통째로 거절한다 — 일부만 조용히 빼면 사용자가 담은 것과
  // 결제되는 것이 달라진다.
  if (picked.some((b) => !b)) return { ok: false, error: notSelling, status: 404 }
  const items = picked as Item[]

  const titleOf = (b: Item) => {
    const tr = (b.translations as Record<string, { title?: string }> | null) ?? {}
    const i18n = (b.title_i18n as Record<string, string> | null) ?? {}
    return tr[lang]?.title || i18n[lang] || b.title
  }
  const priceOf = (b: Item) => b.price_usd_cents ?? 0

  const listSum = items.reduce((sum, b) => sum + priceOf(b), 0)
  const discounted = items.length === all.length && listSum > 0
  const total = discounted ? Math.round((listSum * (100 - BUNDLE_OFF_PCT)) / 100) : listSum

  // 줄마다 얼마씩인지 배분한다(정가 비례). ⚠️ 마지막 줄에 잔액을 몰아줘야 **합이 정확히 total** 이 된다 —
  // 줄마다 반올림하면 1센트가 남거나 모자라 원장이 안 맞는다.
  let acc = 0
  const lines = items.map((b, i) => {
    const list = priceOf(b)
    const amount = i === items.length - 1 ? total - acc : Math.round((list * total) / (listSum || 1))
    acc += amount
    return { itemId: b.id, list, amount }
  })

  const first = titleOf(items[0])
  const unit = isBook ? '권' : '편'
  const orderName = (items.length > 1 ? `${first} 외 ${items.length - 1}${unit}` : first).slice(0, 100)

  return {
    ok: true,
    amount: total,
    orderName,
    // ⚠️ 저장은 **DB 에서 읽은 id** 를 정렬해 만든다(클라 문자열·순서 금지) — product_ref 는 text 원문 비교라
    //    순서만 달라도 같은 조합이 다른 상품으로 보여 '같은 묶음 재구매' 방어가 뚫린다.
    // ⚠️ 접두사가 종류를 담는다 — 같은 카탈로그의 교재 묶음과 강의 묶음이 서로 다른 상품이어야 한다.
    ref: `${kind}:${catalog}:${items.map((b) => b.id).sort().join('+')}`,
    bundle: { kind, catalog, discounted, lines },
    items: items.map((b, i) => ({ name: titleOf(b), amount: lines[i].amount })),
  }
}

/** 곁다리 교재의 제목·정가를 DB 에서 뽑는다. 판매 중이 아니면 결제 자체를 막는다. */
async function resolveEbookAddon(
  admin: SupabaseClient,
  ebookId: string,
  lang: string,
): Promise<{ ok: true; id: string; title: string; amount: number } | { ok: false; error: string; status: number }> {
  const { data: book } = await admin
    .from('ebooks')
    .select('id, title, price_usd_cents, published, translations')
    .eq('id', ebookId)
    .maybeSingle()
  if (!book || !book.published) return { ok: false, error: '판매 중인 교재가 아닙니다.', status: 404 }
  const tr = (book.translations as Record<string, { title?: string }> | null) ?? {}
  return {
    ok: true,
    // ⚠️ 저장은 **DB 에서 읽은 id** 로만 한다(클라 문자열 금지) — product_ref 정규화와 같은 이유다.
    id: book.id as string,
    title: tr[lang]?.title || (book.title as string),
    amount: (book.price_usd_cents as number) ?? 0,
  }
}

// ---------- 주문 식별자 ----------

/** 토스 orderId 규격: 6~64자, 영문·숫자와 `-_=` 만. UUID 의 하이픈은 허용 문자라 그대로 써도 된다. */
export function newOrderId(productType: ProductType): string {
  return `${productType}-${crypto.randomUUID()}`
}

/**
 * customerKey — **계정마다 한 번 만들어 고정**한다.
 * 토스 규격상 유추 가능한 값(이메일·회원ID·순번)은 금지고, 매번 새로 만들면 저장된 카드가 계정에 안 붙는다.
 */
export async function ensureCustomerKey(admin: SupabaseClient, uid: string): Promise<string> {
  const { data } = await admin
    .from('profiles')
    .select('payment_customer_key')
    .eq('id', uid)
    .maybeSingle()
  const existing = (data?.payment_customer_key as string | null) ?? null
  if (existing) return existing

  const key = crypto.randomUUID() // 36자 · '-' 포함 → 규격(2~50자, 특수문자 1개 이상) 충족

  // 아직 비어있을 때만 박는다(`.is(null)`). 동시 요청 둘이 겹쳐도 먼저 쓴 쪽 값이 살아남고,
  // 진 쪽은 아래에서 그 값을 다시 읽어 쓴다 — 계정당 키가 갈리면 저장된 카드가 계정에 안 붙는다.
  const { data: won } = await admin
    .from('profiles')
    .update({ payment_customer_key: key })
    .eq('id', uid)
    .is('payment_customer_key', null)
    .select('payment_customer_key')
    .maybeSingle()
  if (won?.payment_customer_key) return won.payment_customer_key as string

  // 못 박은 경우 = (a) 다른 요청이 먼저 박았거나 (b) profiles 행이 아직 없다.
  const { data: again } = await admin
    .from('profiles')
    .select('payment_customer_key')
    .eq('id', uid)
    .maybeSingle()
  if (again?.payment_customer_key) return again.payment_customer_key as string

  // (b) — 가입 트리거가 만들어주는 게 정상이지만, 없으면 결제를 막지 말고 여기서 만들어준다.
  const { error } = await admin
    .from('profiles')
    .upsert({ id: uid, payment_customer_key: key }, { onConflict: 'id' })
  if (error) throw new Error('결제 식별자를 만들 수 없습니다.')
  return key
}

// ---------- ② 지급 ----------

/**
 * 실제 지급. **승인(confirm) 성공 이후에만** 불린다.
 * 멱등이 생명이라 "이미 있으면 성공" 으로 처리한다 — 중복 방어의 본체는 DB 유니크 제약이다
 * (ebook_purchases.unique(user_id, ebook_id) + payments 의 부분 유니크 인덱스).
 */
async function grant(admin: SupabaseClient, row: PaymentRow): Promise<void> {
  // 이북·강의는 **같은 모양의 지급**이다(표만 다르다) — 갈래를 나누면 한쪽만 조용히 틀어진다.
  if (row.product_type === 'ebook' || row.product_type === 'lecture') {
    const { table, col } = PURCHASE_TABLE[row.product_type]
    const { error } = await admin.from(table).insert({
      user_id: row.user_id,
      [col]: row.product_ref,
      price_paid: row.amount,
      source: 'pg',
      payment_id: row.id,
      payment_ref: row.payment_key,
    })
    // 23505 = unique 위반 = 이미 보유 → 지급 완료로 본다.
    if (error && (error as { code?: string }).code !== '23505') throw new Error(error.message)
    return
  }

  // 자격증 발급비 — 지급물은 '발급 권한'이다. 실제 자격번호 채번은 my-attempts {issue} 가
  //   이 cert 결제(status='paid')를 확인한 뒤에 한다. 여기선 만들 지급물이 없다(멱등 no-op).
  //   결제가 paid + fulfilled 로 남고, 그게 "발급비를 냈다"는 게이트 증표다.
  if (row.product_type === 'cert') {
    return
  }

  // 묶음 — 줄 목록을 읽어 한 권씩 준다. 줄 하나가 막히면 던져서 대사(미지급)에 남긴다.
  if (row.product_type === 'bundle') {
    const { data, error } = await admin
      .from('payment_items')
      .select('product_type, product_ref, amount')
      .eq('payment_id', row.id)
    if (error) throw new Error(error.message)
    const lines = (data ?? []) as { product_type: string; product_ref: string; amount: number }[]
    // ⛔ 줄이 하나도 없으면 '지급 완료'로 접지 말 것 — 돈만 받은 건이 정상으로 보인다.
    if (lines.length === 0) throw new Error('묶음 주문의 줄 목록이 비어 있습니다 — 지급할 대상을 알 수 없습니다.')
    for (const line of lines) {
      if (line.product_type !== 'ebook') throw new Error(`묶음에 담을 수 없는 상품입니다: ${line.product_type}`)
      await grantEbookLine(admin, row, line.product_ref, line.amount, '묶음으로 산 교재')
    }
    return
  }

  if (row.product_type === 'exam') {
    const parsed = parseExamRef(row.product_ref)
    if (!parsed) throw new Error(`응시권 상품 정보를 읽을 수 없습니다: ${row.product_ref}`)

    // ⛔ **지급 시점에 상품을 다시 확인한다.** 예전엔 status==='paid' 이기만 하면 무조건 지급했는데,
    //    이 함수를 부르는 경로는 승인(confirm)·웹훅·대사(reconcile) 셋이고 전부 create 검사보다 나중이다.
    //    접수가 마감된 뒤 들어온 승인, 그 사이 관리자가 내려버린 급수가 전부 그대로 지급되고 있었다.
    //    여기서 던지면 payments 는 paid 인데 fulfilled_at 이 비어 대사 목록에 걸린다 = 사람이 환불을 판단한다.
    //    (자동 환불은 하지 않는다 — 돈을 되돌리는 건 되돌릴 수 없는 동작이라 자동화하지 않는 게 이 파일 방침이다.)
    //    ⚠️ 기준 시각은 **지금**이지 주문 생성 시각이 아니다. created_at 으로 보면 '접수 중에 만든 주문을
    //      며칠 뒤에 승인'하는 바로 그 구멍이 그대로 열린다. 대신 마감 직전 결제가 초 단위로 걸릴 수 있는데,
    //      그건 대사에 뜨고 사람이 판단한다(관리자 수기 발급 또는 환불).
    //    lang 은 orderName 조립에만 쓰여 여기선 의미가 없다.
    const offer = await resolveExamOffer(admin, parsed.roundId, parsed.tier, 'ko')
    if (!offer.ok) throw new Error(`응시권을 발급할 수 없습니다(${offer.code}): ${offer.error}`)

    const res = await grantExamTicket(admin, {
      userId: row.user_id,
      roundId: offer.round.id,
      tier: offer.tier,
      source: 'pg',
      paymentId: row.id,
      pricePaid: row.amount,
    })
    // live_conflict = 다른 출처가 이미 그 슬롯을 차지 → **이 결제분 응시권은 0장**이다.
    // '이미 지급'으로 접으면 fulfilled_at 이 찍혀 어느 대사 목록에도 안 걸린다(돈만 받은 건이 정상으로 보인다).
    if (!res.ok) throw new Error(res.error)

    // 함께 산 교재. 응시권 **뒤에** 준다 — 여기서 던지면 fulfilled_at 이 안 찍혀 대사가 다시 부르는데,
    // 그때 응시권 재발급은 exam_tickets_payment_uniq 가 흡수하므로 두 장이 나가지 않는다.
    await grantAddonEbook(admin, row)
    return
  }

  throw new Error(`지급 경로가 없는 상품 유형: ${row.product_type}`)
}

/** 응시료에 곁들여 산 교재의 열람권. 이북 단독 결제와 **같은 모양의 행**을 넣는다
 *  (source='pg' + payment_id) — 그래야 환불 회수·대사가 경로를 하나만 알면 된다. */
async function grantAddonEbook(admin: SupabaseClient, row: PaymentRow): Promise<void> {
  if (!row.addon_ebook_id) return
  await grantEbookLine(admin, row, row.addon_ebook_id, row.addon_amount ?? 0, '함께 산 교재')
}

/** 결제 한 건에 딸린 이북 열람권 한 줄. 곁다리(응시료)와 묶음이 **같은 함수**를 쓴다 —
 *  23505 를 어떻게 다루느냐가 이 기능의 핵심이라 두 벌로 두면 한쪽만 조용히 틀린다. */
async function grantEbookLine(
  admin: SupabaseClient,
  row: PaymentRow,
  ebookId: string,
  pricePaid: number,
  what: string,
): Promise<void> {
  const { error } = await admin.from('ebook_purchases').insert({
    user_id: row.user_id,
    ebook_id: ebookId,
    price_paid: pricePaid,
    source: 'pg',
    payment_id: row.id,
    payment_ref: row.payment_key,
  })
  if (!error) return
  if ((error as { code?: string }).code !== '23505') throw new Error(error.message)

  // 23505 = 이미 그 책을 갖고 있다. 두 가지가 섞여 있어서 그냥 흡수하면 안 된다:
  //   · 이 결제의 재시도(웹훅·대사가 다시 부름) → 흡수가 맞다. 이미 이 결제분이 나갔다.
  //   · **그 사이 /ebooks 에서 따로 산 책** → 같은 책을 두 번 낸 것이다. 여기서 조용히 '지급 완료'로
  //     접으면 fulfilled_at 이 찍혀 어느 목록에도 안 걸리고, 아무도 이중 청구를 모른다.
  //     던져서 대사(미지급 목록)에 남긴다 — 응시권은 이미 나갔고, 사람이 책값만 환불하면 된다.
  const { data: mine } = await admin
    .from('ebook_purchases')
    .select('payment_id')
    .eq('user_id', row.user_id)
    .eq('ebook_id', ebookId)
    .maybeSingle()
  if ((mine as { payment_id: string | null } | null)?.payment_id === row.id) return
  throw new Error(`${what}를 이미 다른 경로로 보유 중입니다 — 그 몫의 환불이 필요합니다.`)
}

// ---------- ②-b 환불 시 자동 회수 ----------

/**
 * 환불된 결제(refunded)에 딸린 지급물을 **되돌린다.** 환불은 사람이 토스 대시보드에서 하고(코드는 안 함),
 * 그 결과 웹훅이 status 를 refunded 로 바꾸는 순간 여기가 불린다.
 *
 * ⛔ **회수 대상은 이 결제(row.id)로 지급된 것 하나뿐이다.** 사용자·상품이 아니라 **payment_id 로만** 특정한다.
 *    grant 가 지급물마다 payment_id 를 박아두므로(ebook_purchases.payment_id · exam_tickets.payment_id),
 *    이 한 건만 정확히 짚을 수 있다. 다른 구매·다른 응시권은 절대 건드리지 않는다.
 *
 * 안 쓴 것만 자동으로 회수한다:
 *   · 이북 → 열람권 삭제(열람은 소모가 아니라 접근권이라, 환불이면 그냥 회수).
 *   · 미사용(issued) 응시권 → void.
 *   · **이미 소비(consumed)된 응시권은 자동 회수하지 않는다** — 시험을 시작한 뒤라 성적·자격증 처리가
 *     정책 판단이다. 대사 목록에 남겨 사람이 본다(fulfilled_at 을 그대로 둬서 회수 스캔에 계속 뜨게 한다).
 *
 * @returns fulfilled — 회수 후에도 지급물이 남아있나(=사람 손이 더 필요한가). note — 대사·로그용 사유.
 */
async function revokeForRefund(
  admin: SupabaseClient,
  row: PaymentRow,
): Promise<{ fulfilled: boolean; note: string }> {
  const clearFulfilled = async () => {
    // 회수를 마쳤으면 fulfilled_at 을 비운다 → reconcile 의 '회수 필요' 스캔에서 빠진다(처리됨 표시).
    await admin.from('payments').update({ fulfilled_at: null, updated_at: new Date().toISOString() }).eq('id', row.id)
  }

  // 묶음도 이북과 같은 경로다 — 이 결제로 나간 열람권은 전부 payment_id 가 박혀 있어 한 번에 짚인다.
  if (row.product_type === 'ebook' || row.product_type === 'bundle') {
    // payment_id + user_id 로 **이 결제분만** 삭제. 같은 책을 다른 경로로 또 샀어도 그건 안 건드린다.
    await admin.from('ebook_purchases').delete().eq('payment_id', row.id).eq('user_id', row.user_id)
    await clearFulfilled()
    return { fulfilled: false, note: '환불 — 이북 열람권 자동 회수' }
  }

  if (row.product_type === 'exam') {
    // 함께 산 교재부터 회수한다 — 열람은 소모가 아니라 접근권이라 응시권 상태와 무관하게 되돌릴 수 있다.
    // (응시를 이미 시작한 건이라 아래에서 fulfilled 를 유지하더라도, 책은 회수한 채로 사람 판단을 기다린다.)
    const addonNote = row.addon_ebook_id ? ' + 교재 열람권 회수' : ''
    if (row.addon_ebook_id) {
      await admin.from('ebook_purchases').delete().eq('payment_id', row.id).eq('user_id', row.user_id)
    }

    // 이 결제로 발급된 응시권 하나(payment_id 로 특정).
    const { data: t } = await admin
      .from('exam_tickets')
      .select('id, status')
      .eq('payment_id', row.id)
      .maybeSingle()
    const ticket = t as { id: string; status: string } | null
    if (!ticket) {
      await clearFulfilled()
      return { fulfilled: false, note: `환불 — 회수할 응시권 없음${addonNote}` }
    }
    if (ticket.status === 'consumed') {
      // 시험을 이미 시작함 — 자동 회수 금지. 사람이 성적·자격증까지 보고 판단한다(fulfilled 유지).
      return { fulfilled: true, note: `환불 — 응시 후 건이라 자동 회수 안 함(성적·자격증 판단 필요)${addonNote}` }
    }
    if (ticket.status === 'issued') {
      await voidTicket(admin, ticket.id, '결제 환불로 자동 회수')
      await clearFulfilled()
      return { fulfilled: false, note: `환불 — 미사용 응시권 자동 회수(void)${addonNote}` }
    }
    // 이미 void/expired — 회수할 게 없다.
    await clearFulfilled()
    return { fulfilled: false, note: `환불 — 응시권이 이미 ${ticket.status}${addonNote}` }
  }

  return { fulfilled: Boolean(row.fulfilled_at), note: '환불 — 회수 경로 없는 상품' }
}

/**
 * 토스가 알려준 결제 상태를 우리 DB 에 반영하고, 지급까지 필요한 만큼 진행한다.
 * 승인 응답으로 불려도, 웹훅으로 불려도, 수습(sweep)으로 불려도 결과가 같아야 한다.
 *
 * 순서가 중요하다 — **지급 먼저, fulfilled_at 은 나중**.
 * 반대로 하면 지급 도중 실패했을 때 "이미 줬다"고 기록만 남아 미지급을 영영 못 찾는다.
 * 지급은 유니크 제약 덕에 두 번 불려도 안전하므로 이 순서가 손해가 없다.
 */
export async function settleFromProvider(
  admin: SupabaseClient,
  row: PaymentRow,
  pp: ProviderPayment,
): Promise<{ status: string; fulfilled: boolean; note?: string }> {
  // 종결(환불·취소)된 주문은 settle 이 되살리지 않는다 — PG 재조회/desync 로 뒤늦게 불려도
  //   상태를 덮거나 재지급하지 않는다(무단 지급·회수신호 언두 방지). paid 재지급은 아래 fulfilled 로 막힌다.
  if (row.status === 'refunded' || row.status === 'canceled') {
    return { status: row.status, fulfilled: Boolean(row.fulfilled_at) }
  }
  const fulfilled = Boolean(row.fulfilled_at)
  // ⚠️ 어댑터는 취소를 늘 'canceled' 로 준다(우리 DB 를 모르니까). **지급까지 갔다가 취소된 건 환불**이므로
  //    여기서만 canceled→refunded 로 업그레이드한다(어댑터는 우리 DB 의 fulfilled 를 모르니 늘 canceled 로 준다)
  //    — 취소가 아닌 상태는 fulfilled 를 안 봤고, 취소일 때만 fulfilled 로 갈렸다.
  const next = pp.status === 'canceled' && fulfilled ? 'refunded' : pp.status

  const patch: Record<string, unknown> = {
    status: next,
    payment_key: pp.providerKey ?? row.payment_key,
    raw: pp.raw as Record<string, unknown>,
    updated_at: new Date().toISOString(),
  }
  // 응답에 결제수단이 없을 때 null 로 덮어쓰면 이미 알던 값을 잃는다 — 있을 때만 쓴다.
  if (pp.method) patch.method = pp.method
  if ((next === 'paid' || next === 'waiting_deposit') && !row.confirmed_at) {
    patch.confirmed_at = pp.approvedAt ?? new Date().toISOString()
  }
  const { error: upErr } = await admin.from('payments').update(patch).eq('id', row.id)
  if (upErr) {
    // ⚠️ 이 UPDATE 는 조용히 실패할 수 있다 — status 를 'paid' 로 올리는 순간
    //    payments_paid_product_uniq(user_id, product_type, product_ref) 에 걸리는 경우가 있다(= 중복 결제).
    //    예전엔 결과를 안 봐서 그대로 지급 + fulfilled_at 을 찍고, 정작 행은 영원히 pending 이라
    //    reconcile 이 매번 '고쳤다'고 보고하는 유령 루프가 됐다. 여기서 멈춘다.
    const dup = (upErr as { code?: string }).code === '23505'
    throw new Error(dup ? '같은 상품에 이미 완료된 결제가 있습니다(중복 결제).' : upErr.message)
  }

  // ⛔ 환불로 넘어온 건: **이 결제로 지급된 것만** 자동 회수한다(안 쓴 이북·미사용 응시권).
  //    fulfilled 였을 때만 회수할 게 있다. 회수 대상은 payment_id 로만 특정 → 다른 구매는 안 건드린다.
  //    응시 후(consumed) 건은 자동 회수하지 않고 대사 목록에 남는다(revokeForRefund 안에서 fulfilled 유지).
  if (next === 'refunded' && fulfilled) {
    return { status: next, ...(await revokeForRefund(admin, row)) }
  }

  // 여기서 가상계좌(waiting_deposit)가 걸러진다 — **발급됐을 뿐 입금 전**이라 지급하면 돈 안 받고 물건을 준다.
  if (next !== 'paid' || fulfilled) return { status: next, fulfilled }

  // ⛔ 결정 D3 — **응시료는 카드·간편결제만.** 가상계좌로 들어온 응시료는 입금이 끝나(paid) 여기 와도 지급하지 않는다.
  //    VA 는 입금까지 며칠이 걸려 '접수 마감 뒤에 paid 가 되는 것'이 정상 동작이라, 그때 응시권을 주면 마감이 무의미해진다.
  //    결제는 그대로 두고 fulfilled_at 을 비워 **대사 목록으로 넘긴다**(사람이 환불 판단 — 자동 환불은 하지 않는다).
  //    ⚠️ 여기서 던지지 않는 이유: 이 경로는 입금 웹훅이라 500 을 주면 토스가 계속 재시도한다.
  //      note 로 돌려주면 resettle→reconcile 이 mismatched 목록에 담아 사람 눈에 띈다.
  //    판별은 method 문자열('가상계좌')만 믿지 않는다 — 응답에 method 가 없을 수 있어 virtualAccount 객체와
  //    직전 상태(waiting_deposit)까지 같이 본다.
  //    판별: PG 응답 기준(pp.isVirtualAccount)에 우리 DB 직전 상태(waiting_deposit)를 OR 로 더한다.
  const isVirtualAccount = pp.isVirtualAccount || row.status === 'waiting_deposit'
  if (row.product_type === 'exam' && isVirtualAccount) {
    return { status: next, fulfilled: false, note: '가상계좌로 결제된 응시료 — 자동 발급 대상이 아님(환불 필요)' }
  }

  // ⛔ **지급 실패를 결제 실패로 만들지 마라.** 여기 도달했다는 건 토스 승인이 끝나 **돈이 이미 빠졌다**는 뜻이다.
  //    예전엔 grant 가 던지면 그 예외가 confirm 밖으로 나가 500 이 되고, 화면은 '결제 실패'를 그렸다.
  //    사용자는 돈이 안 빠진 줄 알고 다시 결제하려다 이번엔 '이미 결제 완료' 를 보게 된다 — 두 화면이 정반대로 말한다.
  //    그래서 지급 실패는 **결제 성공 + 발급 보류**로 돌려준다. payments 는 paid 인데 fulfilled_at 이 비어 있으니
  //    대사(reconcile)의 '미지급' 목록에 그대로 걸리고, 사람이 수기 발급이나 환불을 판단한다.
  try {
    await grant(admin, { ...row, payment_key: pp.providerKey ?? row.payment_key })
  } catch (e) {
    return {
      status: next,
      fulfilled: false,
      note: e instanceof Error ? e.message : '지급 처리 중 오류',
    }
  }
  await admin
    .from('payments')
    .update({ fulfilled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', row.id)
  return { status: next, fulfilled: true }
}

// ---------- ③ 미완결 수습 ----------

/**
 * 한 건을 토스에 다시 물어서 우리 상태를 맞춘다.
 * paymentKey 를 아직 모를 수 있다(사용자가 인증하고 결제창을 닫아버린 경우) → 그때는 orderId 로 조회한다.
 * 토스에 그런 주문이 아예 없으면(404) 결제가 시작도 안 된 것이니 건드리지 않는다 — 시간이 지나면 만료 처리된다.
 */
export async function resettle(
  admin: SupabaseClient,
  row: PaymentRow,
): Promise<{ orderId: string; status: string; fulfilled: boolean; note?: string }> {
  const provider = getProvider(row.provider)
  // 조회에 주문의 금액·통화를 같이 넘긴다 — 엑심베이 retrieve 는 이 둘이 **필수**라 없으면 조회 자체가 실패한다.
  // ⚠️ 정가(amount)가 아니라 **실제 청구값**이다. 엑심베이엔 달러로 보냈으므로 원화로 물으면 못 찾는다.
  //    출처는 반드시 저장된 행이다(콜백·요청 값 금지).
  const q = chargeOf(row)
  const res = row.payment_key
    ? await provider.queryByKey(row.payment_key, q)
    : await provider.queryByOrderId(row.order_id, q)

  if (!res.ok) {
    // ⚠️ 만료로 접는 조건이 좁은 데는 이유가 있다. expired 가 되면 다음 대사 대상에서 빠지므로,
    //    잘못 접으면 실제로 승인된 결제를 영영 못 찾는다(= 돈은 받고 물건은 안 준 채로 모르는 상태).
    //    그래서 **"그런 결제가 없다"고 PG 가 확인해준 오류일 때만**(error.absent) 접는다.
    //    HTTP 404 만 보면 안 된다 — 토스 NOT_FOUND_MERCHANT(상점/키 설정 문제)도 404 로 오고,
    //    그건 결제가 살아있어도 뜬다. absent 판정은 어댑터가 한다. 일시적 5xx·타임아웃은 당연히 제외.
    const ageMin = (Date.now() - new Date(row.created_at).getTime()) / 60000
    // 선점만 하고 끊긴 주문('confirming')도 여기서 수렴시킨다 — 안 그러면 그 상품이 영영 잠긴다.
    const onItsWay = row.status === 'pending' || row.status === 'confirming'
    if (res.error.absent && onItsWay && ageMin > STALE_ORDER_MIN) {
      await admin
        .from('payments')
        .update({ status: 'expired', fail_code: res.error.code, updated_at: new Date().toISOString() })
        .eq('id', row.id)
        .in('status', ['pending', 'confirming']) // 그 사이 승인됐으면 건드리지 않는다
      return { orderId: row.order_id, status: 'expired', fulfilled: false }
    }
    return { orderId: row.order_id, status: row.status, fulfilled: Boolean(row.fulfilled_at), note: res.error.code }
  }
  const out = await settleFromProvider(admin, row, res.data)
  return { orderId: row.order_id, ...out }
}

// ---------- ④ 대사 ----------

/**
 * 어긋난 결제만 골라낸다. 목표는 무결점이 아니라 **어긋난 걸 자동으로 알아채는 것**이다.
 *   · unconfirmed : 우리는 pending/입금대기인데 토스에선 이미 승인됨 → 돈은 받았는데 물건이 없다
 *   · unfulfilled : 승인은 됐는데 지급이 안 됨 → 다시 주면 된다
 *   · revoked     : 우리는 지급했는데 토스에선 취소됨 → 권한 회수 대상(사람이 판단)
 *
 * ⚠️ 한계: **우리 DB 에 행 자체가 없는 토스 거래**는 여기서 못 잡는다. 그건 토스 거래대사 API 로
 *    기간 조회를 해야 하는데, 그 API 스펙을 확인하기 전에 코드를 지어내지 않았다. 실키 붙일 때 추가할 것.
 */
export async function reconcile(
  admin: SupabaseClient,
  limit: number,
): Promise<{ checked: number; fixed: unknown[]; mismatched: unknown[] }> {
  const { data: rows } = await admin
    .from('payments')
    .select(PAYMENT_COLS)
    // 'confirming' 은 선점만 하고 끊긴 주문이다. 대사가 유일한 수습 경로라 반드시 포함해야 한다.
    .or('status.in.(pending,confirming,waiting_deposit),and(status.eq.paid,fulfilled_at.is.null)')
    .order('created_at', { ascending: true })
    .limit(limit)

  const list = (rows ?? []) as PaymentRow[]
  const fixed: unknown[] = []
  const mismatched: unknown[] = []

  for (const row of list) {
    const before = row.status
    const beforeFulfilled = Boolean(row.fulfilled_at)
    try {
      const after = await resettle(admin, row)
      if (after.status !== before || after.fulfilled !== beforeFulfilled) {
        fixed.push({ orderId: row.order_id, from: before, to: after.status, fulfilled: after.fulfilled })
      } else if (after.note) {
        mismatched.push({ orderId: row.order_id, status: before, reason: after.note })
      }
    } catch (e) {
      mismatched.push({ orderId: row.order_id, status: before, reason: e instanceof Error ? e.message : '오류' })
    }
  }

  // 지급했는데 토스에서 취소된 건 — 위 루프의 대상(pending/미지급)이 아니라 따로 훑는다.
  // ⚠️ 이 목록은 **사람이 처리해야 사라진다**(자동 회수는 하지 않는다 — 권한을 자동으로 뺏는 건 위험하다. 결정 D5).
  //    처리 = ebook: ebook_purchases 행 삭제 / exam: exam_tickets 를 void 로(관리자 회수 액션)
  //          → 그 다음 payments.fulfilled_at 을 null 로. 그래야 다음 대사에서 빠진다.
  // ⚠️ 응시권은 회수해도 payments 는 paid 그대로라 payments_paid_product_uniq 가 계속 걸린다 —
  //    같은 회차·급수를 다시 팔아야 한다면 결제 행 상태까지 같이 정리해야 한다.
  // '지급됐는데(fulfilled) 살아있는 결제(paid)가 아닌' 모든 행 = 물건은 나갔는데 결제가 환불·취소·실패·만료.
  //   refunded 만 보면, 어떤 경로로 refunded→failed 로 덮인 고아(status=failed & fulfilled)는 놓친다.
  //   그래서 종결 4상태를 전부 훑어 "돈은 안 살아있는데 물건은 살아있는" 건을 회수 목록에 담는다.
  const { data: paidRows } = await admin
    .from('payments')
    .select(PAYMENT_COLS)
    .in('status', ['refunded', 'canceled', 'failed', 'expired'])
    .not('fulfilled_at', 'is', null)
    .order('created_at', { ascending: true }) // 오래된 것부터 — limit 로 잘릴 때 최신만 남으면 옛 건이 영영 안 보인다
    .limit(limit)
  for (const r of (paidRows ?? []) as PaymentRow[]) {
    const what = r.product_type === 'exam' ? '응시권' : '이북 열람권'
    mismatched.push({ orderId: r.order_id, status: r.status, reason: `결제가 ${r.status}인데 ${what}이 남아있음 — 회수 필요` })
  }

  return { checked: list.length, fixed, mismatched }
}
