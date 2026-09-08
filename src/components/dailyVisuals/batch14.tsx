// DAILY QUIZ 해설 그림 — 배치 14(자율성과 협업, 8개).
//
// 이 배치는 '겹치면 실패'인 짝이 셋이다 — 자율주행↔경로계획(다른 층), 촉각 센서↔자기수용감각(정반대 감각),
// 컴플라이언트 제어↔위치 고집(같은 힘에 다른 반응). 그래서 짝마다 서로 다른 장면을 그렸다 — 같은 그림의
// 변주로 흐르지 않게, 자율주행은 실시간 반응 장면을, 경로계획은 정지된 지도 위 계산 장면을 쓴다.
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Frame, Limb, Joint, Box, Arrow, Lab, Chip } from './kit'

// ── 자율주행 ─────────────────────────────────────────────────────────────
// 경로계획과 다른 층이라는 걸 보여주려고 미리 그려진 선을 쓰지 않는다 — 갑자기 나타난 사람에
// 그 자리에서 인식·판단·행동이 도는 장면을 보여준다(전체 고리 자체가 요점).
function B14Autodrive() {
  const [alert, setAlert] = useState(false)
  return (
    <Frame
      h={182}
      foot={
        <>
          <Chip on={!alert} onClick={() => setAlert(false)}>평소</Chip>
          <Chip on={alert} onClick={() => setAlert(true)}>사람이 나타남</Chip>
        </>
      }
    >
      <rect x={0} y={94} width={320} height={50} className="vz-mute" />
      <line x1={0} y1={119} x2={320} y2={119} className="vz-dash" strokeWidth={2} />

      {/* 차 + 인식 콘 — 위험할수록 좁고 짧게, 더 집중해서 본다 */}
      <rect x={30} y={98} width={54} height={26} rx={8} className="vz-brand" stroke="currentColor" strokeWidth={3} />
      <circle cx={44} cy={126} r={7} className="vz-card" stroke="currentColor" strokeWidth={3} />
      <circle cx={72} cy={126} r={7} className="vz-card" stroke="currentColor" strokeWidth={3} />
      <path
        d={alert ? 'M84 111 L150 82 L150 140 Z' : 'M84 111 L170 94 L170 128 Z'}
        className={alert ? 'vz-brand-hi' : 'vz-mute'}
        stroke="currentColor"
        strokeWidth={1.5}
        opacity={alert ? 1 : 0.5}
      />
      <Lab x={84} y={78} anchor="start" size={11} tone={alert ? 'hot' : 'mute'}>
        {alert ? '위험 인식' : '계속 인식하는 중'}
      </Lab>

      {!alert && <Arrow x1={90} y1={111} x2={300} y2={111} tone="flow" w={3} />}
      {alert && (
        <>
          {/* 갑자기 나타난 사람 */}
          <circle cx={230} cy={94} r={7} className="vz-card" stroke="currentColor" strokeWidth={3} />
          <line x1={230} y1={101} x2={230} y2={122} stroke="currentColor" strokeWidth={4} strokeLinecap="round" />
          <line x1={230} y1={122} x2={222} y2={136} stroke="currentColor" strokeWidth={4} strokeLinecap="round" />
          <line x1={230} y1={122} x2={238} y2={136} stroke="currentColor" strokeWidth={4} strokeLinecap="round" />
          {/* 판단→행동: 그 자리에서 감속 */}
          <path d="M90 111 C150 111 170 118 196 122" fill="none" className="vz-goal" strokeWidth={3} strokeLinecap="round" />
          <line x1={196} y1={122} x2={189} y2={117} className="vz-goal" strokeWidth={3} strokeLinecap="round" />
          <line x1={196} y1={122} x2={189} y2={125} className="vz-goal" strokeWidth={3} strokeLinecap="round" />
          <Lab x={196} y={142} size={11} tone="bad">판단→행동: 감속</Lab>
        </>
      )}
      <Lab x={160} y={172} size={12}>인식·판단·행동이 매 순간 도는 것</Lab>
    </Frame>
  )
}

// ── 경로계획 ─────────────────────────────────────────────────────────────
// 자율주행과 다른 층이라는 걸 보여주려고 정지된 지도 위 계산만 다룬다 — 인식 콘도, 움직이는 사람도 없다.
function B14Pathplan() {
  const [planned, setPlanned] = useState(false)
  return (
    <Frame
      h={178}
      foot={
        <>
          <Chip on={!planned} onClick={() => setPlanned(false)}>직선으로 가면</Chip>
          <Chip on={planned} onClick={() => setPlanned(true)}>계산해 둔 경로</Chip>
        </>
      }
    >
      <Box x={16} y={20} w={288} h={112} tone="card" />
      <Box x={112} y={58} w={30} h={74} tone="mute" />
      <Box x={200} y={26} w={28} h={54} tone="mute" />

      <circle cx={40} cy={124} r={8} className="vz-node-on" stroke="currentColor" strokeWidth={3} />
      <Lab x={40} y={142} size={11}>출발</Lab>
      <circle cx={282} cy={38} r={13} fill="none" className="vz-target" strokeWidth={3} />
      <circle cx={282} cy={38} r={4} className="vz-target-c" />
      <Lab x={282} y={14} size={11}>목적지</Lab>

      {!planned && (
        <>
          <line x1={40} y1={124} x2={282} y2={38} className="vz-goal" strokeWidth={3} strokeDasharray="6 5" />
          <Lab x={160} y={100} size={13} tone="bad">✗ 막혔다</Lab>
        </>
      )}
      {planned && (
        <path
          d="M40 124 C80 120 100 60 128 46 C155 34 175 90 214 96 C240 100 260 60 282 38"
          fill="none"
          className="vz-arrow"
          strokeWidth={3}
          strokeLinecap="round"
        />
      )}
      <Lab x={160} y={160} size={12}>장애물을 피해 미리 계산해 둔 한 줄</Lab>
    </Frame>
  )
}

// ── 협동로봇(코봇) ─────────────────────────────────────────────────────────
// 펜스가 없어도 되는 이유 = 힘·속도를 스스로 낮추고 접촉을 감지하기 때문. 그 반응을 직접 눌러 확인한다.
const COBOT_STEPS = [
  { key: 'far', chip: '멀리 있을 때', hx: 250, speed: 1 },
  { key: 'near', chip: '사람이 다가옴', hx: 176, speed: 0.42 },
  { key: 'touch', chip: '닿았다', hx: 140, speed: 0.08 },
] as const

function B14Cobot() {
  const [i, setI] = useState(0)
  const st = COBOT_STEPS[i]
  const tipX = 116
  const tipY = 82
  const zoneR = 70
  const inZone = st.hx - tipX < zoneR
  const barW = Math.max(4, Math.round(st.speed * 90))
  return (
    <Frame
      h={182}
      foot={COBOT_STEPS.map((s, n) => (
        <Chip key={s.key} on={n === i} onClick={() => setI(n)}>{s.chip}</Chip>
      ))}
    >
      {/* 안전거리 — 사람이 들어오면 물든다 */}
      <circle cx={tipX} cy={tipY} r={zoneR} className={inZone ? 'vz-scope2' : 'vz-scope1'} />

      <Box x={18} y={102} w={40} h={26} tone="mute" />
      <Limb x1={38} y1={102} x2={76} y2={56} />
      <Limb x1={76} y1={56} x2={tipX} y2={tipY} />
      <Joint x={38} y={102} r={6} />
      <Joint x={76} y={56} r={6} />
      <Joint x={tipX} y={tipY} r={6} />

      {/* 사람 — 다가올수록 안전거리 안으로 들어온다 */}
      <g stroke="currentColor" strokeWidth={4} strokeLinecap="round">
        <circle cx={st.hx} cy={52} r={9} className="vz-card" strokeWidth={3} />
        <line x1={st.hx} y1={61} x2={st.hx} y2={98} />
        <line x1={st.hx} y1={98} x2={st.hx - 12} y2={124} />
        <line x1={st.hx} y1={98} x2={st.hx + 12} y2={124} />
        <line x1={st.hx} y1={74} x2={st.hx - 16} y2={88} />
      </g>

      {/* 펜스가 있어야 할 자리 — 여기엔 없다 */}
      <line x1={172} y1={18} x2={172} y2={138} className="vz-dash" strokeWidth={2.5} />
      <g className="vz-goal" strokeWidth={3} strokeLinecap="round">
        <line x1={162} y1={12} x2={182} y2={32} />
        <line x1={182} y1={12} x2={162} y2={32} />
      </g>
      <Lab x={172} y={8} size={11} tone="bad">펜스 없음</Lab>

      <rect x={18} y={148} width={94} height={12} rx={6} className="vz-mute" stroke="currentColor" strokeWidth={2.5} />
      <rect x={20} y={150} width={barW} height={8} rx={4} className={inZone ? 'vz-brand-lo' : 'vz-brand-hi'} />
      <Lab x={18} y={170} anchor="start" size={11}>속도 {Math.round(st.speed * 100)}%</Lab>
      <Lab x={302} y={170} anchor="end" size={11} tone={inZone ? 'hot' : 'mute'}>
        {inZone ? '접촉 감지, 힘 줄임' : '안전거리 밖'}
      </Lab>
    </Frame>
  )
}

// ── 휴머노이드 로봇 ─────────────────────────────────────────────────────────
// '왜 사람 모양인가' — 계단이 이미 사람 다리 보폭에 맞춰져 있어서, 그 몸이라야 그대로 쓸 수 있다.
function B14Humanoid() {
  return (
    <Frame h={190}>
      <path
        d="M40 158 H136 V136 H168 V114 H200 V92 H232 V70 H264 V48 H300"
        fill="none"
        stroke="currentColor"
        strokeWidth={4}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Lab x={300} y={30} anchor="end" size={11}>사람 다리 보폭에 맞춘 높이</Lab>

      {/* 바퀴형 — 평평한 바닥까지만, 턱 앞에서 멈춘다 */}
      <Box x={62} y={118} w={38} h={26} tone="mute" />
      <circle cx={81} cy={149} r={9} className="vz-card" stroke="currentColor" strokeWidth={3} />
      <g className="vz-goal" strokeWidth={3} strokeLinecap="round">
        <line x1={108} y1={124} x2={124} y2={140} />
        <line x1={124} y1={124} x2={108} y2={140} />
      </g>
      <Lab x={81} y={172} size={11} tone="bad">바퀴형: 턱 앞에서 멈춘다</Lab>

      {/* 휴머노이드 — 다리 길이가 있어 다음 단, 그다음 단에 발을 놓는다 */}
      <circle cx={200} cy={62} r={9} className="vz-card" stroke="currentColor" strokeWidth={3} />
      <line x1={200} y1={71} x2={200} y2={80} stroke="currentColor" strokeWidth={4} strokeLinecap="round" />
      <line x1={200} y1={80} x2={184} y2={114} stroke="currentColor" strokeWidth={4} strokeLinecap="round" />
      <line x1={200} y1={80} x2={222} y2={92} stroke="currentColor" strokeWidth={4} strokeLinecap="round" />
      <circle cx={184} cy={114} r={3.5} className="vz-brand" />
      <circle cx={222} cy={92} r={3.5} className="vz-brand" />
      <Lab x={200} y={40} size={11} tone="hot">휴머노이드: 그대로 오른다</Lab>
    </Frame>
  )
}

// ── 촉각 센서 ─────────────────────────────────────────────────────────────
// 자기수용감각과 정반대에 세워야 하는 그림 — 이건 밖의 것을 만져야만 안다. 안 닿으면 아무것도 모른다.
function B14Tactile() {
  const [f, setF] = useState(35)
  const shiftY = Math.min(48, Math.round(f * 0.55))
  const touching = shiftY >= 47
  return (
    <Frame
      h={178}
      foot={
        <>
          <input
            className="dy-viz-range"
            type="range"
            min={0}
            max={100}
            value={f}
            onChange={(e) => setF(Number(e.target.value))}
            aria-label="누르는 힘"
          />
          <span className={`dy-viz-state${touching ? '' : ' drop'}`}>{touching ? `압력 ${f}` : '아직 안 닿음'}</span>
        </>
      }
    >
      <Box x={30} y={130} w={260} h={22} tone="card" />
      {Array.from({ length: 9 }, (_, i) => (
        <line
          key={i}
          x1={46 + i * 28}
          y1={130}
          x2={46 + i * 28}
          y2={122}
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
        />
      ))}

      {/* 손끝 — 힘을 줄수록 표면 쪽으로 내려간다 */}
      <g style={{ transform: `translateY(${shiftY}px)` }}>
        <Box x={140} y={30} w={40} h={54} tone="mute" />
        <rect
          x={148}
          y={70}
          width={24}
          height={12}
          rx={4}
          className={touching ? 'vz-brand' : 'vz-card'}
          stroke="currentColor"
          strokeWidth={2.5}
        />
      </g>

      <Lab x={160} y={22} size={11} tone={touching ? 'hot' : 'mute'}>
        {touching ? '닿았다 — 압력·질감을 읽는 중' : '떨어져 있으면 아무것도 모른다'}
      </Lab>
      <Lab x={160} y={166} size={11}>밖에서 오는 자극만 감지한다</Lab>
    </Frame>
  )
}

// ── 자기수용감각 ─────────────────────────────────────────────────────────────
// 촉각 센서와 정반대 — 밖에서 오는 자극이 하나도 없어도(카메라조차 꺼져 있어도) 관절 각도는 스스로 안다.
function B14Proprio() {
  const [deg, setDeg] = useState(28)
  return (
    <Frame
      h={182}
      foot={
        <input
          className="dy-viz-range"
          type="range"
          min={-60}
          max={60}
          value={deg}
          onChange={(e) => setDeg(Number(e.target.value))}
          aria-label="관절 각도"
        />
      }
    >
      <Box x={98} y={98} w={40} h={26} tone="mute" />
      <g style={{ transform: `rotate(${deg}deg)`, transformOrigin: '118px 100px' }}>
        <Limb x1={118} y1={100} x2={118} y2={30} />
      </g>
      <Joint x={118} y={100} r={6} />
      <Lab x={118} y={148} size={11} tone="hot">관절 각도 {deg}°</Lab>
      <Lab x={118} y={163} size={11}>밖을 안 봐도 스스로 안다</Lab>

      {/* 꺼진 카메라 — 외부 시각 센서가 없어도 각도는 안다 */}
      <g transform="translate(232,44)">
        <rect x={-26} y={-16} width={52} height={34} rx={8} className="vz-card" stroke="currentColor" strokeWidth={3} />
        <circle cx={0} cy={1} r={9} fill="none" stroke="currentColor" strokeWidth={3} />
        <g className="vz-goal" strokeWidth={3} strokeLinecap="round">
          <line x1={-9} y1={-8} x2={9} y2={10} />
          <line x1={9} y1={-8} x2={-9} y2={10} />
        </g>
      </g>
      <Lab x={232} y={80} size={11} tone="bad">카메라 꺼짐</Lab>
    </Frame>
  )
}

// ── 컴플라이언트 제어 ─────────────────────────────────────────────────────────
// 위치를 고집하는 제어와 나란히 놓아야 하는 개념 — 같은 힘을 받았을 때 버티는 쪽과 물러나는 쪽을 대조한다.
function B14Compliant() {
  const [pushed, setPushed] = useState(false)
  const timer = useRef(0)
  const push = () => {
    setPushed(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setPushed(false), 550)
  }
  return (
    <Frame h={176} foot={<Chip onClick={push}>바깥에서 밀어보기</Chip>}>
      <line x1={150} y1={20} x2={150} y2={144} className="vz-dash" strokeWidth={2} />
      <Lab x={60} y={26} size={11}>위치 제어</Lab>
      <Lab x={240} y={26} size={11}>컴플라이언트 제어</Lab>

      {/* 위치 고집형 — 안 밀린다, 대신 무리가 간다 */}
      <Box x={40} y={110} w={40} h={24} tone="mute" />
      <Limb x1={60} y1={110} x2={60} y2={50} />
      <Joint x={60} y={110} r={6} />
      {pushed && (
        <path
          d="M52 62 l6 8 -5 7 7 8"
          fill="none"
          className="vz-crack"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      <Arrow x1={112} y1={64} x2={82} y2={64} tone={pushed ? 'bad' : 'dash'} w={3} />
      <Lab x={60} y={140} size={11} tone={pushed ? 'bad' : 'mute'}>
        {pushed ? '버티다 무리간다' : '위치를 고집한다'}
      </Lab>

      {/* 컴플라이언트 — 밀리는 만큼 물러나 힘을 흡수한다 */}
      <Box x={220} y={110} w={40} h={24} tone="mute" />
      <g style={{ transform: pushed ? 'rotate(-26deg)' : 'rotate(0deg)', transformOrigin: '240px 110px' }}>
        <Limb x1={240} y1={110} x2={240} y2={50} />
      </g>
      <Joint x={240} y={110} r={6} />
      <Arrow x1={288} y1={64} x2={258} y2={64} tone={pushed ? 'flow' : 'dash'} w={3} />
      <Lab x={240} y={140} size={11} tone={pushed ? 'ok' : 'mute'}>
        {pushed ? '밀린 만큼 물러난다' : '힘이 오면 비켜준다'}
      </Lab>

      <Lab x={160} y={162} size={11}>같은 힘, 다른 반응</Lab>
    </Frame>
  )
}

// ── 스와름 로보틱스 ─────────────────────────────────────────────────────────
// 지휘자 없이, 이웃 몇 대만 보는 규칙에서 전체 대형이 나온다 — 같은 규칙을 적용하면 흩어진 게 저절로 원이 된다.
const SWARM_SCATTER: [number, number][] = [
  [70, 80],
  [110, 110],
  [150, 72],
  [170, 118],
  [205, 86],
  [235, 120],
  [265, 78],
]
const SWARM_SCATTER_PAIRS: [number, number][] = [
  [0, 1],
  [1, 2],
  [1, 3],
  [2, 4],
  [3, 4],
  [4, 5],
  [5, 6],
]
const SWARM_FORMED: [number, number][] = [
  [165, 49],
  [201, 66],
  [210, 105],
  [185, 136],
  [145, 136],
  [120, 105],
  [129, 66],
]
const SWARM_FORMED_PAIRS: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
  [5, 6],
  [6, 0],
]

function B14Swarm() {
  const [formed, setFormed] = useState(false)
  return (
    <Frame h={172} foot={<Chip on={formed} onClick={() => setFormed((v) => !v)}>이웃만 보는 규칙 적용</Chip>}>
      {/* 지휘자 없음 — 이걸 지우지 않으면 '규칙에서 나온다'가 안 읽힌다 */}
      <rect x={16} y={16} width={34} height={26} rx={6} className="vz-card" stroke="currentColor" strokeWidth={3} />
      <line x1={16} y1={16} x2={50} y2={42} className="vz-goal" strokeWidth={3} strokeLinecap="round" />
      <line x1={50} y1={16} x2={16} y2={42} className="vz-goal" strokeWidth={3} strokeLinecap="round" />
      {/* ⚠️ 왼쪽 끝에 가까운 라벨은 anchor="start" 로 둔다 — 가운데 정렬이면 번역문이 길어질 때 상자 밖으로 나간다. */}
      <Lab x={10} y={54} size={11} tone="bad" anchor="start">지휘자 없음</Lab>

      <g style={{ opacity: formed ? 0 : 1, transition: 'opacity .3s ease' }}>
        {SWARM_SCATTER_PAIRS.map(([i, j], k) => (
          <line
            key={k}
            x1={SWARM_SCATTER[i][0]}
            y1={SWARM_SCATTER[i][1]}
            x2={SWARM_SCATTER[j][0]}
            y2={SWARM_SCATTER[j][1]}
            className="vz-web"
            strokeWidth={1.6}
          />
        ))}
        {SWARM_SCATTER.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={9} className="vz-node" stroke="currentColor" strokeWidth={2.5} />
        ))}
        <Lab x={165} y={150} size={11}>각자 옆만 본다</Lab>
      </g>

      <g style={{ opacity: formed ? 1 : 0, transition: 'opacity .3s ease' }}>
        {SWARM_FORMED_PAIRS.map(([i, j], k) => (
          <line
            key={k}
            x1={SWARM_FORMED[i][0]}
            y1={SWARM_FORMED[i][1]}
            x2={SWARM_FORMED[j][0]}
            y2={SWARM_FORMED[j][1]}
            className="vz-web"
            strokeWidth={1.6}
          />
        ))}
        {SWARM_FORMED.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={9} className="vz-node-on" stroke="currentColor" strokeWidth={2.5} />
        ))}
        <Lab x={165} y={150} size={11} tone="ok">옆만 봤는데 전체가 원이 됐다</Lab>
      </g>
    </Frame>
  )
}

export const VISUALS_B14: Record<string, () => ReactNode> = {
  b14_autodrive: B14Autodrive,
  b14_pathplan: B14Pathplan,
  b14_cobot: B14Cobot,
  b14_humanoid: B14Humanoid,
  b14_tactile: B14Tactile,
  b14_proprio: B14Proprio,
  b14_compliant: B14Compliant,
  b14_swarm: B14Swarm,
}
