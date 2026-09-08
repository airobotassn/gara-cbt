// DAILY QUIZ 해설 그림 — 배치 16(피지컬 AI 6개).
//
// ⚠️ 이 여섯은 기존 `PhysicalLoop`(피지컬 AI)와 **같은 세계**라 자칫 그 고리 그림의 변주가 된다.
//    그 그림은 이미 "내 행동이 다음에 볼 것을 바꾼다"를 말하고 있으므로, 여기서는 고리를 다시 그리지 않는다.
//    여섯 장 전부 다른 기계를 보여 준다 — 경계 / 마감선 / 틈 / 사라진 중간 단계 / 갈라 쓰는 밑동 / 무너지는 선.
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Frame, Limb, Joint, Box, Arrow, Lab, Chip } from './kit'

// ── 임베디드 AI ─────────────────────────────────────────────────────────────
// 요점은 "클라우드에 안 간다"가 아니라(그건 온디바이스 쪽 이야기다) **제품 안에 박혀서, 정해진 예산만 쓴다** 는 것.
// 그래서 기기 테두리를 굵게 그리고 그 안에서 센서→모델→모터가 다 끝나게 두되,
// 화면의 무게는 '못 늘어나는 메모리·전력 칸'에 싣는다.
function B16Embedded() {
  return (
    <Frame h={182}>
      {/* 기기 한 대의 테두리 — 이 선 안에서 모든 게 끝난다 */}
      <Box x={12} y={30} w={196} h={116} r={14} tone="mute" />
      <Lab x={14} y={24} anchor="start" size={11} tone="hot">기기 한 대 안</Lab>

      {/* 센서 → 모델 → 모터 : 한 줄이 전부 테두리 안에 있다 */}
      <Box x={22} y={44} w={44} h={28} r={8} tone="card" />
      <Lab x={44} y={63} size={11}>센서</Lab>
      <Arrow x1={68} y1={58} x2={80} y2={58} w={2.5} head={6} />
      <Box x={82} y={40} w={58} h={36} r={9} tone="brand" />
      <Lab x={111} y={64} tone="inv">모델</Lab>
      <Arrow x1={142} y1={58} x2={154} y2={58} w={2.5} head={6} />
      <Box x={156} y={44} w={44} h={28} r={8} tone="card" />
      <Lab x={178} y={63} size={11}>모터</Lab>

      {/* 예산 칸 — 다 찬 막대가 '더 못 늘린다'를 말한다 */}
      <rect x={22} y={100} width={176} height={16} rx={8} className="vz-mute" stroke="currentColor" strokeWidth={3} />
      <rect x={26} y={104} width={140} height={8} rx={4} className="vz-brand-hi" />
      <Lab x={22} y={134} anchor="start" size={11}>메모리·전력은 이게 전부</Lab>

      {/* 밖 — 다녀오지 않는다(작게 둔다. 이 그림의 주인공이 아니다) */}
      <rect x={232} y={54} width={76} height={40} rx={16} className="vz-card" stroke="currentColor" strokeWidth={3} />
      <Lab x={270} y={79} size={11}>클라우드</Lab>
      <line x1={208} y1={74} x2={232} y2={74} className="vz-dash" strokeWidth={3} />
      <g className="vz-goal" strokeWidth={3} strokeLinecap="round">
        <line x1={214} y1={68} x2={226} y2={80} />
        <line x1={226} y1={68} x2={214} y2={80} />
      </g>
      <Lab x={270} y={112} size={11} tone="bad">안 다녀온다</Lab>

      <Lab x={160} y={172}>제품 안에 붙박이로 들어앉는다</Lab>
    </Frame>
  )
}

// ── 실시간 제어 ─────────────────────────────────────────────────────────────
// ⛔ '빠르다'로 그리면 틀린 그림이 된다. 마감선을 긋고, **평균이 더 빠른 쪽이 지는** 장면을 보여 준다.
//    칩으로 두 시스템을 갈아 끼우면 평균값과 성공 횟수가 같이 뒤집힌다 — 그게 이 개념의 전부다.
const RT_SYS = [
  { key: 'slow', chip: '느려도 늘 마감 안', v: [5, 6, 5, 6, 5, 6, 5, 6, 5, 6] },
  { key: 'jitter', chip: '평균 빠른데 가끔 늦음', v: [1, 1, 2, 1, 10, 1, 2, 1, 11, 1] },
] as const
const RT_DL = 8 // 마감 8ms
const RT_BASE = 142 // 바닥선
const RT_PX = 7 // 1ms = 7px

function B16Realtime() {
  const [i, setI] = useState(0)
  const sys = RT_SYS[i]
  const avg = (sys.v.reduce((a, b) => a + b, 0) / sys.v.length).toFixed(1)
  const late = sys.v.filter((v) => v > RT_DL).length
  const dlY = RT_BASE - RT_DL * RT_PX
  return (
    <Frame
      h={172}
      foot={
        <>
          {RT_SYS.map((s, n) => (
            <Chip key={s.key} on={n === i} onClick={() => setI(n)}>{s.chip}</Chip>
          ))}
          <span className={`dy-viz-state${late ? ' crack' : ''}`}>{late ? `${late}번 놓쳤다` : '10번 다 성공'}</span>
        </>
      }
    >
      {/* 한 주기에 걸린 시간 = 막대 하나. 마감선을 넘은 막대만 빨갛게 선다. */}
      {sys.v.map((v, n) => {
        const x = 46 + n * 24
        const h = v * RT_PX
        const bad = v > RT_DL
        return (
          <g key={n}>
            <rect
              x={x}
              y={RT_BASE - h}
              width={16}
              height={h}
              rx={3}
              className={bad ? 'vz-target' : 'vz-brand'}
              stroke="currentColor"
              strokeWidth={2.5}
            />
            {bad && <Lab x={x + 8} y={RT_BASE - h - 6} size={13} tone="bad">✗</Lab>}
          </g>
        )
      })}
      {/* 마감선 — 이 선을 넘으면 평균이 아무리 좋아도 실패다 */}
      <line x1={34} y1={dlY} x2={296} y2={dlY} className="vz-goal" strokeWidth={3} strokeDasharray="7 5" />
      <Lab x={34} y={dlY - 6} anchor="start" size={11} tone="bad">마감 8ms</Lab>
      <line x1={34} y1={RT_BASE} x2={296} y2={RT_BASE} stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
      <Lab x={296} y={34} anchor="end" size={11} tone="hot">평균 {avg}ms</Lab>
      <Lab x={160} y={162} size={11}>한 주기 = 센서 읽고 명령 내기까지</Lab>
    </Frame>
  )
}

// ── 시뮬레이션 투 리얼(Sim-to-Real) ─────────────────────────────────────────
// 같은 정책, 같은 동작인데 결과가 갈린다. 갈리는 이유를 **두 판 사이의 틈**에 적어 두는 게 이 그림의 전부다.
const S2R_GAP = [
  { y: 54, t: '마찰' },
  { y: 76, t: '무게' },
  { y: 98, t: '조명' },
  { y: 120, t: '지연' },
] as const

function B16Sim2Real() {
  return (
    <Frame h={190}>
      {/* 왼쪽: 시뮬레이션 — 격자를 깔아 '만들어진 세상'임을 알린다 */}
      <Box x={8} y={30} w={126} h={104} r={12} tone="card" />
      <g className="vz-web" strokeWidth={1.2}>
        <line x1={8} y1={56} x2={134} y2={56} />
        <line x1={8} y1={82} x2={134} y2={82} />
        <line x1={8} y1={108} x2={134} y2={108} />
        <line x1={40} y1={30} x2={40} y2={134} />
        <line x1={71} y1={30} x2={71} y2={134} />
        <line x1={102} y1={30} x2={102} y2={134} />
      </g>
      <Lab x={71} y={22} size={12} tone="hot">시뮬레이션</Lab>
      <Limb x1={28} y1={120} x2={56} y2={84} w={13} />
      <Limb x1={56} y1={84} x2={92} y2={92} w={11} />
      <Joint x={28} y={120} r={6} />
      <Joint x={56} y={84} r={6} />
      <rect x={82} y={84} width={22} height={17} rx={4} className="vz-brand" stroke="currentColor" strokeWidth={3} />
      <Lab x={71} y={128} size={11} tone="ok">잡았다</Lab>

      {/* 가운데: 틈 — 옮겨 간 건 같은 정책인데, 이 목록만큼 세상이 다르다 */}
      <Arrow x1={138} y1={40} x2={182} y2={40} w={3} head={7} />
      <Lab x={160} y={32} size={11} tone="hot">정책 그대로</Lab>
      <g stroke="currentColor" strokeWidth={2.5} fill="none" strokeLinejoin="round">
        <path d="M138 46 L134 66 L140 86 L134 106 L139 128" />
        <path d="M182 46 L186 66 L180 86 L186 106 L181 128" />
      </g>
      {S2R_GAP.map((g) => (
        <Lab key={g.t} x={160} y={g.y} size={11}>{g.t}</Lab>
      ))}

      {/* 오른쪽: 현실 — 같은 팔, 같은 자세, 그런데 물건이 손에서 빠진다 */}
      <Box x={186} y={30} w={126} h={104} r={12} tone="card" />
      <Lab x={249} y={22} size={12}>현실</Lab>
      <Limb x1={206} y1={120} x2={234} y2={84} w={13} />
      <Limb x1={234} y1={84} x2={270} y2={92} w={11} />
      <Joint x={206} y={120} r={6} />
      <Joint x={234} y={84} r={6} />
      <rect
        x={259}
        y={108}
        width={22}
        height={17}
        rx={4}
        className="vz-mute"
        stroke="currentColor"
        strokeWidth={3}
        transform="rotate(18 270 116)"
      />
      <Arrow x1={270} y1={92} x2={270} y2={104} tone="bad" w={2.5} head={6} />
      <Lab x={249} y={130} size={11} tone="bad">미끄러졌다</Lab>

      <Lab x={160} y={154} size={11} tone="bad">이 틈이 reality gap</Lab>
      <Lab x={160} y={178}>시뮬엔 없던 것이 현실엔 있다</Lab>
    </Frame>
  )
}

// ── VLA 모델 ────────────────────────────────────────────────────────────────
// 새로 생긴 것보다 **없어진 것**이 요점이다 — 사람이 규칙을 짜 넣던 중간 칸이 통째로 빠졌다.
// 그래서 위아래 두 줄을 같은 자리에 놓고, 위 줄의 그 칸에만 빨간 줄을 긋는다.
function B16Vla() {
  return (
    <Frame h={196}>
      <Lab x={8} y={30} anchor="start" size={11}>예전</Lab>
      <Box x={30} y={40} w={40} h={26} r={8} tone="card" />
      <Lab x={50} y={57} size={11}>영상</Lab>
      <Arrow x1={72} y1={53} x2={82} y2={53} w={2.5} head={6} />
      <Box x={84} y={40} w={40} h={26} r={8} tone="card" />
      <Lab x={104} y={57} size={11}>인식</Lab>
      <Arrow x1={126} y1={53} x2={136} y2={53} w={2.5} head={6} />
      <Box x={138} y={40} w={88} h={26} r={8} tone="mute" />
      <Lab x={182} y={57} size={11}>사람이 짠 규칙</Lab>
      <line x1={142} y1={64} x2={222} y2={42} className="vz-goal" strokeWidth={3} strokeLinecap="round" />
      <Arrow x1={228} y1={53} x2={238} y2={53} w={2.5} head={6} />
      <Box x={240} y={40} w={60} h={26} r={8} tone="card" />
      <Lab x={270} y={57} size={11}>동작</Lab>
      <Lab x={182} y={82} size={11} tone="bad">여기를 사람이 짰다</Lab>

      {/* 지금 — 영상과 말이 한 덩어리로 들어가고, 나오는 건 곧바로 관절 각도다 */}
      <Lab x={8} y={92} anchor="start" size={11} tone="hot">지금</Lab>
      <Box x={30} y={100} w={40} h={26} r={8} tone="card" />
      <Lab x={50} y={117} size={11}>영상</Lab>
      <Box x={30} y={136} w={40} h={26} r={8} tone="card" />
      <Lab x={50} y={153} size={11}>말</Lab>
      <Arrow x1={72} y1={113} x2={96} y2={122} w={2.5} head={6} />
      <Arrow x1={72} y1={149} x2={96} y2={140} w={2.5} head={6} />
      <Box x={100} y={96} w={104} h={70} r={14} tone="brand" />
      <Lab x={152} y={126} tone="inv">VLA</Lab>
      <Lab x={152} y={146} size={11} tone="inv">한 덩어리</Lab>
      <Arrow x1={206} y1={131} x2={232} y2={131} w={3} />
      <Box x={236} y={118} w={64} h={28} r={8} tone="card" />
      <Lab x={268} y={136} size={11}>관절 각도</Lab>

      <Lab x={160} y={186}>보고 듣고 바로 움직인다 — 중간이 없다</Lab>
    </Frame>
  )
}

// ── 파운데이션 모델 ─────────────────────────────────────────────────────────
// 굵기가 곧 설명이다. 위로 들어가는 화살표는 굵고 하나, 아래로 갈라지는 줄기는 가늘고 여럿.
// 작업마다 붙는 데이터 조각(작은 칸)이 맨 위 데이터 띠와 나란히 놓여 크기 차이를 스스로 말한다.
const FM_TASKS = [
  { cx: 76, t: '집기' },
  { cx: 132, t: '밀기' },
  { cx: 188, t: '문 열기' },
  { cx: 244, t: '분류' },
] as const

function B16Foundation() {
  return (
    <Frame h={196}>
      <rect x={18} y={16} width={284} height={22} rx={11} className="vz-mute" stroke="currentColor" strokeWidth={3} />
      <Lab x={160} y={32} size={11}>대규모 데이터 — 한 번에 통째로</Lab>
      <Arrow x1={160} y1={44} x2={160} y2={60} w={7} head={13} />

      <Box x={30} y={62} w={260} h={44} r={14} tone="brand" />
      <Lab x={160} y={90} tone="inv">한 번 크게 학습한 밑동</Lab>

      {FM_TASKS.map((k) => (
        <g key={k.t}>
          <Arrow x1={k.cx} y1={108} x2={k.cx} y2={132} w={2.5} head={6} />
          <Box x={k.cx - 28} y={134} w={56} h={26} r={8} tone="card" />
          <Lab x={k.cx} y={151} size={11}>{k.t}</Lab>
          {/* 작업마다 새로 넣는 데이터 — 맨 위 띠와 견주라고 같은 모양으로 그린다 */}
          <rect x={k.cx - 11} y={166} width={22} height={8} rx={4} className="vz-mute" stroke="currentColor" strokeWidth={2} />
        </g>
      ))}
      <Lab x={306} y={174} anchor="end" size={11} tone="ok">이만큼만</Lab>
      <Lab x={160} y={190}>밑동은 한 번, 작업마다는 조금</Lab>
    </Frame>
  )
}

// ── 강건성(Robustness) ──────────────────────────────────────────────────────
// 두 선의 **왼쪽 끝이 뒤집혀 있는 것**이 핵심이다 — 조건이 딱 맞을 땐 약한 쪽이 더 높다.
// 슬라이더로 조건을 흔들면 그 우열이 뒤집히는 지점을 손으로 찾게 된다.
const RB_N = 40
const rbX = (t: number) => 30 + t * 260
const rbY = (p: number) => 140 - p * 1.05
const rbA = (t: number) => 92 - 12 * t // 강건한 쪽 — 거의 평평하다
const rbB = (t: number) => 96 - 90 * Math.pow(t, 2.2) // 약한 쪽 — 처음엔 더 높다가 꺾인다
const rbPath = (f: (t: number) => number) =>
  Array.from({ length: RB_N + 1 }, (_, i) => {
    const t = i / RB_N
    return `${i ? 'L' : 'M'}${rbX(t).toFixed(1)} ${rbY(f(t)).toFixed(1)}`
  }).join(' ')
const RB_PA = rbPath(rbA)
const RB_PB = rbPath(rbB)

function B16Robust() {
  const [s, setS] = useState(0)
  const t = s / 100
  const pa = rbA(t)
  const pb = rbB(t)
  return (
    <Frame
      h={172}
      foot={
        <>
          <input
            className="dy-viz-range"
            type="range"
            min={0}
            max={100}
            value={s}
            onChange={(e) => setS(Number(e.target.value))}
            aria-label="조건이 달라지는 정도"
          />
          <span className={`dy-viz-state${pb < 50 ? ' crack' : ''}`}>
            {'강건'} {Math.round(pa)}% · {'약함'} {Math.round(pb)}%
          </span>
        </>
      }
    >
      <line x1={30} y1={28} x2={30} y2={140} stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
      <line x1={30} y1={140} x2={300} y2={140} stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
      <Lab x={12} y={24} anchor="start" size={11}>성능</Lab>
      <Lab x={172} y={24} size={11}>딱 맞을 땐 약한 쪽이 더 높다</Lab>

      <path d={RB_PB} fill="none" className="vz-goal" strokeWidth={3} strokeLinecap="round" />
      <path d={RB_PA} fill="none" className="vz-arrow" strokeWidth={3} strokeLinecap="round" />

      {/* 지금 보고 있는 조건 */}
      <line x1={rbX(t)} y1={30} x2={rbX(t)} y2={140} className="vz-dash" strokeWidth={2} />
      <circle cx={rbX(t)} cy={rbY(pb)} r={6} className="vz-target-c" stroke="currentColor" strokeWidth={2.5} />
      <circle cx={rbX(t)} cy={rbY(pa)} r={6} className="vz-node-on" stroke="currentColor" strokeWidth={2.5} />

      <Lab x={298} y={46} anchor="end" size={11} tone="ok">강건</Lab>
      <Lab x={240} y={128} size={11} tone="bad">무너진다</Lab>
      <Lab x={300} y={160} anchor="end" size={11}>조건이 달라진다 →</Lab>
    </Frame>
  )
}

export const VISUALS_B16: Record<string, () => ReactNode> = {
  b16_embedded: B16Embedded,
  b16_realtime: B16Realtime,
  b16_sim2real: B16Sim2Real,
  b16_vla: B16Vla,
  b16_foundation: B16Foundation,
  b16_robust: B16Robust,
}
