// set-region 순수 검증 술어 단위 테스트.
// set-region/index.ts 는 Deno 이므로 직접 import 하지 않고, 동일 검증 로직을 담은
// _shared/regions.ts(순수 TS, Deno 전역 미사용) 를 import 해 isValidRegion / COUNTRY_RE 를 검사한다.
import { isValidRegion, COUNTRY_RE, isValidRegionCountryPair, isRegionCodeShape } from '../supabase/functions/_shared/regions.ts'

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

// ── 형식 검증(DB 없이 할 수 있는 부분) ──
// ⚠️ "그 지역이 실재하나 · 그 나라 것이 맞나 · 그 나라에 지역이 있나" 는 이제 **regions 테이블**이 답한다
//    (set-region 이 확정 직전에 조회). 코드 3,504개를 소스에 복제하면 지도 파일과 두 벌이 되기 때문이다.
//    그래서 여기서 검사할 수 있는 건 국가 형식과 지역 코드의 모양뿐이다.
check("pair('KR','KR-11') valid", isValidRegionCountryPair('KR', 'KR-11'), true)
check("pair('XX','KR-11') country shape ok", isValidRegionCountryPair('XX', 'KR-11'), true)
check("pair('kr','KR-11') lowercase rejected", isValidRegionCountryPair('kr', 'KR-11'), false)
check("pair('KOR','KR-11') 3-letter rejected", isValidRegionCountryPair('KOR', 'KR-11'), false)
check("pair('US','') country-only shape ok", isValidRegionCountryPair('US', ''), true)

// 지역 코드 모양 — 지도가 쓰는 값을 그대로 받는다. 좁게 잡으면 실제 나라가 통째로 막힌다.
check("shape('KR-11') ISO", isRegionCodeShape('KR-11'), true)
check("shape('AE-X01~') NE 임시코드", isRegionCodeShape('AE-X01~'), true)
check("shape('ES.CE') 점 표기(스페인)", isRegionCodeShape('ES.CE'), true)
check("shape('Est') 이름 그대로(부르키나파소)", isRegionCodeShape('Est'), true)
check("shape('') 빈 값 거절", isRegionCodeShape(''), false)
check("shape('a') 1글자 거절", isRegionCodeShape('a'), false)
check("shape('KR 11') 공백 거절", isRegionCodeShape('KR 11'), false)

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nall set-region validation checks passed')
