// chat-list: 유사채팅 보드 조회 — 공개 읽기(로그인 불필요, service role 로 읽음).
//  3가지 모드(우선순위 순): ids[] → reconcile(삭제/수정 tombstone), after → 폴링(신규분, 오름차순),
//  else(initial/before) → 커서 페이지(최신 limit개 내림차순 조회 후 오름차순으로 뒤집어 반환).
//  방(room): 목록·폴링은 항상 한 방으로 좁힌다(기본 전세계). 읽기는 방 제한이 없다 — 남의 나라 방도 볼 수 있다.
//  reconcile 만 방 조건이 없다(PK 조회이고, 클라는 자기가 띄운 방의 id 만 보낸다).
//  본문 게이트: mod_status='ok' 이거나 본인 글이면 노출, 아니면(pending/hidden 이며 타인) body=null.
//  reporter_id/ip_hash/content_hash 는 응답에 절대 포함하지 않는다.
//  익명 글은 user_id 도 안 내보낸다(shapeRow) — 아바타·국기를 가려놓고 uuid 를 주면,
//    같은 uuid 를 가진 실명 글과 대조해 익명 배지를 통째로 무력화할 수 있다.
//  ⚠️ _shared 사용 → CLI 로만 배포할 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'
import { normalizeRoom } from '../_shared/chat.ts'

const MSG_COLUMNS = 'id, user_id, display_name, is_anon, body, mod_status, edited_at, created_at, updated_at, deleted_at'

type ShapedRow = ReturnType<typeof shapeRow>

// 작성자 프로필(이름·아바타·국가)을 한 번의 조회로 붙인다 — 이름 왼쪽 프로필, 오른쪽 국기용.
//  · 익명 글에는 붙이지 않는다. 익명 배지를 달아놓고 아바타·국기를 노출하면 익명성이 무너진다.
//  · 국가 미등록(country_code=null)이면 null 그대로 — 화면이 국기를 렌더하지 않는다.
//  · profiles 는 메시지 수와 무관하게 작성자 수만큼만 조회한다(N+1 방지).
//  ⚠️ 이름은 저장된 스냅샷이 아니라 **지금 닉네임**으로 덮는다. `chat_messages.display_name` 은 글 쓸 때
//     찍힌 텍스트라, 닉네임을 바꾸면(1회 변경 가능 — `profiles.nickname_changed_at`) 옛 글이 옛 이름으로
//     남는다. 닉네임은 유니크라 놓은 이름을 남이 가져갈 수 있고, 코인 선물이 **닉네임 지목**이라
//     채팅에서 본 이름으로 보내면 엉뚱한 사람에게 간다(되돌릴 수 없는 이체).
//     그래도 스냅샷은 지우지 않는다 — 관리자 신고 검수가 보는 '그때 이름' 이고, 여기 폴백이기도 하다.
async function attachProfiles(
  admin: ReturnType<typeof adminClient>,
  rows: ShapedRow[],
): Promise<(ShapedRow & { avatar_url: string | null; country_code: string | null })[]> {
  const ids = [...new Set(rows.filter((r) => !r.is_anon && r.user_id).map((r) => r.user_id as string))]
  const byId = new Map<string, { display_name: string | null; avatar_url: string | null; country_code: string | null }>()
  if (ids.length > 0) {
    const { data } = await admin.from('profiles').select('id, display_name, avatar_url, country_code').in('id', ids)
    for (const p of data ?? []) {
      byId.set(p.id, { display_name: p.display_name, avatar_url: p.avatar_url, country_code: p.country_code })
    }
  }
  return rows.map((r) => {
    const p = r.is_anon || !r.user_id ? undefined : byId.get(r.user_id)
    // 프로필이 없거나(탈퇴) 이름이 비면 스냅샷 그대로 — 이름 없는 줄을 만들지 않는다.
    const now = (p?.display_name ?? '').trim()
    return {
      ...r,
      display_name: now || r.display_name,
      avatar_url: p?.avatar_url ?? null,
      country_code: p?.country_code ?? null,
    }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const user = await getUser(req)
    const caller = user?.id ?? null
    // mod_status='ok' 이거나 본인 글이면 노출(공개 아닌 글은 타인에게 행 자체를 안 보여줌).
    const visibilityFilter = caller != null ? `mod_status.eq.ok,user_id.eq.${caller}` : 'mod_status.eq.ok'

    const { after, before, limit, ids, since, room: roomIn } = await req.json().catch(() => ({}))
    const room = normalizeRoom(roomIn)
    const admin = adminClient()

    // ── 폴링(after) + reconcile(ids+since) ──────────────────────────────
    // 둘을 **한 요청으로** 받는다(2026-08-25). 화면은 4초마다 이 두 가지를 묻는데, 예전엔 함수를
    // 두 번 따로 불렀다 — 그것도 첫 답을 받고서야 두 번째를 물어서, 접속자 1명당 분당 30왕복이었다.
    // 두 조회는 서로의 결과를 인자로 쓰지 않으므로 여기서 동시에 던지고 한 응답에 담는다.
    //   ⚠️ 셋 다 지원한다 — after 만(옛 폴링) · ids 만(옛 reconcile) · 둘 다(지금 폴링).
    //      응답 모양은 예전과 같아서(`messages`·`tombstones`) 옛 화면이 그대로 돌아간다.
    //   ⚠️ reconcile 은 방 조건이 없다 — PK 조회이고 클라는 자기가 띄운 방의 id 만 보낸다(위 머리말).
    const wantAfter = typeof after === 'number' && Number.isFinite(after)
    const wantIds = Array.isArray(ids) && ids.length > 0
    if (wantAfter || wantIds) {
      const sinceTs = typeof since === 'string' && since ? since : '1970-01-01T00:00:00Z'
      const [msgRes, tombRes] = await Promise.all([
        wantAfter
          ? admin
              .from('chat_messages')
              .select(MSG_COLUMNS)
              .eq('room', room)
              .is('deleted_at', null)
              .or(visibilityFilter)
              .gt('id', after)
              .order('id', { ascending: true })
              .limit(50)
          : Promise.resolve(null),
        wantIds
          ? admin
              .from('chat_messages')
              .select('id, user_id, body, deleted_at, edited_at, mod_status, updated_at')
              .in('id', ids.slice(0, 200))
              .gt('updated_at', sinceTs)
          : Promise.resolve(null),
      ])
      if (msgRes?.error) return json({ error: msgRes.error.message }, 500)
      if (tombRes?.error) return json({ error: tombRes.error.message }, 500)

      const messages = msgRes ? await attachProfiles(admin, (msgRes.data ?? []).map(shapeRow)) : []
      const tombstones = (tombRes?.data ?? []).map((r) => ({
        id: r.id,
        deleted_at: r.deleted_at,
        edited_at: r.edited_at,
        mod_status: r.mod_status,
        updated_at: r.updated_at,
        body: r.deleted_at == null && (r.mod_status === 'ok' || (caller != null && r.user_id === caller)) ? r.body : null,
      }))
      return json({ messages, tombstones })
    }

    let query = admin
      .from('chat_messages')
      .select(MSG_COLUMNS)
      .eq('room', room)
      .is('deleted_at', null)
      .or(visibilityFilter)
      .order('id', { ascending: false })
      .limit(typeof limit === 'number' && limit > 0 ? Math.min(limit, 200) : 30)

    if (typeof before === 'number' && Number.isFinite(before)) {
      query = query.lt('id', before)
    }

    const { data, error } = await query
    if (error) return json({ error: error.message }, 500)

    return json({ messages: await attachProfiles(admin, (data ?? []).reverse().map(shapeRow)) })
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
    // ⚠️ 익명 글은 uuid 를 내보내지 않는다. 아바타 시드를 'anon' 으로 고정하고 국기를 뺀 이유와 같다 —
    //    uuid 가 있으면 같은 사람의 실명 글과 대조해 익명 글을 전부 이어붙일 수 있다.
    //    본문 노출 판정(본인 pending 글)은 서버 쿼리가 하므로 화면은 이 값이 없어도 된다.
    user_id: r.is_anon ? null : r.user_id,
    display_name: r.display_name,
    is_anon: r.is_anon,
    body: r.body,
    mod_status: r.mod_status,
    edited_at: r.edited_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}
