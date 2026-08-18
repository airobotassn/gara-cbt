// 별하늘 한 벌 — 랜딩 지구본(`RankGlobe`)과 배경 레이어(`StarField`)가 **같은 함수**로 그린다.
//
// 왜 함수로 빼나 (2026-08-18)
//   별을 화면마다 다시 짜면 밀도·크기·색이 조금씩 갈려서 "같은 우주"로 안 읽힌다.
//   랜딩에서 이미 통과한 그림이 하나 있으니 그걸 단일 출처로 두고, 쓰는 쪽은 캔버스만 넘긴다.
//
// ⚠️ 시드 고정이다 — 같은 크기면 항상 같은 별자리가 나온다. 리사이즈·리마운트마다 별이 새로
//    태어나면 창을 줄였다 늘릴 때 하늘이 통째로 갈아치워진 것처럼 보인다.

/** 별 밀도 = 화면 넓이 / 이 값. 작을수록 촘촘하다(랜딩에서 맞춘 값). */
const AREA_PER_STAR = 5200
const SEED = 20260806

/**
 * `cv` 를 CSS 크기 `w`×`h`(DPR 배율 `dpr`)로 맞추고 별을 채운다.
 * 캔버스는 **투명 배경**이다 — 밤하늘 색은 부르는 쪽이 자기 배경으로 깐다.
 */
export function paintStars(cv: HTMLCanvasElement, w: number, h: number, dpr: number) {
  cv.width = Math.max(1, Math.round(w * dpr))
  cv.height = Math.max(1, Math.round(h * dpr))
  const s = cv.getContext('2d')
  if (!s) return
  s.setTransform(dpr, 0, 0, dpr, 0, 0)
  s.clearRect(0, 0, w, h)
  let seed = SEED
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
  const n = Math.round((w * h) / AREA_PER_STAR)
  for (let i = 0; i < n; i++) {
    const x = rnd() * w
    const y = rnd() * h
    const p = rnd()
    // 큰 별은 드물게 — 다 같은 크기면 별이 아니라 노이즈로 보인다.
    const r = p > 0.985 ? 1.5 : p > 0.9 ? 1 : 0.65
    const a = 0.18 + rnd() * 0.72
    s.beginPath()
    s.arc(x, y, r, 0, 6.283)
    s.fillStyle = `rgba(${200 + Math.round(rnd() * 55)},${215 + Math.round(rnd() * 40)},255,${a.toFixed(3)})`
    s.fill()
  }
}
