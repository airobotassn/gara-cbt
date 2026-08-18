// 별하늘 배경 — 화면 뒤에 은은한 별을 깐다(랜딩 지구본과 **같은 하늘**, `lib/starfield.ts`).
//
// ⚠️ **다크에서만 그린다.** 별은 밤하늘이 있어야 별이다 — 라이트의 흰 배경(#faf8ff)에
//    옅은 흰 점을 찍으면 별이 아니라 먼지·모니터 얼룩으로 보인다. 테마 토글(FAB)이
//    `html.dark` 를 붙였다 뗐다 하므로 클래스를 관찰해서 켜고 끈다.
//
// ⚠️ 캔버스는 **뷰포트 고정(fixed)** 이다. 페이지 높이만큼 늘리면 아레나처럼 긴 화면에서
//    캔버스가 수천 px 이 되고(메모리·리페인트), 스크롤할 때 별이 같이 흘러 배경이 아니라
//    내용처럼 읽힌다. 옛 랭킹 별하늘도 `background-attachment: fixed` 였다.
//
// 쓰는 쪽은 이 컴포넌트를 페이지 루트 안에 **첫 자식**으로 두고, 내용 겹에 `z-index:1` 을 준다
// (`.arena` ↔ `.aa-wrap` 이 그 짝이다). 여기서 z-index 를 음수로 두지 않는 이유 =
// 음수는 부모 배경까지 뚫고 내려가 페이지가 자기 배경색을 가진 순간 별이 통째로 사라진다.
import { useEffect, useRef, useState } from 'react'
import { paintStars } from '../lib/starfield'

const isDark = () => document.documentElement.classList.contains('dark')

export default function StarField() {
  const cvRef = useRef<HTMLCanvasElement>(null)
  const [dark, setDark] = useState(isDark)

  // 테마 토글 관찰 — 라이트로 바꾸면 캔버스를 아예 언마운트한다(안 그리는 게 아니라 없앤다).
  useEffect(() => {
    const ob = new MutationObserver(() => setDark(isDark()))
    ob.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => ob.disconnect()
  }, [])

  useEffect(() => {
    if (!dark) return
    const cv = cvRef.current
    if (!cv) return
    let raf = 0
    const draw = () => {
      // DPR 을 2로 자른다 — 별은 반지름 1px 안팎이라 3배로 그려봐야 차이가 없고 픽셀만 4배 든다.
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      paintStars(cv, window.innerWidth, window.innerHeight, dpr)
    }
    draw()
    // 리사이즈는 몰아서 한 번만 — 창을 끄는 동안 매 프레임 별을 다시 찍을 이유가 없다.
    const onResize = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(draw)
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
    }
  }, [dark])

  if (!dark) return null
  return <canvas ref={cvRef} className="starfield" aria-hidden="true" />
}
