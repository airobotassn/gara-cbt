// 국가 → 그 나라 지역(1차 행정구역) 목록. 온보딩·마이페이지의 지역 셀렉트가 이걸 그린다.
//
// **데이터를 새로 만들지 않는다.** `/arena` 지도가 이미 쓰는 `public/geo/adm1/<ISO>.json` 을 그대로 읽는다
// (211개국 · 3,504개 구역 · 6개국어 이름이 이미 들어 있다). 나라당 평균 30KB 이고 아레나가 캐시를 공유한다.
//
// ⚠️ 이름을 i18n 사전이나 DB 로 옮기지 말 것 — 그 순간 이름이 두 벌이 되고, 지도에 쓰인 이름과
//    선택 화면의 이름이 갈린다. **DB = 코드(정답지) · 이 파일 = 그림과 이름(표시).**
// ⚠️ 지도 폴리곤은 파싱하지 않는다. TopoJSON 의 `objects[*].geometries[].properties` 만 꺼내므로
//    topojson 라이브러리가 필요 없고, 온보딩 화면이 지도 코드를 끌고 오지 않는다.
// ⚠️ 코드 모양은 나라마다 다르다: 'KR-11'(ISO) · 'AE-X01~'(ISO 없는 구역의 임시코드) · 'ES.CE' · 'Est'.
//    앞 두 글자로 나라를 파싱하면 스페인·부르키나파소에서 깨진다. 나라는 **파일 이름이 곧 나라**다.
import { hasKey, tr, type Lang } from './i18n';

export interface RegionOption {
  code: string;
  name: string;
}

interface Adm1Props {
  code?: string;
  name?: string;
  name_en?: string;
  name_ja?: string;
  name_zh?: string;
  name_hi?: string;
  name_vi?: string;
}

/** 나라별 구역 수 — `{ 'US': 51, 'JP': 47, … }`. 지역을 물어볼 나라인지 판정하는 유일한 근거. */
let indexCache: Promise<Record<string, number>> | null = null;
export function loadRegionIndex(): Promise<Record<string, number>> {
  if (!indexCache) {
    indexCache = fetch('/geo/adm1/index.json')
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, number>>) : {}))
      // 못 받으면 빈 객체 = "지역을 아는 나라가 없다" → 국가만 받는다. 화면이 멈추는 것보다 낫다.
      .catch(() => ({}));
  }
  return indexCache;
}

const listCache = new Map<string, Promise<RegionOption[]>>();

function localName(p: Adm1Props, lang: Lang): string {
  // 한국 시도는 사전(`region.KR-11`)이 이긴다 — 지도 파일은 옛 이름('강원도')이고 사전은 현행
  // 공식 명칭('강원특별자치도')이라, 사전 쪽이 앱의 다른 화면(관리자 시도 필터 등)과도 맞는다.
  // 사전에 키가 없는 나라는 그냥 파일 이름을 쓴다.
  const key = p.code ? `region.${p.code}` : '';
  if (key && hasKey(key)) return tr(lang, key);
  const byLang: Record<Lang, string | undefined> = {
    ko: p.name,
    en: p.name_en,
    ja: p.name_ja,
    zh: p.name_zh,
    hi: p.name_hi,
    vi: p.name_vi,
  };
  return byLang[lang] || p.name_en || p.name || p.code || '';
}

/**
 * 그 나라의 지역 목록(없으면 빈 배열). 화면 언어 이름으로 정렬해서 돌려준다 —
 * 파일 순서는 지도 그리는 순서라 사람이 찾기엔 아무 의미가 없다.
 */
export function loadRegions(iso: string, lang: Lang): Promise<RegionOption[]> {
  const key = `${iso}:${lang}`;
  let p = listCache.get(key);
  if (!p) {
    p = fetch(`/geo/adm1/${iso}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((topo: { objects?: Record<string, { geometries?: { properties?: Adm1Props }[] }> } | null) => {
        const obj = topo?.objects ? Object.values(topo.objects)[0] : null;
        const seen = new Set<string>();
        const out: RegionOption[] = [];
        for (const g of obj?.geometries ?? []) {
          const code = g.properties?.code;
          // ⚠️ 같은 코드가 두 번 나오는 나라가 있다(섬처럼 떨어진 조각이 따로 그려진다). 셀렉트에는 한 줄만.
          if (!code || seen.has(code)) continue;
          seen.add(code);
          out.push({ code, name: localName(g.properties ?? {}, lang) });
        }
        let collator: Intl.Collator;
        try {
          collator = new Intl.Collator(lang);
        } catch {
          collator = new Intl.Collator();
        }
        return out.sort((a, b) => collator.compare(a.name, b.name));
      })
      .catch(() => []);
    listCache.set(key, p);
  }
  return p;
}

/** 저장된 지역 코드 → 표시 이름. 마이페이지가 "지금 내 지역"을 글자로 보여줄 때 쓴다. */
export async function regionDisplayName(iso: string, code: string, lang: Lang): Promise<string> {
  const list = await loadRegions(iso, lang);
  return list.find((r) => r.code === code)?.name || code;
}
