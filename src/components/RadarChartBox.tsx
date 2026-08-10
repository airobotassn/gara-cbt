import { useEffect, useState } from 'react'
import type { AxisDef } from '../lib/categories'
import type { AxisMap } from '../lib/scoring'

interface Props {
  axes: AxisDef[] // 그릴 축 세트(레벨별). 보통 6축, Lv.1 은 3축(삼각형). 2축 이하만 막대로 대체 렌더.
  rating: AxisMap // 내 누적 축별 (0~100), 키 = 축 코드
  ghost?: AxisMap | null // 점선 고스트(이전 내 레이팅)
  size?: number
  changes?: AxisMap | null // 축별 변동: 양수=상승(초록)/음수=하락(빨강), 있으면 prev→cur 모핑 애니
  maxWidth?: number // 렌더 폭 상한(px). viewBox 통째로 확대되므로 라벨·글자도 같이 커진다.
}

export default function RadarChartBox({ axes, rating, ghost, size = 110, changes, maxWidth = 360 }: Props) {
  const cx = 160
  const cy = 150
  const R = size
  const n = Math.max(3, axes.length)
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n
  const pt = (i: number, r: number): [number, number] => [
    cx + r * Math.cos(ang(i)),
    cy + r * Math.sin(ang(i)),
  ]
  // 선형 매핑: 점수만큼 그대로 반지름. (이전 √ 매핑은 낮은 점수가 부풀어 변화가 둔했음)
  const rOf = (v: number) => R * (Math.max(0, Math.min(100, v)) / 100)
  const cl = (x: number) => Math.max(0, Math.min(100, x))

  // 변동이 있으면 prev→cur 모핑(p: 0→1)
  const animate = !!changes
  const [p, setP] = useState(animate ? 0 : 1)
  useEffect(() => {
    if (!animate) return
    let raf = 0
    const dur = 1000
    const to = window.setTimeout(() => {
      const start = performance.now()
      const tick = (now: number) => {
        const tt = Math.min(1, (now - start) / dur)
        setP(1 - Math.pow(1 - tt, 3))
        if (tt < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }, 500)
    return () => {
      clearTimeout(to)
      cancelAnimationFrame(raf)
    }
  }, [animate])

  const curArr = axes.map((c) => cl(rating[c.key] ?? 0))
  const prevArr = axes.map((c, i) =>
    changes ? cl(curArr[i] - (changes[c.key] ?? 0)) : curArr[i],
  )
  const meArr = axes.map((_, i) => prevArr[i] + (curArr[i] - prevArr[i]) * p)

  const rings = [0.25, 0.5, 0.75, 1].map((f) =>
    axes.map((_, i) => pt(i, R * f).map((z) => z.toFixed(1)).join(',')).join(' '),
  )
  const polyPoints = (vals: number[]) =>
    vals.map((v, i) => pt(i, rOf(v)).map((z) => z.toFixed(1)).join(',')).join(' ')

  const avg = ghost ? axes.map((c) => ghost[c.key] ?? 0) : null

  // ── 2축 이하(Lv.1)는 다각형이 만들어지지 않는다(선으로 뭉개짐) → 가로 막대로 대체.
  //    색/점선 고스트/상승·하락 색은 레이더와 같은 클래스(.ring·.me·.avg)를 써서 톤을 맞춘다.
  if (axes.length < 3) {
    const X0 = 40
    const X1 = 280
    const W = X1 - X0
    const H = 26
    const rowY = axes.length === 1 ? [132] : [104, 186]
    return (
      <svg viewBox="0 0 320 290" style={{ width: '100%', maxWidth, display: 'block', margin: '0 auto' }}>
        {axes.map((c, i) => {
          const y = rowY[i] ?? 104 + i * 82
          const v = meArr[i]
          const d = changes ? (changes[c.key] ?? 0) : 0
          const gx = avg ? X0 + (W * cl(avg[i])) / 100 : null
          return (
            <g key={c.key}>
              <text className="axislabel" x={cx} y={y - 14}>{c.short}</text>
              <rect className="ring" x={X0} y={y} width={W} height={H} rx={H / 2} />
              <rect className="me" x={X0} y={y} width={Math.max(2, (W * cl(v)) / 100)} height={H} rx={H / 2} />
              {gx !== null && <line className="avg" x1={gx.toFixed(1)} y1={y - 4} x2={gx.toFixed(1)} y2={y + H + 4} fill="none" />}
              <text
                x={X1}
                y={y - 14}
                style={{ textAnchor: 'end', dominantBaseline: 'middle', fontSize: 'var(--fs-sm)', fontWeight: 700 }}
                fill={d > 0.5 ? 'rgb(34,197,94)' : d < -0.5 ? 'rgb(239,68,68)' : 'var(--blue)'}
              >
                {Math.round(v)}
                {d > 0.5 ? ` ▲${Math.round(d)}` : d < -0.5 ? ` ▼${Math.round(-d)}` : ''}
              </text>
            </g>
          )
        })}
      </svg>
    )
  }

  return (
    <svg
      viewBox="0 0 320 290"
      style={{ width: '100%', maxWidth, display: 'block', margin: '0 auto' }}
    >
      {rings.map((pts, i) => (
        <polygon key={i} className="ring" points={pts} />
      ))}
      {axes.map((c, i) => {
        const [x, y] = pt(i, R)
        const [lx, ly] = pt(i, R + 22)
        return (
          <g key={c.key}>
            <line className="spoke" x1={cx} y1={cy} x2={x.toFixed(1)} y2={y.toFixed(1)} />
            <text className="axislabel" x={lx.toFixed(1)} y={ly.toFixed(1)}>
              {c.short}
            </text>
          </g>
        )
      })}
      {avg ? <polygon className="avg" points={polyPoints(avg)} /> : null}
      <polygon className="me" points={polyPoints(meArr)} />
      {/* 변동 면: prev↔me(현재까지 보간) 사이를 영역별로 채움(상승=초록/하락=빨강) */}
      {changes
        ? axes.map((_, i) => {
            const ni = (i + 1) % n
            if (Math.abs(meArr[i] - prevArr[i]) < 0.3 && Math.abs(meArr[ni] - prevArr[ni]) < 0.3)
              return null
            const grew = curArr[i] + curArr[ni] >= prevArr[i] + prevArr[ni]
            const quad = [
              pt(i, rOf(prevArr[i])),
              pt(i, rOf(meArr[i])),
              pt(ni, rOf(meArr[ni])),
              pt(ni, rOf(prevArr[ni])),
            ]
              .map((q) => q.map((z) => z.toFixed(1)).join(','))
              .join(' ')
            return (
              <polygon
                key={`chg-${i}`}
                points={quad}
                fill={grew ? 'rgba(34,197,94,0.32)' : 'rgba(239,68,68,0.32)'}
                stroke={grew ? 'rgba(34,197,94,0.6)' : 'rgba(239,68,68,0.6)'}
                strokeWidth={0.8}
              />
            )
          })
        : null}
      {meArr.map((v, i) => {
        const [x, y] = pt(i, rOf(v))
        return <circle key={i} className="medot" cx={x.toFixed(1)} cy={y.toFixed(1)} r={3} />
      })}
    </svg>
  )
}
