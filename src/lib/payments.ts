// 결제 프론트 — 주문 생성/승인 호출.
//   흐름: [주문 생성(서버)] → [엑심베이 결제창] → /pay/success → [승인(서버)] → 지급
//   금액은 **서버가 상품ID로 다시 계산한 값**만 쓴다. 여기서 금액을 만들어 보내는 API 는 일부러 없다.
//
//   PG 는 엑심베이 하나다(2026-08-13, 토스 제거). 국내/해외는 PG 가 아니라 **서버가 사용자 국가로**
//   MID·통화를 갈라서 정한다 — 프론트는 어느 쪽인지 고르지 않고 결과(charge)만 받아 보여준다.
//   ⚠️ 그래서 이 파일엔 PG 클라이언트 키가 없다. 결제창을 여는 데 필요한 건 서버가 주는 FGKey 뿐이다.
import { callFunction } from './supabase'

export type ProductType = 'ebook' | 'exam' | 'cert' | 'bundle' | 'lecture'

/** 묶음 한 건에 담기는 종류(교재 묶음 / 강의 묶음). 한 묶음에 두 종류를 섞지 않는다.
 *  ⚠️ 서버 _shared/payments.ts 의 BundleKind 와 같은 값이어야 한다. */
export type BundleKind = 'ebook' | 'lecture'

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
  /** 총 정가(달러 센트). 응시료에 교재를 함께 담았으면 **합계**다. */
  amount?: number
  /** 주문 내역(줄 단위). 응시료+교재처럼 두 건일 때 화면이 각각을 보여주기 위한 값. */
  items?: { name: string; amount: number }[]
  currency?: string
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
  status: 'pending' | 'paid' | 'canceled' | 'refunded' | 'failed' | 'expired'
  fulfilled: boolean
  productType: ProductType
  productRef: string
  orderName?: string
  amount?: number
  currency?: string
  /** failed·refunded 일 때 사유 코드. DUPLICATE_CHARGED = 같은 상품을 두 번 산 두 번째 결제(돈은 빠졌고 환불 대상/환불됨). */
  failCode?: string | null
}

/**
 * 주문 생성. `addonEbookId` 는 원서접수 화면에서 **함께 담은 교재**(응시료 결제 전용)다.
 * ⚠️ 금액은 넘기지 않는다 — 책값도 서버가 그 id 로 DB 에서 다시 뽑는다.
 */
export function createOrder(
  productType: ProductType,
  productRef: string,
  lang: string,
  addonEbookId?: string | null,
  /** 묶음 결제(type='bundle')로 담은 id 들. productRef 는 그때 카탈로그('leveltest'|'caris')다.
   *  ⚠️ 금액도 할인 여부도 안 보낸다 — 서버가 이 id 들로 DB 에서 다시 뽑고 '전부 담았나'도 서버가 판정한다. */
  ids?: string[] | null,
  /** 묶음의 종류. 안 보내면 서버가 교재로 읽는다(옛 링크 호환). */
  kind?: BundleKind | null,
) {
  return callFunction<CreateOrderResp>('payments', {
    action: 'create',
    productType,
    productRef,
    lang,
    ...(addonEbookId ? { addonEbookId } : {}),
    ...(ids?.length ? { ids } : {}),
    ...(kind ? { kind } : {}),
  })
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

/**
 * 취소·환불 규정 동의를 결제 건에 기록하고 **결제창을 열어도 되는지** 서버가 판정한다. 결제창을 열기 직전에,
 * 다시 열 때도 매번 부른다. 엑심베이는 팝업 안에서 돈이 빠지므로 여기가 돈이 빠지기 전 마지막 관문이다(2026-09-21).
 * 거절이면 `FunctionError.code` 로 온다 — already_paid(다른 탭에서 방금 삼) · in_progress(다른 탭의 승인이 도는 중) ·
 * window_open(다른 창의 결제창이 살아 있음) · order_closed(이 주문은 닫힘). 그때 팝업을 열면 안 된다.
 * ⚠️ 실패하면 결제창을 열지 말 것 — 동의 기록 없이 돈만 빠지면 그 건은 증거가 없다.
 */
export function agreeTerms(orderId: string) {
  return callFunction<{ ok: true; agreedAt: string }>('payments', { action: 'agree', orderId })
}

/** 결제창이 아직 열려 있다는 신호. 팝업이 열려 있는 동안 20초마다 — 60초 넘게 끊기면 서버가 그 표시를 죽은 것으로 본다. */
export function heartbeat(orderId: string) {
  return callFunction<{ ok: true }>('payments', { action: 'heartbeat', orderId })
}

/** 결제창 표시를 내린다(팝업이 닫힘 · 화면을 떠남). 주문 상태는 안 바꾼다 — 닫았다가 다시 열 수 있다. */
export function releaseWindow(orderId: string) {
  return callFunction<{ ok: true }>('payments', { action: 'release', orderId })
}

/** 결제창에서 취소/실패로 돌아왔을 때 — 열린 주문을 failed(USER_CANCEL)로 접는다. 나중에 웹훅이 paid 라고 하면 서버가 되살린다. */
export function cancelOrder(orderId: string) {
  return callFunction<{ ok: true; closed: boolean }>('payments', { action: 'cancel', orderId })
}

export function orderStatus(orderId: string) {
  return callFunction<PaymentStatusResp>('payments', { action: 'status', orderId })
}

/** 결제 결과 화면 주소. 엑심베이는 서버가 만들어 /ready 에 실어 보내므로 프론트가 쓸 일은 없지만,
 *  결과 화면이 자기 주소를 만들 때 쓴다. */
export const successUrl = () => `${window.location.origin}/pay/success`
