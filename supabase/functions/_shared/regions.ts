// ISO 3166-2:KR — 17 시도. Server-side allowlist for edge functions (Deno).
// Deno edge fns cannot import from src/, so this mirrors src/lib/regions.ts.
// The code set MUST stay identical to src/lib/regions.ts and the regions(code)
// seed in supabase/migrations/20260714000000_region_onboarding.sql
// (enforced by tests/db/regions-set-equality.mjs).

export const REGION_CODES: readonly string[] = [
  'KR-11',
  'KR-26',
  'KR-27',
  'KR-28',
  'KR-29',
  'KR-30',
  'KR-31',
  'KR-41',
  'KR-42',
  'KR-43',
  'KR-44',
  'KR-45',
  'KR-46',
  'KR-47',
  'KR-48',
  'KR-49',
  'KR-50',
];

export function isValidRegion(code: string): boolean {
  return REGION_CODES.includes(code);
}

export const COUNTRY_RE = /^[A-Z]{2}$/;

// 지역 코드 형식 — 지도(Natural Earth)가 쓰는 값을 그대로 받으므로 **모양을 좁게 잡으면 안 된다**.
//   실제로 섞여 있는 모양: 'KR-11'(ISO 3166-2) · 'AE-X01~'(ISO 없는 구역의 NE 임시코드) ·
//   'ES.CE'(점 표기) · 'Est'(이름 그대로). 그래서 여기서는 길이·문자 종류만 본다.
//   ⚠️ **'국가 = 코드 앞 두 글자' 파싱 금지** — 'Est'(부르키나파소)·'ES.CE'(스페인)에서 바로 깨진다.
//      어느 나라 것인지는 regions.country_code 가 답한다(20260812130000 시드).
const REGION_CODE_RE = /^[^\s]{2,32}$/;
export function isRegionCodeShape(region: string): boolean {
  return REGION_CODE_RE.test(region);
}

// 국가·지역 확정 검증 중 **DB 없이 할 수 있는 부분**.
//   country_code 는 ISO 3166-1 alpha-2 형식(전 세계 어느 나라든 통과), region 은 모양만 본다.
//   "그 지역이 실재하나 · 그 나라 것이 맞나 · 그 나라에 지역이 있나" 는 전부 regions 테이블이 답한다
//   (set-region 이 확정 직전에 조회한다). 코드 3,504개를 소스에 복제하면 지도를 갈 때마다 두 벌이 된다.
export function isValidRegionCountryPair(country: string, region: string): boolean {
  if (!COUNTRY_RE.test(country)) return false;
  return region === '' || isRegionCodeShape(region);
}
