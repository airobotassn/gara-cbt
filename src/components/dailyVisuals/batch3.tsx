// DAILY QUIZ 해설 그림 — 배치 3 · 학습과 그 한계.
//
// 다섯(머신러닝·파인튜닝·RAG·사전 학습·RLHF)은 "무엇을 고치는가"로 갈랐다 —
//   b3_ml         사람이 규칙을 적는 것 vs 예시에서 경계가 저절로 그어지는 것
//   b3_finetune   모델 내부 숫자판(가중치) 자체가 다시 칠해진다
//   b3_rag        내부 숫자판은 그대로 두고 바깥 문서만 갈아 끼운다 (finetune 과 같은 격자 모티프를 재사용해 대비)
//   b3_pretrain   그 내부를 처음 다지는 단계 — 데이터 양이 가장 크다
//   b3_rlhf       사람의 선택이 점수판에 쌓여 다시 모델을 조율한다
// 나머지 넷은 학습이 새는 지점이다 — 훈계가 아니라 "왜 그렇게 되는지"가 그림 안에서 벌어지게 했다:
//   b3_hallucination  근거 연결이 끊겨도 확신도 막대 높이는 그대로다
//   b3_bias           데이터가 쏠린 쪽으로 판정선이 기울어 억울한 케이스가 잘못 판정된다
//   b3_adversarial    두 그림은 픽셀까지 같다 — 슬라이더로 보이지 않는 잡음만 키워도 라벨이 뒤집힌다
//   b3_hitl           같은 파이프라인, 게이트 한 칸의 유무로 이상값이 걸리거나 그대로 나간다
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Frame, Box, Arrow, Lab, Chip } from './kit'

// ── 머신러닝 ──────────────────────────────────────────────────────────────
function B3Ml() {
  const [added, setAdded] = useState(false)
  return (
    <Frame h={190} foot={<Chip on={added} onClick={() => setAdded((v) => !v)}>새 예외 넣기</Chip>}>
      <Lab x={80} y={16} size={11}>규칙: 사람이 하나씩 적는다</Lab>
      <Lab x={240} y={16} size={11} tone="hot">학습: 예시에서 스스로 찾는다</Lab>
      <line x1={160} y1={24} x2={160} y2={152} className="vz-dash" strokeWidth={2} />

      <Box x={20} y={28} w={120} h={22} tone="card" />
      <Lab x={80} y={43} size={11}>규칙 1: 둥글면 → A</Lab>
      <Box x={20} y={56} w={120} h={22} tone="card" />
      <Lab x={80} y={71} size={11}>규칙 2: 각지면 → B</Lab>
      <Box x={20} y={84} w={120} h={22} tone="card" />
      <Lab x={80} y={99} size={11}>규칙 3: 진하면 → A</Lab>
      {added && (
        <>
          <circle cx={80} cy={128} r={11} fill="none" className="vz-dash" strokeWidth={2.5} />
          <Lab x={80} y={132} size={12} tone="bad">?</Lab>
          <Lab x={80} y={150} size={11} tone="bad">규칙에 없어 못 잡음</Lab>
        </>
      )}

      <line x1={188} y1={30} x2={300} y2={112} stroke="currentColor" strokeWidth={2.5} />
      <circle cx={210} cy={40} r={7} className="vz-brand" stroke="currentColor" strokeWidth={2} />
      <circle cx={228} cy={54} r={7} className="vz-brand" stroke="currentColor" strokeWidth={2} />
      <circle cx={196} cy={58} r={7} className="vz-brand" stroke="currentColor" strokeWidth={2} />
      <circle cx={270} cy={92} r={7} className="vz-teal" stroke="currentColor" strokeWidth={2} />
      <circle cx={288} cy={78} r={7} className="vz-teal" stroke="currentColor" strokeWidth={2} />
      <circle cx={256} cy={100} r={7} className="vz-teal" stroke="currentColor" strokeWidth={2} />
      {added && (
        <>
          <circle cx={240} cy={66} r={8} className="vz-brand" stroke="currentColor" strokeWidth={2.5} />
          <Lab x={240} y={132} size={11} tone="ok">경계로 바로 분류됨</Lab>
        </>
      )}

      <Lab x={160} y={176} size={12}>규칙은 사람이 늘리고, 학습은 예시만 늘면 된다</Lab>
    </Frame>
  )
}

// ── 파인튜닝 ──────────────────────────────────────────────────────────────
const FT_LIT = new Set([0, 3, 5, 6, 9, 10])

function B3Finetune() {
  const [after, setAfter] = useState(false)
  return (
    <Frame
      h={178}
      foot={
        <>
          <Chip on={!after} onClick={() => setAfter(false)}>적용 전</Chip>
          <Chip on={after} onClick={() => setAfter(true)}>적용 후</Chip>
        </>
      }
    >
      <Lab x={160} y={16} size={12}>모델 내부(가중치)</Lab>
      {Array.from({ length: 3 }, (_, r) =>
        Array.from({ length: 4 }, (_, c) => {
          const i = r * 4 + c
          const lit = after && FT_LIT.has(i)
          return (
            <rect
              key={i}
              x={96 + c * 30}
              y={28 + r * 24}
              width={26}
              height={20}
              rx={4}
              className={lit ? 'vz-brand' : 'vz-mute'}
              stroke="currentColor"
              strokeWidth={2}
            />
          )
        }),
      )}
      <Box x={14} y={64} w={64} h={40} tone="teal" />
      <Lab x={46} y={122} size={11}>도메인 데이터</Lab>
      <Arrow x1={78} y1={84} x2={94} y2={84} />
      <Lab x={160} y={152} size={12} tone={after ? 'hot' : 'mute'}>
        {after ? '내부 숫자판 자체가 바뀐다' : '아직 그대로다'}
      </Lab>
    </Frame>
  )
}

// ── RAG ──────────────────────────────────────────────────────────────────
const RAG_DOCS = [
  { k: '환불', label: '문서: 환불 정책', snippet: '7일 환불' },
  { k: '배송', label: '문서: 배송 정책', snippet: '평균 2일' },
  { k: '반품', label: '문서: 반품 정책', snippet: '미개봉만' },
] as const

function B3Rag() {
  const [sel, setSel] = useState(0)
  const docY = [30, 62, 94]
  return (
    <Frame
      h={202}
      foot={RAG_DOCS.map((d, i) => (
        <Chip key={d.k} on={i === sel} onClick={() => setSel(i)}>{d.k}</Chip>
      ))}
    >
      <Box x={14} y={62} w={56} h={40} tone="card" />
      <Lab x={42} y={86} size={11}>질문</Lab>

      {RAG_DOCS.map((d, i) => (
        <g key={d.k}>
          <rect
            x={100}
            y={docY[i]}
            width={100}
            height={26}
            rx={7}
            className={i === sel ? 'vz-brand' : 'vz-card'}
            stroke="currentColor"
            strokeWidth={2.5}
          />
          <Lab x={150} y={docY[i] + 17} size={11} tone={i === sel ? 'inv' : 'mute'}>{d.label}</Lab>
        </g>
      ))}

      <Arrow x1={70} y1={82} x2={98} y2={docY[sel] + 13} />
      <Arrow x1={200} y1={docY[sel] + 13} x2={228} y2={78} />

      <Box x={228} y={54} w={78} h={54} tone="card" />
      <Lab x={267} y={76} size={12} tone="hot">답변</Lab>
      <Lab x={267} y={94} size={11}>{RAG_DOCS[sel].snippet}</Lab>

      <Lab x={95} y={140} size={11}>모델 내부(가중치)</Lab>
      {Array.from({ length: 2 }, (_, r) =>
        Array.from({ length: 5 }, (_, c) => (
          <rect
            key={`${r}-${c}`}
            x={30 + c * 22}
            y={148 + r * 20}
            width={18}
            height={16}
            rx={3}
            className="vz-mute"
            stroke="currentColor"
            strokeWidth={1.5}
          />
        )),
      )}
      <Lab x={220} y={160} size={11} tone="mute">그대로 — 안 바뀐다</Lab>

      <Lab x={160} y={194} size={12} tone="hot">문서만 바뀐다, 모델은 그대로</Lab>
    </Frame>
  )
}

// ── 환각 ──────────────────────────────────────────────────────────────────
function B3Hallucination() {
  const [has, setHas] = useState(true)
  return (
    <Frame
      h={182}
      foot={
        <>
          <Chip on={has} onClick={() => setHas(true)}>근거 있음</Chip>
          <Chip on={!has} onClick={() => setHas(false)}>근거 없음</Chip>
        </>
      }
    >
      <rect
        x={20}
        y={26}
        width={90}
        height={56}
        rx={8}
        className={has ? 'vz-card' : 'vz-mute'}
        stroke="currentColor"
        strokeWidth={2.5}
        strokeDasharray={has ? undefined : '5 5'}
      />
      {has ? (
        <>
          <line x1={32} y1={44} x2={98} y2={44} className="vz-limb" strokeWidth={2} />
          <line x1={32} y1={58} x2={98} y2={58} className="vz-limb" strokeWidth={2} />
          <line x1={32} y1={72} x2={80} y2={72} className="vz-limb" strokeWidth={2} />
        </>
      ) : (
        <Lab x={65} y={58} size={12} tone="bad">근거 없음</Lab>
      )}
      <Lab x={65} y={98} size={11}>근거 문서</Lab>

      {has ? (
        <Arrow x1={112} y1={54} x2={138} y2={54} />
      ) : (
        <g className="vz-goal" strokeWidth={2.5} strokeLinecap="round">
          <line x1={112} y1={54} x2={138} y2={54} strokeDasharray="4 4" />
          <line x1={119} y1={47} x2={131} y2={61} />
          <line x1={131} y1={47} x2={119} y2={61} />
        </g>
      )}

      <rect x={144} y={20} width={26} height={90} rx={5} fill="none" stroke="currentColor" strokeWidth={2} />
      <rect x={144} y={30.8} width={26} height={79.2} rx={5} className="vz-gold-f" />
      <Lab x={157} y={14} size={11} tone={has ? 'ok' : 'bad'}>확신 88%</Lab>

      {[184, 208, 232, 256].map((x, i) => (
        <g key={x}>
          <rect x={x} y={118} width={18} height={18} rx={4} className="vz-brand" stroke="currentColor" strokeWidth={2} />
          {i < 3 && <Arrow x1={x + 18} y1={127} x2={x + 22} y2={127} w={2} head={5} />}
        </g>
      ))}
      <Lab x={230} y={152} size={11}>문장은 끝까지 만들어진다</Lab>

      <Lab x={160} y={172} size={12} tone="bad">확률은 근거를 따지지 않는다</Lab>
    </Frame>
  )
}

// ── 편향 ──────────────────────────────────────────────────────────────────
const BIAS_MAJOR: [number, number][] = [
  [56, 40],
  [78, 54],
  [50, 74],
  [96, 44],
  [68, 92],
  [110, 62],
  [60, 112],
]
const BIAS_MINOR_BASE: [number, number] = [232, 128]
const BIAS_MINOR_EXTRA: [number, number][] = [
  [252, 138],
  [212, 148],
  [262, 116],
  [190, 136],
  [242, 158],
]
const BIAS_CASE: [number, number] = [198, 90]

function B3Bias() {
  const [extra, setExtra] = useState(0)
  const y1 = 170 - 8 * extra
  const y2 = 60 - 8 * extra
  const [cx, cy] = BIAS_CASE
  const yAtCase = y1 + (y2 - y1) * ((cx - 10) / 300)
  const wrong = cy < yAtCase
  return (
    <Frame
      h={196}
      foot={
        <>
          <input
            className="dy-viz-range"
            type="range"
            min={0}
            max={BIAS_MINOR_EXTRA.length}
            value={extra}
            onChange={(e) => setExtra(Number(e.target.value))}
            aria-label="소수집단 데이터 추가"
          />
          <span className={`dy-viz-state${wrong ? ' drop' : ''}`}>{wrong ? '억울한 오판정' : '정상 판정'}</span>
        </>
      }
    >
      <Lab x={160} y={16} size={12}>데이터가 한쪽에 쏠리면 경계선도 쏠린다</Lab>

      <line x1={10} y1={y1} x2={310} y2={y2} stroke="currentColor" strokeWidth={2.5} />

      {BIAS_MAJOR.map(([x, y], i) => (
        <circle key={`m${i}`} cx={x} cy={y} r={7} className="vz-brand" stroke="currentColor" strokeWidth={2} />
      ))}
      <circle cx={BIAS_MINOR_BASE[0]} cy={BIAS_MINOR_BASE[1]} r={7} className="vz-teal" stroke="currentColor" strokeWidth={2} />
      {BIAS_MINOR_EXTRA.slice(0, extra).map(([x, y], i) => (
        <circle key={`n${i}`} cx={x} cy={y} r={7} className="vz-teal" stroke="currentColor" strokeWidth={2} />
      ))}

      <circle cx={cx} cy={cy} r={9} fill="none" className={wrong ? 'vz-goal' : 'vz-arrow'} strokeWidth={3} />
      <Lab x={cx} y={cy - 16} size={11} tone={wrong ? 'bad' : 'ok'}>정상 케이스</Lab>

      <Lab x={60} y={30} size={11}>다수 집단</Lab>
      <Lab x={272} y={176} size={11}>소수 집단</Lab>
    </Frame>
  )
}

// ── RLHF ──────────────────────────────────────────────────────────────────
function B3Rlhf() {
  const [scoreA, setScoreA] = useState(0)
  const [scoreB, setScoreB] = useState(0)
  const [pick, setPick] = useState<'A' | 'B' | null>(null)
  const lit = Math.min(6, scoreA + scoreB)
  const pickA = () => {
    setScoreA((s) => Math.min(3, s + 1))
    setPick('A')
  }
  const pickB = () => {
    setScoreB((s) => Math.min(3, s + 1))
    setPick('B')
  }
  return (
    <Frame
      h={190}
      foot={
        <>
          <Chip on={pick === 'A'} onClick={pickA}>A 선택</Chip>
          <Chip on={pick === 'B'} onClick={pickB}>B 선택</Chip>
        </>
      }
    >
      {Array.from({ length: 2 }, (_, r) =>
        Array.from({ length: 3 }, (_, c) => {
          const i = r * 3 + c
          return (
            <rect
              key={i}
              x={20 + c * 21}
              y={58 + r * 19}
              width={17}
              height={15}
              rx={3}
              className={i < lit ? 'vz-brand' : 'vz-mute'}
              stroke="currentColor"
              strokeWidth={1.5}
            />
          )
        }),
      )}
      <Lab x={41} y={110} size={11}>모델</Lab>

      <Box x={96} y={26} w={60} h={30} tone={pick === 'A' ? 'brand' : 'card'} />
      <Lab x={126} y={45} size={11} tone={pick === 'A' ? 'inv' : 'mute'}>답 A</Lab>
      <Box x={96} y={84} w={60} h={30} tone={pick === 'B' ? 'brand' : 'card'} />
      <Lab x={126} y={103} size={11} tone={pick === 'B' ? 'inv' : 'mute'}>답 B</Lab>
      <Arrow x1={80} y1={68} x2={94} y2={42} />
      <Arrow x1={80} y1={68} x2={94} y2={98} />

      <rect x={190} y={20} width={20} height={90} rx={4} fill="none" stroke="currentColor" strokeWidth={2} />
      <rect x={190} y={110 - scoreA * 22} width={20} height={scoreA * 22} rx={4} className="vz-gold-f" />
      <Lab x={200} y={124} size={11}>점수A</Lab>
      <rect x={222} y={20} width={20} height={90} rx={4} fill="none" stroke="currentColor" strokeWidth={2} />
      <rect x={222} y={110 - scoreB * 22} width={20} height={scoreB * 22} rx={4} className="vz-gold-f" />
      <Lab x={232} y={124} size={11}>점수B</Lab>

      <g className="vz-fb" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M211 112 V140 H44 V98" />
        <path d="M44 98 l-5 8 m5 -8 l7 5" />
      </g>
      <Lab x={127} y={154} size={11} tone="hot">다시 조율</Lab>

      <Lab x={160} y={176} size={12}>사람의 선택이 다음 모델을 만든다</Lab>
    </Frame>
  )
}

// ── 적대적 공격 ──────────────────────────────────────────────────────────
function B3Adversarial() {
  const [noise, setNoise] = useState(0)
  const flipped = noise > 60
  const dots = Math.min(6, Math.round(noise / 18))
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
            value={noise}
            onChange={(e) => setNoise(Number(e.target.value))}
            aria-label="잡음 세기"
          />
          <span className={`dy-viz-state${flipped ? ' drop' : ''}`}>{flipped ? '판정 뒤집힘' : '판정 그대로'}</span>
        </>
      }
    >
      <Lab x={160} y={16} size={12}>사람 눈에는 완전히 같다</Lab>

      <Box x={26} y={26} w={90} h={66} tone="card" />
      <circle cx={71} cy={59} r={22} className="vz-brand" stroke="currentColor" strokeWidth={2.5} />
      <Lab x={71} y={106} size={11}>원본</Lab>
      <Lab x={71} y={122} size={11} tone="ok">고양이 97%</Lab>

      <Box x={204} y={26} w={90} h={66} tone="card" />
      <circle cx={249} cy={59} r={22} className="vz-brand" stroke="currentColor" strokeWidth={2.5} />
      <Lab x={249} y={106} size={11}>조작본</Lab>
      <Lab x={249} y={122} size={11} tone={flipped ? 'bad' : 'ok'}>{flipped ? '개 91%' : '고양이 97%'}</Lab>

      <Lab x={160} y={132} size={11}>확대하면 보이는 잡음</Lab>
      <rect x={130} y={138} width={60} height={26} rx={4} className="vz-mute" stroke="currentColor" strokeWidth={2} />
      {Array.from({ length: dots }, (_, i) => (
        <circle key={i} cx={138 + (i % 3) * 18} cy={146 + Math.floor(i / 3) * 12} r={2.4} className="vz-gold-f" />
      ))}

      <Lab x={160} y={172} size={11} tone="bad">안 보이는 잡음이 라벨을 바꾼다</Lab>
    </Frame>
  )
}

// ── 사전 학습 ──────────────────────────────────────────────────────────────
function B3Pretrain() {
  return (
    <Frame h={182}>
      <Lab x={160} y={16} size={12}>정답표 없이 그냥 읽기만 한다</Lab>

      <Box x={14} y={36} w={104} h={46} r={10} tone="brand" />
      <Lab x={66} y={64} size={12} tone="inv">사전 학습</Lab>
      <Lab x={66} y={100} size={11}>인터넷 텍스트 대량</Lab>

      <Arrow x1={118} y1={59} x2={132} y2={59} />

      <Box x={134} y={36} w={76} h={46} r={10} tone="mute" />
      <Lab x={172} y={64} size={11}>파인튜닝</Lab>
      <Lab x={172} y={100} size={11}>도메인 데이터</Lab>

      <Arrow x1={210} y1={59} x2={220} y2={59} />

      <Box x={222} y={36} w={48} h={46} r={10} tone="mute" />
      <Lab x={246} y={64} size={11}>RLHF</Lab>
      <Lab x={246} y={100} size={11}>사람 선호 소량</Lab>

      <rect x={14} y={116} width={104} height={14} rx={4} className="vz-gold-f" />
      <rect x={134} y={116} width={76} height={14} rx={4} className="vz-mute" stroke="currentColor" strokeWidth={1.5} />
      <rect x={222} y={116} width={48} height={14} rx={4} className="vz-mute" stroke="currentColor" strokeWidth={1.5} />
      <Lab x={160} y={148} size={11}>데이터 양</Lab>

      <Lab x={160} y={172} size={12} tone="hot">여기서 언어의 틀을 처음 잡는다</Lab>
    </Frame>
  )
}

// ── 휴먼 인 더 루프 ─────────────────────────────────────────────────────────
function B3Hitl() {
  return (
    <Frame h={176}>
      <Lab x={14} y={14} size={11} tone="ok" anchor="start">게이트 있음</Lab>
      <Box x={14} y={20} w={60} h={30} tone="card" />
      <Lab x={44} y={39} size={11}>AI 초안</Lab>
      <Arrow x1={74} y1={35} x2={120} y2={35} />
      <path d="M140 20 L158 35 L140 50 L122 35 Z" className="vz-card" stroke="currentColor" strokeWidth={2.5} strokeLinejoin="round" />
      <Lab x={140} y={58} size={11}>사람 검수</Lab>
      <Lab x={140} y={70} size={11} tone="bad">(이상값 차단)</Lab>
      <Arrow x1={160} y1={35} x2={228} y2={35} />
      <Box x={230} y={20} w={64} h={30} tone="teal" />
      <Lab x={262} y={39} size={11} tone="inv">발송</Lab>

      <line x1={10} y1={80} x2={310} y2={80} className="vz-dash" strokeWidth={2} />

      <Lab x={14} y={94} size={11} tone="bad" anchor="start">게이트 없음</Lab>
      <Box x={14} y={100} w={60} h={30} tone="card" />
      <Lab x={44} y={119} size={11}>AI 초안</Lab>
      <Arrow x1={74} y1={115} x2={228} y2={115} tone="bad" />
      <Box x={230} y={100} w={64} h={30} tone="card" />
      <Lab x={262} y={119} size={11}>발송</Lab>
      <circle cx={290} cy={104} r={8} className="vz-goal" stroke="currentColor" strokeWidth={2} />
      <Lab x={290} y={108} size={11} tone="inv">!</Lab>
      <Lab x={262} y={144} size={11} tone="bad">틀린 값이 그대로 나감</Lab>

      <Lab x={160} y={166} size={12} tone="hot">차이는 중간에 사람이 있느냐 뿐이다</Lab>
    </Frame>
  )
}

export const VISUALS_B3: Record<string, () => ReactNode> = {
  b3_ml: B3Ml,
  b3_finetune: B3Finetune,
  b3_rag: B3Rag,
  b3_hallucination: B3Hallucination,
  b3_bias: B3Bias,
  b3_rlhf: B3Rlhf,
  b3_adversarial: B3Adversarial,
  b3_pretrain: B3Pretrain,
  b3_hitl: B3Hitl,
}
