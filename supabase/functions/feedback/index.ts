// feedback: 의견함 접수 — FAB 의 빨간 '의견 보내기' → /feedback 페이지가 부르는 유일한 경로.
//
//  ⚠️ **로그인이 필요 없다.** callFunction 이 세션이 없으면 Authorization 에 anon 키를 실으므로
//     verify_jwt 는 통과하고, getUser() 가 null 을 준다. 그래서 이 함수는 `--no-verify-jwt` 로
//     배포하면 안 된다 — 지금 그대로(플래그 없이) 올리는 게 맞다.
//  ⚠️ 로그인 상태면 계정도 같이 적는다. 다만 소속·이름은 **계정에서 끌어오지 않는다** —
//     본인이 적은 값이 이 기능의 답이다(닉네임과 실제 소속·이름은 다른 물건이다).
//  ⚠️ 가드(도배·중복)는 전부 feedback_post RPC 안에 있다. 여기서 세지 말 것 — 동시 요청에서 샌다.
//  ⚠️ _shared 사용 → CLI 로만 배포할 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'
import { resolveIpHash } from '../_shared/chat.ts'

// DB CHECK 과 같은 값이다 — 한쪽만 고치면 화면은 통과시킨 글이 저장에서 터진다.
const LIMITS = { org: 60, name: 40, path: 200, body: 4000 } as const

/** 한 줄 입력값 정리 — 줄바꿈까지 포함한 모든 공백을 한 칸으로 접고 앞뒤를 턴다.
 *  (한 줄 칸에 여러 줄이 붙어 오면 관리자 표에서 행 높이가 통째로 무너진다.) */
function oneLine(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const raw = await req.json().catch(() => ({}))
    const org = oneLine(raw?.org)
    const name = oneLine(raw?.name)
    const path = oneLine(raw?.path)
    // 내용만 줄바꿈을 살린다(문단으로 적는 칸이라).
    const body = String(raw?.body ?? '').replace(/\r\n/g, '\n').trim()

    // 빈 칸·길이는 사유를 갈라서 준다 — 어느 칸이 문제인지 화면이 짚어줘야 한다.
    for (const [k, v] of [['org', org], ['name', name], ['path', path], ['body', body]] as const) {
      if (!v) return json({ error: 'empty', field: k }, 400)
      if (v.length > LIMITS[k]) return json({ error: 'too_long', field: k, max: LIMITS[k] }, 400)
    }

    // 익명 세션(게스트)은 계정으로 치지 않는다 — 지우면 새로 생기는 값이라 작성자 근거가 못 된다.
    const user = await getUser(req)
    const userId = user && !user.is_anonymous ? user.id : null

    const admin = adminClient()
    const { data, error } = await admin.rpc('feedback_post', {
      p_user: userId,
      p_ip_hash: await resolveIpHash(req),
      p_org: org,
      p_name: name,
      p_path: path,
      p_body: body,
    })
    if (error) {
      // RPC 가 던지는 사유는 하나뿐이다(도배). 나머지는 진짜 장애다.
      if (String(error.message ?? '').includes('too_many')) return json({ error: 'too_many' }, 429)
      return json({ error: error.message }, 500)
    }
    return json({ ok: true, id: data })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unknown' }, 500)
  }
})
