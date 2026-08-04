// Natural Earth 10m admin-1 → 국가별 TopoJSON (public/geo/adm1/<ISO>.json). 1회성 빌드.
//
// 처리 순서
//   1) 층위가 어긋난 나라는 상위 구역(region)으로 도형을 합친다 → AGG
//   2) 같은 이름 + 같은 타입으로 쪼개져 들어온 레코드를 합친다(한 지역인데 여러 조각인 경우)
//   3) 그래도 이름이 겹치면 타입으로 접미사를 붙여 구분한다(모스크바시 / 모스크바주)
//   4) 한국어 이름이 틀린 몇 건을 손으로 잡는다
//   5) 단순화 → 뭉개진 지역은 원본으로 되돌림 → 링 방향 뒤집힘 검사
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { topology } from 'topojson-server'
import { presimplify, simplify, quantile } from 'topojson-simplify'
import { feature, merge } from 'topojson-client'
import { geoCentroid, geoArea } from 'd3-geo'
import { AGG_KO, TYPE_SUFFIX, isCityType, KO_FIX, KO_FIX_TYPED } from './.adm1names.mjs'
import { loadCities, assignOrd } from './.pop.mjs'

const [, , SRC, PLACES, OUT] = process.argv
const LANGS = ['ko', 'en', 'ja', 'zh', 'hi', 'vi']

/**
 * NE admin-1 이 그 나라의 **최상위 행정구역이 아닌** 나라들 — 상위 구역으로 합친다.
 * ⚠️ 북마케도니아(MK)는 뺐다: region 이 82% 만 채워져 있어 합치면 나머지가 자기 이름으로 남아
 *    23개 뒤죽박죽이 됐고, ISO 기준으로도 기초자치체가 최상위다.
 * ⚠️ 러시아 86·터키 81·태국 77·알제리 48·일본 47 등은 그게 진짜 최상위라 여기 없다.
 */
const AGG = new Set(['GB', 'SI', 'LV', 'PH', 'IT', 'FR', 'BF', 'MT', 'ES', 'GN', 'XK', 'LK'])

const slim = (p) => ({
  code: p.iso_3166_2 || p.adm1_code,
  name: p.name_ko || p.name_en || p.name,
  name_en: p.name_en || p.name,
  name_ja: p.name_ja, name_zh: p.name_zh, name_hi: p.name_hi, name_vi: p.name_vi,
  _type: p.type_en || '',
  _en: p.name_en || p.name || '',
})

/** 같은 region 끼리 도형을 합친다(위상 공유 덕에 내부 경계선이 깔끔히 녹는다). */
function dissolveByRegion(iso, feats) {
  const topo = topology({ adm1: { type: 'FeatureCollection', features: feats } }, 1e4)
  const groups = new Map()
  for (const g of topo.objects.adm1.geometries) {
    const key = g.properties.region || g.properties.name
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(g)
  }
  const ko = AGG_KO[iso] ?? {}
  return [...groups].map(([name, gs]) => ({
    type: 'Feature',
    properties: {
      code: gs[0].properties.region_cod || name,
      // 한국어만 표를 태우고 나머지 언어는 원문(NE 가 상위 구역엔 한 벌만 준다).
      name: ko[name] || name,
      name_en: name, name_ja: name, name_zh: name, name_hi: name, name_vi: name,
      _type: '', _en: name,
    },
    geometry: merge(topo, gs),
  }))
}

/** 같은 이름 + 같은 타입 = 한 지역이 여러 조각으로 들어온 것 → 도형을 합친다. */
function mergeSplitDuplicates(feats) {
  const key = (f) => `${f.properties._en}|${f.properties._type}`
  const groups = new Map()
  for (const f of feats) {
    const k = key(f)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(f)
  }
  if ([...groups.values()].every((g) => g.length === 1)) return { feats, merged: 0 }
  const topo = topology({ adm1: { type: 'FeatureCollection', features: feats } }, 1e4)
  const geoms = topo.objects.adm1.geometries
  const byKey = new Map()
  geoms.forEach((g, i) => {
    const k = key(feats[i])
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k).push(g)
  })
  let merged = 0
  const out = []
  for (const [k, gs] of byKey) {
    const first = feats[geoms.indexOf(gs[0])]
    if (gs.length === 1) { out.push(first); continue }
    merged += gs.length - 1
    out.push({ type: 'Feature', properties: { ...first.properties }, geometry: merge(topo, gs) })
  }
  return { feats: out, merged }
}

/** 남은 동명은 타입으로 가른다. 그래도 같으면 영문명을 괄호로 덧붙인다. */
function disambiguate(feats) {
  const count = new Map()
  for (const f of feats) count.set(f.properties.name, (count.get(f.properties.name) || 0) + 1)
  let fixed = 0
  for (const f of feats) {
    if ((count.get(f.properties.name) || 0) < 2) continue
    const cls = isCityType(f.properties._type) ? 'city' : 'area'
    for (const L of LANGS) {
      const k = L === 'ko' ? 'name' : `name_${L}`
      if (f.properties[k]) f.properties[k] = f.properties[k] + TYPE_SUFFIX[cls][L]
    }
    fixed++
  }
  // 접미사로도 안 갈린 경우(타입이 같음) → 영문 병기
  const c2 = new Map()
  for (const f of feats) c2.set(f.properties.name, (c2.get(f.properties.name) || 0) + 1)
  for (const f of feats) {
    if ((c2.get(f.properties.name) || 0) < 2) continue
    for (const L of LANGS) {
      const k = L === 'ko' ? 'name' : `name_${L}`
      if (f.properties[k]) f.properties[k] = `${f.properties[k]} (${f.properties._en})`
    }
  }
  return fixed
}

const ok = (f) => {
  if (!f || !f.geometry) return false
  const a = geoArea(f)
  return Number.isFinite(geoCentroid(f)[0]) && Number.isFinite(a) && a > 0 && a < 1
}
const listOf = (topo) => { const fc = feature(topo, topo.objects.adm1); return fc.features ?? [fc] }
const flip = (f) => {
  const rev = (rings) => rings.map((r) => [...r].reverse())
  const g = f.geometry
  if (!g) return f
  return { ...f, geometry: g.type === 'Polygon' ? { ...g, coordinates: rev(g.coordinates) }
    : g.type === 'MultiPolygon' ? { ...g, coordinates: g.coordinates.map(rev) } : g }
}

const gj = JSON.parse(readFileSync(SRC, 'utf8'))
const byCountry = new Map()
for (const f of gj.features) {
  const iso = f.properties.iso_a2 && f.properties.iso_a2 !== '-99' ? f.properties.iso_a2 : null
  if (!iso) continue
  if (!byCountry.has(iso)) byCountry.set(iso, [])
  byCountry.get(iso).push(f)
}

// 지역별 인구/수도 인덱스 — 더미 점수를 '수도 1위 → 인구순' 으로 매기는 데 쓴다.
const CITIES = loadCities(PLACES)

mkdirSync(OUT, { recursive: true })
const manifest = {}
const skipped = []
const log = { agg: [], split: [], disamb: [] }
const popStat = []
let total = 0, repaired = 0
for (const [iso, raw] of byCountry) {
  if (raw.length < 2) continue
  let feats
  if (AGG.has(iso)) {
    feats = dissolveByRegion(iso, raw)
    log.agg.push(`${iso} ${raw.length}→${feats.length}`)
  } else {
    feats = raw.map((f) => ({ type: 'Feature', properties: slim(f.properties), geometry: f.geometry }))
    // 한국어 이름이 틀린 건 손으로 잡는다
    for (const f of feats) {
      const typed = KO_FIX_TYPED[`${iso}|${f.properties._en}|${f.properties._type}`]
      const fix = typed || KO_FIX[`${iso}|${f.properties._en}`]
      if (fix) f.properties.name = fix
    }
    const r = mergeSplitDuplicates(feats)
    feats = r.feats
    if (r.merged) log.split.push(`${iso} -${r.merged}`)
  }
  const n = disambiguate(feats)
  // 순위(ord) — 합친 나라는 상위 구역 이름, 아니면 지역 이름으로 도시 인구를 찾는다.
  const matched = assignOrd(feats, CITIES[iso])
  popStat.push({ iso, matched, total: feats.length })
  if (n) log.disamb.push(`${iso}:${n}`)
  for (const f of feats) { delete f.properties._type; delete f.properties._en }
  if (feats.length < 2) { skipped.push(iso); continue }

  const base = () => topology({ adm1: { type: 'FeatureCollection', features: feats } }, 1e4)
  const topo = simplify(presimplify(base()), quantile(presimplify(base()), 0.08))
  const out = listOf(topo).map((f, i) => {
    if (ok(f)) return f
    repaired++
    const orig = feats[i]
    return ok(orig) ? orig : flip(orig)
  })
  const fixed = topology({ adm1: { type: 'FeatureCollection', features: out } }, 1e4)
  if (listOf(fixed).some((f) => !ok(f))) { skipped.push(iso); continue }
  const json = JSON.stringify(fixed)
  writeFileSync(`${OUT}/${iso}.json`, json)
  manifest[iso] = feats.length
  total += json.length
}
writeFileSync(`${OUT}/index.json`, JSON.stringify(manifest))
const n = Object.keys(manifest).length
console.log(`국가 ${n}개 · 총 ${(total / 1024 / 1024).toFixed(1)}MB · 평균 ${(total / n / 1024).toFixed(0)}KB · 원본복구 ${repaired}`)
console.log('상위구역 병합:', log.agg.join(' '))
console.log('조각 중복 병합:', log.split.join(' ') || '없음')
console.log('동명 구분:', log.disamb.join(' ') || '없음')
console.log('제외:', skipped.join(' ') || '없음')
// 도시 자료가 하나도 안 붙은 나라는 순위가 원래 순서대로만 매겨진다(더미가 무의미해진다).
const noPop = popStat.filter((x) => x.matched === 0)
const partial = popStat.filter((x) => x.matched > 0 && x.matched < x.total).length
console.log(`인구 매칭: 전부 ${popStat.length - noPop.length - partial}개국 · 일부 ${partial}개국 · 전무 ${noPop.length}개국`)
if (noPop.length) console.log('  전무:', noPop.map((x) => x.iso).join(' '))
