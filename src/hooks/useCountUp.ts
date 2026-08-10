import { useEffect, useState } from 'react'

// 숫자를 from에서 target까지 부드럽게(easeOut) 올리는 카운트업. delay만큼 늦게 시작.
export function useCountUp(target: number, ms = 700, from = 0, delay = 0): number {
  const [v, setV] = useState(from)
  useEffect(() => {
    let raf = 0
    let to = 0
    const run = () => {
      const start = performance.now()
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / ms)
        const eased = 1 - Math.pow(1 - p, 3)
        setV(Math.round(from + (target - from) * eased))
        if (p < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }
    if (delay > 0) {
      setV(from)
      to = window.setTimeout(run, delay)
    } else {
      run()
    }
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(to)
    }
  }, [target, ms, from, delay])
  return v
}
