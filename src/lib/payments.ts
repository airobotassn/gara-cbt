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

export interface CreateOrderResp {
  /** 0원 상품 — 결제창을 타지 않고 서버가 바로 지급했다는 뜻. */
  free?: boolean
  granted?: boolean
  orderId?: string
  orderName?: string
  amount?: number
  currency?: string
  customerKey?: string
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

/** successUrl 에서 받은 값을 서버로 넘겨 승인시킨다. 서버가 저장된 주문 금액과 대조한 뒤에만 토스를 부른다. */
export function confirmOrder(args: { paymentKey: string; orderId: string; amount: number }) {
  return callFunction<PaymentStatusResp>('payments', { action: 'confirm', ...args })
}

export function orderStatus(orderId: string) {
  return callFunction<PaymentStatusResp>('payments', { action: 'status', orderId })
}

/** 결제 결과 화면이 돌아올 주소 — 결제창은 새 페이지로 리다이렉트되므로 절대 URL 이어야 한다. */
export const successUrl = () => `${window.location.origin}/pay/success`
export const failUrl = () => `${window.location.origin}/pay/fail`
