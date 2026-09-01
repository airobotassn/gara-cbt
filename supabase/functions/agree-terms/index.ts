// agree-terms — 약관·연령 동의(필수) + 광고·마케팅 수신 동의(선택)를 계정에 남긴다.
//                동의 게이트(`/onboarding/terms`)가 부르는 유일한 곳.
//
// ⛔ **두 동의를 한 값으로 합치지 말 것.** 광고 수신 동의는 서비스 이용의 조건이 될 수 없다 —
//    거부해도 서비스를 다 쓸 수 있어야 하므로 컬럼도 체크박스도 끝까지 분리해서 다닌다.
//
// ⛔ **브라우저가 profiles 를 직접 못 쓴다.** `profiles` 는 UPDATE 를 회수하고 허용 컬럼만 다시 부여하는
//    화이트리스트라 `terms_agreed_at` 은 service role 전용이다. 그래서 이 함수가 필요하다 —
//    클라가 직접 쓰게 열어주면 체크박스를 안 누르고도 자기 동의를 써넣을 수 있다.
// ⛔ 익명(게스트) 사용자는 대상이 아니다. 개인정보를 남기지 않으므로 받을 동의도 없다.
// ⚠️ `TERMS_VERSION` 은 화면(`src/lib/consent.ts`)과 **글자까지 같아야** 한다 — 한쪽만 올리면
//    전원이 매번 다시 동의하거나(화면만 올림) 아무도 안 물어보게 된다(서버만 올림).
// ⚠️ _shared 를 import 하므로 CLI 배포 전용: `supabase functions deploy agree-terms` (플래그 없이).
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'

/** 지금 시행 중인 약관 버전. 약관을 고치면 이 값을 올리고 화면 쪽 상수도 같이 올린다. */
const TERMS_VERSION = '2026-08-31'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const user = await getUser(req)
    if (!user || user.is_anonymous) return json({ error: 'unauthorized' }, 401)

    // 광고·마케팅 수신 동의(선택). 체크 안 했으면 null 이 그대로 남는다.
    // ⛔ **기본값을 true 로 두지 말 것.** 안 보낸 요청(옛 배포본 화면)이 동의로 둔갑한다 —
    //    정보통신망법 §50 은 명시적 동의를 요구하므로 "안 밝힌 것"은 미동의여야 한다.
    // ⚠️ 값을 **boolean 그대로 넣지 않고 시각으로 바꿔** 담는다. 2년마다 수신동의를 재확인해야 해서
    //    (§50⑧) "언제 동의했나"가 필요하고, 분쟁 시 입증 책임도 우리에게 있다.
    let marketing = false
    try {
      const body = await req.json()
      marketing = body?.marketing === true
    } catch { /* 본문 없음 = 미동의 */ }

    const now = new Date().toISOString()
    const admin = adminClient()
    const { error } = await admin
      .from('profiles')
      .update({
        terms_agreed_at: now,
        terms_version: TERMS_VERSION,
        // ⚠️ 체크를 풀었으면 **null 로 덮는다.** 안 덮으면 재동의 화면에서 체크를 해제해도
        //    옛 동의 시각이 남아 계속 수신 대상이 된다(= 철회가 안 먹는다).
        marketing_agreed_at: marketing ? now : null,
      })
      .eq('id', user.id)
    if (error) return json({ error: error.message }, 500)

    return json({ ok: true, version: TERMS_VERSION, marketing })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
