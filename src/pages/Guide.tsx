import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import SiteFooter from '../components/SiteFooter'
import { useT } from '../lib/i18n'
import { getTracks } from '../lib/caris'

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
const PYRAMID: { key: string; polygon: string; nmY: number; nmSize: number }[] = [
  { key: 'zenith', polygon: '500,40 573.3,180 426.7,180', nmY: 156, nmSize: 26 },
  { key: 'grandmaster', polygon: '426.7,180 573.3,180 646.7,320 353.3,320', nmY: 266, nmSize: 31 },
  { key: 'master', polygon: '353.3,320 646.7,320 720,460 280,460', nmY: 404, nmSize: 36 },
  { key: 'elite', polygon: '280,460 720,460 793.3,600 206.7,600', nmY: 544, nmSize: 36 },
  { key: 'pro', polygon: '206.7,600 793.3,600 866.7,740 133.3,740', nmY: 684, nmSize: 36 },
  { key: 'beginner', polygon: '133.3,740 866.7,740 940,880 60,880', nmY: 824, nmSize: 36 },
]

// 피라미드 우측 그룹 브레이스( ] )+라벨. 위 3티어(y40~460)=피지컬 AI, 아래 3티어(y460~880)=AI·로봇 리터러시.
//   viewBox 를 좌우 대칭으로 넓혀(피라미드는 60~940 그대로) 오른쪽 여백에 배치 → 피라미드는 정중앙 유지.
const PYRAMID_GROUPS: { key: string; tkey: string; y1: number; y2: number; color: string }[] = [
  { key: 'phys', tkey: 'guide.group_physical', y1: 52, y2: 452, color: '#12a58c' },  // Zenith~Master
  { key: 'lit', tkey: 'guide.group_literacy', y1: 468, y2: 868, color: '#1156bd' },  // Elite~Beginner
]

// '무엇인가요' 특징 카드 8장 — 앞 4개는 제도 특징, 뒤 4개는 기르는 역량. i18n 키는 guide.f1~f8.
const FEATURES: { k: string; icon: ReactNode }[] = [
  { k: 'f1', icon: <><rect x="6.5" y="6.5" width="11" height="11" rx="2" /><path d="M9.5 3v3.5M14.5 3v3.5M9.5 17.5V21M14.5 17.5V21M3 9.5h3.5M3 14.5h3.5M17.5 9.5H21M17.5 14.5H21" /><path d="M10.1 14.4l1.9-4.8 1.9 4.8M10.7 13h2.6" strokeWidth="1.3" /></> },
  { k: 'f2', icon: <><path d="M3 20h18" /><rect x="4.5" y="12" width="3.4" height="6" /><rect x="10.3" y="9" width="3.4" height="9" /><rect x="16.1" y="13.5" width="3.4" height="4.5" /><path d="M5 8.6l4.6-3.5 3.4 2.2L20 2.6" /><path d="M16.4 2.6H20V6" /></> },
  { k: 'f3', icon: <><circle cx="9" cy="8" r="3.3" /><path d="M2.8 19.5c0-3.2 2.8-5.4 6.2-5.4s6.2 2.2 6.2 5.4" /><path d="M16.2 5.2a3.3 3.3 0 010 6.2M17.4 14.6c2.3.6 3.8 2.4 3.8 4.9" /></> },
  { k: 'f4', icon: <><circle cx="12" cy="12" r="9.2" /><path d="M2.8 12h18.4" /><ellipse cx="12" cy="12" rx="4" ry="9.2" /></> },
  { k: 'f5', icon: <><path d="M4 4.6h6.2c1 0 1.8.8 1.8 1.8v13c0-1-.8-1.8-1.8-1.8H4z" /><path d="M20 4.6h-6.2c-1 0-1.8.8-1.8 1.8v13c0-1 .8-1.8 1.8-1.8H20z" /><path d="M6.3 12.6l1.6-4 1.6 4M6.8 11.4h2.2M15.4 8.6v4" strokeWidth="1.3" /></> },
  { k: 'f6', icon: <><circle cx="12" cy="12" r="3.1" /><path d="M12 2.6l1.5 2.2a7.4 7.4 0 011.9.8l2.6-.5 1.7 2.9-1.7 2a7.4 7.4 0 010 2l1.7 2-1.7 2.9-2.6-.5a7.4 7.4 0 01-1.9.8L12 21.4l-1.5-2.2a7.4 7.4 0 01-1.9-.8l-2.6.5-1.7-2.9 1.7-2a7.4 7.4 0 010-2l-1.7-2 1.7-2.9 2.6.5a7.4 7.4 0 011.9-.8z" /></> },
  { k: 'f7', icon: <><rect x="4.2" y="7.8" width="15.6" height="11.4" rx="3" /><path d="M12 3.2v4.6M8.6 2.9L12 3.2l3.4-.3" strokeWidth="1.4" /><circle cx="9" cy="12.6" r="1.25" fill="currentColor" stroke="none" /><circle cx="15" cy="12.6" r="1.25" fill="currentColor" stroke="none" /><path d="M9.4 16.2h5.2M1.9 11.4v4M22.1 11.4v4" /></> },
  { k: 'f8', icon: <><circle cx="12" cy="12" r="8.4" /><circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none" /><path d="M12 1.4v3.2M12 19.4v3.2M1.4 12h3.2M19.4 12h3.2" /></> },
]

// 라인 아이콘 공용 래퍼(레퍼런스가 얇은 아웃라인 스타일이라 Material Symbols 대신 인라인 SVG).
function LineIcon({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

export default function Guide() {
  const { t, lang } = useT()
  const navigate = useNavigate()
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

  const [leadA, leadB] = t('guide.hero_lead').split('|')

  return (
    <div className="guide-page text-on-background min-h-screen">
      {/* 헤더 없음 — FAB이 네비 */}
      <main>
        {/* Hero — 좌: 로고 락업 + 카피 + CARIS PLAN / 우: 로봇 */}
        <section className="guide-hero px-margin-mobile md:px-margin-desktop">
          <div className="max-w-container-max mx-auto guide-hero-grid">
            <div className="guide-hero-copy">
              <div className="guide-lockup">
                <img src="/logo.png" alt="" aria-hidden="true" />
                <b>CARIS</b>
              </div>
              <h1 className="guide-h1">
                AI·Robot<br />
                {t('guide.hero_h1_l2')} <em>CARIS</em>
              </h1>
              <p className="guide-lead">{leadA}<br />{leadB}</p>
              <button type="button" className="guide-plan-btn" onClick={() => navigate('/plan')}>
                {t('guide.plan_cta')}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </button>
            </div>
            {/* 로봇은 배경 투명 PNG. 손 위 CARIS 행성은 이미지에 굽지 않고 별도 레이어로 얹는다
                (로고가 선명하게 유지되고 교체·부유 애니메이션이 쉬움). 위치는 guide.css 의 .guide-hero-orb. */}
            <div className="guide-hero-art">
              <img className="guide-hero-robot" src="/hero-robot.png" alt="" aria-hidden="true" />
              {/* 오브 = 얇은 동심원 링 2개 + 로고. 빛은 전부 로고 '뒤'에만 있고 로고 자체는 원색 그대로.
                  (레퍼런스 시안과 동일한 구성 — 로고를 덮는 층을 두면 색이 날아가 스티커처럼 보인다.) */}
              <div className="guide-hero-orb" aria-hidden="true">
                <span className="orb-ring orb-ring-1" />
                <span className="orb-ring orb-ring-2" />
                <img className="orb-main" src="/logo.png" alt="" />
              </div>
            </div>
          </div>
        </section>

        {/* CARIS 는 무엇인가요? — 정의 + 특징 카드 8장 */}
        <section className="guide-sec px-margin-mobile md:px-margin-desktop">
          <div className="max-w-container-max mx-auto">
            <div className="guide-sec-head">
              <h2><span className="gh-hl">CARIS</span>{t('guide.what_title')}</h2>
              <p>
                Certification for AI &amp; Robotics Integrated Skills<br />
                <b>{t('guide.what_def')}</b>
              </p>
            </div>
            <div className="guide-fcards">
              {FEATURES.map((f) => (
                <article key={f.k} className="guide-fcard">
                  <LineIcon>{f.icon}</LineIcon>
                  <h3>{t(`guide.${f.k}.t`)}</h3>
                  <p>{t(`guide.${f.k}.d`)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* CARIS 자격 체계 — 피라미드(네비) + 급수별 자격 플레이트 카드 */}
        <section className="guide-sec guide-sec-last px-margin-mobile md:px-margin-desktop">
          <div className="max-w-container-max mx-auto">
            <div className="guide-sec-head">
              <h2><span className="gh-hl">CARIS</span> {t('guide.ladder_title')}</h2>
              <p>{t('guide.ladder_sub')}</p>
            </div>

            <div className="gld">
              <div className="gld-hint">
                <span className="material-symbols-outlined">touch_app</span>
                <span>{t('guide.ladder_hint')}</span>
              </div>

              <div className="gld-pyramid-wrap">
                <svg className="gld-pyramid" viewBox="-240 0 1480 900" role="group" aria-label={t('guide.ladder_title')}>
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
                      <polygon points={p.polygon} fill={`url(#gld-g-${p.key})`} stroke="var(--gld-gap)" strokeWidth="7" strokeLinejoin="round" />
                      <text className="gld-nm" x="500" y={p.nmY} textAnchor="middle" fontSize={p.nmSize}>{tierByKey[p.key]?.name}</text>
                    </g>
                  ))}

                  {/* 우측 그룹 브레이스 + 라벨(장식이라 pointer-events 없음) */}
                  {PYRAMID_GROUPS.map((g) => {
                    const lines = t(g.tkey).split('|')
                    const mid = (g.y1 + g.y2) / 2
                    const top = mid - (lines.length - 1) * 27 // 54px 줄 기준 세로 중앙
                    return (
                      <g key={g.key} className="gld-brace" aria-hidden="true">
                        <path d={`M 985 ${g.y1} H 1008 V ${g.y2} H 985`} fill="none" stroke={g.color} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
                        <text className="gld-brace-lbl" x="1044" y={top} fill={g.color}>
                          {lines.map((w, i) => (
                            <tspan key={i} x="1044" dy={i === 0 ? 0 : 54}>{w}</tspan>
                          ))}
                        </text>
                      </g>
                    )
                  })}
                </svg>
              </div>

              {TRACKS.map((tr) => (
                <div key={tr.key} className="gld-track-block">
                  <div className="gld-cards">
                    {tr.tiers.map((tier) => {
                      // 배너 문구: CARIS-Ⅰ(t1)은 기존 대상(target), CARIS-Ⅱ(t2)는 '피지컬 AI 초/중/고급 전문가'.
                      const trackText = tr.key === 't2' ? t(`guide.ptrack.${tier.key}`) : (tier.target ?? '')
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
                            <span className="gld-track">{trackText}</span>
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
