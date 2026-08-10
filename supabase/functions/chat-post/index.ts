// chat-post: 유사채팅 보드에 새 메시지 작성.
//  파이프라인(순서대로 short-circuit): 로그인 게이트 → 입력 검증 → 로컬 배드워드
//  → OpenAI 모더레이션 → (fail-closed 기본) 모더레이션 장애 시 503으로 즉시 중단, 삽입 없음
//  → chat_post_atomic RPC(레이트/중복/IP 가드).
//  ⚠️ 방 쓰기 권한(내 나라 + 전세계만)은 2026-08-04 해제됐다 — 어느 나라 방이든 로그인만 하면 쓴다.
//  ⚠️ _shared 사용 → CLI 로만 배포할 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser, pickLang } from '../_shared/lib.ts'
import { checkBadword, normalizeKo } from '../_shared/badwords_ko.ts'
import { sha256Hex } from '../_shared/seb.ts'
import { CHAT_ALLOW_LINKS, CHAT_MOD_FAILCLOSED, CHAT_REQUIRE_LOGIN, containsLink, moderateOpenAI, normalizeRoom, resolvePoster, resolveIpHash } from '../_shared/chat.ts'

const MAX_LEN = 500

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const user = await getUser(req)
    if (user == null) return json({ error: 'login_required' }, 401)
    if (CHAT_REQUIRE_LOGIN && user.is_anonymous) return json({ error: 'login_required' }, 401)

    const { body, lang, room: roomIn } = await req.json()
    const room = normalizeRoom(roomIn)
    const text = String(body ?? '').trim()
    if (!text) return json({ error: 'empty' }, 400)
    if (text.length > MAX_LEN) return json({ error: 'too_long' }, 400)

    if (checkBadword(text).blocked) return json({ error: 'blocked_local' }, 422)
    if (!CHAT_ALLOW_LINKS && containsLink(text)) return json({ error: 'blocked_link' }, 422)

    const admin = adminClient()
    const isAnon = !!user.is_anonymous
    const poster = await resolvePoster(admin, user.id)

    const mod = await moderateOpenAI(text)
    let modStatus: 'ok' | 'pending' = 'ok'
    if (mod.status === 'flagged') return json({ error: 'blocked_mod' }, 422)
    if (mod.status === 'unavailable') {
      if (CHAT_MOD_FAILCLOSED) return json({ error: 'mod_unavailable' }, 503)
      // fail-open(B1 토글): pending 으로 게시 + 미결(open) 장애 기록을 남겨 관리자가 추적.
      modStatus = 'pending'
      await admin.from('chat_incidents').insert({ kind: 'mod_unavailable' })
    }

    const contentHash = await sha256Hex(normalizeKo(text))
    const ipHash = await resolveIpHash(req)
    const displayName = isAnon ? `익명#${user.id.slice(0, 4)}` : poster.name

    const { data, error } = await admin.rpc('chat_post_atomic', {
      p_user: user.id,
      p_ip_hash: ipHash,
      p_body: text,
      p_content_hash: contentHash,
      p_mod_status: modStatus,
      p_is_anon: isAnon,
      p_display_name: displayName,
      p_lang: pickLang(lang),
      p_room: room,
    })
    if (error) {
      const msg = error.message ?? ''
      if (msg.includes('too_fast') || msg.includes('rate_limited') || msg.includes('ip_floor')) {
        return json({ error: msg.includes('too_fast') ? 'too_fast' : msg.includes('ip_floor') ? 'ip_floor' : 'rate_limited' }, 429)
      }
      if (msg.includes('duplicate')) return json({ error: 'duplicate' }, 409)
      return json({ error: msg || 'error' }, 500)
    }

    const row = data?.[0]
    if (!row) return json({ error: 'error' }, 500)
    return json({
      id: row.id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      display_name: displayName,
      is_anon: isAnon,
      mod_status: modStatus,
    })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'error' }, 500)
  }
})
