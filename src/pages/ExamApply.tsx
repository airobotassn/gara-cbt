import { useEffect, useState } from 'react'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'
import { getTracks } from '../lib/caris'
import { useExamFees, feeKey } from '../lib/fees'
import { usdc } from '../lib/money'
import { useExamRounds } from '../lib/rounds'
import { callFunction } from '../lib/supabase'

// 원서접수 — 회차 선택 후 급수를 고르고 결제(/checkout)로 넘긴다.
//   개편(2026-07): CARIS-Ⅰ(Beginner/Pro/Elite)·CARIS-Ⅱ(Master/Grand Master/Zenith) 모두
//   티어별 독립 시험 → 트랙·티어를 고르면 티어별 응시료로 결제. (구 'Pro 단일시험' 분기 폐지)
// 결제 연결(2026-08): '결제하기' → /checkout?type=exam&ref=<roundId>:<tier> (이북과 같은 토스 흐름).
//   ⚠️ **금액을 URL 로 넘기지 않는다.** 결제 금액은 서버(resolveExamOffer)가 회차·급수로 다시 계산한다.
//   ⚠️ 여기서 하는 판정(회차가 연 급수 · 이미 산 급수 · 접수기간)은 전부 **화면 편의**다.
//      진짜 방어선은 서버 — 접수기간/개설 여부는 resolveExamOffer, 중복 결제는 payments 의 부분 유니크와
//      exam_tickets_live_uniq 가 막는다. 여기 판정이 뚫려도 돈이 두 번 빠지지 않는다.
//   로그인 게이트는 이 화면에 두지 않는다 — Checkout 이 미로그인일 때 **로그인 안내 카드**를 띄우고,
//   그 버튼이 복귀 주소(담은 교재까지)를 심어 /login 으로 보낸다(2026-08-24. 예전엔 말없이 튕겼다).
// 응시료 금액은 DB(exam_fees) 원화가 단일 소스이고 **표시만 달러**다(usdc(), $1 = 1,500원 고정 환산).
//
// 추천 교재(2026-08-14): 고른 급수의 CARIS 교재 한 권을 가운데 열에 세우고, '구매하기'를 누르면
//   **결제 요약에 줄이 추가되고 총액이 늘어난다**(별도 결제가 아니라 한 번에 같이 산다).
//   ⚠️ 결제는 계속 `type=exam` 이다 — 교재는 `&book=<id>` 곁다리로 붙는다. 번들을 별도 상품 유형으로 만들면
//      payments_paid_product_uniq 가 (사람×타입×상품) 단위라 같은 급수를 'exam' 으로 한 번, 번들로 또 한 번
//      결제할 수 있게 된다(응시권 이중결제 방어의 본체가 그 인덱스다).
//   ⚠️ 여기 가격은 **표시용**이다. 결제 금액은 서버가 책 id 로 DB 를 다시 읽어 계산한다.

/** /ebooks 스토어 응답 중 이 화면이 쓰는 부분(ebooks 함수 store 액션의 shape()). */
type StoreBook = {
  id: string
  title: string
  description: string | null
  coverUrl: string | null
  price_usd_cents: number
  catalog: 'leveltest' | 'caris'
  targetTier: string | null
  owned: boolean
}

export default function ExamApply() {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const { t, lang } = useT()
  const { isFullUser } = useAuth()

  // 회차는 DB(exam_rounds)가 단일 소스. URL ?round=<id> 가 새로고침에도 살아남는 durable 소스,
  // navigation state 는 클릭 진입 시 즉시 표시용(로딩 깜빡임 방지). 둘 다 없으면 접수중(open) 회차로 폴백.
  const st = location.state as { roundId?: string; roundLabel?: string; dateLabel?: string } | null
  const roundId = params.get('round') ?? st?.roundId ?? ''
  const { regular, rolling, loading } = useExamRounds(lang)
  const allRounds = [...regular, ...rolling]
  const byId = roundId ? allRounds.find((r) => r.id === roundId) : undefined
  // 폴백은 '판매 가능한' 회차로 고른다(status==='open' 이 아니다) — 상시(rolling)는 status 가 늘 open 이라
  // 예전 조건이면 상시 회차로 폴백해 팔 수 없는 회차의 접수화면이 열렸다.
  const openRound = allRounds.find((r) => r.sellable) ?? regular[0] ?? rolling[0]
  const active = byId ?? openRound
  // 정기=시험일(dateText), 상시=설명(note). DB 로딩 전엔 state 값으로 즉시 표시.
  const roundLabel = active?.title ?? st?.roundLabel ?? ''
  const dateLabel = (active ? active.dateText || active.note : '') || st?.dateLabel || ''

  // 트랙 선택 폐지 — 두 트랙의 티어를 한 줄로 이어 붙여(Beginner·Pro·Elite + Master·Grand Master·Zenith)
  // 단일 선택으로 만든다. 트랙 정보는 티어에 붙여 두고 라벨·응시자격 문구에만 쓴다.
  const TRACKS = getTracks(lang)
  const TIERS = TRACKS.flatMap((tr) => tr.tiers.map((tier) => ({ tier, track: tr })))

  // 회차가 연 급수만 판다. 회차 로딩 전엔 판정을 보류한다(전부 '미개설'로 깜빡이면 안 된다).
  const roundReady = !loading && !!active
  const openTiers = active?.openTiers ?? []
  const isTierOpen = (key: string) => !roundReady || openTiers.includes(key)

  // 선택 급수: 사용자가 고르기 전엔 **이 회차가 연 첫 급수**가 기본이다.
  //   useState 초깃값으로 못 박지 못하는 이유 = open_tiers 가 비동기로 온다. 효과로 setState 하면
  //   렌더가 한 번 더 도는 데다 사용자가 이미 고른 값을 덮어쓸 수 있어, 파생값으로 계산한다.
  const [picked, setPicked] = useState<number | null>(null)
  const firstOpen = roundReady ? TIERS.findIndex(({ tier }) => openTiers.includes(tier.key)) : -1
  const level = picked ?? (firstOpen >= 0 ? firstOpen : 0)
  const sel = TIERS[level] ?? TIERS[0]
  const cur = sel.track
  const lv = sel.tier
  const isMaster = cur.key === 't2'
  // 시험 구성(문항) / 시험 시간 분리 — format 은 "구성 · 시간" 패턴(마지막 조각이 시간, ' · ' 구분은 전 언어 공통)
  const fmtParts = lv.format ? lv.format.split(' · ') : []
  const fmtDuration = fmtParts.length > 1 ? fmtParts[fmtParts.length - 1] : ''
  const fmtComposition = fmtParts.length > 1 ? fmtParts.slice(0, -1).join(' · ') : lv.format ?? ''
  // 응시료: **DB(exam_fees) 가 단일 소스**다(2026-08-06). 관리자 화면에서 원 단위로 편집한다.
  //   키 = `${트랙키}_${티어키}`(feeKey). 행이 없는 티어 = 아직 결제를 열지 않은 급수(CARIS-Ⅱ 전부)
  //   → 금액 대신 '준비 중'을 보여주고 결제 버튼을 막는다.
  //   ⚠️ 여기에 하드코딩 폴백을 두면 안 된다. 돈 받는 값이라 "설정 누락"이 조용히 임시금액으로 결제되면 사고다.
  const { fees, loading: feesLoading } = useExamFees()
  const feeAmount = fees[feeKey(cur.key, lv.key)]
  const feeReady = typeof feeAmount === 'number' && feeAmount > 0

  // 보유 응시권 — 이미 산 (회차×급수)는 다시 팔지 않고 '구매 완료'로 보여준다.
  //   타입을 lib/tickets.ts(ExamTicketView)에서 끌어오지 않는 이유: 여기서 쓰는 필드가 셋뿐이고,
  //   그 파일은 마이페이지 카드용 전체 모양이라 화면 하나 때문에 결합을 만들 이유가 없다.
  //   status 는 issued(미사용)·consumed(응시 완료)만 '보유'로 친다 — void/expired 는 서버 유니크에서도
  //   빠져 재구매가 열리는 상태라, 여기서 막으면 살 수 있는 걸 못 사게 된다.
  //   조회 실패는 삼킨다. 이건 편의 표시일 뿐이고 중복 결제는 서버 유니크가 막는다.
  const [ownedRefs, setOwnedRefs] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!isFullUser) return // 비로그인은 볼 응시권이 없다(익명 결제는 payments 가 막는다)
    let alive = true
    ;(async () => {
      try {
        const r = await callFunction<{ tickets?: { roundId: string; tier: string; status: string }[] }>('my-attempts', {})
        if (!alive) return
        setOwnedRefs(
          new Set(
            (r.tickets ?? [])
              .filter((tk) => tk.status === 'issued' || tk.status === 'consumed')
              .map((tk) => `${tk.roundId}:${tk.tier}`),
          ),
        )
      } catch {
        /* 무시 — 서버가 최종 게이트다 */
      }
    })()
    return () => {
      alive = false
    }
  }, [isFullUser])

  // 추천 교재 — 고른 급수(CARIS 카탈로그)의 교재 한 권. 스토어 목록을 그대로 받아 화면에서 고른다
  //   (급수별 조회 액션을 새로 파지 않는다 — 권수가 적고, 스토어가 이미 보유 여부까지 내려준다).
  //   조회 실패는 삼킨다. 이건 곁다리라 없으면 열만 안 세우면 되고, 응시권 결제를 막을 이유가 없다.
  const [storeBooks, setStoreBooks] = useState<StoreBook[] | null>(null)
  useEffect(() => {
    let alive = true
    callFunction<{ ebooks?: StoreBook[] }>('ebooks', { action: 'store', lang })
      .then((r) => { if (alive) setStoreBooks(r.ebooks ?? []) })
      .catch(() => { /* 무시 */ })
    return () => { alive = false }
  }, [lang, isFullUser])

  // 스토어는 sort_order 순이라 첫 번째가 그 급수의 대표 교재다.
  //   (목록이 몇 권뿐이라 memo 하지 않는다 — lv 가 렌더마다 새로 만들어지는 값이라 의존성으로도 못 쓴다.)
  const book = (storeBooks ?? []).find((b) => b.catalog === 'caris' && b.targetTier === lv.key) ?? null
  // '함께 구매' 담김 여부. ⚠️ 이미 가진 책은 담기지 않는다 — 담아도 서버가 409 로 막고,
  //   그 전에 총액이 늘어 사용자가 낼 이유 없는 돈을 보게 된다.
  const [bookPicked, setBookPicked] = useState(false)
  const bookAdded = bookPicked && !!book && !book.owned

  // product_ref 계약: "<round_id>:<tier>" (서버 parseExamRef 와 같은 형식).
  // UUID·티어 어디에도 ':' 가 없어 분해가 항상 성립한다.
  const productRef = active ? `${active.id}:${lv.key}` : ''
  const owned = productRef !== '' && ownedRefs.has(productRef)
  const tierOpen = isTierOpen(lv.key)
  const canPay = !!active?.sellable && roundReady && tierOpen && feeReady && !owned

  // 금액 표기 = 달러 고정 환산($1 = 1,500원). DB·실제 청구는 원화이고, 그 고지문은 결제 직전
  // (/checkout 주문요약 아래)에 붙는다 — 여기서 두 번 말하지 않는다.
  // 빈 문자열 = '아직 모른다'(로딩) → 호출부가 자리에 맞는 플레이스홀더를 고른다.
  const feeText = !roundReady || feesLoading
    ? ''
    : !tierOpen
      ? t('apply.tier_not_open')
      : feeReady
        ? usdc(feeAmount, lang)
        : t('apply.fee_tbd')
  // 총액 = 응시료 + (담았다면) 교재. 응시료를 아직 모르면 합계도 말하지 않는다 —
  // 교재값만 총액으로 띄우면 "응시료가 공짜"로 읽힌다.
  const totalText = feeReady && book && bookAdded
    ? usdc(feeAmount + book.price_usd_cents, lang)
    : feeText
  // 결제 화면으로 넘길 주소. 교재는 **id 만** 붙인다(금액은 서버가 다시 뽑는다).
  const checkoutHref = `/checkout?type=exam&ref=${productRef}${bookAdded && book ? `&book=${book.id}` : ''}`

  // 접수기간 가드: 특정 회차(?round=<id>)로 들어왔는데 그 회차가 판매 가능(정기 + 접수중)이 아니면
  // (마감·예정·상시·없음·지난 시험) 접수화면을 막고 일정으로 유도. 회차 미지정은 판매 가능 회차로
  // 폴백하되 그런 회차조차 없으면 막는다. DB 로딩 중엔 판정 보류.
  // ⚠️ status==='open' 이 아니라 sellable 로 본다 — 상시는 늘 open 이지만 응시권을 팔지 않는다.
  const blocked = !loading && ((roundId ? !byId || !byId.sellable : false) || !active || !active.sellable)
  if (blocked) {
    return (
      <div className="bg-background text-on-surface min-h-screen flex flex-col">
        <main className="flex-grow flex items-center justify-center px-margin-mobile py-24">
          <div className="max-w-md w-full text-center bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-10 ambient-shadow">
            <div className="w-16 h-16 rounded-full bg-surface-container-high text-on-surface-variant flex items-center justify-center mx-auto mb-5">
              <span className="material-symbols-outlined text-[32px]">event_busy</span>
            </div>
            <h1 className="font-title-md text-title-md font-bold text-on-surface mb-2">{t('apply.closed_title')}</h1>
            <p className="font-body-md text-body-md text-on-surface-variant mb-6 break-keep">{t('apply.closed_body')}</p>
            <button
              onClick={() => navigate('/guide')}
              className="bg-primary text-on-primary font-label-md text-label-md font-bold px-6 py-3 rounded-xl ambient-shadow inline-flex items-center gap-2"
            >
              {t('apply.closed_cta')}
              <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
            </button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="bg-background text-on-surface min-h-screen flex flex-col">
      {/* 결제 안내(목업) 모달은 삭제됐다 — 결제하기가 실제로 /checkout 으로 간다(2026-08). */}
      <main className="flex-grow pt-12 pb-24 px-margin-mobile md:px-margin-desktop w-full max-w-container-max mx-auto">
        {/* 돌아갈 곳은 /plan 이다 — 여기로 오는 길이 /guide → /plan → 회차 카드 → /exam/apply 라
            /guide 로 보내면 한 단계를 건너뛰어 방금 고른 회차 목록으로 못 돌아간다(2026-08-20). */}
        <button onClick={() => navigate('/plan')} className="gd-back mb-6">
          <span className="material-symbols-outlined text-[20px]">arrow_back</span>
          {t('apply.back')}
        </button>
        <div className="mb-10">
          <h1 className="font-headline-lg text-headline-lg-mobile md:text-headline-lg font-bold text-on-surface mb-2">{t('apply.title')}</h1>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary font-label-md text-label-md font-bold">
            <span className="material-symbols-outlined text-[18px]">event</span>
            {roundLabel ? (dateLabel ? `${roundLabel} · ${dateLabel}` : roundLabel) : t('common.loading')}
          </div>
        </div>

        {/* 3:1 이 아니라 9:3 인 이유 — 결제 요약은 줄이 서너 개뿐이라 1/3 을 주면 아래가 통째로 비고,
            그만큼 왼쪽이 좁아져 급수 칩 6개가 한 줄에 못 선다(가로 스크롤바가 생겼었다). */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_250px] gap-8">
          {/* 좌: 자격 선택 + 추천 교재.
              한 카드 안에서 세로선으로 나눈다 — 교재를 별도 카드로 떼면 '다른 화면의 광고'처럼 읽히고,
              결제 요약(오른쪽)과의 관계도 흐려진다. 좁은 화면에선 그냥 아래로 쌓인다. */}
          <div className="min-w-0">
            <section className="bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/30 ambient-shadow flex flex-col lg:flex-row gap-4">
            <div className="min-w-0 flex-1">
              <h2 className="font-title-md text-title-md font-bold text-on-surface border-l-4 border-primary pl-3 mb-6">{t('apply.select_cert')}</h2>

              {/* 티어 선택 — 트랙 구분 없이 6개 티어를 한 줄에(Beginner … Zenith).
                  회차가 안 연 급수는 **숨기지 않고** 자물쇠 + 비활성으로 둔다 — 어떤 급수가 있는지 자체가
                  알려야 할 정보라서다. 잠긴 뜻은 아래 한 줄로 설명한다(칩마다 배지를 달면 6개가 다 늘어난다). */}
              <span className="font-label-md text-label-md text-on-surface-variant font-semibold">{t('apply.tier')}</span>
              {/* ⚠️ 넘치면 **접힌다**(가로 스크롤 금지). 옆에 교재 열이 생기면서 6개가 한 줄에 아슬아슬해졌는데,
                  스크롤로 두면 화면에 스크롤바가 뜨고 뒤쪽 급수가 있는지조차 안 보인다. */}
              <div className="flex flex-wrap gap-1.5 p-1.5 rounded-3xl bg-surface-container-high w-fit max-w-full mt-2">
                {TIERS.map(({ tier: l }, i) => {
                  const closed = !isTierOpen(l.key)
                  const bought = active ? ownedRefs.has(`${active.id}:${l.key}`) : false
                  // 칩 크기는 **읽히는 쪽을 우선**한다(2026-08-14 "좀더 키워도 될 것 같다"). 그 대가로
                  // 잠긴 급수가 많은 회차에서는 줄이 접힌다 — 접히는 건 괜찮고 가로 스크롤만 안 나면 된다.
                  const base = 'px-4 py-2.5 rounded-full font-label-md text-[15px] transition-all inline-flex items-center gap-1.5'
                  const cls = i === level
                    ? `${base} bg-primary text-on-primary font-bold`
                    : closed
                      ? `${base} text-outline font-semibold cursor-not-allowed`
                      : `${base} text-on-surface-variant hover:text-on-surface font-semibold`
                  return (
                    /* ⚠️ 급수를 바꾸면 담아둔 교재를 푼다 — 교재는 급수마다 다른 책이라
                       그대로 두면 Beginner 교재를 담아놓고 Pro 를 결제하는 모양이 된다. */
                    <button key={l.key} onClick={() => { setPicked(i); setBookPicked(false) }} disabled={closed} title={closed ? t('apply.tier_not_open') : bought ? t('apply.owned') : undefined} className={cls}>
                      {/* 'Grand Master' 는 **두 줄로 쌓는다**(시안에도 그렇게 그려져 있다) — 이 칩 하나 때문에
                          6개가 한 줄을 못 채우는 걸 막는 장치다. 펴면 줄이 통째로 접힌다. */}
                      <span className="flex flex-col items-center leading-[1.05]">{l.name.split(' ').map((w, k) => <span key={k}>{w}</span>)}</span>
                      {closed && <span className="material-symbols-outlined text-[18px]">lock</span>}
                      {!closed && bought && <span className="material-symbols-outlined text-[18px]">check_circle</span>}
                    </button>
                  )
                })}
              </div>
              {roundReady && TIERS.some(({ tier: l }) => !openTiers.includes(l.key)) && (
                <p className="mt-2 flex items-start gap-1.5 font-label-md text-label-md text-on-surface-variant break-keep">
                  <span className="material-symbols-outlined text-[18px] shrink-0">lock</span>
                  {t('apply.tier_not_open_hint')}
                </p>
              )}

              <div className="mt-6 rounded-2xl border border-outline-variant/30 bg-surface-container-low p-5 flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="inline-flex items-center px-3 py-1.5 rounded-lg bg-primary text-on-primary font-title-md text-title-md font-bold whitespace-nowrap">{cur.name} {lv.name}</span>
                  <span className="font-body-md text-body-md text-on-surface-variant break-keep">{isMaster ? `${t('caris.lbl.eligibility')} · ${lv.prereq}` : lv.target}</span>
                </div>
                <div>
                  <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">{t('caris.lbl.subjects')}</span>
                  <ul className="mt-1.5 flex flex-col gap-1.5">
                    {lv.subjects.map((s, i) => (
                      <li key={i} className="flex items-start gap-2 font-body-md text-body-md text-on-surface break-keep">
                        <span className="text-primary font-bold shrink-0">{i + 1}.</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-col gap-3">
                  {lv.format && (
                    <div>
                      <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">{t('caris.lbl.format')}</span>
                      <p className="mt-1 font-body-md text-body-md text-on-surface font-medium break-keep">{fmtComposition}</p>
                    </div>
                  )}
                  {fmtDuration && (
                    <div>
                      <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">{t('caris.lbl.duration')}</span>
                      <p className="mt-1 font-body-md text-body-md text-on-surface font-medium break-keep">{fmtDuration}</p>
                    </div>
                  )}
                  {lv.method && (
                    <div>
                      <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">{t('caris.lbl.method')}</span>
                      <div className="mt-1 flex flex-col gap-0.5">
                        {lv.method.split(' · ').map((m, i) => {
                          const sp = m.indexOf(' ')
                          const label = sp === -1 ? m : m.slice(0, sp) // 필기/실기 라벨만 볼드
                          const rest = sp === -1 ? '' : m.slice(sp + 1)
                          return (
                            <p key={i} className="font-body-md text-body-md text-on-surface break-keep">
                              <b className="font-bold">{label}</b>{rest ? ` ${rest}` : ''}
                            </p>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  {lv.practical && (
                    <div>
                      <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">{t('caris.lbl.practical')}</span>
                      <p className="mt-1 font-body-md text-body-md text-on-surface font-medium break-keep">{lv.practical}</p>
                    </div>
                  )}
                  <div>
                    <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">{t('caris.lbl.pass')}</span>
                    <div className="mt-1 flex flex-col gap-0.5">
                      {lv.pass.split(' · ').map((p, i) => (
                        <p key={i} className="font-body-md text-body-md text-on-surface font-semibold break-keep">{p}</p>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 추천 교재 — 그 급수의 교재가 실제로 있을 때만 세운다.
                ⚠️ 표지를 작게 줄이지 말 것. 한 권뿐이라 열 폭을 그대로 쓰는 게 맞다(러닝 라이브러리와 같은 규칙). */}
            {book && (
              <div className="lg:w-[236px] shrink-0 lg:border-l lg:border-outline-variant/30 lg:pl-4">
                <h2 className="font-title-md text-title-md font-bold text-on-surface border-l-4 border-primary pl-3 mb-6">{t('apply.book_col')}</h2>

                {/* ⚠️ 표지를 테두리 카드 안에 넣지 말 것 — 그 패딩만큼 표지가 줄어든다(시안 235px → 176px 이 됐었다).
                    표지가 이 열의 주인공이라 **열 폭을 그대로** 쓰고, 글·가격은 그 아래에 그냥 놓는다. */}
                <div className="flex flex-col gap-3">
                  {book.coverUrl && (
                    <img
                      src={book.coverUrl}
                      alt=""
                      className="w-full rounded-xl object-cover aspect-[1/1.414] bg-surface-container-high"
                    />
                  )}
                  <div>
                    <p className="font-title-md text-[17px] font-bold text-on-surface break-keep">{book.title}</p>
                    {book.description && (
                      <p className="mt-1 font-body-md text-[15px] leading-[22px] text-on-surface-variant break-keep line-clamp-3">
                        {book.description}
                      </p>
                    )}
                  </div>

                  {book.owned ? (
                    /* 이미 산 책 — 여기서 또 팔지 않는다. 살 것을 권하는 자리가 아니라
                       "그 책으로 같이 준비하라"고 말하는 자리다. */
                    /* ⚠️ 아이콘을 문장 옆에 flex 로 붙이지 말 것 — 열이 좁아 남는 폭이 150px 남짓이라
                       문장이 서너 줄로 쪼개져 가운데 정렬처럼 보인다. 아이콘은 윗줄에 따로 세운다. */
                    <div className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-3 flex flex-col gap-1.5">
                      <span className="material-symbols-outlined text-[20px] text-primary">menu_book</span>
                      <p className="font-body-md text-[15px] leading-[22px] text-on-surface break-keep">
                        {t('apply.book_owned')}
                      </p>
                      <button
                        type="button"
                        onClick={() => navigate('/mypage/ebooks')}
                        className="self-start inline-flex items-center gap-1 font-label-md text-[15px] font-bold text-primary"
                      >
                        {t('apply.book_owned_cta')}
                        <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <strong className="font-title-md text-[20px] font-black text-primary whitespace-nowrap">
                        {usdc(book.price_usd_cents, lang)}
                      </strong>
                      {/* 누르면 오른쪽 결제 요약에 줄이 붙고 총액이 늘어난다(별도 결제로 새 화면이 열리지 않는다). */}
                      <button
                        type="button"
                        onClick={() => setBookPicked((v) => !v)}
                        aria-pressed={bookAdded}
                        className={
                          bookAdded
                            ? 'inline-flex items-center gap-1.5 rounded-xl border border-primary/50 bg-primary/10 px-4 py-2.5 font-label-md text-[16px] font-bold text-primary'
                            : 'inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 font-label-md text-[16px] font-bold text-on-primary ambient-shadow'
                        }
                      >
                        {bookAdded && <span className="material-symbols-outlined text-[20px]">check</span>}
                        {bookAdded ? t('apply.book_added') : t('apply.book_add')}
                      </button>
                    </div>
                  )}
                </div>

                {!book.owned && (
                  <p className="mt-3 font-label-md text-label-md text-on-surface-variant break-keep">{t('apply.book_note')}</p>
                )}
              </div>
            )}
            </section>
          </div>

          {/* 우: 결제 요약 */}
          {/* sticky 를 카드가 아니라 **바깥 겹**에 건다 — 아래 발급비 경고까지 같이 따라와야 한다.
              카드에 걸어두면 경고만 제자리에 남아 스크롤하면 요약과 따로 논다. */}
          <aside>
            <div className="sticky top-12 flex flex-col gap-4">
            <div className="bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/30 ambient-shadow flex flex-col gap-5">
              <h2 className="font-title-md text-title-md font-bold text-on-surface">{t('apply.pay_summary')}</h2>

              <div className="flex flex-col gap-3">
                <div className="flex justify-between items-start gap-3">
                  <span className="font-body-md text-body-md text-on-surface-variant">{t('apply.round')}</span>
                  <span className="font-body-md text-body-md text-on-surface font-semibold text-right break-keep">{roundLabel}</span>
                </div>
                <div className="flex justify-between items-start gap-3">
                  <span className="font-body-md text-body-md text-on-surface-variant">{t('sched.exam_period')}</span>
                  <span className="font-body-md text-body-md text-on-surface font-semibold text-right break-keep">{dateLabel}</span>
                </div>
                <div className="flex justify-between items-start gap-3">
                  <span className="font-body-md text-body-md text-on-surface-variant">{t('apply.fee')}</span>
                  <span className="font-body-md text-body-md text-on-surface font-semibold">
                    {feeText || t('common.loading')}
                  </span>
                </div>
                {/* 교재를 담았을 때만 뜨는 줄. 이 줄이 곧 "왜 총액이 늘었나"의 답이라 제목을 같이 적는다. */}
                {bookAdded && book && (
                  <div className="flex justify-between items-start gap-3">
                    <span className="font-body-md text-body-md text-on-surface-variant break-keep">
                      {t('apply.book_row', { name: book.title })}
                    </span>
                    <span className="font-body-md text-body-md text-on-surface font-semibold whitespace-nowrap">
                      {usdc(book.price_usd_cents, lang)}
                    </span>
                  </div>
                )}
              </div>

              <div className="border-t border-outline-variant/30 pt-4 flex justify-between items-baseline">
                <span className="font-title-md text-title-md text-on-surface font-bold">{t('apply.total')}</span>
                <span className="font-headline-lg-mobile text-headline-lg-mobile text-primary font-black">
                  {totalText || '—'}
                </span>
              </div>

              {owned ? (
                /* 이미 산 (회차×급수) — 다시 팔지 않는다. 서버도 payments 유니크로 막지만,
                   결제창까지 갔다가 409 를 보는 것보다 여기서 끝내는 게 낫다. */
                <div className="flex flex-col gap-3">
                  <div className="w-full rounded-xl border border-primary/40 bg-primary/10 px-5 py-4 flex items-center justify-center gap-2 font-title-md text-title-md font-bold text-primary text-center break-keep">
                    <span className="material-symbols-outlined shrink-0">check_circle</span>
                    {t('apply.already_applied')}
                  </div>
                  <button
                    onClick={() => navigate('/mypage/attempts')}
                    className="w-full bg-primary text-on-primary font-label-md text-[16px] font-bold px-6 py-3 rounded-xl ambient-shadow flex items-center justify-center gap-2"
                  >
                    {t('apply.owned_cta')}
                    <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => navigate(checkoutHref)}
                  disabled={!canPay}
                  className="w-full bg-primary text-on-primary font-title-md text-title-md font-bold px-6 py-4 rounded-xl enabled:hover:translate-y-[-2px] transition-transform duration-200 ambient-shadow flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {!roundReady || feesLoading
                    ? t('common.loading')
                    : canPay
                      ? t('apply.pay_btn')
                      : !tierOpen
                        ? t('apply.tier_not_open')
                        : t('apply.fee_tbd')}
                  <span className="material-symbols-outlined">arrow_forward</span>
                </button>
              )}
              {/* 안내문. 옛 apply.pay_note('결제는 추후 연결') 는 결제가 실동작하는 지금 거짓말이라 쓰지 않는다
                  — i18n 에 apply.pay_note_live 로 갈아끼울 문구가 이미 들어와 있다(옛 키는 남겨둠).
                  비로그인이라고 여기서 막지는 않는다 — Checkout 이 로그인 안내 카드를 띄우고, 그 버튼이
                  복귀 주소를 심어 결제화면으로 정확히 되돌려준다. 여기서 한 번 더 게이트를 만들면 그 경로가 끊긴다. */}
              <p className="flex items-start gap-1.5 font-label-md text-label-md text-on-surface-variant break-keep">
                <span className="material-symbols-outlined text-[18px] mt-px shrink-0">{isFullUser ? 'lock' : 'login'}</span>
                {isFullUser ? t('apply.pay_note_live') : t('apply.login_required')}
              </p>
            </div>

            {/* 자격증 발급비 경고 — 결제 요약 **밖·아래**에 둔다. 요약 안에 넣으면 지금 낼 돈처럼 읽혀
                총액과 싸운다(이건 합격 뒤에 따로 내는 돈이다).
                ⚠️ **금액을 말하지 않는다.** 이 자리가 할 일은 "합격해도 돈이 한 번 더 든다" 까지고,
                   실제 금액은 발급 화면이 결제할 때 보여준다. 여기에 숫자를 박으면 값이 바뀔 때마다
                   6개국어 문구를 같이 고쳐야 하고, 한 번 어긋나면 그대로 거짓말이 된다
                   (2026-08-19 "응시료와 같은 금액" 이라고 썼다가 사실과 달라 걷어냈다 —
                    서버 cert 분기는 아직 exam_fees 를 그대로 쓴다. 금액 산정이 확정되면 그쪽을 먼저 고칠 것).
                네온(=secondary · 다크 시안 / 라이트 딥틸)은 테두리·아이콘·제목에만 쓰고 본문은 on-surface 로 둔다 —
                문장까지 형광으로 칠하면 대비가 떨어져 정작 경고가 안 읽힌다. */}
            <div className="flex items-start gap-2.5 rounded-2xl border border-secondary/55 bg-secondary/10 px-5 py-4 shadow-[0_0_22px_-8px_var(--color-secondary)]">
              <span className="material-symbols-outlined shrink-0 text-[20px] leading-[1.45] text-secondary">error</span>
              <p className="font-body-md text-body-md leading-[1.45] text-on-surface break-keep">{t('pay.cert_fee_note')}</p>
            </div>
            </div>
          </aside>
        </div>
      </main>

    </div>
  )
}
