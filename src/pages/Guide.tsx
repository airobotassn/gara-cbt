import { useEffect, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import SiteFooter from '../components/SiteFooter'
import { useT } from '../lib/i18n'
import { getTracks } from '../lib/caris'
import { useExamRounds, type RoundStatus } from '../lib/rounds'

const STATUS_KEY: Record<RoundStatus, string> = {
  open: 'guide.status_open',
  upcoming: 'guide.status_upcoming',
  closed: 'guide.status_closed',
}

// 급수 스펙트럼(딥블루 → 그린). ⚠️ src/styles/guide.css 의 색과 동기화 필수(바꾸면 양쪽).
const SPECTRUM: Record<string, [string, string]> = {
  beginner: ['#1e64d0', '#0a439f'],
  pro: ['#2f8ee0', '#1069c6'],
  elite: ['#34b4ea', '#1092d2'],
  master: ['#22c3bb', '#0a9f9a'],
  grandmaster: ['#2ecb7d', '#13a95b'],
  zenith: ['#7fd05f', '#54b830'],
}
const TIER_BASE: Record<string, string> = {
  beginner: '#0d54bd', pro: '#1a80d6', elite: '#14a2e0',
  master: '#10b3ac', grandmaster: '#18bd6a', zenith: '#62c045',
}
// 피라미드 조각 기하(viewBox 1000×900, 위 Zenith → 아래 Beginner). polygon·텍스트 위치 고정.
const PYRAMID: { key: string; polygon: string; lblY: number; nmY: number; nmSize: number }[] = [
  { key: 'zenith', polygon: '500,40 573.3,180 426.7,180', lblY: 126, nmY: 156, nmSize: 26 },
  { key: 'grandmaster', polygon: '426.7,180 573.3,180 646.7,320 353.3,320', lblY: 234, nmY: 266, nmSize: 31 },
  { key: 'master', polygon: '353.3,320 646.7,320 720,460 280,460', lblY: 370, nmY: 404, nmSize: 36 },
  { key: 'elite', polygon: '280,460 720,460 793.3,600 206.7,600', lblY: 510, nmY: 544, nmSize: 36 },
  { key: 'pro', polygon: '206.7,600 793.3,600 866.7,740 133.3,740', lblY: 650, nmY: 684, nmSize: 36 },
  { key: 'beginner', polygon: '133.3,740 866.7,740 940,880 60,880', lblY: 790, nmY: 824, nmSize: 36 },
]

// gara_9 (자격검정 안내) 목업 디자인 그대로 + 라우팅·로그인 연결.
// 원본: stitch_design_critique_assistant/gara_9/code.html (nav 활성 = 자격검정 안내)
// primary 는 전역 토큰 사용(라이트 #004ac6 / 다크 #7aa9ff). 히어로 밴드 위 흰 버튼만 text-[#004ac6] 하드코딩 유지.


export default function Guide() {
  const { t, lang } = useT()
  const navigate = useNavigate()
  const { regular, rolling } = useExamRounds(lang)
  const TRACKS = getTracks(lang)
  const tierByKey = Object.fromEntries(TRACKS.flatMap((tr) => tr.tiers).map((tt) => [tt.key, tt]))
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [pressKey, setPressKey] = useState<string | null>(null)

  // 피라미드 조각 클릭 → 해당 급수 카드로 스크롤 + 착지 플래시
  const goTier = (key: string) => {
    const el = document.getElementById(`tier-${key}`)
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    el.classList.remove('gld-flash')
    void el.offsetWidth // 재클릭 시 애니메이션 리스타트
    el.classList.add('gld-flash')
  }

  // 스크롤 스파이 — 현재 보는 카드에 맞춰 피라미드 조각 하이라이트
  useEffect(() => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>('.gld-card[data-tier]'))
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setActiveKey((e.target as HTMLElement).dataset.tier ?? null) }),
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    )
    cards.forEach((c) => io.observe(c))
    return () => io.disconnect()
  }, [lang])

  return (
    <div className="bg-background text-on-background min-h-screen">
      {/* 헤더 없음 — FAB이 네비 */}
      <main>
        {/* Hero */}
        <section className="relative min-h-[460px] flex items-center overflow-hidden guide-hero py-16 px-margin-mobile md:px-margin-desktop">
          <div className="max-w-container-max mx-auto w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-center relative z-10">
            {/* 로고 락업 — 오른쪽 일정 패널은 그대로 두고 이 칸만 가운데 정렬 */}
            <div className="guide-hero-lockup">
              <img className="guide-hero-logo" src="/logo.png" alt="CARIS" />
              <h1 className="guide-hero-title">CARIS</h1>
              <p className="guide-hero-sub">{t('guide.hero_lockup_sub')}</p>
              <span className="guide-hero-bar" aria-hidden="true" />
            </div>
            <div className="glass-panel rounded-2xl p-8 ambient-shadow border border-white/40">
              <h3 className="font-title-md text-title-md text-on-surface mb-6 flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">calendar_month</span>
                {t('guide.schedule_title')}
              </h3>
              <div className="space-y-4">
                {/* 히어로 일정 패널은 가장 가까운 3개만(useExamRounds가 이미 가까운 순 정렬·지난 시험 제외). 상시시험은 아래 섹션에서 노출. */}
                {regular.slice(0, 3).map((s) => (
                  <div
                    key={s.id}
                    onClick={s.clickable ? () => navigate(`/exam/apply?round=${s.id}`, { state: { roundId: s.id, roundLabel: s.title, dateLabel: s.dateText } }) : undefined}
                    className={`rounded-xl p-4 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2.5 sm:gap-3 border ${s.clickable ? 'bg-surface-container-lowest/60 border-white/50 hover:bg-surface-container-lowest/80 hover:border-primary/40 transition-colors cursor-pointer' : 'bg-surface-container-lowest/40 border-white/20 opacity-70'}`}
                  >
                    <div className="min-w-0">
                      <div className={`font-label-sm text-label-sm mb-1 ${s.clickable ? 'text-primary' : 'text-on-surface-variant'}`}>{s.title}</div>
                      <div className={`font-body-md text-body-md text-on-surface ${s.clickable ? 'font-semibold' : ''}`}>{s.dateText}</div>
                      {s.applyText && (
                        <div className="font-body-md text-body-md text-on-surface-variant mt-1 break-keep">
                          {t('sched.apply_period')}
                          <span className="block font-semibold text-on-surface">
                            {(() => {
                              const [a1, a2] = s.applyText.split('~')
                              return a2 !== undefined
                                ? <><span className="whitespace-nowrap">{a1.trim()}</span>{' ~ '}<span className="whitespace-nowrap">{a2.trim()}</span></>
                                : s.applyText
                            })()}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
                      <span className={`px-3 py-1 rounded-full font-label-sm text-label-sm ${s.clickable ? 'bg-primary/10 text-primary' : 'bg-surface-dim text-on-surface-variant'}`}>{t(STATUS_KEY[s.status])}</span>
                      {s.clickable && <span className="material-symbols-outlined text-primary text-[20px]">arrow_forward</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* 상시시험 — 언제든 접수 가능한 회차(원서접수로 이동). 일정 페이지(/exam/schedule) 폐지로 여기서 노출.
            이 섹션은 회차가 없어도 항상 렌더한다: 배경(.guide-band)이 히어로 하늘색 → 본문 흰색으로 넘어가는
            전환 구간을 겸하기 때문. 회차가 늘면 섹션이 그만큼 높아지고 그라데이션도 %기준이라 같이 늘어난다. */}
        <section className="py-12 guide-band px-margin-mobile md:px-margin-desktop">
          {rolling.length > 0 && (
            <div className="max-w-container-max mx-auto">
              <h2 className="font-title-md text-title-md font-bold text-on-surface border-l-4 border-primary pl-3 mb-5">{t('sched.rolling')}</h2>
              <div className="flex flex-col gap-4">
                {rolling.map((r) => (
                  <div
                    key={r.id}
                    onClick={() => navigate(`/exam/apply?round=${r.id}`, { state: { roundId: r.id, roundLabel: r.title, dateLabel: r.note } })}
                    className="rounded-2xl p-6 border bg-surface-container-lowest border-outline-variant/30 ambient-shadow hover:border-primary/50 hover:shadow-md transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-secondary/10 text-secondary flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined">event_repeat</span>
                      </div>
                      <div>
                        <div className="font-title-md text-title-md font-bold text-on-surface">{r.title}</div>
                        {r.note && <div className="font-body-md text-body-md text-on-surface-variant break-keep">{r.note}</div>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 self-end sm:self-auto">
                      <span className="px-3 py-1.5 rounded-full font-label-md text-label-md font-bold bg-secondary/10 text-secondary whitespace-nowrap">{t('sched.rolling_badge')}</span>
                      <span className="inline-flex items-center gap-1 font-label-md text-label-md text-primary font-bold whitespace-nowrap">
                        {t('sched.apply')}<span className="material-symbols-outlined text-[20px]">arrow_forward</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* CARIS 자격 소개 — Pro ↔ Master 전환 */}
        <section className="py-16 bg-surface-container-lowest px-margin-mobile md:px-margin-desktop">
          <div className="max-w-container-max mx-auto">
            <div className="text-center max-w-3xl mx-auto mb-10">
              <h2 className="font-headline-lg md:text-headline-lg text-headline-lg-mobile text-on-surface font-bold">{t('guide.cert_intro_title')}</h2>
              <p className="font-title-md text-body-md md:text-title-md text-on-surface-variant tracking-wide break-keep mt-3">
                Certification for AI &amp; Robotics Integrated Skills <span className="font-bold text-primary whitespace-nowrap">(CARIS)</span>
              </p>
            </div>

            {/* 급수 지도: 피라미드(네비) + 급수별 자격 플레이트 카드 */}
            <div className="gld">
              <div className="gld-hint">
                <span className="material-symbols-outlined">touch_app</span>
                <span>{t('guide.ladder_hint')}</span>
              </div>

              <div className="gld-pyramid-wrap">
                <svg className="gld-pyramid" viewBox="0 0 1000 900" role="group" aria-label={t('guide.cert_intro_title')}>
                  <defs>
                    {PYRAMID.map((p) => {
                      const [from, to] = SPECTRUM[p.key]
                      return (
                        <linearGradient key={p.key} id={`gld-g-${p.key}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0" stopColor={from} />
                          <stop offset="1" stopColor={to} />
                        </linearGradient>
                      )
                    })}
                  </defs>
                  {PYRAMID.map((p) => (
                    <g
                      key={p.key}
                      className={`gld-slice${activeKey === p.key ? ' is-active' : ''}${pressKey === p.key ? ' pressing' : ''}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`${tierByKey[p.key]?.name ?? p.key} ${t('caris.lbl.subjects')}`}
                      onClick={() => goTier(p.key)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTier(p.key) } }}
                      onPointerDown={() => setPressKey(p.key)}
                      onPointerUp={() => setPressKey(null)}
                      onPointerLeave={() => setPressKey(null)}
                      onPointerCancel={() => setPressKey(null)}
                    >
                      <polygon points={p.polygon} fill={`url(#gld-g-${p.key})`} stroke="var(--color-surface-container-lowest)" strokeWidth="7" strokeLinejoin="round" />
                      <text className="gld-lbl" x="500" y={p.lblY} textAnchor="middle" fontSize={p.key === 'zenith' ? 12 : 14}>CARIS</text>
                      <text className="gld-nm" x="500" y={p.nmY} textAnchor="middle" fontSize={p.nmSize}>{tierByKey[p.key]?.name}</text>
                    </g>
                  ))}
                </svg>
              </div>

              {TRACKS.map((tr) => (
                <div key={tr.key}>
                  <div className="gld-grp">
                    <span className="gld-rail" style={{ background: `linear-gradient(90deg, ${TIER_BASE[tr.tiers[0].key]}, ${TIER_BASE[tr.tiers[tr.tiers.length - 1].key]})` }} />
                    <h3 className="gld-grp-name">{tr.name}</h3>
                    <span className="gld-grp-cap">{tr.tagline}</span>
                  </div>
                  <div className="gld-cards">
                    {tr.tiers.map((tier) => {
                      const sub = tier.target ?? tier.prereq ?? ''
                      return (
                        <article
                          key={tier.key}
                          id={`tier-${tier.key}`}
                          data-tier={tier.key}
                          className="gld-card"
                          style={{ '--c': TIER_BASE[tier.key] } as CSSProperties}
                        >
                          <div className="gld-banner">
                            <span className="material-symbols-outlined gld-seal">workspace_premium</span>
                            <div className="gld-nm2">{tier.name}</div>
                            <span className="gld-track">{tr.name}{sub ? ` · ${sub}` : ''}</span>
                          </div>
                          <div className="gld-body">
                            <div className="gld-subj-label">{t('caris.lbl.subjects')}</div>
                            <ul className="gld-subj">
                              {tier.subjects.map((s, i) => (
                                <li key={i}><span className="gld-idx">{i + 1}</span>{s}</li>
                              ))}
                            </ul>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
