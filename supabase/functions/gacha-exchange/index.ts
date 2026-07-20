// gacha-exchange: 가루(dust)로 뽑기 전용 한정템을 지정 확정 교환. 원자 RPC(gacha_exchange) 얇은 래퍼.
//  - 차감→지급→로그 원자성/멱등(client_nonce)/가격 권위는 전부 DB 함수가 담당한다.
//  - cosmetic-only 하드 불변식: user_progress / user_level_skill 을 절대 만지지 않는다.
// ⚠️ _shared 를 import 하므로 대시보드 편집 불가 → CLI 배포 전용: `supabase functions deploy gacha-exchange`.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'

interface Body {
  part_key?: string
  client_nonce?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    // (1) 인증: 로그인 필수 + 익명 불가.
    const user = await getUser(req)
    if (!user || user.is_anonymous) return json({ error: 'unauthorized' }, 401)

    // (2) 입력. part_key/nonce 필수.
    const body = (await req.json().catch(() => ({}))) as Body
    const part_key = typeof body.part_key === 'string' ? body.part_key : ''
    const client_nonce = typeof body.client_nonce === 'string' ? body.client_nonce : ''
    if (!part_key || !client_nonce) return json({ error: 'invalid' }, 400)

    // (3) 원자 RPC. plpgsql raise 매핑.
    const admin = adminClient()
    const { data, error } = await admin.rpc('gacha_exchange', {
      p_uid: user.id,
      p_part: part_key,
      p_nonce: client_nonce,
    })
    if (error) {
      const m = error.message ?? ''
      if (m.includes('insufficient_dust')) return json({ error: 'insufficient_dust' }, 402)
      if (m.includes('already_owned')) return json({ error: 'already_owned' }, 409)
      if (m.includes('invalid_part')) return json({ error: 'invalid_part' }, 400)
      return json({ error: 'server' }, 500)
    }

    return json(data, 200)
  } catch {
    return json({ error: 'server' }, 500)
  }
})
