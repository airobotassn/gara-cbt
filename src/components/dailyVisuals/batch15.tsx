// DAILY QUIZ 해설 그림 — 배치 15 · 학습의 기본기(신경망 한 알 ~ 학습 방식 네 가지 ~ 흔한 실수/손잡이).
//
// 이 여덟 개 중 절반(지도·비지도·강화·모방학습)은 전부 "학습 방식"이라 자칫 넷 다 같은 그림이 된다.
// 그래서 넷을 각자 다른 메커니즘으로 갈랐다:
//   b15_supervised    정답표가 늘 옆에 붙어 있고, 예측과 즉시 대조돼 안으로 되먹임된다
//   b15_unsupervised  정답표 자체가 없다 — 위치만 보고 스스로 뭉친다(전/후 토글)
//   b15_reinforce     정답 대조가 아니라, 몇 걸음 뒤에야 오는 보상이 지나온 길 전체를 강화한다
//   b15_imitate       보상도 시행착오도 없이, 남이 보여준 궤적 위를 점 하나씩 그대로 따라간다
// 나머지 넷:
//   b15_neuron        딥러닝(DeepLayers)이 이미 "층이 쌓인다"를 보여주므로, 여기는 그 층을 이루는
//                     뉴런 한 알 — 입력×가중치의 합이 문턱을 넘는지가 전부다
//   b15_overfit       같은 점을 다 지나는 곡선 ↔ 부드럽게 지나는 곡선, 새 점 하나로 승부가 갈린다
//   b15_transformer   한 글자씩 순서대로(RNN 식) ↔ 전부 동시에 올려놓고 서로 참조(트랜스포머)
//   b15_hyper         진짜 슬라이더가 "사람이 돌리는 손잡이"이고, 손잡이 값이 수렴/발산을 가른다
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Frame, Box, Arrow, Lab, Chip } from './kit'

// ── 신경망(뉴런 하나) ────────────────────────────────────────────────────────
const N_INPUTS = [
  { key: 'x1', w: 0.7 },
  { key: 'x2', w: -0.5 },
  { key: 'x3', w: 0.9 },
] as const
const N_THRESH = 0.6

function B15Neuron() {
  const [on, setOn] = useState([true, false, true])
  const sum = N_INPUTS.reduce((s, inp, i) => s + (on[i] ? inp.w : 0), 0)
  const fires = sum >= N_THRESH
  const ys = [44, 97, 150] as const
  const sx = 168
  const sy = 97
  const ox = 268
  return (
    <Frame
      h={192}
      foot={N_INPUTS.map((inp, i) => (
        <Chip key={inp.key} on={on[i]} onClick={() => setOn((a) => a.map((v, j) => (j === i ? !v : v)))}>
          {inp.key} {on[i] ? 'ON' : 'OFF'}
        </Chip>
      ))}
    >
      {N_INPUTS.map((inp, i) => {
        const y = ys[i]
        const active = on[i]
        return (
          <g key={inp.key}>
            <line
              x1={63} y1={y} x2={sx - 22} y2={sy}
              className={inp.w >= 0 ? 'vz-arrow' : 'vz-goal'}
              strokeWidth={1.5 + Math.abs(inp.w) * 8}
              strokeOpacity={active ? 1 : 0.16}
              strokeLinecap="round"
            />
            <circle cx={46} cy={y} r={17} className={active ? 'vz-node-on' : 'vz-node'} stroke="currentColor" strokeWidth={2.5} />
            <Lab x={46} y={y + 4} size={12} tone={active ? 'inv' : 'mute'}>{active ? '1' : '0'}</Lab>
            <Lab x={46} y={y - 24} size={11} tone={inp.w >= 0 ? 'ok' : 'bad'}>{inp.w > 0 ? `+${inp.w}` : `${inp.w}`}</Lab>
          </g>
        )
      })}
      <circle cx={sx} cy={sy} r={24} className="vz-card" stroke="currentColor" strokeWidth={3} />
      <Lab x={sx} y={sy - 5} size={11}>합</Lab>
      <Lab x={sx} y={sy + 12} size={13} tone="hot">{sum.toFixed(1)}</Lab>
      <Arrow x1={sx + 24} y1={sy} x2={ox - 21} y2={sy} />
      <Lab x={(sx + ox) / 2 + 2} y={sy - 16} size={11}>문턱 {N_THRESH}</Lab>
      <circle cx={ox} cy={sy} r={20} className={fires ? 'vz-node-on' : 'vz-node'} stroke="currentColor" strokeWidth={3} />
      <Lab x={ox} y={sy + 40} size={12} tone={fires ? 'ok' : 'bad'}>{fires ? '켜짐' : '꺼짐'}</Lab>
      <Lab x={160} y={182} size={12} tone="hot">입력×가중치의 합이 문턱을 넘으면 신호가 간다</Lab>
    </Frame>
  )
}

// ── 지도학습 ────────────────────────────────────────────────────────────────
const SV_LABEL = '고양이'
const SV_GUESSES = ['강아지', '여우', '고양이'] as const

function B15Supervised() {
  const [step, setStep] = useState(0)
  const guess = SV_GUESSES[step]
  const match = guess === SV_LABEL
  return (
    <Frame h={208} foot={<Chip on={match} onClick={() => setStep((s) => (s + 1) % SV_GUESSES.length)}>다음 시도</Chip>}>
      <Box x={90} y={12} w={140} h={44} r={12} />
      <Lab x={160} y={30} size={12}>사진 한 장</Lab>
      <Lab x={160} y={48} size={12} tone="hot">정답: {SV_LABEL}</Lab>

      <Arrow x1={160} y1={58} x2={160} y2={74} />
      <Box x={110} y={78} w={100} h={34} r={12} tone="brand" />
      <Lab x={160} y={99} size={13} tone="inv">모델</Lab>

      <Arrow x1={160} y1={114} x2={160} y2={130} />
      <Box x={110} y={134} w={100} h={34} r={10} />
      <Lab x={160} y={155} size={12} tone={match ? 'ok' : 'bad'}>예측: {guess}</Lab>
      <Lab x={222} y={158} size={16} tone={match ? 'ok' : 'bad'}>{match ? '✓' : '✗'}</Lab>

      <path d="M230 48 C 270 48 270 155 232 155" fill="none" className="vz-dash" strokeWidth={2} />
      <Lab x={276} y={100} size={11}>바로 대조</Lab>

      {!match && (
        <>
          <path d="M110 151 C 58 151 58 96 108 96" fill="none" className="vz-fb" strokeWidth={3} strokeLinecap="round" />
          <line x1={108} y1={96} x2={99} y2={90} className="vz-fb" strokeWidth={3} strokeLinecap="round" />
          <line x1={108} y1={96} x2={101} y2={102} className="vz-fb" strokeWidth={3} strokeLinecap="round" />
          <Lab x={30} y={122} size={11} tone="hot" anchor="start">오차로 조정</Lab>
        </>
      )}
      {match && <Lab x={222} y={99} size={11} tone="ok" anchor="start">그대로 둔다</Lab>}

      <Lab x={160} y={196} size={12} tone="hot">정답표와 대조하며 맞을 때까지 조정한다</Lab>
    </Frame>
  )
}

// ── 비지도학습 ──────────────────────────────────────────────────────────────
const UN_POINTS = [
  { x: 58, y: 48, g: 0 }, { x: 80, y: 38, g: 0 }, { x: 48, y: 70, g: 0 },
  { x: 232, y: 44, g: 1 }, { x: 256, y: 60, g: 1 }, { x: 210, y: 64, g: 1 },
  { x: 140, y: 112, g: 2 }, { x: 160, y: 130, g: 2 }, { x: 120, y: 124, g: 2 },
] as const
const UN_GROUP_CLASS = ['vz-brand', 'vz-teal', 'vz-gold-f'] as const
const UN_BLOBS = [
  { cx: 63, cy: 53, rx: 36, ry: 32 },
  { cx: 233, cy: 56, rx: 36, ry: 32 },
  { cx: 140, cy: 122, rx: 40, ry: 32 },
] as const

function B15Unsupervised() {
  const [after, setAfter] = useState(false)
  return (
    <Frame h={196} foot={<Chip on={after} onClick={() => setAfter((v) => !v)}>{after ? '라벨 없이 시작' : '군집화하기'}</Chip>}>
      <Lab x={160} y={16} size={12} tone={after ? 'hot' : 'mute'}>{after ? '스스로 나눈 무리' : '라벨 없는 점들'}</Lab>
      {after && UN_BLOBS.map((b, i) => (
        <ellipse key={i} cx={b.cx} cy={b.cy} rx={b.rx} ry={b.ry} className="vz-scope1" stroke="currentColor" strokeWidth={2} />
      ))}
      {UN_POINTS.map((p, i) => (
        <circle
          key={i}
          cx={p.x} cy={p.y} r={6}
          className={after ? UN_GROUP_CLASS[p.g] : 'vz-node'}
          stroke="currentColor" strokeWidth={2}
        />
      ))}
      <Lab x={160} y={186} size={12}>누구도 답을 안 알려줘도 가까운 것끼리 모인다</Lab>
    </Frame>
  )
}

// ── 강화학습 ────────────────────────────────────────────────────────────────
const RL_NODES = [40, 120, 200, 280] as const
const RL_Y = 96

function B15Reinforce() {
  const [step, setStep] = useState(0) // 0=출발만, 1~3=한 칸씩 이동, 4=보상이 되먹임
  const reached = (i: number) => step >= i
  const reinforced = step >= 4
  const gotReward = step >= 3
  const cap =
    step < 3 ? '행동을 해 본다 — 아직 보상 없음'
    : step === 3 ? '마지막에 도착 — 보상 +1'
    : '보상이 지나온 길 전체를 강화한다'
  return (
    <Frame h={196} foot={<Chip on={reinforced} onClick={() => setStep((s) => (s + 1) % 5)}>다음 행동</Chip>}>
      <Lab x={160} y={16} size={12} tone={step >= 3 ? 'hot' : 'mute'}>{cap}</Lab>

      {[0, 1, 2].map((i) => (
        <line
          key={i}
          x1={RL_NODES[i] + 16} y1={RL_Y} x2={RL_NODES[i + 1] - 16} y2={RL_Y}
          className={reached(i + 1) ? (reinforced ? 'vz-turn' : 'vz-arrow') : 'vz-dash'}
          strokeWidth={reinforced ? 6 : 3}
          strokeLinecap="round"
        />
      ))}

      {RL_NODES.map((x, i) => (
        <circle key={i} cx={x} cy={RL_Y} r={14} className={reached(i) ? 'vz-node-on' : 'vz-node'} stroke="currentColor" strokeWidth={2.5} />
      ))}

      {gotReward && (
        <g>
          <circle cx={280} cy={58} r={14} className="vz-gold-f" stroke="currentColor" strokeWidth={2.5} />
          <Lab x={280} y={62} size={12} tone="inv">+1</Lab>
        </g>
      )}

      {reinforced && (
        <>
          <path d="M280 116 C 210 148 110 148 40 116" fill="none" className="vz-fb" strokeWidth={2.5} strokeLinecap="round" />
          <line x1={40} y1={116} x2={49} y2={109} className="vz-fb" strokeWidth={2.5} strokeLinecap="round" />
          <line x1={40} y1={116} x2={48} y2={124} className="vz-fb" strokeWidth={2.5} strokeLinecap="round" />
          <Lab x={160} y={172} size={12} tone="hot">보상이 지나온 선택을 강화한다</Lab>
        </>
      )}
    </Frame>
  )
}

// ── 모방학습 ────────────────────────────────────────────────────────────────
const IM_PTS = [
  [40, 132], [112, 54], [192, 104], [268, 46],
] as const

function B15Imitate() {
  const [step, setStep] = useState(0) // 0~3: 따라간 지점 수
  const p = IM_PTS[step]
  return (
    <Frame h={186} foot={<Chip on={step === IM_PTS.length - 1} onClick={() => setStep((s) => (s + 1) % IM_PTS.length)}>따라가기</Chip>}>
      <Lab x={160} y={16} size={12}>전문가가 보여준 궤적을 그대로 따라간다</Lab>

      <path
        d={`M${IM_PTS[0][0]} ${IM_PTS[0][1]} L${IM_PTS[1][0]} ${IM_PTS[1][1]} L${IM_PTS[2][0]} ${IM_PTS[2][1]} L${IM_PTS[3][0]} ${IM_PTS[3][1]}`}
        fill="none" className="vz-dash" strokeWidth={2.5}
      />
      {IM_PTS.map((pt, i) => (
        <circle key={i} cx={pt[0]} cy={pt[1]} r={4} className="vz-mute" stroke="currentColor" strokeWidth={2} />
      ))}
      <Lab x={40} y={150} size={11} anchor="start">전문가 시연</Lab>

      {step > 0 && (
        <path
          d={`M${IM_PTS[0][0]} ${IM_PTS[0][1]} ${IM_PTS.slice(1, step + 1).map((pt) => `L${pt[0]} ${pt[1]}`).join(' ')}`}
          fill="none" className="vz-arrow" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round"
        />
      )}
      <circle cx={p[0]} cy={p[1]} r={8} className="vz-node-on" stroke="currentColor" strokeWidth={3} />

      <Lab x={160} y={172} size={12} tone="hot">탐색도 보상도 없다 — 있는 그대로 복사한다</Lab>
    </Frame>
  )
}

// ── 과적합 ──────────────────────────────────────────────────────────────────
const OF_POINTS = [
  [30, 108], [68, 58], [106, 100], [144, 54], [182, 96], [220, 52], [258, 90],
] as const
const OF_TEST: readonly [number, number] = [300, 74]
const OF_WIGGLY_PRED = 132
const OF_SMOOTH_PRED = 80

function B15Overfit() {
  const [wiggly, setWiggly] = useState(true)
  const predY = wiggly ? OF_WIGGLY_PRED : OF_SMOOTH_PRED
  const gap = Math.abs(predY - OF_TEST[1])
  const bad = gap > 20
  return (
    <Frame h={196} foot={<Chip on={wiggly} onClick={() => setWiggly((v) => !v)}>{wiggly ? '과적합(다 통과)' : '일반화(부드럽게)'}</Chip>}>
      <Lab x={160} y={14} size={12}>새 점 하나로 실력이 갈린다</Lab>

      {wiggly ? (
        <>
          <path
            d={`M${OF_POINTS.map((p) => `${p[0]} ${p[1]}`).join(' L')}`}
            fill="none" className="vz-arrow" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
          />
          <path
            d={`M${OF_POINTS[6][0]} ${OF_POINTS[6][1]} L${OF_TEST[0]} ${OF_WIGGLY_PRED}`}
            fill="none" className="vz-goal" strokeWidth={3} strokeLinecap="round"
          />
        </>
      ) : (
        <path d="M30 88 Q160 58 300 80" fill="none" className="vz-arrow" strokeWidth={3} strokeLinecap="round" />
      )}

      {OF_POINTS.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={4} className="vz-card" stroke="currentColor" strokeWidth={2} />
      ))}

      <circle cx={OF_TEST[0]} cy={predY} r={4} className={bad ? 'vz-node' : 'vz-node-on'} stroke="currentColor" strokeWidth={2} />
      <circle cx={OF_TEST[0]} cy={OF_TEST[1]} r={6} className="vz-gold-f" stroke="currentColor" strokeWidth={2.5} />
      <line
        x1={OF_TEST[0]} y1={predY} x2={OF_TEST[0]} y2={OF_TEST[1]}
        className={bad ? 'vz-goal' : 'vz-arrow'} strokeWidth={2.5}
        strokeDasharray={bad ? undefined : '4 4'}
      />
      <Lab x={296} y={OF_TEST[1] - 16} size={11} anchor="end">새 데이터</Lab>

      <Lab x={160} y={184} size={12} tone={bad ? 'bad' : 'ok'}>
        {bad ? '점을 다 맞혔지만 새 데이터는 크게 틀린다' : '점을 다 안 맞혀도 새 데이터에 가깝다'}
      </Lab>
    </Frame>
  )
}

// ── 트랜스포머 ──────────────────────────────────────────────────────────────
const TF_TOKENS = ['로봇이', '상자를', '들었다', '무겁다'] as const
const TF_X = [46, 126, 206, 286] as const
const TF_Y = 92

function B15Transformer() {
  const [par, setPar] = useState(false)
  const [step, setStep] = useState(0)
  const pairs: [number, number][] = []
  for (let i = 0; i < TF_TOKENS.length; i++) {
    for (let j = i + 1; j < TF_TOKENS.length; j++) pairs.push([i, j])
  }
  return (
    <Frame
      h={168}
      foot={
        <>
          <Chip on={par} onClick={() => { setPar((v) => !v); setStep(0) }}>{par ? '순서대로 보기' : '한꺼번에 보기'}</Chip>
          {!par && (
            <Chip on={step >= TF_TOKENS.length - 1} onClick={() => setStep((s) => (s + 1) % TF_TOKENS.length)}>
              다음 글자
            </Chip>
          )}
        </>
      }
    >
      <Lab x={160} y={16} size={12} tone={par ? 'hot' : 'mute'}>
        {par ? '전부 동시에 보고 서로 참조한다' : '한 글자씩만 보고 다음으로 간다'}
      </Lab>

      {par
        ? pairs.map(([i, j], k) => {
            const x1 = TF_X[i]
            const x2 = TF_X[j]
            const cy = TF_Y - Math.min(40, Math.abs(x2 - x1) * 0.16 + 8)
            return (
              <path
                key={k}
                d={`M${x1} ${TF_Y} Q${(x1 + x2) / 2} ${cy} ${x2} ${TF_Y}`}
                fill="none" className="vz-arrow" strokeWidth={1.4} strokeOpacity={0.55}
              />
            )
          })
        : [0, 1, 2].map((i) =>
            step > i ? <Arrow key={i} x1={TF_X[i] + 32} y1={TF_Y} x2={TF_X[i + 1] - 32} y2={TF_Y} /> : null,
          )}

      {TF_TOKENS.map((t, i) => {
        const lit = par || i <= step
        return (
          <g key={t}>
            <Box x={TF_X[i] - 30} y={TF_Y - 15} w={60} h={30} r={9} tone={lit ? 'brand' : 'card'} />
            <Lab x={TF_X[i]} y={TF_Y + 5} size={12} tone={lit ? 'inv' : 'mute'}>{t}</Lab>
          </g>
        )
      })}

      <Lab x={160} y={150} size={12}>{par ? '동시에 전부 연결된다' : `순서 ${step + 1}/${TF_TOKENS.length}`}</Lab>
    </Frame>
  )
}

// ── 하이퍼파라미터 ───────────────────────────────────────────────────────────
const HP_CX = 160
const HP_Y = 128
const HP_MAXOFF = 128
const HP_POS0 = 96

function B15Hyper() {
  const [v, setV] = useState(50)
  const lr = 0.02 + (v / 100) * 1.15
  const factor = 1 - 2 * lr
  const pts = Array.from({ length: 6 }, (_, n) => {
    const raw = HP_POS0 * factor ** n
    const clamped = Math.max(-HP_MAXOFF, Math.min(HP_MAXOFF, raw))
    return { x: HP_CX + clamped }
  })
  const last = pts[pts.length - 1]
  const diverge = Math.abs(factor) >= 1
  const slow = !diverge && Math.abs(factor) > 0.8
  const state = diverge ? 'crack' : slow ? 'drop' : ''
  const msg = diverge ? '발산한다' : slow ? '너무 느리다' : '적당히 내려간다'
  return (
    <Frame
      h={190}
      foot={
        <>
          <input
            className="dy-viz-range" type="range" min={0} max={100} value={v}
            onChange={(e) => setV(Number(e.target.value))} aria-label="학습률"
          />
          <span className={`dy-viz-state${state ? ` ${state}` : ''}`}>{lr.toFixed(2)} · {msg}</span>
        </>
      }
    >
      <Lab x={160} y={16} size={12}>학습률은 사람이 미리 돌려놓는 값</Lab>

      <line x1={30} y1={HP_Y} x2={290} y2={HP_Y} stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
      <line x1={HP_CX} y1={HP_Y - 9} x2={HP_CX} y2={HP_Y + 9} stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
      <Lab x={HP_CX} y={HP_Y + 20} size={11}>최적점</Lab>

      {pts.slice(0, -1).map((p, i) => {
        const q = pts[i + 1]
        const apex = HP_Y - Math.min(38, Math.abs(q.x - p.x) * 0.45 + 6)
        return (
          <path
            key={i}
            d={`M${p.x} ${HP_Y} Q${(p.x + q.x) / 2} ${apex} ${q.x} ${HP_Y}`}
            fill="none" className="vz-arrow" strokeWidth={2} strokeOpacity={0.75}
          />
        )
      })}
      {pts.slice(1, -1).map((p, i) => (
        <circle key={i} cx={p.x} cy={HP_Y} r={3.5} className="vz-node" stroke="currentColor" strokeWidth={2} />
      ))}

      <circle cx={pts[0].x} cy={HP_Y} r={6} className="vz-mute" stroke="currentColor" strokeWidth={2.5} />
      <Lab x={pts[0].x} y={HP_Y - 16} size={11}>시작</Lab>

      <circle cx={last.x} cy={HP_Y} r={7} className={diverge ? 'vz-node' : 'vz-node-on'} stroke="currentColor" strokeWidth={3} />

      <Lab x={160} y={170} size={12} tone={diverge ? 'bad' : slow ? 'mute' : 'ok'}>{msg}</Lab>
    </Frame>
  )
}

export const VISUALS_B15: Record<string, () => ReactNode> = {
  b15_neuron: B15Neuron,
  b15_supervised: B15Supervised,
  b15_unsupervised: B15Unsupervised,
  b15_reinforce: B15Reinforce,
  b15_imitate: B15Imitate,
  b15_overfit: B15Overfit,
  b15_transformer: B15Transformer,
  b15_hyper: B15Hyper,
}
