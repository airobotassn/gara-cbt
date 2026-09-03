// 축하 꽃가루(컨페티) — 캔버스 한 장에 조각을 뿌리고 다 떨어지면 스스로 사라진다.
//
// 지금 쓰는 곳: 레벨테스트 결과창(`Result.tsx`)의 승급. 승급은 이 서비스에서 제일 큰 사건인데
// 배너 한 줄이 조용히 떠 있을 뿐이라 "올랐다"가 화면에서 안 읽혔다(2026-08-26 지시).
//
// ⚠️ 허브의 레벨업 연출(`LevelUpModal`)과 **다른 축이다.** 그쪽은 ARENA 레벨(시즌 점수 밴드)이고
//    캐릭터 그림이 진화하는 모달이라, 시험 사다리 등급이 오른 결과창에는 쓸 수 없다.
// ⚠️ 라이브러리를 안 쓴다 — 의존성을 늘리면 `bun.lock` 을 같이 커밋해야 하고(안 하면 CF 빌드가 죽는다)
//    이 연출 하나에 치를 값이 아니다. 조각 뿌리기는 캔버스 60줄이면 끝난다.
// ⚠️ 화면을 덮고 서므로 `pointer-events: none` 이 필수다 — 빼면 연출이 도는 몇 초 동안
//    아래 버튼이 통째로 안 눌린다.
//
// ⛔ **움직임을 줄여달라는 설정에서 축하를 지우지 말 것(2026-09-02 지시).** 처음엔 그 설정이면
//    아예 안 그렸는데, 그건 `prefers-reduced-motion` 을 잘못 읽은 것이다 — 그 설정의 뜻은
//    "화면을 크게 휘젓지 마라"(화면을 가로지르는 이동·시차·회전)이지 "축하하지 마라"가 아니다.
//    삭제가 아니라 **약화**가 표준 대응이라, 지금은 조용한 판(`soft`)을 대신 그린다:
//    조각을 44개로 줄이고 낙하·회전·펄럭임을 전부 빼서 **제자리에서 떠올랐다 사라지게** 한다
//    (1.7초 동안 아래로 15px — 눈이 따라갈 움직임이 아니다). 어지럼증의 원인은 사라지고
//    "터졌다"는 그대로 읽힌다.
import { useEffect, useRef, useState } from 'react'

/** 조각이 다 떨어지고 연출이 끝나는 시각(ms). */
const DURATION = 4600
/** 마지막 이만큼은 서서히 사라진다 — 안 하면 조각들이 화면 한가운데서 툭 끊긴다. */
const FADE_MS = 900
/** 조각 수. 늘리면 화려하지만 저사양 기기에서 프레임이 떨어진다.
 *  ⚠️ START_SPREAD 와 한 쌍이다 — 조각을 위로 넓게 흩뿌린 만큼 한 시점에 화면 안에 있는 수가 줄어든다. */
const PIECES = 190
/** 조각을 화면 높이의 몇 배까지 위로 흩뿌리는가.
 *  ⚠️ 이 값이 곧 연출이 이어지는 길이다 — 1.1 로 두면 2초쯤에 전부 바닥을 지나 **남은 절반이 빈 화면**이 된다
 *     (실제로 그랬다). 늦게 출발하는 조각이 있어야 duration 끝까지 뿌려진다. */
const START_SPREAD = 1.9
/** 축하색 — 파랑 하나로 가면 우리 UI 색과 섞여 '꽃가루'로 안 읽힌다. */
const COLORS = ['#ffd43b', '#ff8787', '#4dabf7', '#69db7c', '#e599f7', '#ffa94d', '#ffffff']

// ── 짧은 판(움직임 줄이기 설정일 때) ─────────────────────────────────────────
// 여기서 두 번 헛짚었다. 기록해 둔다.
//   1차: 이 설정이면 **아예 안 그렸다.** → 승급했는데 화면이 조용했다.
//   2차: 움직임을 0으로 만들고 밀도만 올렸다(제자리에 떠올랐다 사라지는 판).
//        → "느리고 밍밍하다 · 팍 터졌으면 역동적이어야지" (2026-09-02 지시). 맞는 말이다 —
//        **폭죽은 터지는 것이라 안 움직이면 폭죽이 아니다.** 색종이를 화면에 붙여 놓은 것과 같다.
//
// ⛔ **그러니 여기서 '움직임 0'을 다시 시도하지 말 것.** 줄일 것은 움직임의 **양이 아니라 지속**이다.
//    화려한 판이 부담스러운 진짜 이유는 조각이 움직여서가 아니라 **4.6초 동안 화면 전체를 가로질러
//    비처럼 내리는 것**이다(큰 화면, 오래). 그래서 지금 판은:
//      · 한 점에서 **사방으로 터진다** — 이동 거리가 짧고 금세 멎는다(공기저항으로 감속).
//      · **1.6초에 끝난다** — 화려한 판의 1/3.
//      · 화면 밖에서 내려오는 조각이 없다 → '쏟아지는 벽'이 안 생긴다.
//    ⚠️ 윈도우의 '애니메이션 효과' 토글이 이 설정을 켠다. 성능·취향으로 끄는 사람이 많아
//       여기 걸리는 사람 대부분은 전정 장애와 무관하다 — 그래서 축하를 지우는 쪽이 더 나쁜 선택이다.
/** 전체 길이 — 화려한 판(4.6초)의 1/3. 터지고 곧 끝난다. */
const SOFT_DURATION = 1600
/** 마지막에 사라지는 시간. */
const SOFT_OUT_MS = 420
/** 조각 수.
 *  ⚠️ **SOFT_REACH 와 한 쌍이다.** 퍼지는 거리를 넓히면 같은 수가 넓은 면적에 흩어져 **성글어진다**
 *     (거리를 2배로 넓혔더니 밀도가 1/4이 됐다 — 2026-09-02). 한쪽을 건드리면 다른 쪽도 같이 볼 것. */
const SOFT_PIECES = 260
/** 터지는 중심의 세로 위치(화면 높이 비율) — 한가운데보다 살짝 위라야 아래로 퍼질 자리가 남는다. */
const SOFT_ORIGIN_Y = 0.44
/** 공기저항 — 1초에 남는 속도 비율. 이게 있어야 **팍 터졌다가 멎는다**(없으면 그냥 흩어져 나간다). */
const SOFT_DRAG = 0.12
/** 제일 빠른 조각이 날아가는 거리 — **화면 긴 변의 몇 배**인가.
 *  ⚠️ px 로 박지 말 것. 처음에 속도를 px/s 로 고정했더니 데스크톱에서 가운데 좁은 원으로만
 *     터졌다("너무 좁다" — 2026-09-02). 화면 크기에 비례해야 폰에서도 데스크톱에서도 같게 보인다.
 *  0.72 면 화면 구석까지 닿는다(중심에서 모서리까지가 긴 변의 약 0.6배). */
const SOFT_REACH = 0.72
/** 제일 느린 조각의 거리 비율. ⚠️ 0 으로 두면 중심이 비어 **도넛**으로 보인다. */
const SOFT_REACH_MIN = 0.08
/** 터진 뒤 떨어지는 가속도. 화려한 판보다 세게 줘서 빨리 가라앉힌다. */
const SOFT_GRAVITY = 620

interface Piece {
  x: number
  y: number
  vx: number
  vy: number
  w: number
  h: number
  rot: number
  vr: number
  /** 펄럭임 위상 — 조각이 앞뒤로 뒤집히는 것처럼 보이게 한다(납작한 종이 느낌). */
  flip: number
  vf: number
  color: string
}

export default function Confetti({ duration = DURATION }: { duration?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  // ⚠️ 판정은 **초기화**에서 한 번만 한다 — 이펙트에서 하면 화려한 판이 한 프레임 번쩍였다
  //    조용한 판으로 갈린다(LevelUpModal 과 같은 이유).
  const [soft] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const [alive, setAlive] = useState(true)

  useEffect(() => {
    if (!alive) return
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let w = 0
    let h = 0
    const resize = () => {
      w = window.innerWidth
      h = window.innerHeight
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    // 조각은 화면 위쪽 밖에 시차를 두고 세워 둔다(y 를 음수로 흩뿌림) —
    // 한 줄에 몰아 두면 한 덩어리가 통째로 내려와 '커튼'처럼 보인다.
    //   짧은 판은 반대다 — **화면 한가운데 한 점에서 사방으로 터진다.** 화면 밖에서 들어오는 조각이
    //   없어서 '쏟아지는 벽'이 안 생기고, 공기저항으로 금세 멎어 이동 거리도 짧다.
    const rnd = (a: number, b: number) => a + Math.random() * (b - a)
    const dur = soft ? SOFT_DURATION : duration
    const ox = w / 2
    const oy = h * SOFT_ORIGIN_Y
    // 날아갈 '거리'를 정하고 거기서 속도를 역산한다 — 공기저항이 있을 때 초속 v 로 출발한 조각이
    // 멎을 때까지 가는 거리는 v / -ln(저항) 이다. 이렇게 해야 화면 크기가 달라져도 퍼짐이 같다.
    const decay = -Math.log(SOFT_DRAG)
    const reach = Math.max(w, h)
    const vMax = SOFT_REACH * reach * decay
    const vMin = SOFT_REACH_MIN * reach * decay
    const ps: Piece[] = Array.from({ length: soft ? SOFT_PIECES : PIECES }, () => {
      // 사방으로 고르게 — 각도를 랜덤으로만 뽑으면 뭉치는 방향이 생겨 '터짐'이 한쪽으로 쏠린다.
      const a = rnd(0, Math.PI * 2)
      // ⚠️ 제곱근으로 흩는다 — 원판을 고르게 채우는 분포다(균등하게 뽑으면 안쪽이 빽빽해진다).
      const sp = vMin + (vMax - vMin) * Math.sqrt(Math.random())
      return {
        x: soft ? ox : rnd(0, w),
        y: soft ? oy : rnd(-h * START_SPREAD, -20),
        vx: soft ? Math.cos(a) * sp : rnd(-42, 42),
        // 위로 터지는 쪽을 조금 더 세게 — 그래야 솟았다 떨어지는 포물선이 보인다.
        vy: soft ? Math.sin(a) * sp * (Math.sin(a) < 0 ? 1.15 : 0.8) : rnd(90, 190),
        w: soft ? rnd(8, 15) : rnd(7, 13),
        h: soft ? rnd(10, 19) : rnd(9, 17),
        rot: rnd(0, Math.PI * 2),
        vr: soft ? rnd(-7, 7) : rnd(-3.4, 3.4),
        flip: rnd(0, Math.PI * 2),
        vf: soft ? rnd(3.5, 7) : rnd(2.6, 5.4),
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      }
    })

    const GRAVITY = soft ? SOFT_GRAVITY : 210
    let raf = 0
    let start = 0
    let prev = 0

    const frame = (now: number) => {
      if (!start) {
        start = now
        prev = now
      }
      const dt = Math.min((now - prev) / 1000, 0.05) // 탭을 다녀오면 dt 가 커진다 → 순간이동 방지
      prev = now
      const elapsed = now - start

      ctx.clearRect(0, 0, w, h)
      const left = dur - elapsed
      ctx.globalAlpha = soft
        ? left < SOFT_OUT_MS ? Math.max(0, left / SOFT_OUT_MS) : 1
        : left < FADE_MS ? Math.max(0, left / FADE_MS) : 1
      // 공기저항 — 이번 프레임에 남는 속도 비율. 이게 '팍 터졌다가 멎는' 감을 만든다.
      const drag = soft ? Math.pow(SOFT_DRAG, dt) : 1

      for (const p of ps) {
        if (soft) {
          p.vx *= drag
          p.vy *= drag
        }
        p.vy += GRAVITY * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.rot += p.vr * dt
        p.flip += p.vf * dt
        if (!soft) {
          // 옆으로 흔들리며 떨어진다 — 직선 낙하는 종이가 아니라 빗방울로 보인다.
          p.x += Math.sin(p.flip) * 22 * dt
          if (p.x < -20) p.x = w + 20
          else if (p.x > w + 20) p.x = -20
        }

        if (p.y > h + 30) continue
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        // 납작한 종이가 뒤집히는 느낌 = 세로를 주기적으로 눌러준다. 짧은 판도 종이여야 하므로 같이 쓴다.
        ctx.scale(1, Math.cos(p.flip))
        ctx.fillStyle = p.color
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        ctx.restore()
      }

      if (elapsed >= dur) {
        setAlive(false)
        return
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [alive, duration, soft])

  if (!alive) return null
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 65, // 떠 있는 FAB(60~61) 위로 지나간다 — 누르는 건 pointer-events:none 이 막아준다
      }}
    />
  )
}
