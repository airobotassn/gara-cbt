// DAILY QUIZ 해설 그림 — 배치 5(글과 데이터를 다루는 일).
//
// ⛔ 색을 직접 쓰지 않는다: 선 = stroke="currentColor" 또는 vz-* stroke 클래스, 면 = vz-* fill 클래스.
//    (daily.css 의 토큰만 쓰기 때문에 다크모드가 자동으로 따라온다. #hex 를 박으면 한쪽 테마에서 증발한다.)
// ⚠️ 좌표는 전부 손으로 맞춰 뒀다 — 라벨을 옮기면 옆 라벨과 겹치는지 다시 계산할 것.
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Frame, Box, Arrow, Lab, Chip } from './kit'

// ── 자연어처리(NLP) ─────────────────────────────────────────────────────────
// 문장 한 줄이 아래로 내려가며 모양을 바꾼다: 원문 → 조각 → 역할 → 뜻 지도.
// 마지막 칸에서 비슷한 것끼리 뭉치는 걸 보여 줘야 "컴퓨터가 다룰 수 있는 형태"가 납득된다.
const NLP_X = [44, 99, 155, 211, 266] // 조각 5개(w=48)의 왼쪽 x
const NLP_TOK: { t: string; role: string; tone: 'brand' | 'mute' | 'teal'; lab: 'inv' | 'mute' }[] = [
  { t: '고양이', role: '명사', tone: 'brand', lab: 'inv' },
  { t: '가', role: '조사', tone: 'mute', lab: 'mute' },
  { t: '생선', role: '명사', tone: 'brand', lab: 'inv' },
  { t: '을', role: '조사', tone: 'mute', lab: 'mute' },
  { t: '먹었다', role: '동사', tone: 'teal', lab: 'inv' },
]
// 뜻 지도의 점 — 명사끼리 / 조사끼리 뭉치고 동사는 멀리 떨어진다(라벨은 점 밖으로 뺀다).
const NLP_MAP: { x: number; y: number; t: string; lx: number; ly: number; a: 'start' | 'end' }[] = [
  { x: 76, y: 142, t: '고양이', lx: 85, ly: 139, a: 'start' },
  { x: 92, y: 164, t: '생선', lx: 84, ly: 166, a: 'end' },
  { x: 180, y: 140, t: '먹었다', lx: 188, ly: 137, a: 'start' },
  { x: 252, y: 168, t: '가', lx: 245, ly: 172, a: 'end' },
  { x: 272, y: 148, t: '을', lx: 280, ly: 145, a: 'start' },
]

function B5Nlp() {
  return (
    <Frame h={202}>
      <Lab x={6} y={27} size={10.5} anchor="start">원문</Lab>
      <Box x={44} y={10} w={270} h={24} r={8} />
      <Lab x={179} y={27} size={12}>고양이가 생선을 먹었다</Lab>
      <Arrow x1={179} y1={36} x2={179} y2={46} w={2.5} head={6} />

      <Lab x={6} y={65} size={10.5} anchor="start">조각</Lab>
      {NLP_TOK.map((k, i) => (
        <g key={`tok${k.t}${i}`}>
          <Box x={NLP_X[i]} y={48} w={48} h={24} r={8} />
          <Lab x={NLP_X[i] + 24} y={65} size={11}>{k.t}</Lab>
        </g>
      ))}
      <Arrow x1={179} y1={74} x2={179} y2={84} w={2.5} head={6} />

      {/* 같은 자리에 이번엔 '무엇인지'가 붙는다 — 칸이 그대로라 무엇이 더해졌는지 보인다 */}
      <Lab x={6} y={103} size={10.5} anchor="start">역할</Lab>
      {NLP_TOK.map((k, i) => (
        <g key={`role${k.t}${i}`}>
          <Box x={NLP_X[i]} y={86} w={48} h={24} r={8} tone={k.tone} />
          <Lab x={NLP_X[i] + 24} y={103} size={11} tone={k.lab}>{k.role}</Lab>
        </g>
      ))}
      <Arrow x1={179} y1={112} x2={179} y2={122} w={2.5} head={6} />

      <Lab x={6} y={155} size={10.5} anchor="start">뜻 지도</Lab>
      <Box x={44} y={124} w={270} h={54} r={10} tone="mute" />
      <ellipse cx={87} cy={152} rx={30} ry={22} className="vz-dash" strokeWidth={2.5} />
      <ellipse cx={262} cy={156} rx={26} ry={19} className="vz-dash" strokeWidth={2.5} />
      {NLP_MAP.map((p) => (
        <g key={`map${p.t}`}>
          <circle cx={p.x} cy={p.y} r={5} className="vz-node-on" stroke="currentColor" strokeWidth={2} />
          <Lab x={p.lx} y={p.ly} size={10} anchor={p.a}>{p.t}</Lab>
        </g>
      ))}
      <Lab x={160} y={173} size={10}>뜻이 가까우면 가까이</Lab>

      <Lab x={160} y={196} size={11}>말을 쪼개 컴퓨터가 셀 수 있는 것으로</Lab>
    </Frame>
  )
}

// ── 감정 분석 ───────────────────────────────────────────────────────────────
// 문장 하나가 눈금 위의 점 하나가 된다. 점이 되니까 이어서 곡선이 그려진다 — 그게 이 기술의 전부다.
// 점을 누르면 그 문장과 점수의 근거가 된 낱말이 아래에 뜬다(값이 변하는 그림이라 상호작용을 붙였다).
const SENT: { d: string; s: number; pre: string; hot: string; post: string; hl: string }[] = [
  { d: '월', s: -0.6, pre: '아침부터 비가 와서 ', hot: '최악', post: '이었다', hl: 'vz-lab-bad' },
  { d: '화', s: -0.2, pre: '발표 준비를 ', hot: '겨우', post: ' 끝냈다', hl: 'vz-lab-bad' },
  { d: '수', s: 0.1, pre: '점심 메뉴는 ', hot: '그럭저럭', post: '이었다', hl: 'vz-lab' },
  { d: '목', s: 0.5, pre: '조원들이 ', hot: '도와줘서', post: ' 수월했다', hl: 'vz-lab-ok' },
  { d: '금', s: 0.9, pre: '', hot: '드디어', post: ' 발표가 끝났다!', hl: 'vz-lab-ok' },
  { d: '토', s: 0.7, pre: '늦잠 자고 ', hot: '푹', post: ' 쉬었다', hl: 'vz-lab-ok' },
  { d: '일', s: -0.3, pre: '내일 출근이라 ', hot: '답답하다', post: '', hl: 'vz-lab-bad' },
]
const sentX = (i: number) => 44 + i * 38
const sentY = (s: number) => 66 - s * 38

function B5Sentiment() {
  const [sel, setSel] = useState(4)
  const p = SENT[sel]
  return (
    <Frame h={200} foot={<span className="dy-viz-hint">👆 요일 점을 눌러 보라</span>}>
      <Lab x={30} y={32} size={10} anchor="end" tone="ok">긍정</Lab>
      <Lab x={30} y={108} size={10} anchor="end" tone="bad">부정</Lab>
      <line x1={36} y1={66} x2={290} y2={66} className="vz-dash" strokeWidth={2.5} />
      {/* 점을 이으면 곡선 — 곡선이 나오는 건 문장이 '점수'가 됐기 때문이다 */}
      <polyline
        points={SENT.map((q, i) => `${sentX(i)},${sentY(q.s)}`).join(' ')}
        fill="none"
        className="vz-arrow"
        strokeWidth={3}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {SENT.map((q, i) => (
        <g key={q.d} onClick={() => setSel(i)} style={{ cursor: 'pointer' }}>
          <circle
            cx={sentX(i)}
            cy={sentY(q.s)}
            r={i === sel ? 9 : 6}
            className={q.s >= 0 ? 'vz-teal' : 'vz-target-c'}
            stroke="currentColor"
            strokeWidth={2.5}
          />
          <Lab x={sentX(i)} y={122} size={10} tone={i === sel ? 'hot' : 'mute'}>{q.d}</Lab>
        </g>
      ))}
      {/* 근거가 된 낱말만 색이 다르다 — 점수가 어디서 나왔는지가 보여야 한다 */}
      <Box x={14} y={134} w={292} h={40} r={12} />
      <text x={160} y={159} className="vz-lab" fontSize={11.5} fontWeight={800} textAnchor="middle">
        {p.pre}
        <tspan className={p.hl}>{p.hot}</tspan>
        {p.post}
      </text>
      <Lab x={296} y={159} size={11.5} anchor="end" tone={p.s >= 0 ? 'ok' : 'bad'}>
        {(p.s > 0 ? '+' : '') + p.s.toFixed(1)}
      </Lab>
      <Lab x={160} y={192} size={11}>낱말이 점수가 되고, 점수를 이으면 흐름이 된다</Lab>
    </Frame>
  )
}

// ── 기계번역 ────────────────────────────────────────────────────────────────
// 위: 낱말을 1:1 로 갈아 끼우면 선이 나란하고 개수·순서가 그대로다 → 어순이 깨진다.
// 아래: 문장이 뜻 하나로 모였다가 목표 언어의 어순으로 다시 펼쳐진다 → 낱말 개수까지 바뀐다(3→4).
const MT_KO: { t: string; x: number; cx: number }[] = [
  { t: '나는', x: 30, cx: 66 },
  { t: '학교에', x: 124, cx: 160 },
  { t: '간다', x: 218, cx: 254 },
]
const MT_WORD = ['I', 'school', 'go']
const MT_MEAN: { t: string; x: number; cx: number }[] = [
  { t: 'I', x: 34, cx: 61 },
  { t: 'go', x: 100, cx: 127 },
  { t: 'to', x: 166, cx: 193 },
  { t: 'school', x: 232, cx: 259 },
]

function B5Translate() {
  return (
    <Frame h={206}>
      <Lab x={8} y={20} size={11} anchor="start">낱말만 갈아 끼우기</Lab>
      <Lab x={312} y={20} size={11} anchor="end" tone="bad">어순이 깨진다</Lab>
      {MT_KO.map((k, i) => (
        <g key={`a${k.t}`}>
          <Box x={k.x} y={28} w={72} h={22} r={8} />
          <Lab x={k.cx} y={43} size={11}>{k.t}</Lab>
          {/* 나란한 선 = 자리도 개수도 그대로 */}
          <Arrow x1={k.cx} y1={52} x2={k.cx} y2={64} w={2.5} head={6} />
          <Box x={k.x} y={66} w={72} h={22} r={8} />
          <Lab x={k.cx} y={81} size={11}>{MT_WORD[i]}</Lab>
        </g>
      ))}

      <Lab x={8} y={104} size={11} anchor="start">뜻으로 묶어 옮기기</Lab>
      <Lab x={312} y={104} size={11} anchor="end" tone="ok">어순까지 다시</Lab>
      {MT_KO.map((k) => (
        <g key={`b${k.t}`}>
          <Box x={k.x} y={110} w={72} h={22} r={8} />
          <Lab x={k.cx} y={125} size={11}>{k.t}</Lab>
        </g>
      ))}
      {/* 셋이 하나로 모인다 */}
      <Arrow x1={66} y1={134} x2={140} y2={142} w={2.5} head={6} />
      <Arrow x1={160} y1={134} x2={160} y2={141} w={2.5} head={6} />
      <Arrow x1={254} y1={134} x2={180} y2={142} w={2.5} head={6} />
      <Box x={120} y={144} w={80} h={24} r={12} tone="brand" />
      <Lab x={160} y={161} size={12} tone="inv">뜻</Lab>
      {/* 다시 펼치면 자리도 개수도 달라진다(3 → 4) */}
      {MT_MEAN.map((m) => (
        <g key={`c${m.t}`}>
          <Arrow x1={160} y1={168} x2={m.cx} y2={175} w={2.5} head={6} />
          <Box x={m.x} y={178} w={54} h={22} r={8} tone="teal" />
          <Lab x={m.cx} y={193} size={11} tone="inv">{m.t}</Lab>
        </g>
      ))}
    </Frame>
  )
}

// ── 비식별화 ────────────────────────────────────────────────────────────────
// 표가 아래로 내려가는데, 사람을 특정하는 두 칸만 막이에 걸려 ●●● 로 바뀌고
// 나머지 두 칸은 막이를 그대로 통과한다 — "지우는 게 아니라 가리는 것"이 화살표로 보인다.
const DE_X = [12, 87, 162, 237]
const DE_HEAD = ['이름', '연락처', '학년', '점수']
const DE_ROWS = [
  ['김민서', '010-2345', '2학년', '88'],
  ['이준호', '010-7788', '1학년', '74'],
]
const DE_OUT = [
  ['●●●', '●●●', '2학년', '88'],
  ['●●●', '●●●', '1학년', '74'],
]
const deCx = (i: number) => DE_X[i] + 37.5

function B5Deident() {
  return (
    <Frame h={200}>
      <Lab x={12} y={16} size={11} anchor="start">원본 명단</Lab>
      {DE_HEAD.map((h, i) => (
        <g key={`h${h}`}>
          <Box x={DE_X[i]} y={22} w={75} h={16} r={5} tone="mute" />
          <Lab x={deCx(i)} y={34} size={10.5}>{h}</Lab>
        </g>
      ))}
      {DE_ROWS.map((row, r) =>
        row.map((v, i) => (
          <g key={`in${r}${i}`}>
            <Box x={DE_X[i]} y={38 + r * 19} w={75} h={19} r={5} />
            <Lab x={deCx(i)} y={52 + r * 19} size={10.5}>{v}</Lab>
          </g>
        )),
      )}

      {/* 막이 — 왼쪽 두 칸에만 덮개가 있고, 오른쪽 두 칸 자리는 뚫려 있다 */}
      <Box x={12} y={94} w={300} h={26} r={10} tone="mute" />
      <rect x={18} y={99} width={63} height={16} rx={5} className="vz-target" strokeWidth={2} />
      <rect x={93} y={99} width={63} height={16} rx={5} className="vz-target" strokeWidth={2} />
      <Lab x={49.5} y={112} size={12} tone="bad">✕</Lab>
      <Lab x={124.5} y={112} size={12} tone="bad">✕</Lab>
      <Lab x={237} y={112} size={10} tone="ok">그대로</Lab>

      {/* 막힌 칸은 막이 앞에서 끊기고, 막이 뒤에서 가려진 값으로 다시 내려간다 */}
      <Arrow x1={deCx(0)} y1={80} x2={deCx(0)} y2={92} w={2.5} head={6} />
      <Arrow x1={deCx(1)} y1={80} x2={deCx(1)} y2={92} w={2.5} head={6} />
      <Arrow x1={deCx(0)} y1={122} x2={deCx(0)} y2={136} w={2.5} head={6} />
      <Arrow x1={deCx(1)} y1={122} x2={deCx(1)} y2={136} w={2.5} head={6} />
      {/* 통과하는 칸은 막이를 뚫고 한 번에 내려간다 */}
      <Arrow x1={deCx(2)} y1={80} x2={deCx(2)} y2={136} w={2.5} head={6} />
      <Arrow x1={deCx(3)} y1={80} x2={deCx(3)} y2={136} w={2.5} head={6} />

      {DE_OUT.map((row, r) =>
        row.map((v, i) => (
          <g key={`out${r}${i}`}>
            <Box x={DE_X[i]} y={140 + r * 19} w={75} h={19} r={5} tone={i < 2 ? 'mute' : 'card'} />
            <Lab x={deCx(i)} y={154 + r * 19} size={10.5} tone={i < 2 ? 'bad' : 'ok'}>{v}</Lab>
          </g>
        )),
      )}
      <Lab x={160} y={194} size={11}>지울 칸만 지우고 나머지는 그대로 넘긴다</Lab>
    </Frame>
  )
}

// ── 구조화 출력 ─────────────────────────────────────────────────────────────
// 같은 리뷰 3건. 줄글에서는 평점이 매번 다른 자리에 있고(파랑 글자의 x 가 제각각),
// 표에서는 한 칸에 줄지어 선다 — 그래서 기계가 그 칸만 집어 평균을 낸다.
const ST_LINES: { pre: string; hot: string; post: string }[] = [
  { pre: '김OO 님, 배송 빨라요 — ', hot: '별 5개', post: '' },
  { pre: '이OO / ', hot: '3점', post: ' / 색이 사진과 다름' },
  { pre: '박OO ', hot: '별 4개', post: ', 재구매 의사 있음' },
]
const ST_COL: { x: number; w: number; cx: number; head: string }[] = [
  { x: 12, w: 76, cx: 50, head: '이름' },
  { x: 88, w: 56, cx: 116, head: '평점' },
  { x: 144, w: 164, cx: 226, head: '한줄' },
]
const ST_ROWS = [
  ['김OO', '5', '배송 빨라요'],
  ['이OO', '3', '색이 사진과 다름'],
  ['박OO', '4', '재구매 의사 있음'],
]

function B5Structured() {
  return (
    <Frame h={208}>
      <Lab x={12} y={20} size={11} anchor="start">줄글로 받으면</Lab>
      <Box x={12} y={26} w={296} h={58} r={12} />
      {ST_LINES.map((l, i) => (
        <text
          key={`ln${i}`}
          x={22}
          y={45 + i * 17}
          className="vz-lab"
          fontSize={10.5}
          fontWeight={800}
          textAnchor="start"
        >
          {l.pre}
          <tspan className="vz-lab-hot">{l.hot}</tspan>
          {l.post}
        </text>
      ))}

      <Arrow x1={160} y1={88} x2={160} y2={104} w={2.5} head={6} />
      <Lab x={170} y={101} size={10.5} anchor="start" tone="hot">칸을 정해 주면</Lab>

      {ST_COL.map((c) => (
        <g key={`hd${c.head}`}>
          <Box x={c.x} y={108} w={c.w} h={18} r={5} tone="mute" />
          <Lab x={c.cx} y={121} size={10.5}>{c.head}</Lab>
        </g>
      ))}
      {ST_ROWS.map((row, r) =>
        row.map((v, i) => (
          <g key={`cell${r}${i}`}>
            {/* 평점 칸만 색을 달리해 '줄이 맞았다'를 눈으로 잡게 한다 */}
            <Box x={ST_COL[i].x} y={126 + r * 20} w={ST_COL[i].w} h={20} r={5} tone={i === 1 ? 'gold' : 'card'} />
            <Lab x={ST_COL[i].cx} y={140 + r * 20} size={10.5}>{v}</Lab>
          </g>
        )),
      )}
      <Lab x={160} y={202} size={11}>칸이 정해지니 평점만 뽑아 평균을 낸다</Lab>
    </Frame>
  )
}

// ── 문맥 요약 ───────────────────────────────────────────────────────────────
// 창의 크기는 두 상태에서 똑같다(그게 요점이다). 달라지는 건 안쪽뿐 —
// 앞 대화 6개가 요약 한 장으로 접히면서 오른쪽에 빈 자리가 생기고, 새 대화가 그리로 들어간다.
const CTX_KEEP = [90, 125.5] // 요약 후에도 원문 그대로 남는 최근 두 개

function CtxBubble({ x }: { x: number }) {
  return (
    <g>
      <Box x={x} y={52} w={31} h={34} r={9} />
      <line x1={x + 6} y1={64} x2={x + 25} y2={64} className="vz-limb" strokeWidth={3} strokeLinecap="round" />
      <line x1={x + 6} y1={74} x2={x + 18} y2={74} className="vz-limb" strokeWidth={3} strokeLinecap="round" />
    </g>
  )
}

function B5Context() {
  const [sum, setSum] = useState(false)
  return (
    <Frame
      h={192}
      foot={
        <>
          <Chip on={!sum} onClick={() => setSum(false)}>요약 전</Chip>
          <Chip on={sum} onClick={() => setSum(true)}>요약 후</Chip>
        </>
      }
    >
      <Lab x={12} y={30} size={11} anchor="start">컨텍스트 창 — 크기는 고정</Lab>
      <Box x={12} y={38} w={296} h={68} r={14} tone="mute" />

      {!sum && (
        <g>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <CtxBubble key={i} x={20 + i * 35.5} />)}
          <Lab x={20} y={100} size={10} anchor="start" tone="bad">빈 자리가 없다</Lab>
        </g>
      )}
      {sum && (
        <g>
          {/* 앞 6개가 접혀 한 장이 된다 — 줄어든 만큼 오른쪽이 비워진다 */}
          <Box x={20} y={52} w={64} h={34} r={9} tone="gold" />
          <Lab x={52} y={74} size={11}>요약</Lab>
          {CTX_KEEP.map((x) => <CtxBubble key={x} x={x} />)}
          <rect x={164} y={52} width={136} height={34} rx={9} className="vz-dash" strokeWidth={2.5} />
          <Lab x={232} y={74} size={11} tone="ok">빈 자리</Lab>
          <Lab x={20} y={100} size={10} anchor="start">앞 6개를 한 장으로 접었다</Lab>
        </g>
      )}

      <Box x={118} y={136} w={84} h={28} r={10} />
      <Lab x={160} y={154} size={11}>새 대화</Lab>
      {!sum && (
        <g>
          <Arrow x1={160} y1={134} x2={160} y2={118} tone="bad" w={2.5} head={6} />
          <line x1={138} y1={114} x2={182} y2={114} className="vz-goal" strokeWidth={4} strokeLinecap="round" />
          <Lab x={300} y={126} size={10.5} anchor="end" tone="bad">들어갈 자리가 없다</Lab>
        </g>
      )}
      {sum && (
        <g>
          <Arrow x1={160} y1={134} x2={226} y2={112} w={2.5} head={6} />
          <Lab x={300} y={126} size={10.5} anchor="end" tone="ok">여기로 들어간다</Lab>
        </g>
      )}
      <Lab x={160} y={182} size={11}>{sum ? '지난 대화를 접으니 자리가 생겼다' : '창은 그대로인데 넣을 자리가 없다'}</Lab>
    </Frame>
  )
}

// ── 등록표 ──────────────────────────────────────────────────────────────────
// theory/batch5.ts 의 visual 이 이 키를 가리킨다. 키는 다른 배치와 겹치면 안 된다(b5_ 접두사).
export const VISUALS_B5: Record<string, () => ReactNode> = {
  b5_nlp: B5Nlp,
  b5_sentiment: B5Sentiment,
  b5_translate: B5Translate,
  b5_deident: B5Deident,
  b5_structured: B5Structured,
  b5_context: B5Context,
}
