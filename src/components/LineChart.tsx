import { useEffect, useRef, useState } from 'react'

interface Point {
  v: number
  t: number // 그 점의 시각(ms) — x 위치는 이 값으로 정해진다
  date?: string // hover 툴팁에 표시할 날짜
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
}: {
  data: Point[]
  from: number
  to: number
  ticks?: AxisTick[]
  emptyText?: string
  height?: number // 카드 폭이 넓은 화면(학습 대시보드)에서 높이를 키우려고 뺀 값
}) {
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

  const vals = data.map((d) => d.v)
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const pad = Math.max((hi - lo) * 0.14, 40)
  const min = lo - pad
  const max = hi + pad
  const span = max - min || 1
  const y = (v: number) => pt2 + ih * (1 - (v - min) / span)

  const pts = data.map((d) => [x(d.t), y(d.v)] as const)
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  const area =
    `M${pts[0][0].toFixed(1)} ${pt2 + ih} ` +
    pts.map((p) => 'L' + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ') +
    ` L${pts[pts.length - 1][0].toFixed(1)} ${pt2 + ih} Z`
  const last = data[data.length - 1]
  const lastX = x(last.t)
  // 마지막 값 라벨 — 오른쪽 끝에 붙은 점이면 점 왼쪽에 놓아 겹치지 않게.
  const nearRight = lastX > W - pr - 60

  return (
    <div ref={wrapRef} style={{ position: 'relative' }} onMouseLeave={() => setTip(null)}>
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
        <text
          x={(nearRight ? lastX - 9 : lastX + 9).toFixed(1)}
          y={(y(last.v) - 12).toFixed(1)}
          fontSize={15}
          fontWeight={800}
          fill="var(--ink)"
          textAnchor={nearRight ? 'end' : 'start'}
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
