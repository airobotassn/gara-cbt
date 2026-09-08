// DAILY QUIZ 해설 그림 — 배치 10 「임베디드와 실시간」.
//
// 8장 전부 다른 형태로 그렸다(타임라인 반복 금지 지시): 인터럽트=끊기는 작업줄, 워치독=줄어드는 안전 게이지,
// DMA=CPU 를 비켜 가는 경로, 메모리 정렬=바이트 격자 + 읽기창, 포인터=번지 사물함 + 비용 막대,
// PID=세 항을 겹쳐 그린 응답곡선, 이동 평균=슬라이딩 창 + 평균점, 칼만 필터=예측·측정·추정 세 선.
//
// ⛔ 색을 직접 쓰지 말 것 — 선은 stroke="currentColor" 또는 kit 의 stroke 클래스, 면은 daily.css 의 .vz-* 만.
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Frame, Box, Arrow, Lab, Chip } from './kit'

// ── 인터럽트 ────────────────────────────────────────────────────────────────
// 신호를 보내면 흐르던 작업줄이 잘리고 빨간 처리 구간이 끼어든 뒤 원래 색으로 돌아온다.
// 아래 폴링 줄은 그 순간에도 계속 "왔니?" 를 묻고 있었다는 걸 틱으로 보여 준다.
function B10Interrupt() {
  const [fired, setFired] = useState(false)
  const timer = useRef(0)
  const fire = () => {
    setFired(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setFired(false), 1100)
  }
  const TICKS = 10
  const barX = 20
  const barW = 280
  const cutX = 150
  const cutW = 44
  const foundIdx = 5

  return (
    <Frame h={182} foot={<Chip on={fired} onClick={fire}>신호 보내기</Chip>}>
      <Lab x={20} y={16} tone="hot" size={12} anchor="start">인터럽트 방식</Lab>
      {fired && <Arrow x1={cutX} y1={16} x2={cutX} y2={30} tone="bad" head={6} />}
      {fired && <Lab x={cutX + 6} y={22} tone="bad" size={10} anchor="start">신호</Lab>}
      {fired ? (
        <>
          <rect x={barX} y={30} width={cutX - barX} height={26} rx={6} className="vz-brand" />
          <rect x={cutX} y={30} width={cutW} height={26} className="vz-target-c" />
          <rect x={cutX + cutW} y={30} width={barX + barW - cutX - cutW} height={26} rx={6} className="vz-brand" />
        </>
      ) : (
        <rect x={barX} y={30} width={barW} height={26} rx={6} className="vz-brand" />
      )}
      <Lab x={160} y={74} tone={fired ? 'bad' : 'mute'} size={12}>
        {fired ? 'ISR 먼저 처리하고 하던 일로 복귀' : '평소엔 하던 일이 계속 흐른다'}
      </Lab>

      <Lab x={20} y={98} size={12} anchor="start">폴링 방식</Lab>
      <rect x={barX} y={106} width={barW} height={22} rx={6} className="vz-mute" stroke="currentColor" strokeWidth={2.5} />
      {Array.from({ length: TICKS }, (_, k) => {
        const x = barX + (k + 0.5) * (barW / TICKS)
        const on = fired && k === foundIdx
        return (
          <line
            key={k}
            x1={x}
            y1={106}
            x2={x}
            y2={128}
            className={on ? 'vz-arrow' : 'vz-web'}
            strokeWidth={on ? 3 : 1.6}
          />
        )
      })}
      <Lab x={20} y={146} size={11} anchor="start">계속 물어봐야 안다</Lab>
      {fired && <Lab x={300} y={146} tone="ok" size={11} anchor="end">찾음!</Lab>}
      <Lab x={160} y={170} size={11}>필요할 때만 부른다 · 매번 스스로 물어야 한다</Lab>
    </Frame>
  )
}

// ── 워치독 타이머 ───────────────────────────────────────────────────────────
// 잔여 안전 시간 게이지가 "시간 흐르기" 를 누를 때마다 줄어든다. "먹이 주기" 로만 다시 채울 수 있고,
// 바닥나면 그 순간 리셋 신호가 나가 MCU 가 재부팅한다 — 무한 루프에 빠져 먹이를 못 주면 벌어지는 일.
function B10Watchdog() {
  const [level, setLevel] = useState(100)
  const [resets, setResets] = useState(0)
  const [flash, setFlash] = useState(false)
  const timer = useRef(0)

  const wait = () => {
    setLevel((l) => {
      const nl = l - 26
      if (nl <= 0) {
        setResets((r) => r + 1)
        setFlash(true)
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => {
          setFlash(false)
          setLevel(100)
        }, 750)
        return 0
      }
      return nl
    })
  }
  const feed = () => setLevel(100)

  const capTop = 22
  const capBot = 128
  const capH = capBot - capTop
  const fillH = (level / 100) * capH
  const fillY = capBot - fillH
  const danger = level <= 26 || flash

  return (
    <Frame
      h={176}
      foot={
        <>
          <Chip onClick={wait}>시간 흐르기</Chip>
          <Chip onClick={feed}>먹이 주기</Chip>
        </>
      }
    >
      <Lab x={64} y={14} size={11}>잔여 안전 시간</Lab>
      <rect x={40} y={capTop} width={48} height={capH} rx={20} className="vz-mute" stroke="currentColor" strokeWidth={3} />
      {fillH > 1 && (
        <rect x={44} y={fillY} width={40} height={fillH - 2} rx={14} className={danger ? 'vz-target-c' : 'vz-teal'} />
      )}
      <Lab x={64} y={148} tone={danger ? 'bad' : 'hot'} size={12}>{level}%</Lab>

      <Box x={150} y={48} w={80} h={56} r={10} tone="card" />
      <Lab x={190} y={72} tone={flash ? 'bad' : 'mute'} size={11}>{flash ? '재부팅!' : 'MCU'}</Lab>
      <Lab x={190} y={90} tone={flash ? 'bad' : 'ok'} size={10}>{flash ? '초기화됨' : '정상 동작'}</Lab>

      <Arrow x1={92} y1={70} x2={148} y2={70} tone={flash ? 'bad' : 'dash'} head={6} />
      {flash && <Lab x={120} y={60} tone="bad" size={10}>리셋!</Lab>}

      <Lab x={296} y={166} tone="bad" size={11} anchor="end">재부팅 {resets}회</Lab>
      <Lab x={20} y={166} size={11} anchor="start" tone={danger ? 'bad' : 'mute'}>
        {danger ? '끊기면 강제로 재부팅한다' : '계속 먹이를 줘야 안전하다'}
      </Lab>
    </Frame>
  )
}

// ── DMA(직접 메모리 접근) ──────────────────────────────────────────────────
// CPU 를 거치면 그 시간만큼 CPU 가 바쁘고, DMA 로 직접 보내면 CPU 는 그동안 다른 일을 한다.
function B10Dma() {
  const [dma, setDma] = useState(false)
  const cpuBusy = !dma

  return (
    <Frame
      h={188}
      foot={
        <>
          <Chip on={!dma} onClick={() => setDma(false)}>CPU 경유</Chip>
          <Chip on={dma} onClick={() => setDma(true)}>DMA 직접</Chip>
        </>
      }
    >
      <Box x={20} y={68} w={56} h={40} r={8} tone="card" />
      <Lab x={48} y={92} size={11}>센서</Lab>

      <rect
        x={132}
        y={54}
        width={64}
        height={68}
        rx={10}
        className={cpuBusy ? 'vz-target-c' : 'vz-teal'}
        stroke="currentColor"
        strokeWidth={3}
      />
      <Lab x={164} y={82} tone="inv" size={12}>CPU</Lab>
      <Lab x={164} y={100} tone="inv" size={10}>{cpuBusy ? '바쁨' : '여유'}</Lab>

      <Box x={244} y={68} w={56} h={40} r={8} tone="card" />
      <Lab x={272} y={92} size={11}>메모리</Lab>

      {!dma && (
        <>
          <Arrow x1={76} y1={88} x2={130} y2={88} tone="flow" />
          <Arrow x1={198} y1={88} x2={242} y2={88} tone="flow" />
        </>
      )}

      {dma && (
        <>
          <line x1={48} y1={68} x2={48} y2={34} className="vz-dash" strokeWidth={2} />
          <line x1={272} y1={68} x2={272} y2={34} className="vz-dash" strokeWidth={2} />
          <Arrow x1={48} y1={34} x2={272} y2={34} tone="flow" />
          <Lab x={160} y={24} tone="ok" size={11}>직접 전송</Lab>
        </>
      )}

      <Lab x={164} y={134} size={11} tone={cpuBusy ? 'bad' : 'ok'}>
        {cpuBusy ? '데이터 옮기는 중' : '모터 제어 계산 중'}
      </Lab>

      <Lab x={160} y={172} size={12} tone={cpuBusy ? 'bad' : 'ok'}>
        {cpuBusy ? 'CPU 가 옮기는 동안 다른 일을 못 한다' : 'CPU 는 손 안 대고 다른 일을 한다'}
      </Lab>
    </Frame>
  )
}

// ── 메모리 정렬 ─────────────────────────────────────────────────────────────
// 8칸짜리 바이트 격자. 정렬 없이 붙이면 정수가 4바이트 경계를 걸쳐 두 번 읽어야 하고,
// 패딩을 끼우면 한 번에 읽히는 대신 크기가 5가 아니라 8이 된다.
function B10Align() {
  const [padded, setPadded] = useState(false)
  const X0 = 24
  const CW = 34
  const ROWS_Y = 52
  const ROW_H = 36
  const cellX = (i: number) => X0 + i * CW

  return (
    <Frame
      h={182}
      foot={
        <>
          <Chip on={!padded} onClick={() => setPadded(false)}>정렬 없음</Chip>
          <Chip on={padded} onClick={() => setPadded(true)}>{'정렬(패딩)'}</Chip>
        </>
      }
    >
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x={cellX(i)} y={ROWS_Y} width={CW} height={ROW_H} fill="none" stroke="currentColor" strokeWidth={1.2} />
      ))}
      <line x1={cellX(4)} y1={ROWS_Y - 6} x2={cellX(4)} y2={ROWS_Y + ROW_H + 6} className="vz-dash" strokeWidth={2.5} />
      <Lab x={cellX(2)} y={ROWS_Y - 10} size={10}>워드 0</Lab>
      <Lab x={cellX(6)} y={ROWS_Y - 10} size={10}>워드 1</Lab>

      <Box x={cellX(0)} y={ROWS_Y} w={CW} h={ROW_H} r={0} tone="brand" />
      <Lab x={cellX(0) + CW / 2} y={ROWS_Y + 23} tone="inv" size={12}>C</Lab>

      {!padded ? (
        <>
          <Box x={cellX(1)} y={ROWS_Y} w={CW * 4} h={ROW_H} r={0} tone="teal" />
          <Lab x={cellX(1) + CW * 2} y={ROWS_Y + 23} tone="inv" size={11}>정수 4B</Lab>
          <rect x={X0 - 2} y={ROWS_Y - 4} width={CW * 4 + 4} height={ROW_H + 8} fill="none" className="vz-goal" strokeWidth={2.5} strokeDasharray="5 4" />
          <rect x={cellX(4) - 2} y={ROWS_Y - 4} width={CW * 4 + 4} height={ROW_H + 8} fill="none" className="vz-goal" strokeWidth={2.5} strokeDasharray="5 4" />
          <Lab x={cellX(2)} y={108} tone="bad" size={10}>읽기1</Lab>
          <Lab x={cellX(6)} y={108} tone="bad" size={10}>읽기2</Lab>
          <Lab x={160} y={144} tone="bad" size={12}>정수가 경계에 걸쳐 두 번 읽는다</Lab>
          <Lab x={160} y={162} size={11}>실제 5바이트인데 두 번 읽는다</Lab>
        </>
      ) : (
        <>
          {Array.from({ length: 3 }, (_, k) => (
            <rect
              key={k}
              x={cellX(1 + k)}
              y={ROWS_Y}
              width={CW}
              height={ROW_H}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.2}
              strokeDasharray="3 3"
            />
          ))}
          <Lab x={cellX(2) + CW / 2} y={ROWS_Y + 23} size={9}>패딩</Lab>
          <Box x={cellX(4)} y={ROWS_Y} w={CW * 4} h={ROW_H} r={0} tone="teal" />
          <Lab x={cellX(4) + CW * 2} y={ROWS_Y + 23} tone="inv" size={11}>정수 4B</Lab>
          <rect x={cellX(4) - 2} y={ROWS_Y - 4} width={CW * 4 + 4} height={ROW_H + 8} fill="none" className="vz-arrow" strokeWidth={2.5} strokeDasharray="5 4" />
          <Lab x={cellX(6)} y={108} tone="ok" size={10}>읽기1번</Lab>
          <Lab x={160} y={144} tone="ok" size={12}>패딩 덕분에 한 번에 읽힌다</Lab>
          <Lab x={160} y={162} size={11} tone="hot">총 8바이트, 5가 아니라 8이다</Lab>
        </>
      )}
    </Frame>
  )
}

// ── 포인터 ──────────────────────────────────────────────────────────────────
// 사물함 줄 하나엔 값 100, 다른 하나(포인터)엔 그 사물함의 번지가 적혀 화살표가 건너간다.
// 아래 막대는 이미지를 통째로 복사하는 비용과 번지 하나만 넘기는 비용을 대비한다.
function B10Pointer() {
  const ADDR = ['0x10', '0x14', '0x18', '0x1C', '0x20', '0x24']
  const X0 = 20
  const CW = 46
  const cellX = (i: number) => X0 + i * CW
  const valIdx = 2
  const ptrIdx = 4
  const vx = cellX(valIdx) + CW / 2
  const px = cellX(ptrIdx) + CW / 2

  return (
    <Frame h={188}>
      {ADDR.map((a, i) => (
        <g key={a}>
          <Lab x={cellX(i) + CW / 2} y={26} size={9}>{a}</Lab>
          <Box x={cellX(i)} y={34} w={CW} h={34} r={6} tone={i === valIdx ? 'brand' : i === ptrIdx ? 'teal' : 'mute'} />
        </g>
      ))}
      <Lab x={vx} y={56} tone="inv" size={12}>100</Lab>
      <Lab x={px} y={56} tone="inv" size={11}>0x18</Lab>
      <Lab x={vx} y={84} size={10}>값</Lab>
      <Lab x={px} y={84} tone="hot" size={10}>포인터 p</Lab>

      <path d={`M${px} 34 L${px} 16 L${vx} 16 L${vx} 34`} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      <path d={`M${vx - 5} 24 L${vx} 34 L${vx + 5} 24`} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      <Lab x={(px + vx) / 2} y={12} tone="ok" size={10}>가리킨다</Lab>

      <Lab x={160} y={104} size={12}>값이 아니라 값이 있는 번지를 담는다</Lab>

      <Lab x={20} y={120} size={10} anchor="start" tone="bad">값 복사 (12MP 사진)</Lab>
      <rect x={20} y={126} width={260} height={16} rx={6} className="vz-target-c" />
      <Lab x={276} y={138} tone="inv" size={10} anchor="end">~36MB</Lab>

      <Lab x={20} y={152} size={10} anchor="start" tone="ok">포인터 전달 (번지만)</Lab>
      <rect x={20} y={158} width={10} height={16} rx={4} className="vz-teal" />
      <Lab x={36} y={170} size={10} anchor="start" tone="hot">8바이트</Lab>

      <Lab x={160} y={182} size={11}>복사 없이 번지만 건너간다</Lab>
    </Frame>
  )
}

// ── PID 제어 ────────────────────────────────────────────────────────────────
// 같은 목표에 대한 세 응답 곡선을 겹쳐 그리고, 고른 것만 굵게 살린다.
// P만 켜면 목표 근처에서 멈추고, I 를 더하면 딱 붙지만 출렁이고, D 까지 더하면 출렁임 없이 붙는다.
function pidResponse(mode: 0 | 1 | 2, t: number): number {
  if (mode === 0) return 0.78 * (1 - Math.exp(-t / 2.4))
  const zeta = mode === 1 ? 0.45 : 0.9
  const wn = mode === 1 ? 1.1 : 1.3
  const wd = wn * Math.sqrt(1 - zeta * zeta)
  return 1 - Math.exp(-zeta * wn * t) * (Math.cos(wd * t) + ((zeta * wn) / wd) * Math.sin(wd * t))
}

const PID_MODES = ['P', 'PI', 'PID'] as const
const PID_CAPTIONS = [
  { t: '비례항만 — 목표 근처에서 멈춘다', tone: 'bad' as const },
  { t: '적분항 추가 — 오차는 없지만 출렁인다', tone: 'hot' as const },
  { t: '미분항까지 — 출렁임 없이 딱 붙는다', tone: 'ok' as const },
]

function B10Pid() {
  const [sel, setSel] = useState<0 | 1 | 2>(2)
  const X0 = 34
  const X1 = 296
  const YB = 130
  const YT = 42
  const xOf = (t: number) => X0 + (t / 10) * (X1 - X0)
  const yOf = (v: number) => YB - v * (YB - YT)
  const pathOf = (mode: 0 | 1 | 2) => {
    let d = ''
    for (let t = 0; t <= 10.001; t += 0.25) {
      const v = pidResponse(mode, t)
      d += `${t === 0 ? 'M' : ' L'}${xOf(t).toFixed(1)} ${yOf(v).toFixed(1)}`
    }
    return d
  }
  const caption = PID_CAPTIONS[sel]

  return (
    <Frame
      h={178}
      foot={PID_MODES.map((m, i) => (
        <Chip key={m} on={i === sel} onClick={() => setSel(i as 0 | 1 | 2)}>{m}</Chip>
      ))}
    >
      <line x1={X0 - 4} y1={YT} x2={X1 + 4} y2={YT} className="vz-goal" strokeWidth={2} strokeDasharray="6 5" />
      <Lab x={X1 + 4} y={YT - 6} tone="bad" size={10} anchor="end">목표</Lab>
      <line x1={X0} y1={YB} x2={X1} y2={YB} stroke="currentColor" strokeWidth={2} strokeLinecap="round" />

      {([0, 1, 2] as const).map((m) =>
        m === sel ? null : <path key={m} d={pathOf(m)} fill="none" className="vz-web" strokeWidth={1.4} />,
      )}
      <path d={pathOf(sel)} fill="none" className="vz-arrow" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />

      <Lab x={160} y={158} tone={caption.tone} size={12}>{caption.t}</Lab>
      <Lab x={X1} y={146} size={10} anchor="end">시간 →</Lab>
    </Frame>
  )
}

// ── 이동 평균 필터 ──────────────────────────────────────────────────────────
// 잡음 낀 원본(회색 점선) 위에 창을 얹고, 그 창 안 값을 평균 내 매끈한 선(청록)을 그린다.
// 창 폭을 넓히면 더 매끈해지지만 강조된 창이 넓어지는 만큼 평균이 최근 값에서 멀어진다(지연).
const B10_NOISE: number[] = [
  4, -7, 5, -3, 8, -9, 2, 6, -5, 3, -8, 7, -2, 5, -6, 9, -4, 1, -7, 6, -3, 8, -5, 2, -9, 4, -1, 7, -6, 3, 0,
]

function B10MovAvg() {
  const [w, setW] = useState(3)
  const N = B10_NOISE.length
  const X0 = 22
  const X1 = 298
  const step = (X1 - X0) / (N - 1)
  const xOf = (i: number) => X0 + i * step
  const trend = (i: number) => Math.sin(i * 0.34) * 20
  const raw = (i: number) => trend(i) + B10_NOISE[i]
  const avg = (i: number) => {
    let s = 0
    let c = 0
    for (let j = Math.max(0, i - w + 1); j <= i; j++) {
      s += raw(j)
      c++
    }
    return s / c
  }
  const yOf = (v: number) => 78 - v

  let rawD = ''
  let avgD = ''
  for (let i = 0; i < N; i++) {
    rawD += `${i === 0 ? 'M' : ' L'}${xOf(i).toFixed(1)} ${yOf(raw(i)).toFixed(1)}`
    avgD += `${i === 0 ? 'M' : ' L'}${xOf(i).toFixed(1)} ${yOf(avg(i)).toFixed(1)}`
  }

  const hi = 22
  const lo = Math.max(0, hi - w + 1)
  const rx = xOf(lo) - step / 2
  const rw = xOf(hi) - xOf(lo) + step

  const note = w <= 3
    ? { t: '창이 좁으면 잡음이 남는다', tone: 'bad' as const }
    : w >= 7
      ? { t: '창이 넓으면 변화가 늦게 따라온다', tone: 'bad' as const }
      : { t: '창 폭이 잡음과 지연을 가른다', tone: 'mute' as const }

  return (
    <Frame
      h={158}
      foot={
        <>
          <input
            className="dy-viz-range"
            type="range"
            min={1}
            max={9}
            step={2}
            value={w}
            onChange={(e) => setW(Number(e.target.value))}
            aria-label="창 폭"
          />
          <span className="dy-viz-state">창 {w}개</span>
        </>
      }
    >
      <rect x={rx} y={26} width={rw} height={104} className="vz-colsel" />
      <path d={rawD} fill="none" className="vz-dash" strokeWidth={2} strokeLinejoin="round" />
      <path d={avgD} fill="none" className="vz-arrow" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={xOf(hi)} cy={yOf(avg(hi))} r={5} className="vz-node-on" stroke="currentColor" strokeWidth={2.5} />
      <Lab x={xOf(hi)} y={20} tone="hot" size={10}>이 창의 평균</Lab>
      <Lab x={160} y={148} tone={note.tone} size={12}>{note.t}</Lab>
    </Frame>
  )
}

// ── 칼만 필터 ───────────────────────────────────────────────────────────────
// 튀는 측정점과 매끈한 예측선을 슬라이더 가중치로 섞어 초록빛 추정선을 만든다.
// 측정 노이즈를 올리면(=측정을 못 믿으면) 추정선이 예측 쪽으로 붙는다 — 이동 평균과 달리 두 출처를 섞는다.
const B10_MNOISE: number[] = [
  12, -18, 9, -22, 15, -8, 20, -14, 6, -19, 11, -6, 17, -21, 8, -10, 19, -15, 5, -20, 13, -9, 22, -16, 7, -12, 18, -7, 14, -17, 10,
]

function kalmanGain(noiseTrust: number): number {
  const kp = 30
  const r = 10 + noiseTrust * 0.9
  return kp / (kp + r)
}

function B10Kalman() {
  const [noiseTrust, setNoiseTrust] = useState(50)
  const gain = kalmanGain(noiseTrust)
  const N = B10_MNOISE.length
  const X0 = 22
  const X1 = 298
  const step = (X1 - X0) / (N - 1)
  const xOf = (i: number) => X0 + i * step
  const trueVal = (i: number) => Math.sin(i * 0.28) * 24
  const predVal = (i: number) => Math.sin(Math.max(0, i - 2) * 0.28) * 24
  const measVal = (i: number) => trueVal(i) + B10_MNOISE[i]
  const estVal = (i: number) => gain * measVal(i) + (1 - gain) * predVal(i)
  const yOf = (v: number) => 76 - v

  let predD = ''
  let estD = ''
  for (let i = 0; i < N; i++) {
    predD += `${i === 0 ? 'M' : ' L'}${xOf(i).toFixed(1)} ${yOf(predVal(i)).toFixed(1)}`
    estD += `${i === 0 ? 'M' : ' L'}${xOf(i).toFixed(1)} ${yOf(estVal(i)).toFixed(1)}`
  }

  const note = gain > 0.55
    ? { t: '측정을 더 믿는다', tone: 'ok' as const }
    : gain < 0.35
      ? { t: '예측 쪽으로 붙는다', tone: 'hot' as const }
      : { t: '둘을 반반 섞는다', tone: 'mute' as const }

  return (
    <Frame
      h={168}
      foot={
        <>
          <input
            className="dy-viz-range"
            type="range"
            min={0}
            max={100}
            step={10}
            value={noiseTrust}
            onChange={(e) => setNoiseTrust(Number(e.target.value))}
            aria-label="측정 노이즈"
          />
          <span className="dy-viz-state">신뢰 {Math.round(gain * 100)}%</span>
        </>
      }
    >
      <line x1={20} y1={14} x2={34} y2={14} className="vz-turn" strokeWidth={3} strokeLinecap="round" />
      <Lab x={38} y={17} size={10} anchor="start">예측</Lab>
      <circle cx={112} cy={14} r={4} className="vz-node-on" />
      <Lab x={120} y={17} size={10} anchor="start">측정</Lab>
      <line x1={196} y1={14} x2={210} y2={14} className="vz-arrow" strokeWidth={3} strokeLinecap="round" />
      <Lab x={214} y={17} size={10} anchor="start">추정</Lab>

      <path d={predD} fill="none" className="vz-turn" strokeWidth={2.2} strokeDasharray="6 4" strokeLinejoin="round" />
      {Array.from({ length: N }, (_, i) => (
        <circle key={i} cx={xOf(i)} cy={yOf(measVal(i))} r={2.6} className="vz-node-on" />
      ))}
      <path d={estD} fill="none" className="vz-arrow" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />

      <Lab x={160} y={158} tone={note.tone} size={12}>{note.t}</Lab>
    </Frame>
  )
}

export const VISUALS_B10: Record<string, () => ReactNode> = {
  b10_interrupt: B10Interrupt,
  b10_watchdog: B10Watchdog,
  b10_dma: B10Dma,
  b10_align: B10Align,
  b10_pointer: B10Pointer,
  b10_pid: B10Pid,
  b10_movavg: B10MovAvg,
  b10_kalman: B10Kalman,
}
