// chat-report: 메시지 신고 — 1인 1신고(message_id, reporter_id 유니크). 대상 메시지 존재 확인.
//  신고가 CHAT_AUTO_HIDE_REPORTS 명 이상 쌓이면 **관리자 손 없이 즉시 채팅창에서 내린다**
//  (mod_status='auto_hidden' → chat-list 의 'ok' 게이트에 걸려 타인에게 안 보이고 작성자에게만 남는다).
//  ⚠️ 응답은 자동 가림 여부를 알려주지 않는다 — 신고자에게 "몇 명 더 모으면 내려간다"를 노출하면
//     그 수를 맞추려는 조직적 신고를 유도한다.
//  ⚠️ _shared 사용 → CLI 로만 배포할 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'
import { CHAT_AUTO_HIDE_REPORTS, CHAT_REQUIRE_LOGIN, MOD_AUTO_HIDDEN } from '../_shared/chat.ts'

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
    const { data: row } = await admin
      .from('chat_messages')
      .select('id, mod_status, deleted_at')
      .eq('id', messageId)
      .maybeSingle()
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

    // 자동 가림 — 이미 내려간 글(deleted/ok 아님)은 다시 손대지 않는다.
    // 관리자가 '문제없음'으로 풀어준 글이 신고 한 건 더 들어왔다고 또 내려가면 판정이 뒤집히므로,
    // 여기서는 열린 신고만 세고 무효 처리된 신고는 제외한다.
    if (row.deleted_at == null && row.mod_status === 'ok') {
      const { count } = await admin
        .from('chat_reports')
        .select('id', { count: 'exact', head: true })
        .eq('message_id', messageId)
        .eq('status', 'open')
      if ((count ?? 0) >= CHAT_AUTO_HIDE_REPORTS) {
        await admin
          .from('chat_messages')
          .update({ mod_status: MOD_AUTO_HIDDEN, updated_at: new Date().toISOString() })
          .eq('id', messageId)
      }
    }

    return json({ ok: true })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'error' }, 500)
  }
})
