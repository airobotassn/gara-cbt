// 월드 아레나 지도 — 지구본(레벨0) → 대한민국 시도(레벨1) → 시군구(레벨2) 드릴다운.
//
// 역할 분담: **React 가 상태(level·curProv·selKey·검색어)를 소유**하고, 이 컴포넌트는 그 상태를 받아
// SVG 만 그린다(제어 컴포넌트). d3 는 여기 안에서만 명령형으로 돌고, 사용자의 지도 조작은
// onSelect/onDrill 콜백으로 위에 올려보낸다.
//   · 레벨0: 정사영(지구본) — 드래그=회전, 자동 회전(홈 국가 확정 전까지), 휠/핀치=배율
//   · 레벨1·2: 메르카토르 평면 — 드래그=이동, 휠/핀치=배율
//   · 레벨 전환은 fadeTo() 가 페이드아웃 → 상태 변경 → 페이드인 순으로 감싼다(팍 넘어가지 않게).
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react'
import { select, type Selection } from 'd3-selection'
import {
  geoArea,
  geoCentroid,
  geoDistance,
  geoGraticule10,
  geoMercator,
  geoOrthographic,
  geoPath,
  type GeoProjection,
} from 'd3-geo'
import { zoom as d3Zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior } from 'd3-zoom'
import { timer as d3Timer, type Timer } from 'd3-timer'
import { easeCubicIn, easeCubicInOut, easeCubicOut } from 'd3-ease'
import 'd3-transition' // selection.transition() 부착(부수효과 import)
import { MEDAL_TONE, TOP10_CUT, TOP10_TONE, type ArenaLevel, type Cscale, type GeoFeature, type Region } from '../lib/arena/data'
import { DOKDO_GEO, M49_TO_ISO2 } from '../lib/arena/tables'
import { labelAnchor } from '../lib/arena/labelPoint'

export interface ArenaMapHandle {
  /** 사이드 랭킹 목록 클릭도 지도 클릭과 같은 경로를 타도록 노출 */
  activate(r: Region): void
  zoomIn(): void
  zoomOut(): void
  zoomReset(): void
}

export interface HoverInfo {
  region: Region
  x: number
  y: number
}

interface Props {
  regions: Region[]
  level: ArenaLevel
  /** 로그인 계정 국가(alpha-2). 지구본에 링으로 표시하고 중앙 정렬한다. */
  home: string
  /** 홈 국가가 확정되면 자동 회전을 멈춘다(그 국가에 고정). */
  spinLocked: boolean
  selKey: string | null
  /** 사이드 목록에 마우스를 올렸을 때 지도에서 같이 강조할 키 */
  hotKey: string | null
  onSelect(key: string): void
  onDrill(r: Region): void
  onHover(info: HoverInfo | null): void
  /** 지도 위 순위 표시(숫자 라벨 + 1~3위 트로피) on/off. 색·발광은 그대로 남는다. */
  showNumbers: boolean
  /** 점수 → 색. 화면에 뜬 버킷 범위로 만든 상대 스케일이라 부모가 소유한다. */
  color: Cscale
}

const SPIN_SPEED = 0.012 // deg/ms
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

/**
 * 지도 위 순위 숫자. `c`=찍을 위치(labelAnchor), `area`=구면 면적(스테라디안),
 * `f`=크기를 재기 위한 지오메트리 — **전체가 아니라 라벨이 놓인 덩어리**다.
 * 섬이 흩어진 지역(인도네시아·신안 등)에서 전체 바운딩박스로 재면 숫자가 본토보다 커진다.
 */
type RankLabel = { rank: number; c: [number, number]; key: string; area: number; f: GeoFeature }

/**
 * 순위 숫자 크기 — **기본은 다 같은 크기, 땅이 좁은 곳만 줄인다.**
 *
 * 땅 넓이에 비례해 키우지는 않는다. 크기가 곧 중요도로 읽히기 때문에, 30등인 큰 나라가 3등인
 * 작은 나라보다 크게 나오면 순위를 잘못 읽게 된다. 그래서 큰 나라는 전부 같은 기준 크기에서 멈추고,
 * 자기 땅에 안 들어가는 좁은 나라만 들어갈 만큼 줄인다(그래도 안 되면 숨긴다).
 *
 * 기준 크기는 **지도 배율에 연동**된다 — 지도가 2배가 되면 숫자도 2배. 고정 px 로 두면
 * 확대할 때 지도만 커지고 숫자는 그대로라 따로 논다.
 *
 * 땅 크기는 두 값 중 작은 쪽으로 잰다:
 *   · √(투영 면적) — 칠레·토고처럼 가늘고 긴 땅은 실제 폭보다 과대평가한다.
 *   · 화면상 바운딩박스의 짧은 변 — 그 과대평가를 잘라 준다.
 */
const LABEL_BASE = 14 // 기준 크기(px, 배율 1일 때) — 여기서 더 커지지 않는다
const LABEL_RATIO = 0.3 // 땅이 좁을 때 "짧은 변의 몇 %까지 쓸지"
const LABEL_FLOOR = 9 // 좁은 나라도 여기까지는 유지(아래 폭 상한에 걸리면 더 줄어든다)
const LABEL_HIDE = 6 // 그래도 이보다 작으면(px) 읽을 수 없으니 숨긴다 — 확대하면 나타난다

// 1~3위 = **땅 색 + 흰 발광 테두리**(MEDAL_TONE) + 그 위에 **입체 숫자 트로피**(public/rank-1..3.png).
// 숫자 라벨(ranklab)은 등수와 무관하게 전부 그리고, 1~3위만 트로피에 가리지 않게 아래로 비켜 찍는다.
const OBJ_RATIO = 0.6 // 땅 짧은 변 대비 트로피 높이
const OBJ_MIN = 26 // 좁은 1~3위여도 이만큼은 키운다
const OBJ_MAX = 96 // 큰 땅에서 트로피만 비대해지는 걸 막는 상한(px)
const OBJ_HIDE = 18 // 너무 축소돼 이보다 작으면 입체가 뭉개져 지저분하므로 숨긴다
/** 트로피 이미지의 가로/세로 비 — 1·3등은 384×512, 2등은 366×512. 정사각으로 박으면 찌그러진다. */
const OBJ_ASPECT = [0.75, 0.715, 0.75]

/** 본토 판별 반경(라디안). 러시아처럼 동서로 긴 나라도 한 덩어리로 묶이도록 넉넉히 잡는다. */
const MAINLAND_R = (35 * Math.PI) / 180

/**
 * 화면을 맞출 **본토** 골라내기 — `[남길 지역들, 본토 중앙 경도]`.
 *
 * 본토 = **면적 합이 가장 큰 무리**다. "가장 큰 조각 하나"로 잡으면 안 된다 — 프랑스는 기아나,
 * 미국은 알래스카가 단일 면적으로는 더 커서 그쪽이 본토로 뽑히고 정작 본토가 화면 밖으로 밀린다.
 * 각 지역 중심을 후보로 놓고 반경 안 면적을 합산해 최대인 곳을 본토로 삼는다.
 */
function mainlandOf(feats: GeoFeature[]): { keep: GeoFeature[]; lon0: number } {
  const cs = feats.map((f) => geoCentroid(f))
  const as = feats.map((f) => geoArea(f))
  // ⚠️ 단순화 과정에서 면이 선/점으로 뭉개진 조각은 중심이 NaN 이 된다. 그대로 두면 비교가 전부
  //    false 가 되어 엉뚱한 지역이 본토로 뽑히고, 회전각까지 NaN 이 되면 지도 전체가 사라진다.
  const ok = feats.map((_, i) => Number.isFinite(cs[i][0]) && Number.isFinite(cs[i][1]) && Number.isFinite(as[i]))
  const first = ok.indexOf(true)
  if (first < 0) return { keep: feats, lon0: 0 }
  let best = first
  let bestSum = -1
  for (let i = 0; i < feats.length; i++) {
    if (!ok[i]) continue
    let sum = 0
    for (let j = 0; j < feats.length; j++) if (ok[j] && geoDistance(cs[i], cs[j]) < MAINLAND_R) sum += as[j]
    if (sum > bestSum) {
      bestSum = sum
      best = i
    }
  }
  // 중심이 망가진 조각은 화면 맞춤에서 빼되(투영이 오염된다) 지도에는 그대로 그린다.
  const keep = feats.filter((_, j) => ok[j] && geoDistance(cs[j], cs[best]) < MAINLAND_R)
  return { keep: keep.length ? keep : feats, lon0: cs[best][0] }
}

function ArenaMapInner(props: Props, ref: React.Ref<ArenaMapHandle>) {
  const svgRef = useRef<SVGSVGElement>(null)

  // d3 콜백은 렌더 시점의 props 를 클로저로 붙잡으면 낡는다 → 항상 최신을 ref 로 읽는다.
  // 갱신은 렌더 중이 아니라 레이아웃 이펙트에서(아래 마운트/그리기 이펙트보다 먼저 돈다).
  const p = useRef(props)
  useLayoutEffect(() => {
    p.current = props
  })

  // 지도 내부 상태(리렌더를 유발하지 않아야 하므로 state 가 아닌 ref).
  const st = useRef({
    rot: [-30, -12, 0] as [number, number, number],
    globeK: 1,
    baseScale0: 1,
    proj: null as GeoProjection | null,
    W: 0,
    H: 0,
    spin: null as Timer | null,
    anim: null as Timer | null,
    pendingFadeIn: false,
    fadeGuard: 0,
    centered: false, // 홈 국가로 한 번이라도 중앙 정렬했는지
    vk: 1, // 평면 레벨(1·2)에서 viewport 그룹에 걸린 확대 배율 — 글자 크기 판정에 쓴다
    labels: [] as RankLabel[],
    rankOf: new Map<string, number>(), // key → 등수. 1~3위 별색 칠하기용(labels 와 같이 갱신)
  })

  const g = useRef<{
    backdrop: Selection<SVGGElement, unknown, null, undefined>
    viewport: Selection<SVGGElement, unknown, null, undefined>
    atmo: Selection<SVGGElement, unknown, null, undefined>
    sphere: Selection<SVGGElement, unknown, null, undefined>
    spec: Selection<SVGGElement, unknown, null, undefined>
    grat: Selection<SVGGElement, unknown, null, undefined>
    geo: Selection<SVGGElement, unknown, null, undefined>
    glow: Selection<SVGGElement, unknown, null, undefined>
    mark: Selection<SVGGElement, unknown, null, undefined>
    labels: Selection<SVGGElement, unknown, null, undefined>
    zoom: ZoomBehavior<SVGSVGElement, unknown>
  } | null>(null)

  const graticule = useMemo(() => geoGraticule10(), [])

  // d3 이벤트 핸들러가 호출할 최신 함수들(핸들러는 마운트 때 한 번만 등록되므로 ref 로 우회).
  const fn = useRef<{
    paint: () => void
    draw: () => void
    activate: (r: Region) => void
    resizeLabels: () => void
  }>({
    paint: () => {},
    draw: () => {},
    activate: () => {},
    resizeLabels: () => {},
  })

  const stopSpin = useCallback(() => {
    if (st.current.spin) {
      st.current.spin.stop()
      st.current.spin = null
    }
  }, [])

  const reduceMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  // ── 투영: 레벨0=지구본(정사영), 레벨1·2=메르카토르 fit ──
  const makeProjection = useCallback((regions: Region[], level: ArenaLevel): GeoProjection => {
    const { W, H } = st.current
    if (level === 0) {
      const proj = geoOrthographic()
        .fitExtent(
          [
            [18, 14],
            [W - 18, H - 24],
          ],
          { type: 'Sphere' },
        )
        .rotate(st.current.rot)
      st.current.baseScale0 = proj.scale() * 1.32
      proj.scale(st.current.baseScale0 * st.current.globeK)
      return proj
    }
    // 평면 레벨은 **본토에만** 화면을 맞춘다. 전체에 맞추면 해외영토·원격 섬 때문에 본토가
    // 점만 해진다(프랑스=기아나·레위니옹, 미국=알래스카·괌, 뉴질랜드=채텀 제도).
    // 그리고 본토의 중앙 경도만큼 회전시켜 날짜변경선 이음매를 피한다(러시아가 좌우로 찢어졌다).
    const feats = regions.map((r) => r.f)
    const proj = geoMercator()
    // ⚠️ 빈 목록에 fitExtent 를 걸면 배율이 NaN/Infinity 가 되어 지도 전체가 사라진다.
    //    드릴다운 직후 새 나라 데이터가 도착하기 전 한 프레임 동안 실제로 빈다.
    if (!feats.length) return proj
    const { keep, lon0 } = mainlandOf(feats)
    return proj.rotate([-lon0, 0]).fitExtent(
      [
        [16, 16],
        [W - 16, H - 16],
      ],
      { type: 'FeatureCollection', features: keep } as never,
    )
  }, [])

  // ── 순위 라벨 크기·위치: 지역이 화면에서 차지하는 크기에 선형 비례 ──
  // 숫자(4위~)는 font-size, 트로피(1~3위)는 정사각 이미지로 그린다.
  // paint() 와 평면 레벨의 줌 tick 이 공유한다(줌만 바뀔 땐 지오메트리를 다시 그릴 필요가 없다).
  const sizeLabels = useCallback((path: ReturnType<typeof geoPath>) => {
    const groups = g.current
    const { proj } = st.current
    if (!groups || !proj) return
    const { level } = p.current
    const lrot = proj.rotate()
    const pscale = proj.scale()
    // 레벨1·2 의 확대는 viewport 그룹 transform 이라 라벨에도 이미 곱해진다. 계산은 그룹 안 좌표계로
    // 하고, "화면에서 몇 px 인가"를 판정할 때만 tk 를 곱한다(그래서 마지막에 다시 나눈다).
    const tk = level === 0 ? 1 : st.current.vk

    // 그 지역이 그룹 좌표계에서 차지하는 "짧은 변" 근사치.
    const roomOf = (d: RankLabel) => {
      // (1) 면적 기준 한 변 — 투영 왜곡 보정(지구본은 가장자리 단축 cos θ, 메르카토르는 고위도 팽창 1/cos²φ)
      let a = d.area
      if (level === 0) a *= Math.max(0.12, Math.cos(geoDistance(d.c, [-lrot[0], -lrot[1]])))
      else {
        const cosLat = Math.max(0.2, Math.cos((d.c[1] * Math.PI) / 180))
        a /= cosLat * cosLat
      }
      // (2) 실제 바운딩박스의 짧은 변 — 가늘고 긴 땅에서 (1)의 과대평가를 잘라 준다
      const bb = path.bounds(d.f)
      const shortSide = Math.min(bb[1][0] - bb[0][0], bb[1][1] - bb[0][1])
      return Math.min(Math.sqrt(a) * pscale, shortSide)
    }

    groups.labels.selectAll<SVGTextElement, RankLabel>('text.ranklab').each(function (d) {
      const screenRoom = roomOf(d) * tk
      // 절대 넘치지 않게 하는 폭 상한. font-size 가 아니라 **그려지는 글자 폭**으로 재야 한다 —
      // 두 자릿수는 폭이 font-size 의 1.4배쯤이라, font-size 만 땅 크기로 잘라 두면 그대로 삐져나온다.
      // (0.62/자릿수 = 숫자 1글자 폭, 0.24 = 흰 테두리(.22em)가 좌우로 번지는 몫)
      const widthCap = (screenRoom * 0.92) / (0.62 * String(d.rank).length + 0.24)
      // 기준 크기는 지도 배율만큼 커진다(지구본은 투영 배율, 평면은 그룹 transform).
      const cap = LABEL_BASE * (level === 0 ? st.current.globeK : st.current.vk)
      // 좁은 땅은 비례로 줄이되 하한까지는 유지 → 기준 크기와 폭 상한, 둘 다 넘지 않게 자른다.
      const px = Math.min(Math.max(screenRoom * LABEL_RATIO, LABEL_FLOOR), cap, widthCap)
      const node = select(this)
      if (px < LABEL_HIDE) node.style('display', 'none')
      else node.style('display', null).style('font-size', `${(px / tk).toFixed(2)}px`)
    })

    // 1~3위 입체 트로피 — 높이로 크기를 정하고 가로는 이미지 비율을 따른다(정사각으로 박으면 찌그러진다).
    // 지역 중심에 세로로 얹되, 받침대가 중심에 오도록 살짝 위로 올린다.
    groups.labels.selectAll<SVGImageElement, RankLabel>('image.rankobj').each(function (d) {
      const xy = proj(d.c)
      const h = clamp(roomOf(d) * tk * OBJ_RATIO, OBJ_MIN, OBJ_MAX)
      const node = select(this)
      if (!xy || h < OBJ_HIDE) {
        node.style('display', 'none')
        return
      }
      const gh = h / tk // 그룹 좌표계 높이
      const gw = gh * OBJ_ASPECT[d.rank - 1]
      node
        .style('display', null)
        .attr('width', gw.toFixed(2))
        .attr('height', gh.toFixed(2))
        .attr('x', (xy[0] - gw / 2).toFixed(2))
        .attr('y', (xy[1] - gh * 0.62).toFixed(2))
    })
  }, [])

  // ── 지오메트리 다시 칠하기(회전·줌 tick 마다 호출) ──
  const paint = useCallback(() => {
    const groups = g.current
    const { proj } = st.current
    if (!groups || !proj) return
    const { level, home, regions } = p.current
    const path = geoPath(proj)

    if (level === 0) {
      const ctr = proj.translate()
      const rr = proj.scale()
      groups.atmo
        .selectAll('circle')
        .data([0])
        .join('circle')
        .attr('class', 'atmo')
        .attr('cx', ctr[0])
        .attr('cy', ctr[1])
        .attr('r', rr + 11)
      groups.sphere
        .selectAll('path')
        .data([{ type: 'Sphere' as const }])
        .join('path')
        .attr('class', 'sphere')
        .attr('d', (d) => path(d))
      groups.spec
        .selectAll('ellipse')
        .data([0])
        .join('ellipse')
        .attr('class', 'spec')
        .attr('cx', ctr[0] - rr * 0.26)
        .attr('cy', ctr[1] - rr * 0.34)
        .attr('rx', rr * 0.46)
        .attr('ry', rr * 0.32)
        .attr('transform', `rotate(-24 ${ctr[0] - rr * 0.26} ${ctr[1] - rr * 0.34})`)
      groups.grat
        .selectAll('path')
        .data([graticule])
        .join('path')
        .attr('class', 'grat')
        .attr('d', (d) => path(d))
    } else {
      groups.atmo.selectAll('*').remove()
      groups.sphere.selectAll('*').remove()
      groups.spec.selectAll('*').remove()
      groups.grat.selectAll('*').remove()
    }

    // 평면 레벨(1·2)의 어두운 바탕 — 지구본과 같은 바다 그라디언트를 화면 전체에 깐다.
    // 이게 없으면 대륙만 뜨고 주변이 카드의 흰 배경이라, 흰 발광 테두리가 바깥쪽에서 묻히고
    // 같은 색인데도 지구본과 인상이 달라진다.
    groups.backdrop
      .selectAll<SVGRectElement, number>('rect')
      .data(level === 0 ? [] : [0])
      .join('rect')
      .attr('class', 'mapbgfill')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', st.current.W)
      .attr('height', st.current.H)

    groups.geo.selectAll<SVGPathElement, Region>('path').attr('d', (d) => path(d.f))

    // 시상대 경계 = **하얀 테두리선**. 면이 광채를 뿜는 게 아니라 나라 윤곽선이 빛난다.
    // ⚠️ 후광(흐린 겹)은 **지구본에서만** 쓴다. 시도·시군구는 경계가 촘촘해서 후광끼리 겹쳐
    //    화면이 흐려진다 — 그 레벨에서는 또렷한 심지 하나로 충분하다.
    // ⚠️ 이 그룹은 **모든 지역(.geo) 위**에 있어야 한다. 아래에 두면 나중에 그려지는 이웃 지역이
    //    바깥으로 번진 빛을 덮어, 바다에 접한 쪽만 빛나고 국경 맞닿은 쪽은 사라진다.
    // 색은 등수와 무관하게 흰색 하나라 CSS 가 갖는다(여기서는 모양만 준다).
    const medals = regions
      .map((r) => ({ r, rank: st.current.rankOf.get(r.key) ?? 99 }))
      .filter((m) => m.rank <= 3)
      .sort((a, b) => a.rank - b.rank)
    // 선 굵기는 **지역이 화면에서 차지하는 크기에 비례**한다. 고정 px 로 두면 지구본처럼 지역이
    // 작아졌을 때 상대적으로 빛이 과해져 덩어리를 잡아먹는다. 평면 레벨의 확대 배율(tk)만큼
    // 그룹 좌표계로 되돌려 준다.
    const tk = level === 0 ? 1 : st.current.vk
    const widthOf = (m: (typeof medals)[number], ratio: number, lo: number, hi: number) => {
      const bb = path.bounds(m.r.f)
      const short = Math.min(bb[1][0] - bb[0][0], bb[1][1] - bb[0][1]) * tk
      return clamp(short * ratio, lo, hi) / tk
    }
    for (const [cls, ratio, lo, hi] of [
      ['medalhalo', 0.035, 1.2, 3.2],
      ['medalline', 0.018, 0.7, 1.8],
    ] as const) {
      groups.glow
        .selectAll<SVGPathElement, (typeof medals)[number]>(`path.${cls}`)
        .data(cls === 'medalhalo' && level !== 0 ? [] : medals, (m) => m.rank)
        .join('path')
        .attr('class', cls)
        .attr('stroke-width', (m) => widthOf(m, ratio, lo, hi).toFixed(2))
        .attr('d', (m) => path(m.r.f))
    }

    // 홈 국가 표시 링 — 지구본 앞면에 있을 때만
    if (level === 0) {
      const homeR = regions.find((r) => M49_TO_ISO2[String(r.f.id)] === home) ?? regions.find((r) => r.drill)
      const c = homeR ? geoCentroid(homeR.f) : null
      const rot = proj.rotate()
      const visible = c ? geoDistance(c, [-rot[0], -rot[1]]) < Math.PI / 2 : false
      groups.mark
        .selectAll('circle')
        .data(c && visible ? [proj(c)!] : [])
        .join('circle')
        .attr('class', 'krmark')
        .attr('cx', (d) => d[0])
        .attr('cy', (d) => d[1])
        .attr('r', 13)
    } else {
      groups.mark.selectAll('*').remove()
    }
    // ── 순위 라벨 ── (지구본에선 뒷면 지역을 걸러낸다) 등수와 무관하게 전부 숫자로 그린다.
    // showNumbers 가 꺼져 있으면 빈 데이터로 join → 숫자·트로피가 같이 사라진다(색·발광은 유지).
    const lrot = proj.rotate()
    const labelData = !p.current.showNumbers
      ? []
      : level === 0
        ? st.current.labels.filter((l) => geoDistance(l.c, [-lrot[0], -lrot[1]]) < Math.PI / 2)
        : st.current.labels
    groups.labels
      .selectAll<SVGTextElement, RankLabel>('text.ranklab')
      // 1~3위는 트로피가 등수를 말해 주므로 숫자는 안 찍는다(겹치기만 한다).
      .data(
        labelData.filter((d) => d.rank > 3),
        (d) => d.key,
      )
      .join('text')
      .attr('class', 'ranklab')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.32em')
      .attr('x', (d) => proj(d.c)?.[0] ?? -9999)
      .attr('y', (d) => proj(d.c)?.[1] ?? -9999)
      .text((d) => d.rank)
    // 1~3위 입체 트로피. 크기·위치는 sizeLabels 가 지도 배율에 맞춰 잡는다.
    groups.labels
      .selectAll<SVGImageElement, RankLabel>('image.rankobj')
      .data(
        labelData.filter((d) => d.rank <= 3),
        (d) => d.key,
      )
      .join('image')
      .attr('class', 'rankobj')
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .attr('href', (d) => `/rank-${d.rank}.png`) // 1=골드 2=블루 3=청록
    sizeLabels(path)
  }, [graticule, sizeLabels])

  const startSpin = useCallback(() => {
    stopSpin()
    let last = 0
    st.current.spin = d3Timer((elapsed) => {
      const dt = elapsed - last
      last = elapsed
      st.current.rot[0] += dt * SPIN_SPEED
      st.current.proj?.rotate(st.current.rot)
      fn.current.paint()
    })
  }, [stopSpin])

  // ── 회전 애니메이션(국가 클릭 → 그 국가를 정면으로) ──
  const rotateTo = useCallback(
    (f: GeoFeature, done?: () => void) => {
      stopSpin()
      st.current.anim?.stop()
      const c = geoCentroid(f)
      const from = st.current.rot.slice() as [number, number, number]
      let dLon = -c[0] - from[0]
      while (dLon > 180) dLon -= 360
      while (dLon < -180) dLon += 360
      const dLat = -c[1] - from[1]
      const dur = 820
      const tm = d3Timer((elapsed) => {
        const t = Math.min(1, elapsed / dur)
        const k = easeCubicInOut(t)
        st.current.rot = [from[0] + dLon * k, from[1] + dLat * k, 0]
        st.current.proj?.rotate(st.current.rot)
        fn.current.paint()
        if (t >= 1) {
          tm.stop()
          st.current.anim = null
          done?.()
        }
      })
      st.current.anim = tm
    },
    [stopSpin],
  )

  const resetView = useCallback(() => {
    st.current.globeK = 1
    st.current.vk = 1
    g.current?.viewport.attr('transform', null)
    const node = svgRef.current as (SVGSVGElement & { __zoom?: unknown }) | null
    if (node) node.__zoom = zoomIdentity
  }, [])

  // ── 레벨 전환 연출: 페이드아웃 → 상태 변경(mut) → 다음 draw 에서 페이드인 ──
  const fadeTo = useCallback(
    (mut: () => void) => {
      const node = svgRef.current
      if (!node) {
        mut()
        return
      }
      const svg = select(node)
      svg
        .interrupt()
        .style('transform-origin', '50% 50%')
        .transition()
        .duration(420)
        .ease(easeCubicIn)
        .style('opacity', '0')
        .style('transform', 'scale(1.16)')
        .on('end', () => {
          st.current.pendingFadeIn = true
          resetView()
          mut()
          // mut 이 리렌더를 못 일으키는 예외 상황에서도 지도가 투명한 채 남지 않도록 보정.
          window.clearTimeout(st.current.fadeGuard)
          st.current.fadeGuard = window.setTimeout(() => {
            if (st.current.pendingFadeIn) fn.current.draw()
          }, 800)
        })
    },
    [resetView],
  )

  // ── 클릭 처리: 지도/사이드 목록 공통 경로 ──
  const activate = useCallback(
    (d: Region) => {
      const { level, onSelect, onDrill } = p.current
      if (level === 0) {
        onSelect(d.key)
        if (d.drill) rotateTo(d.f, () => fadeTo(() => onDrill(d)))
        else rotateTo(d.f)
      } else {
        // 1차 행정구역이 마지막 단계 — 선택만 한다. 예전엔 재클릭으로 시군구에 들어갔는데,
        // 시군구를 걷어낸 뒤로는 같은 레벨로 되돌아와 페이드만 도는 헛동작이었다.
        onSelect(d.key)
      }
    },
    [fadeTo, rotateTo],
  )

  // ── 레벨/구역이 바뀔 때의 전체 갱신 ──
  const draw = useCallback(() => {
    const groups = g.current
    if (!groups || !svgRef.current) return
    const { regions, level, selKey, spinLocked } = p.current
    if (!regions.length) return

    // 평면 레벨에서 확대해 둔 채 breadcrumb 로 지구본에 돌아오면 viewport transform 이 남는다 → 정리.
    if (level === 0 && st.current.vk !== 1) resetView()

    st.current.proj = makeProjection(regions, level)
    // 전 지역에 등수를 매긴다(예전엔 상위 60개만). 땅이 좁아 안 들어가는 라벨은 sizeLabels 가 숨기고,
    // 확대하면 다시 나타난다.
    st.current.labels = [...regions]
      .sort((a, b) => b.score - a.score)
      .map((r, i) => {
        // 구면 중심이 아니라 '본체 안쪽' 점에 찍는다 — 섬에 끌려 바다로 나가거나(프랑스·인천)
        // 오목한 모양에서 땅 밖으로 나가는(베트남·크로아티아) 것을 막는다. → lib/arena/labelPoint
        const { point, part } = labelAnchor(r.f)
        return { rank: i + 1, c: point, key: r.key, area: geoArea(part), f: part }
      })
    // 등수 역인덱스 — 색칠할 때 매번 다시 정렬하지 않도록 여기서 한 번만 만든다.
    st.current.rankOf = new Map(st.current.labels.map((l) => [l.key, l.rank]))

    const sel = groups.geo.selectAll<SVGPathElement, Region>('path').data(regions, (d) => d.key)
    sel.exit().remove()
    sel
      .enter()
      .append('path')
      .attr('class', 'geo')
      .on('pointermove', function (event: PointerEvent, d: Region) {
        p.current.onHover({ region: d, x: event.clientX, y: event.clientY })
      })
      .on('pointerleave', () => p.current.onHover(null))
      .on('click', (_event: PointerEvent, d: Region) => fn.current.activate(d))
      .merge(sel)
      .classed('dim', (d) => !d.drill && level === 0)
      .classed('sel', (d) => d.key === selKey)
      // 1~3위만 시상대 별색(발광은 CSS 가 data-podium 으로 얹는다), 나머지는 부모가 준 백분위 램프
      .attr('data-podium', (d) => {
        const rank = st.current.rankOf.get(d.key) ?? 99
        return rank <= 3 ? rank : null
      })
      // 4~10위 표식 — 테두리를 메달보다 약하게 주기 위한 훅(CSS)
      .attr('data-tier', (d) => {
        const rank = st.current.rankOf.get(d.key) ?? Infinity
        return level === 0 && rank > 3 && rank <= TOP10_CUT ? 'top10' : null
      })
      // 1~3위=시상대 그라디언트 · 4~10위=한 색으로 묶은 상위권 · 그 아래=백분위 램프.
      // ⚠️ 4~10위 묶음은 **지구본(레벨0)에서만**. 시도는 17개뿐이라 상위 10개를 한 색으로 칠하면
      //    지도의 절반 이상이 같은 색이 되어 오히려 순위가 안 읽힌다.
      .attr('fill', (d) => {
        const rank = st.current.rankOf.get(d.key) ?? Infinity
        if (rank <= 3) return `url(#medalGrad${rank})`
        if (level === 0 && rank <= TOP10_CUT) return 'url(#tierGrad)'
        return p.current.color(d.score)
      })

    paint()

    if (level === 0 && !reduceMotion && !spinLocked) startSpin()
    else stopSpin()

    if (st.current.pendingFadeIn) {
      st.current.pendingFadeIn = false
      window.clearTimeout(st.current.fadeGuard)
      select(svgRef.current)
        .interrupt()
        .style('opacity', '0')
        .style('transform', 'scale(0.9)')
        .transition()
        .duration(620)
        .ease(easeCubicOut)
        .style('opacity', '1')
        .style('transform', 'scale(1)')
    }
  }, [makeProjection, paint, reduceMotion, resetView, startSpin, stopSpin])

  useLayoutEffect(() => {
    fn.current = {
      paint,
      draw,
      activate,
      // 줌 tick 전용 — 지오메트리는 viewport transform 이 처리하므로 글자 크기만 다시 잡는다.
      resizeLabels: () => {
        if (st.current.proj) sizeLabels(geoPath(st.current.proj))
      },
    }
  })

  // ── 마운트: SVG 뼈대(그라디언트·그룹) + 줌/팬 + 리사이즈 관측 ──
  useEffect(() => {
    const node = svgRef.current
    if (!node) return
    const svg = select(node)

    const defs = svg.append('defs')
    const ocean = defs.append('radialGradient').attr('id', 'oceanGrad').attr('cx', '0.36').attr('cy', '0.30').attr('r', '0.74')
    ocean.append('stop').attr('class', 'g-hi').attr('offset', '0%')
    ocean.append('stop').attr('class', 'g-mid').attr('offset', '56%')
    ocean.append('stop').attr('class', 'g-lo').attr('offset', '100%')
    const atmoGrad = defs.append('radialGradient').attr('id', 'atmoGrad').attr('cx', '0.5').attr('cy', '0.5').attr('r', '0.5')
    atmoGrad.append('stop').attr('class', 'a-in').attr('offset', '74%')
    atmoGrad.append('stop').attr('class', 'a-out').attr('offset', '100%')
    const specGrad = defs.append('radialGradient').attr('id', 'specGrad').attr('cx', '0.5').attr('cy', '0.5').attr('r', '0.5')
    specGrad.append('stop').attr('class', 's-in').attr('offset', '0%')
    specGrad.append('stop').attr('class', 's-out').attr('offset', '100%')
    const shadow = defs
      .append('filter')
      .attr('id', 'globeShadow')
      .attr('x', '-40%')
      .attr('y', '-40%')
      .attr('width', '180%')
      .attr('height', '180%')
    shadow
      .append('feDropShadow')
      .attr('dx', 0)
      .attr('dy', 12)
      .attr('stdDeviation', 16)
      .attr('flood-color', '#33456b')
      .attr('flood-opacity', 0.3)

    // 시상대 면의 미세 입자감 — 벡터 채우기는 픽셀 단위로 완벽하게 균일해서 "인쇄물 같은" 단색으로
    // 보인다. 레퍼런스는 렌더 결과물이라 아주 옅은 얼룩이 있고, 그게 눈에 진짜로 읽힌다.
    // 그래서 노이즈를 만들어 **면 안쪽에만**(operator="in") 가둔 뒤 overlay 로 섞는다.
    // ⚠️ 세게 주면 지저분해진다 — 거의 안 보일 정도가 정답이라 slope 는 낮게 유지할 것.
    const grain = defs
      .append('filter')
      .attr('id', 'medalGrain')
      .attr('x', '-2%')
      .attr('y', '-2%')
      .attr('width', '104%')
      .attr('height', '104%')
    grain
      .append('feTurbulence')
      .attr('type', 'fractalNoise')
      .attr('baseFrequency', '0.5')
      .attr('numOctaves', 3)
      .attr('seed', 7)
      .attr('result', 'n')
    grain.append('feColorMatrix').attr('in', 'n').attr('type', 'saturate').attr('values', 0).attr('result', 'm')
    grain
      .append('feComponentTransfer')
      .attr('in', 'm')
      .attr('result', 'g')
      .append('feFuncA')
      .attr('type', 'linear')
      .attr('slope', 0.22)
      .attr('intercept', 0)
    grain.append('feComposite').attr('in', 'g').attr('in2', 'SourceGraphic').attr('operator', 'in').attr('result', 'gi')
    grain.append('feBlend').attr('in', 'SourceGraphic').attr('in2', 'gi').attr('mode', 'overlay')

    // 시상대(1~3위) 면 — 가운데가 살짝 밝고 바깥으로 완만하게 내려앉는다.
    // ⚠️ 중간 스톱을 둬서 falloff 를 뒤쪽으로 미룬다: 안쪽 절반은 거의 같은 밝기로 넓게 두고
    //    가장자리 근처에서만 떨어뜨리는 것. 이게 없으면 중심부터 바로 어두워져 볼록한 돔
    //    (= 플라스틱 단추)처럼 보인다. 두 색 자체도 명도 차가 좁아야 '약하게 퍼지는' 느낌이 산다.
    // 4~10위(TOP10_TONE)도 같은 그라디언트를 태워 한 식구로 보이게 한다 — 마지막 id 가 tierGrad.
    const gradTones: Array<[readonly [string, string], string]> = [
      ...MEDAL_TONE.map((t, i) => [t, `medalGrad${i + 1}`] as [readonly [string, string], string]),
      [TOP10_TONE, 'tierGrad'],
    ]
    gradTones.forEach(([[lit, shade], id]) => {
      const grad = defs.append('radialGradient').attr('id', id).attr('cx', '0.5').attr('cy', '0.45').attr('r', '0.78')
      grad.append('stop').attr('offset', '0%').attr('stop-color', lit)
      grad.append('stop').attr('offset', '28%').attr('stop-color', lit)
      grad.append('stop').attr('offset', '100%').attr('stop-color', shade)
    })

    // 평면 레벨의 팬/줌은 viewport 그룹에 transform 을 걸어 처리한다.
    // 평면 레벨(1·2)의 어두운 바탕. **viewport 밖**에 둔다 — 안에 넣으면 팬·줌 transform 을 같이
    // 받아 배경이 따라 움직이고 가장자리가 비어 버린다. 지구본(레벨0)은 자기 구체가 있어 쓰지 않는다.
    const backdrop = svg.append('g').attr('class', 'mapbg')
    const viewport = svg.append('g').attr('class', 'viewport')
    const groups = {
      backdrop,
      viewport,
      atmo: viewport.append('g'),
      sphere: viewport.append('g'),
      spec: viewport.append('g'),
      grat: viewport.append('g'),
      geo: viewport.append('g'),
      glow: viewport.append('g').attr('class', 'medalglow'),
      mark: viewport.append('g'),
      labels: viewport.append('g').attr('class', 'ranklabs'),
      zoom: null as unknown as ZoomBehavior<SVGSVGElement, unknown>,
    }

    let zStart: { k: number; x: number; y: number; rot: [number, number, number] } | null = null
    const zoomBehavior = d3Zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.4, 8])
      .on('start', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        if (p.current.level === 0) {
          stopSpin()
          const t = event.transform
          zStart = { k: t.k, x: t.x, y: t.y, rot: st.current.rot.slice() as [number, number, number] }
        }
        svg.classed('dragging', true)
      })
      .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        const t = event.transform
        if (p.current.level === 0) {
          // 배율이 그대로면 드래그 = 회전, 배율이 변하면 = 확대/축소.
          if (zStart && Math.abs(t.k - zStart.k) < 1e-3) {
            st.current.rot[0] = zStart.rot[0] + ((t.x - zStart.x) * 0.32) / t.k
            st.current.rot[1] = clamp(zStart.rot[1] - ((t.y - zStart.y) * 0.32) / t.k, -85, 85)
          }
          st.current.globeK = clamp(t.k, 0.4, 8)
          st.current.proj?.scale(st.current.baseScale0 * st.current.globeK).rotate(st.current.rot)
          fn.current.paint()
        } else {
          st.current.vk = t.k
          viewport.attr('transform', t.toString())
          fn.current.resizeLabels()
        }
      })
      .on('end', () => {
        svg.classed('dragging', false)
        zStart = null
        if (p.current.level === 0 && !reduceMotion && !p.current.spinLocked) startSpin()
      })

    groups.zoom = zoomBehavior
    svg.call(zoomBehavior).on('dblclick.zoom', null)
    g.current = groups

    // 크기 동기화 — flex 로 늘어나는 요소라 window resize 보다 ResizeObserver 가 정확하다.
    const syncSize = () => {
      const r = node.getBoundingClientRect()
      st.current.W = r.width
      st.current.H = Math.max(420, r.height)
      svg.attr('viewBox', `0 0 ${st.current.W} ${st.current.H}`).attr('width', st.current.W).attr('height', st.current.H)
      // 지역 목록이 비어 있으면 투영을 다시 만들지 않는다(빈 데이터에 맞추면 배율이 깨진다).
      if (st.current.proj && p.current.regions.length) {
        st.current.proj = makeProjection(p.current.regions, p.current.level)
        fn.current.paint()
      }
    }
    syncSize()
    const ro = new ResizeObserver(syncSize)
    ro.observe(node)

    fn.current.draw()

    const state = st.current // 정리 시점에 ref 를 다시 읽지 않도록 캡처(항상 같은 객체)
    return () => {
      ro.disconnect()
      stopSpin()
      state.anim?.stop()
      window.clearTimeout(state.fadeGuard)
      svg.selectAll('*').remove()
      g.current = null
    }
    // 마운트 1회만 — 이후 갱신은 아래 draw 이펙트가 담당한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 구역/레벨이 바뀌면 전체 갱신
  useEffect(() => {
    fn.current.draw()
  }, [props.regions, props.level, draw])

  // 숫자 on/off 는 지오메트리와 무관 → 다시 칠하기만(라벨 join 이 붙었다 떨어진다)
  useEffect(() => {
    fn.current.paint()
  }, [props.showNumbers])

  // 홈 국가가 정해지면 지구본을 그쪽으로(첫 확정은 즉시 정렬, 이후 변경은 회전 연출)
  useEffect(() => {
    if (!props.spinLocked || props.level !== 0 || !props.regions.length) return
    const homeR = props.regions.find((r) => M49_TO_ISO2[String(r.f.id)] === props.home)
    if (!homeR) return
    if (!st.current.centered) {
      st.current.centered = true
      const c = geoCentroid(homeR.f)
      st.current.rot = [-c[0], -c[1], 0]
      st.current.proj?.rotate(st.current.rot)
      stopSpin()
      paint()
    } else {
      rotateTo(homeR.f)
    }
  }, [props.home, props.spinLocked, props.level, props.regions, paint, rotateTo, stopSpin])

  // 선택/강조 표시만 갱신(다시 그리지 않는다)
  useEffect(() => {
    g.current?.geo
      .selectAll<SVGPathElement, Region>('path')
      .classed('sel', (d) => d.key === props.selKey)
      .classed('hot', (d) => d.key === props.hotKey)
  }, [props.selKey, props.hotKey, props.regions])

  useImperativeHandle(
    ref,
    () => ({
      activate: (r: Region) => fn.current.activate(r),
      zoomIn: () => {
        const node = svgRef.current
        if (node && g.current) g.current.zoom.scaleBy(select(node).transition().duration(180), 1.6)
      },
      zoomOut: () => {
        const node = svgRef.current
        if (node && g.current) g.current.zoom.scaleBy(select(node).transition().duration(180), 1 / 1.6)
      },
      zoomReset: () => {
        const node = svgRef.current as (SVGSVGElement & { __zoom?: unknown }) | null
        if (!node || !g.current) return
        if (p.current.level === 0) {
          st.current.globeK = 1
          node.__zoom = zoomIdentity
          st.current.proj?.scale(st.current.baseScale0).rotate(st.current.rot)
          paint()
        } else {
          g.current.zoom.transform(select(node).transition().duration(220), zoomIdentity)
        }
      },
    }),
    [paint],
  )

  return <svg ref={svgRef} id="arena-map" role="img" aria-label="region average level map" />
}

export const ArenaMap = forwardRef<ArenaMapHandle, Props>(ArenaMapInner)

/**
 * 독도 확대도 — 간소화된 행정경계 데이터엔 독도가 없어서 코너 액자로 따로 그린다.
 * 색은 소속 지역(경북/울릉군)과 같게 맞춘다.
 */
export function DokdoInset({ fill, label }: { fill: string; label: string }) {
  const paths = useMemo(() => {
    const proj = geoMercator().fitExtent(
      [
        [30, 18],
        [90, 56],
      ],
      DOKDO_GEO,
    )
    const path = geoPath(proj)
    return DOKDO_GEO.coordinates.map((poly) => path({ type: 'Polygon', coordinates: poly }) ?? '')
  }, [])
  return (
    <div className="dokinset" role="img" aria-label={label}>
      <svg viewBox="0 0 120 88" preserveAspectRatio="xMidYMid meet">
        {paths.map((d, i) => (
          <path key={i} className="dokisland" d={d} fill={fill} />
        ))}
      </svg>
      <span className="doklab">{label}</span>
    </div>
  )
}
