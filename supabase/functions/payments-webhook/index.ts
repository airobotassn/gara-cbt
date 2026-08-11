// payments-webhook: PG 가 결제 상태 변경을 알려주는 엔드포인트(토스 웹훅 · 엑심베이 status_url 공용).
//
// 왜 필요한가 — 웹훅 없이 확실히 새는 두 구멍이 있다:
//   · 사용자가 가상계좌를 받고 나중에 입금 → 승인 시점엔 지급하면 안 되고, 입금 시점을 우리가 알 방법이 이것뿐
//   · 사용자가 인증까지 하고 결제창을 닫음 → 결제는 살아있는데 우리는 모른다
// 웹훅은 **중복으로 오거나, 순서가 뒤집히거나, 아예 안 올 수 있다.** 그래서 여기서 하는 일은
// "본문을 믿고 상태를 쓰기"가 아니라 **식별자만 꺼내서 토스에 다시 물어보기**다(_shared/payments.resettle).
// 안 오는 경우까지 덮으려면 웹훅만으로는 부족하다 → payments 함수의 reconcile 을 주기적으로 돌려야 한다.
//
// ⚠️ 인증 — 일반 결제 웹훅에는 서명 헤더(tosspayments-webhook-signature)가 **없다**. 그건 지급대행/셀러 웹훅 전용이다.
//    그래서 이 함수는 URL 에 심은 시크릿(?k=…)으로 1차 차단하고, 실제 신뢰는 토스 재조회에 둔다.
//
// ⚠️⚠️ 배포 주의 — 이 함수 **하나만** `verify_jwt=false` 로 올려야 한다.
//    토스는 Supabase JWT 를 실어보낼 수 없어서 게이트웨이가 401 로 먼저 끊는다.
//    (저장소 관례는 verify_jwt=true 다. route-seed 에 이어 두 번째 예외이고, 그래서 URL 시크릿이 필수다.)
//      npx supabase functions deploy payments-webhook --no-verify-jwt
//    나머지 함수에는 절대 이 플래그를 쓰지 말 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient } from '../_shared/lib.ts'
import { PAYMENT_COLS, resettle, type PaymentRow } from '../_shared/payments.ts'

/** 본문 어디에 있든 주문/결제 식별자를 찾아낸다.
 *  이벤트 종류마다(PAYMENT_STATUS_CHANGED · DEPOSIT_CALLBACK · CANCEL_STATUS_CHANGED) 본문 모양이 달라서,
 *  스키마를 통째로 가정하지 않고 **식별자만** 건진다. 상태는 어차피 토스에 다시 물어본다. */
function pickIds(body: unknown): { orderId?: string; paymentKey?: string } {
  const b = (body ?? {}) as Record<string, unknown>
  const data = (b.data ?? {}) as Record<string, unknown>
  // 엑심베이(status_url)는 스네이크케이스로 준다 — order_id · transaction_id. 이름만 다를 뿐 하는 일은 같다.
  const payment = (b.payment ?? {}) as Record<string, unknown>
  const orderId = (b.orderId ?? data.orderId ?? b.order_id ?? payment.order_id) as string | undefined
  const paymentKey = (b.paymentKey ?? data.paymentKey ?? b.transaction_id ?? payment.transaction_id) as
    | string
    | undefined
  return {
    orderId: typeof orderId === 'string' ? orderId : undefined,
    paymentKey: typeof paymentKey === 'string' ? paymentKey : undefined,
  }
}

/**
 * 본문을 객체로 만든다. 토스는 JSON 이지만 **엑심베이 status_url 의 본문 형식은 아직 실기기로 확인하지 못했다**
 * (문서가 명시하지 않는다). JSON 이 아니면 폼/쿼리스트링으로 한 번 더 시도한다 — 형식을 잘못 짚어
 * 식별자를 못 꺼내면 그 통지는 조용히 버려지고, 브라우저가 닫힌 결제를 영영 못 찾는다.
 */
async function readBody(req: Request): Promise<unknown> {
  const text = await req.text().catch(() => '')
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return Object.fromEntries(new URLSearchParams(text))
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const secret = (Deno.env.get('TOSS_WEBHOOK_SECRET') ?? '').trim()
    const given = new URL(req.url).searchParams.get('k') ?? ''
    if (!secret || given !== secret) return json({ error: 'forbidden' }, 403)

    const body = await readBody(req)
    const { orderId, paymentKey } = pickIds(body)
    if (!orderId && !paymentKey) {
      // 우리가 못 읽는 이벤트 — 재시도를 받아봐야 똑같으니 200 으로 닫는다.
      return json({ ok: true, skipped: 'no_identifier' })
    }

    const admin = adminClient()
    const q = admin.from('payments').select(PAYMENT_COLS)
    const { data } = orderId
      ? await q.eq('order_id', orderId).maybeSingle()
      : await q.eq('payment_key', paymentKey as string).maybeSingle()
    const row = data as PaymentRow | null
    // 우리 원장에 없는 주문(다른 상점/테스트 트래픽) — 재시도 대상이 아니다.
    if (!row) return json({ ok: true, skipped: 'unknown_order' })

    // 상태 판단은 본문이 아니라 토스 재조회로 한다. 같은 웹훅이 두 번 와도 결과가 같다(멱등).
    const out = await resettle(admin, row)
    return json({ ok: true, ...out })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '오류'
    // ⚠️ **재시도해도 결과가 같은 오류에 500 을 주면 토스가 영원히 재시도한다.**
    //    중복 결제(23505)로 상태 전이가 막힌 경우가 대표적이다 — 몇 번을 다시 보내도 똑같이 막힌다.
    //    이런 건 200 으로 닫고 사유만 남긴다(대사가 어차피 그 결제를 미완결로 집어낸다).
    //    일시적 장애(네트워크·토스 5xx)만 500 을 줘서 재시도를 받는다.
    const permanent = /중복 결제|duplicate key|23505/i.test(msg)
    if (permanent) return json({ ok: true, skipped: 'permanent_error', reason: msg })
    return json({ error: msg }, 500)
  }
})
