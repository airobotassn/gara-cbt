// DAILY QUIZ 해설 그림 — 배치 9 「만들어진 모델을 어떻게 주무르는가」.
//
// 7장 전부 "왜 그런가"가 그림 안에서 벌어지게 그렸다(상자에 이름만 적는 그림 금지).
// 색은 daily.css 의 .vz-* 만 쓴다 — 선은 currentColor, 면은 클래스. #hex 를 박으면 한쪽 테마에서 증발한다.
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Frame, Box, Arrow, Lab, Chip } from './kit'

// ── 양자화 ──────────────────────────────────────────────────────────────────
// 눈금을 성기게 하면 상자가 작아지는 대신 값이 계단이 된다 — 이득과 손해를 한 화면에.
const Q_STEPS = [
  { bits: 5, levels: 32 },
  { bits: 3, levels: 8 },
  { bits: 2, levels: 4 },
]

function B9Quant() {
  const [i, setI] = useState(1)
  const { bits, levels } = Q_STEPS[i]
  const X0 = 40
  const X1 = 250
  const YT = 26
  const YB = 98
  const H = YB - YT
  // 원래 값 — 매끄러운 곡선. 눈금에 맞춰 접으면 계단이 된다.
  const trueY = (x: number) => YT + H * (0.5 - 0.42 * Math.sin(((x - X0) / (X1 - X0)) * Math.PI * 1.6))
  const snap = (x: number) => {
    const t = (YB - trueY(x)) / H
    const k = Math.round(t * (levels - 1))
    return YB - (k * H) / (levels - 1)
  }
  const N = 24
  const sw = (X1 - X0) / N
  let stair = ''
  for (let s = 0; s < N; s++) {
    const x = X0 + s * sw
    const y = snap(x + sw / 2).toFixed(1)
    stair += `${s === 0 ? 'M' : ' L'}${x.toFixed(1)} ${y} L${(x + sw).toFixed(1)} ${y}`
  }
  let curve = ''
  for (let s = 0; s <= 42; s++) {
    const x = X0 + ((X1 - X0) * s) / 42
    curve += `${s === 0 ? 'M' : ' L'}${x.toFixed(1)} ${trueY(x).toFixed(1)}`
  }
  const ERR = [86, 150, 214]
  const levelY = (k: number) => YB - (k * H) / (levels - 1)

  return (
    <Frame
      h={190}
      foot={Q_STEPS.map((q, n) => (
        <Chip key={q.bits} on={n === i} onClick={() => setI(n)}>{q.bits}비트</Chip>
      ))}
    >
      {/* 눈금자 — 촘촘하면 한 덩어리로 보이고, 성기면 칸이 세어진다 */}
      {Array.from({ length: levels }, (_, k) => (
        <line key={`t${k}`} x1={24} y1={levelY(k)} x2={34} y2={levelY(k)} stroke="currentColor" strokeWidth={1.5} />
      ))}
      <line x1={34} y1={YT - 4} x2={34} y2={YB + 4} stroke="currentColor" strokeWidth={2.5} />
      {/* 눈금이 성길 때만 가로선을 깐다 — 계단이 어디에 내려앉는지 보이라고 */}
      {levels <= 8 &&
        Array.from({ length: levels }, (_, k) => (
          <line key={`g${k}`} x1={X0} y1={levelY(k)} x2={X1} y2={levelY(k)} className="vz-web" strokeWidth={1.5} />
        ))}
      <path d={curve} fill="none" className="vz-dash" strokeWidth={2.5} />
      <path d={stair} fill="none" className="vz-arrow" strokeWidth={3} strokeLinejoin="round" />
      {/* 원래 값과 저장된 값의 틈 = 양자화 오차 */}
      {ERR.map((x) => (
        <line key={`e${x}`} x1={x} y1={trueY(x)} x2={x} y2={snap(x)} className="vz-goal" strokeWidth={3} strokeLinecap="round" />
      ))}
      <Lab x={14} y={118} anchor="start" size={11}>눈금 {levels}칸</Lab>
      <Lab x={214} y={118} tone="bad" size={11}>오차</Lab>
      <Lab x={256} y={44} anchor="start" size={11}>원래 값</Lab>
      <Lab x={256} y={62} anchor="start" tone="ok" size={11}>저장 값</Lab>
      {/* 얻는 것 — 모델이 실제로 작아진다 */}
      <Lab x={14} y={145} anchor="start" size={11}>모델 크기</Lab>
      <Box x={88} y={130} w={200} h={20} r={7} tone="mute" />
      <rect x={88} y={130} width={(200 * bits) / 5} height={20} rx={7} className="vz-brand" />
      <Lab x={96} y={145} anchor="start" tone="inv" size={11}>{bits}비트</Lab>
      <Lab x={160} y={176} size={12}>눈금이 성길수록 작아지고, 값은 계단이 된다</Lab>
    </Frame>
  )
}

// ── 지식 증류 ───────────────────────────────────────────────────────────────
// 정답표는 "고양이 1" 하나뿐이다. 선생은 얼마나 헷갈렸는지까지 알려주고, 학생은 그 모양을 베낀다.
const DIS_ROWS = [
  { name: '고양이', t: 0.7, s: 0.64 },
  { name: '여우', t: 0.2, s: 0.24 },
  { name: '개', t: 0.1, s: 0.12 },
]
const DIS_SX = 172
const DIS_SW = 84

function B9Distill() {
  return (
    <Frame h={206}>
      {/* 선생 — 크다 */}
      <Box x={26} y={30} w={96} h={54} tone="brand" />
      <Lab x={74} y={54} tone="inv" size={13}>선생</Lab>
      <Lab x={74} y={72} tone="inv" size={11}>큰 모델</Lab>
      <Lab x={214} y={16} tone="hot" size={11}>확률 분포</Lab>
      {DIS_ROWS.map((r, i) => {
        const y = 26 + i * 24
        return (
          <g key={`t${r.name}`}>
            <Box x={DIS_SX} y={y} w={DIS_SW} h={16} r={6} tone="mute" />
            <rect x={DIS_SX} y={y} width={DIS_SW * r.t} height={16} rx={6} className="vz-brand" />
            <Lab x={166} y={y + 12} anchor="end" size={11}>{r.name}</Lab>
            <Lab x={262} y={y + 12} anchor="start" size={11}>{r.t.toFixed(1)}</Lab>
          </g>
        )
      })}
      {/* 베끼는 것은 정답이 아니라 이 모양이다 */}
      <Arrow x1={214} y1={92} x2={214} y2={112} />
      <Lab x={206} y={106} anchor="end" tone="hot" size={11}>분포 모양을 베낀다</Lab>
      {/* 학생 — 작다 */}
      <Box x={44} y={132} w={60} h={34} tone="teal" />
      <Lab x={74} y={153} tone="inv" size={12}>학생</Lab>
      {DIS_ROWS.map((r, i) => {
        const y = 118 + i * 24
        return (
          <g key={`s${r.name}`}>
            <Box x={DIS_SX} y={y} w={DIS_SW} h={16} r={6} tone="mute" />
            {/* 선생의 폭을 점선으로 남겨 둔다 — 학생이 그 윤곽을 따라 그린 게 보이라고 */}
            <rect x={DIS_SX} y={y} width={DIS_SW * r.s} height={16} rx={6} className="vz-teal" />
            <rect x={DIS_SX} y={y} width={DIS_SW * r.t} height={16} rx={6} fill="none" className="vz-dash" strokeWidth={2} />
            <Lab x={166} y={y + 12} anchor="end" size={11}>{r.name}</Lab>
          </g>
        )
      })}
      {/* ⚠️ 라벨에 HTML 엔티티(&lsquo; 같은)를 쓰지 말 것 — 화면에는 따옴표로 그려지는데 번역표의 키는
          소스 글자 그대로라 짝이 안 맞아 그 라벨만 영영 한국어로 남는다. 따옴표는 글자로 직접 쓴다. */}
      <Lab x={160} y={198} size={12}>정답표엔 없는 '여우와 닮은 정도'까지 물려받는다</Lab>
    </Frame>
  )
}

// ── AI 에이전트 ─────────────────────────────────────────────────────────────
// 한 번 답하고 끝이 아니다. 생각 → 도구 → 실행 → 관찰이 한 바퀴 돌고, 모자라면 다시 돈다.
const AG_RING = { cx: 160, cy: 84, rx: 76, ry: 52 }
const AG_NODES = [
  { t: '생각', x: 160, y: 32 },
  { t: '도구 고르기', x: 236, y: 84 },
  { t: '실행', x: 160, y: 136 },
  { t: '관찰', x: 84, y: 84 },
]
const AG_TOOLS = ['검색', '계산', 'API']

function B9Agent() {
  const [step, setStep] = useState(0)
  const pt = (deg: number): [number, number] => {
    const a = (deg * Math.PI) / 180
    return [AG_RING.cx + AG_RING.rx * Math.cos(a), AG_RING.cy + AG_RING.ry * Math.sin(a)]
  }
  return (
    <Frame
      h={186}
      foot={
        <Chip on onClick={() => setStep((s) => (s + 1) % 4)}>
          한 걸음 →
        </Chip>
      }
    >
      <ellipse cx={AG_RING.cx} cy={AG_RING.cy} rx={AG_RING.rx} ry={AG_RING.ry} fill="none" className="vz-dash" strokeWidth={3} />
      {[-45, 45, 135, 225].map((d) => {
        const [x1, y1] = pt(d - 9)
        const [x2, y2] = pt(d + 9)
        return <Arrow key={d} x1={x1} y1={y1} x2={x2} y2={y2} />
      })}
      {/* 쓸 수 있는 도구들 — 고른 하나만 물든다 */}
      {AG_TOOLS.map((t, i) => (
        <g key={t}>
          <rect x={128 + i * 24} y={74} width={20} height={20} rx={5} className={step >= 1 && i === 1 ? 'vz-gold-f' : 'vz-node'} stroke="currentColor" strokeWidth={2.5} />
          <Lab x={138 + i * 24} y={110} size={11} tone={step >= 1 && i === 1 ? 'hot' : 'mute'}>{t}</Lab>
        </g>
      ))}
      {AG_NODES.map((n, i) => (
        <g key={n.t}>
          <Box x={n.x - 36} y={n.y - 13} w={72} h={26} r={9} tone={i === step ? 'brand' : 'card'} />
          <Lab x={n.x} y={n.y + 4} size={11} tone={i === step ? 'inv' : 'mute'}>{n.t}</Lab>
        </g>
      ))}
      {step === 3 && <Lab x={84} y={114} tone="bad" size={11}>모자라면 다시</Lab>}
      <Lab x={160} y={172} size={12}>될 때까지 한 바퀴 더 돈다</Lab>
    </Frame>
  )
}

// ── 포지셔널 인코딩 ─────────────────────────────────────────────────────────
// 병렬로 읽으면 두 문장이 같은 뭉치로 뭉개진다. 자리 번호를 얹는 순간 갈라진다.
const PE_TOKENS = ['나는', '너를', '본다']
const PE_SLOT = [
  { dx: 8, y: 42 },
  { dx: 44, y: 74 },
  { dx: 16, y: 106 },
]
// 뭉치 안에서의 자리(왼쪽 문장 / 오른쪽 문장) — 같은 단어가 서로 다른 번호를 단다.
const PE_POS: [number[], number[]] = [
  [1, 2, 3],
  [2, 1, 3],
]

function B9PosEnc() {
  const [on, setOn] = useState(false)
  const bag = (bx: number, which: 0 | 1) => (
    <g>
      <Box x={bx} y={32} w={124} h={104} r={14} tone="card" />
      {PE_TOKENS.map((tk, i) => {
        const x = bx + PE_SLOT[i].dx
        const y = PE_SLOT[i].y
        return (
          <g key={tk}>
            <Box x={x} y={y} w={64} h={24} r={8} tone="mute" />
            {on && (
              <g>
                <circle cx={x + 14} cy={y + 12} r={9} className="vz-gold-f" stroke="currentColor" strokeWidth={2.5} />
                <Lab x={x + 14} y={y + 16} size={11}>{PE_POS[which][i]}</Lab>
              </g>
            )}
            <Lab x={on ? x + 30 : x + 32} y={y + 16} anchor={on ? 'start' : 'middle'} size={11}>{tk}</Lab>
          </g>
        )
      })}
    </g>
  )
  return (
    <Frame
      h={178}
      foot={
        <Chip on={on} onClick={() => setOn(!on)}>
          자리표 더하기
        </Chip>
      }
    >
      <Lab x={72} y={24} size={11}>나는 너를 본다</Lab>
      <Lab x={248} y={24} size={11}>너를 나는 본다</Lab>
      {bag(10, 0)}
      {bag(186, 1)}
      <Lab x={160} y={76} tone={on ? 'ok' : 'bad'} size={14}>{on ? '≠' : '='}</Lab>
      <Lab x={160} y={98} tone={on ? 'ok' : 'bad'} size={11}>{on ? '다르다' : '같다'}</Lab>
      <Lab x={160} y={162} size={12}>{on ? '자리 번호가 두 문장을 갈라놓는다' : '순서가 사라져 같은 뭉치가 된다'}</Lab>
    </Frame>
  )
}

// ── 도메인 랜덤화 ───────────────────────────────────────────────────────────
// 훈련장을 흔들어 두면 현실의 낯섦이 '겪어 본 것' 안에 들어온다. 한 가지만 겪으면 처음 보는 조명에서 놓친다.
const DR_FILL = ['vz-mute', 'vz-card', 'vz-scope1', 'vz-egg-b', 'vz-scope2', 'vz-card', 'vz-scope1', 'vz-mute', 'vz-egg-b']
const DR_BOX = [
  { w: 10, h: 8 },
  { w: 14, h: 6 },
  { w: 8, h: 12 },
  { w: 12, h: 10 },
  { w: 16, h: 7 },
  { w: 9, h: 9 },
  { w: 13, h: 12 },
  { w: 11, h: 6 },
  { w: 15, h: 10 },
]

function B9DomainRand() {
  const [wild, setWild] = useState(true)
  return (
    <Frame
      h={178}
      foot={
        <>
          <Chip on={!wild} onClick={() => setWild(false)}>한 가지 환경</Chip>
          <Chip on={wild} onClick={() => setWild(true)}>마구 흔들기</Chip>
        </>
      }
    >
      <Lab x={60} y={26} size={11}>가상 훈련장</Lab>
      <Lab x={232} y={26} size={11}>현실</Lab>
      {/* 훈련 장면 9개 — 흔들면 바닥색·상자 크기가 전부 달라진다 */}
      {DR_FILL.map((f, i) => {
        const x = 14 + (i % 3) * 32
        const y = 38 + Math.floor(i / 3) * 32
        const b = wild ? DR_BOX[i] : { w: 11, h: 9 }
        return (
          <g key={`tile${i}`}>
            <rect x={x} y={y} width={28} height={28} rx={5} className={wild ? f : 'vz-mute'} stroke="currentColor" strokeWidth={2} />
            <line x1={x + 4} y1={y + 22} x2={x + 24} y2={y + 22} stroke="currentColor" strokeWidth={1.5} />
            <rect x={x + 5} y={y + 22 - b.h} width={b.w} height={b.h} className="vz-gold-f" stroke="currentColor" strokeWidth={1.5} />
          </g>
        )
      })}
      <Arrow x1={112} y1={84} x2={150} y2={84} />
      {/* 현실 — 훈련장 어느 칸과도 똑같지 않은 장면 */}
      <Box x={158} y={38} w={148} h={88} r={12} tone="card" />
      <line x1={166} y1={108} x2={298} y2={108} stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
      <path d="M178 70 v-12 M204 70 v-12 M178 58 h26" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <rect x={178} y={wild ? 72 : 84} width={26} height={24} rx={4} className="vz-gold-f" stroke="currentColor" strokeWidth={3} />
      {wild ? (
        <path d="M248 74 l10 11 20 -24" fill="none" className="vz-arrow" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M250 62 l24 24 M274 62 l-24 24" fill="none" className="vz-goal" strokeWidth={4} strokeLinecap="round" />
      )}
      <Lab x={232} y={142} tone={wild ? 'ok' : 'bad'} size={11}>{wild ? '겪어 본 범위 안 → 집었다' : '처음 보는 환경 → 놓쳤다'}</Lab>
      <Lab x={160} y={166} size={12}>훈련 때 흔든 범위 안에 현실이 들어온다</Lab>
    </Frame>
  )
}

// ── 그래프 신경망(GNN) ──────────────────────────────────────────────────────
// 격자도 한 줄도 아닌 거미줄. 한 점의 값은 '이웃에서 모아' 갱신된다 — 점을 눌러 보면 누가 모여드는지 보인다.
const GN_NODES: [number, number][] = [
  [52, 96],
  [112, 74],
  [104, 138],
  [170, 104],
  [240, 76],
  [244, 142],
]
const GN_EDGES: [number, number][] = [
  [0, 1],
  [0, 2],
  [1, 2],
  [1, 3],
  [2, 3],
  [3, 4],
  [3, 5],
  [4, 5],
]

function B9Gnn() {
  const [sel, setSel] = useState(3)
  const near = (a: [number, number], b: [number, number], off: number): [number, number] => {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const d = Math.hypot(dx, dy) || 1
    return [a[0] + (dx * off) / d, a[1] + (dy * off) / d]
  }
  const nbrs = GN_EDGES.filter((e) => e[0] === sel || e[1] === sel).map((e) => (e[0] === sel ? e[1] : e[0]))
  return (
    <Frame h={192} foot={<span className="dy-viz-hint">👆 점을 눌러 보라 — 이웃이 모여든다</span>}>
      {/* 데이터 모양 세 가지 — 우리가 다루는 건 셋째다 */}
      {[0, 1, 2].map((r) => [0, 1, 2].map((c) => <circle key={`gr${r}${c}`} cx={20 + c * 12} cy={18 + r * 10} r={3.5} className="vz-node" stroke="currentColor" strokeWidth={1.5} />))}
      <Lab x={32} y={52} size={11}>이미지</Lab>
      <line x1={104} y1={28} x2={152} y2={28} stroke="currentColor" strokeWidth={1.5} />
      {[0, 1, 2, 3].map((c) => <circle key={`ln${c}`} cx={104 + c * 16} cy={28} r={3.5} className="vz-node" stroke="currentColor" strokeWidth={1.5} />)}
      <Lab x={128} y={52} size={11}>문장</Lab>
      <g className="vz-web" strokeWidth={1.5}>
        <line x1={212} y1={20} x2={238} y2={16} />
        <line x1={238} y1={16} x2={252} y2={32} />
        <line x1={212} y1={20} x2={226} y2={40} />
        <line x1={226} y1={40} x2={252} y2={32} />
        <line x1={226} y1={40} x2={248} y2={44} />
      </g>
      {[[212, 20], [238, 16], [252, 32], [226, 40], [248, 44]].map(([x, y]) => (
        <circle key={`wb${x}${y}`} cx={x} cy={y} r={3.5} className="vz-node-on" stroke="currentColor" strokeWidth={1.5} />
      ))}
      <Lab x={232} y={52} tone="hot" size={11}>그래프</Lab>
      <line x1={10} y1={60} x2={310} y2={60} className="vz-dash" strokeWidth={2} />

      {/* 본체 — 고른 점으로 이웃의 값이 흘러든다 */}
      <g className="vz-web" strokeWidth={2.5}>
        {GN_EDGES.map(([a, b]) => (
          <line key={`e${a}${b}`} x1={GN_NODES[a][0]} y1={GN_NODES[a][1]} x2={GN_NODES[b][0]} y2={GN_NODES[b][1]} />
        ))}
      </g>
      {nbrs.map((n) => {
        const [x1, y1] = near(GN_NODES[n], GN_NODES[sel], 16)
        const [x2, y2] = near(GN_NODES[sel], GN_NODES[n], 18)
        return <Arrow key={`a${n}`} x1={x1} y1={y1} x2={x2} y2={y2} />
      })}
      {GN_NODES.map(([x, y], i) => (
        <circle
          key={`n${i}`}
          cx={x}
          cy={y}
          r={13}
          className={i === sel ? 'vz-node-on' : nbrs.includes(i) ? 'vz-card' : 'vz-node'}
          stroke="currentColor"
          strokeWidth={3}
          style={{ cursor: 'pointer' }}
          onClick={() => setSel(i)}
        />
      ))}
      <Lab x={160} y={180} size={12}>이웃에서 모아 내 값을 고친다</Lab>
    </Frame>
  )
}

// ── 유전 알고리즘 ───────────────────────────────────────────────────────────
// 잘된 둘을 고르고 → 잘라 붙이고 → 한 칸을 비튼다. 세대를 넘길 때마다 최고점이 오른다.
const GA_FILL = ['vz-brand', 'vz-teal', 'vz-gold-f', 'vz-brand-hi', 'vz-card']
const GA_GENS: { rows: number[][]; scores: number[] }[] = [
  { rows: [[0, 2, 1, 4, 3], [3, 1, 2, 0, 4], [1, 4, 0, 2, 2], [2, 0, 3, 1, 0]], scores: [41, 58, 33, 52] },
  { rows: [[3, 1, 2, 0, 4], [2, 0, 3, 1, 0], [3, 1, 3, 1, 0], [0, 2, 2, 0, 4]], scores: [58, 52, 64, 49] },
  { rows: [[3, 1, 3, 1, 0], [3, 1, 2, 1, 0], [2, 0, 3, 1, 4], [3, 4, 3, 1, 0]], scores: [64, 71, 60, 66] },
  { rows: [[3, 1, 2, 1, 0], [3, 1, 3, 1, 0], [3, 1, 2, 1, 4], [3, 4, 2, 1, 0]], scores: [71, 78, 74, 69] },
]
const GA_MUT = 3 // 비트는 칸(돌연변이 자리)

function B9Genetic() {
  const [gen, setGen] = useState(0)
  const g = GA_GENS[gen]
  const rank = g.scores.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0])
  const p1 = rank[0][1]
  const p2 = rank[1][1]
  const child = [...g.rows[p1].slice(0, 2), ...g.rows[p2].slice(2)]
  child[GA_MUT] = (child[GA_MUT] + 2) % 5
  const cell = (v: number, x: number, y: number, k: string) => (
    <rect key={k} x={x} y={y} width={20} height={18} rx={4} className={GA_FILL[v]} stroke="currentColor" strokeWidth={2.5} />
  )
  return (
    <Frame
      h={194}
      foot={
        <Chip on onClick={() => setGen((n) => (n + 1) % GA_GENS.length)}>
          {gen === GA_GENS.length - 1 ? '처음부터' : '다음 세대 →'}
        </Chip>
      }
    >
      <Lab x={14} y={18} anchor="start" tone="hot" size={12}>세대 {gen + 1}</Lab>
      <Lab x={306} y={18} anchor="end" tone="ok" size={12}>최고 {rank[0][0]}점</Lab>
      {g.rows.map((row, r) => {
        const y = 26 + r * 22
        const parent = r === p1 || r === p2
        return (
          <g key={`r${r}`}>
            {row.map((v, c) => cell(v, 14 + c * 20, y, `c${r}${c}`))}
            {parent && <rect x={11} y={y - 3} width={106} height={24} rx={7} fill="none" className="vz-turn" strokeWidth={3} />}
            <Box x={128} y={y} w={76} h={18} r={6} tone="mute" />
            <rect x={128} y={y} width={(76 * g.scores[r]) / 100} height={18} rx={6} className="vz-brand" />
            <Lab x={212} y={y + 13} anchor="start" size={11}>{g.scores[r]}점</Lab>
            {parent && <Lab x={240} y={y + 13} anchor="start" tone="hot" size={11}>부모</Lab>}
          </g>
        )
      })}
      <Arrow x1={64} y1={116} x2={64} y2={127} />
      <Lab x={78} y={126} anchor="start" tone="hot" size={11}>섞고 한 칸 비튼다</Lab>
      {/* 자식 — 앞은 부모1, 뒤는 부모2, 그리고 한 칸이 무작위로 뒤집힌다 */}
      {child.map((v, c) => cell(v, 14 + c * 20, 130, `k${c}`))}
      <line x1={54} y1={124} x2={54} y2={154} className="vz-dash" strokeWidth={2.5} />
      <rect x={14 + GA_MUT * 20} y={130} width={20} height={18} rx={4} fill="none" className="vz-goal" strokeWidth={3} />
      <Lab x={126} y={143} anchor="start" size={11}>앞 두 칸은 부모1, 뒤는 부모2</Lab>
      <Lab x={84} y={166} tone="bad" size={11}>돌연변이</Lab>
      <Lab x={160} y={186} size={12}>잘된 것끼리 섞으며 세대를 넘긴다</Lab>
    </Frame>
  )
}

// ── 등록표 ──────────────────────────────────────────────────────────────────
export const VISUALS_B9: Record<string, () => ReactNode> = {
  b9_quant: B9Quant,
  b9_distill: B9Distill,
  b9_agent: B9Agent,
  b9_posenc: B9PosEnc,
  b9_domrand: B9DomainRand,
  b9_gnn: B9Gnn,
  b9_genetic: B9Genetic,
}
