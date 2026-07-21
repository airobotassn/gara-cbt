// 월드 아레나 지도 데이터 계층 — TopoJSON 로딩 · 지역 모델 · 색 스케일 · 목값.
//   지도 경계는 public/geo/*.json (Natural Earth 세계 · 통계청 2018 시도/시군구) 를 런타임에 fetch 한다.
//   시군구(kr-muni, 177KB)는 시도까지 파고든 사람만 필요하므로 **드릴다운 시점에 지연 로드**한다.
import { feature } from 'topojson-client'
import { scaleLinear } from 'd3-scale'
import type { Feature, Geometry, FeatureCollection } from 'geojson'
import type { Topology, GeometryCollection } from 'topojson-specification'
import type { Lang } from '../i18n'
import { KR_ID, M49_TO_ISO2, NUM2KO, PROV_I18N, PROV_TO_ISO } from './tables'

export type ArenaLevel = 0 | 1 | 2

export interface GeoProps {
  name?: string
  name_eng?: string
  code?: string
}
export type GeoFeature = Feature<Geometry, GeoProps> & { id?: string | number }

/** 지도에 칠할 한 구역(국가/시도/시군구). score·takers 는 실데이터 없으면 목값. */
export interface Region {
  f: GeoFeature
  key: string
  name: string
  code?: string
  drill: boolean
  score: number
  takers: number
  real: boolean
}

/** 백엔드 집계 주입분: alpha2(국가) 또는 region_code(시도) → 값 */
export interface RealBucket {
  level: number
  members: number
}
export interface RealData {
  country: Record<string, RealBucket>
  region: Record<string, RealBucket>
}
export const EMPTY_REAL: RealData = { country: {}, region: {} }

// ── TopoJSON 로딩(모듈 캐시 — 라우트를 오갈 때 재요청하지 않는다) ──
const cache = new Map<string, Promise<GeoFeature[]>>()

function loadFeatures(url: string, pick?: (t: Topology) => string): Promise<GeoFeature[]> {
  const hit = cache.get(url)
  if (hit) return hit
  const p = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`geo fetch failed: ${url}`)
      return r.json() as Promise<Topology>
    })
    .then((topo) => {
      const objKey = pick ? pick(topo) : Object.keys(topo.objects)[0]
      const fc = feature(topo, topo.objects[objKey] as GeometryCollection<GeoProps>) as unknown as FeatureCollection<Geometry, GeoProps>
      return fc.features as GeoFeature[]
    })
  cache.set(url, p)
  return p
}

/** 세계 국가(남극 제외) — 지구본(레벨0) */
export const loadCountries = (): Promise<GeoFeature[]> =>
  loadFeatures('/geo/world.json', () => 'countries').then((fs) =>
    fs.filter((f) => f.properties.name !== 'Antarctica'),
  )
/** 대한민국 시도 17개 — 레벨1 */
export const loadProvinces = (): Promise<GeoFeature[]> => loadFeatures('/geo/kr-prov.json')
/** 시군구 250개 — 레벨2(지연 로드) */
export const loadMunicipalities = (): Promise<GeoFeature[]> => loadFeatures('/geo/kr-muni.json')

// ── 실데이터 없을 때 쓰는 목값(지역 코드 해시 기반 — 새로고침해도 같은 값) ──
function h32(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
const mockLevel = (k: string) => Math.round((1 + (h32('s' + k) % 601) / 100) * 10) / 10 // 1.0–7.0
const mockTakers = (k: string) => 30 + (h32('n' + k) % 9970)

/** 평균 레벨(1~7) → 지도 색. CSS 토큰이 아니라 값 스케일이라 테마와 무관하게 고정. */
export const cscale = scaleLinear<string>()
  .domain([1, 3, 5, 7])
  .range(['#d9e8fd', '#9dc2f0', '#5b93e2', '#2e6bc8'])
  .clamp(true)

// ── 지명 현지화 ──
//   국가: Intl.DisplayNames(언어) → 실패 시 한글표 → 영문 원명
//   시도: ko=한글 / ja·zh=한자표 / 그 외=영문 로마자(name_eng)
//   시군구: ko=한글 / 그 외=영문 로마자(250개라 한자 미제공)
const displayNames = new Map<Lang, Intl.DisplayNames | null>()
function regionNamesFor(lang: Lang): Intl.DisplayNames | null {
  if (!displayNames.has(lang)) {
    try {
      displayNames.set(lang, new Intl.DisplayNames([lang], { type: 'region' }))
    } catch {
      displayNames.set(lang, null)
    }
  }
  return displayNames.get(lang) ?? null
}

export function countryName(f: GeoFeature, lang: Lang): string {
  const iso = M49_TO_ISO2[String(f.id)]
  const dn = regionNamesFor(lang)
  if (iso && dn) {
    try {
      const n = dn.of(iso)
      if (n && n !== iso) return n
    } catch {
      /* 폴백으로 진행 */
    }
  }
  return NUM2KO[String(f.id)] || f.properties.name || String(f.id)
}
function provName(f: GeoFeature, lang: Lang): string {
  if (lang === 'ko') return f.properties.name ?? ''
  const table = PROV_I18N[lang]
  const code = f.properties.code
  if (table && code && table[code]) return table[code]
  return f.properties.name_eng || f.properties.name || ''
}
const localName = (f: GeoFeature, lang: Lang): string =>
  lang === 'ko' ? (f.properties.name ?? '') : (f.properties.name_eng || f.properties.name || '')

export function koreaName(countries: GeoFeature[], lang: Lang): string {
  const f = countries.find((x) => String(x.id) === KR_ID)
  return f ? countryName(f, lang) : 'Korea'
}

// ── 현재 레벨의 구역 목록 만들기(이름 현지화 + 실데이터/목값 병합) ──
export interface BuildArgs {
  level: ArenaLevel
  lang: Lang
  real: RealData
  countries: GeoFeature[]
  provinces: GeoFeature[]
  municipalities: GeoFeature[]
  /** 레벨2에서 파고든 시도 code(예: '37'=경북) */
  provCode: string | null
}

export function buildRegions({ level, lang, real, countries, provinces, municipalities, provCode }: BuildArgs): Region[] {
  let base: Omit<Region, 'score' | 'takers' | 'real'>[]
  if (level === 0) {
    base = countries.map((f) => ({
      f,
      key: 'C' + f.id,
      name: countryName(f, lang),
      drill: String(f.id) === KR_ID,
    }))
  } else if (level === 1) {
    base = provinces.map((f) => ({
      f,
      key: 'P' + f.properties.code,
      name: provName(f, lang),
      code: f.properties.code,
      drill: true,
    }))
  } else {
    base = municipalities
      .filter((f) => (f.properties.code ?? '').slice(0, 2) === provCode)
      .map((f) => ({
        f,
        key: 'M' + f.properties.code,
        name: localName(f, lang),
        code: f.properties.code,
        drill: false,
      }))
  }

  return base.map((r) => {
    // 실데이터 우선(국가=alpha2, 시도=ISO 3166-2). 시군구는 아직 집계 대상이 아니라 항상 목값.
    let bucket: RealBucket | undefined
    if (level === 0) {
      const iso = M49_TO_ISO2[String(r.f.id)]
      if (iso) bucket = real.country[iso]
    } else if (level === 1 && r.code) {
      const iso = PROV_TO_ISO[r.code]
      if (iso) bucket = real.region[iso]
    }
    if (bucket) return { ...r, score: bucket.level, takers: bucket.members, real: true }
    return { ...r, score: mockLevel(r.key), takers: mockTakers(r.key), real: false }
  })
}
