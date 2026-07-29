// Theme 04(Cyber Future) 배경 레이어 — 이미지 한 장 + 그 위에 얹는 광원.
//
// 역할 분담이 핵심이다:
//   · 질감(도시 실루엣·안개·바닥 그리드·원근)  → **이미지**(public/bg-cyber.webp, 33KB)
//   · 움직임(지평선 호흡·바닥을 타고 오는 빛·느린 줌) → **여기 rAF 루프**
// CSS 로 기둥·먼지 같은 걸 따로 그리지 않는다. 이미지가 이미 원근과 광원을 정해 놨는데 CSS 는
// 그 규칙을 모르고 그리기 때문에, 덧그릴수록 두 공간이 겹쳐 보여 조잡해진다.
//
// CSS @keyframes 대신 rAF 로 그리는 이유: OS/브라우저 설정 하나로 CSS 애니메이션이 통째로 멈추면
// 배경이 정지 사진이 된다(실제로 겪었다).
import { useEffect, useRef } from 'react'
import '../styles/cyberbg.css'

export default function CyberBg() {
  const plate = useRef<HTMLImageElement>(null)
  const horizon = useRef<HTMLDivElement>(null)
  const sweepA = useRef<HTMLDivElement>(null)
  const sweepB = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const t = (now - t0) / 1000
      // 지평선 광원 — 느리게 밝아졌다 어두워진다
      if (horizon.current) horizon.current.style.opacity = (0.55 + 0.45 * Math.sin(t * 0.55)).toFixed(3)
      // 바닥 빛 — 소실점에서 좁게 시작해 관객 쪽으로 오면서 넓어지고 흐려진다
      const hz = window.innerHeight * 0.72
      ;[sweepA.current, sweepB.current].forEach((el, i) => {
        if (!el) return
        const u = (t * 0.17 + i * 0.5) % 1
        const ease = u * u // 원근: 멀리선 천천히, 가까울수록 빠르게
        el.style.transform =
          `translate(-50%,${(ease * (window.innerHeight - hz)).toFixed(1)}px)` +
          ` scaleX(${(0.18 + ease * 1.5).toFixed(3)}) scaleY(${(1 + ease * 2.6).toFixed(2)})`
        el.style.opacity = ((u < 0.1 ? u / 0.1 : (1 - u) / 0.9) * 0.75).toFixed(3)
      })
      // 배경 자체는 아주 느린 줌만(마우스 추적은 시선을 뺏어서 안 쓴다)
      if (plate.current) plate.current.style.transform = `scale(${(1.02 + 0.012 * Math.sin(t * 0.13)).toFixed(4)})`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="cbg" aria-hidden="true">
      <img ref={plate} className="cbg-plate" src="/bg-cyber.webp" alt="" />
      <div ref={horizon} className="cbg-horizon" />
      <div ref={sweepA} className="cbg-sweep" />
      <div ref={sweepB} className="cbg-sweep" />
      <div className="cbg-veil" />
    </div>
  )
}
