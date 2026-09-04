// set-region: 로그인 유저가 국가/지역을 최초 1회 확정(잠금)하고, 그 뒤 **평생 1회** 바꾼다.
//  - region_locked_at 이 이미 있으면 재설정 불가(409).
//  - `action:'change'` = 마이페이지의 1회 변경. 판정·쓰기는 RPC change_region_once 한 문장이 한다
//    (국가·지역은 enforce_region_lock 트리거가 막고 있어 service role 로도 직접 못 고친다).
//  - 검증: country_code 는 ISO 3166-1 alpha-2 형식(전 세계). 지역은 **regions 테이블이 정답지**다 —
//    그 코드가 실재하고 그 나라 것이어야 하며, 지역이 있는 나라에서 지역을 비우면 거절한다.
//    ⚠️ 지역 코드 3,504개를 소스에 복제하지 않는다(지도 파일 public/geo/adm1 에서 뽑아 DB 에 넣었다).
// ⚠️ _shared 를 import 하므로 대시보드 편집 불가 → CLI 배포 전용: `supabase functions deploy set-region`.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/scoring.ts'
import { isValidRegionCountryPair } from '../_shared/regions.ts'

interface Body {
  country_code?: unknown
  region_code?: unknown
  age_band?: unknown
  /** 'change' = 마이페이지의 **1회 변경**(확정 이후). 없으면 온보딩의 최초 확정. */
  action?: unknown
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

    // (2-a) 지역 실재 확인 — **정답지는 regions 테이블 하나**다(지도 파일에서 뽑아 넣은 3,504개).
    //   ⚠️ 코드가 그 나라 것인지까지 본다. 안 보면 스페인 사람이 'KR-11' 을 실어 보내 서울 순위에 섞인다
    //      (FK 는 "실재하는 코드"만 보장하지 "그 나라 코드"인지는 모른다).
    //   ⚠️ 지역을 안 골랐으면, 그 나라에 **정말 지역이 없는지** 되묻는다. 이게 없으면 사우디 사람이
    //      지역 없이 확정해버리고, 아레나에서 자기 나라 주 랭킹을 보면서 영영 거기 못 들어간다.
    if (region_code) {
      const { data: reg } = await admin
        .from('regions').select('code').eq('code', region_code).eq('country_code', country_code).maybeSingle()
      if (!reg) return json({ error: 'invalid' }, 400)
    } else {
      const { count } = await admin
        .from('regions').select('code', { count: 'exact', head: true }).eq('country_code', country_code)
      if (count) return json({ error: 'region_required' }, 400)
    }

    // (2-b) 마이페이지 1회 변경 — 확정 이후 경로. 검증은 위와 **같은 술어**를 지나왔다.
    //   ⚠️ 여기서 직접 update 하면 안 된다: 국가·지역은 enforce_region_lock 트리거가 막고 있어서
    //      service role 로도 통과 못 한다. 1회 판정까지 한 문장에 담은 RPC 로만 쓴다.
    if (body.action === 'change') {
      const { data, error } = await admin.rpc('change_region_once', {
        p_uid: user.id, p_country: country_code, p_region: region_code || null,
      })
      if (error) return json({ error: 'server' }, 500)
      // 'unavailable' = 아직 확정 전이거나 변경권을 이미 썼다. 둘 다 이 경로로는 할 일이 없다.
      if (data !== 'ok') return json({ error: 'change_unavailable' }, 409)
      return json({ ok: true, country_code, region_code: region_code || null }, 200)
    }

    // (3) 연령대 — 지역 잠금과 **분리해서 먼저** 쓴다.
    //   지역은 최초 1회 잠금이라, 이미 잠근 유저(연령대만 비어 있는 기존 회원)에게 같은 update 로
    //   묶어 보내면 409 에 걸려 연령대가 영영 안 들어간다. 잠금 대상이 아니므로 따로 갱신한다.
    if (age_band) {
      await admin.from('profiles').update({ age_band }).eq('id', user.id)
    }

    // (4) 지역 — 최초 1회만 잠금: region_locked_at IS NULL 인 행만 갱신.
    //   ⚠️ 지역 목록이 없는 나라는 region_code 가 빈 문자열로 온다 → **null 로 저장**한다.
    //      ''(빈 문자열)를 그대로 넣으면 regions FK 위반으로 확정 자체가 실패한다.
    const patch = {
      country_code,
      region_code: region_code || null,
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

    return json({ ok: true, country_code, region_code: region_code || null, age_band: age_band || null }, 200)
  } catch {
    return json({ error: 'server' }, 500)
  }
})
