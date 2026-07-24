// chat-report: 메시지 신고 — 1인 1신고(message_id, reporter_id 유니크). 대상 메시지 존재 확인.
//  ⚠️ _shared 사용 → CLI 로만 배포할 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'
import { CHAT_REQUIRE_LOGIN } from '../_shared/chat.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const user = await getUser(req)
    if (user == null) return json({ error: 'login_required' }, 401)
    if (CHAT_REQUIRE_LOGIN && user.is_anonymous) return json({ error: 'login_required' }, 401)

    const { message_id, reason } = await req.json()
    const messageId = Number(message_id)
    if (!Number.isFinite(messageId)) return json({ error: 'not_found' }, 404)

    const admin = adminClient()
    const { data: row } = await admin.from('chat_messages').select('id').eq('id', messageId).maybeSingle()
    if (!row) return json({ error: 'not_found' }, 404)

    const { error } = await admin.from('chat_reports').insert({
      message_id: messageId,
      reporter_id: user.id,
      reason: reason ? String(reason).slice(0, 500) : null,
      status: 'open',
    })
    if (error) {
      if ((error as { code?: string }).code === '23505') return json({ error: 'duplicate' }, 409)
      return json({ error: error.message }, 500)
    }

    return json({ ok: true })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'error' }, 500)
  }
})
