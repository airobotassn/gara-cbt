// WORLD ARENA(/arena) — 국가·지역별 평균 레벨 지도 + 지역 랭킹.
//
// 2026-07 이전엔 자립형 정적 HTML(public/world-arena.html)을 iframe 으로 감싸 쓰던 화면인데,
// 앱 라우트에 맞게 React 로 옮겼다. 그 결과 사라진 것들:
//   · postMessage 브리지(부모가 fetch → 아이프레임에 주입) → 여기서 직접 callFunction
//   · 6개국어 사전 중복 → src/lib/i18n.tsx 의 arena.* 로 일원화
//   · target="_top" 링크 → react-router <Link> (SPA 전환)
//   · 인라인 d3/지도데이터 660KB → npm d3 + public/geo/*.json (시군구는 지연 로드)
//
// 상태는 이 컴포넌트가 소유하고, 그리기만 ArenaMap 에 맡긴다(제어 컴포넌트).
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ChatBoard from '../components/ChatBoard'
import { Link } from 'react-router-dom'
import { callFunction, supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'
import { ArenaMap, DokdoInset, type ArenaMapHandle, type HoverInfo } from '../components/ArenaMap'
import {
  buildRegions,
  makeCscale,
  EMPTY_REAL,
  koreaName,
  loadCountries,
  loadMunicipalities,
  loadProvinces,
  type ArenaLevel,
  type GeoFeature,
  type RealData,
  type Region,
} from '../lib/arena/data'
import { M49_TO_ISO2 } from '../lib/arena/tables'
import '../styles/arena.css'
// ⚠️ 소스 일원화: 아래 leaderboard 호출은 src/pages/Ranking.tsx 의 AggregateBoard(집계 탭)와
//    완전히 동일한 RPC(region_/country_leaderboard, scope='region'|'country')를 쓴다 — 이중 fetch/별도 엔드포인트 없음.
//
// 쓰는 필드는 `score` = **베이지안 보정된 season_total 평균**(K=25 shrinkage, 일간창은 참여율 가중).
// 개인 랭킹과 같은 재료(skill_score+activity_score)를 국가/지역 단위로 올린 값이라 이게 이 지도의 지표다.
// ⚠️ 같은 응답의 `avg_level` 은 쓰지 않는다 — 이름과 달리 레벨이 아니라 보정 전 원시 평균이고
//    (레벨테스트 시절 필드명이 하위호환으로 남은 것), 그걸 쓰면 5명짜리 버킷이 그대로 1위를 먹는다.
type ServerBucket = { code: string; score: number; member_count: number }

/** 랭킹 목록 한 줄 — hover 마다 60줄을 통째로 다시 그리지 않도록 memo */
const RankRow = memo(function RankRow({
  region,
  rank,
  width,
  selected,
  hot,
  showFlag,
  count,
  color,
  scoreText,
  onActivate,
  onEnter,
  onLeave,
}: {
  region: Region
  rank: number
  width: number
  selected: boolean
  hot: boolean
  showFlag: boolean
  count: string
  color: string
  scoreText: string
  onActivate(r: Region): void
  onEnter(key: string): void
  onLeave(): void
}) {
  return (
    <li
      className={[region.drill ? 'drill' : '', selected ? 'sel' : '', hot ? 'hot' : ''].filter(Boolean).join(' ')}
      onClick={() => onActivate(region)}
      onMouseEnter={() => onEnter(region.key)}
      onMouseLeave={onLeave}
    >
      <span className="no">{rank}</span>
      <div className="nm">
        <b>
          {region.name}
          {showFlag ? ' 🇰🇷' : ''}
        </b>
        <div className="bw" style={{ width: `${width}%`, background: color }} />
        <div className="cnt">👥 {count}</div>
      </div>
      <span className="sc">{scoreText}</span>
    </li>
  )
})

export default function WorldArena() {
  const { t, lang } = useT()
  const { user } = useAuth()
  const userId = user?.id ?? null
  const mapRef = useRef<ArenaMapHandle>(null)

  // ── 지도 경계 데이터 ──
  const [countries, setCountries] = useState<GeoFeature[]>([])
  const [provinces, setProvinces] = useState<GeoFeature[]>([])
  const [municipalities, setMunicipalities] = useState<GeoFeature[]>([])

  // ── 화면 상태 ──
  const [level, setLevel] = useState<ArenaLevel>(0)
  const [prov, setProv] = useState<{ code: string; name: string } | null>(null)
  const [selKey, setSelKey] = useState<string | null>(null)
  const [hotKey, setHotKey] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [prompt, setPrompt] = useState('')
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const [rightPanel, setRightPanel] = useState<'league' | 'chat' | null>('league')

  // ── 백엔드 실데이터 ──
  const [real, setReal] = useState<RealData>(EMPTY_REAL)
  const [home, setHome] = useState('KR')
  const [homeReady, setHomeReady] = useState(false) // 확정되면 지구본 자동회전 정지

  const fmt = useCallback((n: number) => Number(n).toLocaleString(lang === 'ko' ? 'ko-KR' : lang), [lang])
  const ppl = useCallback((n: number) => fmt(n) + t('arena.ppl'), [fmt, t])
  // 점수는 season_total 스케일(0~10000)이라 소수점이 의미 없다 — 정수 + 천단위 구분.
  const fmtScore = useCallback((n: number) => fmt(Math.round(n)), [fmt])

  // 지구본·시도는 즉시, 시군구(177KB)는 시도까지 들어온 사람만 — 레벨1 도달 시 미리 받아둔다.
  useEffect(() => {
    let alive = true
    loadCountries().then((f) => alive && setCountries(f)).catch(() => {})
    loadProvinces().then((f) => alive && setProvinces(f)).catch(() => {})
    return () => { alive = false }
  }, [])
  useEffect(() => {
    if (level < 1) return
    let alive = true
    loadMunicipalities().then((f) => alive && setMunicipalities(f)).catch(() => {})
    return () => { alive = false }
  }, [level])

  // 리더보드 집계 + 로그인 계정 국가. 실패해도 목값으로 화면은 살아 있어야 한다.
  useEffect(() => {
    let cancelled = false
    const fetchHome = async (): Promise<string> => {
      if (!userId) return 'KR'
      try {
        const { data } = await supabase.from('profiles').select('country_code').eq('id', userId).maybeSingle()
        return (data?.country_code || 'KR').toUpperCase()
      } catch {
        return 'KR'
      }
    }
    const load = async () => {
      const homeCode = await fetchHome().catch(() => 'KR')
      if (cancelled) return
      setHome(homeCode)
      setHomeReady(true)
      try {
        const [country, region] = await Promise.all([
          callFunction<{ buckets: ServerBucket[] }>('leaderboard', { scope: 'country', window: 'season' }),
          callFunction<{ buckets: ServerBucket[] }>('leaderboard', { scope: 'region', country: 'KR', window: 'season' }),
        ])
        if (cancelled) return
        const toMap = (bs: ServerBucket[] | undefined) => {
          const out: RealData['country'] = {}
          for (const b of bs ?? []) if (b?.code) out[b.code] = { score: Number(b.score), members: Number(b.member_count) }
          return out
        }
        setReal({ country: toMap(country.buckets), region: toMap(region.buckets) })
      } catch {
        /* 목값 유지 */
      }
    }
    void load()
    return () => { cancelled = true }
  }, [userId])

  const regions = useMemo(
    () =>
      buildRegions({
        level,
        lang,
        real,
        countries,
        provinces,
        municipalities,
        provCode: prov?.code ?? null,
      }),
    [level, lang, real, countries, provinces, municipalities, prov],
  )

  // 점수 내림차순 — 순위·통계·목록이 모두 이걸 쓴다.
  const sorted = useMemo(() => regions.slice().sort((a, b) => b.score - a.score), [regions])

  // ── 사이드 패널 파생값 ──
  const scopeTitle = useMemo(() => {
    if (level === 0) return t('arena.worldLeague')
    if (level === 1) return koreaName(countries, lang) + t('arena.league')
    return (prov?.name ?? '') + t('arena.league')
  }, [level, countries, lang, prov, t])

  const totalTakers = useMemo(() => regions.reduce((s, r) => s + r.takers, 0), [regions])

  // 우리 순위 — 지구본은 홈 국가, 국내는 서울(레벨1)·강남구(레벨2)
  const our = useMemo(() => {
    let r: Region | undefined
    let label = ''
    if (level === 0) {
      r = regions.find((x) => M49_TO_ISO2[String(x.f.id)] === home) ?? regions.find((x) => x.drill)
      if (r) label = '📍 ' + r.name + ' ' + t('arena.our0')
    } else if (level === 1 && home === 'KR') {
      r = regions.find((x) => x.code === '11')
      if (r) label = '📍 ' + r.name + ' ' + t('arena.our1')
    } else if (level === 2 && home === 'KR') {
      r = regions.find((x) => x.code === '11230')
      if (r) label = '🏠 ' + r.name + ' ' + t('arena.our2')
    }
    if (!r) return null
    return { region: r, label, rank: sorted.indexOf(r) + 1 }
  }, [level, regions, sorted, home, t])

  // 상위 60개(검색 시 필터). 세계 단위에선 드릴 대상(대한민국)이 밖으로 밀려도 맨 아래 고정 노출.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? sorted.filter((d) => d.name.toLowerCase().includes(q)).slice(0, 60) : sorted.slice(0, 60)
    if (!q && level === 0) {
      const kr = regions.find((d) => d.drill)
      if (kr && !list.includes(kr)) return [...list, kr]
    }
    return list
  }, [query, sorted, level, regions])

  const scoreSpan = useMemo(() => {
    if (!sorted.length) return { max: 1, min: 0 }
    return { max: sorted[0].score, min: sorted[sorted.length - 1].score }
  }, [sorted])

  // 색은 점수 선형이 아니라 **등수 순서(백분위)** 로 깐다 → 하위권에 몰린 점수가 강제로 펼쳐져
  // 1등부터 꼴찌까지 색이 골고루 진해진다. 이 화면에 뜬 전 지역의 점수를 통째로 넘긴다.
  const color = useMemo(() => makeCscale(sorted.map((r) => r.score)), [sorted])

  // ── 지도 → 화면 상태 반영 ──
  const handleDrill = useCallback((r: Region) => {
    setSelKey(null)
    setQuery('')
    setPrompt('')
    setLevel((cur) => {
      if (cur === 0) return 1
      return 2
    })
    if (r.code) setProv({ code: r.code, name: r.name })
  }, [])

  const goto = useCallback((l: ArenaLevel) => {
    setSelKey(null)
    setQuery('')
    setPrompt('')
    setLevel(l)
    if (l < 2) setProv(null)
  }, [])

  // pointermove 마다 setState 하면 과한 렌더가 되므로 프레임당 1회로 묶는다.
  const hoverRaf = useRef(0)
  const pendingHover = useRef<HoverInfo | null>(null)
  const handleHover = useCallback((info: HoverInfo | null) => {
    pendingHover.current = info
    if (hoverRaf.current) return
    hoverRaf.current = requestAnimationFrame(() => {
      hoverRaf.current = 0
      setHover(pendingHover.current)
      setHotKey(pendingHover.current?.region.key ?? null)
    })
  }, [])
  useEffect(() => () => { if (hoverRaf.current) cancelAnimationFrame(hoverRaf.current) }, [])

  // 레벨이 바뀌면 랭킹 목록을 맨 위로. (원본은 innerHTML 을 비워 자연히 초기화됐지만,
  //  React 는 같은 <ul> 을 재사용해서 이전 레벨의 스크롤 위치가 그대로 남는다.)
  const rankListRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (rankListRef.current) rankListRef.current.scrollTop = 0
  }, [level, prov])

  const activate = useCallback((r: Region) => mapRef.current?.activate(r), [])
  const onRowEnter = useCallback((key: string) => setHotKey(key), [])
  const onRowLeave = useCallback(() => setHotKey(null), [])

  // 툴팁의 순위 — sorted 에서의 위치
  const hoverRank = useMemo(() => {
    if (!hover) return 0
    return sorted.findIndex((x) => x.key === hover.region.key) + 1
  }, [hover, sorted])

  // 독도 확대도: 전국(레벨1)·경북(레벨2, code 37)에서만. 색은 소속 지역과 동일.
  const dokdo = useMemo(() => {
    const show = level === 1 || (level === 2 && prov?.code === '37')
    if (!show) return null
    const parent = level === 2 ? regions.find((d) => d.code === '37430') : regions.find((d) => d.code === '37')
    return { fill: parent ? color(parent.score) : '#5b93e2' }
  }, [level, prov, regions, color])

  const crumbs = useMemo(() => {
    if (level === 0) return []
    const parts: { text: string; level: ArenaLevel }[] = [{ text: t('arena.world'), level: 0 }]
    if (level >= 1) parts.push({ text: koreaName(countries, lang), level: 1 })
    if (level >= 2 && prov) parts.push({ text: prov.name, level: 2 })
    return parts
  }, [level, countries, lang, prov, t])

  const ready = countries.length > 0

  return (
    <div className="arena">
      <div className="aa-wrap">
        <header className="aa-head">
          <h1>{t('arena.title')}</h1>
        </header>

        {/* 런처 — 아레나가 허브·미니게임·레벨테스트·데일리의 관문이라 지도보다 위에 둔다. */}
        <nav className="aa-launch">
          <Link className="aa-lbtn cari" to="/hub">
            {/* 학사모 이모지 대신 CARI 전신(원본 'CARI 대각선.png' — 불투명 배경을 따내고 트리밍) */}
            <span className="ic ic-img"><img src="/cari-diagonal.png" alt="" /></span>
            <span className="lt">
              <b>CARI</b>
              <i>{t('arena.bHubS')}</i>
            </span>
            <span className="go">›</span>
          </Link>
          <Link className="aa-lbtn game" to="/games">
            <span className="ic">🕹️</span>
            <span className="lt">
              <b>{t('arena.bGame')}</b>
              <i>{t('arena.bGameS')}</i>
            </span>
            <span className="go">›</span>
          </Link>
          <Link className="aa-lbtn lvl" to="/test/select">
            <span className="ic">🎯</span>
            <span className="lt">
              <b>{t('arena.bLevel')}</b>
              <i>{t('arena.bLevelS')}</i>
            </span>
            <span className="go">›</span>
          </Link>
          {/* 콘텐츠 파이프라인은 아직이지만 화면(/daily)은 있다 — 슬롯이 자리표시자인 상태. */}
          <Link className="aa-lbtn daily" to="/daily">
            <span className="ic">☀️</span>
            <span className="lt">
              <b>{t('arena.bDaily')}</b>
              <i>{t('arena.bDailyS')}</i>
            </span>
            <span className="go">›</span>
          </Link>
        </nav>

        <div className={`aa-grid${rightPanel ? '' : ' aa-solo'}`}>
          <section className="aa-card aa-stage">
            {crumbs.length > 0 && (
              <nav className="aa-crumb">
                {crumbs.map((c, i) => (
                  <span key={c.level} style={{ display: 'contents' }}>
                    {i > 0 && <span className="sep">›</span>}
                    {i === crumbs.length - 1 ? (
                      <span className="cur">{c.text}</span>
                    ) : (
                      <button onClick={() => goto(c.level)}>{c.text}</button>
                    )}
                  </span>
                ))}
              </nav>
            )}

            {ready ? (
              <ArenaMap
                ref={mapRef}
                regions={regions}
                level={level}
                home={home}
                spinLocked={homeReady}
                selKey={selKey}
                hotKey={hotKey}
                onSelect={setSelKey}
                onDrill={handleDrill}
                onPrompt={(name) => setPrompt(t('arena.drillHint', { n: name }))}
                onHover={handleHover}
                color={color}
              />
            ) : (
              <div className="aa-loading">{t('arena.loading')}</div>
            )}

            <div className={`aa-prompt${prompt ? ' on' : ''}`}>{prompt}</div>

            <div className="aa-legend">
              <span>{t('arena.low')}</span>
              <div className="bar" />
              <span>{t('arena.high')}</span>
              <span style={{ marginLeft: 8 }}>{t('arena.regionScore')}</span>
            </div>

            <div className="aa-zoomctl" role="group" aria-label={t('arena.regionScore')}>
              <button type="button" aria-label={t('arena.zoom_in')} onClick={() => mapRef.current?.zoomIn()}>+</button>
              <button type="button" aria-label={t('arena.zoom_out')} onClick={() => mapRef.current?.zoomOut()}>−</button>
              <button type="button" aria-label={t('arena.zoom_reset')} onClick={() => mapRef.current?.zoomReset()}>⤾</button>
            </div>

            {dokdo && <DokdoInset fill={dokdo.fill} label={t('arena.dokdo')} />}
          </section>

          {rightPanel === 'league' && (
          <aside className="aa-card aa-side">
            <h2>{scopeTitle}</h2>

            {our && (
              <div className="aa-ourrank">
                <div>
                  <span className="or-t">{t('arena.ourRank')}</span>
                  <span className="or-n">{our.label}</span>
                </div>
                <div className="or-r">
                  <b>{our.rank}</b>
                  <span>
                    {' / '}
                    {regions.length}
                    {t('arena.unit')}
                  </span>
                  <i>
                    {t('arena.avg')} {fmtScore(our.region.score)}
                  </i>
                </div>
              </div>
            )}

            <div className="aa-stats">
              <div className="aa-stat">
                <div className="k">{t('arena.topRegion')}</div>
                <div className="v">
                  {sorted[0] ? (sorted[0].name.length > 8 ? sorted[0].name.slice(0, 8) + '…' : sorted[0].name) : '—'}
                </div>
              </div>
              <div className="aa-stat">
                <div className="k">{t('arena.totalPart')}</div>
                <div className="v">{ppl(totalTakers)}</div>
              </div>
            </div>

            <input
              className="aa-search"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('arena.search')}
              autoComplete="off"
              spellCheck={false}
            />

            <ul className="aa-rank" ref={rankListRef}>
              {shown.map((d) => (
                <RankRow
                  key={d.key}
                  region={d}
                  rank={sorted.indexOf(d) + 1}
                  width={10 + 90 * ((d.score - scoreSpan.min) / (scoreSpan.max - scoreSpan.min || 1))}
                  selected={d.key === selKey}
                  hot={d.key === hotKey}
                  showFlag={d.drill && level === 0}
                  count={fmt(d.takers)}
                  color={color(d.score)}
                  scoreText={fmtScore(d.score)}
                  onActivate={activate}
                  onEnter={onRowEnter}
                  onLeave={onRowLeave}
                />
              ))}
            </ul>
          </aside>
          )}
          {rightPanel === 'chat' && (
            <aside className="aa-card aa-side aa-side-chat">
              <h2>{t('chat.title')}</h2>
              <ChatBoard />
            </aside>
          )}
          {/* 아이콘만 있는 세로 레일 — 이름은 data-label 이 CSS 툴팁으로 띄운다(스크린리더는 aria-label). */}
          <div className="aa-tabs" role="tablist" aria-label={t('arena.panelToggle')}>
            <button
              type="button"
              role="tab"
              aria-selected={rightPanel === 'league'}
              aria-label={t('arena.tabLeague')}
              data-label={t('arena.tabLeague')}
              className={`aa-tab aa-tab-league${rightPanel === 'league' ? ' on' : ''}`}
              onClick={() => setRightPanel((p) => (p === 'league' ? null : 'league'))}
            >
              <span className="ti" aria-hidden="true">🌐</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={rightPanel === 'chat'}
              aria-label={t('arena.tabChat')}
              data-label={t('arena.tabChat')}
              className={`aa-tab aa-tab-chat${rightPanel === 'chat' ? ' on' : ''}`}
              onClick={() => setRightPanel((p) => (p === 'chat' ? null : 'chat'))}
            >
              <span className="ti" aria-hidden="true">💬</span>
            </button>
          </div>
        </div>

      </div>

      {hover && (
        <div className="aa-tip" style={{ left: hover.x, top: hover.y }}>
          <b>{hover.region.name}</b>
          {hover.region.real && <span className="real"> · {t('arena.real')}</span>}
          <div className="row">
            <span>{t('arena.regionScore')}</span>
            <span>{fmtScore(hover.region.score)}</span>
          </div>
          <div className="row">
            <span>{t('arena.part')}</span>
            <span>{ppl(hover.region.takers)}</span>
          </div>
          <div className="row">
            <span>{t('arena.rankL')}</span>
            <span>
              {hoverRank} / {regions.length}
            </span>
          </div>
        </div>
      )}

    </div>
  )
}
