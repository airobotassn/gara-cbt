// chat-list: 유사채팅 보드 조회 — 공개 읽기(로그인 불필요, service role 로 읽음).
//  3가지 모드(우선순위 순): ids[] → reconcile(삭제/수정 tombstone), after → 폴링(신규분, 오름차순),
//  else(initial/before) → 커서 페이지(최신 limit개 내림차순 조회 후 오름차순으로 뒤집어 반환).
//  본문 게이트: mod_status='ok' 이거나 본인 글이면 노출, 아니면(pending/hidden 이며 타인) body=null.
//  reporter_id/ip_hash/content_hash 는 응답에 절대 포함하지 않는다.
//  ⚠️ _shared 사용 → CLI 로만 배포할 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'

const MSG_COLUMNS = 'id, user_id, display_name, is_anon, body, mod_status, edited_at, created_at, updated_at, deleted_at'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const user = await getUser(req)
    const caller = user?.id ?? null
    // mod_status='ok' 이거나 본인 글이면 노출(공개 아닌 글은 타인에게 행 자체를 안 보여줌).
    const visibilityFilter = caller != null ? `mod_status.eq.ok,user_id.eq.${caller}` : 'mod_status.eq.ok'

    const { after, before, limit, ids, since } = await req.json().catch(() => ({}))
    const admin = adminClient()

    if (Array.isArray(ids) && ids.length > 0) {
      const capped = ids.slice(0, 200)
      const sinceTs = typeof since === 'string' && since ? since : '1970-01-01T00:00:00Z'
      const { data, error } = await admin
        .from('chat_messages')
        .select('id, user_id, body, deleted_at, edited_at, mod_status, updated_at')
        .in('id', capped)
        .gt('updated_at', sinceTs)
      if (error) return json({ error: error.message }, 500)

      const tombstones = (data ?? []).map((r) => ({
        id: r.id,
        deleted_at: r.deleted_at,
        edited_at: r.edited_at,
        mod_status: r.mod_status,
        updated_at: r.updated_at,
        body: r.deleted_at == null && (r.mod_status === 'ok' || (caller != null && r.user_id === caller)) ? r.body : null,
      }))
      return json({ messages: [], tombstones })
    }

    if (typeof after === 'number' && Number.isFinite(after)) {
      const { data, error } = await admin
        .from('chat_messages')
        .select(MSG_COLUMNS)
        .is('deleted_at', null)
        .or(visibilityFilter)
        .gt('id', after)
        .order('id', { ascending: true })
        .limit(50)
      if (error) return json({ error: error.message }, 500)

      return json({ messages: (data ?? []).map(shapeRow) })
    }

    let query = admin
      .from('chat_messages')
      .select(MSG_COLUMNS)
      .is('deleted_at', null)
      .or(visibilityFilter)
      .order('id', { ascending: false })
      .limit(typeof limit === 'number' && limit > 0 ? Math.min(limit, 200) : 30)

    if (typeof before === 'number' && Number.isFinite(before)) {
      query = query.lt('id', before)
    }

    const { data, error } = await query
    if (error) return json({ error: error.message }, 500)

    return json({ messages: (data ?? []).reverse().map(shapeRow) })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'error' }, 500)
  }
})

type MsgRow = {
  id: number
  user_id: string | null
  display_name: string | null
  is_anon: boolean
  body: string | null
  mod_status: string
  edited_at: string | null
  created_at: string
  updated_at: string
}

function shapeRow(r: MsgRow) {
  return {
    id: r.id,
    user_id: r.user_id,
    display_name: r.display_name,
    is_anon: r.is_anon,
    body: r.body,
    mod_status: r.mod_status,
    edited_at: r.edited_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}
