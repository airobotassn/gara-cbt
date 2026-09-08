// DAILY QUIZ 해설 그림 — 배치 8 「눈으로 보는 AI를 만들고 채점하는 일」.
//
// ⚠️ 사진을 그리지 않는다. 사진을 다루는 개념이지만 우리 그림은 도형과 선이다 —
//    필터가 미끄러지며 특징 지도를 채우고, 상자가 겹치고, 격자가 펴지는 **동작**이 보여야 한다.
// ⚠️ 색은 daily.css 의 .vz-* 클래스로만 칠한다(선은 currentColor). #hex 를 박으면 한쪽 테마에서 증발한다.
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Frame, Box, Arrow, Lab, Chip } from './kit'

// ── 합성곱 신경망(CNN) ──────────────────────────────────────────────────────
// 필터를 밀면 특징 지도가 그만큼 채워진다. 값은 흉내가 아니라 진짜 3×3 합성곱을 돌린 결과라
// 필터를 바꾸면 세로줄만 남은 지도 / 가로줄만 남은 지도 / 윤곽만 남은 지도가 실제로 나온다.
const CNN_SRC: number[][] = [
  [0, 0, 0, 0, 0, 0],
  [0, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 0],
  [0, 0, 0, 0, 0, 0],
]

const CNN_KERNELS: { key: string; name: string; k: number[][] }[] = [
  { key: 'v', name: '세로선', k: [[1, 0, -1], [2, 0, -2], [1, 0, -1]] },
  { key: 'h', name: '가로선', k: [[1, 2, 1], [0, 0, 0], [-1, -2, -1]] },
  { key: 'o', name: '윤곽', k: [[0, -1, 0], [-1, 4, -1], [0, -1, 0]] },
]

function convAt(k: number[][], r: number, c: number): number {
  let s = 0
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s += k[i][j] * CNN_SRC[r + i][c + j]
  return s
}

function B8Cnn() {
  const [ki, setKi] = useState(0)
  const [pos, setPos] = useState(9) // 0..15 — 필터가 지금까지 훑은 자리
  const CELL = 17
  const IX = 22
  const IY = 34
  const FX = 218
  const FY = 51
  const kern = CNN_KERNELS[ki]
  const wr = Math.floor(pos / 4)
  const wc = pos % 4
  return (
    <Frame
      h={172}
      foot={
        <>
          {CNN_KERNELS.map((f, i) => (
            <Chip key={f.key} on={i === ki} onClick={() => setKi(i)}>{f.name}</Chip>
          ))}
          <input
            className="dy-viz-range"
            type="range"
            min={0}
            max={15}
            value={pos}
            onChange={(e) => setPos(Number(e.target.value))}
            aria-label="필터 위치"
          />
        </>
      }
    >
      {/* 입력 픽셀 — 가운데가 밝은 덩어리 하나. 경계가 어디인지가 전부다. */}
      {CNN_SRC.map((row, r) =>
        row.map((v, c) => (
          <rect
            key={`s${r}-${c}`}
            x={IX + c * CELL}
            y={IY + r * CELL}
            width={CELL}
            height={CELL}
            className={v ? 'vz-brand' : 'vz-mute'}
            stroke="currentColor"
            strokeWidth={1}
          />
        )),
      )}
      {/* 미끄러지는 창 — 이 자리 하나가 특징 지도의 칸 하나를 만든다 */}
      <rect
        x={IX + wc * CELL}
        y={IY + wr * CELL}
        width={CELL * 3}
        height={CELL * 3}
        fill="none"
        className="vz-goal"
        strokeWidth={3}
      />

      <Arrow x1={136} y1={85} x2={206} y2={85} />
      <Lab x={171} y={76} tone="hot">3×3 필터</Lab>
      <Lab x={171} y={104}>{kern.name}</Lab>

      {/* 특징 지도 — 지나간 자리만 채워진다(빈 칸 = 아직 안 훑음) */}
      {[0, 1, 2, 3].map((r) =>
        [0, 1, 2, 3].map((c) => {
          const idx = r * 4 + c
          const done = idx <= pos
          const on = done && Math.abs(convAt(kern.k, r, c)) >= 1
          return (
            <rect
              key={`f${r}-${c}`}
              x={FX + c * CELL}
              y={FY + r * CELL}
              width={CELL}
              height={CELL}
              className={!done ? 'vz-mute' : on ? 'vz-brand' : 'vz-card'}
              stroke="currentColor"
              strokeWidth={1}
            />
          )
        }),
      )}

      <Lab x={73} y={26}>입력 픽셀</Lab>
      <Lab x={252} y={43}>특징 지도</Lab>
      <Lab x={160} y={162}>필터 하나로 온 그림을 훑는다</Lab>
    </Frame>
  )
}

// ── 세그멘테이션 ────────────────────────────────────────────────────────────
// 같은 장면 세 판. 오른쪽으로 갈수록 아는 것이 촘촘해진다 — 이름표 → 상자 → 픽셀.
const SEG_BLOB: number[][] = [
  [0.24, 0.62], [0.3, 0.34], [0.5, 0.22], [0.72, 0.3], [0.78, 0.56], [0.62, 0.76], [0.36, 0.78],
]

function inPoly(px: number, py: number, poly: number[][]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0]
    const yi = poly[i][1]
    const xj = poly[j][0]
    const yj = poly[j][1]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const SEG_PANELS: { x: number; cap: string; note: string }[] = [
  { x: 12, cap: '분류', note: '무엇이 있나' },
  { x: 114, cap: '객체 탐지', note: '어디에 있나' },
  { x: 216, cap: '세그멘테이션', note: '어느 픽셀까지' },
]

function B8Seg() {
  const P = 92
  const PY = 30
  const pts = (x: number) => SEG_BLOB.map(([a, b]) => `${x + a * P},${PY + b * P}`).join(' ')
  return (
    <Frame h={168}>
      {SEG_PANELS.map((p, i) => (
        <g key={p.cap}>
          <Box x={p.x} y={PY} w={P} h={P} r={8} tone="mute" />
          {/* 세 번째 판만 픽셀로 칠한다 — 격자 칸의 중심이 도형 안이면 켠다(진짜 마스크) */}
          {i === 2 &&
            Array.from({ length: 100 }, (_, n) => {
              const cx = (n % 10) / 10 + 0.05
              const cy = Math.floor(n / 10) / 10 + 0.05
              if (!inPoly(cx, cy, SEG_BLOB)) return null
              return (
                <rect
                  key={n}
                  x={p.x + (cx - 0.05) * P}
                  y={PY + (cy - 0.05) * P}
                  width={P / 10}
                  height={P / 10}
                  className="vz-brand"
                />
              )
            })}
          <polygon
            points={pts(p.x)}
            fill="none"
            stroke="currentColor"
            strokeWidth={i === 0 ? 2 : 2.5}
            strokeLinejoin="round"
            opacity={i === 0 ? 0.35 : 1}
          />
          {/* 분류 = 위치를 모른다. 판 전체에 이름표 한 장만 붙는다. */}
          {i === 0 && (
            <>
              <rect x={p.x + 12} y={PY + 34} width={68} height={24} rx={8} className="vz-gold-f" stroke="currentColor" strokeWidth={3} />
              <Lab x={p.x + 46} y={PY + 50} size={11}>부품 있음</Lab>
            </>
          )}
          {/* 탐지 = 상자까지. 모양은 여전히 모른다. */}
          {i === 1 && (
            <rect
              x={p.x + 0.24 * P}
              y={PY + 0.22 * P}
              width={0.54 * P}
              height={0.56 * P}
              fill="none"
              className="vz-goal"
              strokeWidth={3}
            />
          )}
          <Lab x={p.x + P / 2} y={140} tone={i === 2 ? 'hot' : 'mute'} size={i === 2 ? 12 : 13}>{p.cap}</Lab>
          <Lab x={p.x + P / 2} y={157} size={11}>{p.note}</Lab>
        </g>
      ))}
    </Frame>
  )
}

// ── IoU ─────────────────────────────────────────────────────────────────────
// 예측 상자를 밀면 겹친 넓이와 합친 넓이가 같이 변한다. 숫자는 그 둘을 나눈 실제 값이다.
function B8Iou() {
  const [dx, setDx] = useState(30)
  const GX = 74
  const GY = 34
  const BW = 96
  const BH = 72
  const ov = Math.max(0, BW - dx)
  const inter = ov * BH
  const uni = 2 * BW * BH - inter
  const iou = inter / uni
  const hit = iou >= 0.5
  return (
    <Frame
      h={152}
      foot={
        <>
          <input
            className="dy-viz-range"
            type="range"
            min={0}
            max={92}
            value={dx}
            onChange={(e) => setDx(Number(e.target.value))}
            aria-label="예측 상자 위치"
          />
          <span className={`dy-viz-state ${hit ? '' : 'crack'}`}>{hit ? '탐지 성공' : '탐지 실패'}</span>
        </>
      }
    >
      {/* 합친 넓이 = 옅은 두 판 전체 */}
      <rect x={GX} y={GY} width={BW} height={BH} className="vz-mute" stroke="currentColor" strokeWidth={3} />
      <rect x={GX + dx} y={GY} width={BW} height={BH} className="vz-mute" fill="none" />
      {/* 겹친 넓이 = 진한 칸 */}
      {ov > 0 && <rect x={GX + dx} y={GY} width={ov} height={BH} className="vz-brand" />}
      <rect x={GX} y={GY} width={BW} height={BH} fill="none" stroke="currentColor" strokeWidth={3} />
      <rect x={GX + dx} y={GY} width={BW} height={BH} fill="none" className="vz-goal" strokeWidth={3} strokeDasharray="7 5" />

      <Lab x={GX + BW / 2} y={28}>정답 상자</Lab>
      <Lab x={GX + dx + BW / 2} y={124} tone="bad">예측 상자</Lab>
      <Lab x={160} y={144} tone="hot">{'겹친 넓이 ÷ 합친 넓이'} = {iou.toFixed(2)}</Lab>
    </Frame>
  )
}

// ── 혼동 행렬 ───────────────────────────────────────────────────────────────
// 대각선은 맞은 것, 나머지 두 칸은 둘 다 '틀림'인데 손해가 전혀 다르다 — 그게 이 표의 전부다.
const CM_CELLS: { r: number; c: number; t1: string; t2?: string; bad: boolean }[] = [
  { r: 0, c: 0, t1: '제대로 잡음', bad: false },
  { r: 0, c: 1, t1: '놓침', t2: '불량이 나간다', bad: true },
  { r: 1, c: 0, t1: '헛경보', t2: '멀쩡한 걸 버린다', bad: true },
  { r: 1, c: 1, t1: '그냥 통과', bad: false },
]

function B8Confusion() {
  const CX = 94
  const CY = 44
  const CW = 84
  const CH = 46
  return (
    <Frame h={168}>
      <Lab x={CX + CW / 2} y={36} size={11}>예측: 불량</Lab>
      <Lab x={CX + CW + CW / 2} y={36} size={11}>예측: 정상</Lab>
      <Lab x={90} y={CY + 26} anchor="end" size={11}>실제 불량</Lab>
      <Lab x={90} y={CY + CH + 26} anchor="end" size={11}>실제 정상</Lab>
      {CM_CELLS.map((m) => {
        const x = CX + m.c * CW
        const y = CY + m.r * CH
        return (
          <g key={`${m.r}${m.c}`}>
            <rect x={x} y={y} width={CW} height={CH} className={m.bad ? 'vz-target' : 'vz-mute'} stroke="currentColor" strokeWidth={3} />
            {/* 맞음 ✓ / 틀림 ✗ — 네 칸이 두 종류로 갈린다는 걸 글자 없이 먼저 보여 준다 */}
            {m.bad ? (
              <g className="vz-goal" strokeWidth={3} strokeLinecap="round">
                <line x1={x + CW - 20} y1={y + 9} x2={x + CW - 8} y2={y + 21} />
                <line x1={x + CW - 8} y1={y + 9} x2={x + CW - 20} y2={y + 21} />
              </g>
            ) : (
              <path
                d={`M${x + CW - 21} ${y + 15} l5 6 l10 -12`}
                fill="none"
                className="vz-arrow"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            <Lab x={x + CW / 2} y={y + (m.t2 ? 22 : 28)} tone={m.bad ? 'bad' : 'ok'} size={12}>{m.t1}</Lab>
            {m.t2 && <Lab x={x + CW / 2} y={y + 38} size={11}>{m.t2}</Lab>}
          </g>
        )
      })}
      <Lab x={160} y={156}>같은 틀림이라도 손해는 전혀 다르다</Lab>
    </Frame>
  )
}

// ── 데이터 증강 ─────────────────────────────────────────────────────────────
// 한 장에서 네 장이 나온다. 모양이 좌우 비대칭이라 회전·반전이 실제로 눈에 보인다.
function AugGlyph({ x, y, s, rot = 0, flip = false, crop = false }: {
  x: number; y: number; s: number; rot?: number; flip?: boolean; crop?: boolean
}) {
  const t = `translate(${x} ${y}) scale(${s}) rotate(${rot} 0.5 0.5)${flip ? ' translate(1 0) scale(-1 1)' : ''}${crop ? ' translate(-0.18 0.06) scale(1.75)' : ''}`
  return (
    <g transform={t} strokeWidth={3 / s} strokeLinejoin="round" strokeLinecap="round">
      {!crop && <line x1={0.34} y1={0.14} x2={0.34} y2={0.86} stroke="currentColor" />}
      <polygon points="0.34,0.2 0.8,0.36 0.34,0.52" className="vz-brand" stroke="currentColor" />
    </g>
  )
}

const AUG_VARIANTS: { cap: string; rot?: number; flip?: boolean; crop?: boolean }[] = [
  { cap: '회전', rot: -22 },
  { cap: '반전', flip: true },
  { cap: '어둡게' },
  { cap: '자르기', crop: true },
]

function B8Aug() {
  return (
    <Frame h={148}>
      {/* 원본 한 장 */}
      <Box x={16} y={34} w={76} h={76} r={8} tone="card" />
      <AugGlyph x={16} y={34} s={76} />
      {/* 잘라 쓸 자리 표시 — 오른쪽 '자르기' 판이 이 부분이다 */}
      <rect x={16 + 0.3 * 76} y={34 + 0.14 * 76} width={0.55 * 76} height={0.44 * 76} fill="none" className="vz-dash" strokeWidth={2} />
      <Lab x={54} y={28}>원본 1장</Lab>

      <Arrow x1={98} y1={72} x2={116} y2={72} />

      {AUG_VARIANTS.map((v, i) => {
        const x = 122 + i * 50
        return (
          <g key={v.cap} opacity={v.cap === '어둡게' ? 0.35 : 1}>
            <Box x={x} y={48} w={42} h={42} r={7} tone="card" />
            <AugGlyph x={x} y={48} s={42} rot={v.rot} flip={v.flip} crop={v.crop} />
          </g>
        )
      })}
      {AUG_VARIANTS.map((v, i) => (
        <Lab key={`c${v.cap}`} x={122 + i * 50 + 21} y={106} size={11}>{v.cap}</Lab>
      ))}
      <Lab x={218} y={28} tone="hot">늘어난 표본</Lab>
      <Lab x={160} y={134}>표본이 늘면 통째로 외우기 어려워진다</Lab>
    </Frame>
  )
}

// ── 카메라 캘리브레이션 ─────────────────────────────────────────────────────
// 격자가 실제로 휘어 있고, 보정 계수를 올리면 빨간 점선(진짜 직선) 위로 내려앉는다.
// 곡선은 그린 게 아니라 왜곡식 r' = r(1+k r²) 을 그대로 계산한 결과다.
const CAL_LINES = [0, 1, 2, 3, 4, 5, 6].map((i) => -1 + (i * 2) / 6)
const CAL_SAMPLES = Array.from({ length: 17 }, (_, i) => -1 + (i * 2) / 16)
const CAL_CX = 110
const CAL_CY = 82
const CAL_R = 58

function calMap(u: number, v: number, k: number): [number, number] {
  const f = (1 + k * (u * u + v * v)) / (1 + 2 * k)
  return [CAL_CX + CAL_R * u * f, CAL_CY + CAL_R * v * f]
}

function B8Calib() {
  const [fix, setFix] = useState(0) // 0 = 렌즈 그대로, 100 = 보정 끝
  const k = -0.12 * (1 - fix / 100)
  const err = (Math.abs(calMap(1, 0, k)[0] - (CAL_CX + CAL_R)) / CAL_R) * 40
  const done = err < 0.3
  const line = (fixedU: boolean, c: number) =>
    CAL_SAMPLES.map((t) => {
      const [x, y] = fixedU ? calMap(c, t, k) : calMap(t, c, k)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
  return (
    <Frame
      h={176}
      foot={
        <>
          <input
            className="dy-viz-range"
            type="range"
            min={0}
            max={100}
            value={fix}
            onChange={(e) => setFix(Number(e.target.value))}
            aria-label="보정 계수"
          />
          <span className={`dy-viz-state ${done ? '' : 'crack'}`}>{done ? '반듯함' : '휘어 있음'}</span>
        </>
      }
    >
      {/* 진짜 직선 — 격자가 여기 맞아떨어져야 화면의 픽셀이 실제 치수가 된다 */}
      <rect
        x={CAL_CX - CAL_R}
        y={CAL_CY - CAL_R}
        width={CAL_R * 2}
        height={CAL_R * 2}
        fill="none"
        className="vz-goal"
        strokeWidth={2.5}
        strokeDasharray="6 5"
      />
      <g stroke="currentColor" strokeWidth={1.6} fill="none" strokeLinejoin="round">
        {CAL_LINES.map((c) => <polyline key={`h${c}`} points={line(false, c)} />)}
        {CAL_LINES.map((c) => <polyline key={`v${c}`} points={line(true, c)} />)}
      </g>

      <Lab x={248} y={58} size={11}>가장자리 오차</Lab>
      <Lab x={248} y={86} tone={done ? 'ok' : 'bad'} size={14}>{err.toFixed(1)} mm</Lab>
      <Lab x={248} y={112} size={11}>{done ? '치수를 믿어도 된다' : '휜 채로는 못 잰다'}</Lab>
      <Lab x={150} y={168} size={11}>빨간 점선이 진짜 직선이다</Lab>
    </Frame>
  )
}

// ── 비최대 억제(NMS) ────────────────────────────────────────────────────────
// 기준을 밀면 상자가 실제로 지워진다. 지우는 순서·대상은 진짜 IoU 를 계산한 그리디 결과다.
const NMS_BOXES = [
  { id: 'A', x: 94, y: 30, w: 98, h: 80, s: 0.92, lx: 100, ly: 44, an: 'start' },
  { id: 'B', x: 112, y: 46, w: 96, h: 74, s: 0.78, lx: 203, ly: 114, an: 'end' },
  { id: 'C', x: 80, y: 40, w: 96, h: 72, s: 0.65, lx: 86, ly: 106, an: 'start' },
  { id: 'D', x: 178, y: 44, w: 82, h: 66, s: 0.71, lx: 255, ly: 58, an: 'end' },
  { id: 'E', x: 176, y: 52, w: 84, h: 62, s: 0.6, lx: 255, ly: 108, an: 'end' },
] as const

type NmsRect = { x: number; y: number; w: number; h: number }

function iouOf(a: NmsRect, b: NmsRect): number {
  const ow = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const oh = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  if (ow <= 0 || oh <= 0) return 0
  const inter = ow * oh
  return inter / (a.w * a.h + b.w * b.h - inter)
}

function B8Nms() {
  const [th, setTh] = useState(30)
  const t = th / 100
  const order = [...NMS_BOXES].sort((a, b) => b.s - a.s)
  const dead = new Set<string>()
  const keep: string[] = []
  for (let i = 0; i < order.length; i++) {
    const b = order[i]
    if (dead.has(b.id)) continue
    keep.push(b.id)
    for (let j = i + 1; j < order.length; j++) {
      const o = order[j]
      if (!dead.has(o.id) && iouOf(b, o) > t) dead.add(o.id)
    }
  }
  const msg = keep.length === 2 ? '물체마다 하나씩' : keep.length > 2 ? '한 물체에 여러 개' : '옆 물체까지 지웠다'
  return (
    <Frame
      h={152}
      foot={
        <>
          <input
            className="dy-viz-range"
            type="range"
            min={5}
            max={85}
            step={5}
            value={th}
            onChange={(e) => setTh(Number(e.target.value))}
            aria-label="겹침 기준"
          />
          <span className={`dy-viz-state ${keep.length === 2 ? '' : 'crack'}`}>{msg}</span>
        </>
      }
    >
      {/* 상자가 두르려는 대상 두 개 — 상자는 5개인데 물체는 2개라는 게 요점이다 */}
      <rect x={104} y={48} width={72} height={52} rx={12} className="vz-mute" stroke="currentColor" strokeWidth={2} />
      <rect x={192} y={58} width={58} height={44} rx={12} className="vz-mute" stroke="currentColor" strokeWidth={2} />

      {NMS_BOXES.map((b) => {
        const alive = keep.includes(b.id)
        return (
          <g key={b.id}>
            <rect
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              fill="none"
              className={alive ? undefined : 'vz-dash'}
              stroke={alive ? 'currentColor' : undefined}
              strokeWidth={alive ? 3 : 2.5}
            />
            <Lab x={b.lx} y={b.ly} anchor={b.an} tone={alive ? 'hot' : 'mute'} size={11}>{b.s.toFixed(2)}</Lab>
          </g>
        )
      })}
      <Lab x={160} y={20} size={11}>겹침 기준 {t.toFixed(2)}</Lab>
      <Lab x={160} y={140}>확신 낮은 쪽부터 지운다</Lab>
    </Frame>
  )
}

// ── 합성 데이터 ─────────────────────────────────────────────────────────────
// 조건을 곱한 만큼 장면이 쏟아진다. 옵션을 끄고 켜면 개수가 실제로 곱셈으로 변한다.
const SY_COLS: { cap: string; opts: string[] }[] = [
  { cap: '날씨', opts: ['맑음', '눈', '비'] },
  { cap: '시간', opts: ['낮', '밤'] },
  { cap: '상황', opts: ['사람', '동물', '공사'] },
]
const SY_X = [10, 56, 102]

function B8Synth() {
  const [sel, setSel] = useState<boolean[][]>([[true, true, true], [true, true], [true, true, true]])
  const toggle = (ci: number, oi: number) => {
    setSel((prev) => {
      const next = prev.map((col) => col.slice())
      next[ci][oi] = !next[ci][oi]
      if (!next[ci].some(Boolean)) return prev // 한 줄이 통째로 꺼지면 만들 장면이 없다
      return next
    })
  }
  const count = sel.reduce((acc, col) => acc * col.filter(Boolean).length, 1)
  const shown = Math.min(count, 15)
  return (
    <Frame h={160}>
      {SY_COLS.map((col, ci) => (
        <g key={col.cap}>
          <Lab x={SY_X[ci] + 16} y={26} size={11}>{col.cap}</Lab>
          {col.opts.map((o, oi) => {
            const on = sel[ci][oi]
            return (
              <g key={o} onClick={() => toggle(ci, oi)} style={{ cursor: 'pointer' }}>
                <rect
                  x={SY_X[ci]}
                  y={34 + oi * 24}
                  width={32}
                  height={20}
                  rx={6}
                  className={on ? 'vz-brand' : 'vz-mute'}
                  stroke="currentColor"
                  strokeWidth={2}
                />
                <Lab x={SY_X[ci] + 16} y={48 + oi * 24} tone={on ? 'inv' : 'mute'} size={11}>{o}</Lab>
              </g>
            )
          })}
        </g>
      ))}
      <Lab x={49} y={64} size={13}>×</Lab>
      <Lab x={95} y={64} size={13}>×</Lab>
      <Arrow x1={140} y1={62} x2={158} y2={62} />

      {/* 쏟아진 장면 — 청록 표시가 '라벨이 이미 붙어 있다'는 뜻 */}
      {Array.from({ length: shown }, (_, i) => {
        const tx = 164 + (i % 5) * 30
        const ty = 26 + Math.floor(i / 5) * 30
        const off = (i % 3) * 6
        return (
          <g key={i}>
            <rect x={tx} y={ty} width={26} height={26} rx={4} className="vz-card" stroke="currentColor" strokeWidth={2} />
            <line x1={tx + 4} y1={ty + 19} x2={tx + 22} y2={ty + 19} className="vz-web" strokeWidth={1.5} />
            <rect x={tx + 5 + off} y={ty + 10} width={6} height={9} className="vz-brand" />
            <rect x={tx + 18} y={ty + 4} width={5} height={5} className="vz-teal" />
          </g>
        )
      })}
      <Lab x={237} y={130} tone="hot" size={12}>{'장면'} {count} · {'라벨 포함'}</Lab>
      <Lab x={160} y={152} size={11}>찍은 적 없는 장면을 만들어 낸다</Lab>
    </Frame>
  )
}

// ── 등록표 ──────────────────────────────────────────────────────────────────
export const VISUALS_B8: Record<string, () => ReactNode> = {
  b8_cnn: B8Cnn,
  b8_seg: B8Seg,
  b8_iou: B8Iou,
  b8_confusion: B8Confusion,
  b8_aug: B8Aug,
  b8_calib: B8Calib,
  b8_nms: B8Nms,
  b8_synth: B8Synth,
}
