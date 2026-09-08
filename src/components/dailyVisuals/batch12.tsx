// DAILY QUIZ(/daily) 해설 그림 — 배치 12 「공장이 디지털로 옮겨가는 층계」.
//
// ⛔ 색은 클래스로만 칠한다(daily.css 의 .vz-*). SVG 속성에는 var() 가 안 먹어서 #hex 를 박으면
//    한쪽 테마에서 그림이 증발한다. 선은 stroke="currentColor", 면은 .vz-* 클래스.
// ⚠️ 엣지 컴퓨팅(b12_edge)과 온디바이스 AI(b12_ondevice)는 헷갈리는 짝이라 **그림이 서로 달라야 한다** —
//    엣지는 '얼마나 멀리 갔다 오나'(거리·왕복 시간), 온디바이스는 '데이터가 기기 밖으로 나가나'(경계·차단).
//    한쪽을 고칠 때 다른 쪽과 같은 모양이 되지 않게 할 것.
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Frame, Limb, Joint, Box, Arrow, Lab } from './kit'

// ── 엣지 컴퓨팅 ─────────────────────────────────────────────────────────────
// 같은 설비에서 나온 두 갈래 길. 하나는 화면 끝까지 올라갔다 돌아오고, 하나는 옆으로 한 뼘 갔다 온다.
// 거리가 곧 시간이라는 걸 화살표 길이로 보여 준다 — 문장으로 쓰면 안 남는다.
function B12Edge() {
  return (
    <Frame h={196}>
      {/* 현장 울타리 — '가까이'가 어디까지인지 눈으로 묶어 준다 */}
      <rect x={8} y={102} width={164} height={54} rx={14} className="vz-dash" strokeWidth={2.5} />
      <Lab x={10} y={96} anchor="start" size={11}>현장</Lab>

      <Box x={228} y={18} w={80} h={46} />
      <Lab x={268} y={46} size={12}>클라우드</Lab>

      {/* 먼 길 — 위로 빠져나가 오른쪽 끝까지 갔다가 다시 내려온다 */}
      <g className="vz-arrow" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M46 110 V36 H214" />
        <path d="M214 36 l-9 -5 m9 5 l-9 5" />
        <path d="M222 54 H60 V106" />
        <path d="M60 106 l-5 -9 m5 9 l5 -9" />
      </g>
      <Lab x={132} y={86} tone="bad" size={12}>왕복 120 ms</Lab>

      <Box x={16} y={110} w={62} h={38} tone="mute" />
      <Lab x={47} y={134} size={12}>설비</Lab>
      <Box x={100} y={110} w={62} h={38} tone="teal" />
      <Lab x={131} y={134} tone="inv" size={12}>엣지</Lab>

      {/* 짧은 길 — 옆칸까지 갔다 온다 */}
      <Arrow x1={82} y1={120} x2={96} y2={120} head={6} />
      <Arrow x1={96} y1={138} x2={82} y2={138} head={6} />
      <Lab x={86} y={170} tone="ok" size={12}>왕복 5 ms</Lab>

      <Lab x={160} y={188} size={11}>답이 돌아오는 사이 물건은 지나간다</Lab>
    </Frame>
  )
}

// ── 디지털 트윈 ─────────────────────────────────────────────────────────────
// 같은 팔 두 대. 슬라이더를 밀면 **둘이 같은 각도로 같이 움직인다** — 그 붙어 있음이 이 개념의 전부다.
// 오른쪽은 점선 + 격자(가상 공간)로 그려 실물과 구분하고, 두 화살표가 오가는 것의 이름을 붙인다.
function B12Twin() {
  const [t, setT] = useState(42)
  const a1 = ((-25 - t * 0.8) * Math.PI) / 180
  const a2 = a1 + (50 * Math.PI) / 180
  const geo = (bx: number, by: number) => {
    const ex = bx + 42 * Math.cos(a1)
    const ey = by + 42 * Math.sin(a1)
    return { bx, by, ex, ey, tx: ex + 36 * Math.cos(a2), ty: ey + 36 * Math.sin(a2) }
  }
  const L = geo(66, 126)
  const R = geo(222, 126)
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
            value={t}
            onChange={(e) => setT(Number(e.target.value))}
            aria-label="관절 각도"
          />
          <span className="dy-viz-hint">복제본이 같은 각도로 따라온다</span>
        </>
      }
    >
      {/* 가상 공간 — 격자를 깔아 '여기는 화면 속'이라고 말한다 */}
      <g className="vz-web" strokeWidth={1.2}>
        {[192, 208, 224, 240, 256, 272, 288].map((x) => (
          <line key={`gv${x}`} x1={x} y1={34} x2={x} y2={142} />
        ))}
        {[38, 54, 70, 86, 102, 118, 134].map((y) => (
          <line key={`gh${y}`} x1={186} y1={y} x2={298} y2={y} />
        ))}
      </g>

      {/* 실물 — 굵은 카툰 팔 */}
      <rect x={46} y={126} width={40} height={16} rx={5} className="vz-mute" stroke="currentColor" strokeWidth={3} />
      <Limb x1={L.bx} y1={L.by} x2={L.ex} y2={L.ey} />
      <Limb x1={L.ex} y1={L.ey} x2={L.tx} y2={L.ty} w={13} />
      <Joint x={L.bx} y={L.by} />
      <Joint x={L.ex} y={L.ey} r={6} />
      <Joint x={L.tx} y={L.ty} r={5} />

      {/* 복제본 — 같은 좌표에서 같은 각도로 그린다. 점선이라 실물이 아니라는 것만 다르다 */}
      <rect
        x={202} y={126} width={40} height={16} rx={5}
        className="vz-mute" stroke="currentColor" strokeWidth={3} strokeDasharray="7 5"
      />
      <g stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeDasharray="7 5" fill="none">
        <line x1={R.bx} y1={R.by} x2={R.ex} y2={R.ey} />
        <line x1={R.ex} y1={R.ey} x2={R.tx} y2={R.ty} />
      </g>
      <circle cx={R.ex} cy={R.ey} r={5} className="vz-mute" stroke="currentColor" strokeWidth={2.5} />
      <circle cx={R.tx} cy={R.ty} r={4} className="vz-mute" stroke="currentColor" strokeWidth={2.5} />

      {/* 두 방향이 다 있어야 트윈이다 — 한쪽만 있으면 그냥 모니터링이거나 그냥 모형이다 */}
      <Arrow x1={142} y1={68} x2={204} y2={68} />
      <Lab x={173} y={58} tone="ok" size={11}>지금 상태</Lab>
      <Arrow x1={204} y1={104} x2={142} y2={104} tone="turn" />
      <Lab x={173} y={94} size={11}>돌려 본 결과</Lab>

      <Lab x={66} y={160} size={12}>실물 설비</Lab>
      <Lab x={222} y={160} tone="hot" size={12}>가상 복제본</Lab>
    </Frame>
  )
}

// ── 온디바이스 AI ───────────────────────────────────────────────────────────
// 요점은 거리가 아니라 **경계**다. 기기 벽 안에서 센서→모델→판단이 다 끝나고,
// 밖으로 나가려는 선은 벽에서 X 로 끊긴다. (엣지 그림과 달리 왕복 화살표를 쓰지 않는다.)
function B12OnDevice() {
  return (
    <Frame h={186}>
      {/* 기기 — 벽을 굵게 그려야 '안'과 '밖'이 생긴다 */}
      <rect x={14} y={22} width={192} height={130} rx={18} className="vz-card" stroke="currentColor" strokeWidth={4} />
      <Lab x={26} y={42} tone="hot" anchor="start" size={12}>기기 안</Lab>

      <Box x={30} y={56} w={52} h={32} tone="mute" />
      <Lab x={56} y={77} size={12}>센서</Lab>
      <Arrow x1={86} y1={72} x2={108} y2={72} head={7} />
      <Box x={112} y={52} w={64} h={40} tone="brand" />
      <Lab x={144} y={77} tone="inv" size={12}>AI 모델</Lab>
      <Arrow x1={144} y1={96} x2={144} y2={110} head={7} />
      <Box x={106} y={114} w={76} h={28} tone="teal" />
      <Lab x={144} y={133} tone="inv" size={12}>판단</Lab>

      {/* 밖으로 나가려던 원본이 벽에서 끊긴다 */}
      <line x1={182} y1={70} x2={240} y2={70} className="vz-goal" strokeWidth={3} strokeDasharray="6 5" />
      <g className="vz-goal" strokeWidth={4} strokeLinecap="round">
        <line x1={205} y1={64} x2={217} y2={76} />
        <line x1={217} y1={64} x2={205} y2={76} />
      </g>
      <Lab x={211} y={52} tone="bad" size={11}>원본 데이터</Lab>
      <Lab x={211} y={94} tone="bad" size={11}>안 나간다</Lab>

      <Box x={246} y={52} w={62} h={40} tone="mute" />
      <Lab x={277} y={77} size={12}>서버</Lab>
      <Lab x={277} y={42} size={11}>기기 밖</Lab>

      <Lab x={160} y={172} size={11}>네트워크가 끊겨도 돌아간다</Lab>
    </Frame>
  )
}

// ── 예지 보전 ───────────────────────────────────────────────────────────────
// 측정값이 서서히 우상향하고, 그 추세를 그대로 이어 보면 고장선과 만나는 지점이 나온다.
// 정비 시점은 그 앞이다. 아래 점선 눈금(달력)은 신호와 아무 상관없이 균등하게 찍힌다.
const PDM_PTS = [
  [34, 138], [62, 134], [90, 128], [118, 122], [146, 112], [174, 102], [198, 88],
] as const

function B12Pdm() {
  return (
    <Frame h={200}>
      <Lab x={26} y={30} anchor="start" size={11}>진동 세기</Lab>

      {/* 고장선 — 여기 닿으면 끝이다 */}
      <line x1={26} y1={50} x2={304} y2={50} className="vz-goal" strokeWidth={3} strokeDasharray="8 6" />
      <Lab x={30} y={44} tone="bad" anchor="start" size={11}>고장선</Lab>

      <line x1={26} y1={150} x2={304} y2={150} stroke="currentColor" strokeWidth={3} strokeLinecap="round" />

      {/* 지금까지 잰 것 */}
      <polyline
        points={PDM_PTS.map((p) => p.join(',')).join(' ')}
        fill="none" stroke="currentColor" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round"
      />
      {PDM_PTS.map(([x, y]) => (
        <circle key={`m${x}`} cx={x} cy={y} r={3.5} className="vz-node-on" stroke="currentColor" strokeWidth={2} />
      ))}

      {/* 이대로 가면 — 추세를 그대로 이어 고장선과 만나는 점 */}
      <line x1={198} y1={88} x2={263} y2={50} className="vz-turn" strokeWidth={3} strokeDasharray="8 6" />
      <circle cx={263} cy={50} r={6} className="vz-target-c" />
      <Lab x={263} y={38} tone="bad" size={11}>고장 예상</Lab>

      {/* 손보는 시점은 그 앞 */}
      <line x1={198} y1={88} x2={198} y2={150} className="vz-arrow" strokeWidth={3} />
      <circle cx={198} cy={88} r={5} className="vz-teal" stroke="currentColor" strokeWidth={2.5} />
      <Lab x={204} y={110} tone="ok" anchor="start" size={11}>여기서 정비</Lab>

      {/* 달력 — 신호와 무관하게 균등하다 */}
      <g className="vz-dash" strokeWidth={2.5}>
        {[76, 152, 228].map((x) => (
          <line key={`c${x}`} x1={x} y1={150} x2={x} y2={160} />
        ))}
      </g>
      <Lab x={28} y={172} anchor="start" size={11}>정기 점검일</Lab>

      <Lab x={160} y={190} size={11}>추세를 이어 보면 언제 넘을지 보인다</Lab>
    </Frame>
  )
}

// ── 처방적 분석 ─────────────────────────────────────────────────────────────
// 네 칸 층계. 앞의 셋은 '알려 주는' 칸이고, 맨 위 칸만 밖으로 나가는 화살표를 갖는다 —
// 그 화살표 끝에 붙은 구체적인 조치가 이 단계의 정체다.
const PA_STEPS = [
  { x: 12, y: 128, q: '무슨 일이', s: '설명' },
  { x: 68, y: 106, q: '왜 그랬나', s: '진단' },
  { x: 124, y: 84, q: '앞으로는', s: '예측' },
  { x: 180, y: 62, q: '뭘 할까', s: '처방' },
] as const

function B12Prescriptive() {
  return (
    <Frame h={186}>
      <path
        d="M12 152 V128 H68 V106 H124 V84 H180 V62 H238 V152 Z"
        className="vz-mute" stroke="currentColor" strokeWidth={3} strokeLinejoin="round"
      />
      {PA_STEPS.map((st, i) => (
        <g key={st.s}>
          <Lab x={st.x + 28} y={st.y - 8} size={11}>{st.q}</Lab>
          <Box x={st.x + 4} y={st.y + 3} w={48} h={18} r={7} tone={i === 3 ? 'brand' : 'card'} />
          <Lab x={st.x + 28} y={st.y + 16} tone={i === 3 ? 'inv' : 'mute'} size={11}>{st.s}</Lab>
        </g>
      ))}

      {/* 맨 위 칸에서만 밖으로 나가는 것 — 시키는 말 */}
      <Arrow x1={241} y1={74} x2={258} y2={94} />
      <Box x={246} y={96} w={66} h={48} tone="brand" />
      <Lab x={279} y={116} tone="inv" size={11}>조치</Lab>
      <Lab x={279} y={134} tone="inv" size={11}>압력 −15%</Lab>
      <Lab x={279} y={158} size={11}>설비로</Lab>

      <Lab x={160} y={172} size={11}>앞의 셋은 알려 주고, 넷째가 시킨다</Lab>
    </Frame>
  )
}

export const VISUALS_B12: Record<string, () => ReactNode> = {
  b12_edge: B12Edge,
  b12_twin: B12Twin,
  b12_ondevice: B12OnDevice,
  b12_pdm: B12Pdm,
  b12_stairs: B12Prescriptive,
}
