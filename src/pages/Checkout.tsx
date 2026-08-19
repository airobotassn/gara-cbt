// 결제 화면 (/checkout?type=ebook&ref=<상품ID>)
//   진입 → 서버가 주문을 만들고(금액도 서버가 계산) → 엑심베이 결제창 → 결제 후 /pay/success 로 복귀.
//   금액을 쿼리로 받지 않는 게 핵심이다. URL 의 숫자를 고쳐도 결제 금액은 안 바뀐다.
//
//   PG 는 엑심베이 하나다(2026-08-13, 토스 제거). **국내/해외를 사용자가 고르지 않는다** —
//   서버가 프로필 국가로 MID·통화를 정하고(한국=원화 국내 MID / 그 외=달러 해외 MID),
//   프론트는 그 결과(charge)를 받아 "얼마가 빠지는지"만 보여준다.
//
//   ⚠️ 엑심베이 결제창은 우리 페이지에 아무것도 그리지 않는다. 버튼을 누르면 PG 창이 열리고
//      결제수단은 거기서 고른다 — 화면이 비어 보이지 않도록 안내 문구가 반드시 필요하다.
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'
import { krw, usdc } from '../lib/money'
import { createOrder, type CreateOrderResp, type ProductType } from '../lib/payments'
import SiteFooter from '../components/SiteFooter'

type Phase = 'loading' | 'ready' | 'error'

// 결제가 실패로 돌아오면 콜백에 상품 정보가 없다 — 결과 화면이 돌려보낼 곳(이북 스토어 vs 시험 접수)을
// 고를 수 있도록 결제창으로 나가기 직전에 적어둔다.
// ⚠️ PayResult.tsx 가 같은 키로 읽는다. 표시용 힌트일 뿐이라 권한 판정에 쓰면 안 된다.
const PRODUCT_HINT_KEY = 'payProductType'

/** 엑심베이 JS SDK 가 심는 전역. 스크립트를 로드해야 생긴다. */
declare global {
  interface Window {
    EXIMBAY?: { request_pay: (args: Record<string, unknown>) => void }
  }
}

/** 같은 src 를 두 번 넣지 않는다 — 오갈 때마다 script 태그가 쌓이면 전역이 재정의된다. */
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
  const { t, lang } = useT()
  const { isFullUser, loading: authLoading } = useAuth()

  const productType = (params.get('type') ?? '') as ProductType
  const productRef = params.get('ref') ?? ''
  // 원서접수 화면에서 함께 담은 교재. 여기선 **id 를 서버로 전달만** 한다(가격은 서버가 뽑는다).
  const addonEbookId = params.get('book') ?? ''
  // 묶음 결제로 담은 이북 id 들(쉼표 구분). 여기서도 **전달만** 한다 — 금액·할인은 서버가 다시 뽑는다.
  const bundleIdsRaw = params.get('ids') ?? ''
  const bundleIds = bundleIdsRaw ? bundleIdsRaw.split(',').filter(Boolean) : []

  // URL 만 보면 바로 알 수 있는 실패는 effect 가 아니라 렌더 단계에서 판정한다
  // (effect 안에서 동기 setState 를 하면 렌더가 한 번 더 돈다 — react-hooks/set-state-in-effect).
  const preflightErr = !productType || !productRef ? t('pay.bad_request') : ''

  const [phase, setPhase] = useState<Phase>('loading')
  const [err, setErr] = useState('')
  const [order, setOrder] = useState<CreateOrderResp | null>(null)
  const [paying, setPaying] = useState(false)

  // StrictMode 는 개발에서 effect 를 두 번 돌린다 — 막지 않으면 주문이 두 개 생긴다.
  const startedRef = useRef(false)

  useEffect(() => {
    if (authLoading) return
    if (!isFullUser) {
      try {
        // ⚠️ 담은 교재도 같이 실어야 한다 — 빠뜨리면 로그인하고 돌아온 사람의 장바구니가 조용히 비워진다.
        const back = `/checkout?type=${productType}&ref=${productRef}${addonEbookId ? `&book=${addonEbookId}` : ''}${bundleIdsRaw ? `&ids=${bundleIdsRaw}` : ''}`
        sessionStorage.setItem('postLoginRedirect', back)
      } catch { /* 무시 */ }
      navigate('/login', { replace: true })
      return
    }
    if (preflightErr) return // 위에서 이미 판정났다 — 주문을 만들지 않는다
    if (startedRef.current) return
    startedRef.current = true

    ;(async () => {
      try {
        const res = await createOrder(productType, productRef, lang, addonEbookId || null, bundleIds)
        // 0원 상품은 결제창을 타지 않는다 — 서버가 이미 지급했으니 결과 화면으로 바로 보낸다.
        if (res.free) {
          navigate('/pay/success?free=1', { replace: true })
          return
        }
        setOrder(res)
        // 결제창을 여는 데 필요한 SDK 를 미리 받아둔다 — 버튼을 누른 뒤에 받으면
        // 그 지연이 그대로 "눌렀는데 아무 일도 안 남"으로 보인다.
        if (!res.eximbay) throw new Error(t('pay.error_generic'))
        await loadScript(res.eximbay.sdkUrl)
        setPhase('ready')
      } catch (e) {
        setErr(e instanceof Error ? e.message : t('pay.error_generic'))
        setPhase('error')
      }
    })()
    // ⚠️ bundleIds 는 매 렌더 새 배열이라 deps 에 넣으면 이펙트가 계속 돈다(주문이 그때마다 하나씩 생긴다).
    //    원문 문자열(bundleIdsRaw)만 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isFullUser, productType, productRef, addonEbookId, bundleIdsRaw, lang, navigate, t, preflightErr])

  async function pay() {
    if (!order?.orderId || paying) return
    setPaying(true)
    setErr('')
    try {
      try { sessionStorage.setItem(PRODUCT_HINT_KEY, productType) } catch { /* 없으면 결과 화면이 이북 기준으로 떨어질 뿐이다 */ }
      const ex = order.eximbay
      if (!ex || !window.EXIMBAY) throw new Error(t('pay.error_generic'))
      // ⚠️ 페이로드를 여기서 만들지 않는다 — FGKey 는 서버가 /ready 에 보낸 값들의 서명이라
      //    금액 형식·언어·URL 이 한 글자만 달라도 불일치로 결제가 실패한다. 서버가 준 것을 그대로 넘긴다.
      window.EXIMBAY.request_pay({ fgkey: ex.fgkey, ...ex.payload })
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('pay.error_generic'))
      setPaying(false)
    }
  }

  const showError = preflightErr || phase === 'error'
  const chargeKrw = order?.charge?.currency === 'KRW'

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

        {/* 테스트 키로 붙어 있으면 화면에서 바로 보이게 한다 — 실키/테스트키 혼용은 조용히 지나가면 안 된다. */}
        {order?.env === 'test' && (
          <div className="mb-6 rounded-xl border border-tertiary/30 bg-tertiary/5 px-5 py-3 font-body-md text-[15px] text-on-surface-variant">
            {t('pay.test_mode')}
          </div>
        )}

        {showError ? (
          <div className="rounded-2xl border border-error/30 bg-error/5 p-6">
            <p className="font-body-md text-[16px] text-on-surface break-keep">{preflightErr || err}</p>
            {/* 되돌아갈 곳은 상품 종류가 정한다 — 응시료를 결제하다 막힌 사람을 이북 스토어로 보내면 길을 잃는다. */}
            <button
              onClick={() => navigate(productType === 'exam' ? '/plan' : '/ebooks')}
              className="mt-5 px-5 py-2.5 bg-primary text-on-primary font-label-md text-[16px] font-bold rounded-xl"
            >
              {productType === 'exam' ? t('pay.go_plan') : t('ebook.go_store')}
            </button>
          </div>
        ) : (
          <>
            {/* 주문 요약 — 정가는 달러 하나다. 실제로 빠지는 돈은 바로 아래 고지문이 말한다. */}
            <section className="mb-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low p-6">
              <h2 className="font-title-md text-title-md font-bold mb-4">{t('pay.order')}</h2>
              {order ? (
                /* 두 건 이상(응시료 + 교재)이면 줄로 나눠 보여주고 합계를 아래에 둔다.
                   한 건이면 예전과 같은 한 줄 — 없는 소계 줄을 만들지 않는다. */
                (order.items?.length ?? 0) > 1 ? (
                  <div className="flex flex-col gap-3">
                    {order.items!.map((it, i) => (
                      <div key={i} className="flex items-baseline justify-between gap-4">
                        <span className="font-body-md text-[16px] text-on-surface-variant break-keep">{it.name}</span>
                        <span className="font-body-md text-[16px] text-on-surface font-semibold whitespace-nowrap">
                          {usdc(it.amount, lang)}
                        </span>
                      </div>
                    ))}
                    <div className="flex items-baseline justify-between gap-4 border-t border-outline-variant/30 pt-3">
                      <span className="font-title-md text-title-md font-bold text-on-surface">{t('apply.total')}</span>
                      <strong className="font-headline-lg text-[24px] font-black text-primary whitespace-nowrap">
                        {usdc(order.amount ?? 0, lang)}
                      </strong>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="font-body-md text-[16px] text-on-surface break-keep">{order.orderName}</span>
                    <strong className="font-headline-lg text-[24px] font-black text-primary whitespace-nowrap">
                      {usdc(order.amount ?? 0, lang)}
                    </strong>
                  </div>
                )
              ) : (
                <p className="font-body-md text-[15px] text-on-surface-variant">{t('pay.preparing')}</p>
              )}
            </section>

            {/* 실제 청구액 고지 — **결제 버튼 직전에** 있어야 한다. 없으면 결제창에 뜬 원화를 보고
                "금액이 다르다"로 읽는다. 환율은 서버가 주문에 박아 내려준 값이라 프론트가 환산하지 않는다.
                ⚠️ 잔글씨 금지 — 결제 전에 반드시 읽혀야 하는 문장이라 15px 아래로 내리지 말 것. */}
            {order?.charge && (
              <p className="mb-8 rounded-xl border border-outline-variant/30 bg-surface-container px-5 py-3 font-body-md text-[15px] leading-[23px] text-on-surface-variant break-keep">
                {chargeKrw
                  ? t('pay.currency_note', { krw: krw(order.charge.amount, lang) })
                  : t('pay.currency_note_usd', { usd: `$${order.charge.amount.toFixed(2)}` })}
              </p>
            )}

            {/* 엑심베이는 우리 페이지에 아무것도 안 그린다 — 안내가 없으면 화면이 비어 보인다. */}
            <p className="mb-6 rounded-xl border border-outline-variant/30 bg-surface-container px-5 py-4 font-body-md text-[15px] leading-[23px] text-on-surface-variant break-keep">
              {t('pay.pg_eximbay_note')}
            </p>

            {err && phase === 'ready' && (
              <p className="mb-4 font-body-md text-[15px] text-error break-keep">{err}</p>
            )}

            <button
              onClick={pay}
              disabled={phase !== 'ready' || paying}
              className="w-full py-4 bg-primary text-on-primary font-label-md text-[17px] font-bold rounded-2xl ambient-shadow disabled:opacity-50 transition-opacity"
            >
              {paying
                ? t('pay.moving')
                : phase !== 'ready'
                  ? t('pay.preparing')
                  : `${usdc(order?.amount ?? 0, lang)} ${t('pay.pay_button')}`}
            </button>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  )
}
