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
}

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
    if (!isValidRegionCountryPair(country_code, region_code)) {
      return json({ error: 'invalid' }, 400)
    }

    // (3) 최초 1회만 잠금: region_locked_at IS NULL 인 행만 갱신.
    const admin = adminClient()
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
    if (!data || data.length === 0) return json({ error: 'already_locked' }, 409)

    return json({ ok: true, country_code, region_code }, 200)
  } catch {
    return json({ error: 'server' }, 500)
  }
})
