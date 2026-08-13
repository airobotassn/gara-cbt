import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { getTracks, TIER_COLORS } from '../lib/caris'

// 급수 스펙트럼(딥블루 → 그린). ⚠️ src/styles/guide.css 의 색과 동기화 필수(바꾸면 양쪽).
const SPECTRUM: Record<string, [string, string]> = {
  beginner: ['#1e64d0', '#0a439f'],
  pro: ['#2f8ee0', '#1069c6'],
  elite: ['#34b4ea', '#1092d2'],
  master: ['#22c3bb', '#0a9f9a'],
  grandmaster: ['#2ecb7d', '#13a95b'],
  zenith: ['#7fd05f', '#54b830'],
}
// 급수 대표색은 caris.ts(TIER_COLORS)가 단일 출처 — /ebooks 급수 열도 같은 색을 쓴다.
const TIER_BASE = TIER_COLORS
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

// 히어로 로봇 뒤 배경 플렉서스(별-네트워크) 좌표. 레퍼런스 시안 = 얇은 삼각망 + 교점의 작은 반짝이는 점.
// 시드 고정 PRNG 라 매 렌더 같은 그림이 나온다(리렌더마다 배경이 튀는 것·스냅샷 흔들림 방지).
// 좌표계는 0~100 정규값이고 화면 배치(왼쪽 비우기)는 guide.css 의 .guide-hero-fx mask 가 맡는다.
const PLEXUS = (() => {
  let s = 20260730
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
  // 개수는 .guide-hero-fx 넓이에 맞춘 값 — 영역을 넓히면 같이 올려야 밀도가 유지된다
  const nodes = Array.from({ length: 76 }, () => ({
    // pow(_, .88) = x 를 살짝 오른쪽으로. 로봇이 오른쪽 절반을 가리므로 너무 치우치면 보이는 망이 없어진다.
    x: 4 + 93 * Math.pow(rnd(), 0.88),
    y: 3 + 94 * rnd(),
    r: 0.22 + rnd() * 0.3,
    halo: 3.4 + rnd() * 2.6, // 코어 반지름의 몇 배로 번질지 — 레퍼런스 점은 전부 글로우를 두르고 있다
    dur: 3.6 + rnd() * 4.6,
    delay: -rnd() * 7,
    glint: false,
    bokeh: false,
  }))
  // 반짝이는 십자 광선은 큰 점 6개만 (전부 반짝이면 눈이 아프다)
  const bySize = nodes.slice().sort((a, b) => b.r - a.r)
  bySize.slice(0, 6).forEach((n) => { n.glint = true })
  // 레퍼런스에 있는 크게 번지는 보케 점 4개 — 코어는 흐리고 글로우만 넓다
  bySize.slice(6, 10).forEach((n) => { n.bokeh = true; n.halo = 8 + n.r * 4 })
  // 가까운 쌍부터 연결하되 노드당 3개까지 — 삼각망 느낌은 나면서 빽빽해지지 않는다.
  // MAX_D 를 키우면 긴 직선이 늘어 기하도형처럼 보인다(레퍼런스는 거의 안 보이는 잔망).
  const MAX_D = 13
  const pairs: { i: number; j: number; d: number }[] = []
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y)
      if (d < MAX_D) pairs.push({ i, j, d })
    }
  }
  pairs.sort((p, q) => p.d - q.d)
  const deg = nodes.map(() => 0)
  const edges: { i: number; j: number; o: number }[] = []
  for (const p of pairs) {
    if (deg[p.i] >= 3 || deg[p.j] >= 3) continue
    deg[p.i]++
    deg[p.j]++
    edges.push({ i: p.i, j: p.j, o: 0.38 + (1 - p.d / MAX_D) * 0.62 }) // 짧은 선이 더 진하다
  }
  // 레퍼런스에 있는 얇은 수평 광선 3줄(양끝이 페이드되는 가로선)
  const streaks = Array.from({ length: 5 }, () => {
    const len = 11 + rnd() * 11
    return { x: 14 + rnd() * 52, y: 18 + rnd() * 66, len, o: 0.3 + rnd() * 0.35 }
  })
  return { nodes, edges, streaks }
})()

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
              {/* 로봇 뒤 배경 플렉서스 — 청보라 필드 + 그 위 흰 삼각망·반짝이는 점(레퍼런스 시안).
                  로봇 이미지 자체는 안 건드린다. 좌표=위 PLEXUS, 필드·색·페이드=guide.css 의 .guide-hero-fx / .hfx-*. */}
              <div className="guide-hero-fx" aria-hidden="true">
                <svg className="hfx-net" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <defs>
                    {/* 점마다 두르는 글로우 — 레퍼런스 점은 딱딱한 원이 아니라 번지는 빛이다 */}
                    <radialGradient id="hfxGlow">
                      <stop offset="0" stopColor="#fff" stopOpacity=".6" />
                      <stop offset=".42" stopColor="#fff" stopOpacity=".2" />
                      <stop offset="1" stopColor="#fff" stopOpacity="0" />
                    </radialGradient>
                    <linearGradient id="hfxStreak" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0" stopColor="#fff" stopOpacity="0" />
                      <stop offset=".5" stopColor="#fff" stopOpacity=".7" />
                      <stop offset="1" stopColor="#fff" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {PLEXUS.edges.map((e, k) => (
                    <line
                      key={`e${k}`} className="hfx-line" style={{ opacity: e.o }}
                      x1={PLEXUS.nodes[e.i].x} y1={PLEXUS.nodes[e.i].y}
                      x2={PLEXUS.nodes[e.j].x} y2={PLEXUS.nodes[e.j].y}
                    />
                  ))}
                  {PLEXUS.streaks.map((s, k) => (
                    <line
                      key={`s${k}`} className="hfx-streak" style={{ opacity: s.o }}
                      x1={s.x} y1={s.y} x2={s.x + s.len} y2={s.y}
                    />
                  ))}
                  {PLEXUS.nodes.map((n, k) => (
                    <g
                      key={`n${k}`} className={n.glint ? 'hfx-glint' : 'hfx-node'}
                      transform={`translate(${n.x} ${n.y})`}
                      style={{ animationDuration: `${n.dur}s`, animationDelay: `${n.delay}s` }}
                    >
                      <circle className="hfx-halo" r={n.r * n.halo} fill="url(#hfxGlow)" />
                      {/* 십자 광선은 반투명 — 불투명하면 붙여넣은 반짝임 소재처럼 보인다 */}
                      {n.glint ? (<>
                        <path d="M0 -2.3 L.32 0 L0 2.3 L-.32 0 Z" opacity=".72" />
                        <path d="M-2.3 0 L0 -.32 L2.3 0 L0 .32 Z" opacity=".72" />
                      </>) : null}
                      {/* 보케 점은 코어를 흐리게 — 넓은 글로우만 남는다 */}
                      <circle r={n.r} opacity={n.bokeh ? 0.35 : 1} />
                    </g>
                  ))}
                </svg>
              </div>
              <img className="guide-hero-robot" src="/hero-robot.png" alt="" aria-hidden="true" />
              {/* 오브 = 로고 + 뒤에 깔린 후광. 빛은 전부 로고 '뒤'에만 있고 로고 자체는 원색 그대로.
                  (로고를 덮는 층을 두면 색이 날아가 스티커처럼 보인다.)
                  동심원 링 2개는 제거했다(2026-08-05) — CSS 의 .orb-ring 규칙도 같이 지웠다. */}
              <div className="guide-hero-orb" aria-hidden="true">
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

    </div>
  )
}
