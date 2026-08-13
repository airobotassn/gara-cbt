// 결제 결과 (/pay/success · /pay/fail) — 결제창이 돌아오는 자리(토스 successUrl/failUrl · 엑심베이 return_url).
//
// ⚠️ 여기 도착한 것만으로는 결제가 된 게 아니다. 인증만 끝났을 뿐이라, **서버가 승인 API 를 호출해
//    성공해야** 비로소 결제이고 그때 지급된다. 그래서 이 화면은 도착하자마자 confirm 을 부른다.
// ⚠️ failUrl 로 온 경우엔 승인을 부르면 안 된다(인증 실패·사용자 취소). 코드만 보여주고 재시도 길을 준다.
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { usdc } from '../lib/money'
import { confirmOrder, orderStatus, type PaymentStatusResp, type ProductType } from '../lib/payments'
import SiteFooter from '../components/SiteFooter'

// 실패(failUrl) 콜백에는 **상품 정보가 없다** — 토스가 주는 건 code·message·orderId 뿐이라,
// 승인 응답(productType)을 못 받는 이 경로에서는 어디로 돌려보낼지 알 방법이 없다.
// 그래서 체크아웃이 결제창으로 나가기 직전에 상품 종류를 세션에 적어두고 여기서 읽는다.
// ⚠️ CTA 목적지 하나를 정하는 **표시용 힌트**다. 권한·지급 판정에 절대 쓰지 말 것(사용자가 고칠 수 있는 값이다).
// ⚠️ Checkout.tsx 가 같은 키로 쓴다 — 한쪽만 바꾸면 조용히 안 맞는다.
const PRODUCT_HINT_KEY = 'payProductType'

/** 저장이 막혀 있거나(프라이빗 모드) 힌트가 없으면 빈 문자열 — 그때는 이북 기준 CTA 로 떨어진다. */
function productHint(): ProductType | '' {
  try {
    return (sessionStorage.getItem(PRODUCT_HINT_KEY) ?? '') as ProductType | ''
  } catch {
    return ''
  }
}

type View =
  | { kind: 'working' }
  | { kind: 'done'; res: PaymentStatusResp }
  | { kind: 'free' }
  | { kind: 'failed'; message: string; code?: string }

export default function PayResult() {
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { t, lang } = useT()

  const isFail = location.pathname.endsWith('/fail')

  // 어느 PG 가 돌려보낸 콜백인가 — 파라미터 이름이 다르다. 엑심베이는 order_id·transaction_id(스네이크케이스)를
  // 쓰고, **실패도 이 주소로 돌아온다**(토스처럼 failUrl 이 따로 없다). 그래서 rescode 로 성패를 먼저 가른다.
  const exOrderId = params.get('order_id') ?? ''
  const isEximbay = Boolean(exOrderId)
  const exCode = params.get('rescode') ?? ''
  const paymentKey = isEximbay ? params.get('transaction_id') ?? '' : params.get('paymentKey') ?? ''
  const orderId = isEximbay ? exOrderId : params.get('orderId') ?? ''
  const amount = Number(params.get('amount') ?? NaN)
  // 엑심베이 /verify 는 이 **원문**을 통째로 받아 fgkey 로 위변조를 판정한다. 파싱해서 재조립하면
  // 인코딩·순서가 달라져 검증이 깨지므로 브라우저가 준 문자열을 손대지 않고 그대로 넘긴다.
  const rawQuery = location.search

  // 첫 화면은 URL 만 보면 정해진다(실패·무료·정보부족). effect 안에서 동기 setState 를 하지 않도록
  // 초기값으로 계산해 두고, effect 는 승인 호출이 필요한 경우에만 일한다.
  const [view, setView] = useState<View>(() => {
    if (isFail) {
      return {
        kind: 'failed',
        code: params.get('code') ?? undefined,
        message: params.get('message') || t('pay.fail_body'),
      }
    }
    if (params.get('free')) return { kind: 'free' } // 0원 상품 — 서버가 이미 지급했다
    // 엑심베이가 실패로 돌아온 경우. 토스의 failUrl 과 같은 자리이므로 **승인을 부르지 않는다**.
    // (주문은 pending 으로 남고 대사가 만료로 접는다 — 결제가 안 된 건을 우리가 failed 로 단정하지 않는다.)
    if (isEximbay && exCode !== '0000') {
      return { kind: 'failed', code: exCode || undefined, message: params.get('resmsg') || t('pay.fail_body') }
    }
    if (!paymentKey || !orderId || !Number.isFinite(amount)) {
      return { kind: 'failed', message: t('pay.bad_request') }
    }
    return { kind: 'working' }
  })
  // ⛔ 엑심베이는 결제창을 **팝업으로 연다.** 그 팝업이 결과 주소로 돌아오는데, 그냥 두면 팝업이
  //    우리 사이트를 통째로 띄운 두 번째 브라우저가 된다 — 결제 후 마이페이지·이북까지 그 작은 창
  //    안에서 돌아다니게 되고, 정작 원래 창은 결제 화면에 멈춰 있다(2026-08-11 실기기에서 겪음).
  //    그래서 결과를 원래 창에 넘기고 팝업은 닫는다. 승인도 원래 창에서 한 번만 돈다.
  //  ⚠️ **엑심베이 콜백일 때만** 넘긴다. `window.opener` 만 보면 안 된다 — 사용자가 다른 사이트에서
  //     새 탭으로 우리를 열었어도 opener 가 있어서, 토스로 결제한 사람의 탭을 닫아버린다.
  //  ⚠️ 넘기기를 **초기화 함수 안에서** 시도한다. 이펙트로 미루면 실패했을 때 "이 창에서 계속"으로
  //     되돌리려고 setState 를 해야 하는데(react-hooks/set-state-in-effect 위반), 그러면 승인이
  //     한 박자 늦게 돌아 결과 화면이 깜빡인다. 같은 주소로 replace 하는 것뿐이라 두 번 돌아도 무해하다.
  const [handoff] = useState(() => {
    try {
      if (!isEximbay) return false
      const op = window.opener as Window | null
      if (!op || op === window) return false
      op.location.replace(window.location.href)
      return true
    } catch {
      return false // 못 넘겼으면(창이 닫혔거나 막혔거나) 이 창에서 그대로 승인까지 진행한다
    }
  })

  useEffect(() => {
    if (handoff) window.close()
  }, [handoff])

  const ranRef = useRef(false) // StrictMode 중복 실행 방지(서버도 멱등이지만 호출을 아낀다)

  useEffect(() => {
    // 승인해야 할 게 있을 때만 움직인다. failUrl 로 온 건은 절대 승인을 부르지 않는다.
    // 팝업이면 여기서 부르지 않는다 — 원래 창이 같은 주소를 받아 부른다.
    if (handoff || view.kind !== 'working' || ranRef.current) return
    ranRef.current = true

    confirmOrder({ paymentKey, orderId, amount, rawQuery: isEximbay ? rawQuery : undefined })
      .then((res) => setView({ kind: 'done', res }))
      .catch(async (e) => {
        // ⛔ **승인 호출이 끊긴 것과 결제가 실패한 것은 다르다.** 엑심베이는 결제창에서 이미 승인·매입을
        //    마치고 결과만 돌려주는 구조라, 이 호출이 네트워크에서 끊겨도 돈은 이미 빠져 있다. 게다가
        //    서버-서버 통지(status_url)가 우리 상태를 따로 맞추므로 **대개는 이미 지급까지 끝나 있다.**
        //    여기서 곧장 '결제 실패'를 띄우면 화면만 정반대로 말하고, 사용자는 다시 결제하려 든다
        //    (2026-08-11 실제로 그랬다 — 창이 닫히며 요청이 끊겨 502, 결제는 정상 완료).
        //    그래서 실패로 단정하기 전에 **저장된 주문 상태를 다시 읽는다**(조회일 뿐 승인하지 않는다).
        for (const wait of [600, 2000]) {
          await new Promise((r) => setTimeout(r, wait))
          try {
            const st = await orderStatus(orderId)
            if (st.status !== 'pending') {
              setView({ kind: 'done', res: st })
              return
            }
          } catch { /* 조회까지 실패하면 아래 실패 화면으로 떨어진다 */ }
        }
        setView({ kind: 'failed', message: e instanceof Error ? e.message : t('pay.error_generic') })
      })
  }, [handoff, view.kind, paymentKey, orderId, amount, isEximbay, rawQuery, t])

  // 상품 종류 — 승인 응답이 정본이고, 실패 화면에서만 세션 힌트로 대신한다.
  //   'free'(0원 즉시지급)는 이북 전용이라 힌트를 보지 않는다 — 응시료는 0원 분기를 타지 않게 서버가 막는다.
  const productType: ProductType | '' =
    view.kind === 'done'
      ? view.res.productType
      : view.kind === 'failed'
        ? productHint()
        : ''
  const isExam = productType === 'exam'
  const isCert = productType === 'cert'

  const goLibrary = () => navigate('/mypage/ebooks')
  const goStore = () => navigate('/ebooks')
  // 응시권은 마이페이지 '시험 응시 현황' 탭에 있다(별도 탭을 만들지 않았다 — 같은 물건의 앞뒤 상태라서).
  const goTickets = () => navigate('/mypage/attempts')
  const goPlan = () => navigate('/plan')

  // 자격증 발급비는 **지급물이 없는 결제**다(정본 = payments 행 하나). 사용자에게 남은 마무리는
  // "발급 버튼을 한 번 더 누르는 것"이라, 결제한 그 응시로 되돌려 발급이 자동으로 이어지게 한다.
  //   ?cert=<attemptId> → MyPage 가 그 응시의 발급 화면을 열고 → Certificate 가 결제 전에 입력한
  //   영문 성명으로 곧바로 발급한다. 응시 id 가 없으면(실패 화면 등) 목록까지만 데려간다.
  const certRef = view.kind === 'done' && view.res.productType === 'cert' ? view.res.productRef : ''
  const goCert = () => navigate(certRef ? `/mypage/attempts?cert=${certRef}` : '/mypage/attempts')

  // CTA 는 상품이 셋(이북·응시권·자격증)이라 삼항을 화면마다 늘어놓지 않고 여기서 한 번만 고른다.
  const okGo = isCert ? goCert : isExam ? goTickets : goLibrary
  const okLabel = isCert ? t('pay.go_cert') : isExam ? t('pay.go_tickets') : t('ebook.go_library')
  // 실패·재시도 — 자격증은 응시 내역에서 다시 발급을 누르는 게 재시도 경로다.
  const retryGo = isCert ? goTickets : isExam ? goPlan : goStore
  const retryLabel = isCert ? t('pay.go_attempts') : isExam ? t('pay.go_plan') : t('pay.retry')

  return (
    <div className="bg-background text-on-surface min-h-screen flex flex-col">
      <main className="flex-grow flex items-center justify-center px-margin-mobile py-24">
        <div className="max-w-md w-full text-center bg-surface-container-low border border-outline-variant/30 rounded-2xl p-10 ambient-shadow">
          {/* 팝업이 스스로 닫히기 직전에 잠깐 보이는 화면. 브라우저가 닫기를 막으면 이 문구가 남는다. */}
          {handoff && (
            <>
              <Icon name="hourglass_top" tone="neutral" />
              <Title>{t('pay.confirming')}</Title>
              <Body>{t('pay.confirming_body')}</Body>
            </>
          )}

          {!handoff && view.kind === 'working' && (
            <>
              <Icon name="hourglass_top" tone="neutral" />
              <Title>{t('pay.confirming')}</Title>
              <Body>{t('pay.confirming_body')}</Body>
            </>
          )}

          {view.kind === 'free' && (
            <>
              <Icon name="check_circle" tone="ok" />
              <Title>{t('pay.free_title')}</Title>
              <Body>{t('pay.free_body')}</Body>
              <Cta onClick={goLibrary}>{t('ebook.go_library')}</Cta>
            </>
          )}

          {/* 결제 직후 첫 화면이라 CTA 가 틀리면 신뢰에 바로 타격이다 — 응시료를 냈는데 'E-BOOK 서재로'가 뜨면 안 된다.
              금액 표기는 표시가(달러)다. 실제 청구는 원화이고 그 고지는 체크아웃에서 이미 했다. */}
          {/* ⛔ 결제는 됐는데 지급이 보류된 상태(paid + fulfilled=false).
              접수 마감 직후 승인, 그 사이 관리자가 급수를 내림 등에서 나온다. **절대 '결제 실패'로 보여주면 안 된다** —
              돈은 이미 빠졌다. 실패로 표시하면 사용자가 다시 결제하려다 '이미 결제 완료'를 보고 두 화면이 정반대로 말한다.
              서버는 payments 를 paid + fulfilled_at=null 로 남겨 대사 목록에 올려두고, 사람이 수기 발급이나 환불을 판단한다. */}
          {view.kind === 'done' && view.res.status === 'paid' && !view.res.fulfilled && (
            <>
              <Icon name="hourglass_top" tone="neutral" />
              <Title>{t('pay.hold_title')}</Title>
              <Body>{t('pay.hold_body')}</Body>
              <Cta onClick={okGo}>{okLabel}</Cta>
            </>
          )}

          {view.kind === 'done' && view.res.status === 'paid' && view.res.fulfilled && (
            <>
              <Icon name="check_circle" tone="ok" />
              <Title>{isCert ? t('pay.cert_success_title') : isExam ? t('pay.exam_success_title') : t('pay.success_title')}</Title>
              <Body>
                {view.res.orderName}
                {typeof view.res.amount === 'number' ? ` · ${usdc(view.res.amount, lang)}` : ''}
                {/* 응시료는 '결제 완료'로 끝나면 안 된다 — 응시권이 어디 있고 언제 쓰는지까지 말해줘야 한다.
                    자격증도 마찬가지로 아직 한 걸음 남았다(발급). 결제로 끝났다고 읽히면 안 된다. */}
                {isExam && <span className="block mt-2">{t('pay.exam_success_body')}</span>}
                {isCert && <span className="block mt-2">{t('pay.cert_success_body')}</span>}
              </Body>
              <Cta onClick={okGo}>{okLabel}</Cta>
            </>
          )}

          {/* 가상계좌 — 계좌는 나왔지만 입금 전이라 아직 지급되지 않았다. 이북은 입금하면 웹훅이 알아서 지급한다.
              ⚠️ 응시료는 가상계좌를 쓰지 않기로 했다(D3) — 입금이 접수 마감 뒤에 들어와도 응시권을 줄 수 없어서다.
                 그래도 이 화면에 닿는 경로가 남아 있으므로(웹훅·대사) 이북과 같은 문구를 쓰면 안 된다. */}
          {view.kind === 'done' && view.res.status === 'waiting_deposit' && (
            <>
              <Icon name="account_balance" tone="neutral" />
              <Title>{t('pay.waiting_title')}</Title>
              <Body>{isCert ? t('pay.cert_waiting_body') : isExam ? t('pay.exam_waiting_body') : t('pay.waiting_body')}</Body>
              <Cta onClick={isCert ? goTickets : isExam ? goTickets : goStore}>
                {isCert ? t('pay.go_attempts') : isExam ? t('pay.go_tickets') : t('ebook.go_store')}
              </Cta>
            </>
          )}

          {view.kind === 'done' && view.res.status !== 'paid' && view.res.status !== 'waiting_deposit' && (
            <>
              <Icon name="error" tone="bad" />
              <Title>{t('pay.fail_title')}</Title>
              <Body>{t('pay.fail_body')}</Body>
              <Cta onClick={retryGo}>{retryLabel}</Cta>
            </>
          )}

          {view.kind === 'failed' && (
            <>
              <Icon name="error" tone="bad" />
              <Title>{t('pay.fail_title')}</Title>
              <Body>{view.message}</Body>
              {view.code && (
                <p className="font-body-md text-[14px] text-on-surface-variant/70 mb-6">{view.code}</p>
              )}
              <Cta onClick={retryGo}>{retryLabel}</Cta>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}

function Icon({ name, tone }: { name: string; tone: 'ok' | 'bad' | 'neutral' }) {
  const cls =
    tone === 'ok'
      ? 'bg-primary/10 text-primary'
      : tone === 'bad'
        ? 'bg-error/10 text-error'
        : 'bg-surface-container-high text-on-surface-variant'
  return (
    <div className={`w-16 h-16 rounded-full ${cls} flex items-center justify-center mx-auto mb-5`}>
      <span className="material-symbols-outlined text-[32px]">{name}</span>
    </div>
  )
}

const Title = ({ children }: { children: React.ReactNode }) => (
  <h1 className="font-title-md text-title-md font-bold text-on-surface mb-2">{children}</h1>
)

const Body = ({ children }: { children: React.ReactNode }) => (
  <p className="font-body-md text-[16px] text-on-surface-variant mb-6 break-keep">{children}</p>
)

const Cta = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button
    onClick={onClick}
    className="bg-primary text-on-primary font-label-md text-[16px] font-bold px-6 py-3 rounded-xl ambient-shadow"
  >
    {children}
  </button>
)
