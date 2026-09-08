// DAILY QUIZ 해설 그림 — 배치 2 · 언어모델 안에서 벌어지는 일.
//
// 이 아홉 개는 전부 "확률 막대"로 그릴 수 있는 개념이라 그렇게 그리면 같은 그림이 네 장 나온다.
// 그래서 각도를 일부러 흩었다:
//   b2_llm      요청이 전부 '빈칸 하나'로 접힌다(막대 없음)
//   b2_token    문장이 조각으로 잘리고 그 수가 요금이 된다(개수와 눈금)
//   b2_context  고정 폭 창이 밀리며 앞이 떨어져 나간다(창틀)
//   b2_embed    뜻이 좌표가 되고 관계는 방향으로 남는다(평면)
//   b2_attention 한 단어가 어디를 보는지 선 굵기로(아치)
//   b2_next     한 칸 자라고 다시 입력이 된다(되먹임 고리)
//   b2_temp     같은 분포가 뾰족해지고 납작해진다  ← 세로 막대는 여기 하나뿐
//   b2_topp     누적 띠를 그어 꼬리를 잘라낸다(가로 누적 띠)
//   b2_cosine   각도로 재고 길이는 안 본다(벡터와 눈금)
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Frame, Box, Arrow, Lab, Chip } from './kit'

// ── 거대언어모델(LLM) ───────────────────────────────────────────────────────
// 번역이든 요약이든 코딩이든, 모델이 실제로 하는 일은 '빈칸 한 칸 채우기' 하나다.
// 도구를 바꿔도 팔은 그대로인 EndEffector 와 같은 화법 — 위만 갈리고 아래는 안 변한다.
const LLM_TASKS = [
  { k: '번역', ask: '이 문장 영어로 바꿔 줘', blank: '영어로: I ___' },
  { k: '요약', ask: '이 글 세 줄로 줄여 줘', blank: '요약: 이 글은 ___' },
  { k: '코딩', ask: '정렬 코드 짜 줘', blank: 'def sort(a): ___' },
] as const

function B2Llm() {
  const [sel, setSel] = useState(0)
  const t = LLM_TASKS[sel]
  return (
    <Frame
      h={196}
      foot={LLM_TASKS.map((x, i) => (
        <Chip key={x.k} on={i === sel} onClick={() => setSel(i)}>{x.k}</Chip>
      ))}
    >
      <Lab x={14} y={20} anchor="start" size={12}>무엇을 시키든</Lab>
      <Box x={40} y={26} w={240} h={30} />
      <Lab x={160} y={46} size={13}>{t.ask}</Lab>

      <Arrow x1={160} y1={60} x2={160} y2={73} />

      <Lab x={14} y={74} anchor="start" size={12} tone="hot">빈칸 하나짜리 문제로</Lab>
      <Box x={40} y={80} w={240} h={30} tone="mute" />
      <Lab x={160} y={100} size={13} tone="hot">{t.blank}</Lab>

      <Arrow x1={160} y1={114} x2={160} y2={128} />

      <Box x={62} y={132} w={196} h={38} r={12} tone="brand" />
      <Lab x={160} y={156} size={13} tone="inv">다음 한 조각 고르기</Lab>

      <Lab x={160} y={188} size={12}>이 상자는 안 바뀐다 — 커진 건 크기뿐</Lab>
    </Frame>
  )
}

// ── 토큰 ────────────────────────────────────────────────────────────────────
// 글자 수와 조각 수가 따로 논다는 걸 말로 하면 안 남는다. 같은 5글자가 1조각과 5조각으로 갈리는 걸 보여 준다.
const TOK_SAMPLES = [
  { k: '한국어', text: '안녕하세요', pieces: ['안', '녕', '하', '세', '요'] },
  { k: '영어', text: 'Hello', pieces: ['Hello'] },
  { k: '긴 단어', text: 'unbelievable', pieces: ['un', 'bel', 'iev', 'able'] },
] as const

function B2Token() {
  const [sel, setSel] = useState(0)
  const s = TOK_SAMPLES[sel]
  const ws = s.pieces.map((p) => Math.max(26, p.length * 13 + 10))
  const total = ws.reduce((a, b) => a + b, 0) + (ws.length - 1) * 6
  const x0 = 160 - total / 2
  const n = s.pieces.length
  const bar = n * 32
  // 조각을 왼쪽부터 이어 붙인 x 좌표 — 앞 조각들의 폭 합(+간격 6)이 곧 시작점이다.
  // ⚠️ 누적 변수를 map 안에서 다시 대입하지 않는다(react-hooks/immutability 가 렌더 중 재대입을 막는다).
  const boxes = s.pieces.map((p, i) => ({
    p,
    x: x0 + ws.slice(0, i).reduce((a, w) => a + w + 6, 0),
    w: ws[i],
    i,
  }))
  return (
    <Frame
      h={190}
      foot={TOK_SAMPLES.map((x, i) => (
        <Chip key={x.k} on={i === sel} onClick={() => setSel(i)}>{x.k}</Chip>
      ))}
    >
      <Lab x={160} y={26} size={12}>글자 수와 조각 수는 따로 논다</Lab>

      {boxes.map((b) => (
        <g key={b.i}>
          <rect
            x={b.x}
            y={44}
            width={b.w}
            height={34}
            rx={8}
            className={b.i % 2 === 0 ? 'vz-brand' : 'vz-teal'}
            stroke="currentColor"
            strokeWidth={3}
          />
          <Lab x={b.x + b.w / 2} y={66} size={12} tone="inv">{b.p}</Lab>
          <Lab x={b.x + b.w / 2} y={94} size={11}>{b.i + 1}</Lab>
        </g>
      ))}

      <Lab x={22} y={120} anchor="start" size={12}>글자 {s.text.length}자</Lab>
      <Lab x={22} y={144} anchor="start" size={12} tone="hot">조각 {n}개</Lab>
      <rect x={96} y={132} width={bar} height={16} rx={6} className="vz-gold-f" stroke="currentColor" strokeWidth={3} />
      <Lab x={96 + bar + 8} y={145} anchor="start" size={12}>요금</Lab>

      <Lab x={160} y={176} size={12} tone="hot">세는 건 글자가 아니라 조각이다</Lab>
    </Frame>
  )
}

// ── 컨텍스트 창 ─────────────────────────────────────────────────────────────
// 창은 절대 안 넓어진다. 새 문장이 들어오면 그만큼 앞이 창 밖으로 밀려 나가 사라진다.
function B2Context() {
  const [n, setN] = useState(3)
  const RX = 292
  const LX = 92
  const PITCH = 50
  const BW = 44
  const msgs = Array.from({ length: n }, (_, k) => k + 1)
  const xOf = (i: number) => RX - (n - i) * PITCH - BW
  const out = Math.max(0, n - 4)
  return (
    <Frame
      h={166}
      foot={
        <>
          <input
            className="dy-viz-range"
            type="range"
            min={1}
            max={8}
            value={n}
            onChange={(e) => setN(Number(e.target.value))}
            aria-label="들어온 문장 수"
          />
          <span className={`dy-viz-state${out > 0 ? ' drop' : ''}`}>{out > 0 ? `${out}문장 밀려남` : '다 담긴다'}</span>
        </>
      }
    >
      <Lab x={192} y={34} size={12} tone="hot">한 번에 담기는 폭 — 안 늘어난다</Lab>

      {/* 창 바닥 → 문장 → 창 테두리 순서. 테두리를 위에 다시 그려야 문장이 창을 넘어간 게 안 보인다. */}
      <rect x={LX} y={44} width={200} height={64} rx={12} className="vz-scope1" stroke="currentColor" strokeWidth={3} />
      {msgs.map((i) => {
        const x = xOf(i)
        const inside = x >= LX - 2
        return (
          <g key={i}>
            <rect
              x={x}
              y={52}
              width={BW}
              height={48}
              rx={9}
              className={inside ? 'vz-brand' : 'vz-mute'}
              stroke="currentColor"
              strokeWidth={3}
            />
            <Lab x={x + BW / 2} y={82} size={12} tone={inside ? 'inv' : 'mute'}>{i}</Lab>
          </g>
        )
      })}
      <rect x={LX} y={44} width={200} height={64} rx={12} fill="none" stroke="currentColor" strokeWidth={3} />

      <Arrow x1={86} y1={124} x2={40} y2={124} tone="bad" />
      <Lab x={38} y={148} anchor="start" size={12} tone="bad">밀려나면 잊힌다</Lab>
      <Lab x={300} y={148} anchor="end" size={12}>새 문장은 오른쪽으로</Lab>
    </Frame>
  )
}

// ── 임베딩 ──────────────────────────────────────────────────────────────────
// 뜻이 좌표가 되면 '관계'가 방향으로 남는다. 왕→남자 와 여왕→여자 가 같은 화살표가 되는 게 그 증거다.
const EMB_GRID_V = [14, 50, 86, 122, 158, 194, 230, 266, 302]
const EMB_GRID_H = [26, 58, 90, 122, 154]

function B2Embed() {
  const pts = [
    { n: '왕', x: 64, y: 58, up: true },
    { n: '여왕', x: 186, y: 58, up: true },
    { n: '남자', x: 124, y: 116, up: false },
    { n: '여자', x: 246, y: 116, up: false },
  ]
  return (
    <Frame h={198}>
      <g className="vz-web" strokeWidth={1.2}>
        {EMB_GRID_V.map((x) => <line key={`v${x}`} x1={x} y1={26} x2={x} y2={154} />)}
        {EMB_GRID_H.map((y) => <line key={`h${y}`} x1={14} y1={y} x2={306} y2={y} />)}
      </g>

      {/* 두 화살표가 같은 방향·같은 길이 — 이게 '관계가 좌표에 남았다'는 말의 전부다 */}
      <Arrow x1={70} y1={64} x2={118} y2={110} />
      <Arrow x1={192} y1={64} x2={240} y2={110} />
      <Lab x={155} y={92} size={11} tone="ok">같은 방향</Lab>

      {pts.map((p) => (
        <g key={p.n}>
          <circle cx={p.x} cy={p.y} r={6} className="vz-node-on" stroke="currentColor" strokeWidth={2.5} />
          <Lab x={p.x} y={p.up ? p.y - 12 : p.y + 20} size={12} tone={p.up ? 'hot' : 'mute'}>{p.n}</Lab>
        </g>
      ))}

      <Lab x={160} y={174} size={12} tone="hot">왕 = (0.72, −0.14, 0.31 …)</Lab>
      <Lab x={160} y={192} size={12}>뜻이 가까우면 자리도 가깝다</Lab>
    </Frame>
  )
}

// ── 어텐션 메커니즘 ─────────────────────────────────────────────────────────
// '그것이'가 무엇을 가리키는지는 선 굵기가 말한다. 단어를 눌러 보면 보는 곳이 통째로 바뀐다.
const ATT_TOK = ['로봇이', '상자를', '들었다', '그것이', '무거웠다']
const ATT_W = [
  [0.10, 0.15, 0.55, 0.10, 0.10],
  [0.15, 0.10, 0.50, 0.15, 0.10],
  [0.38, 0.34, 0.08, 0.12, 0.08],
  [0.14, 0.62, 0.10, 0.05, 0.09],
  [0.08, 0.42, 0.10, 0.32, 0.08],
]

function B2Attention() {
  const [q, setQ] = useState(3)
  const cx = (i: number) => 40 + i * 60
  const w = ATT_W[q]
  const top = w.reduce((best, v, i) => (i !== q && v > w[best] ? i : best), q === 0 ? 1 : 0)
  return (
    <Frame
      h={188}
      foot={<span className="dy-viz-hint">👆 단어를 눌러 보라 — 그 단어가 어디를 보는지 굵기로 나온다</span>}
    >
      <Lab x={160} y={30} size={12}>한 단어가 문장의 어디를 보는가</Lab>

      {/* 아치 = 어텐션 한 줄. 굵기·진하기가 곧 가중치다(숫자를 읽기 전에 눈이 먼저 안다). */}
      {ATT_TOK.map((_, j) => {
        if (j === q) return null
        const x1 = cx(q)
        const x2 = cx(j)
        const d = Math.abs(x2 - x1)
        const cy = Math.max(12, 108 - d * 0.55)
        return (
          <path
            key={j}
            d={`M${x1} 108 Q${(x1 + x2) / 2} ${cy} ${x2} 108`}
            fill="none"
            className="vz-arrow"
            strokeWidth={1.2 + w[j] * 10}
            strokeOpacity={Math.min(1, 0.3 + w[j])}
            strokeLinecap="round"
          />
        )
      })}

      {ATT_TOK.map((t, i) => (
        <g key={t} onClick={() => setQ(i)} style={{ cursor: 'pointer' }}>
          <Box x={cx(i) - 28} y={112} w={56} h={28} r={9} tone={i === q ? 'brand' : 'card'} />
          <Lab x={cx(i)} y={131} size={11} tone={i === q ? 'inv' : 'mute'}>{t}</Lab>
          <Lab x={cx(i)} y={154} size={11} tone={i === top ? 'hot' : 'mute'}>
            {i === q ? '기준' : w[i].toFixed(2)}
          </Lab>
        </g>
      ))}

      <Lab x={160} y={178} size={12} tone="hot">굵을수록 많이 참고한 단어</Lab>
    </Frame>
  )
}

// ── 다음 토큰 예측 ──────────────────────────────────────────────────────────
// 요점은 확률이 아니라 **되먹임**이다 — 한 조각 붙인 문장이 곧바로 다시 입력이 되어 처음부터 다시 고른다.
const NT_BASE = '오늘 날씨가'
const NT_STEPS = [
  [{ w: '맑다', p: 0.61 }, { w: '춥다', p: 0.18 }, { w: '흐리다', p: 0.13 }, { w: '포근하다', p: 0.08 }],
  [{ w: '그래서', p: 0.44 }, { w: '지만', p: 0.24 }, { w: '어서', p: 0.19 }, { w: '는데', p: 0.13 }],
  [{ w: '산책', p: 0.38 }, { w: '빨래', p: 0.27 }, { w: '기분', p: 0.21 }, { w: '창문', p: 0.14 }],
]

function B2NextToken() {
  const [step, setStep] = useState(0)
  const done = step >= NT_STEPS.length
  const words = [NT_BASE, ...NT_STEPS.slice(0, step).map((c) => c[0].w)]
  const cands = done ? NT_STEPS[NT_STEPS.length - 1] : NT_STEPS[step]

  const ws = words.map((t) => t.length * 12 + 16)
  const slot = done ? 0 : 36
  const total = ws.reduce((a, b) => a + b, 0) + (ws.length - 1 + (done ? 0 : 1)) * 5 + slot
  let cur = 160 - total / 2
  const boxes = words.map((t, i) => {
    const x = cur
    cur += ws[i] + 5
    return { t, x, w: ws[i], i }
  })
  const slotX = cur

  return (
    <Frame
      h={182}
      foot={<Chip on={!done} onClick={() => setStep((s) => (s + 1) % (NT_STEPS.length + 1))}>{done ? '처음부터' : '다음 한 칸'}</Chip>}
    >
      {/* 되먹임 고리 — 출력이 그대로 다음 입력이 된다. 화살촉은 marker 없이 선 두 개로. */}
      <g className="vz-fb" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M300 36 C300 18 20 18 20 36" />
        <path d="M14 30 L20 38 L26 30" />
      </g>
      <Lab x={160} y={13} size={11} tone="ok">한 칸 자란 문장이 다시 입력으로</Lab>

      {boxes.map((b) => (
        <g key={b.i}>
          <Box x={b.x} y={40} w={b.w} h={28} r={9} tone={b.i === 0 ? 'mute' : 'brand'} />
          <Lab x={b.x + b.w / 2} y={59} size={12} tone={b.i === 0 ? 'mute' : 'inv'}>{b.t}</Lab>
        </g>
      ))}
      {!done && (
        <>
          <rect x={slotX} y={40} width={36} height={28} rx={9} className="vz-dash" strokeWidth={3} />
          <Lab x={slotX + 18} y={60} size={13} tone="hot">?</Lab>
          <Arrow x1={52} y1={100} x2={slotX + 18} y2={72} />
        </>
      )}

      {cands.map((c, i) => (
        <g key={c.w}>
          <Box x={21 + i * 72} y={104} w={62} h={28} r={9} tone={i === 0 ? 'brand' : 'card'} />
          <Lab x={52 + i * 72} y={123} size={12} tone={i === 0 ? 'inv' : 'mute'}>{c.w}</Lab>
          <Lab x={52 + i * 72} y={144} size={11} tone={i === 0 ? 'hot' : 'mute'}>{Math.round(c.p * 100)}%</Lab>
        </g>
      ))}

      <Lab x={160} y={168} size={12}>한 칸 붙일 때마다 처음부터 다시 고른다</Lab>
    </Frame>
  )
}

// ── 온도(Temperature) ───────────────────────────────────────────────────────
// 후보도 순서도 그대로다. 바뀌는 건 막대의 '뾰족함' 하나뿐 — 그래서 슬라이더가 있어야 읽힌다.
const TEMP_WORDS = ['맑다', '춥다', '흐리다', '눈온다']
const TEMP_LOGITS = [2.4, 1.5, 1.0, 0.4]

function B2Temperature() {
  const [v, setV] = useState(40)
  const t = 0.15 + (v / 100) * 1.65
  const ex = TEMP_LOGITS.map((l) => Math.exp(l / t))
  const sum = ex.reduce((a, b) => a + b, 0)
  const ps = ex.map((e) => e / sum)
  const state = t <= 0.6 ? 'drop' : t >= 1.25 ? 'crack' : ''
  const msg = t <= 0.6 ? '늘 같은 답' : t >= 1.25 ? '답이 갈린다' : '조금씩 다르다'
  return (
    <Frame
      h={192}
      foot={
        <>
          <input
            className="dy-viz-range"
            type="range"
            min={0}
            max={100}
            value={v}
            onChange={(e) => setV(Number(e.target.value))}
            aria-label="온도"
          />
          <span className={`dy-viz-state${state ? ` ${state}` : ''}`}>{t.toFixed(2)} · {msg}</span>
        </>
      }
    >
      <Lab x={160} y={26} size={12}>‘오늘 날씨가 __’ 다음 후보</Lab>
      {ps.map((p, i) => {
        const h = Math.max(3, p * 96)
        const x = 36 + i * 68
        return (
          <g key={TEMP_WORDS[i]}>
            <rect x={x} y={142 - h} width={44} height={h} rx={6} className="vz-brand" stroke="currentColor" strokeWidth={3} />
            <Lab x={x + 22} y={Math.max(42, 142 - h - 8)} size={11} tone={i === 0 ? 'hot' : 'mute'}>
              {Math.round(p * 100)}%
            </Lab>
            <Lab x={x + 22} y={160} size={12}>{TEMP_WORDS[i]}</Lab>
          </g>
        )
      })}
      <line x1={28} y1={142} x2={292} y2={142} stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
      <Lab x={160} y={182} size={12} tone="hot">후보는 그대로 — 뾰족함만 바뀐다</Lab>
    </Frame>
  )
}

// ── 탑피(Top-P) ─────────────────────────────────────────────────────────────
// 온도와 헷갈리지 않게 **가로 누적 띠**로 그린다. 확률 순으로 이어 붙이고, 누적이 p 에 닿는 자리에서 자른다.
const TOPP_WORDS = ['맑다', '춥다', '흐리다', '눈온다', '포근하다', '따뜻하다']
const TOPP_P = [0.42, 0.24, 0.14, 0.09, 0.06, 0.05]

function B2TopP() {
  const [pv, setPv] = useState(80)
  const p = pv / 100
  const cum: number[] = []
  TOPP_P.forEach((q, i) => { cum[i] = (i === 0 ? 0 : cum[i - 1]) + q })
  let k = 1
  while (k < TOPP_P.length && cum[k - 1] < p) k += 1
  const X0 = 20
  const W = 280
  const cutX = X0 + p * W
  return (
    <Frame
      h={176}
      foot={
        <>
          <input
            className="dy-viz-range"
            type="range"
            min={30}
            max={100}
            step={5}
            value={pv}
            onChange={(e) => setPv(Number(e.target.value))}
            aria-label="누적 확률 p"
          />
          <span className="dy-viz-state">p {p.toFixed(2)}</span>
        </>
      }
    >
      <Lab x={160} y={30} size={12}>확률 큰 순으로 이어 붙인 띠</Lab>

      {TOPP_P.map((q, i) => {
        const x = X0 + (i === 0 ? 0 : cum[i - 1]) * W
        const w = q * W
        const keep = i < k
        return (
          <g key={TOPP_WORDS[i]}>
            <rect
              x={x}
              y={56}
              width={w}
              height={36}
              rx={4}
              className={keep ? (i % 2 === 0 ? 'vz-brand' : 'vz-brand-hi') : 'vz-mute'}
              stroke="currentColor"
              strokeWidth={3}
            />
            {w >= 34 && (
              <Lab x={x + w / 2} y={79} size={11} tone={keep ? 'inv' : 'mute'}>{TOPP_WORDS[i]}</Lab>
            )}
          </g>
        )
      })}

      {/* 누적 눈금 — '이어 붙인 값'이라는 걸 숫자로 한 번 못 박는다(앞 세 칸만, 뒤는 붙어서 못 읽는다) */}
      <g className="vz-dash" strokeWidth={2}>
        {[0, 1, 2].map((i) => <line key={i} x1={X0 + cum[i] * W} y1={92} x2={X0 + cum[i] * W} y2={100} />)}
      </g>
      {[0, 1, 2].map((i) => (
        <Lab key={i} x={X0 + cum[i] * W} y={112} size={11}>{cum[i].toFixed(2)}</Lab>
      ))}

      <line x1={cutX} y1={46} x2={cutX} y2={100} className="vz-goal" strokeWidth={3} strokeLinecap="round" />
      <path d={`M${cutX - 6} 42 L${cutX + 6} 42 L${cutX} 51 Z`} className="vz-target-c" />

      <Lab x={20} y={136} anchor="start" size={12} tone="hot">남긴다 {k}개</Lab>
      <Lab x={300} y={136} anchor="end" size={12}>버린다 {TOPP_P.length - k}개</Lab>
      <Lab x={160} y={160} size={12}>누적이 p 에 닿는 데까지만 후보다</Lab>
    </Frame>
  )
}

// ── 코사인 유사도 ───────────────────────────────────────────────────────────
// 각도만 본다는 말은, 길이를 바꿔도 눈금이 안 움직인다는 뜻이다. 그 둘을 한 화면에서 같이 만져 보게 한다.
const COS_O = { x: 98, y: 96 }
const COS_A = -25

function B2Cosine() {
  const [phi, setPhi] = useState(55)
  const [long, setLong] = useState(true)
  const rad = (d: number) => (d * Math.PI) / 180
  const la = 66
  const lb = long ? 66 : 38
  const b = COS_A + phi
  const ax = COS_O.x + la * Math.cos(rad(COS_A))
  const ay = COS_O.y + la * Math.sin(rad(COS_A))
  const bx = COS_O.x + lb * Math.cos(rad(b))
  const by = COS_O.y + lb * Math.sin(rad(b))
  const cv = Math.cos(rad(phi))
  const arc = (r: number, d: number) => [COS_O.x + r * Math.cos(rad(d)), COS_O.y + r * Math.sin(rad(d))]
  const [a1x, a1y] = arc(30, COS_A)
  const [a2x, a2y] = arc(30, b)
  const [mlx, mly] = arc(44, COS_A + phi / 2)
  const gx = 251 + cv * 55
  return (
    <Frame
      h={196}
      foot={
        <>
          <input
            className="dy-viz-range"
            type="range"
            min={0}
            max={180}
            value={phi}
            onChange={(e) => setPhi(Number(e.target.value))}
            aria-label="두 벡터 사잇각"
          />
          <Chip on={!long} onClick={() => setLong((v) => !v)}>{long ? 'B 를 짧게' : 'B 를 길게'}</Chip>
        </>
      }
    >
      {/* 사잇각 — 이 호가 곧 값이다 */}
      <path d={`M${a1x} ${a1y} A30 30 0 ${phi > 180 ? 1 : 0} 1 ${a2x} ${a2y}`} fill="none" className="vz-turn" strokeWidth={3} />
      <Lab x={mlx} y={mly + 4} size={11}>{phi}°</Lab>

      <Arrow x1={COS_O.x} y1={COS_O.y} x2={ax} y2={ay} w={4} head={10} />
      <Arrow x1={COS_O.x} y1={COS_O.y} x2={bx} y2={by} tone="turn" w={4} head={10} />
      <circle cx={COS_O.x} cy={COS_O.y} r={5} className="vz-card" stroke="currentColor" strokeWidth={3} />
      <Lab x={ax + 14} y={ay - 6} size={12} tone="ok">A</Lab>
      <Lab x={bx + 12 * Math.cos(rad(b))} y={by + 12 * Math.sin(rad(b)) + 5} size={12} tone="hot">B</Lab>

      {/* 닮음 눈금 — 각이 좁으면 1, 직각이면 0, 반대면 −1 */}
      <line x1={196} y1={96} x2={306} y2={96} stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
      <g stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
        <line x1={196} y1={90} x2={196} y2={102} />
        <line x1={251} y1={90} x2={251} y2={102} />
        <line x1={306} y1={90} x2={306} y2={102} />
      </g>
      <Lab x={196} y={118} size={11}>−1</Lab>
      <Lab x={251} y={118} size={11}>0</Lab>
      <Lab x={303} y={118} size={11}>1</Lab>
      <circle cx={gx} cy={96} r={8} className="vz-node-on" stroke="currentColor" strokeWidth={3} />
      <Lab x={251} y={68} size={13} tone="hot">cos {cv.toFixed(2)}</Lab>
      <Lab x={251} y={140} size={11}>닮은 정도</Lab>

      <Lab x={160} y={186} size={12}>길이를 바꿔도 각이 같으면 값은 그대로</Lab>
    </Frame>
  )
}

export const VISUALS_B2: Record<string, () => ReactNode> = {
  b2_llm: B2Llm,
  b2_token: B2Token,
  b2_context: B2Context,
  b2_embed: B2Embed,
  b2_attention: B2Attention,
  b2_next: B2NextToken,
  b2_temp: B2Temperature,
  b2_topp: B2TopP,
  b2_cosine: B2Cosine,
}
