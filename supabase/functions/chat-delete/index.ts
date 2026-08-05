// chat-delete: 본인 메시지 소프트 삭제(deleted_at). 관리자 강제 숨김은 admin 라우터의 chatHide 사용.
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

    const { message_id } = await req.json()
    const messageId = Number(message_id)
    if (!Number.isFinite(messageId)) return json({ error: 'not_found' }, 404)

    const admin = adminClient()
    const { data: row } = await admin
      .from('chat_messages')
      .select('id, user_id, deleted_at')
      .eq('id', messageId)
      .maybeSingle()
    if (!row || row.deleted_at != null) return json({ error: 'not_found' }, 404)
    if (row.user_id !== user.id) return json({ error: 'forbidden' }, 403)

    const nowIso = new Date().toISOString()
    // hidden_by='self' — 관리자 강제 숨김(chatHide 의 'admin')과 구분한다.
    // 이 표식이 없으면 관리자 화면의 '숨김 해제'가 **사용자가 스스로 지운 글을 되살린다**(2026-08-05 수정).
    const { error } = await admin
      .from('chat_messages')
      .update({ deleted_at: nowIso, updated_at: nowIso, hidden_by: 'self' })
      .eq('id', messageId)
    if (error) return json({ error: error.message }, 500)

    return json({ ok: true })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'error' }, 500)
  }
})
