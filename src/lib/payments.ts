// 결제 프론트 — 주문 생성/승인 호출.
//   흐름: [주문 생성(서버)] → [엑심베이 결제창] → /pay/success → [승인(서버)] → 지급
//   금액은 **서버가 상품ID로 다시 계산한 값**만 쓴다. 여기서 금액을 만들어 보내는 API 는 일부러 없다.
//
//   PG 는 엑심베이 하나다(2026-08-13, 토스 제거). 국내/해외는 PG 가 아니라 **서버가 사용자 국가로**
//   MID·통화를 갈라서 정한다 — 프론트는 어느 쪽인지 고르지 않고 결과(charge)만 받아 보여준다.
//   ⚠️ 그래서 이 파일엔 PG 클라이언트 키가 없다. 결제창을 여는 데 필요한 건 서버가 주는 FGKey 뿐이다.
import { callFunction } from './supabase'

export type ProductType = 'ebook' | 'exam' | 'cert'

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
  /** 이 주문이 열린 PG. 지금은 항상 'eximbay'. */
  provider?: string
  /**
   * **실제로 청구되는** 금액·통화. 정가(`amount`, 달러 센트)와 단위·통화가 다르다 — 한국은 원화로 빠진다.
   * ⚠️ 상품 가격 표시에는 쓰지 말 것(그건 `amount`). 이건 "얼마가 빠지는지" 고지문 전용이다.
   */
  charge?: { currency: string; amount: number }
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

export function createOrder(productType: ProductType, productRef: string, lang: string) {
  return callFunction<CreateOrderResp>('payments', { action: 'create', productType, productRef, lang })
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

/** 결제 결과 화면 주소. 엑심베이는 서버가 만들어 /ready 에 실어 보내므로 프론트가 쓸 일은 없지만,
 *  결과 화면이 자기 주소를 만들 때 쓴다. */
export const successUrl = () => `${window.location.origin}/pay/success`
