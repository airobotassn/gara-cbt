// DAILY QUIZ 해설 그림 — 배치 4 「생성과 인식」.
//
// 이 묶음의 공통 주제: **입력과 출력의 모양이 바뀐다.** 그림마다 "무엇이 무엇으로 변하는가"가
// 한눈에 보여야 한다 — 파형이 글자가 되고, 글자가 파형이 되고, 잡음이 그림이 된다.
//
// ⛔ 색을 직접 쓰지 말 것(선=currentColor · 면=.vz-* 클래스). daily.css 토큰만 쓰므로 다크모드가 따라온다.
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Frame, Box, Arrow, Lab, Chip } from './kit'

/** 결정론적 잡음 — 같은 씨앗이면 항상 같은 그림(리렌더에도 안 흔들린다). */
function rnd(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453
  return s - Math.floor(s)
}

/** 타일 안에 뿌리는 잡음 알갱이. count 를 줄이면 '걷힌다'가 된다. */
function noiseDots(seed: number, count: number, x: number, y: number, w: number, h: number) {
  return Array.from({ length: count }, (_, k) => (
    <circle
      key={k}
      cx={x + rnd(seed + k * 3.7) * w}
      cy={y + rnd(seed + k * 5.3 + 11) * h}
      r={2.2}
      className={k % 2 ? 'vz-mute' : 'vz-brand-lo'}
    />
  ))
}

// ── 생성형 AI ───────────────────────────────────────────────────────────────
// 판별은 많은 값을 한 낱말로 **좁히고**, 생성은 한 낱말을 없던 그림으로 **넓힌다**.
// 사다리꼴 두 개의 벌어지는 방향이 곧 이 개념이다.
const GEN_PX = [
  [0, 1, 1, 0],
  [1, 1, 1, 1],
  [1, 0, 0, 1],
  [1, 1, 1, 1],
]

function B4GenAi() {
  return (
    <Frame h={160}>
      <Lab x={80} y={20} tone="hot" size={12}>판별 — 가려내기</Lab>
      <Lab x={240} y={20} tone="hot" size={12}>생성 — 만들어내기</Lab>
      <line x1={160} y1={28} x2={160} y2={126} className="vz-dash" strokeWidth={2.5} />

      {/* 왼쪽: 픽셀 무더기 → 좁아지는 깔때기 → 낱말 한 칸 */}
      {GEN_PX.map((row, i) =>
        row.map((v, j) => (
          <rect
            key={`${i}-${j}`}
            x={14 + j * 13}
            y={38 + i * 13}
            width={11}
            height={11}
            rx={2}
            className={v ? 'vz-brand-hi' : 'vz-mute'}
          />
        )),
      )}
      <path d="M72 34 L106 56 L106 74 L72 92 Z" className="vz-scope2" stroke="currentColor" strokeWidth={3} strokeLinejoin="round" />
      <Box x={108} y={52} w={44} h={26} r={8} />
      <Lab x={130} y={70} size={12}>고양이</Lab>
      <Lab x={80} y={112} size={11}>많은 값 → 한 낱말</Lab>

      {/* 오른쪽: 낱말 한 칸 → 넓어지는 깔때기 → 없던 그림 */}
      <Box x={168} y={52} w={44} h={26} r={8} />
      <Lab x={190} y={70} size={12}>고양이</Lab>
      <path d="M214 56 L250 30 L250 100 L214 74 Z" className="vz-scope2" stroke="currentColor" strokeWidth={3} strokeLinejoin="round" />
      <Box x={252} y={30} w={56} h={70} />
      <ellipse cx={280} cy={82} rx={17} ry={11} className="vz-brand" stroke="currentColor" strokeWidth={3} />
      <path d="M270 53 L269 42 L279 50 Z" className="vz-brand-hi" stroke="currentColor" strokeWidth={3} strokeLinejoin="round" />
      <path d="M290 53 L291 42 L281 50 Z" className="vz-brand-hi" stroke="currentColor" strokeWidth={3} strokeLinejoin="round" />
      <circle cx={280} cy={62} r={13} className="vz-brand-hi" stroke="currentColor" strokeWidth={3} />
      <line x1={275} y1={60} x2={275} y2={64} stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
      <line x1={285} y1={60} x2={285} y2={64} stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
      <g className="vz-spark" strokeWidth={2.5} strokeLinecap="round">
        <line x1={296} y1={38} x2={304} y2={38} />
        <line x1={300} y1={34} x2={300} y2={42} />
      </g>
      <Lab x={240} y={112} size={11}>한 낱말 → 없던 그림</Lab>

      <Lab x={160} y={144} size={12}>고르기만 하느냐, 없던 걸 만드느냐</Lab>
    </Frame>
  )
}

// ── 멀티모달 ────────────────────────────────────────────────────────────────
// 모양이 제각각인 입력이 **같은 좌표계 위의 점**이 되어 한자리에 모인다.
function B4Multimodal() {
  return (
    <Frame h={190}>
      {/* 사진 */}
      <Box x={18} y={12} w={66} h={34} />
      <circle cx={36} cy={24} r={5} className="vz-gold-f" stroke="currentColor" strokeWidth={2.5} />
      <path d="M26 40 L40 22 L54 40 Z" className="vz-teal" stroke="currentColor" strokeWidth={2.5} strokeLinejoin="round" />
      {/* 소리 */}
      <Box x={127} y={12} w={66} h={34} />
      {[10, 20, 14, 26, 12, 18].map((h, i) => (
        <rect key={i} x={136 + i * 8} y={29 - h / 2} width={5} height={h} rx={2} className="vz-brand" />
      ))}
      {/* 글 */}
      <Box x={236} y={12} w={66} h={34} />
      <g stroke="currentColor" strokeWidth={3} strokeLinecap="round">
        <line x1={246} y1={21} x2={292} y2={21} />
        <line x1={246} y1={29} x2={292} y2={29} />
        <line x1={246} y1={37} x2={276} y2={37} />
      </g>

      <Lab x={51} y={60} size={11}>사진</Lab>
      <Lab x={160} y={60} size={11}>소리</Lab>
      <Lab x={269} y={60} size={11}>글</Lab>

      <Arrow x1={51} y1={66} x2={112} y2={88} />
      <Arrow x1={160} y1={66} x2={160} y2={88} />
      <Arrow x1={269} y1={66} x2={208} y2={88} />

      {/* 공통 판 — 종류가 달라도 여기서는 좌표 하나짜리 점이다 */}
      <rect x={40} y={94} width={240} height={72} rx={12} className="vz-mute" stroke="currentColor" strokeWidth={3} />
      <g className="vz-web" strokeWidth={1.5}>
        <line x1={88} y1={94} x2={88} y2={166} />
        <line x1={136} y1={94} x2={136} y2={166} />
        <line x1={184} y1={94} x2={184} y2={166} />
        <line x1={232} y1={94} x2={232} y2={166} />
        <line x1={40} y1={118} x2={280} y2={118} />
        <line x1={40} y1={142} x2={280} y2={142} />
      </g>
      <circle cx={155} cy={127} r={30} fill="none" className="vz-dash" strokeWidth={2.5} />
      <rect x={131} y={116} width={11} height={11} rx={2} className="vz-brand" stroke="currentColor" strokeWidth={2.5} />
      <path d="M162 122 L169 136 L155 136 Z" className="vz-teal" stroke="currentColor" strokeWidth={2.5} strokeLinejoin="round" />
      <circle cx={178} cy={118} r={6} className="vz-gold-f" stroke="currentColor" strokeWidth={2.5} />
      <Lab x={48} y={110} tone="hot" size={11} anchor="start">같은 좌표계</Lab>

      <Lab x={160} y={184} size={12}>종류가 달라도 같은 판 위의 점이 된다</Lab>
    </Frame>
  )
}

// ── 컴퓨터 비전 ─────────────────────────────────────────────────────────────
// 픽셀 격자 → 모서리 → 이름표. 단계마다 값은 줄고 뜻은 또렷해진다.
function B4Vision() {
  return (
    <Frame h={166}>
      <Box x={10} y={26} w={88} h={84} />
      {Array.from({ length: 5 }, (_, r) =>
        Array.from({ length: 6 }, (_, c) => {
          const d = Math.hypot(c - 2.5, r - 2.2)
          const cls = d < 1.2 ? 'vz-brand' : d < 2.1 ? 'vz-brand-hi' : 'vz-mute'
          return <rect key={`${r}-${c}`} x={15 + c * 13} y={31 + r * 13} width={12} height={12} className={cls} />
        }),
      )}

      <Arrow x1={100} y1={68} x2={114} y2={68} />

      <Box x={116} y={26} w={88} h={84} />
      <ellipse cx={160} cy={68} rx={30} ry={26} fill="none" stroke="currentColor" strokeWidth={3} />
      <g className="vz-arrow" strokeWidth={3} strokeLinecap="round">
        <line x1={146} y1={58} x2={154} y2={58} />
        <line x1={170} y1={58} x2={178} y2={58} />
        <line x1={152} y1={82} x2={168} y2={82} />
      </g>

      <Arrow x1={206} y1={68} x2={220} y2={68} />

      <Box x={222} y={26} w={88} h={84} />
      <ellipse cx={266} cy={72} rx={26} ry={21} className="vz-mute" stroke="currentColor" strokeWidth={3} />
      <rect x={234} y={44} width={64} height={54} rx={4} fill="none" className="vz-goal" strokeWidth={3} />
      <Lab x={234} y={39} tone="bad" size={11} anchor="start">물체 0.93</Lab>

      <Lab x={54} y={126} size={11}>픽셀 값</Lab>
      <Lab x={160} y={126} size={11}>모서리·윤곽</Lab>
      <Lab x={266} y={126} size={11}>무엇·어디</Lab>
      <Lab x={160} y={152} size={12}>값은 줄고 뜻은 또렷해진다</Lab>
    </Frame>
  )
}

// ── 음성인식 ────────────────────────────────────────────────────────────────
// 요점은 '소리가 글자가 된다'가 아니라 **시간축 위에서 구간과 낱말을 맞춰 붙인다**는 것.
// 그래서 파형·시간자·낱말상자가 같은 세로선을 공유한다(음성합성 그림과 겹치지 않게).
const ASR_SEGS = [
  { x0: 24, w: 64, t: '오늘' },
  { x0: 96, w: 54, t: '회의' },
  { x0: 160, w: 54, t: '시작' },
  { x0: 224, w: 72, t: '합니다' },
]
const ASR_CUTS = [92, 155, 219]

function B4Asr() {
  const bars: ReactNode[] = []
  for (let x = 22; x <= 298; x += 6) {
    const seg = ASR_SEGS.find((s) => x >= s.x0 && x <= s.x0 + s.w)
    const h = seg ? 5 + rnd(x) * 22 : 2
    bars.push(
      <line
        key={x}
        x1={x}
        y1={54 - h}
        x2={x}
        y2={54 + h}
        className={seg ? 'vz-arrow' : undefined}
        stroke={seg ? undefined : 'currentColor'}
        strokeWidth={seg ? 3 : 2}
        strokeLinecap="round"
      />,
    )
  }
  return (
    <Frame h={178}>
      <Lab x={20} y={18} tone="hot" size={11} anchor="start">말소리</Lab>
      {bars}

      {/* 구간 경계 — 파형에서 낱말상자까지 한 줄로 내려간다. 이 세로선이 '정렬'이다. */}
      {ASR_CUTS.map((x) => (
        <line key={x} x1={x} y1={26} x2={x} y2={146} className="vz-dash" strokeWidth={2} />
      ))}

      {/* 시간자 */}
      <line x1={20} y1={94} x2={300} y2={94} stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
      {[24, 92, 155, 219, 298].map((x) => (
        <line key={x} x1={x} y1={90} x2={x} y2={98} stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
      ))}
      <Lab x={22} y={110} size={11} anchor="start">0.0</Lab>
      <Lab x={92} y={110} size={11}>0.6</Lab>
      <Lab x={155} y={110} size={11}>1.2</Lab>
      <Lab x={219} y={110} size={11}>1.8</Lab>
      <Lab x={300} y={110} size={11} anchor="end">2.4초</Lab>

      {/* 받아쓴 낱말 — 상자 폭이 곧 그 낱말이 차지한 시간이다 */}
      {ASR_SEGS.map((s) => (
        <g key={s.t}>
          <Box x={s.x0} y={118} w={s.w} h={26} r={8} />
          <Lab x={s.x0 + s.w / 2} y={135} tone="hot" size={12}>{s.t}</Lab>
        </g>
      ))}

      <Lab x={160} y={166} size={12}>어느 구간이 어느 낱말인지 맞춰 붙인다</Lab>
    </Frame>
  )
}

// ── 음성합성 ────────────────────────────────────────────────────────────────
// 받아쓰기의 역방향으로 그리면 같은 그림이 된다. 여기서는 **억양 곡선이 파형을 만든다**를 보여준다 —
// 곡선을 눕히면 파형이 그 자리에서 밋밋해진다.
const TTS_SYL = ['안', '녕', '하', '세', '요']
const TTS_PITCH = [0.15, -0.55, 0.05, -0.25, 0.95]

function B4Tts() {
  const [amp, setAmp] = useState(70)
  const a = amp / 100
  const flat = amp < 20
  const cx = (i: number) => 44 + i * 58
  const py = (i: number) => 78 - a * TTS_PITCH[i] * 26
  const path = TTS_PITCH.map((_, i) => `${i ? 'L' : 'M'}${cx(i)} ${py(i).toFixed(1)}`).join(' ')

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
            value={amp}
            onChange={(e) => setAmp(Number(e.target.value))}
            aria-label="억양의 세기"
          />
          <span className={`dy-viz-state${flat ? ' drop' : ''}`}>{flat ? '밋밋하다' : '살아난다'}</span>
        </>
      }
    >
      {/* 대본을 발음 조각으로 쪼갠다 */}
      {TTS_SYL.map((s, i) => (
        <g key={s}>
          <Box x={20 + i * 58} y={12} w={48} h={28} r={8} />
          <Lab x={cx(i)} y={31} size={12}>{s}</Lab>
        </g>
      ))}

      {/* 억양(높낮이) 곡선 — 이 선의 모양이 아래 파형을 결정한다 */}
      <line x1={20} y1={78} x2={300} y2={78} className="vz-dash" strokeWidth={2} />
      <path d={path} className="vz-turn" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {TTS_PITCH.map((_, i) => (
        <circle key={i} cx={cx(i)} cy={py(i)} r={4.5} className="vz-gold-f" stroke="currentColor" strokeWidth={2.5} />
      ))}
      <Lab x={300} y={52} tone="hot" size={11} anchor="end">억양 곡선</Lab>

      {/* 파형 — 조각마다 억양 크기만큼 진폭이 붙는다 */}
      {TTS_PITCH.map((p, i) => {
        const base = 5 + a * Math.abs(p) * 20
        return (
          <g key={i}>
            <line x1={cx(i)} y1={py(i) + 10} x2={cx(i)} y2={142 - base - 8} className="vz-dash" strokeWidth={1.5} />
            {Array.from({ length: 7 }, (_, j) => {
              const h = base * (0.55 + 0.45 * Math.abs(Math.sin(j * 1.3 + i)))
              return (
                <rect key={j} x={cx(i) - 18 + j * 6} y={142 - h} width={3} height={h * 2} rx={1.5} className="vz-brand" />
              )
            })}
          </g>
        )
      })}

      <Lab x={160} y={184} size={12}>억양을 눕히면 소리도 밋밋해진다</Lab>
    </Frame>
  )
}

// ── 광학문자인식 ────────────────────────────────────────────────────────────
// 사진 속 글자는 '글자 모양의 얼룩'일 뿐이다. 자리를 먼저 찾아 상자를 치고, 그 안을 읽어 오른쪽으로 옮긴다.
function B4Ocr() {
  return (
    <Frame h={176}>
      {/* 사진 — 안의 글자는 text 가 아니라 획(얼룩)으로 그린다. 그게 요점이다. */}
      <Box x={14} y={26} w={140} h={104} />
      <rect x={28} y={42} width={112} height={32} rx={6} className="vz-brand" stroke="currentColor" strokeWidth={3} />
      <g stroke="currentColor" strokeWidth={4} strokeLinecap="round">
        {[0, 1, 2, 3, 4, 5, 6].map((k) => (
          <line key={k} x1={38 + k * 14} y1={51 + (k % 2) * 3} x2={38 + k * 14} y2={65 - (k % 3) * 2} />
        ))}
      </g>
      <rect x={32} y={46} width={104} height={24} rx={3} fill="none" className="vz-goal" strokeWidth={3} />
      <g stroke="currentColor" strokeWidth={4} strokeLinecap="round">
        {[0, 1, 2, 3].map((k) => (
          <line key={k} x1={46 + k * 14} y1={99 + (k % 2) * 2} x2={46 + k * 14} y2={110 - (k % 3)} />
        ))}
      </g>
      <rect x={38} y={94} width={60} height={20} rx={3} fill="none" className="vz-goal" strokeWidth={3} />
      <Lab x={84} y={148} size={11}>사진 = 글자 모양 얼룩</Lab>

      <Arrow x1={140} y1={58} x2={172} y2={54} />
      <Arrow x1={102} y1={104} x2={172} y2={100} />

      {/* 텍스트 — 고를 수 있고 고칠 수 있는 글자 */}
      <rect x={176} y={34} width={132} height={96} rx={10} className="vz-mute" stroke="currentColor" strokeWidth={3} />
      <rect x={183} y={46} width={72} height={20} rx={4} className="vz-scope2" />
      <Lab x={186} y={61} tone="hot" size={12} anchor="start">CAFE OPEN</Lab>
      <line x1={258} y1={46} x2={258} y2={66} stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
      <Lab x={186} y={105} tone="hot" size={12} anchor="start">09:00-21:00</Lab>
      <Lab x={242} y={148} size={11}>고칠 수 있는 글자</Lab>

      <Lab x={160} y={170} size={12}>자리를 먼저 찾고, 그 안을 읽는다</Lab>
    </Frame>
  )
}

// ── 디퓨전 ──────────────────────────────────────────────────────────────────
// 더하는 방향은 쉽다(회색 화살표). 모델이 배우는 건 그 한 칸을 되돌리는 일뿐이고,
// 그걸 여러 번 반복한 게 생성이다(청록 화살표).
const DIF_DOTS = [22, 14, 8, 3, 0]
const DIF_RATIO = ['잡음 100%', '70%', '40%', '15%', '0%']

function B4Diffusion() {
  return (
    <Frame h={164}>
      <Lab x={160} y={16} size={12}>① 그림에 잡음을 더한다 — 쉽다</Lab>
      <Arrow x1={292} y1={30} x2={26} y2={30} tone="dash" />

      {DIF_DOTS.map((n, i) => {
        const x = 12 + i * 61
        const mount = i >= 3 ? 'vz-teal' : 'vz-mute'
        const sun = i >= 3 ? 'vz-gold-f' : 'vz-mute'
        return (
          <g key={i}>
            <Box x={x} y={44} w={52} h={52} r={8} />
            {i >= 4 && (
              <path d={`M${x + 1} 92 L${x + 16} 68 L${x + 31} 92 Z`} className="vz-brand" stroke="currentColor" strokeWidth={3} strokeLinejoin="round" />
            )}
            {i >= 2 && <circle cx={x + 42} cy={58} r={6} className={sun} stroke="currentColor" strokeWidth={2.5} />}
            {i >= 1 && (
              <path
                d={`M${x + 12} 92 L${x + 32} 56 L${x + 51} 92 Z`}
                className={mount}
                stroke="currentColor"
                strokeWidth={i >= 2 ? 3 : 2}
                strokeLinejoin="round"
              />
            )}
            {noiseDots(i * 97 + 5, n, x + 4, 48, 44, 44)}
            <Lab x={x + 26} y={112} size={11}>{DIF_RATIO[i]}</Lab>
          </g>
        )
      })}

      <Arrow x1={26} y1={130} x2={292} y2={130} />
      <Lab x={160} y={150} tone="ok" size={12}>② 한 칸씩 걷어내면 그림이 된다</Lab>
    </Frame>
  )
}

// ── 텍스트-투-이미지 ────────────────────────────────────────────────────────
// 출발점(잡음)은 늘 같다. **낱말이 어디로 수렴할지를 정한다** — 칩을 바꿔 보면 그것만 바뀐다.
const T2I_WORDS = [
  { k: 'cat', w: '고양이' },
  { k: 'car', w: '자동차' },
  { k: 'mt', w: '산' },
]

function T2iShape({ kind, cx, cy, rough }: { kind: string; cx: number; cy: number; rough: boolean }) {
  const sw = rough ? 2 : 3
  const f = (real: string) => (rough ? 'vz-mute' : real)
  if (kind === 'car') {
    return (
      <g stroke="currentColor" strokeWidth={sw} strokeLinejoin="round">
        <path d={`M${cx - 16} ${cy + 2} L${cx - 8} ${cy - 12} L${cx + 12} ${cy - 12} L${cx + 18} ${cy + 2} Z`} className={f('vz-brand-hi')} />
        <rect x={cx - 26} y={cy + 2} width={52} height={18} rx={6} className={f('vz-brand')} />
        <circle cx={cx - 14} cy={cy + 22} r={6} className={f('vz-card')} />
        <circle cx={cx + 14} cy={cy + 22} r={6} className={f('vz-card')} />
      </g>
    )
  }
  if (kind === 'mt') {
    return (
      <g stroke="currentColor" strokeWidth={sw} strokeLinejoin="round">
        <circle cx={cx + 18} cy={cy - 16} r={7} className={f('vz-gold-f')} />
        <path d={`M${cx - 30} ${cy + 24} L${cx - 8} ${cy - 8} L${cx + 14} ${cy + 24} Z`} className={f('vz-teal')} />
        <path d={`M${cx - 4} ${cy + 24} L${cx + 16} ${cy - 2} L${cx + 32} ${cy + 24} Z`} className={f('vz-brand')} />
      </g>
    )
  }
  return (
    <g stroke="currentColor" strokeWidth={sw} strokeLinejoin="round">
      <ellipse cx={cx} cy={cy + 14} rx={22} ry={13} className={f('vz-brand')} />
      <path d={`M${cx - 11} ${cy - 15} L${cx - 13} ${cy - 28} L${cx - 2} ${cy - 18} Z`} className={f('vz-brand-hi')} />
      <path d={`M${cx + 11} ${cy - 15} L${cx + 13} ${cy - 28} L${cx + 2} ${cy - 18} Z`} className={f('vz-brand-hi')} />
      <circle cx={cx} cy={cy - 6} r={15} className={f('vz-brand-hi')} />
      {!rough && (
        <>
          <line x1={cx - 6} y1={cy - 9} x2={cx - 6} y2={cy - 5} strokeLinecap="round" />
          <line x1={cx + 6} y1={cy - 9} x2={cx + 6} y2={cy - 5} strokeLinecap="round" />
        </>
      )}
    </g>
  )
}

function B4T2i() {
  const [sel, setSel] = useState(0)
  const word = T2I_WORDS[sel]
  const tailX = 98 + word.w.length * 12 + 6
  return (
    <Frame
      h={164}
      foot={T2I_WORDS.map((w, i) => (
        <Chip key={w.k} on={i === sel} onClick={() => setSel(i)}>{w.w}</Chip>
      ))}
    >
      {/* 프롬프트 — 바뀌는 건 밑줄 그은 낱말 하나뿐이다 */}
      <Box x={14} y={14} w={292} h={30} r={9} />
      <Lab x={28} y={34} size={12} anchor="start">밤하늘 아래</Lab>
      <Lab x={98} y={34} tone="hot" size={12} anchor="start">{word.w}</Lab>
      <line x1={98} y1={39} x2={98 + word.w.length * 12} y2={39} className="vz-spark" strokeWidth={2.5} strokeLinecap="round" />
      <Lab x={tailX} y={34} size={12} anchor="start">그림</Lab>

      {/* 출발점은 늘 같은 잡음 */}
      <Box x={20} y={62} w={76} h={76} />
      {noiseDots(41, 26, 24, 66, 68, 68)}

      <Arrow x1={100} y1={100} x2={118} y2={100} />
      <Box x={122} y={62} w={76} h={76} />
      <T2iShape kind={word.k} cx={160} cy={98} rough />

      <Arrow x1={202} y1={100} x2={220} y2={100} />
      <Box x={224} y={62} w={76} h={76} />
      <T2iShape kind={word.k} cx={262} cy={98} rough={false} />

      <Lab x={58} y={152} size={11}>같은 잡음</Lab>
      <Lab x={160} y={152} size={11}>형태가 잡힌다</Lab>
      <Lab x={262} y={152} tone="hot" size={11}>말대로 나온다</Lab>
    </Frame>
  )
}

// ── 딥페이크 ────────────────────────────────────────────────────────────────
// 겉모습(머리·얼굴형)은 왼쪽 사람 것, 움직임(눈·입)은 가운데 사람 것.
// 결과 얼굴에 그 격자가 그대로 얹혀 있는 게 보여야 한다.
function DfFace({ cx, cy, open, mesh, hair }: { cx: number; cy: number; open: boolean; mesh: boolean; hair: boolean }) {
  return (
    <g>
      <ellipse cx={cx} cy={cy} rx={26} ry={30} className="vz-card" stroke="currentColor" strokeWidth={3} />
      {hair && (
        <path
          d={`M${cx - 26} ${cy - 4} A26 30 0 0 1 ${cx + 26} ${cy - 4} Z`}
          className="vz-brand-lo"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinejoin="round"
        />
      )}
      {open ? (
        <g className="vz-arrow" strokeWidth={3} strokeLinecap="round">
          <line x1={cx - 13} y1={cy + 2} x2={cx - 5} y2={cy + 2} />
          <line x1={cx + 5} y1={cy + 2} x2={cx + 13} y2={cy + 2} />
        </g>
      ) : (
        <g>
          <circle cx={cx - 9} cy={cy + 2} r={3.5} className="vz-brand-lo" />
          <circle cx={cx + 9} cy={cy + 2} r={3.5} className="vz-brand-lo" />
        </g>
      )}
      {open ? (
        <ellipse cx={cx} cy={cy + 17} rx={10} ry={7} className="vz-brand-lo" stroke="currentColor" strokeWidth={3} />
      ) : (
        <line x1={cx - 9} y1={cy + 17} x2={cx + 9} y2={cy + 17} stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
      )}
      {mesh && (
        <g>
          <g className="vz-web" strokeWidth={1.5}>
            <line x1={cx - 14} y1={cy - 8} x2={cx + 14} y2={cy - 8} />
            <line x1={cx - 16} y1={cy + 12} x2={cx + 16} y2={cy + 12} />
            <line x1={cx - 14} y1={cy - 8} x2={cx} y2={cy + 24} />
            <line x1={cx + 14} y1={cy - 8} x2={cx} y2={cy + 24} />
            <line x1={cx - 16} y1={cy + 12} x2={cx} y2={cy - 20} />
            <line x1={cx + 16} y1={cy + 12} x2={cx} y2={cy - 20} />
          </g>
          {[
            [cx - 14, cy - 8],
            [cx + 14, cy - 8],
            [cx - 16, cy + 12],
            [cx + 16, cy + 12],
            [cx, cy - 20],
            [cx, cy + 24],
          ].map(([px, py]) => (
            <circle key={`${px}-${py}`} cx={px} cy={py} r={2.6} className="vz-brand" />
          ))}
        </g>
      )}
    </g>
  )
}

function B4Deepfake() {
  return (
    <Frame h={176}>
      <Box x={10} y={26} w={88} h={92} />
      <DfFace cx={54} cy={68} open={false} mesh hair />

      <Arrow x1={100} y1={68} x2={114} y2={68} />

      <Box x={116} y={26} w={88} h={92} />
      <DfFace cx={160} cy={68} open mesh={false} hair={false} />
      <g className="vz-arrow" strokeWidth={2.5} fill="none" strokeLinecap="round">
        <path d="M192 78 a9 9 0 0 0 0 -18" />
        <path d="M198 84 a15 15 0 0 0 0 -30" />
      </g>

      <Arrow x1={206} y1={68} x2={220} y2={68} />

      <Box x={222} y={26} w={88} h={92} />
      <DfFace cx={266} cy={68} open mesh hair />
      <rect x={216} y={20} width={100} height={104} rx={14} fill="none" className="vz-goal" strokeWidth={3} />

      <Lab x={54} y={136} size={11}>이 사람의 얼굴</Lab>
      <Lab x={160} y={136} tone="ok" size={11}>저 사람의 움직임</Lab>
      <Lab x={266} y={136} tone="bad" size={11}>합성 결과</Lab>
      <Lab x={160} y={162} size={12}>겉모습은 이 사람, 움직임은 저 사람</Lab>
    </Frame>
  )
}

// ── 등록표 ──────────────────────────────────────────────────────────────────
// ⚠️ 키는 반드시 `b4_` 로 시작한다(다른 배치와 겹치면 하나가 조용히 덮인다).
export const VISUALS_B4: Record<string, () => ReactNode> = {
  b4_genai: B4GenAi,
  b4_multimodal: B4Multimodal,
  b4_vision: B4Vision,
  b4_asr: B4Asr,
  b4_tts: B4Tts,
  b4_ocr: B4Ocr,
  b4_diffusion: B4Diffusion,
  b4_t2i: B4T2i,
  b4_deepfake: B4Deepfake,
}
