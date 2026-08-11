// payments-return: 엑심베이 결제창이 결과를 **POST 로** 던지는 자리. 받아서 결과 화면으로 넘겨준다.
//
// 왜 필요한가 — 우리 프론트는 정적 SPA 라 **GET 만** 페이지를 돌려준다. 엑심베이는 결제가 끝나면
//   return_url 로 폼 POST 를 하는데(문서가 말한 '쿼리스트링 형식'은 전송 방식이 아니라 **본문 모양**이었다),
//   그걸 /pay/success 로 곧장 받게 하면 개발서버·Cloudflare 둘 다 **404** 를 준다.
//   실제로 그렇게 만들었다가 겪었다(2026-08-11): 결제는 됐는데 화면은 "페이지를 찾을 수 없음".
//   그래서 POST 를 받아줄 수 있는 이 함수가 중간에 서서 303 으로 GET 리다이렉트를 걸어준다.
//
// ⚠️ **본문을 그대로 쿼리로 옮긴다.** 폼 POST 의 본문은 이미 쿼리스트링 모양이라 글자 그대로 붙이면 된다.
//    파싱해서 다시 조립하면 인코딩·순서가 달라져 **엑심베이 /verify 의 fgkey 검증이 깨진다**(그 검증이
//    "이 결과가 진짜인가"를 판정하는 유일한 수단이라, 깨지면 결제가 통째로 거절된다).
//
// ⚠️⚠️ 배포 — 이 함수는 `verify_jwt=false` 로 올려야 한다. 결제창에서 오는 브라우저 POST 라
//    Supabase JWT 가 실려 있지 않아 게이트웨이가 401 로 먼저 끊는다.
//      npx supabase functions deploy payments-return --no-verify-jwt
//    (route-seed · payments-webhook 에 이은 세 번째 예외다.)
//    시크릿을 안 건 이유 = 이 함수는 **아무것도 하지 않는다**. DB 도 안 보고 승인도 안 한다.
//    돌려보내기만 하고, 실제 판정(위변조 검증·승인·지급)은 결과 화면이 부르는 payments/confirm 이 한다.
import { corsHeaders } from '../_shared/cors.ts'

/**
 * 돌아갈 곳 — **화이트리스트로만** 연다. `to` 는 주소에 실려 오는 값이라 그대로 믿고 리다이렉트하면
 * 우리 도메인을 발판 삼아 아무 데나 보내는 오픈 리다이렉트가 된다(피싱 링크로 쓰인다).
 * 개발(로컬)과 배포 두 곳이면 충분하다.
 */
const ALLOWED_ORIGINS = [
  /^https:\/\/gara-cbt\.airobotassn\.workers\.dev$/,
  /^http:\/\/localhost:\d{2,5}$/,
  /^http:\/\/127\.0\.0\.1:\d{2,5}$/,
]

/** 목록에 없으면 배포 주소로 떨어뜨린다 — 결제는 이미 끝난 상태라 사용자를 빈손으로 두면 안 된다. */
const FALLBACK_ORIGIN = 'https://gara-cbt.airobotassn.workers.dev'

function safeOrigin(raw: string | null): string {
  const v = (raw ?? '').trim().replace(/\/$/, '')
  return ALLOWED_ORIGINS.some((re) => re.test(v)) ? v : FALLBACK_ORIGIN
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url = new URL(req.url)
  const origin = safeOrigin(url.searchParams.get('to'))

  // POST 면 본문이 결과다. GET 으로 오는 경우도 대비한다 — PG 설정·수단에 따라 갈릴 수 있고,
  // 어느 쪽이든 결과 화면이 받는 모양(주소 뒤 쿼리)은 같아야 한다.
  let payload = ''
  if (req.method === 'POST') {
    payload = (await req.text().catch(() => '')).trim()
  } else {
    // 우리가 붙인 `to` 는 결과가 아니므로 빼고 넘긴다.
    const p = new URLSearchParams(url.search)
    p.delete('to')
    payload = p.toString()
  }

  // 303 = "POST 는 끝났으니 이 주소를 GET 으로 받아라". 302 를 쓰면 브라우저가 POST 를 다시 보낼 수 있다.
  return new Response(null, {
    status: 303,
    headers: { ...corsHeaders, Location: `${origin}/pay/success${payload ? `?${payload}` : ''}` },
  })
})
