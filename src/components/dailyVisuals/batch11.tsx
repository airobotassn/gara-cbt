// DAILY QUIZ 해설 그림 — 배치 11 「현장의 안전과 조율」.
//
// 이 여섯 장의 공통 주제: **사고를 막고 여럿을 조율하는 장치**.
// 그래서 전부 "무엇이 무엇을 막느냐 / 누가 누구를 기다리느냐" 가 그림 안에서 벌어지게 그렸다.
// ⛔ 색을 직접 쓰지 말 것 — 선은 stroke="currentColor", 면은 .vz-* 클래스(kit.tsx 머리 주석 참고).
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Frame, Box, Arrow, Lab, Chip } from './kit'

// ── 비상 정지 ───────────────────────────────────────────────────────────────
// ⭐ 이 그림의 전부는 "왜 소프트웨어를 안 거치는가" 다. 버튼 그림이 아니라 **두 갈래 길**을 그린다.
//    위 = PC 를 거치는 명령(먹통이 되면 끊긴다) · 아래 = 버튼에서 릴레이로 직행하는 배선(안 끊긴다).
//    칩으로 PC 를 죽여 보면 위쪽만 죽고 모터는 그대로 멈춘다 — 그게 이 장치의 존재 이유다.
function B11EStop() {
  const [dead, setDead] = useState(false)
  return (
    <Frame
      h={204}
      foot={
        <Chip on={dead} onClick={() => setDead(!dead)}>
          제어 PC 를 먹통으로
        </Chip>
      }
    >
      {/* 위 갈래 — 소프트웨어 경로 */}
      <Box x={16} y={22} w={86} h={34} tone={dead ? 'mute' : 'card'} />
      <Lab x={59} y={44} size={13} tone={dead ? 'bad' : 'hot'}>제어 PC</Lab>
      {dead && <Lab x={59} y={76} size={12} tone="bad">먹통</Lab>}

      <line x1={102} y1={39} x2={202} y2={39} className={dead ? 'vz-dash' : 'vz-arrow'} strokeWidth={3} fill="none" />
      <Arrow x1={202} y1={39} x2={202} y2={74} tone={dead ? 'dash' : 'flow'} />
      {dead && (
        <g className="vz-goal" strokeWidth={3} strokeLinecap="round">
          <line x1={142} y1={32} x2={152} y2={46} />
          <line x1={152} y1={32} x2={162} y2={46} />
        </g>
      )}
      <Lab x={144} y={60} size={11} tone={dead ? 'bad' : 'mute'}>{dead ? '명령이 안 간다' : '정지 명령'}</Lab>

      {/* 아래 갈래 — 손에서 전원까지, 중간에 아무것도 없다 */}
      <circle cx={59} cy={146} r={21} className="vz-target" strokeWidth={3} />
      <circle cx={59} cy={146} r={11} className="vz-target-c" />
      <Lab x={59} y={182} size={12} tone="bad">E-STOP</Lab>
      <line x1={80} y1={146} x2={202} y2={146} className="vz-goal" strokeWidth={5} strokeLinecap="round" />
      <Arrow x1={202} y1={146} x2={202} y2={124} tone="bad" w={5} head={10} />
      <Lab x={140} y={136} size={12} tone="bad">배선 직결</Lab>

      {/* 두 갈래가 만나는 자리 — 여기서 전원이 끊긴다 */}
      <Box x={160} y={78} w={84} h={42} tone="card" />
      <Lab x={202} y={104} size={12}>전원 릴레이</Lab>
      <Arrow x1={244} y1={99} x2={260} y2={99} tone="flow" />
      <Box x={260} y={78} w={50} h={42} tone="mute" />
      <Lab x={285} y={104} size={13}>모터</Lab>
      <Lab x={285} y={136} size={12} tone="ok">멈춤</Lab>

      <Lab x={160} y={198} size={12}>{dead ? 'PC 가 죽어도 이 선은 살아 있다' : '소프트웨어를 안 거치는 길이 하나 더 있다'}</Lab>
    </Frame>
  )
}

// ── 인터록 회로 ─────────────────────────────────────────────────────────────
// 사다리 두 줄. 한쪽 코일이 살면 **반대쪽 줄의 접점이 열려** 그 줄이 통째로 죽는다.
// 가운데 X 로 교차하는 붉은 화살표가 "서로가 서로를 끊는다" 를 말한다 — 동시에 눌러도 하나만 산다.
function B11Interlock() {
  const [sel, setSel] = useState<'none' | 'a' | 'b' | 'both'>('none')
  const pressA = sel === 'a' || sel === 'both'
  const pressB = sel === 'b' || sel === 'both'
  const onA = pressA // 먼저 잡은 쪽이 이긴다 — 동시에 눌러도 둘이 같이 켜지는 일은 없다
  const onB = pressB && !onA

  const Rung = ({ y, ly, pressed, on, closed, bl, cl, kl }: {
    y: number; ly: number; pressed: boolean; on: boolean; closed: boolean; bl: string; cl: string; kl: string
  }) => (
    <g>
      <line x1={20} y1={y} x2={49} y2={y} className="vz-arrow" strokeWidth={4} strokeLinecap="round" />
      <line x1={71} y1={y} x2={140} y2={y} className={pressed ? 'vz-arrow' : 'vz-dash'} strokeWidth={pressed ? 4 : 3} strokeLinecap="round" />
      <line x1={160} y1={y} x2={235} y2={y} className={on ? 'vz-arrow' : 'vz-dash'} strokeWidth={on ? 4 : 3} strokeLinecap="round" />
      <line x1={265} y1={y} x2={300} y2={y} className={on ? 'vz-arrow' : 'vz-dash'} strokeWidth={on ? 4 : 3} strokeLinecap="round" />
      {/* 누름 버튼 */}
      <circle cx={60} cy={y} r={11} className={pressed ? 'vz-gold-f' : 'vz-card'} stroke="currentColor" strokeWidth={3} />
      {/* 접점 — 반대쪽 코일이 살면 위로 들려 열린다 */}
      <line x1={140} y1={y - 10} x2={140} y2={y + 10} stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
      <line x1={160} y1={y - 10} x2={160} y2={y + 10} stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
      {closed ? (
        <line x1={140} y1={y} x2={160} y2={y} stroke="currentColor" strokeWidth={4} strokeLinecap="round" />
      ) : (
        <line x1={140} y1={y} x2={163} y2={y - 14} className="vz-goal" strokeWidth={4} strokeLinecap="round" />
      )}
      {/* 코일 */}
      <circle cx={250} cy={y} r={15} className={on ? 'vz-node-on' : 'vz-node'} stroke="currentColor" strokeWidth={3} />
      <Lab x={60} y={ly} size={11} tone={pressed ? 'hot' : 'mute'}>{bl}</Lab>
      <Lab x={150} y={ly} size={11} tone={closed ? 'mute' : 'bad'}>{cl}</Lab>
      <Lab x={250} y={ly} size={11} tone={on ? 'hot' : 'mute'}>{kl}</Lab>
    </g>
  )

  return (
    <Frame
      h={182}
      foot={
        <>
          <Chip on={sel === 'a'} onClick={() => setSel(sel === 'a' ? 'none' : 'a')}>정회전</Chip>
          <Chip on={sel === 'b'} onClick={() => setSel(sel === 'b' ? 'none' : 'b')}>역회전</Chip>
          <Chip on={sel === 'both'} onClick={() => setSel(sel === 'both' ? 'none' : 'both')}>동시에</Chip>
        </>
      }
    >
      {/* 전원 레일 */}
      <line x1={20} y1={44} x2={20} y2={130} stroke="currentColor" strokeWidth={4} strokeLinecap="round" />
      <line x1={300} y1={44} x2={300} y2={130} stroke="currentColor" strokeWidth={4} strokeLinecap="round" />

      <Rung y={56} ly={34} pressed={pressA} on={onA} closed={!onB} bl="정회전 버튼" cl="역회전 접점" kl="정회전 코일" />
      <Rung y={118} ly={150} pressed={pressB} on={onB} closed={!onA} bl="역회전 버튼" cl="정회전 접점" kl="역회전 코일" />

      {/* 서로를 끊는 두 손 — 살아 있는 쪽만 붉게 켜진다 */}
      <Arrow x1={236} y1={74} x2={170} y2={100} tone={onA ? 'bad' : 'dash'} />
      <Arrow x1={236} y1={100} x2={170} y2={74} tone={onB ? 'bad' : 'dash'} />

      <Lab x={160} y={172} size={12} tone={sel === 'both' ? 'bad' : 'mute'}>
        {sel === 'none' ? '한쪽을 눌러 보라' : sel === 'both' ? '동시에 눌러도 하나만 산다' : '켜진 쪽이 반대쪽 접점을 연다'}
      </Lab>
    </Frame>
  )
}

// ── 교착 상태 ───────────────────────────────────────────────────────────────
// 네 대가 고리를 이뤄 서로의 앞을 막는다(원형 대기). 화살표가 **닫힌 고리**인 동안 아무도 못 간다.
// 한 대가 고리 밖으로 비키면 고리가 끊기고 나머지가 차례로 흐른다 — 그 대비가 이 그림의 전부다.
function B11Deadlock() {
  const [free, setFree] = useState(false)
  const tone = free ? 'flow' : 'bad'
  const Bot = ({ x, y, n, shift }: { x: number; y: number; n: string; shift?: boolean }) => (
    <g style={shift ? { transform: 'translateX(-34px)' } : undefined}>
      <Box x={x} y={y} w={54} h={26} r={8} tone="brand" />
      <circle cx={x + 14} cy={y + 30} r={4} className="vz-card" stroke="currentColor" strokeWidth={2.5} />
      <circle cx={x + 40} cy={y + 30} r={4} className="vz-card" stroke="currentColor" strokeWidth={2.5} />
      <Lab x={x + 27} y={y + 18} size={13} tone="inv">{n}</Lab>
    </g>
  )
  return (
    <Frame
      h={190}
      foot={
        <Chip on={free} onClick={() => setFree(!free)}>
          한 대만 뒤로 비켜 주기
        </Chip>
      }
    >
      <Bot x={73} y={40} n="1" />
      <Bot x={193} y={40} n="2" />
      <Bot x={193} y={116} n="3" />
      <Bot x={73} y={116} n="4" shift={free} />

      {/* 고리 — 각자 바로 앞을 막고 있다 */}
      <Arrow x1={129} y1={53} x2={191} y2={53} tone={tone} />
      <Arrow x1={220} y1={70} x2={220} y2={114} tone={tone} />
      <Arrow x1={191} y1={129} x2={129} y2={129} tone={tone} />
      {!free && <Arrow x1={100} y1={114} x2={100} y2={70} tone="bad" />}

      <Lab x={160} y={96} size={13} tone={free ? 'ok' : 'bad'}>{free ? '차례로 빠져나간다' : '아무도 못 간다'}</Lab>
      {free && <Lab x={66} y={168} size={12} tone="ok">비켰다</Lab>}
    </Frame>
  )
}

// ── 센서 스푸핑 ─────────────────────────────────────────────────────────────
// 코드는 한 줄도 안 건드린다. **센서에 물리 신호를 먹여** 계측값 자체를 거짓으로 만든다.
// 그래서 제어기는 제 할 일을 정확히 하면서도 멀쩡한 기체를 기울인다 — 점선이 진짜 수평이다.
function B11Spoof() {
  const [on, setOn] = useState(true)
  return (
    <Frame
      h={196}
      foot={
        <Chip on={on} onClick={() => setOn(!on)}>
          음파 쏘기
        </Chip>
      }
    >
      {/* 공격원 — 네트워크가 아니라 소리·빛이다 */}
      <path d="M18 70 L18 96 L38 108 L38 58 Z" className="vz-mute" stroke="currentColor" strokeWidth={3} strokeLinejoin="round" />
      {on && (
        <g className="vz-goal" strokeWidth={3} fill="none" strokeLinecap="round">
          <path d="M44 68 q8 15 0 30" />
          <path d="M52 62 q12 21 0 42" />
          <path d="M60 56 q16 27 0 54" />
        </g>
      )}

      {/* 센서 — 여기가 속는다 */}
      <Box x={84} y={60} w={64} h={46} tone="card" />
      <Lab x={116} y={78} size={12}>자이로</Lab>
      <Lab x={116} y={98} size={13} tone={on ? 'bad' : 'ok'}>{on ? '+12°' : '0°'}</Lab>

      <Arrow x1={148} y1={83} x2={174} y2={83} tone="flow" />
      <Box x={174} y={60} w={64} h={46} tone="mute" />
      <Lab x={206} y={88} size={13}>제어기</Lab>
      <Arrow x1={206} y1={106} x2={206} y2={128} tone="flow" />
      <Lab x={192} y={120} size={11} anchor="end" tone={on ? 'bad' : 'mute'}>{on ? '거짓을 믿고' : '참값대로'}</Lab>

      {/* 진짜 수평 — 기체가 여기서 벗어나는 게 피해다 */}
      <line x1={140} y1={152} x2={276} y2={152} className="vz-dash" strokeWidth={2.5} />
      <Lab x={136} y={156} size={11} anchor="end">실제 수평</Lab>
      <g style={{ transform: on ? 'rotate(-14deg)' : 'none', transformOrigin: '206px 152px' }}>
        <line x1={172} y1={152} x2={240} y2={152} stroke="currentColor" strokeWidth={5} strokeLinecap="round" />
        <ellipse cx={172} cy={152} rx={13} ry={4} className="vz-brand" stroke="currentColor" strokeWidth={2.5} />
        <ellipse cx={240} cy={152} rx={13} ry={4} className="vz-brand" stroke="currentColor" strokeWidth={2.5} />
        <rect x={194} y={143} width={24} height={16} rx={5} className="vz-brand" stroke="currentColor" strokeWidth={3} />
      </g>

      <Lab x={160} y={186} size={12} tone={on ? 'bad' : 'ok'}>
        {on ? '멀쩡한 기체가 거짓말을 믿고 기울어진다' : '지금은 있는 그대로 읽는다'}
      </Lab>
    </Frame>
  )
}

// ── 액션 통신 ───────────────────────────────────────────────────────────────
// 셋을 같은 무대(보내는 쪽 ↔ 받는 쪽)에 올려 **오가는 말의 개수와 방향**만 갈아 끼운다.
// 토픽 = 한쪽으로만 · 서비스 = 한 번 묻고 한 번 답(그동안 묶여 있다) · 액션 = 하는 중에도 오간다.
type ActMsg = { y: number; dir: 1 | -1; t: string; bad?: boolean }
const ACT_MODES: { name: string; msgs: ActMsg[]; cap: string }[] = [
  {
    name: '토픽',
    cap: '보내고 끝 — 받았는지 모른다',
    msgs: [
      { y: 70, dir: 1, t: '센서값' },
      { y: 96, dir: 1, t: '센서값' },
      { y: 122, dir: 1, t: '센서값' },
      { y: 148, dir: 1, t: '센서값' },
    ],
  },
  {
    name: '서비스',
    cap: '한 번 묻고 한 번 답하면 끝',
    msgs: [
      { y: 80, dir: 1, t: '요청' },
      { y: 132, dir: -1, t: '응답' },
    ],
  },
  {
    name: '액션',
    cap: '하는 중에 진행률도, 취소도 오간다',
    msgs: [
      { y: 68, dir: 1, t: '목표' },
      { y: 100, dir: -1, t: '진행 30%' },
      { y: 126, dir: -1, t: '진행 70%' },
      { y: 158, dir: 1, t: '취소', bad: true },
    ],
  },
]

function B11Action() {
  const [sel, setSel] = useState(2)
  const m = ACT_MODES[sel]
  return (
    <Frame
      h={206}
      foot={ACT_MODES.map((x, i) => (
        <Chip key={x.name} on={i === sel} onClick={() => setSel(i)}>{x.name}</Chip>
      ))}
    >
      <Box x={30} y={20} w={84} h={28} r={9} tone="card" />
      <Lab x={72} y={39} size={11}>보내는 쪽</Lab>
      <Box x={206} y={20} w={84} h={28} r={9} tone="card" />
      <Lab x={248} y={39} size={11}>받는 쪽</Lab>
      <line x1={72} y1={52} x2={72} y2={182} className="vz-dash" strokeWidth={2.5} />
      <line x1={248} y1={52} x2={248} y2={182} className="vz-dash" strokeWidth={2.5} />

      {/* 서비스만 — 답이 올 때까지 보내는 쪽이 묶인다 */}
      {sel === 1 && (
        <>
          <Box x={66} y={84} w={12} h={44} r={5} tone="mute" />
          <Lab x={60} y={110} size={11} anchor="end">묶여 기다림</Lab>
        </>
      )}
      {/* 액션만 — 받는 쪽이 오래 일하는 동안에도 줄이 살아 있다 */}
      {sel === 2 && (
        <>
          <Box x={242} y={72} w={12} h={82} r={5} tone="teal" />
          <Lab x={300} y={116} size={11} anchor="end" tone="ok">하는 중</Lab>
        </>
      )}

      {m.msgs.map((g) => (
        <g key={`${g.y}-${g.t}`}>
          <Arrow
            x1={g.dir === 1 ? 78 : 242}
            y1={g.y}
            x2={g.dir === 1 ? 242 : 78}
            y2={g.y}
            tone={g.bad ? 'bad' : 'flow'}
          />
          <Lab x={160} y={g.y - 7} size={11} tone={g.bad ? 'bad' : 'mute'}>{g.t}</Lab>
        </g>
      ))}

      <Lab x={160} y={198} size={12} tone={sel === 2 ? 'ok' : 'mute'}>{m.cap}</Lab>
    </Frame>
  )
}

// ── 복셀 그리드 다운샘플링 ──────────────────────────────────────────────────
// 점 구름 위에 격자를 씌우고 **칸마다 대표점 하나**만 남긴다. 슬라이더로 칸을 키우면
// 점 개수가 뚝 떨어지는데 의자 모양은 남는다(너무 키우면 얇은 다리부터 사라진다 — 그것도 보여야 한다).
const VOX_CELLS = [10, 14, 20, 28]
// 라이다로 찍은 의자 한 개. 씨앗 고정 난수라 매 렌더 같은 자리에 찍힌다.
const VOX_PTS: [number, number][] = (() => {
  let s = 20260908
  const rnd = () => {
    s = (s * 48271) % 2147483647
    return s / 2147483647
  }
  const parts: [number, number, number, number, number][] = [
    [60, 30, 22, 78, 48], // 등받이
    [60, 108, 152, 18, 84], // 좌판
    [66, 126, 14, 30, 20], // 앞다리
    [194, 126, 14, 30, 20], // 뒷다리
  ]
  const out: [number, number][] = []
  for (const [x, y, w, h, n] of parts) for (let i = 0; i < n; i++) out.push([x + rnd() * w, y + rnd() * h])
  return out
})()

function B11Voxel() {
  const [i, setI] = useState(1)
  const cell = VOX_CELLS[i]

  // 칸마다 점을 모아 무게중심 하나로 접는다 — 이게 다운샘플링의 전부다.
  const bins = new Map<string, [number, number, number]>()
  for (const [x, y] of VOX_PTS) {
    const k = `${Math.floor(x / cell)}_${Math.floor(y / cell)}`
    const b = bins.get(k)
    if (b) {
      b[0] += x
      b[1] += y
      b[2] += 1
    } else bins.set(k, [x, y, 1])
  }
  const reps = Array.from(bins.values(), (b) => [b[0] / b[2], b[1] / b[2]] as [number, number])

  const gx: number[] = []
  for (let x = Math.floor(52 / cell) * cell; x <= 224; x += cell) gx.push(x)
  const gy: number[] = []
  for (let y = Math.floor(26 / cell) * cell; y <= 162; y += cell) gy.push(y)

  return (
    <Frame
      h={202}
      foot={
        <>
          <input
            className="dy-viz-range"
            type="range"
            min={0}
            max={VOX_CELLS.length - 1}
            value={i}
            onChange={(e) => setI(Number(e.target.value))}
            aria-label="칸 크기"
          />
          <span className="dy-viz-hint">칸 {cell}</span>
        </>
      }
    >
      {/* 격자 — 이 칸이 곧 복셀이다 */}
      <g className="vz-web" strokeWidth={1.2}>
        {gx.map((x) => <line key={`v${x}`} x1={x} y1={26} x2={x} y2={162} />)}
        {gy.map((y) => <line key={`h${y}`} x1={52} y1={y} x2={224} y2={y} />)}
      </g>
      {/* 원본 점 구름 */}
      {VOX_PTS.map(([x, y], n) => (
        <circle key={n} cx={x} cy={y} r={1.7} className="vz-brand" />
      ))}
      {/* 칸마다 남는 대표점 */}
      {reps.map(([x, y], n) => (
        <circle key={n} cx={x} cy={y} r={3.4} className="vz-gold-f" stroke="currentColor" strokeWidth={2} />
      ))}

      <Lab x={296} y={60} size={12} anchor="end" tone="hot">{VOX_PTS.length}점</Lab>
      <Lab x={296} y={80} size={12} anchor="end">↓</Lab>
      <Lab x={296} y={102} size={13} anchor="end" tone="ok">{reps.length}점</Lab>
      <Lab x={160} y={182} size={12}>칸 하나에 대표점 하나만 남는다</Lab>
      <Lab x={160} y={196} size={11} tone={reps.length < 20 ? 'bad' : 'ok'}>
        {reps.length < 20 ? '너무 키우면 얇은 다리부터 사라진다' : '개수는 줄고 모양은 남는다'}
      </Lab>
    </Frame>
  )
}

export const VISUALS_B11: Record<string, () => ReactNode> = {
  b11_estop: B11EStop,
  b11_interlock: B11Interlock,
  b11_deadlock: B11Deadlock,
  b11_spoof: B11Spoof,
  b11_action: B11Action,
  b11_voxel: B11Voxel,
}
