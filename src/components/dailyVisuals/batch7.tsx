// DAILY QUIZ 해설 그림 — 배치 7 「알고리즘과 코드의 흐름」.
//
// 이 묶음은 **과정이 눈에 보이는 것**이 전부다. 그래서 여덟 장 중 여섯 장이 단계를 넘기는 조작을 갖는다
// (회차를 넘기면 막대가 굳고, 단계를 밀면 비교 횟수가 갈리고, 조건을 켜면 불이 켜진다).
//
// ⛔ 코드 문자열(`for i in range(3)` 같은 것)을 SVG 에 적지 말 것 — 그건 코드 스크린샷이지 그림이 아니다.
//    반복은 '격자를 훑는 순서'로, 조건은 '겹친 자리'로, 예외는 '샛길'로 그린다.
// ⛔ 색을 직접 쓰지 말 것. 선은 currentColor, 면은 .vz-* 클래스(daily.css)만.
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Frame, Box, Arrow, Lab, Chip } from './kit'
// 글자가 식과 섞이는 자리(‘AND 울린다’ 처럼)는 Lab 이 통째로 못 갈아 끼우므로 조각만 여기서 번역한다.
import { tLab } from '../../lib/dailyI18n'

// ── 빅오 표기법 ─────────────────────────────────────────────────────────────
// N 을 밀면 네 곡선이 갈라진다. 작은 N 에서는 다 붙어 있다가 커지면 하나만 화면 밖으로 나간다 —
// "몇 초 걸리나"가 아니라 "몇 배로 불어나나"라는 걸 곡선 모양 하나로 말한다.
const BO_X = (n: number) => 44 + (n * 256) / 12 // N: 0~12 → x: 44~300
const BO_Y = (v: number) => 140 - Math.min(v, 16) * 7.125 // 연산 횟수 0~16 → y: 140~26(천장)
const BO_LOG = (n: number) => Math.log2(n)

/** 곡선 하나를 폴리라인 문자열로. 천장(16회)을 넘는 구간은 그리지 않는다 — 그게 '화면 밖으로 나간다'다. */
function boPath(f: (n: number) => number, upTo: number) {
  const pts: string[] = []
  for (let n = 1; n <= upTo; n++) pts.push(`${BO_X(n).toFixed(1)} ${BO_Y(f(n)).toFixed(1)}`)
  return `M${pts.join(' L')}`
}

function B7BigO() {
  const [n, setN] = useState(6)
  const mx = BO_X(n)
  return (
    <Frame
      h={182}
      foot={
        <>
          <input
            className="dy-viz-range"
            type="range"
            min={1}
            max={12}
            value={n}
            onChange={(e) => setN(Number(e.target.value))}
            aria-label="데이터 개수"
          />
          <span className="dy-viz-hint">
            N={n} → 한 줄씩 {n}회 · 짝지어 {n * n}회
          </span>
        </>
      }
    >
      {/* 축 */}
      <g stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
        <line x1={44} y1={20} x2={44} y2={140} />
        <line x1={44} y1={140} x2={306} y2={140} />
      </g>
      <Lab x={44} y={15} anchor="start" size={11}>연산 횟수</Lab>

      {/* 지금 보고 있는 N */}
      <line x1={mx} y1={26} x2={mx} y2={140} className="vz-dash" strokeWidth={2.5} />

      {/* 네 곡선 — 평평 · 완만 · 직선 · 폭발 */}
      <g fill="none" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <line x1={BO_X(1)} y1={BO_Y(1)} x2={BO_X(12)} y2={BO_Y(1)} className="vz-fb" />
        <path d={boPath(BO_LOG, 12)} className="vz-arrow" />
        <path d={boPath((k) => k, 12)} className="vz-turn" />
        <path d={boPath((k) => k * k, 4)} className="vz-goal" />
      </g>
      {/* 천장을 뚫고 나가는 곡선 — 여기서 끝난 게 아니라 화면 밖으로 간 것이다 */}
      <Arrow x1={BO_X(4)} y1={34} x2={BO_X(4)} y2={18} tone="bad" w={3} head={7} />

      {/* 지금 N 에서의 값 — 천장 안에 있는 것만 점으로 찍는다 */}
      <g stroke="currentColor" strokeWidth={2.5}>
        <circle cx={mx} cy={BO_Y(1)} r={4} className="vz-card" />
        <circle cx={mx} cy={BO_Y(BO_LOG(n))} r={4} className="vz-card" />
        <circle cx={mx} cy={BO_Y(n)} r={4} className="vz-card" />
        {n <= 4 && <circle cx={mx} cy={BO_Y(n * n)} r={4} className="vz-card" />}
      </g>

      <Lab x={135} y={40} anchor="start" tone="bad" size={12}>짝지어 훑기</Lab>
      <Lab x={298} y={40} anchor="end" size={12}>한 줄씩</Lab>
      <Lab x={298} y={108} anchor="end" tone="ok" size={12}>절반씩</Lab>
      <Lab x={48} y={128} anchor="start" size={12}>한 번에</Lab>
      <Lab x={176} y={156} size={11}>데이터 개수 N →</Lab>
      <Lab x={160} y={174} size={12}>작을 땐 다 비슷하다. 커지면 갈린다.</Lab>
    </Frame>
  )
}

// ── 선택 정렬 ───────────────────────────────────────────────────────────────
// 회차를 넘길 때마다 '남은 것 중 제일 작은 막대'가 앞으로 오고, 왼쪽이 한 칸씩 굳는다.
// 정렬은 결과가 아니라 **회차**라서, 단계를 안 넘기면 아무것도 안 보인다.
const SS_STEPS = [
  [5, 9, 3, 8, 2, 6],
  [2, 9, 3, 8, 5, 6],
  [2, 3, 9, 8, 5, 6],
  [2, 3, 5, 8, 9, 6],
  [2, 3, 5, 6, 9, 8],
  [2, 3, 5, 6, 8, 9],
]
const SS_CHIP = ['처음', '1회', '2회', '3회', '4회', '끝']
const SS_X = (i: number) => 34 + i * 42

function B7Select() {
  const [k, setK] = useState(0)
  const bars = SS_STEPS[k]
  const done = k >= 5
  // 남은 구간(k 이후)에서 가장 작은 막대 — 이번 회차에 맨 앞으로 갈 놈이다.
  let mi = k
  for (let i = k; i < bars.length; i++) if (bars[i] < bars[mi]) mi = i
  return (
    <Frame
      h={168}
      foot={SS_CHIP.map((c, i) => (
        <Chip key={c} on={i === k} onClick={() => setK(i)}>{c}</Chip>
      ))}
    >
      <Lab x={160} y={18} tone={done ? 'ok' : 'hot'} size={12}>
        {done ? '더 바꿀 게 없다' : '남은 것 중 가장 작은 값을 맨 앞으로'}
      </Lab>
      {!done && (
        <>
          <line x1={SS_X(mi) + 15} y1={30} x2={SS_X(mi) + 15} y2={132 - bars[mi] * 10 - 4} className="vz-dash" strokeWidth={2} />
          <line x1={SS_X(k) + 15} y1={30} x2={SS_X(k) + 15} y2={132 - bars[k] * 10 - 4} className="vz-dash" strokeWidth={2} />
          <Arrow x1={SS_X(mi) + 15} y1={30} x2={SS_X(k) + 15} y2={30} tone="turn" />
        </>
      )}

      {bars.map((v, i) => {
        const sorted = i < k
        const picked = !done && i === mi
        return (
          <g key={i}>
            <rect
              x={SS_X(i)}
              y={132 - v * 10}
              width={30}
              height={v * 10}
              rx={5}
              className={sorted ? 'vz-brand' : picked ? 'vz-gold-f' : 'vz-mute'}
              stroke="currentColor"
              strokeWidth={3}
            />
            <text x={SS_X(i) + 15} y={126} className={sorted ? 'vz-lab-inv' : 'vz-lab'} fontSize={12} textAnchor="middle">{v}</text>
          </g>
        )
      })}
      <line x1={28} y1={132} x2={286} y2={132} stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
      {k > 0 && <line x1={34} y1={140} x2={SS_X(k - 1) + 30} y2={140} className="vz-fb" strokeWidth={4} strokeLinecap="round" />}
      <Lab x={34} y={158} anchor="start" tone={k > 0 ? 'ok' : 'mute'} size={11}>
        {k > 0 ? `왼쪽 ${k}칸은 이미 제자리` : '아직 아무 데도 제자리가 아니다'}
      </Lab>
    </Frame>
  )
}

// ── 순차 탐색 ───────────────────────────────────────────────────────────────
// 같은 값을 같은 배열에서 찾는데 비교 횟수만 다르다. 단계를 밀면 위는 한 칸씩 기어가고
// 아래는 절반씩 지운다 — 두 카운터가 벌어지는 속도가 이 개념의 전부다.
const LS_VALS = [3, 7, 11, 15, 19, 23, 27, 31, 35, 39, 43, 47]
const LS_X = (i: number) => 26 + i * 22
const LS_MID = [5, 8, 10] // 이진 탐색이 짚는 자리(찾는 값 43 = 10번 칸)
const LS_LO = [0, 6, 9] // 그때 남아 있는 구간의 왼쪽 끝

function B7Linear() {
  const [s, setS] = useState(3)
  const li = Math.min(s - 1, 10) // 순차가 지금 짚는 칸
  const liDone = s >= 11
  const bs = Math.min(s, 3)
  const bi = LS_MID[bs - 1]
  const lo = LS_LO[bs - 1]
  const bsDone = bs >= 3

  const row = (y: number, cur: number, hit: boolean, gone: (i: number) => boolean) =>
    LS_VALS.map((v, i) => {
      const on = i === cur
      const fill = on ? (hit ? 'vz-brand' : 'vz-gold-f') : gone(i) ? 'vz-mute' : 'vz-card'
      return (
        <g key={i}>
          <rect x={LS_X(i)} y={y} width={20} height={22} rx={4} className={fill} stroke="currentColor" strokeWidth={2.5} />
          <text x={LS_X(i) + 10} y={y + 15} className={on && hit ? 'vz-lab-inv' : 'vz-lab'} fontSize={11} textAnchor="middle">{v}</text>
        </g>
      )
    })

  return (
    <Frame
      h={152}
      foot={
        <>
          <input
            className="dy-viz-range"
            type="range"
            min={1}
            max={11}
            value={s}
            onChange={(e) => setS(Number(e.target.value))}
            aria-label="단계"
          />
          <span className="dy-viz-hint">단계 {s}</span>
        </>
      }
    >
      <Lab x={160} y={22} tone="hot" size={12}>43 을 찾아라</Lab>

      <Lab x={26} y={40} anchor="start" size={11}>앞에서부터 하나씩</Lab>
      <Lab x={294} y={40} anchor="end" tone="bad" size={12}>비교 {Math.min(s, 11)}회</Lab>
      {row(46, li, liDone, (i) => i < li)}
      {li > 0 && <line x1={LS_X(0) + 2} y1={57} x2={LS_X(li) - 2} y2={57} className="vz-dash" strokeWidth={2} />}

      <Lab x={26} y={92} anchor="start" size={11}>절반씩 지우기</Lab>
      <Lab x={294} y={92} anchor="end" tone="ok" size={12}>비교 {bs}회</Lab>
      {row(98, bi, bsDone, (i) => i < lo)}
      {lo > 0 && <line x1={LS_X(0) + 2} y1={109} x2={LS_X(lo) - 2} y2={109} className="vz-dash" strokeWidth={2} />}

      <Lab x={160} y={142} size={11}>같은 값을 찾는데 비교 횟수가 다르다</Lab>
    </Frame>
  )
}

// ── 중첩 루프 ───────────────────────────────────────────────────────────────
// 바깥이 한 줄을 고르면 안쪽이 그 줄을 통째로 훑는다. 그래서 3+3 이 아니라 3×3 이다.
const NL_X = (j: number) => 116 + j * 38
const NL_Y = (i: number) => 44 + i * 38

function B7Nested() {
  const [s, setS] = useState(4) // 지금까지 칠한 칸 수 0~9
  const i = s > 0 ? Math.floor((s - 1) / 3) : -1
  const j = s > 0 ? (s - 1) % 3 : -1
  return (
    <Frame
      h={196}
      foot={
        <>
          <input
            className="dy-viz-range"
            type="range"
            min={0}
            max={9}
            value={s}
            onChange={(e) => setS(Number(e.target.value))}
            aria-label="실행 횟수"
          />
          <span className="dy-viz-hint">{s > 0 ? `${i + 1}번째 줄의 ${j + 1}번째 칸` : '아직 시작 전'}</span>
        </>
      }
    >
      <Lab x={170} y={18} tone="ok" size={12}>안쪽 = 칸을 훑는다</Lab>
      {j >= 0 && <Arrow x1={NL_X(j) + 16} y1={26} x2={NL_X(j) + 16} y2={40} tone="turn" head={7} />}
      {i >= 0 && (
        <>
          <Lab x={88} y={NL_Y(i) + 21} anchor="end" tone="hot" size={12}>바깥</Lab>
          <Arrow x1={92} y1={NL_Y(i) + 16} x2={110} y2={NL_Y(i) + 16} tone="flow" head={7} />
        </>
      )}

      {[0, 1, 2].map((r) =>
        [0, 1, 2].map((c) => {
          const n = r * 3 + c
          return (
            <rect
              key={n}
              x={NL_X(c)}
              y={NL_Y(r)}
              width={32}
              height={32}
              rx={6}
              className={n < s - 1 ? 'vz-brand' : n === s - 1 ? 'vz-gold-f' : 'vz-card'}
              stroke="currentColor"
              strokeWidth={3}
            />
          )
        }),
      )}

      <Lab x={170} y={172} tone="hot" size={13}>{s} / 9 번 실행</Lab>
      <Lab x={170} y={188} size={11}>바깥 3 번 × 안쪽 3 번</Lab>
    </Frame>
  )
}

// ── AND 연산자 ──────────────────────────────────────────────────────────────
// 조건 두 개를 손으로 켜 본다. 겹친 자리에서만 왼쪽 불이 들어오고, 오른쪽(OR)은 하나만 켜도 들어온다.
function B7And() {
  const [a, setA] = useState(true)
  const [b, setB] = useState(false)
  const and = a && b
  const or = a || b
  return (
    <Frame
      h={192}
      foot={
        <>
          <Chip on={a} onClick={() => setA(!a)}>온도 40도↑</Chip>
          <Chip on={b} onClick={() => setB(!b)}>연기 감지</Chip>
        </>
      }
    >
      <Lab x={160} y={22} size={11}>조건 두 개를 켜 보라</Lab>
      <circle cx={128} cy={70} r={40} className={a ? 'vz-scope2' : 'vz-mute'} stroke="currentColor" strokeWidth={3} />
      <circle cx={192} cy={70} r={40} className={b ? 'vz-scope2' : 'vz-mute'} stroke="currentColor" strokeWidth={3} />
      {/* 겹친 부분(렌즈) — 두 원의 교점 (160,46)·(160,94) 를 각 원의 호로 잇는다 */}
      <path
        d="M160 46 A40 40 0 0 1 160 94 A40 40 0 0 1 160 46 Z"
        className={and ? 'vz-scope3' : 'vz-mute'}
        stroke="currentColor"
        strokeWidth={3}
      />
      <Lab x={104} y={75} size={12} tone={a ? 'hot' : 'mute'}>온도</Lab>
      <Lab x={216} y={75} size={12} tone={b ? 'hot' : 'mute'}>연기</Lab>

      <Box x={20} y={124} w={132} h={34} r={11} tone={and ? 'gold' : 'mute'} />
      <Lab x={86} y={146} size={12}>{`AND ${tLab(and ? '울린다' : '조용')}`}</Lab>
      <Box x={168} y={124} w={132} h={34} r={11} tone={or ? 'gold' : 'mute'} />
      <Lab x={234} y={146} size={12}>{`OR ${tLab(or ? '울린다' : '조용')}`}</Lab>

      <Lab x={160} y={180} size={11}>겹친 자리에서만 AND 가 켜진다</Lab>
    </Frame>
  )
}

// ── 순서도 ──────────────────────────────────────────────────────────────────
// 온도를 밀면 마름모에서 길이 갈린다. 안 지나간 길은 회색 점선으로 남아 '갈림길'이 눈에 보인다.
function B7Flow() {
  const [t, setT] = useState(26)
  const hot = t >= 40
  return (
    <Frame
      h={200}
      foot={
        <>
          <input
            className="dy-viz-range"
            type="range"
            min={0}
            max={60}
            value={t}
            onChange={(e) => setT(Number(e.target.value))}
            aria-label="온도"
          />
          <span className={`dy-viz-state ${hot ? 'crack' : 'drop'}`}>{hot ? '부저 켜짐' : '조용'}</span>
        </>
      }
    >
      {/* 시작(타원) → 읽기(평행사변형) → 판단(마름모) → 실행(직사각형) */}
      <ellipse cx={160} cy={17} rx={32} ry={11} className="vz-card" stroke="currentColor" strokeWidth={3} />
      <Lab x={160} y={21} size={11}>시작</Lab>
      <Arrow x1={160} y1={28} x2={160} y2={38} tone="flow" head={7} />

      <path d="M116 40 H216 L204 66 H104 Z" className="vz-card" stroke="currentColor" strokeWidth={3} strokeLinejoin="round" />
      <Lab x={160} y={58} size={12}>{`${tLab('온도')} ${t}°`}</Lab>
      <Arrow x1={160} y1={66} x2={160} y2={76} tone="flow" head={7} />

      <path d="M160 78 L222 104 L160 130 L98 104 Z" className="vz-mute" stroke="currentColor" strokeWidth={3} strokeLinejoin="round" />
      <Lab x={160} y={108} size={11}>40도 넘나?</Lab>

      {/* 예 — 오른쪽으로 나갔다가 아래로 */}
      <line x1={222} y1={104} x2={248} y2={104} className={hot ? 'vz-arrow' : 'vz-dash'} strokeWidth={3} strokeLinecap="round" />
      <Arrow x1={248} y1={104} x2={248} y2={142} tone={hot ? 'flow' : 'dash'} head={7} />
      <Lab x={228} y={98} size={11} anchor="start" tone={hot ? 'ok' : 'mute'}>예</Lab>
      <rect x={200} y={144} width={96} height={30} rx={7} className={hot ? 'vz-gold-f' : 'vz-card'} stroke="currentColor" strokeWidth={3} />
      <Lab x={248} y={163} size={11}>부저 켜기</Lab>

      {/* 아니오 — 왼쪽으로 나갔다가 위로 되돌아간다(다시 읽는다) */}
      <path d="M98 104 H44 V53" fill="none" className={hot ? 'vz-dash' : 'vz-turn'} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <Arrow x1={44} y1={53} x2={106} y2={53} tone={hot ? 'dash' : 'turn'} head={7} />
      <Lab x={92} y={98} size={11} anchor="end" tone={hot ? 'mute' : 'hot'}>아니오</Lab>

      <Lab x={160} y={192} size={11}>마름모에서 길이 갈린다</Lab>
    </Frame>
  )
}

// ── 예외 처리 ───────────────────────────────────────────────────────────────
// 같은 오류를 두 흐름에 똑같이 던진다. 위는 샛길로 빠졌다 돌아와 계속 가고, 아래는 그 자리에서 끊긴다.
function B7Except() {
  const [err, setErr] = useState(true)
  return (
    <Frame
      h={188}
      foot={
        <>
          <Chip on={!err} onClick={() => setErr(false)}>정상</Chip>
          <Chip on={err} onClick={() => setErr(true)}>오류 발생</Chip>
        </>
      }
    >
      <Lab x={14} y={26} anchor="start" tone="ok" size={12}>예외 처리 있음</Lab>
      <path
        d={err ? 'M26 62 H140 L150 96 H214 L224 62 H274' : 'M26 62 H274'}
        fill="none"
        className="vz-arrow"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Arrow x1={274} y1={62} x2={292} y2={62} tone="flow" head={7} />
      {err && (
        <>
          <Lab x={140} y={44} size={12} tone="bad">오류!</Lab>
          <line x1={140} y1={50} x2={140} y2={58} className="vz-goal" strokeWidth={3} strokeLinecap="round" />
          <Box x={150} y={84} w={64} h={24} r={8} tone="card" />
          <Lab x={182} y={100} size={11} tone="ok">안전 동작</Lab>
        </>
      )}
      <Lab x={292} y={48} size={11} anchor="end" tone="ok">계속 간다</Lab>

      <Lab x={14} y={128} anchor="start" size={12}>예외 처리 없음</Lab>
      <path
        d={err ? 'M26 146 H132' : 'M26 146 H274'}
        fill="none"
        className="vz-arrow"
        strokeWidth={3}
        strokeLinecap="round"
      />
      {err ? (
        <>
          <path d="M136 134 l8 8 -8 6 8 8" fill="none" className="vz-crack" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
          <line x1={156} y1={146} x2={290} y2={146} className="vz-dash" strokeWidth={3} />
          <Lab x={290} y={134} size={11} anchor="end" tone="bad">여기서 멈춘다</Lab>
        </>
      ) : (
        <>
          <Arrow x1={274} y1={146} x2={292} y2={146} tone="flow" head={7} />
          <Lab x={292} y={134} size={11} anchor="end">계속 간다</Lab>
        </>
      )}

      <Lab x={160} y={176} size={11}>{err ? '샛길이 있는 쪽만 끝까지 간다' : '오류를 던져 보라'}</Lab>
    </Frame>
  )
}

// ── 메시지 방송 ─────────────────────────────────────────────────────────────
// 한 번 쏜 신호가 셋에게 동시에 닿는다. 보내는 쪽은 누가 받는지 모르고, 받는 쪽이 각자 다른 일을 시작한다.
const BC_RX = [
  { y: 44, act: '달린다' },
  { y: 92, act: '소리 낸다' },
  { y: 140, act: '색이 바뀐다' },
]

function B7Broadcast() {
  const [sent, setSent] = useState(false)
  const tone = sent ? 'flow' : 'dash'
  return (
    <Frame
      h={190}
      foot={<Chip on={sent} onClick={() => setSent(!sent)}>신호 쏘기</Chip>}
    >
      <Box x={16} y={72} w={64} h={40} r={10} tone={sent ? 'gold' : 'card'} />
      <Lab x={48} y={97} size={11}>보내는 쪽</Lab>

      <Arrow x1={80} y1={92} x2={122} y2={92} tone={tone} head={7} />
      <line x1={124} y1={44} x2={124} y2={140} className={sent ? 'vz-arrow' : 'vz-dash'} strokeWidth={3} strokeLinecap="round" />

      {BC_RX.map((r) => (
        <g key={r.act}>
          <Arrow x1={124} y1={r.y} x2={184} y2={r.y} tone={tone} head={7} />
          <Box x={188} y={r.y - 14} w={108} h={28} r={9} tone={sent ? 'gold' : 'mute'} />
          <circle cx={200} cy={r.y} r={5} className={sent ? 'vz-node-on' : 'vz-node'} stroke="currentColor" strokeWidth={2.5} />
          <Lab x={248} y={r.y + 5} size={11}>{tLab(sent ? r.act : '기다린다')}</Lab>
        </g>
      ))}

      <Lab x={160} y={176} tone={sent ? 'ok' : 'mute'} size={11}>
        {sent ? '셋이 같은 순간에 시작한다' : '받을 쪽은 신호를 기다리고 있다'}
      </Lab>
    </Frame>
  )
}

// ── 등록표 ──────────────────────────────────────────────────────────────────
export const VISUALS_B7: Record<string, () => ReactNode> = {
  b7_bigo: B7BigO,
  b7_select_sort: B7Select,
  b7_linear_search: B7Linear,
  b7_nested_loop: B7Nested,
  b7_and: B7And,
  b7_flowchart: B7Flow,
  b7_except: B7Except,
  b7_broadcast: B7Broadcast,
}
