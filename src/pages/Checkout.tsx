// 결제 화면 (/checkout?type=ebook&ref=<상품ID>)
//   진입 → 서버가 주문을 만들고(금액도 서버가 계산) → 결제창을 띄운다 → 결제 후 /pay/success 로 리다이렉트.
//   금액을 쿼리로 받지 않는 게 핵심이다. URL 의 숫자를 고쳐도 결제 금액은 안 바뀐다.
//
//   결제대행사가 둘이다(2026-08-11) — 국내는 토스, 해외는 엑심베이. 지금은 **개발 단계 비교용**으로
//   사용자가 직접 고르게 열어뒀다. 두 PG 는 결제창 방식 자체가 다르다:
//     · 토스   = 화면 안에 위젯을 그린다(결제수단·약관을 우리 페이지에서 고른다)
//     · 엑심베이 = 화면 안에 아무것도 안 그린다. 버튼을 누르면 PG 결제창이 열리고 거기서 고른다
//   그래서 한 컴포넌트에 두 흐름을 섞지 않고 <PayBox key={pg}> 로 통째로 갈아끼운다 —
//   PG 를 바꾸면 주문도 새로 만들어야 하는데(FGKey·주문행이 PG 에 묶인다) 상태를 손으로 되돌리면 반드시 샌다.
//
//   ⚠️ 결제 흐름 전체 설명은 docs/토스페이먼츠-연동-가드레일.md 참고.
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  loadTossPayments,
  type TossPaymentsWidgets,
  type WidgetAgreementStatus,
} from '@tosspayments/tosspayments-sdk'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'
import { krw, usd } from '../lib/money'
import {
  TOSS_CLIENT_KEY,
  createOrder,
  failUrl,
  isPaymentConfigured,
  successUrl,
  type CreateOrderResp,
  type Pg,
  type ProductType,
} from '../lib/payments'
import SiteFooter from '../components/SiteFooter'

type Phase = 'loading' | 'ready' | 'error'

// 결제 실패로 돌아오면(/pay/fail) 토스는 code·message·orderId 만 준다 — 무슨 상품이었는지가 없다.
// 결제창으로 나가기 직전에 여기 적어두면 결과 화면이 돌려보낼 곳(이북 스토어 vs 시험 접수)을 고를 수 있다.
// ⚠️ PayResult.tsx 가 같은 키로 읽는다. 표시용 힌트일 뿐이라 권한 판정에 쓰면 안 된다.
const PRODUCT_HINT_KEY = 'payProductType'

const PGS: Pg[] = ['toss', 'eximbay']

/** 엑심베이 JS SDK 가 심는 전역. 스크립트를 로드해야 생긴다. */
declare global {
  interface Window {
    EXIMBAY?: { request_pay: (args: Record<string, unknown>) => void }
  }
}

/** 같은 src 를 두 번 넣지 않는다 — PG 를 오갈 때마다 script 태그가 쌓이면 전역이 재정의된다. */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error(`SDK load failed: ${src}`))
    const found = document.querySelector<HTMLScriptElement>(`script[data-pgsdk="${src}"]`)
    if (found) {
      if (found.dataset.loaded === '1') return resolve()
      found.addEventListener('load', () => resolve())
      found.addEventListener('error', fail)
      return
    }
    const el = document.createElement('script')
    el.src = src
    el.async = true
    el.dataset.pgsdk = src
    el.addEventListener('load', () => {
      el.dataset.loaded = '1'
      resolve()
    })
    el.addEventListener('error', fail)
    document.head.appendChild(el)
  })
}

export default function Checkout() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { t } = useT()
  const { isFullUser, loading: authLoading } = useAuth()

  const productType = (params.get('type') ?? '') as ProductType
  const productRef = params.get('ref') ?? ''

  // 개발 단계 비교용 선택. 기본은 국내(토스)다.
  const [pg, setPg] = useState<Pg>('toss')
  // 결제창으로 나가는 중에는 PG 를 못 바꾸게 잠근다(그 사이 주문이 갈리면 어느 쪽이 진행 중인지 알 수 없다).
  const [locked, setLocked] = useState(false)

  // URL 만 보면 바로 알 수 있는 실패는 effect 가 아니라 렌더 단계에서 판정한다
  // (effect 안에서 동기 setState 를 하면 렌더가 한 번 더 돈다 — react-hooks/set-state-in-effect).
  const preflightErr = !productType || !productRef ? t('pay.bad_request') : ''

  useEffect(() => {
    if (authLoading || isFullUser) return
    try {
      sessionStorage.setItem('postLoginRedirect', `/checkout?type=${productType}&ref=${productRef}`)
    } catch { /* 무시 */ }
    navigate('/login', { replace: true })
  }, [authLoading, isFullUser, productType, productRef, navigate])

  return (
    <div className="bg-background text-on-surface min-h-screen flex flex-col">
      <main className="flex-grow w-full max-w-3xl mx-auto px-margin-mobile md:px-margin-desktop pt-12 pb-24">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-on-surface-variant hover:text-primary font-label-md text-label-md mb-6 transition-colors"
        >
          <span className="material-symbols-outlined text-[20px]">arrow_back</span>
          {t('pay.back')}
        </button>

        <h1 className="font-headline-lg text-headline-lg-mobile md:text-headline-lg font-bold mb-8">{t('pay.title')}</h1>

        {preflightErr ? (
          <div className="rounded-2xl border border-error/30 bg-error/5 p-6">
            <p className="font-body-md text-[16px] text-on-surface break-keep">{preflightErr}</p>
            <button
              onClick={() => navigate(productType === 'exam' ? '/plan' : '/ebooks')}
              className="mt-5 px-5 py-2.5 bg-primary text-on-primary font-label-md text-[16px] font-bold rounded-xl"
            >
              {productType === 'exam' ? t('pay.go_plan') : t('ebook.go_store')}
            </button>
          </div>
        ) : (
          <>
            {/* 결제대행사 선택 — 개발 단계 비교용. 정식 오픈 때는 통화·카드 국적으로 자동 결정할 자리다. */}
            <section className="mb-6">
              <h2 className="font-label-md text-[15px] text-on-surface-variant mb-2">{t('pay.pg_label')}</h2>
              <div className="grid grid-cols-2 gap-2">
                {PGS.map((v) => (
                  <button
                    key={v}
                    onClick={() => setPg(v)}
                    disabled={locked}
                    aria-pressed={pg === v}
                    className={`py-3 px-4 rounded-xl font-label-md text-[15px] font-bold border transition-colors disabled:opacity-50 ${
                      pg === v
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-outline-variant/40 bg-surface-container-low text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {v === 'toss' ? t('pay.pg_toss') : t('pay.pg_eximbay')}
                  </button>
                ))}
              </div>
            </section>

            {/* key={pg} — PG 를 바꾸면 주문부터 다시 만든다. 상태를 손으로 되돌리지 않는다. */}
            <PayBox
              key={pg}
              pg={pg}
              productType={productType}
              productRef={productRef}
              onBusy={setLocked}
            />
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  )
}

function PayBox({
  pg,
  productType,
  productRef,
  onBusy,
}: {
  pg: Pg
  productType: ProductType
  productRef: string
  onBusy: (v: boolean) => void
}) {
  const navigate = useNavigate()
  const { t, lang } = useT()
  const { isFullUser, loading: authLoading } = useAuth()

  const [phase, setPhase] = useState<Phase>('loading')
  const [err, setErr] = useState('')
  const [order, setOrder] = useState<CreateOrderResp | null>(null)
  const [paying, setPaying] = useState(false)
  // 약관 미동의로 **확인된** 경우에만 결제 버튼을 잠근다(토스 전용).
  // ⚠️ `agreementStatusChange` 는 이름 그대로 '변경'에만 온다 — 위젯이 처음부터 동의된 상태로 그려지면
  //    이벤트가 한 번도 안 오고, SDK 엔 초기 상태를 읽는 getter 도 없다. 그래서 "동의했을 때만 열기"로
  //    만들면 버튼이 영영 잠긴다(실제로 그렇게 만들었다가 잡음). 모르는 동안은 열어두고,
  //    사용자가 직접 해제하면 그때 이벤트가 와서 잠근다. 미동의로 눌러도 SDK 가 막고 그 에러를 보여준다.
  const [termsBlocked, setTermsBlocked] = useState(false)

  // StrictMode 는 개발에서 effect 를 두 번 돌린다 — 막지 않으면 주문이 두 개 생기고
  // 위젯도 두 번 렌더돼서 SDK 가 에러를 낸다(한 페이지에 결제 UI 는 하나만 가능).
  const startedRef = useRef(false)
  // requestPayment 를 부르려면 위젯 인스턴스를 들고 있어야 한다(토스 전용).
  const widgetsRef = useRef<TossPaymentsWidgets | null>(null)

  useEffect(() => {
    if (authLoading || !isFullUser) return
    if (startedRef.current) return
    startedRef.current = true

    ;(async () => {
      try {
        // 토스는 브라우저에 심는 클라이언트 키가 없으면 위젯 자체를 못 띄운다. 엑심베이는 준비·결제창이
        // 전부 서버가 준 FGKey 로 도므로 프론트 키가 없다 — 그래서 이 검사는 토스 갈래 안에 있어야 한다.
        if (pg === 'toss' && !isPaymentConfigured) throw new Error(t('pay.not_configured'))

        const res = await createOrder(productType, productRef, lang, pg)
        // 0원 상품은 결제창을 타지 않는다 — 서버가 이미 지급했으니 결과 화면으로 바로 보낸다.
        if (res.free) {
          navigate('/pay/success?free=1', { replace: true })
          return
        }
        setOrder(res)

        if (pg === 'toss') {
          const tossPayments = await loadTossPayments(TOSS_CLIENT_KEY)
          const widgets = tossPayments.widgets({ customerKey: res.customerKey as string })
          widgetsRef.current = widgets

          // 금액을 먼저 설정해야 결제 UI 를 그릴 수 있다. (V2 는 setAmount — updateAmount 는 없어졌다)
          await widgets.setAmount({ currency: 'KRW', value: res.amount as number })
          await widgets.renderPaymentMethods({ selector: '#payment-method' })
          const agreement = await widgets.renderAgreement({ selector: '#agreement' })
          // 필수 약관을 해제하면 결제 버튼을 잠근다(위 termsBlocked 주석 참고 — 초기 상태는 안 온다).
          agreement.on('agreementStatusChange', (s: WidgetAgreementStatus) => {
            setTermsBlocked(!s.agreedRequiredTerms)
          })
        } else {
          // 엑심베이는 화면에 그릴 게 없다. 결제창을 여는 데 필요한 SDK 만 미리 받아둔다 —
          // 버튼을 누른 뒤에 받으면 그 지연이 그대로 '눌렀는데 아무 일도 안 남'으로 보인다.
          if (!res.eximbay) throw new Error(t('pay.error_generic'))
          await loadScript(res.eximbay.sdkUrl)
        }

        setPhase('ready')
      } catch (e) {
        setErr(e instanceof Error ? e.message : t('pay.error_generic'))
        setPhase('error')
      }
    })()
  }, [authLoading, isFullUser, pg, productType, productRef, lang, navigate, t])

  async function pay() {
    if (!order?.orderId) return
    setPaying(true)
    onBusy(true)
    setErr('')
    try {
      try { sessionStorage.setItem(PRODUCT_HINT_KEY, productType) } catch { /* 무시 — 없으면 결과 화면이 이북 기준으로 떨어질 뿐이다 */ }

      if (pg === 'toss') {
        if (!widgetsRef.current) return
        // 결제창으로 이동한다. 결과는 successUrl / failUrl 로 돌아온다(승인은 아직 안 된 상태).
        await widgetsRef.current.requestPayment({
          orderId: order.orderId,
          orderName: order.orderName as string,
          successUrl: successUrl(),
          failUrl: failUrl(),
        })
      } else {
        const ex = order.eximbay
        if (!ex || !window.EXIMBAY) throw new Error(t('pay.error_generic'))
        // ⚠️ 페이로드를 여기서 만들지 않는다 — FGKey 는 서버가 /ready 에 보낸 값들의 서명이라
        //    금액 형식·언어·URL 이 한 글자만 달라도 불일치로 결제가 실패한다. 서버가 준 것을 그대로 넘긴다.
        window.EXIMBAY.request_pay({ fgkey: ex.fgkey, ...ex.payload })
      }
    } catch (e) {
      // 사용자가 결제창을 닫은 경우도 여기로 온다. 주문은 pending 으로 남고 대사가 정리한다.
      setErr(e instanceof Error ? e.message : t('pay.error_generic'))
      setPaying(false)
      onBusy(false)
    }
  }

  if (phase === 'error') {
    return (
      <div className="rounded-2xl border border-error/30 bg-error/5 p-6">
        <p className="font-body-md text-[16px] text-on-surface break-keep">{err}</p>
        <button
          onClick={() => navigate(productType === 'exam' ? '/plan' : '/ebooks')}
          className="mt-5 px-5 py-2.5 bg-primary text-on-primary font-label-md text-[16px] font-bold rounded-xl"
        >
          {productType === 'exam' ? t('pay.go_plan') : t('ebook.go_store')}
        </button>
      </div>
    )
  }

  return (
    <>
      {/* 테스트 키로 붙어 있으면 화면에서 바로 보이게 한다 — 실키/테스트키 혼용은 조용히 지나가면 안 된다. */}
      {order?.env === 'test' && (
        <div className="mb-6 rounded-xl border border-tertiary/30 bg-tertiary/5 px-5 py-3 font-body-md text-[15px] text-on-surface-variant">
          {t('pay.test_mode')}
        </div>
      )}

      {/* 주문 요약 — 금액은 서버가 준 값 그대로 보여준다.
          ⚠️ 표시는 달러(고정 환산가), 실제 청구·결제창은 원화다. 그래서 바로 아래 고지문이 **결제 버튼 직전에**
             있어야 한다 — 없으면 결제창의 원화 금액을 보고 "금액이 다르다"고 읽는다. */}
      <section className="mb-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low p-6">
        <h2 className="font-title-md text-title-md font-bold mb-4">{t('pay.order')}</h2>
        {order ? (
          <div className="flex items-baseline justify-between gap-4">
            <span className="font-body-md text-[16px] text-on-surface break-keep">{order.orderName}</span>
            <strong className="font-headline-lg text-[24px] font-black text-primary whitespace-nowrap">
              {usd(order.amount ?? 0, lang)}
            </strong>
          </div>
        ) : (
          <p className="font-body-md text-[15px] text-on-surface-variant">{t('pay.preparing')}</p>
        )}
      </section>

      {/* 고정 환산 고지 — "○월○일 기준 환율"이 아니다. 시장 환율이 아니라 우리가 정한 고정값이다.
          {krw} 자리에 **실제 청구액(원화)** 을 넣는다 — 결제창에 뜰 바로 그 숫자여야 의미가 있다.
          ⚠️ 잔글씨 금지 — 결제 전에 반드시 읽혀야 하는 문장이라 15px 아래로 내리지 말 것. */}
      {order && (
        <p className="mb-8 rounded-xl border border-outline-variant/30 bg-surface-container px-5 py-3 font-body-md text-[15px] leading-[23px] text-on-surface-variant break-keep">
          {t('pay.currency_note', { krw: krw(order.amount ?? 0, lang) })}
        </p>
      )}

      {pg === 'toss' ? (
        // 결제수단·약관 UI 는 SDK 가 이 두 칸에 직접 그린다(우리가 그리지 않는다).
        <>
          <div id="payment-method" className="mb-2" />
          <div id="agreement" className="mb-6" />
        </>
      ) : (
        // 엑심베이는 우리 페이지에 아무것도 안 그린다 — 안내가 없으면 화면이 비어 보인다.
        <p className="mb-6 rounded-xl border border-outline-variant/30 bg-surface-container px-5 py-4 font-body-md text-[15px] leading-[23px] text-on-surface-variant break-keep">
          {t('pay.pg_eximbay_note')}
        </p>
      )}

      {err && phase === 'ready' && (
        <p className="mb-4 font-body-md text-[15px] text-error break-keep">{err}</p>
      )}

      <button
        onClick={pay}
        disabled={phase !== 'ready' || paying || termsBlocked}
        className="w-full py-4 bg-primary text-on-primary font-label-md text-[17px] font-bold rounded-2xl ambient-shadow disabled:opacity-50 transition-opacity"
      >
        {paying
          ? t('pay.moving')
          : phase !== 'ready'
            ? t('pay.preparing')
            : `${usd(order?.amount ?? 0, lang)} ${t('pay.pay_button')}`}
      </button>
    </>
  )
}
