import { useEffect, useRef, useState } from 'react'

interface Point {
  v: number
  date?: string // hover 툴팁에 표시할 날짜
  tick?: string // x축에 표시할 라벨(월 경계 등). 없으면 라벨 없음
}

// 미니 라인차트(SVG). 컨테이너 폭을 측정해 viewBox 를 실제 px 와 1:1 로 맞춘다
// → SVG 가 스케일되지 않아 축/값 글자 크기가 화면에서 항상 일정(모바일에서도 또렷).
export default function LineChart({ data }: { data: Point[] }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(340)
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => setW(el.clientWidth || 340)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (data.length === 0) {
    return (
      <div ref={wrapRef} style={{ color: 'var(--dim)', fontSize: 13, padding: '20px 0' }}>
        아직 표시할 추이가 없어요.
      </div>
    )
  }
  const W = Math.max(260, w)
  const H = 210
  const pl = 10
  const pr = 14
  const pt2 = 24
  const pb = 32
  const iw = W - pl - pr
  const ih = H - pt2 - pb
  const vals = data.map((d) => d.v)
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const pad = Math.max((hi - lo) * 0.14, 40)
  const min = lo - pad
  const max = hi + pad
  const span = max - min || 1
  const x = (i: number) =>
    data.length === 1 ? pl + iw / 2 : pl + (iw * i) / (data.length - 1)
  const y = (v: number) => pt2 + ih * (1 - (v - min) / span)

  const pts = data.map((d, i) => [x(i), y(d.v)] as const)
  const line = pts
    .map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1))
    .join(' ')
  const area =
    `M${pl} ${pt2 + ih} ` +
    pts.map((p) => 'L' + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ') +
    ` L${W - pr} ${pt2 + ih} Z`
  const last = data[data.length - 1]

  return (
    <div ref={wrapRef} style={{ position: 'relative' }} onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ width: '100%', height: H, display: 'block' }}>
        <defs>
          <linearGradient id="ga" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.2" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((g) => {
          const yy = pt2 + (ih * g) / 3
          return <line key={g} x1={pl} y1={yy} x2={W - pr} y2={yy} stroke="var(--line)" />
        })}
        {data.length > 1 ? (
          <>
            <path d={area} fill="url(#ga)" />
            <path
              d={line}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : null}
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={p[0].toFixed(1)}
            cy={p[1].toFixed(1)}
            r={i === data.length - 1 ? 5.5 : 4}
            fill="var(--accent)"
            stroke="var(--bg)"
            strokeWidth={2}
            style={{ cursor: 'pointer' }}
            onMouseEnter={(e) => {
              const r = (e.target as SVGElement).getBoundingClientRect()
              setTip({
                x: r.left + r.width / 2,
                y: r.top,
                text: `${data[i].date ?? ''} · ${data[i].v.toLocaleString()}`,
              })
            }}
          />
        ))}
        {data.map((d, i) =>
          d.tick ? (
            <text
              key={i}
              x={x(i).toFixed(1)}
              y={H - 9}
              fontSize={13}
              fontWeight={600}
              fill="var(--muted)"
              textAnchor="middle"
            >
              {d.tick}
            </text>
          ) : null,
        )}
        <text
          x={x(data.length - 1).toFixed(1)}
          y={(y(last.v) - 12).toFixed(1)}
          fontSize={15}
          fontWeight={800}
          fill="var(--ink)"
          textAnchor="end"
        >
          {last.v.toLocaleString()}
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
