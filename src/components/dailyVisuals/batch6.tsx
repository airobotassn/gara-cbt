// DAILY QUIZ 해설 그림 — 배치 6 「센서와 회로」.
//
// 이 묶음의 공통 주제 = **물리량이 신호로 바뀌는 순간**. 그래서 그림마다 '재는 값'이 하나씩 있고,
// 그 값을 밀면 결과가 같이 움직인다(초음파=왕복 시간 · 조도=밝기 · PWM=켜짐 폭 · 아날로그=표본 수).
// 정적인 두 장은 대신 상태를 바꿔 본다(자이로=밀어 보기 · 드라이버=거쳐서/바로).
//
// ⛔ 색을 직접 쓰지 말 것 — 선은 stroke="currentColor", 면은 .vz-* 클래스(daily.css 에 있는 것만).
// ⚠️ 부드러운 이동이 필요한 자리는 daily.css 에 이미 있는 전이 클래스를 빌려 쓴다(vz-needle = transform .38s).
//    새 클래스를 만들면 daily.css 를 고쳐야 하는데 그건 공용 파일이다.
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Frame, Limb, Box, Arrow, Lab, Chip } from './kit'

// ── 초음파 센서 ─────────────────────────────────────────────────────────────
// 요점은 '거리를 잰다'가 아니라 **시간을 재서 거리로 바꾼다**는 것. 그래서 벽을 밀면
// 거리와 왕복 시간 막대가 **같이** 늘어난다 — 둘이 한 몸이라는 게 눈에 보여야 한다.
function B6Ultrasonic() {
  const [cm, setCm] = useState(80)
  const wallX = 112 + ((cm - 30) / 170) * 176 // 30cm → 112 · 200cm → 288
  const ms = cm * 0.0588 // 왕복 = 2d ÷ 340m/s → 1cm 당 58.8µs
  const barW = Math.max(10, (ms / 11.8) * 280)
  const mid = (58 + wallX) / 2
  return (
    <Frame
      h={202}
      foot={
        <input
          className="dy-viz-range"
          type="range"
          min={30}
          max={200}
          step={5}
          value={cm}
          onChange={(e) => setCm(Number(e.target.value))}
          aria-label="벽까지 거리"
        />
      }
    >
      {/* 센서 — 위가 스피커(쏜다), 아래가 마이크(듣는다) */}
      <Box x={16} y={38} w={42} h={58} r={9} tone="card" />
      <circle cx={37} cy={54} r={11} className="vz-brand" stroke="currentColor" strokeWidth={3} />
      <circle cx={37} cy={80} r={11} className="vz-teal" stroke="currentColor" strokeWidth={3} />

      <Box x={wallX} y={22} w={16} h={90} r={4} tone="mute" />

      <Arrow x1={64} y1={54} x2={wallX - 4} y2={54} tone="flow" />
      <Arrow x1={wallX - 4} y1={80} x2={64} y2={80} tone="turn" />
      {/* ⚠️ 라벨을 화살표 가운데 두면 벽이 가까울 때 벽 위에 얹힌다 — 센서 쪽에 붙여 둔다. */}
      <Lab x={68} y={46} tone="ok" size={12} anchor="start">쏜다</Lab>
      <Lab x={68} y={100} size={12} anchor="start">돌아옴</Lab>

      {/* 잰 거리 */}
      <g stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
        <line x1={58} y1={126} x2={wallX} y2={126} />
        <line x1={58} y1={120} x2={58} y2={132} />
        <line x1={wallX} y1={120} x2={wallX} y2={132} />
      </g>
      <Lab x={mid} y={146} tone="hot" size={12}>거리 {cm}cm</Lab>

      {/* 실제로 센서가 가진 값은 이 시간 하나뿐이다 */}
      <Lab x={20} y={166} size={11} anchor="start">왕복 시간</Lab>
      <Lab x={300} y={166} size={11} tone="hot" anchor="end">{ms.toFixed(1)} ms</Lab>
      <rect x={20} y={172} width={280} height={13} rx={6} className="vz-mute" stroke="currentColor" strokeWidth={2.5} />
      <rect x={20} y={172} width={barW} height={13} rx={6} className="vz-teal" />

      <Lab x={160} y={198} size={12}>왕복 시간 × 소리 속도 ÷ 2 = 거리</Lab>
    </Frame>
  )
}

// ── 자이로 센서 ─────────────────────────────────────────────────────────────
// 각도가 아니라 **도는 속도**를 잰다. 그래서 밀면 막대가 튀었다가, 기울어진 채 멈추면 0 으로 돌아온다
// (기울어 있는데 0 인 그 상태가 자이로와 가속도 센서를 가르는 지점이다).
function B6Gyro() {
  const [tilt, setTilt] = useState(0)
  const [omega, setOmega] = useState(0)
  const [boost, setBoost] = useState<'L' | 'R' | null>(null)
  const timers = useRef<number[]>([])

  const push = (dir: 1 | -1) => {
    timers.current.forEach((id) => window.clearTimeout(id))
    const side: 'L' | 'R' = dir > 0 ? 'R' : 'L' // 시계방향(+)이면 오른쪽이 내려간다
    setTilt(dir * 18)
    setOmega(dir * 120)
    setBoost(null)
    timers.current = [
      window.setTimeout(() => { setOmega(0); setBoost(side) }, 380), // 기울어진 채 멈춤 → 각속도 0
      window.setTimeout(() => { setTilt(0); setOmega(-dir * 70) }, 840), // 보정하며 되돌아오는 중
      window.setTimeout(() => { setOmega(0); setBoost(null) }, 1260),
    ]
  }

  const ow = Math.min(100, Math.abs(omega) * 0.8)
  const bx = boost === 'L' ? 112 : 208
  const Rotor = ({ cx }: { cx: number }) => (
    <g>
      <line x1={cx} y1={72} x2={cx} y2={56} stroke="currentColor" strokeWidth={4} strokeLinecap="round" />
      <ellipse cx={cx} cy={54} rx={26} ry={6} className="vz-brand" stroke="currentColor" strokeWidth={3} />
    </g>
  )

  return (
    <Frame
      h={178}
      foot={
        <>
          <Chip onClick={() => push(-1)}>왼쪽으로 밀기</Chip>
          <Chip onClick={() => push(1)}>오른쪽으로 밀기</Chip>
        </>
      }
    >
      <line x1={24} y1={72} x2={296} y2={72} className="vz-dash" strokeWidth={2.5} />
      <Lab x={24} y={64} size={11} anchor="start">수평 기준</Lab>

      {/* 기체 — vz-needle 은 transform 전이만 걸어 주는 클래스라 여기 그대로 쓴다 */}
      <g className="vz-needle" style={{ transform: `rotate(${tilt}deg)`, transformOrigin: '160px 72px' }}>
        <Limb x1={112} y1={72} x2={208} y2={72} w={13} />
        <Rotor cx={112} />
        <Rotor cx={208} />
        <rect x={142} y={58} width={36} height={28} rx={8} className="vz-card" stroke="currentColor" strokeWidth={3} />
        <rect x={150} y={64} width={20} height={14} rx={3} className="vz-brand" stroke="currentColor" strokeWidth={2} />
        {boost && (
          <g className="vz-spark" fill="none" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <path d={`M${bx - 13} 40 l13 -9 l13 9`} />
            <path d={`M${bx - 13} 30 l13 -9 l13 9`} />
          </g>
        )}
      </g>

      {/* 각속도 — 가운데가 0, 좌우로 튄다 */}
      <Lab x={52} y={112} size={11} anchor="start">각속도</Lab>
      <Lab x={300} y={112} size={11} tone="hot" anchor="end">{omega > 0 ? '+' : ''}{omega}°/s</Lab>
      <rect x={52} y={118} width={216} height={16} rx={8} className="vz-mute" stroke="currentColor" strokeWidth={3} />
      {ow > 1 && (
        <rect x={omega >= 0 ? 160 : 160 - ow} y={120} width={ow} height={12} rx={6} className="vz-teal" />
      )}
      <line x1={160} y1={113} x2={160} y2={139} stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
      {boost && <Arrow x1={bx} y1={114} x2={bx} y2={92} tone="flow" head={7} />}

      <Lab x={160} y={166} size={12}>기울면 각속도가 튀고, 내려간 쪽을 더 민다</Lab>
    </Frame>
  )
}

// ── 조도 센서 ───────────────────────────────────────────────────────────────
// 켜지는 순간이 전부다. 시각을 밀어 밝기 곡선이 기준선 아래로 내려가는 그 지점을 직접 지나가 보게 한다.
function B6Light() {
  const [mins, setMins] = useState(17 * 60)
  const t = mins / 60
  const bright = (h: number) => (h <= 5 || h >= 19 ? 0 : Math.sin(((h - 5) / 14) * Math.PI))
  const xOf = (h: number) => 30 + (h / 24) * 200
  const yOf = (b: number) => 118 - b * 80
  const TH = 0.18
  const on = bright(t) < TH
  const nowX = xOf(t)
  const hh = String(Math.floor(mins / 60)).padStart(2, '0')
  const mm = String(mins % 60).padStart(2, '0')

  const pts: string[] = []
  for (let h = 0; h <= 24.001; h += 0.25) pts.push(`${xOf(h).toFixed(1)} ${yOf(bright(h)).toFixed(1)}`)

  return (
    <Frame
      h={182}
      foot={
        <>
          <input
            className="dy-viz-range"
            type="range"
            min={0}
            max={1430}
            step={10}
            value={mins}
            onChange={(e) => setMins(Number(e.target.value))}
            aria-label="시각"
          />
          <span className={`dy-viz-state${on ? '' : ' drop'}`}>{on ? '켜짐' : '꺼짐'}</span>
        </>
      }
    >
      {/* 하루치 밝기 */}
      <path d={`M${pts.join(' L')}`} fill="none" className="vz-turn" strokeWidth={3.5} strokeLinejoin="round" />
      {/* 기준선 — 이 선을 언제 넘느냐가 곧 점등 시각이다 */}
      <line x1={30} y1={yOf(TH)} x2={230} y2={yOf(TH)} className="vz-goal" strokeWidth={2.5} />
      <Lab x={32} y={99} tone="bad" size={11} anchor="start">기준선</Lab>

      <line x1={nowX} y1={28} x2={nowX} y2={126} className="vz-dash" strokeWidth={2.5} />
      <circle cx={nowX} cy={yOf(bright(t))} r={6} className={on ? 'vz-node' : 'vz-gold-f'} stroke="currentColor" strokeWidth={3} />
      <Lab x={Math.min(214, Math.max(46, nowX))} y={22} tone="hot" size={12}>{hh}:{mm}</Lab>

      <line x1={30} y1={122} x2={230} y2={122} stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
      <Lab x={30} y={136} size={11} anchor="start">0시</Lab>
      <Lab x={130} y={136} size={11}>12시</Lab>
      <Lab x={230} y={136} size={11} anchor="end">24시</Lab>

      {/* 가로등 — 기준선을 넘는 순간 같이 바뀐다 */}
      <g stroke="currentColor" strokeLinecap="round">
        <line x1={280} y1={126} x2={280} y2={46} strokeWidth={5} />
        <line x1={280} y1={48} x2={262} y2={48} strokeWidth={5} />
        <line x1={262} y1={126} x2={298} y2={126} strokeWidth={3} />
      </g>
      <path d="M250 48 L274 48 L268 64 L256 64 Z" className={on ? 'vz-gold-f' : 'vz-mute'} stroke="currentColor" strokeWidth={3} strokeLinejoin="round" />
      {on && (
        <g className="vz-spark" strokeWidth={3} strokeLinecap="round">
          <line x1={256} y1={70} x2={252} y2={82} />
          <line x1={262} y1={70} x2={262} y2={84} />
          <line x1={268} y1={70} x2={272} y2={82} />
        </g>
      )}
      <Lab x={272} y={142} size={11}>가로등</Lab>

      <Lab x={160} y={168} size={12}>밝기가 기준선 아래로 내려가면 켜진다</Lab>
    </Frame>
  )
}

// ── 펄스 폭 변조 ────────────────────────────────────────────────────────────
// 사각파가 주인공이다. 켜짐 폭만 넓히면 **전압 높이는 그대로인데** 모터 속도·LED 밝기가 따라 올라간다.
function B6Pwm() {
  const [duty, setDuty] = useState(50)
  const X0 = 36
  const P = 40
  const N = 5
  const TOP = 48
  const BOT = 100
  const onW = (P * duty) / 100
  const full = onW >= P - 0.5

  let d = `M${X0} ${BOT}`
  for (let k = 0; k < N; k++) {
    const x = X0 + k * P
    if (onW > 0.5) {
      d += ` L${x} ${TOP} L${(x + onW).toFixed(1)} ${TOP}`
      if (!full) d += ` L${(x + onW).toFixed(1)} ${BOT} L${x + P} ${BOT}`
    } else {
      d += ` L${x + P} ${BOT}`
    }
  }
  if (full) d += ` L${X0 + N * P} ${BOT}`

  const rayLen = 3 + duty * 0.11
  return (
    <Frame
      h={196}
      foot={
        <>
          <input
            className="dy-viz-range"
            type="range"
            min={0}
            max={100}
            step={5}
            value={duty}
            onChange={(e) => setDuty(Number(e.target.value))}
            aria-label="켜짐 비율"
          />
          <span className="dy-viz-state">{duty}%</span>
        </>
      }
    >
      {/* 켜져 있는 동안만 색이 찬다 */}
      {onW > 0.5 &&
        Array.from({ length: N }, (_, k) => (
          <rect key={k} x={X0 + k * P} y={TOP} width={onW} height={BOT - TOP} className="vz-brand" />
        ))}
      <line x1={30} y1={TOP} x2={250} y2={TOP} className="vz-dash" strokeWidth={2} />
      <path d={d} fill="none" stroke="currentColor" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
      <Lab x={28} y={TOP + 4} size={11} anchor="end">5V</Lab>
      <Lab x={28} y={BOT + 4} size={11} anchor="end">0V</Lab>

      {onW > 1 && (
        <g stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
          <line x1={X0} y1={36} x2={X0 + onW} y2={36} />
          <line x1={X0} y1={32} x2={X0} y2={40} />
          <line x1={X0 + onW} y1={32} x2={X0 + onW} y2={40} />
        </g>
      )}
      <Lab x={X0 + onW / 2} y={28} tone="hot" size={11}>켜짐 {duty}%</Lab>

      {/* 같은 5V 인데 결과만 달라진다 */}
      <circle cx={278} cy={96} r={14} className={duty > 4 ? 'vz-gold-f' : 'vz-mute'} stroke="currentColor" strokeWidth={3} />
      {duty > 4 && (
        <g className="vz-spark" strokeWidth={3} strokeLinecap="round">
          {Array.from({ length: 8 }, (_, k) => {
            const a = (k * Math.PI) / 4
            return (
              <line
                key={k}
                x1={278 + 18 * Math.cos(a)}
                y1={96 + 18 * Math.sin(a)}
                x2={278 + (18 + rayLen) * Math.cos(a)}
                y2={96 + (18 + rayLen) * Math.sin(a)}
              />
            )
          })}
        </g>
      )}
      <Lab x={278} y={140} size={11}>LED</Lab>

      <Lab x={36} y={142} size={11} anchor="start">모터 속도</Lab>
      <Lab x={236} y={142} size={11} tone="hot" anchor="end">{duty}%</Lab>
      <rect x={36} y={148} width={200} height={14} rx={7} className="vz-mute" stroke="currentColor" strokeWidth={2.5} />
      <rect x={36} y={148} width={Math.max(8, duty * 2)} height={14} rx={7} className="vz-teal" />

      <Lab x={160} y={186} size={12}>전압은 그대로, 켜져 있는 시간만 바꾼다</Lab>
    </Frame>
  )
}

// ── 모터 드라이버 ───────────────────────────────────────────────────────────
// 가는 신호선과 굵은 전원선이 상자에서 만나 모터로 나간다. 바로 연결하면 왜 안 도는지를 옆에 두는 게 요점.
function B6Driver() {
  const [via, setVia] = useState(true)
  return (
    <Frame
      h={190}
      foot={
        <>
          <Chip on={via} onClick={() => setVia(true)}>드라이버 거쳐서</Chip>
          <Chip on={!via} onClick={() => setVia(false)}>바로 연결</Chip>
        </>
      }
    >
      <Box x={14} y={76} w={58} h={42} r={10} tone="card" />
      <Lab x={43} y={102} size={12}>제어 칩</Lab>

      <Box x={122} y={16} w={68} h={28} r={7} tone="gold" />
      <Lab x={156} y={35} size={12}>전원</Lab>

      {via ? (
        <>
          {/* 힘은 여기서 온다 — 굵기가 곧 전류다 */}
          <Limb x1={156} y1={44} x2={156} y2={70} w={12} />
          <Box x={116} y={70} w={80} h={50} r={12} tone="brand" />
          <Lab x={156} y={100} tone="inv" size={12}>모터 드라이버</Lab>
          <Arrow x1={74} y1={96} x2={112} y2={96} tone="flow" w={2} head={6} />
          <Lab x={93} y={64} size={11}>약한 신호</Lab>
          <Limb x1={196} y1={96} x2={236} y2={96} w={14} />
          <Lab x={218} y={80} tone="hot" size={11} anchor="start">큰 전류</Lab>
        </>
      ) : (
        <>
          <line x1={156} y1={44} x2={156} y2={74} className="vz-dash" strokeWidth={3} />
          <Lab x={164} y={64} size={11} anchor="start">안 쓰임</Lab>
          <Arrow x1={74} y1={96} x2={232} y2={96} tone="flow" w={2} head={6} />
          <path d="M152 88 l16 16 M168 88 l-16 16" fill="none" className="vz-crack" strokeWidth={4} strokeLinecap="round" />
        </>
      )}

      {/* 모터 — 돌 때만 날개가 돈다 */}
      <circle cx={262} cy={96} r={26} className="vz-mute" stroke="currentColor" strokeWidth={3} />
      <g className={via ? 'vz-orbit' : undefined} style={{ transformOrigin: '262px 96px' }}>
        {Array.from({ length: 3 }, (_, k) => {
          const a = (k * 2 * Math.PI) / 3
          return (
            <line
              key={k}
              x1={262}
              y1={96}
              x2={262 + 18 * Math.cos(a)}
              y2={96 + 18 * Math.sin(a)}
              stroke="currentColor"
              strokeWidth={4}
              strokeLinecap="round"
            />
          )
        })}
      </g>
      <circle cx={262} cy={96} r={5} className="vz-card" stroke="currentColor" strokeWidth={3} />
      <Lab x={262} y={142} size={11}>모터</Lab>

      <Lab x={160} y={172} size={12} tone={via ? 'mute' : 'bad'}>
        {via ? '신호는 명령만, 힘은 전원에서 온다' : '약한 신호만으로는 모터가 안 돈다'}
      </Lab>
    </Frame>
  )
}

// ── 아날로그 신호 ───────────────────────────────────────────────────────────
// 이어진 곡선 위에 '잘라 담은' 계단을 겹쳐 둔다. 표본을 늘리면 계단이 곡선에 다가가지만,
// **완전히 같아지지는 않는다** — 그 남는 빨간 막대가 아날로그와 디지털의 거리다.
function B6Analog() {
  const [n, setN] = useState(9)
  const X0 = 24
  const X1 = 296
  const BASE = 140
  const w = (X1 - X0) / n
  const yAt = (x: number) => {
    const u = (x - X0) / (X1 - X0)
    const v = 0.5 + 0.3 * Math.sin(2 * Math.PI * u * 1.15) + 0.14 * Math.sin(2 * Math.PI * u * 2.6)
    return BASE - 8 - v * 88
  }

  const pts: string[] = []
  for (let x = X0; x <= X1; x += 4) pts.push(`${x} ${yAt(x).toFixed(1)}`)
  pts.push(`${X1} ${yAt(X1).toFixed(1)}`)

  const steps = Array.from({ length: n }, (_, k) => {
    const xs = X0 + k * w
    return { xs, xe: Math.min(X1, xs + w), y: yAt(xs) }
  })
  let sd = ''
  steps.forEach((s, k) => {
    sd += (k === 0 ? `M${s.xs.toFixed(1)} ${s.y.toFixed(1)}` : ` L${s.xs.toFixed(1)} ${s.y.toFixed(1)}`)
    sd += ` L${s.xe.toFixed(1)} ${s.y.toFixed(1)}`
  })

  // 제일 크게 벌어진 자리를 찾아 거기에만 오차 막대를 세운다(그 값이 곧 '버려진 값'이다)
  let ex = 0
  let eStair = 0
  let eCurve = 0
  let eGap = 0
  for (let x = X0; x <= X1; x += 2) {
    const k = Math.min(n - 1, Math.floor((x - X0) / w))
    const ys = yAt(X0 + k * w)
    const yc = yAt(x)
    if (Math.abs(ys - yc) > eGap) {
      eGap = Math.abs(ys - yc)
      ex = x
      eStair = ys
      eCurve = yc
    }
  }

  return (
    <Frame
      h={182}
      foot={
        <>
          <input
            className="dy-viz-range"
            type="range"
            min={4}
            max={34}
            step={1}
            value={n}
            onChange={(e) => setN(Number(e.target.value))}
            aria-label="표본 수"
          />
          <span className="dy-viz-state">{n}칸</span>
        </>
      }
    >
      {steps.map((s, k) => (
        <rect key={k} x={s.xs} y={s.y} width={s.xe - s.xs} height={BASE - s.y} className="vz-brand" />
      ))}
      <path d={sd} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinejoin="round" />
      <path d={`M${pts.join(' L')}`} fill="none" className="vz-arrow" strokeWidth={3.5} strokeLinejoin="round" />
      {n <= 20 && steps.map((s, k) => <circle key={k} cx={s.xs} cy={s.y} r={3.5} className="vz-gold-f" />)}

      {eGap > 4 && (
        <>
          <line x1={ex} y1={eStair} x2={ex} y2={eCurve} className="vz-goal" strokeWidth={3} strokeLinecap="round" />
          <Lab
            x={ex > 236 ? ex - 8 : ex + 8}
            y={(eStair + eCurve) / 2 + 4}
            tone="bad"
            size={11}
            anchor={ex > 236 ? 'end' : 'start'}
          >
            버린 값
          </Lab>
        </>
      )}

      <line x1={X0} y1={BASE} x2={X1} y2={BASE} stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
      <Lab x={X0} y={24} tone="ok" size={11} anchor="start">이어진 값 = 아날로그</Lab>
      <Lab x={X1} y={24} tone="hot" size={11} anchor="end">잘라 담은 값 = 디지털</Lab>
      <Lab x={160} y={168} size={12}>칸을 좁힐수록 가까워질 뿐, 같아지진 않는다</Lab>
    </Frame>
  )
}

export const VISUALS_B6: Record<string, () => ReactNode> = {
  b6_ultrasonic: B6Ultrasonic,
  b6_gyro: B6Gyro,
  b6_light: B6Light,
  b6_pwm: B6Pwm,
  b6_driver: B6Driver,
  b6_analog: B6Analog,
}
