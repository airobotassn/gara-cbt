// 결제 프론트 — 주문 생성/승인 호출과 토스 SDK 로딩.
//   흐름: [주문 생성(서버)] → [결제창(토스)] → successUrl → [승인(서버)] → 지급
//   금액은 **서버가 상품ID로 다시 계산한 값**만 쓴다. 여기서 금액을 만들어 보내는 API 는 일부러 없다.
//   붙이기 전 필독: docs/토스페이먼츠-연동-가드레일.md
import { callFunction } from './supabase'

/** 브라우저에 노출되는 값이라 프론트 환경변수가 맞다 — 이 키만으로는 결제를 승인할 수 없다.
 *  ⚠️ 반드시 **결제위젯 연동 키**('API 개별 연동 키'가 아니다). */
export const TOSS_CLIENT_KEY = (import.meta.env.VITE_TOSS_CLIENT_KEY as string | undefined) ?? ''
export const isPaymentConfigured = Boolean(TOSS_CLIENT_KEY)

export type ProductType = 'ebook' | 'exam' | 'cert'

/** 결제대행사. **개발 단계 비교용**으로 체크아웃에서 고를 수 있게 열어둔 것이다(2026-08-11).
 *  실제 서비스에서는 통화·카드 국적으로 갈릴 자리다 — 국내 원화=토스, 해외=엑심베이. */
export type Pg = 'toss' | 'eximbay'

/** 엑심베이 결제창에 그대로 넘길 값. **서버가 /ready 에 보낸 것과 글자 하나까지 같아야 한다** —
 *  FGKey 가 그 값들의 서명이라 프론트가 하나라도 고치면 결제창이 실패한다. 그래서 여기서 조립하지 않는다. */
export interface EximbayLaunch {
  sdkUrl: string
  fgkey: string
  payload: Record<string, unknown>
}

export interface CreateOrderResp {
  /** 0원 상품 — 결제창을 타지 않고 서버가 바로 지급했다는 뜻. */
  free?: boolean
  granted?: boolean
  orderId?: string
  orderName?: string
  amount?: number
  currency?: string
  customerKey?: string
  /** 이 주문이 열린 PG. 프론트는 이 값으로 결제창 종류를 고른다. */
  provider?: Pg
  /**
   * **실제로 청구되는** 금액·통화. 정가(`amount`, 원화)와 다를 수 있다 — 해외 결제는 달러로 빠진다.
   * ⚠️ 상품 가격 표시에는 쓰지 말 것(그건 `amount`). 이건 "얼마가 빠지는지" 고지문 전용이다.
   */
  charge?: { currency: string; amount: number }
  /** provider==='eximbay' 일 때만 온다. */
  eximbay?: EximbayLaunch
  /** 'test' | 'live' — 실키/테스트키 혼용을 화면에서 알아채기 위한 표시용. */
  env?: 'test' | 'live'
  owned?: boolean
}

export interface PaymentStatusResp {
  status: 'pending' | 'waiting_deposit' | 'paid' | 'canceled' | 'refunded' | 'failed' | 'expired'
  fulfilled: boolean
  productType: ProductType
  productRef: string
  orderName?: string
  amount?: number
  currency?: string
}

export function createOrder(productType: ProductType, productRef: string, lang: string, pg: Pg) {
  return callFunction<CreateOrderResp>('payments', { action: 'create', productType, productRef, lang, pg })
}

/**
 * successUrl 에서 받은 값을 서버로 넘겨 승인시킨다. 서버가 저장된 주문 금액과 대조한 뒤에만 PG 를 부른다.
 * `rawQuery` 는 엑심베이 전용 — 결제창이 돌려준 쿼리스트링 **원문**이다(서버가 /verify 로 위변조를 검증한다).
 * ⚠️ 손대지 말고 받은 그대로 넘길 것. 파싱해서 다시 조립하면 인코딩·순서가 달라져 검증이 깨진다.
 */
export function confirmOrder(args: {
  paymentKey: string
  orderId: string
  amount: number
  rawQuery?: string
}) {
  return callFunction<PaymentStatusResp>('payments', { action: 'confirm', ...args })
}

export function orderStatus(orderId: string) {
  return callFunction<PaymentStatusResp>('payments', { action: 'status', orderId })
}

/** 결제 결과 화면이 돌아올 주소 — 결제창은 새 페이지로 리다이렉트되므로 절대 URL 이어야 한다. */
export const successUrl = () => `${window.location.origin}/pay/success`
export const failUrl = () => `${window.location.origin}/pay/fail`
