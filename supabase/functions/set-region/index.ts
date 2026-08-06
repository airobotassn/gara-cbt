// set-region: 로그인 유저가 국가/지역(ISO 3166-2:KR 17 시도)을 최초 1회 확정(잠금)한다.
//  - region_locked_at 이 이미 있으면 재설정 불가(409). 학교(school_id)는 잠금 대상이 아니라 MyPage 에서 별도로 설정한다.
//  - 검증: region_code 는 _shared/regions.ts 화이트리스트(isValidRegion), country_code 는 ISO 3166-1 alpha-2 형식이며
//    ISO 3166-2 국가 접두어(KR-11 → KR)와 일치해야 한다(불일치 영구 락 방지).
// ⚠️ _shared 를 import 하므로 대시보드 편집 불가 → CLI 배포 전용: `supabase functions deploy set-region`.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/scoring.ts'
import { isValidRegionCountryPair } from '../_shared/regions.ts'

interface Body {
  country_code?: unknown
  region_code?: unknown
  age_band?: unknown
}

// 연령대 — 밴드만 받는다(생년월일·정확한 나이는 안 받는다). 'private' = 공개 안 함.
//   'private' 도 저장한다: null 로 두면 온보딩 게이트가 매번 다시 물어 거부 의사를 무시하게 된다.
//   DB check 제약(profiles_age_band_chk)과 같은 목록이라 한쪽만 늘리면 500 이 난다.
const AGE_BANDS = ['10s', '20s', '30s', '40s', '50s', '60s', 'private']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    // (1) 인증: 로그인 필수 + 익명 유저 불가.
    const user = await getUser(req)
    if (!user || user.is_anonymous) return json({ error: 'unauthorized' }, 401)

    // (2) 입력 검증. 국가·지역은 확정 시 영구 잠금이므로 교차검증까지 엄격히.
    //   region_code: ISO 3166-2 화이트리스트. country_code: ISO 3166-1 alpha-2 형식.
    //   교차검증: ISO 3166-2 는 국가 접두어를 품으므로(KR-11 → KR) country 는 region 접두어와 일치해야 함.
    //   (US+KR-11 같은 되돌릴 수 없는 불일치 방지). 학교는 잠금 대상이 아니라 MyPage 에서 별도 설정.
    const body = (await req.json().catch(() => ({}))) as Body
    const country_code = typeof body.country_code === 'string' ? body.country_code : ''
    const region_code = typeof body.region_code === 'string' ? body.region_code : ''
    const age_band = typeof body.age_band === 'string' ? body.age_band : ''
    if (!isValidRegionCountryPair(country_code, region_code)) {
      return json({ error: 'invalid' }, 400)
    }
    if (age_band && !AGE_BANDS.includes(age_band)) return json({ error: 'invalid' }, 400)

    const admin = adminClient()

    // (3) 연령대 — 지역 잠금과 **분리해서 먼저** 쓴다.
    //   지역은 최초 1회 잠금이라, 이미 잠근 유저(연령대만 비어 있는 기존 회원)에게 같은 update 로
    //   묶어 보내면 409 에 걸려 연령대가 영영 안 들어간다. 잠금 대상이 아니므로 따로 갱신한다.
    if (age_band) {
      await admin.from('profiles').update({ age_band }).eq('id', user.id)
    }

    // (4) 지역 — 최초 1회만 잠금: region_locked_at IS NULL 인 행만 갱신.
    const patch = {
      country_code,
      region_code,
      region_locked_at: new Date().toISOString(),
    }

    const { data, error } = await admin
      .from('profiles')
      .update(patch)
      .eq('id', user.id)
      .is('region_locked_at', null)
      .select()
    if (error) return json({ error: 'server' }, 500)
    // 이미 잠긴 경우에도 위 연령대 저장은 끝났다 → 프론트는 409 를 '확정됨'으로 보고 그대로 진행한다.
    if (!data || data.length === 0) return json({ error: 'already_locked' }, 409)

    return json({ ok: true, country_code, region_code, age_band: age_band || null }, 200)
  } catch {
    return json({ error: 'server' }, 500)
  }
})
