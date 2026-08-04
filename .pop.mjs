// 지역별 '인구 순위' 계산 — NE 도시 데이터(populated places)로 만든다.
// admin-1 자체에는 인구 필드가 없어서, 그 지역 **안에 있는 도시들**의 POP_MAX 를 합쳐 대용으로 쓴다.
// 수도가 있는 지역은 무조건 1위로 올린다.
//
// ⚠️ 이름으로 맞추지 않는다. 도시 데이터의 ADM1NAME 과 지역명이 표기가 달라(모스크바=Moskva,
//    바쿠=Bakı/Baki) 러시아·베트남 같은 큰 나라가 통째로 틀렸다. **좌표가 그 지역 안에 있는지**로
//    판정하면 언어·표기와 무관하게 정확하다.
import { readFileSync } from 'fs'
import { geoContains } from 'd3-geo'

/** 나라별 도시 목록: `{ [iso]: [{ lon, lat, pop, cap }] }` */
export function loadCities(placesPath) {
  const pl = JSON.parse(readFileSync(placesPath, 'utf8'))
  const out = {}
  for (const f of pl.features) {
    const c = f.properties
    const iso = c.ISO_A2
    if (!iso || iso === '-99' || !f.geometry) continue
    const [lon, lat] = f.geometry.coordinates
    ;(out[iso] ??= []).push({ lon, lat, pop: Number(c.POP_MAX) || 0, cap: c.ADM0CAP === 1 })
  }
  return out
}

/**
 * 지역 목록에 순위(ord)를 매긴다 — 수도 1위, 그다음 도시 인구 합이 많은 순.
 * 도시가 하나도 안 잡힌 지역은 뒤로 밀리되 원래 순서를 유지한다.
 * 반환값은 도시가 잡힌 지역 수(빌드 로그용).
 */
export function assignOrd(feats, cities) {
  const acc = feats.map(() => ({ pop: 0, cap: false }))
  for (const c of cities ?? []) {
    const pt = [c.lon, c.lat]
    for (let i = 0; i < feats.length; i++) {
      if (!geoContains(feats[i], pt)) continue
      acc[i].pop += c.pop
      if (c.cap) acc[i].cap = true
      break // 도시는 한 지역에만 속한다
    }
  }
  const scored = feats.map((f, i) => ({ f, i, ...acc[i] }))
  scored.sort((a, b) => (b.cap ? 1 : 0) - (a.cap ? 1 : 0) || b.pop - a.pop || a.i - b.i)
  scored.forEach((s, rank) => {
    s.f.properties.ord = rank + 1
  })
  return scored.filter((s) => s.pop > 0).length
}
