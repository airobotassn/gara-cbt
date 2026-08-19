// 월드 아레나 지도 데이터 계층 — TopoJSON 로딩 · 지역 모델 · 색 스케일.
//   지도 경계는 public/geo/*.json (Natural Earth 세계 · 통계청 2018 시도/시군구) 를 런타임에 fetch 한다.
//   시군구(kr-muni, 177KB)는 시도까지 파고든 사람만 필요하므로 **드릴다운 시점에 지연 로드**한다.
//
// ⚠️ **점수는 여기서 안 만든다(2026-08-18).** 예전엔 이 파일에 데모 순위표(MOCK_TOP_COUNTRY 41개국
//    \+ 해시 꼬리 · KR_PROV_ORDER)가 박혀 있어서, 서버 실집계가 없는 구역을 브라우저가 지어냈다.
//    지금은 **더미도 DB(arena_seed_buckets)에 있고** 서버가 실집계와 가중평균으로 섞어 내려준다.
//    → 여기 목값을 되살리지 말 것. 되살리면 "서버가 말하는 순위"와 "화면이 말하는 순위"가 갈린다.
import { feature } from 'topojson-client'
import { scaleLinear } from 'd3-scale'
import type { Feature, Geometry, FeatureCollection } from 'geojson'
import type { Topology, GeometryCollection } from 'topojson-specification'
import type { Lang } from '../i18n'
import { KR_ID, M49_TO_ISO2, NUM2KO, PROV_I18N, PROV_TO_ISO } from './tables'

/**
 * 지도 깊이 — 0=지구본(국가), 1=1차 행정구역(시도·주·성).
 * ⚠️ 예전엔 2(시군구)가 있었는데 걷어냈다. 전 세계로 열면서 그 데이터가 대한민국에만 있어
 * 다른 나라에서 한 단계 더 들어가면 빈 화면이 됐다.
 */
export type ArenaLevel = 0 | 1

export interface GeoProps {
  name?: string
  name_eng?: string
  code?: string
  /** adm1(해외 1차 행정구역) 전용 다국어 이름 — Natural Earth 가 6개국어를 다 갖고 있다. */
  name_en?: string
  name_ja?: string
  name_zh?: string
  name_hi?: string
  name_vi?: string
  /** adm1 전용 데모 순위 — 빌드 때 박는다(수도 1위 → 그 지역 도시 인구 합이 많은 순). */
  ord?: number
}
export type GeoFeature = Feature<Geometry, GeoProps> & { id?: string | number }

/**
 * 지도에 칠할 한 구역(국가/시도/시군구).
 * score·takers 는 서버 버킷 값이고, 버킷이 없으면 0 이다(브라우저가 지어내지 않는다).
 * `real` = 그 버킷에 **실회원이 1명이라도 있나**(시드 더미만 있으면 false) — 툴팁의 '실집계' 배지용.
 */
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

/**
 * 백엔드 집계 주입분: alpha2(국가) 또는 region_code(시도·주) → 값.
 *
 * `score` = leaderboard RPC 의 `score` 필드 = **베이지안 보정된 season_total 평균**
 * (season_total = 개인의 skill_score + activity_score, 즉 개인 랭킹과 같은 재료).
 * 예전엔 같은 응답의 `avg_level`(보정 전 날것)을 썼는데, 그건 이름만 level 이지 실제로는
 * 0~10000 스케일의 랭킹점수라 "Lv.2290" 같은 표시가 나왔고 소수 인원 버킷이 그대로 1위를 먹었다.
 * RPC 쪽 보정(K=25 shrinkage + 일간창 참여율 가중)을 살리려면 반드시 `score` 를 써야 한다.
 *
 * ⚠️ 이 값은 **시드 더미 + 실집계가 이미 합쳐진 것**이다(서버 `refresh_arena_buckets`).
 *    `hasReal` 만이 진짜 사람이 있는 버킷인지 말해 준다 — `members` 는 가상 회원을 포함한다.
 */
export interface RealBucket {
  score: number
  members: number
  hasReal: boolean
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

/**
 * 대한민국 외 국가의 1차 행정구역(주·성·현 등) — Natural Earth 10m admin-1 을 국가별로 쪼갠 것.
 * 214개국 6MB 라 통째로 받으면 안 되고, **파고든 그 나라 것만** 지연 로드한다(나라당 평균 30KB).
 *
 * ⚠️ 대한민국은 여기 쓰지 않고 기존 `loadProvinces()`(kr-prov.json)를 그대로 쓴다 — 시군구(레벨2)
 * 드릴다운과 실집계 매칭이 그 파일의 숫자 코드(`11`·`37`)에 묶여 있기 때문이다.
 */
export const loadAdm1 = (iso: string): Promise<GeoFeature[]> => loadFeatures(`/geo/adm1/${iso}.json`)

/** 어느 나라에 1차 행정구역 데이터가 있는지: `{ 'US': 51, 'JP': 47, ... }`. 드릴다운 가능 여부 판정용. */
let adm1IndexCache: Promise<Record<string, number>> | null = null
export function loadAdm1Index(): Promise<Record<string, number>> {
  if (!adm1IndexCache) {
    adm1IndexCache = fetch('/geo/adm1/index.json')
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, number>>) : {}))
      .catch(() => ({}))
  }
  return adm1IndexCache
}

/**
 * 지도 색 램프 — 밝은 파랑(하위) → 짙은 남색(상위). **진할수록 상위**(단계구분도의 통상 방향).
 * 범례 바(arena.css)도 이 세 색을 같은 순서로 깐다 — 한쪽만 뒤집으면 지도와 범례가 어긋난다.
 *
 * ⚠️ 어느 방향이든 **전 구간이 바다(--aa-ocean-*)와 확실히 갈려야 한다.** 2026-08-19 에 바다가
 * 딥블루 → 연한 회색으로 바뀌면서 관계가 뒤집혔다 — 예전엔 '육지가 바다보다 밝아야' 했고
 * 지금은 파란 육지가 회색 바다보다 **어두워서** 떠 보인다. 그래서 밝은 쪽 끝(#729fdb)을 더
 * 올리지 말 것(바다에 묻힌다). 대신 1~3위 테두리의 **흰 발광**은 어두운 바다를 전제로 잡힌
 * 값이라 바다 쪽에서 약해졌다 — 지금은 육지(파랑) 위에서만 제 역할을 한다.
 */
export const CSCALE_RAMP = ['#729fdb', '#437bc7', '#2b64b6'] as const

/**
 * 1·2·3위 전용 색(프리미엄 골드·사이버 블루·에메랄드 그린) — `[윗쪽 밝은 톤, 아랫쪽 어두운 톤]`.
 *
 * 위 파랑 램프는 "진할수록 상위"라 상위권끼리는 색차가 거의 없다. 시상대에 해당하는 세 자리만
 * 램프에서 빼내 별색으로 칠해, 지도만 봐도 1·2·3위가 어디인지 바로 읽히게 한다.
 *
 * ⚠️ 두 값의 명도 차이를 좁게 유지할 것. 벌려서 볼록한 돔처럼 만들면 보석이 아니라 플라스틱
 * 단추로 보인다 — 존재감은 면이 아니라 **경계의 흰 발광**이 만든다.
 */
export const MEDAL_TONE = [
  ['#f0cc74', '#ce9022'], // 1위 프리미엄 골드
  ['#5ec8ef', '#1889b8'], // 2위 사이버 블루
  ['#68d6a3', '#249562'], // 3위 에메랄드 그린
] as const

/**
 * 4~10위가 공유하는 한 가지 색(밝은 실버블루)과 그 경계 등수.
 *
 * 백분위 램프만 쓰면 4위와 40위의 색차가 미미해 "상위권"이 안 읽힌다. 그래서 4~10위를 한 색으로
 * 묶어 **메달 3개 → 상위 10 덩어리 → 나머지 램프** 3층으로 만든다. 그 안의 순서는 숫자가 말한다.
 *
 * ⚠️ **색상각이 관건이다.** 두 번 실패했다 — 밝은 실버블루(#aec8e2)는 채도가 낮아 "점수 없음"
 * 으로 읽혔고, 페리윙클(#8e9ef2)은 색상각 232°라 지도 파랑(215°)과 같은 계열이라 묻혔다.
 * 쓸 수 있는 구간은 좁다: 메달이 금색(43°)·시안(195°)·에메랄드(155°), 지도가 파랑(215°),
 * 선택 표시가 빨강(#e5484d)을 이미 쓴다 → 남는 건 **보라~자주(280~320°)** 다.
 * ⚠️ 밝기도 메달과 같은 대역(명도 60 안팎)이어야 한다. 어두운 보라(#a86fe3)는 밝은 보석톤
 * 셋 사이에서 혼자 탁하게 겉돌았다.
 *
 * 값은 메달과 같은 `[윗쪽 밝은 톤, 아랫쪽 어두운 톤]` — 같은 방사형 그라디언트·같은 입자감을
 * 태워 한 식구로 보이게 한다(단색으로 두면 혼자 납작해서 겉돈다).
 */
export const TOP10_TONE = ['#d489e4', '#9a44b8'] as const
export const TOP10_CUT = 10

/**
 * 점수 → 지도 색. **백분위(등수 순서) 기반**이다.
 *
 * 점수를 min~max 에 선형으로 깔면 데이터가 몰린 구간(대부분 하위권)에서 색도 뭉쳐 지도가
 * 한 톤으로 보였다. 그래서 값이 아니라 **그 값의 등수/전체**를 0~1 로 만들어 램프에 넣는다 →
 * 몰린 구간이 강제로 펼쳐져 1등부터 꼴찌까지 색이 골고루 진해진다. 동점은 같은 색.
 *
 * CSS 토큰이 아니라 값 스케일이라 테마와 무관하게 고정.
 */
export function makeCscale(scores: number[]): Cscale {
  const ramp = scaleLinear<string>().domain([0, 0.5, 1]).range(CSCALE_RAMP as unknown as string[]).clamp(true)
  const sorted = [...scores].sort((a, b) => a - b)
  const n = sorted.length
  return (v: number) => {
    if (n <= 1) return ramp(1)
    // v 보다 '엄격히 작은' 개수(lower-bound 이진탐색) = 백분위 위치. 동점끼리는 같은 값이 나온다.
    let lo = 0
    let hi = n
    while (lo < hi) {
      const m = (lo + hi) >> 1
      if (sorted[m] < v) lo = m + 1
      else hi = m
    }
    return ramp(lo / (n - 1))
  }
}
/** 색 함수 시그니처 — ArenaMap 등에 prop 으로 넘긴다. */
export type Cscale = (v: number) => string

/**
 * 상위권 별색 — 지도가 그 등수를 램프에서 빼내 따로 칠하면 그 톤, 아니면 `null`(= 램프 그대로).
 *
 * 지도와 오른쪽 랭킹 목록은 **같은 지역을 같은 색으로** 보여야 한다. 목록 막대가 램프 색만 쓰면
 * 상위 10개는 지도에서 금·시안·에메랄드·보라인데 목록에선 전부 같은 파랑이라 짝이 안 맞는다.
 * 4~10위 묶음은 지도와 마찬가지로 **세계 단위에서만** 쓴다(시도 아래로는 지역이 적어 안 쓴다).
 */
export function rankTone(rank: number, level: ArenaLevel): readonly [string, string] | null {
  if (rank >= 1 && rank <= 3) return MEDAL_TONE[rank - 1]
  if (level === 0 && rank <= TOP10_CUT) return TOP10_TONE
  return null
}

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

/** 해외 1차 행정구역 이름 — 빌드 때 6개국어를 다 넣어 뒀으므로 언어 키만 고르면 된다(ko 는 `name`). */
function adm1Name(f: GeoFeature, lang: Lang): string {
  const p = f.properties
  const byLang: Record<Lang, string | undefined> = {
    ko: p.name,
    en: p.name_en,
    ja: p.name_ja,
    zh: p.name_zh,
    hi: p.name_hi,
    vi: p.name_vi,
  }
  return byLang[lang] || p.name_en || p.name || ''
}

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
  /** 레벨1에서 파고든 나라(alpha-2). 'KR' 이면 기존 시도 데이터, 그 외는 adm1. */
  drillIso: string | null
  /** 1차 행정구역 데이터가 있는 나라 목록 — 지구본에서 어느 나라를 파고들 수 있는지 정한다. */
  adm1Index: Record<string, number>
}

export function buildRegions({
  level,
  lang,
  real,
  countries,
  provinces,
  drillIso,
  adm1Index,
}: BuildArgs): Region[] {
  let base: Omit<Region, 'score' | 'takers' | 'real'>[]
  if (level === 0) {
    base = countries.map((f) => ({
      f,
      // ⚠️ world.json 에는 id 없는 피처가 3개 있다(북키프로스·소말릴란드·코소보 — 미승인 국가).
      //    'C' + undefined 로 두면 셋이 같은 키가 되어 React 리스트 키가 충돌하고(랭킹 목록 순서가
      //    뒤섞인다) 목 점수도 셋이 같아진다 → id 없으면 지명으로 대체한다.
      key: 'C' + (f.id ?? f.properties.name ?? ''),
      name: countryName(f, lang),
      // 1차 행정구역 데이터가 있는 나라만 파고들 수 있다(대한민국은 전용 파일로 항상 가능).
      drill: String(f.id) === KR_ID || !!adm1Index[M49_TO_ISO2[String(f.id)] ?? ''],
    }))
  } else {
    // 대한민국은 기존 시도 파일(숫자 코드 → 실집계 매칭), 그 외는 adm1(ISO 3166-2 코드).
    const isKR = drillIso === 'KR'
    base = provinces.map((f) => ({
      f,
      key: 'P' + f.properties.code,
      name: isKR ? provName(f, lang) : adm1Name(f, lang),
      code: f.properties.code,
      drill: false, // 여기가 마지막 단계다
    }))
  }

  return base.map((r) => {
    // 서버 버킷 매칭(국가=alpha2, 지역=region_code).
    let bucket: RealBucket | undefined
    if (level === 0) {
      const iso = M49_TO_ISO2[String(r.f.id)]
      if (iso) bucket = real.country[iso]
    } else if (level === 1 && r.code) {
      // ⚠️ 대한민국 시도만 숫자 코드(`11`·`37`)라 ISO 3166-2 로 옮겨야 하고, 해외 adm1 은
      //    지도 파일의 code 가 이미 ISO 3166-2(`US-CA`)라 그대로가 키다. 폴백을 빼면 해외
      //    주(州)가 통째로 0점이 된다.
      bucket = real.region[PROV_TO_ISO[r.code] ?? r.code]
    }
    // 버킷이 없으면 0 이다 — 브라우저가 점수를 지어내지 않는다(파일 머리 주석 참고).
    // 시드가 DB 에 깔려 있으므로 정상 상태에서 0 이 나오는 구역은 지도에만 있고 시드에 없는 곳이다.
    return {
      ...r,
      score: bucket?.score ?? 0,
      takers: bucket?.members ?? 0,
      real: bucket?.hasReal ?? false,
    }
  })
}
