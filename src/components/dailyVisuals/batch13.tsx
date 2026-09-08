// DAILY QUIZ 해설 그림 — 배치 13 「로봇 기본기」.
//
// 이 여덟 장의 짝짓기: 센서(물리량→전기신호) ↔ 액추에이터(전기신호→움직임) ·
// 순기구학(각도→끝점) ↔ 역기구학(끝점→각도). 엔코더는 서보모터 그림(DailyVisual.tsx)에 이미
// 조연으로 나오므로 여기서는 "숫자를 만드는 쪽"이라는 다른 각도로 주연을 맡는다.
// ⛔ 색은 직접 쓰지 않는다 — 선은 stroke="currentColor", 면은 .vz-* 클래스(kit.tsx 머리 주석 참고).
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Frame, Limb, Joint, Box, Arrow, Lab, Chip } from './kit'

// 작은 아이콘 — 액추에이터·센서 두 그림이 공유한다(에너지·물리량의 "종류"만 다르고 모양은 그대로).
function BoltIcon({ x, y }: { x: number; y: number }) {
  return (
    <path
      d={`M${x + 4} ${y - 12} L${x - 5} ${y} L${x + 1} ${y} L${x - 4} ${y + 12}`}
      fill="none" stroke="currentColor" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round"
    />
  )
}
function DropIcon({ x, y }: { x: number; y: number }) {
  return (
    <path
      d={`M${x} ${y - 11} C${x + 8} ${y - 2} ${x + 8} ${y + 8} ${x} ${y + 11} C${x - 8} ${y + 8} ${x - 8} ${y - 2} ${x} ${y - 11} Z`}
      className="vz-brand-hi" stroke="currentColor" strokeWidth={2.5}
    />
  )
}
function PuffIcon({ x, y }: { x: number; y: number }) {
  return (
    <g fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
      <path d={`M${x - 13} ${y - 9} a13 13 0 0 1 0 18`} />
      <path d={`M${x - 8} ${y - 13} a19 19 0 0 1 0 26`} />
    </g>
  )
}
function SunIcon({ x, y }: { x: number; y: number }) {
  const rays = [0, 45, 90, 135, 180, 225, 270, 315]
  return (
    <g stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
      <circle cx={x} cy={y} r={6} className="vz-gold-f" />
      {rays.map((a) => {
        const rad = (a * Math.PI) / 180
        return (
          <line
            key={a}
            x1={x + 10 * Math.cos(rad)} y1={y + 10 * Math.sin(rad)}
            x2={x + 15 * Math.cos(rad)} y2={y + 15 * Math.sin(rad)}
          />
        )
      })}
    </g>
  )
}
function HeatIcon({ x, y }: { x: number; y: number }) {
  return (
    <g fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
      <path d={`M${x - 8} ${y + 12} q4 -8 0 -14 q-4 -6 0 -12`} />
      <path d={`M${x} ${y + 12} q4 -8 0 -14 q-4 -6 0 -12`} />
      <path d={`M${x + 8} ${y + 12} q4 -8 0 -14 q-4 -6 0 -12`} />
    </g>
  )
}
function DistIcon({ x, y }: { x: number; y: number }) {
  return (
    <g stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" fill="none">
      <line x1={x - 14} y1={y} x2={x + 14} y2={y} className="vz-dash" strokeWidth={2} />
      <path d={`M${x - 14} ${y} l5 -5 m-5 5 l5 5`} />
      <path d={`M${x + 14} ${y} l-5 -5 m5 5 l-5 5`} />
    </g>
  )
}

// ── 액추에이터 ──────────────────────────────────────────────────────────────
// 전기·유압·공압 — 뭐가 들어오든 나오는 건 하나, 움직임. 판단은 없다(그래서 caption 이 "판단"을 짚는다).
function B13Actuator() {
  return (
    <Frame h={150}>
      <BoltIcon x={34} y={28} /> <Lab x={34} y={44} size={10}>전기</Lab>
      <DropIcon x={34} y={66} /> <Lab x={34} y={82} size={10}>유압</Lab>
      <PuffIcon x={34} y={104} /> <Lab x={34} y={120} size={10}>공압</Lab>

      <Arrow x1={50} y1={28} x2={126} y2={40} head={6} />
      <Arrow x1={50} y1={66} x2={126} y2={66} head={6} />
      <Arrow x1={50} y1={104} x2={126} y2={92} head={6} />

      <Box x={128} y={20} w={50} h={92} tone="brand" />
      <Lab x={153} y={70} tone="inv" size={12}>변환</Lab>

      <Arrow x1={178} y1={66} x2={206} y2={66} />
      <Joint x={206} y={66} />
      <line x1={206} y1={66} x2={256} y2={66} className="vz-dash" strokeWidth={2.5} />
      <Limb x1={206} y1={66} x2={244} y2={32} w={13} />
      <path d="M256 66 A50 50 0 0 1 244 32" fill="none" className="vz-turn" strokeWidth={3} strokeDasharray="6 5" />
      <circle cx={244} cy={32} r={4} className="vz-gold-f" stroke="currentColor" strokeWidth={2} />
      <Lab x={300} y={20} tone="hot" size={12} anchor="end">움직임</Lab>

      <Lab x={160} y={142} size={11}>무엇이 오든 나오는 건 움직임이다</Lab>
    </Frame>
  )
}

// ── 센서 ────────────────────────────────────────────────────────────────────
// 액추에이터의 거울상 — 물리량 여러 종류가 들어와 전기 신호 하나(파형)로 나간다.
function B13Sensor() {
  return (
    <Frame h={150}>
      <SunIcon x={34} y={28} /> <Lab x={34} y={44} size={10}>빛</Lab>
      <HeatIcon x={34} y={66} /> <Lab x={34} y={82} size={10}>열</Lab>
      <DistIcon x={34} y={104} /> <Lab x={34} y={120} size={10}>거리</Lab>

      <Arrow x1={50} y1={28} x2={126} y2={40} head={6} />
      <Arrow x1={50} y1={66} x2={126} y2={66} head={6} />
      <Arrow x1={50} y1={104} x2={126} y2={92} head={6} />

      <Box x={128} y={20} w={50} h={92} tone="teal" />
      <Lab x={153} y={70} tone="inv" size={12}>변환</Lab>

      <Arrow x1={178} y1={66} x2={206} y2={66} />
      <polyline
        points="206,66 206,46 222,46 222,86 238,86 238,46 254,46 254,66 270,66"
        className="vz-arrow" strokeWidth={3} fill="none"
      />
      <Lab x={300} y={30} tone="hot" size={12} anchor="end">전기 신호</Lab>

      <Lab x={160} y={142} size={11}>무엇을 재든 나오는 건 신호다</Lab>
    </Frame>
  )
}

// ── 엔코더 ──────────────────────────────────────────────────────────────────
// 서보 그림에선 되먹임 고리 속 조연이었다 — 여기선 "돌린 만큼 펄스를 세는" 그 자체가 주인공.
// 돌려도 고쳐 주지 않는다(제어는 서보의 일) — 엔코더는 숫자만 만든다.
const ENC_TICKS = Array.from({ length: 12 }, (_, i) => i * 30)

function B13Encoder() {
  const [deg, setDeg] = useState(0)
  const count = Math.min(12, Math.floor(deg / 30))
  return (
    <Frame
      h={180}
      foot={
        <>
          <input
            className="dy-viz-range"
            type="range"
            min={0}
            max={360}
            value={deg}
            onChange={(e) => setDeg(Number(e.target.value))}
            aria-label="회전각"
          />
          <span className="dy-viz-hint">돌려 보라</span>
        </>
      }
    >
      <circle cx={90} cy={90} r={46} className="vz-mute" stroke="currentColor" strokeWidth={3} />
      <g style={{ transform: `rotate(${deg}deg)`, transformOrigin: '90px 90px' }}>
        {ENC_TICKS.map((a) => {
          const rad = (a * Math.PI) / 180
          return (
            <line
              key={a}
              x1={90 + 34 * Math.cos(rad)} y1={90 + 34 * Math.sin(rad)}
              x2={90 + 44 * Math.cos(rad)} y2={90 + 44 * Math.sin(rad)}
              stroke="currentColor" strokeWidth={3} strokeLinecap="round"
            />
          )
        })}
      </g>
      <path d="M84 40 L96 40 L90 50 Z" className="vz-brand" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
      <Lab x={90} y={26} tone="hot" size={11}>읽는 위치</Lab>

      {/* ⚠️ 값이 섞이면 통째로는 번역표에 없다 — 낱말 조각을 따로 두고 값만 붙인다. */}
      <Lab x={234} y={128} tone="hot" size={12}>{'카운트'} {count}</Lab>
      {Array.from({ length: 12 }, (_, i) => (
        <rect
          key={i} x={176 + i * 11} y={142} width={7} height={16} rx={2}
          className={i < count ? 'vz-node-on' : 'vz-node'} stroke="currentColor" strokeWidth={2}
        />
      ))}

      <Lab x={160} y={172} size={11}>돌린 만큼 펄스가 나온다</Lab>
    </Frame>
  )
}

// ── 토크 ────────────────────────────────────────────────────────────────────
// 같은 세기의 힘, 팔만 길다. 짧은 쪽은 조금 돌고 긴 쪽은 많이 돈다 — 그 차이가 토크다.
function B13Torque() {
  return (
    <Frame h={170}>
      <Joint x={46} y={130} />
      <Limb x1={46} y1={130} x2={96} y2={130} />
      <Arrow x1={96} y1={100} x2={96} y2={126} head={7} />
      <path d="M96 130 A50 50 0 0 1 93 113" fill="none" className="vz-turn" strokeWidth={3} strokeDasharray="6 5" />
      <circle cx={93} cy={113} r={4} className="vz-gold-f" stroke="currentColor" strokeWidth={2} />
      <Lab x={58} y={98} size={11}>조금 돈다</Lab>
      <Lab x={46} y={152} size={11}>짧은 팔</Lab>

      <Joint x={170} y={130} />
      <Limb x1={170} y1={130} x2={270} y2={130} />
      <Arrow x1={270} y1={100} x2={270} y2={126} head={7} />
      <path d="M270 130 A100 100 0 0 1 227 48" fill="none" className="vz-turn" strokeWidth={3} strokeDasharray="6 5" />
      <circle cx={227} cy={48} r={4} className="vz-gold-f" stroke="currentColor" strokeWidth={2} />
      <Lab x={227} y={38} tone="hot" size={11}>많이 돈다</Lab>
      <Lab x={170} y={152} size={11}>긴 팔</Lab>

      <Lab x={160} y={164} size={11}>같은 힘, 먼 데서 밀면 더 세게 돈다</Lab>
    </Frame>
  )
}

// ── 역기구학 ────────────────────────────────────────────────────────────────
// 목표점을 고르면(칩) 관절 각도가 거꾸로 풀린다 — 사람이 좌표로 말한 걸 로봇 각도로 통역.
const IK_BASE = { bx: 54, by: 150, l1: 72, l2: 56 }
const IK_TARGETS = [
  { x: 176, y: 150, label: '멀리' },
  { x: 94, y: 86, label: '위로' },
  { x: 90, y: 130, label: '가깝게' },
] as const

function B13Ik() {
  const [idx, setIdx] = useState(0)
  const { x: tx, y: ty } = IK_TARGETS[idx]
  const dx = tx - IK_BASE.bx
  const dy = ty - IK_BASE.by
  const d = Math.hypot(dx, dy)
  const c2 = Math.min(1, Math.max(-1, (d * d - IK_BASE.l1 * IK_BASE.l1 - IK_BASE.l2 * IK_BASE.l2) / (2 * IK_BASE.l1 * IK_BASE.l2)))
  const t2 = -Math.acos(c2)
  const t1 = Math.atan2(dy, dx) - Math.atan2(IK_BASE.l2 * Math.sin(t2), IK_BASE.l1 + IK_BASE.l2 * Math.cos(t2))
  const ex = IK_BASE.bx + IK_BASE.l1 * Math.cos(t1)
  const ey = IK_BASE.by + IK_BASE.l1 * Math.sin(t1)
  const deg = (r: number) => Math.round((r * 180) / Math.PI)
  return (
    <Frame
      h={176}
      foot={IK_TARGETS.map((t, i) => (
        <Chip key={t.label} on={i === idx} onClick={() => setIdx(i)}>{t.label}</Chip>
      ))}
    >
      <ellipse cx={IK_BASE.bx} cy={IK_BASE.by + 10} rx={30} ry={8} className="vz-mute" stroke="currentColor" strokeWidth={3} />
      <Limb x1={IK_BASE.bx} y1={IK_BASE.by} x2={ex} y2={ey} />
      <Limb x1={ex} y1={ey} x2={tx} y2={ty} w={12} />
      <Joint x={IK_BASE.bx} y={IK_BASE.by} />
      <Joint x={ex} y={ey} r={6} />
      <circle cx={tx} cy={ty} r={12} className="vz-target" strokeWidth={3} />
      <circle cx={tx} cy={ty} r={4} className="vz-target-c" />
      <Lab x={tx} y={ty - 18} tone="hot" size={11}>목표</Lab>

      <Lab x={IK_BASE.bx + 16} y={IK_BASE.by - 16} tone="ok" size={12}>{`θ1 ${deg(t1)}°`}</Lab>
      <Lab x={ex + 14} y={ey - 14} tone="ok" size={12}>{`θ2 ${deg(t2)}°`}</Lab>

      <Lab x={160} y={168} size={11}>목표를 정하면 각도가 거꾸로 풀린다</Lab>
    </Frame>
  )
}

// ── 순기구학 ────────────────────────────────────────────────────────────────
// 역기구학의 거울상 — 이번엔 각도(슬라이더)가 입력이고 끝점(파란 점)이 그 결과로 계산된다.
const FK_BASE = { bx: 50, by: 158, l1: 70, l2: 54 }

function B13Fk() {
  const [t1, setT1] = useState(-100)
  const [t2, setT2] = useState(-40)
  const r1 = (t1 * Math.PI) / 180
  const r2 = ((t1 + t2) * Math.PI) / 180
  const ex = FK_BASE.bx + FK_BASE.l1 * Math.cos(r1)
  const ey = FK_BASE.by + FK_BASE.l1 * Math.sin(r1)
  const tx = ex + FK_BASE.l2 * Math.cos(r2)
  const ty = ey + FK_BASE.l2 * Math.sin(r2)
  return (
    <Frame
      h={180}
      foot={
        <>
          <span className="dy-viz-hint">{'어깨'} {t1}°</span>
          <input
            className="dy-viz-range" type="range" min={-170} max={-10} value={t1}
            onChange={(e) => setT1(Number(e.target.value))} aria-label="어깨 각도"
          />
          <span className="dy-viz-hint">{'팔꿈치'} {t2}°</span>
          <input
            className="dy-viz-range" type="range" min={-150} max={10} value={t2}
            onChange={(e) => setT2(Number(e.target.value))} aria-label="팔꿈치 각도"
          />
        </>
      }
    >
      <ellipse cx={FK_BASE.bx} cy={FK_BASE.by + 10} rx={30} ry={8} className="vz-mute" stroke="currentColor" strokeWidth={3} />
      <Limb x1={FK_BASE.bx} y1={FK_BASE.by} x2={ex} y2={ey} />
      <Limb x1={ex} y1={ey} x2={tx} y2={ty} w={12} />
      <Joint x={FK_BASE.bx} y={FK_BASE.by} />
      <Joint x={ex} y={ey} r={6} />
      <Lab x={FK_BASE.bx + 16} y={FK_BASE.by - 14} tone="hot" size={12}>θ1</Lab>
      <Lab x={ex + 14} y={ey - 12} tone="hot" size={12}>θ2</Lab>

      <circle cx={tx} cy={ty} r={9} className="vz-node-on" stroke="currentColor" strokeWidth={3} />
      {/* ⚠️ 팔이 왼쪽 끝까지 가면 라벨이 상자(0~320) 밖으로 나가 잘린다 — 가장자리에서 붙잡아 둔다.
          번역문은 한국어보다 길어 더 잘 나가므로 넉넉히 잡는다(넘침 검사가 이 자리를 잡아냈다). */}
      <Lab x={Math.min(280, Math.max(40, tx))} y={ty - 16} tone="ok" size={11}>끝점</Lab>

      <Lab x={160} y={172} size={11}>각도를 정하면 끝점이 계산된다</Lab>
    </Frame>
  )
}

// ── SLAM ────────────────────────────────────────────────────────────────────
// 한 걸음마다 지도(위 점)와 내 위치(아래 궤적)가 같은 클릭으로 같이 자란다 — 이게 "동시에"다.
const SLAM_PTS = [
  [30, 140], [76, 110], [122, 150], [168, 100], [214, 140], [260, 95],
] as const
const SLAM_MAP = SLAM_PTS.map(([x, y]) => [x, y - 26] as const)

function B13Slam() {
  const [step, setStep] = useState(0)
  const seen = SLAM_MAP.slice(0, step + 1)
  const trail = SLAM_PTS.slice(0, step + 1)
  const [rx, ry] = SLAM_PTS[step]
  return (
    <Frame
      h={195}
      foot={<Chip onClick={() => setStep((s) => (s >= SLAM_PTS.length - 1 ? 0 : s + 1))}>한 걸음</Chip>}
    >
      <Lab x={14} y={26} tone="hot" size={11} anchor="start">지도(추정)</Lab>
      <Lab x={14} y={182} tone="ok" size={11} anchor="start">내 위치</Lab>

      {seen.length > 1 && (
        <polyline points={seen.map((p) => p.join(',')).join(' ')} className="vz-dash" strokeWidth={2} fill="none" />
      )}
      {seen.map(([x, y], i) => (
        <circle key={`m${i}`} cx={x} cy={y} r={5} className="vz-node-on" stroke="currentColor" strokeWidth={2} />
      ))}

      {trail.length > 1 && (
        <polyline points={trail.map((p) => p.join(',')).join(' ')} stroke="currentColor" strokeWidth={2.5} fill="none" strokeLinecap="round" />
      )}
      <circle cx={rx} cy={ry} r={7} className="vz-brand" stroke="currentColor" strokeWidth={3} />

      <Lab x={160} y={186} size={11}>지도와 위치, 같이 갱신된다</Lab>
    </Frame>
  )
}

// ── 라이다(LiDAR) ───────────────────────────────────────────────────────────
// 빛이 갔다 돌아오는 시간이 길수록 더 먼 점 — 그 시간을 잰 만큼 점이 하나씩 찍혀 지도의 윤곽이 된다.
const LIDAR_WALL = [
  [94, 146], [89, 99], [140, 114], [160, 40], [189, 90], [234, 96], [231, 144],
] as const
const LIDAR_BEAMS = [
  { idx: 2, label: '가까이', ns: 16, m: '2.4' },
  { idx: 4, label: '중간', ns: 23, m: '3.4' },
  { idx: 3, label: '멀리', ns: 35, m: '5.2' },
] as const
const LIDAR_SENSOR = { x: 160, y: 170 }

function B13Lidar() {
  const [sel, setSel] = useState(0)
  const selIdx = LIDAR_BEAMS[sel].idx
  return (
    <Frame
      h={198}
      foot={LIDAR_BEAMS.map((b, i) => (
        <Chip key={b.label} on={i === sel} onClick={() => setSel(i)}>{b.label}</Chip>
      ))}
    >
      {LIDAR_WALL.map(([x, y], i) => (
        <line key={`b${i}`} x1={LIDAR_SENSOR.x} y1={LIDAR_SENSOR.y} x2={x} y2={y} className="vz-dash" strokeWidth={1.5} />
      ))}
      <polyline points={LIDAR_WALL.map((p) => p.join(',')).join(' ')} stroke="currentColor" strokeWidth={2.5} fill="none" strokeLinejoin="round" />
      {LIDAR_WALL.map(([x, y], i) => (
        <circle key={`w${i}`} cx={x} cy={y} r={3.5} className={i === selIdx ? 'vz-node-on' : 'vz-node'} stroke="currentColor" strokeWidth={2} />
      ))}

      <line
        x1={LIDAR_SENSOR.x} y1={LIDAR_SENSOR.y} x2={LIDAR_WALL[selIdx][0]} y2={LIDAR_WALL[selIdx][1]}
        className="vz-arrow" strokeWidth={3}
      />
      <Lab x={LIDAR_WALL[selIdx][0]} y={LIDAR_WALL[selIdx][1] - 12} tone="hot" size={11}>
        {`${LIDAR_BEAMS[sel].ns} ns · ${LIDAR_BEAMS[sel].m} m`}
      </Lab>

      <Box x={146} y={160} w={28} h={18} r={6} tone="mute" />
      <Lab x={160} y={172} size={10}>센서</Lab>

      <Lab x={160} y={190} size={11}>시간을 재서 거리를 안다</Lab>
    </Frame>
  )
}

export const VISUALS_B13: Record<string, () => ReactNode> = {
  b13_actuator: B13Actuator,
  b13_sensor: B13Sensor,
  b13_encoder: B13Encoder,
  b13_torque: B13Torque,
  b13_ik: B13Ik,
  b13_fk: B13Fk,
  b13_slam: B13Slam,
  b13_lidar: B13Lidar,
}
