// payments-webhook: PG 가 결제 상태 변경을 알려주는 엔드포인트(엑심베이 status_url).
//
// 왜 필요한가 — 웹훅 없이 확실히 새는 구멍이 있다:
//   · 사용자가 인증까지 하고 결제창을 닫음 → 결제는 살아있는데 우리는 모른다
// 웹훅은 **중복으로 오거나, 순서가 뒤집히거나, 아예 안 올 수 있다.** 그래서 여기서 하는 일은
// "본문을 믿고 상태를 쓰기"가 아니라 **식별자만 꺼내서 PG 에 다시 물어보기**다(_shared/payments.resettle).
// 안 오는 경우까지 덮으려면 웹훅만으로는 부족하다 → payments 함수의 reconcile 을 주기적으로 돌려야 한다.
//
// ⚠️ 인증 — 결제 통지에는 서명 헤더가 없다(엑심베이 status_url 도 마찬가지).
//    그래서 이 함수는 URL 에 심은 시크릿(?k=…)으로 1차 차단하고, 실제 신뢰는 PG 재조회에 둔다.
//
// ⚠️⚠️ 배포 주의 — 이 함수 **하나만** `verify_jwt=false` 로 올려야 한다.
//    PG 는 Supabase JWT 를 실어보낼 수 없어서 게이트웨이가 401 로 먼저 끊는다.
//    (저장소 관례는 verify_jwt=true 다. route-seed 에 이어 두 번째 예외이고, 그래서 URL 시크릿이 필수다.)
//      npx supabase functions deploy payments-webhook --no-verify-jwt
//    나머지 함수에는 절대 이 플래그를 쓰지 말 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient } from '../_shared/lib.ts'
import { hasProvider } from '../_shared/payment-provider.ts'
import { PAYMENT_COLS, resettle, type PaymentRow } from '../_shared/payments.ts'

/** 본문 어디에 있든 주문/결제 식별자를 찾아낸다.
 *  이벤트 종류마다(PAYMENT_STATUS_CHANGED · DEPOSIT_CALLBACK · CANCEL_STATUS_CHANGED) 본문 모양이 달라서,
 *  스키마를 통째로 가정하지 않고 **식별자만** 건진다. 상태는 어차피 PG 에 다시 물어본다. */
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
 * 본문을 객체로 만든다. **엑심베이 status_url 본문은 폼(x-www-form-urlencoded)이고 order_id·transaction_id 가 그 이름 그대로 있다(2026-09-15 실측)**
 * JSON 으로도 대비한다 — JSON 이 아니면 폼/쿼리스트링으로 한 번 더 시도한다 — 형식을 잘못 짚어
 * 식별자를 못 꺼내면 그 통지는 조용히 버려지고, 브라우저가 닫힌 결제를 영영 못 찾는다.
 * ⚠️ 그래서 아래에서 **원문을 표에 남긴다**(payment_webhook_events). 짐작이 틀렸는지는 그 표를 보면 안다.
 */
function parseBody(text: string): unknown {
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return Object.fromEntries(new URLSearchParams(text))
  }
}

/** 본문 원문 상한 — 통지 본문은 몇백 바이트다. 공개 엔드포인트라 상한 없이 받으면 표가 쓰레기통이 된다. */
const RAW_MAX = 8 * 1024

/**
 * 받은 통지를 **원문 그대로** 남긴다(2026-09-14). 처리 결과(outcome)와 사유(note)까지.
 *
 * 왜 로그가 아니라 표인가 — 함수 로그는 며칠이면 사라진다(8월 테스트 결제의 로그가 이미 없어서 "그때 웹훅이
 * 왔는지" 조차 되짚을 수 없었다). 못 읽은 통지도 버리지 않고 남겨야 파싱을 실제 모양에 맞출 수 있다.
 *
 * 📌 대사(reconcile)와 무관하다 — 대사 크론을 붙일 때 이 표는 손댈 게 없다(마이그레이션 머리말 참고).
 * ⚠️ 판정에 쓰지 않는다. 결제 상태의 정본은 여전히 PG 재조회(resettle)다.
 * ⚠️ 기록 실패가 통지 처리를 막으면 안 된다 — 표가 없거나 막혀도 결제는 돌아야 하므로 삼킨다.
 */
async function recordEvent(
  admin: ReturnType<typeof adminClient>,
  ev: { req: Request; raw: string; orderId?: string; paymentKey?: string; outcome: string; note?: string },
): Promise<void> {
  try {
    await admin.from('payment_webhook_events').insert({
      provider: 'eximbay',
      order_id: ev.orderId ?? null,
      payment_key: ev.paymentKey ?? null,
      content_type: ev.req.headers.get('content-type'),
      raw: ev.raw.slice(0, RAW_MAX),
      outcome: ev.outcome,
      note: ev.note ?? null,
    })
  } catch {
    /* 기록은 곁다리다 — 실패해도 통지 처리는 계속한다 */
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const admin = adminClient()
  // 본문은 시크릿 검사보다 **먼저** 읽는다 — 시크릿이 안 맞는 통지도 남겨야 "PG 가 다른 주소로 보내고 있다"
  // 같은 설정 사고를 알 수 있다(403 만 돌려주면 우리 쪽엔 아무 흔적이 없다).
  const raw = (await req.text().catch(() => '')).trim()
  let ids: { orderId?: string; paymentKey?: string } = {}
  try {
    const secret = (Deno.env.get('PAYMENTS_WEBHOOK_SECRET') ?? '').trim()
    const given = new URL(req.url).searchParams.get('k') ?? ''
    if (!secret || given !== secret) {
      await recordEvent(admin, { req, raw, outcome: 'forbidden' })
      return json({ error: 'forbidden' }, 403)
    }

    const body = parseBody(raw)
    ids = pickIds(body)
    const { orderId, paymentKey } = ids
    if (!orderId && !paymentKey) {
      // 우리가 못 읽는 이벤트 — 재시도를 받아봐야 똑같으니 200 으로 닫는다. **원문은 남는다** — 파싱을 고칠 근거.
      await recordEvent(admin, { req, raw, outcome: 'no_identifier' })
      return json({ ok: true, skipped: 'no_identifier' })
    }

    const q = admin.from('payments').select(PAYMENT_COLS)
    const { data } = orderId
      ? await q.eq('order_id', orderId).maybeSingle()
      : await q.eq('payment_key', paymentKey as string).maybeSingle()
    const row = data as PaymentRow | null
    // 우리 원장에 없는 주문(다른 상점/테스트 트래픽) — 재시도 대상이 아니다.
    if (!row) {
      await recordEvent(admin, { req, raw, ...ids, outcome: 'unknown_order' })
      return json({ ok: true, skipped: 'unknown_order' })
    }

    // 상태 판단은 본문이 아니라 PG 재조회로 한다. 같은 통지가 두 번 와도 결과가 같다(멱등).
    // ⚠️ 옛 주문(삭제된 PG)은 물어볼 어댑터가 없다 — 재시도해도 영영 같으니 200 으로 닫는다.
    if (!hasProvider(row.provider)) {
      await recordEvent(admin, { req, raw, ...ids, outcome: 'retired_provider', note: row.provider })
      return json({ ok: true, skipped: 'retired_provider', provider: row.provider })
    }
    const out = await resettle(admin, row)
    await recordEvent(admin, {
      req,
      raw,
      ...ids,
      outcome: 'settled',
      note: `${out.status}${out.fulfilled ? ' · 지급됨' : ''}${out.note ? ` · ${out.note}` : ''}`,
    })
    return json({ ok: true, ...out })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '오류'
    // ⚠️ **재시도해도 결과가 같은 오류에 500 을 주면 PG 가 영원히 재시도한다.**
    //    중복 결제(23505)로 상태 전이가 막힌 경우가 대표적이다 — 몇 번을 다시 보내도 똑같이 막힌다.
    //    이런 건 200 으로 닫고 사유만 남긴다(대사가 어차피 그 결제를 미완결로 집어낸다).
    //    일시적 장애(네트워크·PG 5xx)만 500 을 줘서 재시도를 받는다.
    const permanent = /중복 결제|duplicate key|23505|알 수 없는 결제대행사/i.test(msg)
    await recordEvent(admin, { req, raw, ...ids, outcome: permanent ? 'permanent_error' : 'error', note: msg })
    if (permanent) return json({ ok: true, skipped: 'permanent_error', reason: msg })
    return json({ error: msg }, 500)
  }
})
