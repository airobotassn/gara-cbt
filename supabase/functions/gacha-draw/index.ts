// gacha-draw: 서버권위 뽑기. 원자 SECURITY DEFINER RPC(gacha_draw)의 얇은 래퍼일 뿐.
//  - 차감→지급→로그 원자성/멱등(client_nonce)/천장/환급은 전부 DB 함수가 담당한다.
//  - cosmetic-only 하드 불변식: user_progress / user_level_skill 을 절대 만지지 않으며
//    _shared/scoring.ts(applyAttempt/computeRankChange)를 import 하지 않는다. lib.ts 에서 직접 가져온다.
// ⚠️ _shared 를 import 하므로 대시보드 편집 불가 → CLI 배포 전용: `supabase functions deploy gacha-draw`.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'

interface Body {
  pool_key?: string
  client_nonce?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    // (1) 인증: 로그인 필수 + 익명 유저 불가.
    const user = await getUser(req)
    if (!user || user.is_anonymous) return json({ error: 'unauthorized' }, 401)

    // (2) 입력. pool 기본 'default', nonce 는 멱등 키(필수).
    const body = (await req.json().catch(() => ({}))) as Body
    const pool_key = typeof body.pool_key === 'string' && body.pool_key ? body.pool_key : 'default'
    const client_nonce = typeof body.client_nonce === 'string' ? body.client_nonce : ''
    if (!client_nonce) return json({ error: 'invalid' }, 400)

    // (3) 원자 RPC. 포인트 부족은 plpgsql raise 'insufficient_points' → 402.
    const admin = adminClient()
    const { data, error } = await admin.rpc('gacha_draw', {
      p_uid: user.id,
      p_pool: pool_key,
      p_nonce: client_nonce,
    })
    if (error) {
      if (error.message && error.message.includes('insufficient_points')) {
        return json({ error: 'insufficient_points' }, 402)
      }
      return json({ error: 'server' }, 500)
    }

    return json(data, 200)
  } catch {
    return json({ error: 'server' }, 500)
  }
})
