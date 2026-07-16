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

// 국가·지역 확정(잠금) 검증의 단일 술어.
//   - region_code 는 화이트리스트, country_code 는 ISO 3166-1 alpha-2 형식,
//   - ISO 3166-2 는 국가 접두어를 품으므로(KR-11 → KR) country 는 region 접두어와 일치해야 한다.
//   영구 잠금이므로 XX/ZZ 형식통과 코드나 US+KR-11 같은 불일치를 차단한다.
export function isValidRegionCountryPair(country: string, region: string): boolean {
  return COUNTRY_RE.test(country) && isValidRegion(region) && country === region.slice(0, 2);
}
