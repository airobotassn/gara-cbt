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
  // ⚠️ 움직임을 줄여달라는 설정이면 아예 그리지 않는다. 판정은 **초기화**에서 한다 —
  //    이펙트에서 끄면 한 프레임이 번쩍였다 사라진다(LevelUpModal 과 같은 이유).
  const [alive, setAlive] = useState(
    () => !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches),
  )

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
    const rnd = (a: number, b: number) => a + Math.random() * (b - a)
    const ps: Piece[] = Array.from({ length: PIECES }, () => ({
      x: rnd(0, w),
      y: rnd(-h * START_SPREAD, -20),
      vx: rnd(-42, 42),
      vy: rnd(90, 190),
      w: rnd(7, 13),
      h: rnd(9, 17),
      rot: rnd(0, Math.PI * 2),
      vr: rnd(-3.4, 3.4),
      flip: rnd(0, Math.PI * 2),
      vf: rnd(2.6, 5.4),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    }))

    const GRAVITY = 210
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
      const left = duration - elapsed
      ctx.globalAlpha = left < FADE_MS ? Math.max(0, left / FADE_MS) : 1

      for (const p of ps) {
        p.vy += GRAVITY * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.rot += p.vr * dt
        p.flip += p.vf * dt
        // 옆으로 흔들리며 떨어진다 — 직선 낙하는 종이가 아니라 빗방울로 보인다.
        p.x += Math.sin(p.flip) * 22 * dt
        if (p.x < -20) p.x = w + 20
        else if (p.x > w + 20) p.x = -20

        if (p.y > h + 30) continue
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        // 납작한 종이가 뒤집히는 느낌 = 세로를 주기적으로 눌러준다.
        ctx.scale(1, Math.cos(p.flip))
        ctx.fillStyle = p.color
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        ctx.restore()
      }

      if (elapsed >= duration) {
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
  }, [alive, duration])

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
