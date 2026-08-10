import { useEffect, useState } from 'react'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import SiteFooter from '../components/SiteFooter'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'
import { getTracks } from '../lib/caris'
import { useExamFees, feeKey } from '../lib/fees'
import { usd } from '../lib/money'
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
//   로그인 게이트는 이 화면에 두지 않는다 — Checkout 이 미로그인 시 postLoginRedirect 를 심고 /login 으로 보낸다.
// 응시료 금액은 DB(exam_fees) 원화가 단일 소스이고 **표시만 달러**다(usd(), $1 = 1,500원 고정 환산).
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
        ? usd(feeAmount, lang)
        : t('apply.fee_tbd')

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
        <SiteFooter />
      </div>
    )
  }

  return (
    <div className="bg-background text-on-surface min-h-screen flex flex-col">
      {/* 결제 안내(목업) 모달은 삭제됐다 — 결제하기가 실제로 /checkout 으로 간다(2026-08). */}
      <main className="flex-grow pt-12 pb-24 px-margin-mobile md:px-margin-desktop w-full max-w-container-max mx-auto">
        {/* 상단 */}
        <button onClick={() => navigate('/guide')} className="inline-flex items-center gap-1.5 text-on-surface-variant hover:text-primary font-label-md text-label-md mb-6 transition-colors">
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* 좌: 자격 선택 */}
          <div className="lg:col-span-2">
            <section className="bg-surface-container-lowest rounded-2xl p-6 md:p-8 border border-outline-variant/30 ambient-shadow">
              <h2 className="font-title-md text-title-md font-bold text-on-surface border-l-4 border-primary pl-3 mb-6">{t('apply.select_cert')}</h2>

              {/* 티어 선택 — 트랙 구분 없이 6개 티어를 한 줄에(Beginner … Zenith).
                  회차가 안 연 급수는 **숨기지 않고** 자물쇠 + 비활성으로 둔다 — 어떤 급수가 있는지 자체가
                  알려야 할 정보라서다. 잠긴 뜻은 아래 한 줄로 설명한다(칩마다 배지를 달면 6개가 다 늘어난다). */}
              <span className="font-label-md text-label-md text-on-surface-variant font-semibold">{t('apply.tier')}</span>
              <div className="flex flex-nowrap gap-1.5 p-1.5 rounded-full bg-surface-container-high w-fit max-w-full mt-2 overflow-x-auto">
                {TIERS.map(({ tier: l }, i) => {
                  const closed = !isTierOpen(l.key)
                  const bought = active ? ownedRefs.has(`${active.id}:${l.key}`) : false
                  const base = 'px-5 py-2 rounded-full font-label-md text-label-md transition-all inline-flex items-center gap-1.5'
                  const cls = i === level
                    ? `${base} bg-primary text-on-primary font-bold`
                    : closed
                      ? `${base} text-outline font-semibold cursor-not-allowed`
                      : `${base} text-on-surface-variant hover:text-on-surface font-semibold`
                  return (
                    <button key={l.key} onClick={() => setPicked(i)} disabled={closed} title={closed ? t('apply.tier_not_open') : bought ? t('apply.owned') : undefined} className={cls}>
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
            </section>
          </div>

          {/* 우: 결제 요약 */}
          <aside className="lg:col-span-1">
            <div className="sticky top-12 bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/30 ambient-shadow flex flex-col gap-5">
              <h2 className="font-title-md text-title-md font-bold text-on-surface">{t('apply.pay_summary')}</h2>

              <div className="flex flex-col gap-3">
                <div className="flex justify-between items-start gap-3">
                  <span className="font-body-md text-body-md text-on-surface-variant">{t('apply.round')}</span>
                  <span className="font-body-md text-body-md text-on-surface font-semibold text-right break-keep">{roundLabel}</span>
                </div>
                <div className="flex justify-between items-start gap-3">
                  <span className="font-body-md text-body-md text-on-surface-variant">{t('sched.exam_date')}</span>
                  <span className="font-body-md text-body-md text-on-surface font-semibold text-right break-keep">{dateLabel}</span>
                </div>
                <div className="flex justify-between items-start gap-3">
                  <span className="font-body-md text-body-md text-on-surface-variant">{t('apply.fee')}</span>
                  <span className="font-body-md text-body-md text-on-surface font-semibold">
                    {feeText || t('common.loading')}
                  </span>
                </div>
              </div>

              <div className="border-t border-outline-variant/30 pt-4 flex justify-between items-baseline">
                <span className="font-title-md text-title-md text-on-surface font-bold">{t('apply.total')}</span>
                <span className="font-headline-lg-mobile text-headline-lg-mobile text-primary font-black">
                  {feeText || '—'}
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
                  onClick={() => navigate(`/checkout?type=exam&ref=${productRef}`)}
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
                  비로그인이라고 여기서 막지는 않는다 — Checkout 이 postLoginRedirect 를 심고 /login 으로 보낸 뒤
                  로그인하면 결제화면으로 정확히 되돌아온다. 여기서 한 번 더 게이트를 만들면 그 경로가 끊긴다. */}
              <p className="flex items-start gap-1.5 font-label-md text-label-md text-on-surface-variant break-keep">
                <span className="material-symbols-outlined text-[18px] mt-px shrink-0">{isFullUser ? 'lock' : 'login'}</span>
                {isFullUser ? t('apply.pay_note_live') : t('apply.login_required')}
              </p>
            </div>
          </aside>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
