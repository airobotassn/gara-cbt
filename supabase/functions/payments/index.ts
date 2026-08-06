// payments: 결제 주문 생성 · 승인 · 상태조회 · 대사.
//   - create    : 상품ID로 **서버가 금액을 다시 뽑아** 주문(payments)을 만든다 → 프론트가 이 값으로 결제창을 연다
//   - confirm   : successUrl 에서 받은 값을 검증하고 토스 승인 API 호출 → 성공해야만 지급
//   - status    : 결과 화면 새로고침·재진입용(승인은 하지 않는다)
//   - reconcile : 미완결/어긋난 결제를 토스에 다시 물어 수렴(운영·크론 전용, 시크릿 헤더 필요)
//
//   상품은 두 종류다: ebook(이북 열람권) · exam(자격검정 응시권, product_ref="<round_id>:<tier>").
//   응시료 갈래의 판매 가능 판정·금액·응시권 발급은 전부 _shared/exam-tickets.ts 가 단일 출처다.
//
//   ⚠️ _shared 사용 → CLI 로만 배포할 것. verify_jwt 는 켜둔 채로 배포한다(관례).
//   붙이기 전 필독: docs/토스페이먼츠-연동-가드레일.md
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'
import { confirmPayment, getPaymentByOrderId, tossEnv } from '../_shared/toss.ts'
import {
  PAYMENT_COLS,
  ensureCustomerKey,
  newOrderId,
  reconcile,
  resolveProduct,
  settleFromToss,
  type PaymentRow,
  type ProductType,
} from '../_shared/payments.ts'
import { findLiveTickets } from '../_shared/exam-tickets.ts'

const PRODUCT_TYPES: ProductType[] = ['ebook', 'exam']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const body = await req.json().catch(() => ({}))
    const action = String(body?.action ?? '')
    const admin = adminClient()

    // ---------- 대사(운영/크론) ----------
    // 사용자 인증이 아니라 시크릿 헤더로 연다. 관리자 로그인 없이 스케줄러가 부를 수 있어야 하기 때문이다.
    if (action === 'reconcile') {
      const key = (Deno.env.get('PAYMENTS_RECONCILE_KEY') ?? '').trim()
      if (!key || req.headers.get('x-reconcile-key') !== key) {
        return json({ error: '권한이 없습니다.' }, 403)
      }
      const limit = Math.min(Math.max(Number(body?.limit ?? 50), 1), 200)
      const out = await reconcile(admin, limit)
      return json({ env: tossEnv(), ...out })
    }

    // ---------- 여기부터 로그인 필수 ----------
    const user = await getUser(req)
    const uid = user?.id
    if (!uid) return json({ error: '로그인이 필요합니다.' }, 401)
    // 익명(게스트) 계정은 결제를 못 하게 막는다 — 결제 후 계정이 사라지면 물건도 환불도 갈 곳이 없다.
    if ((user as { is_anonymous?: boolean }).is_anonymous) {
      return json({ error: '게스트 계정으로는 결제할 수 없습니다. 로그인 후 이용해주세요.' }, 403)
    }

    // ---------- 주문 생성 ----------
    if (action === 'create') {
      const productType = String(body?.productType ?? '') as ProductType
      const productRef = String(body?.productRef ?? '').trim()
      const lang = String(body?.lang ?? 'ko')
      if (!PRODUCT_TYPES.includes(productType) || !productRef) {
        return json({ error: '상품 정보가 올바르지 않습니다.' }, 400)
      }

      // ① 금액은 상품ID로 서버가 다시 뽑는다. 클라가 보낸 금액은 받지도 않는다(파라미터에 없다).
      const product = await resolveProduct(admin, productType, productRef, lang)
      if (!product.ok) return json({ error: product.error }, product.status)

      // ⛔ 살아있는 가상계좌 주문이 있으면 새 결제를 막는다.
      //    VA 는 계좌만 발급되고 며칠 뒤 입금되는 구조라 그동안 status='waiting_deposit' 로 떠 있다.
      //    이 상태는 'paid' 가 아니라 payments_paid_product_uniq 에도 안 걸리고 지급도 안 된 상태라,
      //    막지 않으면 "입금 기다리기 싫어서 카드로 또 결제" → 나중에 계좌에 입금 → **두 번 청구**가 된다.
      {
        const { data: pendingVa } = await admin
          .from('payments')
          .select('order_id')
          .eq('user_id', uid)
          .eq('product_type', productType)
          .eq('product_ref', product.ref)
          .eq('status', 'waiting_deposit')
          .limit(1)
          .maybeSingle()
        if (pendingVa) {
          return json(
            { error: '입금 대기 중인 결제가 있습니다. 입금을 마치거나 취소한 뒤 다시 시도해주세요.', pending: true },
            409,
          )
        }
      }

      // 이미 가진 상품에 결제창을 띄우지 않는다(띄워도 DB 유니크가 막지만, 돈부터 받고 막으면 환불거리다).
      if (productType === 'ebook') {
        const { data: owned } = await admin
          .from('ebook_purchases')
          .select('id')
          .eq('user_id', uid)
          .eq('ebook_id', product.ref)
          .maybeSingle()
        if (owned) return json({ error: '이미 보유한 이북입니다.', owned: true }, 409)
      }

      // 응시료 사전검사 — 결제창을 띄우기 전에 막는다. 실제 차단은 DB 유니크(exam_tickets_live_uniq)와
      // start-exam 이 하지만, 여기서 걸러야 "돈은 빠졌는데 응시는 못 함"이 안 생긴다.
      // ⚠️ 접수기간·회차 published·급수 개설·응시료 존재는 resolveProduct(→ resolveExamOffer)가 이미 봤다.
      if (productType === 'exam') {
        // exam 인데 exam 페이로드가 없으면 사전검사가 통째로 건너뛰어진다 — 조용히 통과시키지 않는다.
        if (!product.exam) return json({ error: '상품 정보가 올바르지 않습니다.' }, 400)
        const live = await findLiveTickets(admin, uid, {
          roundId: product.exam.roundId,
          tier: product.exam.tier,
        })
        if (live.length > 0) {
          return json({ error: '이미 이 시험의 응시권을 보유하고 있습니다.', owned: true }, 409)
        }
        // 이미 응시를 마친 시험은 다시 팔지 않는다(1인 1회). 관리자 재응시 예외는 응시권을 따로 발급받는다.
        const { data: done } = await admin
          .from('exam_attempts')
          .select('id')
          .eq('user_id', uid)
          .eq('exam_id', product.exam.id)
          .in('status', ['submitted', 'voided'])
          .limit(1)
          .maybeSingle()
        if (done) return json({ error: '이미 응시를 완료한 시험입니다.', owned: true }, 409)
      }

      // 무료 상품은 결제창을 타지 않는다(0원 결제는 애초에 불가). 바로 지급하고 끝낸다.
      // ⛔ **이 분기는 이북 전용이다. 응시료를 여기로 들이지 말 것.** exam_fees.amount 는 default 0 이고
      //    관리자 화면의 빈 입력도 0 으로 저장되므로, 0원을 '무료 즉시지급'으로 열면 오타 한 번이
      //    무제한 무료 응시권이 된다. 응시료는 resolveExamOffer 가 금액 0/미설정을 **판매 불가(400)** 로 접어서
      //    애초에 여기까지 오지 않는다 — 아래 가드는 그 규칙이 깨졌을 때의 2차 방어선이다.
      if (product.amount <= 0) {
        if (productType !== 'ebook') return json({ error: '무료 처리할 수 없는 상품입니다.' }, 400)
        const { error } = await admin.from('ebook_purchases').insert({
          user_id: uid,
          ebook_id: product.ref,
          price_paid: 0,
          source: 'free',
        })
        if (error && (error as { code?: string }).code !== '23505') return json({ error: error.message }, 400)
        return json({ free: true, granted: true })
      }

      const customerKey = await ensureCustomerKey(admin, uid)
      const orderId = newOrderId(productType)
      const { error: insErr } = await admin.from('payments').insert({
        user_id: uid,
        provider: 'toss',
        order_id: orderId,
        order_name: product.orderName,
        product_type: productType,
        // ⚠️ 클라가 보낸 문자열이 아니라 **서버가 DB 에서 읽어 정규화한 값**을 저장한다.
        //    payments_paid_product_uniq 는 text 원문 비교라, 대소문자·공백 하나만 달라도 중복결제가 뚫린다.
        product_ref: product.ref,
        amount: product.amount,
        currency: 'KRW',
        status: 'pending',
        customer_key: customerKey,
      })
      // 23505 = 이 사람이 이 상품을 이미 결제 완료했다(부분 유니크 인덱스). 위 보유 검사와 겹치지만
      // 동시 요청이 둘 다 통과한 경우를 여기서 잡는다.
      if (insErr) {
        if ((insErr as { code?: string }).code === '23505') {
          return json({ error: '이미 결제가 완료된 상품입니다.', owned: true }, 409)
        }
        return json({ error: insErr.message }, 400)
      }

      return json({
        orderId,
        orderName: product.orderName,
        amount: product.amount,
        currency: 'KRW',
        customerKey,
        env: tossEnv(), // 테스트키/실키 혼용을 화면에서도 알아챌 수 있게 같이 내려준다
      })
    }

    // ---------- 승인 ----------
    if (action === 'confirm') {
      const orderId = String(body?.orderId ?? '').trim()
      const paymentKey = String(body?.paymentKey ?? '').trim()
      const clientAmount = Number(body?.amount ?? NaN)
      if (!orderId || !paymentKey) return json({ error: '결제 정보가 올바르지 않습니다.' }, 400)

      const { data } = await admin.from('payments').select(PAYMENT_COLS).eq('order_id', orderId).maybeSingle()
      const row = data as PaymentRow | null
      if (!row) return json({ error: '주문을 찾을 수 없습니다.' }, 404)
      // 남의 주문에 결제를 붙이지 못하게 소유자를 반드시 확인한다.
      if (row.user_id !== uid) return json({ error: '권한이 없습니다.' }, 403)

      // 이미 끝난 주문 — 결과 화면 새로고침/뒤로가기로 다시 들어온 경우다. 승인 API 를 또 부르지 않는다.
      if (row.status === 'paid') {
        return json({ status: 'paid', fulfilled: Boolean(row.fulfilled_at), productType: row.product_type, productRef: row.product_ref })
      }

      // ② successUrl 의 amount 를 그대로 승인에 넘기지 않는다 — 저장된 주문 금액과 대조부터 한다.
      if (!Number.isFinite(clientAmount) || clientAmount !== row.amount) {
        await admin
          .from('payments')
          .update({ status: 'failed', fail_code: 'AMOUNT_MISMATCH', fail_message: `요청 ${clientAmount} ≠ 주문 ${row.amount}`, updated_at: new Date().toISOString() })
          .eq('id', row.id)
          .eq('status', 'pending')
        return json({ error: '결제 금액이 주문과 일치하지 않습니다.' }, 400)
      }

      // ⛔ 이중 결제 차단 — **승인 API 를 부르기 전에** 같은 상품의 완료된 결제가 있는지 본다.
      //    주문(payments)은 status='pending' 으로 생기는데 중복 방지 유니크는 status='paid' 에만 걸린다.
      //    즉 같은 상품으로 pending 주문을 무제한 만들 수 있고, 결제창을 두 개 띄워 둘 다 결제하면
      //    **토스는 두 건 다 승인해서 돈이 두 번 빠진다**(두 번째는 우리 DB 유니크에서만 터진다).
      //    승인 전에 여기서 끊으면 돈이 아예 안 빠진다. 이북에도 실재하던 버그라 상품 종류를 가리지 않는다.
      //    ※ create 에서 '살아있는 pending 주문 재사용'도 검토했지만 넣지 않았다 — 토스 결제 세션은 10분 만료라
      //      만료분을 판별할 방법이 우리 쪽에 없고(주문 나이만 봐선 알 수 없다), 살아있는 세션을 재사용하려다
      //      죽은 orderId 를 돌려주면 결제가 시작조차 안 된다. 돈이 빠지는 걸 막는 건 이 승인 전 검사로 충분하다.
      //    ※ 남는 구멍: **두 주문의 confirm 이 동시에** 들어오면 둘 다 이 검사를 통과한다(그 순간 paid 행이 없다).
      //      완전히 막으려면 승인 전에 주문을 선점하는 상태('confirming')가 필요한데 payments.status CHECK 에 없다.
      //      그 경우엔 뒤늦은 UPDATE 가 payments_paid_product_uniq 에 걸려 settleFromToss 가 던지고 대사에 올라간다.
      //    ⚠️ 'paid' 만 보면 안 된다. **가상계좌 주문은 'waiting_deposit' 으로 살아 있다** — 입금 전이라
      //      paid 도 아니고 부분 유니크에도 안 걸린다. 그래서 "가상계좌로 주문해두고 기다리기 싫어 카드로 또 결제"
      //      가 그대로 성립하고, 나중에 그 계좌에 입금하면 실제로 두 번 청구된 것이 된다.
      //      살아있는 결제(paid + waiting_deposit)를 전부 세야 한다.
      const { data: dupPaid } = await admin
        .from('payments')
        .select('id, order_id, status')
        .eq('user_id', row.user_id)
        .eq('product_type', row.product_type)
        .eq('product_ref', row.product_ref)
        .in('status', ['paid', 'waiting_deposit'])
        .neq('id', row.id)
        .limit(1)
        .maybeSingle()
      if (dupPaid) {
        // 이 주문은 실패로 접는다 — pending 으로 두면 대사(reconcile)가 매번 토스에 물어보며 영원히 남는다.
        await admin
          .from('payments')
          .update({
            status: 'failed',
            fail_code: 'DUPLICATE_PRODUCT',
            fail_message: `이미 결제 완료된 주문 ${dupPaid.order_id}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id)
          .eq('status', 'pending')
        return json(
          { error: '이미 결제가 완료된 상품입니다. 결제를 진행하지 않았습니다.', code: 'already_paid', owned: true },
          400,
        )
      }

      // 승인에 넘기는 금액은 **저장된 주문 금액**(row.amount). 멱등키는 주문마다 고정(row.id)이라
      // 사용자가 새로고침으로 두 번 눌러도 토스에서 두 번 승인되지 않는다.
      const res = await confirmPayment({
        paymentKey,
        orderId,
        amount: row.amount,
        idempotencyKey: row.id,
      })

      if (!res.ok) {
        // 승인 실패를 곧바로 '결제 실패'로 단정하지 않는다 — 이미 승인된 건인데 응답만 못 받았을 수 있다.
        // 조회 API 로 실제 상태를 확인하고 분기한다.
        const check = await getPaymentByOrderId(orderId)
        if (check.ok) {
          const out = await settleFromToss(admin, row, check.data)
          if (out.status === 'paid') {
            return json({ status: 'paid', fulfilled: out.fulfilled, productType: row.product_type, productRef: row.product_ref })
          }
          return json({ error: res.error.message, code: res.error.code, status: out.status }, 400)
        }
        await admin
          .from('payments')
          .update({ status: 'failed', fail_code: res.error.code, fail_message: res.error.message, payment_key: paymentKey, updated_at: new Date().toISOString() })
          .eq('id', row.id)
          .neq('status', 'paid')
        return json({ error: res.error.message, code: res.error.code }, 400)
      }

      const out = await settleFromToss(admin, row, res.data)
      return json({
        status: out.status,
        fulfilled: out.fulfilled,
        productType: row.product_type,
        productRef: row.product_ref,
        orderName: row.order_name,
        amount: row.amount,
      })
    }

    // ---------- 상태 조회 ----------
    if (action === 'status') {
      const orderId = String(body?.orderId ?? '').trim()
      if (!orderId) return json({ error: '주문번호가 필요합니다.' }, 400)
      const { data } = await admin.from('payments').select(PAYMENT_COLS).eq('order_id', orderId).maybeSingle()
      const row = data as PaymentRow | null
      if (!row) return json({ error: '주문을 찾을 수 없습니다.' }, 404)
      if (row.user_id !== uid) return json({ error: '권한이 없습니다.' }, 403)
      return json({
        status: row.status,
        fulfilled: Boolean(row.fulfilled_at),
        productType: row.product_type,
        productRef: row.product_ref,
        orderName: row.order_name,
        amount: row.amount,
        currency: row.currency,
      })
    }

    return json({ error: '알 수 없는 action' }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
