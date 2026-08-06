// 결제 결과 (/pay/success · /pay/fail) — 토스 결제창이 돌아오는 자리.
//
// ⚠️ 여기 도착한 것만으로는 결제가 된 게 아니다. 인증만 끝났을 뿐이라, **서버가 승인 API 를 호출해
//    성공해야** 비로소 결제이고 그때 지급된다. 그래서 이 화면은 도착하자마자 confirm 을 부른다.
// ⚠️ failUrl 로 온 경우엔 승인을 부르면 안 된다(인증 실패·사용자 취소). 코드만 보여주고 재시도 길을 준다.
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { usd } from '../lib/money'
import { confirmOrder, type PaymentStatusResp, type ProductType } from '../lib/payments'
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
  const paymentKey = params.get('paymentKey') ?? ''
  const orderId = params.get('orderId') ?? ''
  const amount = Number(params.get('amount') ?? NaN)

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
    if (!paymentKey || !orderId || !Number.isFinite(amount)) {
      return { kind: 'failed', message: t('pay.bad_request') }
    }
    return { kind: 'working' }
  })
  const ranRef = useRef(false) // StrictMode 중복 실행 방지(서버도 멱등이지만 호출을 아낀다)

  useEffect(() => {
    // 승인해야 할 게 있을 때만 움직인다. failUrl 로 온 건은 절대 승인을 부르지 않는다.
    if (view.kind !== 'working' || ranRef.current) return
    ranRef.current = true

    confirmOrder({ paymentKey, orderId, amount })
      .then((res) => setView({ kind: 'done', res }))
      .catch((e) => setView({ kind: 'failed', message: e instanceof Error ? e.message : t('pay.error_generic') }))
  }, [view.kind, paymentKey, orderId, amount, t])

  // 상품 종류 — 승인 응답이 정본이고, 실패 화면에서만 세션 힌트로 대신한다.
  //   'free'(0원 즉시지급)는 이북 전용이라 힌트를 보지 않는다 — 응시료는 0원 분기를 타지 않게 서버가 막는다.
  const productType: ProductType | '' =
    view.kind === 'done'
      ? view.res.productType
      : view.kind === 'failed'
        ? productHint()
        : ''
  const isExam = productType === 'exam'

  const goLibrary = () => navigate('/mypage/ebooks')
  const goStore = () => navigate('/ebooks')
  // 응시권은 마이페이지 '시험 응시 현황' 탭에 있다(별도 탭을 만들지 않았다 — 같은 물건의 앞뒤 상태라서).
  const goTickets = () => navigate('/mypage/attempts')
  const goPlan = () => navigate('/plan')

  return (
    <div className="bg-background text-on-surface min-h-screen flex flex-col">
      <main className="flex-grow flex items-center justify-center px-margin-mobile py-24">
        <div className="max-w-md w-full text-center bg-surface-container-low border border-outline-variant/30 rounded-2xl p-10 ambient-shadow">
          {view.kind === 'working' && (
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
              <Cta onClick={isExam ? goTickets : goLibrary}>
                {isExam ? t('pay.go_tickets') : t('ebook.go_library')}
              </Cta>
            </>
          )}

          {view.kind === 'done' && view.res.status === 'paid' && view.res.fulfilled && (
            <>
              <Icon name="check_circle" tone="ok" />
              <Title>{isExam ? t('pay.exam_success_title') : t('pay.success_title')}</Title>
              <Body>
                {view.res.orderName}
                {typeof view.res.amount === 'number' ? ` · ${usd(view.res.amount, lang)}` : ''}
                {/* 응시료는 '결제 완료'로 끝나면 안 된다 — 응시권이 어디 있고 언제 쓰는지까지 말해줘야 한다. */}
                {isExam && <span className="block mt-2">{t('pay.exam_success_body')}</span>}
              </Body>
              <Cta onClick={isExam ? goTickets : goLibrary}>{isExam ? t('pay.go_tickets') : t('ebook.go_library')}</Cta>
            </>
          )}

          {/* 가상계좌 — 계좌는 나왔지만 입금 전이라 아직 지급되지 않았다. 이북은 입금하면 웹훅이 알아서 지급한다.
              ⚠️ 응시료는 가상계좌를 쓰지 않기로 했다(D3) — 입금이 접수 마감 뒤에 들어와도 응시권을 줄 수 없어서다.
                 그래도 이 화면에 닿는 경로가 남아 있으므로(웹훅·대사) 이북과 같은 문구를 쓰면 안 된다. */}
          {view.kind === 'done' && view.res.status === 'waiting_deposit' && (
            <>
              <Icon name="account_balance" tone="neutral" />
              <Title>{t('pay.waiting_title')}</Title>
              <Body>{isExam ? t('pay.exam_waiting_body') : t('pay.waiting_body')}</Body>
              <Cta onClick={isExam ? goTickets : goStore}>{isExam ? t('pay.go_tickets') : t('ebook.go_store')}</Cta>
            </>
          )}

          {view.kind === 'done' && view.res.status !== 'paid' && view.res.status !== 'waiting_deposit' && (
            <>
              <Icon name="error" tone="bad" />
              <Title>{t('pay.fail_title')}</Title>
              <Body>{t('pay.fail_body')}</Body>
              <Cta onClick={isExam ? goPlan : goStore}>{isExam ? t('pay.go_plan') : t('pay.retry')}</Cta>
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
              <Cta onClick={isExam ? goPlan : goStore}>{isExam ? t('pay.go_plan') : t('pay.retry')}</Cta>
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
