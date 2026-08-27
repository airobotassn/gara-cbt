// DAILY QUIZ(/daily) 해설 그림 — 용어 하나에 SVG 한 장.
//
// ⚠️ 이 파일이 있는 이유: 해설을 글로만 쓰면 30초짜리 화면에서 안 읽힌다(2026-08-05 반려).
//    "이동 3 + 회전 3 = 6" 은 문장으로 읽힐 게 아니라 화살표 6개로 보여 줄 것.
//    새 용어를 붙일 때도 같은 기준으로 판단한다 — 문장이 그림보다 빠른 개념이면 그림을 만들지 말고
//    terms.ts 의 point/compare 만 채운다(그림 없는 용어도 정상이다).
//
// 색: SVG presentation attribute 에는 var() 가 안 먹는다(속성값은 CSS 값 파싱을 안 탄다).
//     그래서 **선은 stroke="currentColor"**(루트 .vz 가 color 를 잡는다), **면은 .vz-* 클래스**로 칠한다.
//     daily.css 의 토큰만 쓰므로 다크모드는 자동으로 따라온다.
import { useCallback, useRef, useState, type ReactNode } from 'react'

const VW = 320 // 모든 그림의 viewBox 가로(높이는 그림마다 다르다)

/** 그림 + 아래 조작줄 공통 껍데기 */
function Frame({ h, children, foot }: { h: number; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="dy-viz">
      <svg className="vz" viewBox={`0 0 ${VW} ${h}`} role="img">{children}</svg>
      {foot && <div className="dy-viz-foot">{foot}</div>}
    </div>
  )
}

/** 카툰 톤 팔 — 굵은 외곽선 위에 얇은 면을 덮어 '테두리 있는 막대'를 만든다. */
function Limb({ x1, y1, x2, y2, w = 15 }: { x1: number; y1: number; x2: number; y2: number; w?: number }) {
  return (
    <>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth={w} strokeLinecap="round" />
      <line x1={x1} y1={y1} x2={x2} y2={y2} className="vz-limb" strokeWidth={w - 6} strokeLinecap="round" />
    </>
  )
}

function Joint({ x, y, r = 7 }: { x: number; y: number; r?: number }) {
  return <circle cx={x} cy={y} r={r} className="vz-card" stroke="currentColor" strokeWidth={3} />
}

// ── 엔드 이펙터 ─────────────────────────────────────────────────────────────
// 팔은 그대로 두고 끝만 갈아 끼운다 + 그때 기준점(TCP)이 같이 옮겨간다 — 두 문장을 한 그림으로.
const EE_TOOLS = [
  { key: 'weld', name: '용접 토치', tip: 268 },
  { key: 'grip', name: '그리퍼', tip: 252 },
  { key: 'suct', name: '흡착 패드', tip: 240 },
] as const

function EndEffector() {
  const [i, setI] = useState(0)
  const tool = EE_TOOLS[i]
  const WX = 190 // 손목(도구가 붙는 자리)
  const WY = 62
  return (
    <Frame
      h={168}
      foot={EE_TOOLS.map((t, n) => (
        <button key={t.key} type="button" className={`dy-viz-chip${n === i ? ' on' : ''}`} onClick={() => setI(n)}>
          {t.name}
        </button>
      ))}
    >
      {/* 받침 + 2링크 팔 — 도구를 바꿔도 이 부분은 절대 안 움직인다(그게 요점이다) */}
      <rect x={22} y={116} width={58} height={30} rx={8} className="vz-mute" stroke="currentColor" strokeWidth={3} />
      <Limb x1={51} y1={122} x2={116} y2={62} />
      <Limb x1={116} y1={62} x2={WX} y2={WY} />
      <Joint x={51} y={122} />
      <Joint x={116} y={62} />
      <Joint x={WX} y={WY} r={6} />

      {/* 갈아 끼우는 부분 */}
      {tool.key === 'weld' && (
        <g>
          <path d={`M${WX} ${WY - 9} L${WX} ${WY + 9} L258 ${WY + 5} L258 ${WY - 5} Z`} className="vz-brand" stroke="currentColor" strokeWidth={3} strokeLinejoin="round" />
          <path d={`M262 ${WY - 7} l6 7 -6 7`} fill="none" className="vz-spark" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
      {tool.key === 'grip' && (
        <g stroke="currentColor" strokeWidth={3} strokeLinejoin="round">
          <rect x={WX} y={WY - 13} width={18} height={26} rx={5} className="vz-brand" />
          <path d={`M208 ${WY - 10} L246 ${WY - 16} L250 ${WY - 8} L212 ${WY - 3} Z`} className="vz-card" />
          <path d={`M208 ${WY + 10} L246 ${WY + 16} L250 ${WY + 8} L212 ${WY + 3} Z`} className="vz-card" />
        </g>
      )}
      {tool.key === 'suct' && (
        <g stroke="currentColor" strokeWidth={3} strokeLinejoin="round">
          <rect x={WX} y={WY - 7} width={26} height={14} rx={4} className="vz-brand" />
          <path d={`M216 ${WY - 4} L238 ${WY - 17} L238 ${WY + 17} L216 ${WY + 4} Z`} className="vz-teal" />
        </g>
      )}

      {/* 기준점 — 도구가 바뀌면 여기가 옮겨간다. 이동을 transition 으로 보여 준다. */}
      <g className="vz-tcp" style={{ transform: `translateX(${tool.tip - 120}px)` }}>
        <line x1={112} y1={WY} x2={128} y2={WY} strokeWidth={3} strokeLinecap="round" />
        <line x1={120} y1={WY - 8} x2={120} y2={WY + 8} strokeWidth={3} strokeLinecap="round" />
        <circle cx={120} cy={WY} r={11} fill="none" strokeWidth={3} />
        <text x={120} y={WY + 30} className="vz-lab-hot" textAnchor="middle">TCP</text>
      </g>

      <text x={22} y={162} className="vz-lab">여기는 그대로</text>
      <line x1={100} y1={158} x2={186} y2={158} className="vz-dash" strokeWidth={2.5} />
      <text x={244} y={162} className="vz-lab-hot" textAnchor="middle">여기만 교체</text>
    </Frame>
  )
}

// ── 자유도(DOF) ─────────────────────────────────────────────────────────────
// 이동 3 + 회전 3. 누르면 상자가 실제로 그 방향으로 움직인다 — 축 이름을 외우는 것보다 빠르다.
const DOF_AXES = [
  { n: '좌우', t: 'translateX(20px)', kind: 'move' },
  { n: '상하', t: 'translateY(-20px)', kind: 'move' },
  { n: '앞뒤', t: 'scale(1.18)', kind: 'move' },
  { n: '롤', t: 'rotate(24deg)', kind: 'turn' },
  { n: '피치', t: 'scaleY(0.6)', kind: 'turn' },
  { n: '요', t: 'scaleX(0.55)', kind: 'turn' },
] as const

function Dof() {
  const [act, setAct] = useState<number | null>(null)
  const timer = useRef(0)
  const poke = (i: number) => {
    setAct(i)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setAct(null), 900)
  }
  return (
    <Frame
      h={164}
      foot={DOF_AXES.map((a, i) => (
        <button
          key={a.n}
          type="button"
          className={`dy-viz-chip ${a.kind === 'move' ? 'mv' : 'tn'}${i === act ? ' on' : ''}`}
          onClick={() => poke(i)}
        >
          {a.n}
        </button>
      ))}
    >
      {/* 이동 3방향 화살표 */}
      <g className="vz-arrow" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M96 76 h-38 m0 0 l9 -7 m-9 7 l9 7" />
        <path d="M224 76 h38 m0 0 l-9 -7 m9 7 l-9 7" />
        <path d="M160 42 v-22 m0 0 l-7 9 m7 -9 l7 9" />
        <path d="M160 110 v22 m0 0 l-7 -9 m7 9 l7 -9" />
      </g>
      {/* 상자 — 정면 + 윗면으로 입체감만 준다 */}
      <g className="vz-box" style={act !== null ? { transform: DOF_AXES[act].t } : undefined}>
        <path d="M118 58 L146 38 L206 38 L178 58 Z" className="vz-brand-lo" stroke="currentColor" strokeWidth={3} strokeLinejoin="round" />
        <rect x={118} y={58} width={60} height={44} rx={4} className="vz-brand" stroke="currentColor" strokeWidth={3} />
        <path d="M178 58 L206 38 L206 82 L178 102 Z" className="vz-brand-hi" stroke="currentColor" strokeWidth={3} strokeLinejoin="round" />
      </g>
      {/* 회전 3축 — 상자를 감도는 호 */}
      <g className="vz-turn" strokeWidth={3} fill="none" strokeLinecap="round">
        <path d="M100 118 a62 22 0 0 0 124 0" />
        <path d="M224 118 l-9 -5 m9 5 l-4 9" />
        <path d="M96 30 a58 18 0 0 1 128 4" />
        <path d="M224 34 l-2 -10 m2 10 l-10 -2" />
      </g>
      {/* ⚠️ 캡션은 회전 호(아래쪽이 y≈140까지 내려온다)보다 아래에 둘 것 — 겹치면 글자가 호에 묻힌다. */}
      <text x={160} y={158} className="vz-lab" textAnchor="middle">이동 3 + 회전 3 = 6</text>
    </Frame>
  )
}

// ── 그리퍼(힘 조절) ─────────────────────────────────────────────────────────
// "힘 조절이 어렵다"를 읽는 것보다 한 번 밀어 보는 게 빠르다.
function Gripper() {
  const [f, setF] = useState(50)
  // 힘 → 손가락이 **안쪽으로** 들어오는 거리. 계란 표면까지가 11이라 f=50 에서 막 닿는다.
  // (처음엔 부호가 반대라 힘을 줄수록 벌어졌다 — 손가락은 서로를 향해 와야 한다.)
  // 상한 14 — 더 파고들면 손가락이 계란을 통째로 덮어서 "깨졌다"가 안 보인다.
  const close = Math.min(f * 0.22, 14)
  const state = f < 30 ? 'drop' : f > 74 ? 'crack' : 'ok'
  const msg = state === 'drop' ? '놓친다' : state === 'crack' ? '깨진다' : '딱 좋다'
  return (
    <Frame
      h={138}
      foot={
        <>
          <input
            className="dy-viz-range"
            type="range"
            min={0}
            max={100}
            value={f}
            onChange={(e) => setF(Number(e.target.value))}
            aria-label="쥐는 힘"
          />
          <span className={`dy-viz-state ${state}`}>{msg}</span>
        </>
      }
    >
      {/* 계란 — 놓치면 아래로 떨어지고, 세게 쥐면 금이 간다 */}
      <g className={`vz-egg ${state}`}>
        <ellipse cx={160} cy={58} rx={19} ry={25} className="vz-egg-b" stroke="currentColor" strokeWidth={3} />
        {state === 'crack' && (
          <path d="M153 42 l8 9 -7 8 9 8" fill="none" className="vz-crack" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        )}
      </g>
      {/* 손가락 — 힘을 줄수록 서로를 향해 들어온다 */}
      <g stroke="currentColor" strokeWidth={3} strokeLinejoin="round">
        <g className="vz-fing" style={{ transform: `translateX(${close}px)` }}>
          <rect x={88} y={36} width={24} height={44} rx={6} className="vz-brand" />
          <rect x={112} y={48} width={18} height={20} rx={5} className="vz-card" />
        </g>
        <g className="vz-fing" style={{ transform: `translateX(${-close}px)` }}>
          <rect x={208} y={36} width={24} height={44} rx={6} className="vz-brand" />
          <rect x={190} y={48} width={18} height={20} rx={5} className="vz-card" />
        </g>
      </g>
      <text x={160} y={128} className="vz-lab" textAnchor="middle">쥐는 힘을 밀어 보라</text>
    </Frame>
  )
}

// ── 매니퓰레이터(역기구학) ──────────────────────────────────────────────────
// 손끝을 끌면 관절이 따라온다 = 역기구학. 2링크라 해가 닫힌 형태로 나온다(수치해법 불필요).
const IK = { bx: 58, by: 148, l1: 66, l2: 56 }

function Manipulator() {
  const svgRef = useRef<SVGSVGElement>(null)
  const [tp, setTp] = useState<[number, number]>([176, 66])
  const [drag, setDrag] = useState(false)

  const move = useCallback((clientX: number, clientY: number) => {
    const el = svgRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = ((clientX - r.left) / r.width) * VW
    const y = ((clientY - r.top) / r.height) * 180
    // 팔이 닿는 고리(annulus) 밖이면 가장자리로 당겨 붙인다 — 못 닿는 곳을 잡으려 하면 그림이 깨진다.
    const dx = x - IK.bx
    const dy = y - IK.by
    const d = Math.hypot(dx, dy) || 1
    const lo = Math.abs(IK.l1 - IK.l2) + 6
    const hi = IK.l1 + IK.l2 - 3
    const k = Math.min(hi, Math.max(lo, d)) / d
    setTp([IK.bx + dx * k, IK.by + dy * k])
  }, [])

  const [tx, ty] = tp
  const dx = tx - IK.bx
  const dy = ty - IK.by
  const d = Math.hypot(dx, dy)
  const c2 = Math.min(1, Math.max(-1, (d * d - IK.l1 * IK.l1 - IK.l2 * IK.l2) / (2 * IK.l1 * IK.l2)))
  const t2 = -Math.acos(c2) // 팔꿈치를 위로 (화면 y 가 아래로 커지므로 음수)
  const t1 = Math.atan2(dy, dx) - Math.atan2(IK.l2 * Math.sin(t2), IK.l1 + IK.l2 * Math.cos(t2))
  const ex = IK.bx + IK.l1 * Math.cos(t1)
  const ey = IK.by + IK.l1 * Math.sin(t1)
  const deg = (r: number) => Math.round((r * 180) / Math.PI)

  return (
    <div className="dy-viz">
      <svg
        ref={svgRef}
        className="vz vz-grab"
        viewBox={`0 0 ${VW} 180`}
        role="img"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          setDrag(true)
          move(e.clientX, e.clientY)
        }}
        onPointerMove={(e) => drag && move(e.clientX, e.clientY)}
        onPointerUp={() => setDrag(false)}
        onPointerCancel={() => setDrag(false)}
      >
        <ellipse cx={IK.bx} cy={IK.by + 10} rx={34} ry={9} className="vz-mute" stroke="currentColor" strokeWidth={3} />
        <Limb x1={IK.bx} y1={IK.by} x2={ex} y2={ey} />
        <Limb x1={ex} y1={ey} x2={tx} y2={ty} w={13} />
        <Joint x={IK.bx} y={IK.by} />
        <Joint x={ex} y={ey} />
        {/* 관절 각도 — 끌 때 숫자가 같이 변하는 걸 보여 줘야 '역산'이 눈에 들어온다 */}
        <text x={IK.bx + 14} y={IK.by - 12} className="vz-lab">θ1 {deg(t1)}°</text>
        <text x={ex + 12} y={ey - 12} className="vz-lab">θ2 {deg(t2)}°</text>
        <circle cx={tx} cy={ty} r={13} className="vz-target" strokeWidth={3} />
        <circle cx={tx} cy={ty} r={4} className="vz-target-c" />
      </svg>
      <div className="dy-viz-foot">
        <span className="dy-viz-hint">👆 손끝을 끌어 보라 — 관절 각도가 알아서 따라온다</span>
      </div>
    </div>
  )
}

// ── 서보모터(폐루프) ────────────────────────────────────────────────────────
// 밀었을 때 되돌아오느냐 — 그 차이 하나가 서보와 스텝의 전부다.
function Servo() {
  const [servo, setServo] = useState(0) // 목표에서 벗어난 각도
  const [step, setStep] = useState(0)
  const timer = useRef(0)
  const push = () => {
    setServo(-34)
    setStep((s) => Math.max(-72, s - 34))
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setServo(0), 420) // 서보만 스스로 되돌아온다
  }
  const Dial = ({ cx, off, label, sub, ok }: { cx: number; off: number; label: string; sub: string; ok: boolean }) => (
    <g>
      <circle cx={cx} cy={50} r={30} className="vz-mute" stroke="currentColor" strokeWidth={3} />
      {/* 목표 눈금 — 바늘이 여기로 돌아오느냐가 전부다 */}
      <line x1={cx} y1={18} x2={cx} y2={28} className="vz-goal" strokeWidth={4} strokeLinecap="round" />
      <g className="vz-needle" style={{ transform: `rotate(${off}deg)`, transformOrigin: `${cx}px 50px` }}>
        <line x1={cx} y1={50} x2={cx} y2={24} stroke="currentColor" strokeWidth={5} strokeLinecap="round" />
      </g>
      <circle cx={cx} cy={50} r={5} className="vz-brand" stroke="currentColor" strokeWidth={3} />
      <text x={cx} y={136} className="vz-lab" textAnchor="middle">{label}</text>
      <text x={cx} y={151} className={ok ? 'vz-lab-ok' : 'vz-lab-bad'} textAnchor="middle">{sub}</text>
    </g>
  )
  return (
    <Frame
      h={162}
      foot={
        <button type="button" className="dy-viz-chip act" onClick={push}>
          부하로 밀어 보기
        </button>
      }
    >
      <Dial cx={84} off={servo} label="서보" sub="밀려도 되돌아온다" ok />
      <Dial cx={236} off={step} label="스텝" sub="밀린 줄 모른다" ok={false} />
      {/* 되먹임 고리 — 다이얼 → 엔코더 → 다시 다이얼. 서보 쪽에만 있고, 이 고리가 곧 차이다.
          ⚠️ 예전엔 다이얼 밑을 지나는 호 하나였는데 다이얼에 가려 안 보였다. 고리를 밖으로 뺀다. */}
      <g className="vz-fb" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M84 82 v10 m0 0 l-5 -6 m5 6 l5 -6" />
        <path d="M54 108 C28 104 26 56 52 46" />
        <path d="M52 46 l2 8 m-2 -8 l7 3" />
      </g>
      <rect x={54} y={94} width={60} height={22} rx={7} className="vz-card" stroke="currentColor" strokeWidth={3} />
      <text x={84} y={109} className="vz-lab-hot" textAnchor="middle">엔코더</text>
      <text x={236} y={109} className="vz-lab-bad" textAnchor="middle">되먹임 없음</text>
    </Frame>
  )
}

// ── 딥러닝(층) ──────────────────────────────────────────────────────────────
// 층이 깊어질수록 보는 게 커진다 — 층 그림 하나면 끝난다.
const DL_COLS = [
  { x: 46, n: 3, cap: '입력' },
  { x: 122, n: 4, cap: '선·모서리' },
  { x: 198, n: 4, cap: '눈·코·입' },
  { x: 274, n: 2, cap: '얼굴' },
] as const

function DeepLayers() {
  const [sel, setSel] = useState(1)
  const yOf = (n: number, i: number) => 60 + (i - (n - 1) / 2) * 22
  return (
    <Frame h={158}>
      {/* 층 사이 연결선 — 흐리게 깔아 '쌓여 있다'만 보이면 된다 */}
      <g className="vz-web" strokeWidth={1.2}>
        {DL_COLS.slice(0, -1).map((c, ci) =>
          Array.from({ length: c.n }, (_, i) =>
            Array.from({ length: DL_COLS[ci + 1].n }, (_, j) => (
              <line key={`${ci}-${i}-${j}`} x1={c.x} y1={yOf(c.n, i)} x2={DL_COLS[ci + 1].x} y2={yOf(DL_COLS[ci + 1].n, j)} />
            )),
          ),
        )}
      </g>
      {DL_COLS.map((c, ci) => (
        <g key={c.cap} onClick={() => setSel(ci)} style={{ cursor: 'pointer' }}>
          <rect x={c.x - 30} y={12} width={60} height={132} rx={10} className={ci === sel ? 'vz-colsel' : 'vz-col'} />
          {Array.from({ length: c.n }, (_, i) => (
            <circle key={i} cx={c.x} cy={yOf(c.n, i)} r={8} className={ci === sel ? 'vz-node-on' : 'vz-node'} stroke="currentColor" strokeWidth={2.5} />
          ))}
          <text x={c.x} y={136} className={ci === sel ? 'vz-lab-hot' : 'vz-lab'} textAnchor="middle">{c.cap}</text>
        </g>
      ))}
      <text x={160} y={154} className="vz-lab" textAnchor="middle">뒤로 갈수록 큰 걸 본다</text>
    </Frame>
  )
}

// ── 인공지능(범위) ──────────────────────────────────────────────────────────
// 포함관계는 문장으로 설명할 게 아니라 겹쳐 그리면 끝이다.
function AiScope() {
  return (
    <Frame h={150}>
      <rect x={14} y={14} width={292} height={124} rx={18} className="vz-scope1" stroke="currentColor" strokeWidth={3} />
      <text x={26} y={36} className="vz-lab-hot">인공지능 (AI)</text>
      <rect x={44} y={44} width={232} height={82} rx={14} className="vz-scope2" stroke="currentColor" strokeWidth={3} />
      <text x={56} y={64} className="vz-lab">머신러닝</text>
      <rect x={80} y={72} width={160} height={44} rx={11} className="vz-scope3" stroke="currentColor" strokeWidth={3} />
      <text x={160} y={100} className="vz-lab-inv" textAnchor="middle">딥러닝</text>
    </Frame>
  )
}

// ── 피지컬 AI(순환) ─────────────────────────────────────────────────────────
// 한 바퀴 돈다는 걸 말로 하면 안 남는다. 돌려서 보여 준다.
const PA_NODES = [
  { a: -90, t: '인식' },
  { a: 0, t: '판단' },
  { a: 90, t: '행동' },
  { a: 180, t: '환경이 바뀜' },
] as const

function PhysicalLoop() {
  const cx = 160
  const cy = 76
  const R = 54
  const pt = (a: number, r = R) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)]
  return (
    <Frame h={166}>
      <circle cx={cx} cy={cy} r={R} fill="none" className="vz-dash" strokeWidth={3} />
      {PA_NODES.map((n) => {
        const [x, y] = pt(n.a)
        return (
          <g key={n.t}>
            <rect x={x - 34} y={y - 14} width={68} height={28} rx={9} className="vz-card" stroke="currentColor" strokeWidth={3} />
            <text x={x} y={y + 5} className="vz-lab" textAnchor="middle">{n.t}</text>
          </g>
        )
      })}
      {/* 도는 점 — 회전 그룹 하나로 끝낸다(SMIL·offset-path 없이).
          ⚠️ 노드보다 **뒤에** 그리면 네 지점을 지날 때마다 상자에 가려 안 보인다. 반드시 위에. */}
      <g className="vz-orbit" style={{ transformOrigin: `${cx}px ${cy}px` }}>
        <circle cx={cx + R} cy={cy} r={7} className="vz-gold-f" stroke="currentColor" strokeWidth={3} />
      </g>
      <text x={160} y={160} className="vz-lab" textAnchor="middle">내 행동이 다음에 볼 것을 바꾼다</text>
    </Frame>
  )
}

// ── 등록표 ──────────────────────────────────────────────────────────────────
// terms.ts 의 TermTheory.visual 이 이 키를 가리킨다. 키가 없으면 그림 없이 글만 나온다.
const DAILY_VISUALS: Record<string, () => ReactNode> = {
  endEffector: EndEffector,
  dof: Dof,
  gripper: Gripper,
  manipulator: Manipulator,
  servo: Servo,
  deep: DeepLayers,
  aiScope: AiScope,
  physical: PhysicalLoop,
}

export default function DailyVisual({ name }: { name?: string }) {
  const V = name ? DAILY_VISUALS[name] : undefined
  if (!V) return null
  return <V />
}
