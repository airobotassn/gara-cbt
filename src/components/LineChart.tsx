import { useEffect, useRef, useState } from 'react'

interface Point {
  v: number
  t: number // 그 점의 시각(ms) — x 위치는 이 값으로 정해진다
  date?: string // hover 툴팁에 표시할 날짜
  /** 툴팁 꼬리에 덧붙일 한 줄(랭킹 추이의 '그날 점수' 처럼 선에는 안 그리는 값). */
  note?: string
}

export interface AxisTick {
  t: number // 눈금 시각(ms)
  label: string
}

/**
 * 미니 라인차트(SVG) — **시간축**이다(주식 차트처럼).
 * x 는 점의 개수가 아니라 `from`~`to` 구간에서의 실제 시각 위치로 정해진다.
 * 그래서 기간을 3개월로 넓히면 점 사이가 실제 간격만큼 벌어지고, 응시가 없던 구간은 빈 채로 남는다.
 * 컨테이너 폭을 재서 viewBox 를 실제 px 와 1:1 로 맞춘다 → 축·값 글자 크기가 화면에서 항상 일정.
 */
export default function LineChart({
  data,
  from,
  to,
  ticks = [],
  emptyText,
  height = 210,
  invert = false,
  format,
  padMin = 40,
}: {
  data: Point[]
  from: number
  to: number
  ticks?: AxisTick[]
  emptyText?: string
  height?: number // 카드 폭이 넓은 화면에서 높이를 키우려고 뺀 값
  /**
   * 값이 **작을수록 위**로 간다. 순위 추이(1위가 제일 잘한 것)를 그릴 때 켠다.
   * ⚠️ 안 켜면 순위가 올랐는데 선이 아래로 처져서 "잘하고 있다"가 거꾸로 읽힌다.
   */
  invert?: boolean
  /** 값 표기(마지막 라벨·툴팁). 기본은 천단위 콤마. 순위면 `1,204위` 처럼 단위를 붙인다. */
  format?: (v: number) => string
  /** 세로 여유의 하한. 값이 거의 안 변할 때 선이 자로 그은 듯 납작해지는 걸 막는다. */
  padMin?: number
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(340)
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  // 촘촘한 그래프에서 짚고 있는 점 — 그 자리에만 동그라미를 그린다.
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => setW(el.clientWidth || 340)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const W = Math.max(260, w)
  const H = height
  const pl = 10
  const pr = 14
  const pt2 = 24
  const pb = 32
  const iw = W - pl - pr
  const ih = H - pt2 - pb
  const tspan = Math.max(1, to - from)
  const x = (t: number) => pl + iw * Math.min(1, Math.max(0, (t - from) / tspan))

  // 축(가로 격자 + 기간 눈금)은 데이터가 없어도 그린다 — 고른 기간이 그대로 보여야 하므로.
  const axis = (
    <>
      {[0, 1, 2, 3].map((g) => {
        const yy = pt2 + (ih * g) / 3
        return <line key={`h${g}`} x1={pl} y1={yy} x2={W - pr} y2={yy} stroke="var(--line)" />
      })}
      {ticks.map((tk, i) => (
        <line key={`v${i}`} x1={x(tk.t)} y1={pt2} x2={x(tk.t)} y2={pt2 + ih} stroke="var(--line)" strokeDasharray="3 4" />
      ))}
      {ticks.map((tk, i) => {
        const tx = x(tk.t)
        const anchor = tx < pl + 18 ? 'start' : tx > W - pr - 18 ? 'end' : 'middle'
        return (
          <text key={`l${i}`} x={tx.toFixed(1)} y={H - 9} fontSize={13} fontWeight={600} fill="var(--muted)" textAnchor={anchor}>
            {tk.label}
          </text>
        )
      })}
    </>
  )

  if (data.length === 0) {
    return (
      <div ref={wrapRef} style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ width: '100%', height: H, display: 'block' }}>
          {axis}
          <text x={W / 2} y={pt2 + ih / 2} fontSize={13} fill="var(--dim)" textAnchor="middle">
            {emptyText ?? '아직 표시할 추이가 없어요.'}
          </text>
        </svg>
      </div>
    )
  }

  const fmt = format ?? ((v: number) => v.toLocaleString())
  const vals = data.map((d) => d.v)
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const pad = Math.max((hi - lo) * 0.14, padMin)
  const min = lo - pad
  const max = hi + pad
  const span = max - min || 1
  // invert = 값이 작을수록 위. 순위(1위가 최고)를 그릴 때 쓴다.
  const y = (v: number) => pt2 + ih * (invert ? (v - min) / span : 1 - (v - min) / span)

  const pts = data.map((d) => [x(d.t), y(d.v)] as const)
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  const area =
    `M${pts[0][0].toFixed(1)} ${pt2 + ih} ` +
    pts.map((p) => 'L' + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ') +
    ` L${pts[pts.length - 1][0].toFixed(1)} ${pt2 + ih} Z`
  // 점이 촘촘한지 — 하루 한 점짜리 긴 기간(랭킹 추이 3개월·시즌)이 여기 해당한다.
  const dense = data.length > 45
  const band = Math.max(4, iw / Math.max(1, data.length - 1))
  const showTip = (i: number) => {
    setHover(i)
    const el = wrapRef.current
    if (!el) return
    const box = el.getBoundingClientRect()
    setTip({
      x: box.left + (pts[i][0] / W) * box.width,
      y: box.top + (pts[i][1] / H) * box.height,
      text: `${data[i].date ?? ''} · ${fmt(data[i].v)}${data[i].note ? ` · ${data[i].note}` : ''}`,
    })
  }

  const last = data[data.length - 1]
  const lastX = x(last.t)
  // 마지막 값 라벨 — 오른쪽 끝에 붙은 점이면 점 왼쪽에 놓아 겹치지 않게.
  const nearRight = lastX > W - pr - 60

  return (
    <div ref={wrapRef} style={{ position: 'relative' }} onMouseLeave={() => { setTip(null); setHover(null) }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ width: '100%', height: H, display: 'block' }}>
        <defs>
          <linearGradient id="ga" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.2" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {axis}
        {data.length > 1 ? (
          <>
            <path d={area} fill="url(#ga)" />
            <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          </>
        ) : null}
        {/* ⚠️ 점이 많으면(하루 한 점 × 180일) 동그라미를 다 그리면 선이 **점선 애벌레**가 되어
            추세가 안 읽힌다. 촘촘할 땐 마지막 점만 남기고, 짚어보는 건 투명한 세로 띠가 받는다. */}
        {pts.map((p, i) => {
          const isLast = i === data.length - 1
          if (dense && !isLast && i !== hover) return null
          return (
            <circle
              key={i}
              cx={p[0].toFixed(1)}
              cy={p[1].toFixed(1)}
              r={isLast ? 5.5 : 4}
              fill="var(--accent)"
              stroke="var(--bg)"
              strokeWidth={2}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => showTip(i)}
            />
          )
        })}
        {/* 짚는 자리 — 눈에 안 보이는 세로 띠. 점을 정확히 겨냥하지 않아도 가까운 날이 잡힌다. */}
        {dense
          ? pts.map((p, i) => (
              <rect
                key={`h${i}`}
                x={(p[0] - band / 2).toFixed(1)}
                y={pt2}
                width={band.toFixed(1)}
                height={ih}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => showTip(i)}
              />
            ))
          : null}
        <text
          x={(nearRight ? lastX - 9 : lastX + 9).toFixed(1)}
          y={(y(last.v) - 12).toFixed(1)}
          fontSize={15}
          fontWeight={800}
          fill="var(--ink)"
          textAnchor={nearRight ? 'end' : 'start'}
        >
          {fmt(last.v)}
        </text>
      </svg>
      {tip ? (
        <div className="cal-tip" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </div>
      ) : null}
    </div>
  )
}
