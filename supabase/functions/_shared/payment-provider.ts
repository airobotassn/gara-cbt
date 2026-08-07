// 결제대행사(PG) 포트 — 승인·조회를 PG 중립 형태로 추상화한다.
//
// 왜 있나: 지금은 토스뿐이지만 해외 결제(엑심베이 등)를 얹을 수 있다. 그때 **토스 코드를 열지 않고**
//   어댑터 파일 하나(_shared/eximbay.ts)를 추가하고 아래 getProvider 에 한 줄 더하면 끝이게 하려는 것이다.
//   payments.ts(지급·멱등·수습)와 payments 함수(주문·승인 흐름)는 이 포트만 알고 PG 를 모른다.
//
// ⚠️ 이 포트는 **결제 시작(위젯/결제창)을 다루지 않는다** — 그건 프론트 소관이고 PG 마다 UI 가 달라
//    서버에서 추상화할 수 없다. 서버가 공유하는 건 승인·조회·상태정규화뿐이다.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

/** 우리 payments.status 표준값. 어떤 PG 든 어댑터가 자기 상태를 이 값으로 정규화해서 넘긴다. */
export type CanonicalStatus =
  | 'pending'
  | 'waiting_deposit'
  | 'paid'
  | 'canceled'
  | 'refunded'
  | 'failed'
  | 'expired'

/** PG 응답을 정규화한 중립 결제 객체. settleFromProvider 는 이것만 읽는다(TossPayment 를 모른다). */
export interface ProviderPayment {
  /** PG 의 결제 식별자(토스 paymentKey / 엑심베이 거래ID 등). 조회·취소에 쓴다. */
  providerKey: string | null
  orderId: string
  /**
   * 우리 표준 상태. **단, 'refunded' 는 여기서 나오지 않는다.**
   * refunded 는 "지급까지 갔다가 취소됨" 이라 우리 DB 의 fulfilled 여부를 알아야 정해지는데, 그건 business 판단이라
   * 어댑터가 아니라 settleFromProvider 가 canceled→refunded 로 업그레이드한다. 어댑터는 취소를 늘 'canceled' 로 준다.
   */
  status: CanonicalStatus
  method: string | null
  /** 가상계좌(입금 전 발급) 여부 — PG 응답 기준. 우리 DB 의 직전 상태까지 보는 건 settle 이 OR 로 더한다. */
  isVirtualAccount: boolean
  approvedAt: string | null
  /** PG 원문 — payments.raw 에 그대로 저장(대사·분쟁용). */
  raw: unknown
}

export interface ProviderError {
  code: string
  message: string
  httpStatus: number
  /** "그런 결제가 실제로 없다"가 **확인된** 오류인가. resettle 이 이때만 주문을 만료로 접는다.
   *  ⚠️ HTTP 404 라고 다 true 가 아니다(토스 NOT_FOUND_MERCHANT 는 상점 설정 문제라 결제가 살아있어도 404). 어댑터가 판정. */
  absent: boolean
}

export type ProviderResult =
  | { ok: true; data: ProviderPayment }
  | { ok: false; error: ProviderError }

/** PG 어댑터가 구현하는 포트. 결제 시작은 없다(프론트 소관) — 승인·조회·환경표시만. */
export interface PaymentProvider {
  readonly name: string
  /** 'test' | 'live' — 키 접두사로 판별. 실키/테스트키 혼용을 화면·로그에 드러낸다. */
  env(): 'test' | 'live'
  /** 결제 승인. amount 는 **저장된 주문 금액**을 넘긴다(클라 값 금지). idempotencyKey 로 PG 쪽 중복 승인 방지. */
  confirm(args: {
    providerKey: string
    orderId: string
    amount: number
    idempotencyKey: string
  }): Promise<ProviderResult>
  /** PG 결제 식별자로 조회(웹훅 검증·미완결 수습). */
  queryByKey(providerKey: string): Promise<ProviderResult>
  /** 주문번호로 조회(우리는 pending 인데 PG 에선 승인됐을 수 있는 경우). */
  queryByOrderId(orderId: string): Promise<ProviderResult>
}

// 어댑터 등록. 새 PG 는 여기 한 줄 + 어댑터 파일 하나면 끝이다.
import { tossProvider } from './toss.ts'

const PROVIDERS: Record<string, PaymentProvider> = {
  toss: tossProvider,
  // eximbay: eximbayProvider,   // ← 해외 결제 붙일 때. 토스 코드는 건드리지 않는다.
}

/**
 * payments.provider 값 → 어댑터. 없는 값이면 **크게 실패**한다(조용히 토스로 폴백하지 않는다).
 * 잘못 저장된 provider 를 토스로 처리하면 남의 PG 주문을 토스에 물어보는 조용한 사고가 된다.
 */
export function getProvider(name: string): PaymentProvider {
  const p = PROVIDERS[name]
  if (!p) throw new Error(`알 수 없는 결제대행사: ${name}`)
  return p
}

/** 새 주문을 어느 PG 로 열지. 지금은 토스 하나뿐이라 고정 — 통화·지역 라우팅이 필요해지면 여기서 분기한다. */
export const DEFAULT_PROVIDER = 'toss'

// SupabaseClient 재노출(어댑터가 타입만 필요할 때 import 경로를 한 곳으로).
export type { SupabaseClient }
