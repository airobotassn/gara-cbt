// payments: 결제 주문 생성 · 승인 · 상태조회 · 대사.
//   - create    : 상품ID로 **서버가 금액을 다시 뽑아** 주문(payments)을 만든다 → 프론트가 이 값으로 결제창을 연다
//   - confirm   : successUrl 에서 받은 값을 검증하고 토스 승인 API 호출 → 성공해야만 지급
//   - status    : 결과 화면 새로고침·재진입용(승인은 하지 않는다)
//   - reconcile : 미완결/어긋난 결제를 토스에 다시 물어 수렴(운영·크론 전용, 시크릿 헤더 필요)
//
//   상품은 세 종류다: ebook(이북 열람권) · exam(자격검정 응시권, product_ref="<round_id>:<tier>")
//                    · cert(자격증 발급비, product_ref=attemptId — 지급물이 없고 결제 행 자체가 발급 게이트다).
//   응시료 갈래의 판매 가능 판정·금액·응시권 발급은 전부 _shared/exam-tickets.ts 가 단일 출처다.
//
//   ⚠️ _shared 사용 → CLI 로만 배포할 것. verify_jwt 는 켜둔 채로 배포한다(관례).
//   붙이기 전 필독: docs/토스페이먼츠-연동-가드레일.md
import { corsHeaders, json } from '../_shared/cors.ts'
import { convertFromUsdCents, refreshRates } from '../_shared/fx.ts'
import { adminClient, getUser } from '../_shared/lib.ts'
import { getProvider, DEFAULT_PROVIDER } from '../_shared/payment-provider.ts'
import {
  eximbayAmount,
  eximbayLang,
  eximbayReady,
  eximbaySdkUrl,
  type EximbayReadyPayload,
} from '../_shared/eximbay.ts'
import {
  PAYMENT_COLS,
  chargeOf,
  ensureCustomerKey,
  newOrderId,
  reconcile,
  resolveProduct,
  settleFromProvider,
  type PaymentRow,
  type ProductType,
} from '../_shared/payments.ts'
import { findLiveTickets, ticketSourceAlive } from '../_shared/exam-tickets.ts'

const PRODUCT_TYPES: ProductType[] = ['ebook', 'exam', 'cert']

/** 구매자 표기를 ASCII 로만 만든다 — 한글이 PG·카드사 구간에서 깨져 돌아오면 대사할 때 사람이 못 읽는다.
 *  이름 자체가 결제 판정에 쓰이지 않으므로 이메일 아이디로 충분하다(비면 상수). */
function asciiBuyerName(email: string): string {
  const id = email.split('@')[0]?.replace(/[^\x20-\x7E]/g, '').trim() ?? ''
  return id.slice(0, 40) || 'CARIS'
}

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
      return json({ env: getProvider(DEFAULT_PROVIDER).env(), ...out })
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

      // 자격증 발급비 — 본인의 '합격한·아직 미발급' 응시에만 결제창을 연다.
      //   실제 자격번호 채번은 결제 성공 후 my-attempts {issue} 가 하고, 여기선 결제 자격만 건다.
      if (productType === 'cert') {
        const { data: att } = await admin
          .from('exam_attempts')
          .select('user_id, ticket_id, status, result_release_at, total_correct, total_questions, cert_no')
          .eq('id', product.ref)
          .maybeSingle()
        if (!att || att.user_id !== uid) {
          return json({ error: '본인의 응시만 자격증을 발급할 수 있습니다.' }, 403)
        }
        if (att.cert_no) return json({ error: '이미 발급된 자격증입니다.', owned: true }, 409)
        const released =
          att.status === 'submitted' &&
          !!att.result_release_at &&
          Date.now() >= new Date(att.result_release_at as string).getTime()
        const passed =
          released && att.total_correct != null && att.total_questions
            ? (att.total_correct as number) >= Math.ceil((att.total_questions as number) * 0.6)
            : false
        if (!passed) return json({ error: '합격한 응시만 자격증을 발급할 수 있습니다.' }, 400)
        // ⚠️ my-attempts 의 발급 게이트와 **같은 판정**을 결제 전에 미리 돌린다. 여기서 안 보면
        //    환불·회수된 응시로 발급비를 받아놓고 발급 단계에서 거절하는 구간이 생긴다(= 환불거리).
        const alive = await ticketSourceAlive(admin, (att.ticket_id as string | null) ?? null)
        if (!alive.ok) return json({ error: alive.error }, 409)
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

      // PG 는 엑심베이 하나다(2026-08-13, 토스 제거). 프론트가 고르지 않는다 —
      // 국내/해외는 PG 가 아니라 **MID·통화**로 갈리고, 그건 아래에서 사용자 국가가 정한다.
      const providerName: string = DEFAULT_PROVIDER

      // ⛔ **정가는 달러(센트)이고, 청구 통화는 사용자 국가가 정한다.**
      //    한국 → 원화. 국내 카드가 달러로 결제되면 해외결제로 잡혀 카드사 수수료가 붙고,
      //           해외결제를 꺼둔 카드는 아예 실패한다.
      //    그 외 → 달러 그대로.
      // ⚠️ **국가를 모르면 해외(달러)로 둔다.** 해외 MID 는 국내 카드도 (수수료가 붙을 뿐) 통과하지만,
      //    국내 MID 로 해외 카드를 보내면 승인 자체가 안 된다 — 모를 때는 되는 쪽으로 떨어뜨린다.
      const { data: prof } = await admin.from('profiles').select('country_code').eq('id', uid).maybeSingle()
      const chargeKrw = String(prof?.country_code ?? '').toUpperCase() === 'KR'

      // ⚠️ 환율은 **여기서 한 번만** 읽고 주문 행에 박는다. 승인은 결제창을 다녀온 뒤라 그 사이 값이
      //    갱신될 수 있는데, 그때 다시 계산하면 화면에 뜬 금액과 청구액이 달라져 대조가 통째로 깨진다.
      // 갱신은 여기서 겸사겸사 돌린다 — 별도 크론을 두면 그게 죽었을 때 아무도 모르고 환율만 낡아간다.
      // 주기(7일)가 안 됐으면 select 한 번으로 끝나므로 주문마다 불러도 부담이 없다.
      const fxRate = chargeKrw ? (await refreshRates(admin)).rate : null
      const charge = chargeKrw
        ? { currency: 'KRW', amount: convertFromUsdCents(product.amount, fxRate as number, 'KRW') }
        : { currency: 'USD', amount: product.amount / 100 }

      const customerKey = await ensureCustomerKey(admin, uid)
      const orderId = newOrderId(productType)
      const { error: insErr } = await admin.from('payments').insert({
        user_id: uid,
        provider: providerName,
        order_id: orderId,
        order_name: product.orderName,
        product_type: productType,
        // ⚠️ 클라가 보낸 문자열이 아니라 **서버가 DB 에서 읽어 정규화한 값**을 저장한다.
        //    payments_paid_product_uniq 는 text 원문 비교라, 대소문자·공백 하나만 달라도 중복결제가 뚫린다.
        product_ref: product.ref,
        // 정가 — **달러 센트**(100 = $1.00). currency 가 'USD' 라는 게 그 단위를 말해준다.
        amount: product.amount,
        currency: 'USD',
        // 실제로 청구하는 값(주요 단위). 정가와 단위·통화가 다르므로 **항상** 적는다.
        charge_amount: charge.amount,
        charge_currency: charge.currency,
        // 원화 청구건에만 들어간다 — 그때 쓴 환율을 남겨야 나중에 금액을 설명할 수 있다.
        fx_rate: fxRate,
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

      // 엑심베이는 결제창을 띄우기 전에 **서버가 준비(/ready)** 를 한 단계 더 밟는다(토스엔 없는 단계).
      // FGKey 는 여기 보낸 값들에 대한 서명이라, 프론트가 SDK 에 넣을 페이로드도 **서버가 만든 그 객체 그대로**
      // 내려준다(프론트가 다시 조립하면 값 하나만 어긋나도 FGKey 불일치로 결제창이 실패한다).
      let eximbay: { sdkUrl: string; fgkey: string; payload: EximbayReadyPayload } | undefined
      if (providerName === 'eximbay') {
        // 콜백 주소는 브라우저가 보낸 Origin 을 쓴다 — 로컬(5173)과 배포를 같은 코드로 돌리기 위해서다.
        // ⚠️ 여기서 오는 값을 신뢰해서 지급을 판단하는 곳은 없다. 결제 인정은 어댑터가 PG 에 되물어 확인한다.
        const origin = (req.headers.get('origin') ?? '').trim()
        if (!origin) return json({ error: '결제 준비에 필요한 주소를 확인할 수 없습니다.' }, 400)
        const fnBase = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '')
        const hookKey = (Deno.env.get('PAYMENTS_WEBHOOK_SECRET') ?? '').trim()

        const ready = await eximbayReady({
          orderId,
          // 자릿수는 통화가 정한다(달러 2자리·원 0자리). 조회 때와 **같은 함수**로 만들어야
          // 준비/조회가 같은 글자를 써서 같은 결제를 가리킨다.
          amount: eximbayAmount(charge.currency, charge.amount),
          currency: charge.currency,
          // 엑심베이에 넘어가는 구매자 표기. 한글 닉네임이 그대로 나가면 PG·카드사 구간에서 깨질 수 있어 ASCII 로만 만든다.
          buyerName: asciiBuyerName((user as { email?: string }).email ?? ''),
          buyerEmail: (user as { email?: string }).email ?? 'noreply@example.com',
          // ⚠️ 결과 화면(/pay/success)을 직접 주면 안 된다 — 엑심베이는 결과를 **POST 로** 던지는데
          //    정적 SPA 는 GET 만 페이지를 돌려주므로 그대로 404 다(2026-08-11 실측). POST 를 받아
          //    303 으로 결과 화면에 넘겨주는 함수를 한 칸 세운다. `to` 는 그 함수가 화이트리스트로 거른다.
          returnUrl: `${fnBase}/functions/v1/payments-return?to=${encodeURIComponent(origin)}`,
          // 서버-서버 통지. 브라우저가 닫혀 return_url 이 안 돌아온 경우를 덮는 유일한 경로다.
          statusUrl: `${fnBase}/functions/v1/payments-webhook?k=${encodeURIComponent(hookKey)}`,
          // 코드표는 eximbayLang 이 단일 출처다(ISO 639-1 이 아니다 — 일본어가 ja 가 아니라 JP).
          lang: eximbayLang(lang),
        })
        if (!ready.ok) {
          // 준비가 실패하면 결제창 자체를 못 띄운다. 방금 만든 주문은 접어둔다 —
          // pending 으로 남기면 대사가 존재하지도 않는 결제를 계속 PG 에 물어본다.
          await admin
            .from('payments')
            .update({
              status: 'failed',
              fail_code: ready.code,
              fail_message: ready.message,
              updated_at: new Date().toISOString(),
            })
            .eq('order_id', orderId)
            .eq('status', 'pending')
          return json({ error: `결제 준비에 실패했습니다. (${ready.code}) ${ready.message}` }, 502)
        }
        eximbay = { sdkUrl: eximbaySdkUrl(), fgkey: ready.fgkey, payload: ready.payload }
      }

      return json({
        orderId,
        orderName: product.orderName,
        amount: product.amount, // 정가(달러 센트)
        currency: 'USD',
        customerKey,
        provider: providerName,
        // 실제로 청구되는 값. 화면 고지문이 "얼마가 빠지는지"를 정확히 말하려면 정가만으론 부족하다
        // (엑심베이는 달러로 빠진다). 정가와 같으면 프론트가 원화 문구를 그대로 쓴다.
        charge,
        eximbay, // 토스면 undefined — 프론트는 이 값 유무로 결제창 종류를 고르지 않는다(provider 를 본다)
        env: getProvider(providerName).env(), // 테스트키/실키 혼용을 화면에서도 알아챌 수 있게 같이 내려준다
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
      // ⛔ confirm 은 **pending 주문만** 승인한다. paid 외의 비-pending 상태(refunded·canceled·failed·
      //    expired·waiting_deposit)를 재진입시키면 (1) 종결 행을 덮어써 대사 회수 신호가 깨지고,
      //    (2) 실패했던 주문이 토스 재승인으로 paid+지급으로 되살아나는 무단 지급이 열린다.
      //    이 상태들은 토스를 부르지 않고 저장된 결과를 그대로 돌려준다(멱등).
      if (row.status !== 'pending') {
        return json({ status: row.status, fulfilled: Boolean(row.fulfilled_at), productType: row.product_type, productRef: row.product_ref })
      }

      // ② successUrl 의 amount 를 그대로 승인에 넘기지 않는다 — 저장된 주문 금액과 대조부터 한다.
      //    ⚠️ 대조 기준은 정가(원화)가 아니라 **PG 에 실제로 청구한 값**이다. 엑심베이는 달러로 청구하므로
      //       원화로 대조하면 정상 결제가 전부 금액불일치로 막힌다.
      //    ⚠️ 소수를 그대로 !== 로 비교하지 않는다 — 달러는 센트 단위라 부동소수 표현 차이로 어긋날 수 있다.
      const chg = chargeOf(row)
      const cents = (v: number) => Math.round(v * 100)
      if (!Number.isFinite(clientAmount) || cents(clientAmount) !== cents(chg.amount)) {
        await admin
          .from('payments')
          .update({ status: 'failed', fail_code: 'AMOUNT_MISMATCH', fail_message: `요청 ${clientAmount} ≠ 주문 ${chg.amount} ${chg.currency}`, updated_at: new Date().toISOString() })
          .eq('id', row.id)
          .eq('status', 'pending')  // 금액 검사는 선점 전이라 여기선 pending 만 본다
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
      //    ※ 이 검사만으로는 **두 confirm 이 동시에** 들어오는 경우를 못 막는다(그 순간 paid 행이 없어 둘 다 통과).
      //      그래서 아래에서 PG 를 부르기 직전에 주문을 'confirming' 으로 선점한다 — 그게 최종 방어선이고
      //      이 검사는 사용자에게 이유를 알려주는 앞단이다(2026-08-10 마이그레이션 payments_confirming).
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

      // ⛔ **PG 를 부르기 전에 주문을 선점한다.** 위 dupPaid 검사는 원자적이지 않다 —
      //    같은 상품의 confirm 두 개가 동시에 들어오면 둘 다 "완료된 결제 없음"을 보고 통과하고,
      //    토스가 두 건 다 승인해서 **돈이 두 번 빠진다**(두 번째는 우리 DB 유니크에서만 터진다).
      //    선점은 payments_confirming_product_uniq 가 (사람 × 상품) 단위로 막으므로 한 번에 하나만
      //    PG 로 나간다 — 진 쪽은 결제가 아예 시작되지 않는다.
      //  ⚠️ 'confirming' 은 일시 상태다. 선점만 하고 끊기면 행이 여기 남는데, 그건 reconcile 이
      //     미완결 대상에 포함해 PG 에 다시 물어 수렴시키고, 아래 실패 경로들이 잠금을 풀어준다.
      //     (안 풀면 그 상품은 영영 잠겨 사용자가 재시도할 수 없다.)
      {
        const { data: claimed, error: claimErr } = await admin
          .from('payments')
          .update({ status: 'confirming', updated_at: new Date().toISOString() })
          .eq('id', row.id)
          .eq('status', 'pending')
          .select('id')
        if (claimErr) {
          // 23505 = payments_confirming_product_uniq = 같은 상품의 승인이 이미 PG 로 나가 있다.
          if ((claimErr as { code?: string }).code === '23505') {
            await admin
              .from('payments')
              .update({
                status: 'failed',
                fail_code: 'DUPLICATE_PRODUCT',
                fail_message: '같은 상품의 승인이 이미 진행 중입니다.',
                updated_at: new Date().toISOString(),
              })
              .eq('id', row.id)
              .eq('status', 'pending')
            return json(
              { error: '이미 결제가 완료된 상품입니다. 결제를 진행하지 않았습니다.', code: 'already_paid', owned: true },
              400,
            )
          }
          return json({ error: claimErr.message }, 400)
        }
        // 0행 = 그사이 이 주문이 pending 이 아니게 됐다. 저장된 현재 상태를 그대로 돌려준다(멱등).
        if (!claimed || claimed.length === 0) {
          const { data: now } = await admin.from('payments').select(PAYMENT_COLS).eq('id', row.id).maybeSingle()
          const cur = (now ?? row) as PaymentRow
          return json({
            status: cur.status,
            fulfilled: Boolean(cur.fulfilled_at),
            productType: cur.product_type,
            productRef: cur.product_ref,
          })
        }
      }

      // 이 주문이 어느 PG 로 열렸는지에 따라 어댑터를 고른다. 아래는 PG 를 모른다.
      const provider = getProvider(row.provider)

      // 승인에 넘기는 금액은 **저장된 주문 금액**(row.amount). 멱등키는 주문마다 고정(row.id)이라
      // 사용자가 새로고침으로 두 번 눌러도 PG 에서 두 번 승인되지 않는다.
      const res = await provider.confirm({
        providerKey: paymentKey,
        orderId,
        // **저장된 청구값**(클라 값 금지). 토스는 정가와 같고, 엑심베이는 달러다.
        amount: chg.amount,
        currency: chg.currency,
        idempotencyKey: row.id,
        // 엑심베이 전용 — 결제창이 브라우저로 돌려준 쿼리스트링 원문. 어댑터가 /verify 로 위변조를 검증하고
        // 상태는 PG 에 다시 물어 확인한다(이 문자열 자체를 결제 성공 근거로 쓰지 않는다). 토스는 무시한다.
        rawQuery: typeof body?.rawQuery === 'string' ? body.rawQuery : undefined,
      })

      if (!res.ok) {
        // 승인 실패를 곧바로 '결제 실패'로 단정하지 않는다 — 이미 승인된 건인데 응답만 못 받았을 수 있다.
        // 조회 API 로 실제 상태를 확인하고 분기한다.
        const check = await provider.queryByOrderId(orderId, chg)
        if (check.ok) {
          const out = await settleFromProvider(admin, row, check.data)
          if (out.status === 'paid') {
            return json({ status: 'paid', fulfilled: out.fulfilled, productType: row.product_type, productRef: row.product_ref })
          }
          return json({ error: res.error.message, code: res.error.code, status: out.status }, 400)
        }
        // pending 일 때만 failed 로 내린다 — 종결 상태(refunded/canceled/paid/…)를 덮어쓰지 않는다.
        //   (위 confirm 진입부가 이미 non-pending 을 단락시키지만, 동시성으로 그사이 바뀐 경우까지 막는다.)
        await admin
          .from('payments')
          .update({ status: 'failed', fail_code: res.error.code, fail_message: res.error.message, payment_key: paymentKey, updated_at: new Date().toISOString() })
          .eq('id', row.id)
          // 여기까지 왔으면 이 주문은 위에서 'confirming' 으로 선점돼 있다 — 실패로 접으면서 잠금도 푼다.
          .in('status', ['pending', 'confirming'])
        return json({ error: res.error.message, code: res.error.code }, 400)
      }

      const out = await settleFromProvider(admin, row, res.data)
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
