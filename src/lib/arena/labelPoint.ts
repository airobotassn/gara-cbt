// 지도 위 순위 숫자(트로피)를 어디에 찍을지 정한다.
//
// 예전엔 `geoCentroid(feature)` 하나로 끝냈는데, 구면 중심은 두 가지로 어긋난다:
//   (1) 멀리 떨어진 섬이 딸린 지역은 중심이 바다로 끌려간다.
//       — 프랑스(해외령)·인도네시아·필리핀·말레이시아·노르웨이·일본·바하마·피지·솔로몬,
//         국내는 인천(옹진 섬들)·신안·완도·여수·통영·남해·안산 단원.
//   (2) 오목한 모양은 조각이 하나여도 중심이 땅 밖으로 나간다 — 베트남·크로아티아·이스라엘·아이티·사천.
//
// 그래서 **가장 큰 덩어리를 골라** 그 안에 찍고, 그 덩어리 중심마저 땅 밖이면
// **격자 탐색으로 가장 안쪽 점**(경계에서 제일 먼 내부점)을 찾는다.
import { geoArea, geoBounds, geoCentroid, geoContains } from 'd3-geo'
import type { GeoFeature } from './data'

/** 라벨 기준점 + 그 점이 놓인 덩어리(글자 크기는 전체가 아니라 이 덩어리에 맞춰야 안 삐져나온다). */
export interface LabelAnchor {
  point: [number, number]
  part: GeoFeature
}

/** MultiPolygon 을 Polygon 단위로 쪼갠다(그 외 지오메트리는 그대로). */
function toParts(f: GeoFeature): GeoFeature[] {
  if (f.geometry?.type !== 'MultiPolygon') return [f]
  return f.geometry.coordinates.map((coordinates) => ({ ...f, geometry: { type: 'Polygon' as const, coordinates } }))
}

/** 면적이 가장 큰 덩어리 = 그 지역의 '본체'. */
export function largestPart(f: GeoFeature): GeoFeature {
  const parts = toParts(f)
  if (parts.length === 1) return parts[0]
  return parts.reduce((best, p) => (geoArea(p) > geoArea(best) ? p : best), parts[0])
}

const norm = (lon: number) => (lon > 180 ? lon - 360 : lon)

/**
 * 주어진 사각 범위를 격자로 훑어 **경계에서 가장 먼 내부점**을 찾는다(polylabel 의 저해상도 판).
 * 바깥 칸을 시작점으로 BFS 를 돌려 각 내부 칸의 "가장자리까지 몇 칸"을 재고, 최대인 칸을 고른다.
 * 격자 밖은 전부 바깥으로 친다 → 범위가 통째로 내부면 한가운데를 준다.
 */
function deepest(poly: GeoFeature, min: [number, number], max: [number, number], nx: number, ny: number): [number, number] | null {
  const lonAt = (i: number) => min[0] + ((max[0] - min[0]) * (i + 0.5)) / nx
  const latAt = (j: number) => min[1] + ((max[1] - min[1]) * (j + 0.5)) / ny
  const inside = new Uint8Array(nx * ny)
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) if (geoContains(poly, [norm(lonAt(i)), latAt(j)])) inside[i * ny + j] = 1
  }
  const dist = new Int32Array(nx * ny).fill(-1)
  const queue: number[] = []
  for (let k = 0; k < inside.length; k++) if (!inside[k]) { dist[k] = 0; queue.push(k) }
  if (!queue.length) return [norm((min[0] + max[0]) / 2), (min[1] + max[1]) / 2]
  for (let head = 0; head < queue.length; head++) {
    const k = queue[head]
    const i = Math.floor(k / ny)
    const j = k % ny
    const d = dist[k] + 1
    const push = (a: number, b: number) => {
      if (a < 0 || b < 0 || a >= nx || b >= ny) return
      const kk = a * ny + b
      if (dist[kk] !== -1) return
      dist[kk] = d
      queue.push(kk)
    }
    push(i - 1, j); push(i + 1, j); push(i, j - 1); push(i, j + 1)
  }
  let best = -1
  let bestK = -1
  for (let k = 0; k < dist.length; k++) if (inside[k] && dist[k] > best) { best = dist[k]; bestK = k }
  if (bestK < 0) return null // 내부 칸이 하나도 안 잡힘(격자가 성김) → 호출부가 중심으로 폴백
  return [norm(lonAt(Math.floor(bestK / ny))), latAt(bestK % ny)]
}

/** 덩어리 전체를 훑는 1차 탐색 — 격자 칸이 실제 거리로 정사각형에 가깝도록 경도 칸 수를 위도로 보정. */
function deepestInPart(part: GeoFeature, cells: number): { p: [number, number] | null; step: [number, number] } {
  const [[w, s], [e0, n]] = geoBounds(part)
  const e = e0 < w ? e0 + 360 : e0 // 날짜변경선을 넘는 덩어리
  const aspect = Math.max(0.1, ((e - w) * Math.max(0.15, Math.cos((((s + n) / 2) * Math.PI) / 180))) / Math.max(1e-6, n - s))
  const nx = Math.min(64, Math.max(8, Math.round(cells * Math.sqrt(aspect))))
  const ny = Math.min(64, Math.max(8, Math.round(cells / Math.sqrt(aspect))))
  return { p: deepest(part, [w, s], [e, n], nx, ny), step: [(e - w) / nx, (n - s) / ny] }
}

/**
 * 라벨 기준점. 본체 중심이 땅 안이면 그대로(대부분은 여기서 끝), 아니면 격자로 찾은 가장 안쪽 점.
 * 1차로 찾은 칸 둘레만 한 번 더 잘게 훑어 격자 한 칸만큼의 치우침을 줄인다.
 */
export function labelAnchor(f: GeoFeature): LabelAnchor {
  const part = largestPart(f)
  const c = geoCentroid(part) as [number, number]
  if (geoContains(part, c)) return { point: c, part }
  const { p, step } = deepestInPart(part, 34)
  if (!p) return { point: c, part }
  const fine = deepest(part, [p[0] - step[0], p[1] - step[1]], [p[0] + step[0], p[1] + step[1]], 14, 14)
  return { point: fine ?? p, part }
}
