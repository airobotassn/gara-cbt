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

/** PG 응답을 정규화한 중립 결제 객체. settleFromProvider 는 이것만 읽는다(PG 원문 타입을 모른다). */
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

/**
 * 조회에 함께 넘기는 주문 정보. **엑심베이 retrieve 는 currency·amount 가 필수**라 식별자 하나로는 조회가 안 된다.
 * 토스는 무시한다(paymentKey/orderId 만으로 조회된다). 값의 출처는 언제나 **저장된 주문 행**이다 — 클라 값 금지.
 */
export interface ProviderQueryOpts {
  currency: string
  amount: number
}

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
    currency: string
    idempotencyKey: string
    /**
     * PG 결제창이 브라우저로 되돌려준 **원문 쿼리스트링**(`order_id=…&rescode=0000&fgkey=…`).
     * 엑심베이 `/verify` 는 이 원문을 통째로 받아 fgkey 로 위변조를 검증한다 — 파싱해서 다시 조립하면
     * 인코딩·순서가 달라져 검증이 깨질 수 있으므로 **받은 문자열 그대로** 실어 보낸다.
     * ⚠️ 토스는 쓰지 않는다(paymentKey·orderId·amount 로 승인이 끝난다). 브라우저를 거쳐 온 값이라
     *    이것만으로 결제를 인정하면 안 되고, 어댑터가 PG 에 되물어 확인한 결과만 신뢰한다.
     */
    rawQuery?: string
  }): Promise<ProviderResult>
  /** PG 결제 식별자로 조회(웹훅 검증·미완결 수습). */
  queryByKey(providerKey: string, opts?: ProviderQueryOpts): Promise<ProviderResult>
  /** 주문번호로 조회(우리는 pending 인데 PG 에선 승인됐을 수 있는 경우). */
  queryByOrderId(orderId: string, opts?: ProviderQueryOpts): Promise<ProviderResult>
}

// 어댑터 등록. 새 PG 는 여기 한 줄 + 어댑터 파일 하나면 끝이다.
import { eximbayProvider } from './eximbay.ts'

// 엑심베이 하나로 간다(2026-08-13). 국내(원화)·해외(달러)를 MID 로 가르기 때문에 PG 를 둘 둘 이유가 없어졌다.
//   ⚠️ **토스 어댑터는 삭제됐다.** 옛 `provider='toss'` 주문 행은 원장에 남아 있으므로, 그 행을 PG 에
//      물어보려는 경로(대사·웹훅)는 아래 `hasProvider` 로 먼저 걸러야 한다 — getProvider 를 그냥 부르면 던진다.
const PROVIDERS: Record<string, PaymentProvider> = {
  eximbay: eximbayProvider,
}

/** 그 PG 를 아직 다룰 수 있나. 옛 주문(삭제된 PG)을 조용히 건너뛰기 위한 것 — 판정에 쓰지 말 것. */
export function hasProvider(name: string): boolean {
  return Boolean(PROVIDERS[name])
}

/**
 * payments.provider 값 → 어댑터. 없는 값이면 **크게 실패**한다(조용히 다른 PG 로 폴백하지 않는다).
 * 잘못 저장된 provider 를 남의 PG 로 처리하면 엉뚱한 상점에 물어보는 조용한 사고가 된다.
 */
export function getProvider(name: string): PaymentProvider {
  const p = PROVIDERS[name]
  if (!p) throw new Error(`알 수 없는 결제대행사: ${name}`)
  return p
}

/** 새 주문을 어느 PG 로 열지. 엑심베이 하나뿐이다 — 국내/해외는 PG 가 아니라 **MID·통화**로 갈린다. */
export const DEFAULT_PROVIDER = 'eximbay'

// SupabaseClient 재노출(어댑터가 타입만 필요할 때 import 경로를 한 곳으로).
export type { SupabaseClient }
