// 월드 아레나 지도 — 지구본(레벨0) → 대한민국 시도(레벨1) → 시군구(레벨2) 드릴다운.
//
// 역할 분담: **React 가 상태(level·curProv·selKey·검색어)를 소유**하고, 이 컴포넌트는 그 상태를 받아
// SVG 만 그린다(제어 컴포넌트). d3 는 여기 안에서만 명령형으로 돌고, 사용자의 지도 조작은
// onSelect/onDrill/onPrompt 콜백으로 위에 올려보낸다.
//   · 레벨0: 정사영(지구본) — 드래그=회전, 자동 회전(홈 국가 확정 전까지), 휠/핀치=배율
//   · 레벨1·2: 메르카토르 평면 — 드래그=이동, 휠/핀치=배율
//   · 레벨 전환은 fadeTo() 가 페이드아웃 → 상태 변경 → 페이드인 순으로 감싼다(팍 넘어가지 않게).
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react'
import { select, type Selection } from 'd3-selection'
import {
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
import { cscale, type ArenaLevel, type GeoFeature, type Region } from '../lib/arena/data'
import { DOKDO_GEO, M49_TO_ISO2 } from '../lib/arena/tables'

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
  onPrompt(name: string): void
  onHover(info: HoverInfo | null): void
}

const SPIN_SPEED = 0.012 // deg/ms
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

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
  })

  const g = useRef<{
    viewport: Selection<SVGGElement, unknown, null, undefined>
    atmo: Selection<SVGGElement, unknown, null, undefined>
    sphere: Selection<SVGGElement, unknown, null, undefined>
    spec: Selection<SVGGElement, unknown, null, undefined>
    grat: Selection<SVGGElement, unknown, null, undefined>
    geo: Selection<SVGGElement, unknown, null, undefined>
    mark: Selection<SVGGElement, unknown, null, undefined>
    zoom: ZoomBehavior<SVGSVGElement, unknown>
  } | null>(null)

  const graticule = useMemo(() => geoGraticule10(), [])

  // d3 이벤트 핸들러가 호출할 최신 함수들(핸들러는 마운트 때 한 번만 등록되므로 ref 로 우회).
  const fn = useRef<{ paint: () => void; draw: () => void; activate: (r: Region) => void }>({
    paint: () => {},
    draw: () => {},
    activate: () => {},
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
    return geoMercator().fitExtent(
      [
        [16, 16],
        [W - 16, H - 16],
      ],
      { type: 'FeatureCollection', features: regions.map((r) => r.f) } as never,
    )
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

    groups.geo.selectAll<SVGPathElement, Region>('path').attr('d', (d) => path(d.f))

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
  }, [graticule])

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
      const { level, selKey, onSelect, onDrill, onPrompt } = p.current
      if (level === 0) {
        onSelect(d.key)
        if (d.drill) rotateTo(d.f, () => fadeTo(() => onDrill(d)))
        else rotateTo(d.f)
      } else if (level === 1) {
        // 시도는 한 번 선택 → 다시 누르면 진입(오조작 방지). 안내는 onPrompt.
        if (selKey === d.key) fadeTo(() => onDrill(d))
        else {
          onSelect(d.key)
          onPrompt(d.name)
        }
      } else {
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

    st.current.proj = makeProjection(regions, level)

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
      .attr('fill', (d) => cscale(d.score))

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
  }, [makeProjection, paint, reduceMotion, startSpin, stopSpin])

  useLayoutEffect(() => {
    fn.current = { paint, draw, activate }
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

    // 평면 레벨의 팬/줌은 viewport 그룹에 transform 을 걸어 처리한다.
    const viewport = svg.append('g').attr('class', 'viewport')
    const groups = {
      viewport,
      atmo: viewport.append('g'),
      sphere: viewport.append('g'),
      spec: viewport.append('g'),
      grat: viewport.append('g'),
      geo: viewport.append('g'),
      mark: viewport.append('g'),
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
          viewport.attr('transform', t.toString())
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
      if (st.current.proj) {
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
