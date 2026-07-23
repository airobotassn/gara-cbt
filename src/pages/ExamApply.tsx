import { useState } from 'react'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import SiteFooter from '../components/SiteFooter'
import { useT } from '../lib/i18n'
import { getTracks } from '../lib/caris'
import { useExamRounds } from '../lib/rounds'

// 원서접수(앞단 목업) — 회차 선택 후 자격을 고르고 결제까지의 화면 흐름만.
//   개편(2026-07): CARIS-Ⅰ(Beginner/Pro/Elite)·CARIS-Ⅱ(Master/Grand Master/Zenith) 모두
//   티어별 독립 시험 → 트랙·티어를 고르면 티어별 응시료로 결제. (구 'Pro 단일시험' 분기 폐지)
// ⚠️ PG 결제·본인인증·주문 저장 미연결(결제하기는 안내 모달만). 실제 연동은 별도 작업.
export default function ExamApply() {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const { t, lang } = useT()

  // 회차는 DB(exam_rounds)가 단일 소스. URL ?round=<id> 가 새로고침에도 살아남는 durable 소스,
  // navigation state 는 클릭 진입 시 즉시 표시용(로딩 깜빡임 방지). 둘 다 없으면 접수중(open) 회차로 폴백.
  const st = location.state as { roundId?: string; roundLabel?: string; dateLabel?: string } | null
  const roundId = params.get('round') ?? st?.roundId ?? ''
  const { regular, rolling, loading } = useExamRounds(lang)
  const allRounds = [...regular, ...rolling]
  const byId = roundId ? allRounds.find((r) => r.id === roundId) : undefined
  const openRound = allRounds.find((r) => r.status === 'open') ?? regular[0] ?? rolling[0]
  const active = byId ?? openRound
  // 정기=시험일(dateText), 상시=설명(note). DB 로딩 전엔 state 값으로 즉시 표시.
  const roundLabel = active?.title ?? st?.roundLabel ?? ''
  const dateLabel = (active ? active.dateText || active.note : '') || st?.dateLabel || ''

  const [level, setLevel] = useState(0)
  const [payNotice, setPayNotice] = useState(false)
  // 트랙 선택 폐지 — 두 트랙의 티어를 한 줄로 이어 붙여(Beginner·Pro·Elite + Master·Grand Master·Zenith)
  // 단일 선택으로 만든다. 트랙 정보는 티어에 붙여 두고 라벨·응시자격 문구에만 쓴다.
  const TRACKS = getTracks(lang)
  const TIERS = TRACKS.flatMap((tr) => tr.tiers.map((tier) => ({ tier, track: tr })))
  const sel = TIERS[level] ?? TIERS[0]
  const cur = sel.track
  const lv = sel.tier
  const isMaster = cur.key === 't2'
  // 시험 구성(문항) / 시험 시간 분리 — format 은 "구성 · 시간" 패턴(마지막 조각이 시간, ' · ' 구분은 전 언어 공통)
  const fmtParts = lv.format ? lv.format.split(' · ') : []
  const fmtDuration = fmtParts.length > 1 ? fmtParts[fmtParts.length - 1] : ''
  const fmtComposition = fmtParts.length > 1 ? fmtParts.slice(0, -1).join(' · ') : lv.format ?? ''
  const won = (n: number) => n.toLocaleString('ko-KR')

  // 응시료: caris.ts 티어 상수(단일 소스) 직접 사용 — 편집 불가·DB 미사용이라 어긋날 여지 없음.
  const fee = lv.fee ?? 0

  // 접수기간 가드: 특정 회차(?round=<id>)로 들어왔는데 그 회차가 '접수중(open)'이 아니면
  // (마감·예정·없음·지난 시험) 접수화면을 막고 일정으로 유도. 회차 미지정은 open 회차로 폴백하되
  // 폴백할 open 회차조차 없으면 막는다. DB 로딩 중엔 판정 보류.
  const blocked = !loading && ((roundId ? !byId || byId.status !== 'open' : false) || !active)
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
      {/* 결제 안내(목업) 모달 */}
      {payNotice && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" onClick={() => setPayNotice(false)}>
          <div className="bg-surface-container-lowest rounded-2xl p-8 max-w-md w-full text-center ambient-shadow" onClick={(e) => e.stopPropagation()}>
            <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-4">
              <span className="material-symbols-outlined text-[32px]">credit_card</span>
            </div>
            <h3 className="font-title-md text-title-md font-bold text-on-surface mb-2">{t('apply.modal_title')}</h3>
            <p className="font-body-md text-body-md text-on-surface-variant mb-6 break-keep">
              {t('apply.modal_body')}
            </p>
            <button className="bg-primary text-on-primary font-label-md text-label-md font-bold px-6 py-3 rounded-xl ambient-shadow" onClick={() => setPayNotice(false)}>
              {t('apply.confirm')}
            </button>
          </div>
        </div>
      )}

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

              {/* 티어 선택 — 트랙 구분 없이 6개 티어를 한 줄에(Beginner … Zenith) */}
              <span className="font-label-md text-label-md text-on-surface-variant font-semibold">{t('apply.tier')}</span>
              <div className="flex flex-nowrap gap-1.5 p-1.5 rounded-full bg-surface-container-high w-fit max-w-full mt-2 overflow-x-auto">
                {TIERS.map(({ tier: l }, i) => (
                  <button key={l.key} onClick={() => setLevel(i)} className={i === level ? 'px-5 py-2 rounded-full bg-primary text-on-primary font-label-md text-label-md font-bold transition-all' : 'px-5 py-2 rounded-full text-on-surface-variant hover:text-on-surface font-label-md text-label-md font-semibold transition-all'}>
                    <span className="flex flex-col items-center leading-[1.05]">{l.name.split(' ').map((w, k) => <span key={k}>{w}</span>)}</span>
                  </button>
                ))}
              </div>

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
                  <span className="font-body-md text-body-md text-on-surface font-semibold">$ {won(fee)}</span>
                </div>
              </div>

              <div className="border-t border-outline-variant/30 pt-4 flex justify-between items-baseline">
                <span className="font-title-md text-title-md text-on-surface font-bold">{t('apply.total')}</span>
                <span className="font-headline-lg-mobile text-headline-lg-mobile text-primary font-black">$ {won(fee)}</span>
              </div>

              <button onClick={() => setPayNotice(true)} className="w-full bg-primary text-on-primary font-title-md text-title-md font-bold px-6 py-4 rounded-xl hover:translate-y-[-2px] transition-transform duration-200 ambient-shadow flex items-center justify-center gap-2">
                {t('apply.pay_btn')}
                <span className="material-symbols-outlined">arrow_forward</span>
              </button>
              <p className="flex items-start gap-1.5 font-label-sm text-label-sm text-outline break-keep">
                <span className="material-symbols-outlined text-[16px] mt-px shrink-0">lock</span>
                {t('apply.pay_note')}
              </p>
            </div>
          </aside>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
