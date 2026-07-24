// chat-edit: 본인 메시지 수정(작성 10분 이내). 재검증(길이/배드워드/모더레이션) 후 본문·해시·mod_status 갱신.
//  소유권: 소유자 본인만 허용(관리자는 admin 라우터의 chatHide 로 숨김 처리 — 여기서 관리자 우회 편집은 지원 안 함).
//  ⚠️ _shared 사용 → CLI 로만 배포할 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'
import { checkBadword, normalizeKo } from '../_shared/badwords_ko.ts'
import { sha256Hex } from '../_shared/seb.ts'
import { CHAT_ALLOW_LINKS, CHAT_MOD_FAILCLOSED, CHAT_REQUIRE_LOGIN, containsLink, moderateOpenAI } from '../_shared/chat.ts'

const MAX_LEN = 500
const EDIT_WINDOW_MS = 10 * 60 * 1000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const user = await getUser(req)
    if (user == null) return json({ error: 'login_required' }, 401)
    if (CHAT_REQUIRE_LOGIN && user.is_anonymous) return json({ error: 'login_required' }, 401)

    const { message_id, body } = await req.json()
    const messageId = Number(message_id)
    if (!Number.isFinite(messageId)) return json({ error: 'not_found' }, 404)

    const admin = adminClient()
    const { data: row } = await admin
      .from('chat_messages')
      .select('id, user_id, created_at, deleted_at')
      .eq('id', messageId)
      .maybeSingle()
    if (!row || row.deleted_at != null) return json({ error: 'not_found' }, 404)
    // 소유자 전용 — 관리자 우회 편집 미지원(문서화된 선택: admin 라우터는 hide/unhide/approve 로만 개입).
    if (row.user_id !== user.id) return json({ error: 'forbidden' }, 403)

    const createdAt = new Date(row.created_at).getTime()
    if (Date.now() - createdAt > EDIT_WINDOW_MS) return json({ error: 'edit_window' }, 409)

    const text = String(body ?? '').trim()
    if (!text) return json({ error: 'empty' }, 400)
    if (text.length > MAX_LEN) return json({ error: 'too_long' }, 400)
    if (checkBadword(text).blocked) return json({ error: 'blocked_local' }, 422)
    if (!CHAT_ALLOW_LINKS && containsLink(text)) return json({ error: 'blocked_link' }, 422)

    const mod = await moderateOpenAI(text)
    let modStatus: 'ok' | 'pending' = 'ok'
    if (mod.status === 'flagged') return json({ error: 'blocked_mod' }, 422)
    if (mod.status === 'unavailable') {
      if (CHAT_MOD_FAILCLOSED) return json({ error: 'mod_unavailable' }, 503)
      modStatus = 'pending'
      await admin.from('chat_incidents').insert({ kind: 'mod_unavailable' })
    }

    const contentHash = await sha256Hex(normalizeKo(text))
    const nowIso = new Date().toISOString()
    const { error } = await admin
      .from('chat_messages')
      .update({ body: text, content_hash: contentHash, mod_status: modStatus, edited_at: nowIso, updated_at: nowIso })
      .eq('id', messageId)
    if (error) return json({ error: error.message }, 500)

    return json({ ok: true, id: messageId, edited_at: nowIso, updated_at: nowIso, mod_status: modStatus })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'error' }, 500)
  }
})
