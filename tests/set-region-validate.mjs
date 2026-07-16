// set-region 순수 검증 술어 단위 테스트.
// set-region/index.ts 는 Deno 이므로 직접 import 하지 않고, 동일 검증 로직을 담은
// _shared/regions.ts(순수 TS, Deno 전역 미사용) 를 import 해 isValidRegion / COUNTRY_RE 를 검사한다.
import { isValidRegion, COUNTRY_RE, isValidRegionCountryPair } from '../supabase/functions/_shared/regions.ts'

let failed = 0
function check(label, got, want) {
  if (got !== want) {
    console.error(`FAIL: ${label} → got ${got}, want ${want}`)
    failed++
  } else {
    console.log(`ok: ${label}`)
  }
}

check("isValidRegion('KR-11')", isValidRegion('KR-11'), true)
check("isValidRegion('KR-99')", isValidRegion('KR-99'), false)
check("isValidRegion('xx')", isValidRegion('xx'), false)
check("COUNTRY_RE.test('KR')", COUNTRY_RE.test('KR'), true)
check("COUNTRY_RE.test('kr')", COUNTRY_RE.test('kr'), false)
check("COUNTRY_RE.test('KOR')", COUNTRY_RE.test('KOR'), false)

// 국가·지역 교차검증(영구 락 전 필수) — set-region 이 실제로 쓰는 술어.
check("pair('KR','KR-11') valid", isValidRegionCountryPair('KR', 'KR-11'), true)
check("pair('US','KR-11') mismatch rejected", isValidRegionCountryPair('US', 'KR-11'), false)
check("pair('KR','KR-99') invalid region rejected", isValidRegionCountryPair('KR', 'KR-99'), false)
check("pair('XX','KR-11') bad country prefix rejected", isValidRegionCountryPair('XX', 'KR-11'), false)
check("pair('kr','KR-11') lowercase rejected", isValidRegionCountryPair('kr', 'KR-11'), false)

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nall set-region validation checks passed')
