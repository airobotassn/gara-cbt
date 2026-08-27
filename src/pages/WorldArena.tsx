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
import StarField from '../components/StarField'
import { Link } from 'react-router-dom'
import { callFunction } from '../lib/supabase'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'
import { ArenaMap, DokdoInset, type ArenaMapHandle, type HoverInfo } from '../components/ArenaMap'
import {
  buildRegions,
  makeCscale,
  rankTone,
  MEDAL_TONE,
  TOP10_CUT,
  EMPTY_REAL,
  countryName,
  loadAdm1,
  loadAdm1Index,
  loadCountries,
  loadProvinces,
  type ArenaLevel,
  type GeoFeature,
  type RealData,
  type Region,
} from '../lib/arena/data'
import { M49_TO_ISO2 } from '../lib/arena/tables'
// 채팅 방 머리말의 국기 — 지도 쪽 countryName(피처+언어)과 다른 계열이라 lib/regions 에서 가져온다.
import { flagUrl } from '../lib/regions'
import '../styles/arena.css'
// ⚠️ 소스 일원화: 아래 leaderboard 호출은 src/pages/Ranking.tsx 의 AggregateBoard(집계 탭)와
//    완전히 동일한 RPC(region_/country_leaderboard, scope='region'|'country')를 쓴다 — 이중 fetch/별도 엔드포인트 없음.
//
// 쓰는 필드는 `score` = **베이지안 보정된 season_total 평균**(K=25 shrinkage, 일간창은 참여율 가중).
// 개인 랭킹과 같은 재료(skill_score+activity_score)를 국가/지역 단위로 올린 값이라 이게 이 지도의 지표다.
// ⚠️ 같은 응답의 `avg_level` 은 쓰지 않는다 — 이름과 달리 레벨이 아니라 보정 전 원시 평균이고
//    (레벨테스트 시절 필드명이 하위호환으로 남은 것), 그걸 쓰면 5명짜리 버킷이 그대로 1위를 먹는다.
type ServerBucket = { code: string; score: number; member_count: number; has_real?: boolean }

/** 서버 버킷 배열 → 코드별 맵. 국가·지역이 같은 모양이라 한 함수를 쓴다. */
function toBucketMap(bs: ServerBucket[] | undefined): RealData['country'] {
  const out: RealData['country'] = {}
  for (const b of bs ?? []) {
    if (b?.code) out[b.code] = { score: Number(b.score), members: Number(b.member_count), hasReal: !!b.has_real }
  }
  return out
}

/** 랭킹 목록 한 줄 — hover 마다 60줄을 통째로 다시 그리지 않도록 memo */
const RankRow = memo(function RankRow({
  region,
  rank,
  width,
  selected,
  hot,
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
  count: string
  color: string
  scoreText: string
  onActivate(r: Region): void
  onEnter(key: string): void
  onLeave(): void
}) {
  return (
    <li
      // 지도에서 고른 지역으로 목록을 스크롤할 때 이 줄을 찾는 표식
      data-key={region.key}
      className={[region.drill ? 'drill' : '', selected ? 'sel' : '', hot ? 'hot' : ''].filter(Boolean).join(' ')}
      onClick={() => onActivate(region)}
      onMouseEnter={() => onEnter(region.key)}
      onMouseLeave={onLeave}
    >
      <span className="no">{rank}</span>
      <div className="nm">
        <b>{region.name}</b>
        <div className="bw" style={{ width: `${width}%`, background: color }} />
        <div className="cnt">👥 {count}</div>
      </div>
      <span className="sc">{scoreText}</span>
    </li>
  )
})

export default function WorldArena() {
  const { t, lang } = useT()
  const { profile, loading, onboardingLoading } = useAuth()
  const mapRef = useRef<ArenaMapHandle>(null)

  // ── 지도 경계 데이터 ──
  const [countries, setCountries] = useState<GeoFeature[]>([])
  const [provinces, setProvinces] = useState<GeoFeature[]>([])

  // ── 화면 상태 ──
  const [level, setLevel] = useState<ArenaLevel>(0)
  // 파고든 나라. 대한민국은 기존 시도 파일, 그 외는 adm1. 지도 깊이는 여기까지다(시군구는 없앴다).
  const [drillCountry, setDrillCountry] = useState<{ iso: string; name: string } | null>(null)
  const [adm1Index, setAdm1Index] = useState<Record<string, number>>({})
  const [selKey, setSelKey] = useState<string | null>(null)
  const [hotKey, setHotKey] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hover, setHover] = useState<HoverInfo | null>(null)
  // 오른쪽 패널 기본값 = 채팅(들어오자마자 사람이 보이는 쪽). 리그 순위는 🌐 탭으로 전환.
  const [rightPanel, setRightPanel] = useState<'league' | 'chat' | null>('chat')
  // 지도 위 순위 표시(숫자 + 1~3위 트로피) on/off — 지도 모양만 보고 싶을 때 끈다.
  const [showNumbers, setShowNumbers] = useState(true)

  // ── 백엔드 실데이터 ──
  const [real, setReal] = useState<RealData>(EMPTY_REAL)
  // 로그인 계정 국가 — 지구본의 '우리 순위'·국기가 이걸 본다.
  //   **AuthProvider 가 게이트 판정으로 이미 읽어 둔 값**을 쓴다(예전엔 이 화면이 같은 행을 한 번 더 조회했다).
  //   국가를 모르면 'KR' 로 둔다 — 비로그인·익명·조회실패가 모두 여기로 떨어진다(옛 동작 그대로).
  const home = (profile?.countryCode || 'KR').toUpperCase()
  // 확정되면 지구본 자동회전 정지. ⚠️ `loading` 을 같이 봐야 한다 — 세션을 받기 전에는
  //   onboardingLoading 이 아직 false 라, 이것만 보면 부팅 첫 프레임에 'KR' 로 확정돼 버린다.
  const homeReady = !loading && !onboardingLoading

  const fmt = useCallback((n: number) => Number(n).toLocaleString(lang === 'ko' ? 'ko-KR' : lang), [lang])
  const ppl = useCallback((n: number) => fmt(n) + t('arena.ppl'), [fmt, t])
  // 점수는 season_total 스케일(0~10000)이라 소수점이 의미 없다 — 정수 + 천단위 구분.
  const fmtScore = useCallback((n: number) => fmt(Math.round(n)), [fmt])

  // 지구본은 즉시. 1차 행정구역은 어느 나라에 데이터가 있는지 목록만 먼저 받는다(드릴 가능 판정용).
  useEffect(() => {
    let alive = true
    loadCountries().then((f) => alive && setCountries(f)).catch(() => {})
    loadAdm1Index().then((m) => alive && setAdm1Index(m)).catch(() => {})
    return () => { alive = false }
  }, [])
  // 파고든 나라의 1차 행정구역 — 대한민국만 전용 파일(실집계 매칭이 그 파일의 숫자 코드에 묶여 있다).
  useEffect(() => {
    const iso = drillCountry?.iso
    if (!iso) return
    let alive = true
    const load = iso === 'KR' ? loadProvinces() : loadAdm1(iso)
    load.then((f) => alive && setProvinces(f)).catch(() => alive && setProvinces([]))
    return () => { alive = false }
  }, [drillCountry])

  // 국가 버킷 — 지구본은 항상 전 세계를 그리므로 한 번만 받는다.
  useEffect(() => {
    let cancelled = false
    callFunction<{ buckets: ServerBucket[] }>('leaderboard', { scope: 'country', window: 'season' })
      .then((res) => { if (!cancelled) setReal((p) => ({ ...p, country: toBucketMap(res.buckets) })) })
      .catch(() => { /* 못 받으면 지구본이 무채색으로 뜬다 — 예전처럼 브라우저가 목값을 지어내지 않는다 */ })
    return () => { cancelled = true }
  }, [])

  // 지역 버킷 — **파고든 그 나라 것만** 받는다.
  // ⚠️ 예전엔 `country: 'KR'` 로 못박혀 있어서 해외로 파고들면 주(州)가 전부 점수 없이 떴고, 그 빈자리를
  //    프론트 목값이 메우고 있었다. 목값을 걷어낸 지금은 여기서 받아오지 않으면 그냥 0점 지도가 된다.
  useEffect(() => {
    const iso = drillCountry?.iso
    if (!iso) return
    let cancelled = false
    callFunction<{ buckets: ServerBucket[] }>('leaderboard', { scope: 'region', country: iso, window: 'season' })
      .then((res) => { if (!cancelled) setReal((p) => ({ ...p, region: toBucketMap(res.buckets) })) })
      .catch(() => { if (!cancelled) setReal((p) => ({ ...p, region: {} })) })
    return () => { cancelled = true }
  }, [drillCountry])

  const regions = useMemo(
    () =>
      buildRegions({
        level,
        lang,
        real,
        countries,
        provinces,
        drillIso: drillCountry?.iso ?? null,
        adm1Index,
      }),
    [level, lang, real, countries, provinces, drillCountry, adm1Index],
  )

  // 점수 내림차순 — 순위·통계·목록이 모두 이걸 쓴다.
  const sorted = useMemo(() => regions.slice().sort((a, b) => b.score - a.score), [regions])

  // 파고든 나라 이름 — 클릭 시점의 이름을 그대로 쓰면 언어를 바꿨을 때 낡으므로 매번 다시 만든다.
  const drillName = useMemo(() => {
    if (!drillCountry) return ''
    const f = countries.find((x) => M49_TO_ISO2[String(x.id)] === drillCountry.iso)
    return f ? countryName(f, lang) : drillCountry.name
  }, [drillCountry, countries, lang])

  // ── 사이드 패널 파생값 ──
  const scopeTitle = useMemo(
    () => (level === 0 ? t('arena.worldLeague') : drillName + t('arena.league')),
    [level, drillName, t],
  )

  const totalTakers = useMemo(() => regions.reduce((s, r) => s + r.takers, 0), [regions])

  // 지구본에서 내 나라 찾기 — 국기·"우리 순위"·목록 하단 고정이 모두 이 하나를 쓴다.
  // ⚠️ 예전엔 `drill`(파고들 수 있는 나라)로 찾았다. 자립형 HTML 시절엔 드릴 대상이 대한민국
  //    하나뿐이라 그게 곧 "우리나라"였지만, 전 세계 adm1 을 지원하면서 200여 개국이 참이 됐다.
  const homeRegion = useMemo(
    () => (level === 0 ? regions.find((x) => M49_TO_ISO2[String(x.f.id)] === home) : undefined),
    [level, regions, home],
  )

  // 우리 순위 — 지구본은 홈 국가, 대한민국을 파고들면 서울.
  // ⚠️ 못 찾으면 아무 나라나 대신 세우지 않고 카드를 안 그린다. 지도(110m·177개국)에 없는
  //    나라(싱가포르·홍콩 등)의 사용자에게 엉뚱한 나라를 "우리 순위"라고 하는 것보다 낫다.
  const our = useMemo(() => {
    let r: Region | undefined
    let label = ''
    if (level === 0) {
      r = homeRegion
      if (r) label = '📍 ' + r.name + ' ' + t('arena.our0')
    } else if (home === 'KR' && drillCountry?.iso === 'KR') {
      r = regions.find((x) => x.code === '11')
      if (r) label = '📍 ' + r.name + ' ' + t('arena.our1')
    }
    if (!r) return null
    return { region: r, label, rank: sorted.indexOf(r) + 1 }
  }, [level, regions, sorted, homeRegion, home, drillCountry, t])

  // 상위 60개(검색 시 필터). 세계 단위에선 내 나라가 60위 밖으로 밀려도 맨 아래 고정 노출.
  // ⚠️ 지도에서 고른 지역도 같은 방식으로 고정한다 — 61위 이하나 검색어에 안 걸리는 지역을
  //    지도에서 누르면 목록에 줄 자체가 없어서 "선택했는데 랭킹은 그대로"로 보였다.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? sorted.filter((d) => d.name.toLowerCase().includes(q)).slice(0, 60) : sorted.slice(0, 60)
    const pinned: Region[] = []
    if (!q && level === 0 && homeRegion && !list.includes(homeRegion)) pinned.push(homeRegion)
    const selRegion = selKey ? sorted.find((d) => d.key === selKey) : undefined
    if (selRegion && !list.includes(selRegion) && !pinned.includes(selRegion)) pinned.push(selRegion)
    return pinned.length ? [...list, ...pinned] : list
  }, [query, sorted, level, homeRegion, selKey])

  const scoreSpan = useMemo(() => {
    if (!sorted.length) return { max: 1, min: 0 }
    return { max: sorted[0].score, min: sorted[sorted.length - 1].score }
  }, [sorted])

  // 색은 점수 선형이 아니라 **등수 순서(백분위)** 로 깐다 → 하위권에 몰린 점수가 강제로 펼쳐져
  // 위에서 아래까지 색이 골고루 퍼진다.
  // ⚠️ 지구본에서는 상위 10개가 별도 색(메달 3개 + 상위권 한 색)이라 **램프 계산에서 뺀다** —
  //    넣어두면 11위 이하가 램프의 아래쪽 90% 안에만 몰려 서로 구분이 흐려진다.
  //    시도 아래로는 4~10위 묶음을 안 쓰므로(지역이 적어 절반이 한 색이 된다) 1~3위만 뺀다.
  const color = useMemo(() => {
    const cut = level === 0 ? TOP10_CUT : 3
    const rest = sorted.length > cut ? sorted.slice(cut) : sorted
    return makeCscale(rest.map((r) => r.score))
  }, [sorted, level])

  // ── 지도 → 화면 상태 반영 ──
  const handleDrill = useCallback((r: Region) => {
    setSelKey(null)
    setQuery('')
    setLevel(1)
    // 이전 나라의 행정구역이 잠깐 비치지 않도록 목록을 비우고 새로 받는다.
    const iso = M49_TO_ISO2[String(r.f.id)]
    if (iso) {
      setDrillCountry({ iso, name: r.name })
      setProvinces([])
    }
  }, [])

  const goto = useCallback((l: ArenaLevel) => {
    setSelKey(null)
    setQuery('')
    setLevel(l)
    if (l < 1) setDrillCountry(null)
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
  }, [level, drillCountry])

  // 지도에서 지역을 고르면 랭킹 목록도 그 줄로 따라간다(지도 → 목록 방향. 반대 방향은
  // 목록 클릭이 곧 지도 클릭이라 activate 가 이미 잇고 있다).
  // ⚠️ li.scrollIntoView 를 쓰면 안 된다 — 목록만이 아니라 조상 스크롤러(페이지)까지 같이 굴려서
  //    지도가 화면 위로 밀려 나간다. 목록 자기 스크롤만 움직인다.
  // ⚠️ 브라우저 기본 `behavior:'smooth'` 도 안 쓴다 — 거리와 무관하게 짧고 빨라서 툭 끊겨 보이고,
  //    OS 애니메이션이 꺼져 있으면 통째로 무시돼 순간이동한다. 직접 이징으로 굴린다.
  const scrollAnim = useRef(0)
  useEffect(() => () => { if (scrollAnim.current) cancelAnimationFrame(scrollAnim.current) }, [])
  useEffect(() => {
    if (!selKey || rightPanel !== 'league') return
    const ul = rankListRef.current
    const li = ul?.querySelector<HTMLLIElement>(`li[data-key="${CSS.escape(selKey)}"]`)
    if (!ul || !li) return
    const ur = ul.getBoundingClientRect()
    const lr = li.getBoundingClientRect()
    // 이미 눈에 다 보이는 줄은 건드리지 않는다(누를 때마다 목록이 꿈틀거리는 게 더 거슬린다).
    if (lr.top >= ur.top && lr.bottom <= ur.bottom) return
    const from = ul.scrollTop
    const to = Math.max(
      0,
      Math.min(ul.scrollHeight - ul.clientHeight, from + (lr.top - ur.top) - (ur.height - lr.height) / 2),
    )
    if (Math.abs(to - from) < 1) return
    if (scrollAnim.current) cancelAnimationFrame(scrollAnim.current)
    // 거리에 따라 시간을 늘린다(한 칸 옆인데 0.6초를 끄는 것도, 60줄을 0.3초에 날리는 것도 어색하다).
    const dur = Math.min(900, 320 + Math.abs(to - from) * 0.45)
    const t0 = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur)
      const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2 // easeInOutCubic
      ul.scrollTop = from + (to - from) * k
      scrollAnim.current = t < 1 ? requestAnimationFrame(step) : 0
    }
    scrollAnim.current = requestAnimationFrame(step)
  }, [selKey, rightPanel, shown])

  const activate = useCallback(
    (r: Region, opts?: { enter?: boolean }) => mapRef.current?.activate(r, opts),
    [],
  )
  const onRowEnter = useCallback((key: string) => setHotKey(key), [])
  const onRowLeave = useCallback(() => setHotKey(null), [])

  // 툴팁의 순위 — sorted 에서의 위치
  const hoverRank = useMemo(() => {
    if (!hover) return 0
    return sorted.findIndex((x) => x.key === hover.region.key) + 1
  }, [hover, sorted])

  // 랭킹 목록의 점수 막대 색 — 지도와 한 몸이어야 한다(1~3위 메달색, 세계 단위 4~10위 보라).
  // 지도의 방사형(가운데 밝고 가장자리 어두움)을 5px 막대에서는 가로 선형으로 편다.
  const barFill = useCallback(
    (rank: number, score: number) => {
      const tone = rankTone(rank, level)
      if (!tone) return color(score)
      const [lit, shade] = tone
      return `linear-gradient(90deg, ${shade}, ${lit} 38%, ${lit} 62%, ${shade})`
    },
    [level, color],
  )

  // 독도 확대도 — 대한민국을 파고들었을 때만. 색은 소속 지역(경북)과 동일.
  const dokdo = useMemo(() => {
    if (level !== 1 || drillCountry?.iso !== 'KR') return null
    const parent = regions.find((d) => d.code === '37')
    return { fill: parent ? color(parent.score) : '#5b93e2' }
  }, [level, regions, color, drillCountry])

  // ── 채팅 방 ──
  // 방은 지도 상태가 그대로 정한다(별도 방 선택 UI 없음): 지구본에서 아무 나라도 안 고르면 전세계,
  // 나라를 고르면 그 나라. 나라 안에 들어가 시도를 골라도 방은 나라 단위로 유지된다 — 방이 거기까지만 있다.
  const chatRoom = useMemo(() => {
    if (level > 0) return drillCountry?.iso ?? 'global'
    if (!selKey) return 'global'
    const r = regions.find((x) => x.key === selKey)
    return (r ? M49_TO_ISO2[String(r.f.id)] : undefined) ?? 'global'
  }, [level, drillCountry, selKey, regions])

  const chatRoomName = useMemo(() => {
    if (chatRoom === 'global') return t('chat.roomGlobal')
    if (level > 0) return drillName
    return regions.find((x) => x.key === selKey)?.name ?? chatRoom
  }, [chatRoom, level, drillName, regions, selKey, t])

  const crumbs = useMemo(() => {
    if (level === 0) return []
    return [
      { text: t('arena.world'), level: 0 as ArenaLevel },
      { text: drillName, level: 1 as ArenaLevel },
    ]
  }, [level, drillName, t])

  const ready = countries.length > 0

  return (
    <div className="arena">
      {/* 밤하늘 — 랜딩 지구본과 같은 별(다크에서만). 내용은 .aa-wrap 이 z-index:1 로 그 위에 선다. */}
      <StarField />
      <div className="aa-wrap">
        {/* 홈으로 — 앱 공용 뒤로 칩(shared.css)을 그대로 쓴다.
            ⚠️ 예전엔 아레나 톤에 맞춘다고 .aa-home 으로 따로 그렸는데, 그렇게 화면마다 하나씩
               따로 그린 결과가 같은 버튼 일곱 가지였다(2026-08-20 통일). */}
        <Link className="topbar" to="/">
          <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
          {t('common.home')}
        </Link>

        <header className="aa-head">
          <h1>{t('arena.title')}</h1>
        </header>

        {/* 런처 — 아레나가 허브·레벨테스트·미니게임·데일리의 관문이라 지도보다 위에 둔다.
            순서는 레벨 → 미니게임 → 오늘의 학습(2026-08-19 지시). 마이 홈만 맨 앞에 그대로 둔다. */}
        <nav className="aa-launch">
          <Link className="aa-lbtn cari" to="/hub">
            {/* 학사모 이모지 대신 CARI 전신(원본 'CARI 대각선.png' — 불투명 배경을 따내고 트리밍) */}
            <span className="ic ic-img"><img src="/cari-diagonal.webp" alt="" /></span>
            <span className="lt">
              <b>{t('arena.bHub')}</b>
              <i>{t('arena.bHubS')}</i>
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
          <Link className="aa-lbtn game" to="/games">
            <span className="ic">🕹️</span>
            <span className="lt">
              <b>{t('arena.bGame')}</b>
              <i>{t('arena.bGameS')}</i>
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
                onHover={handleHover}
                showNumbers={showNumbers}
                color={color}
              />
            ) : (
              <div className="aa-loading">{t('arena.loading')}</div>
            )}

            <div className="aa-legend">
              <span>{t('arena.low')}</span>
              <div className="bar" />
              <span>{t('arena.high')}</span>
              <span style={{ marginLeft: 8 }}>{t('arena.regionScore')}</span>
            </div>

            <div className="aa-zoomctl" role="group" aria-label={t('arena.regionScore')}>
              {/* 세계로 — 나라 안에 들어와 있을 때만. 빵부스러기가 화면 위쪽에 있어 지도를 보다가
                  돌아가려면 시선을 멀리 옮겨야 했다. 조작 버튼 옆에 같이 둔다. */}
              {level > 0 && (
                <button type="button" className="aa-toworld" data-label={t('arena.world')} aria-label={t('arena.world')} onClick={() => goto(0)}>
                  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
                    <g fill="none" stroke="currentColor" strokeWidth="1.6">
                      <circle cx="10" cy="10" r="7.2" />
                      <ellipse cx="10" cy="10" rx="3.1" ry="7.2" />
                      <path d="M2.9 10h14.2M4.3 6h11.4M4.3 14h11.4" />
                    </g>
                  </svg>
                </button>
              )}
              <button type="button" data-label={t('arena.zoom_in')} aria-label={t('arena.zoom_in')} onClick={() => mapRef.current?.zoomIn()}>
                +
              </button>
              <button type="button" data-label={t('arena.zoom_out')} aria-label={t('arena.zoom_out')} onClick={() => mapRef.current?.zoomOut()}>
                −
              </button>
              {/* '원래대로' 버튼은 없앴다 — 이동 범위를 화면에 묶어(ArenaMap 의 setPanBound) 지도가
                  화면 밖으로 사라지는 일이 없어졌고, 축소만으로 항상 제자리로 돌아온다. */}
              {/* 순위 숫자 on/off — 끄면 지도의 숫자·트로피가 사라지고 색(순위 램프)만 남는다. */}
              <button
                type="button"
                className={`aa-numtoggle${showNumbers ? '' : ' off'}`}
                aria-pressed={showNumbers}
                data-label={t(showNumbers ? 'arena.numbers_hide' : 'arena.numbers_show')}
                aria-label={t(showNumbers ? 'arena.numbers_hide' : 'arena.numbers_show')}
                onClick={() => setShowNumbers((v) => !v)}
              >
                <span className="nt" aria-hidden="true">123</span>
              </button>
            </div>

            {/* 시상대 — 지도 왼쪽 아래. 오른쪽 리그 패널을 닫아도 1~3위는 남는다.
                지도 위에 얹히는 판이라 흰 카드가 아니라 **어두운 유리 HUD**다(지도는 라이트/다크 공통 딥블루).
                메달 보석은 지도와 같은 재료 — MEDAL_TONE 방사형 그라디언트 + 흰 발광 테두리. */}
            {sorted.length > 0 && (
              <div className="aa-top3">
                <span className="cap">🏆 TOP 3</span>
                {sorted.slice(0, 3).map((r, i) => {
                  const [lit, shade] = MEDAL_TONE[i]
                  // 국기는 지구본(레벨0)에서만 — 파고든 뒤의 1~3위는 전부 같은 나라라 세 줄에
                  // 같은 국기가 반복될 뿐이다.
                  const flag = level === 0 ? flagUrl(M49_TO_ISO2[String(r.f.id)]) : ''
                  return (
                    // 줄 전체가 버튼 — 지도가 그 나라로 돌아가고 선택까지만 한다.
                    // ⚠️ enter:false 를 빼면 목록 줄(RankRow)처럼 그 나라 안(주·시도 랭킹)까지
                    //    파고든다. 시상대는 '1~3위가 어디인지' 를 보여주는 자리라 진입은 안 한다.
                    <button
                      type="button"
                      className={`row r${i + 1}`}
                      key={r.key}
                      onClick={() => activate(r, { enter: false })}
                    >
                      <span
                        className="md"
                        style={{
                          background: `radial-gradient(circle at 34% 28%, ${lit}, ${shade} 76%)`,
                          boxShadow: `0 0 0 1.5px rgba(255,255,255,.55), 0 0 11px -1px ${lit}`,
                        }}
                      >
                        {i + 1}
                      </span>
                      {flag && <img className="fl" src={flag} alt="" decoding="async" />}
                      <span className="nm" style={i === 0 ? { color: lit } : undefined}>{r.name}</span>
                      <span className="sc" style={{ textShadow: `0 0 10px ${lit}59` }}>{fmtScore(r.score)}</span>
                    </button>
                  )
                })}
              </div>
            )}

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
              {shown.map((d) => {
                const rank = sorted.indexOf(d) + 1
                return (
                  <RankRow
                    key={d.key}
                    region={d}
                    rank={rank}
                    width={10 + 90 * ((d.score - scoreSpan.min) / (scoreSpan.max - scoreSpan.min || 1))}
                    selected={d.key === selKey}
                    hot={d.key === hotKey}
                    count={fmt(d.takers)}
                    color={barFill(rank, d.score)}
                    scoreText={fmtScore(d.score)}
                    onActivate={activate}
                    onEnter={onRowEnter}
                    onLeave={onRowLeave}
                  />
                )
              })}
            </ul>
          </aside>
          )}
          {rightPanel === 'chat' && (
            <aside className="aa-card aa-side aa-side-chat">
              <h2>{t('chat.title')}</h2>
              {/* 지금 어느 방인지 + 전세계로 돌아가는 길. 방 선택 UI 를 따로 두지 않는 대신,
                  「전세계」를 누르면 지도도 같이 세계로 나간다(goto(0)) — 지도와 방이 늘 한 몸이다. */}
              <div className="aa-chatroom">
                {/* 방 표시. 국가 방은 국기 **그림**이다 — 이모지로 두면 윈도우에서 국기 대신
                    `KR` 두 글자가 나와, 아래 메시지들엔 국기가 뜨는데 머리말만 글자인 어긋남이 생긴다.
                    🌍·📍 는 그대로 이모지다(둘 다 윈도우 폰트에 있다). */}
                <span className="rm">
                  {chatRoom === 'global' ? (
                    '🌍'
                  ) : flagUrl(chatRoom) ? (
                    <img className="rm-flag" src={flagUrl(chatRoom)} alt="" decoding="async" />
                  ) : (
                    '📍'
                  )}{' '}
                  {chatRoomName}
                </span>
                {chatRoom !== 'global' && (
                  <button type="button" onClick={() => goto(0)}>{t('chat.roomBack')}</button>
                )}
              </div>
              {/* key={chatRoom} — 방이 바뀌면 목록·커서·폴링을 통째로 새로 시작한다(전 방 응답 섞임 방지) */}
              <ChatBoard key={chatRoom} room={chatRoom} />
            </aside>
          )}
          {/* 아이콘만 있는 세로 레일 — 이름은 data-label 이 CSS 툴팁으로 띄운다(스크린리더는 aria-label). */}
          <div className="aa-tabs" role="tablist" aria-label={t('arena.panelToggle')}>
            {/* 채팅이 기본 패널이라 레일에서도 위(첫 번째)에 둔다. */}
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
          </div>
        </div>

      </div>

      {hover && (
        <div className="aa-tip" style={{ left: hover.x, top: hover.y }}>
          <b>{hover.region.name}</b>
          {/* ⛔ 옛 '실데이터' 배지는 뗐다(2026-08-25). 실회원이 있는 버킷에만 붙던 것이라 **한국에만** 떴는데,
              사용자에게 쓸모가 없는 데다 "여기만 실데이터" 라고 붙이는 순간 나머지 나라는 아니라고 우리가
              먼저 광고하는 꼴이 된다. 판정값(region.real ← has_real)은 그대로 내려온다 — 운영 판단용이다. */}
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
