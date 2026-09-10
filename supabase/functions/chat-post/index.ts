// chat-post: 유사채팅 보드에 새 메시지 작성.
//  파이프라인(순서대로 short-circuit): 로그인 게이트 → 입력 검증 → 로컬 배드워드
//  → OpenAI 모더레이션 → **채팅 정지 검사** → chat_post_atomic RPC(레이트/중복/IP 가드).
//  ⚠️ 방 쓰기 권한(내 나라 + 전세계만)은 2026-08-04 해제됐다 — 어느 나라 방이든 로그인만 하면 쓴다.
//  ⚠️ 모더레이션 장애는 **기본이 fail-open** 이다(2026-09-10) — 글은 `pending` 으로 들어가 모두에게
//     보이고, 관리자 홈에 알림이 뜨고, 복구되면 `recheckPending` 이 곁다리로 다시 검사한다.
//  ⚠️ _shared 사용 → CLI 로만 배포할 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser, pickLang } from '../_shared/lib.ts'
import { checkBadword, normalizeKo } from '../_shared/badwords_ko.ts'
import { loadBannedWords } from '../_shared/banned-words.ts'
import { sha256Hex } from '../_shared/seb.ts'
import {
  CHAT_ALLOW_LINKS, CHAT_MOD_FAILCLOSED, clearModOutage, containsLink, moderateOpenAI,
  normalizeRoom, recheckPending, reportModOutage, resolvePoster, resolveIpHash,
} from '../_shared/chat.ts'

const MAX_LEN = 500

// 응답을 붙잡지 않고 뒤에서 돌린다(장애 알림·재검사). 응답 지연이 곧 채팅 체감이라 앞에 세우지 않는다.
//  ⚠️ `EdgeRuntime.waitUntil` 이 없는 환경(로컬·옛 런타임)에서도 그냥 뜬 채로 돌게 두고, 미처리
//     rejection 으로 함수가 죽지 않도록 catch 를 붙인다.
function bg(p: Promise<unknown>): void {
  const safe = p.catch(() => {})
  try {
    ;(globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(safe)
  } catch { /* waitUntil 이 없으면 그대로 둔다 */ }
}

// 복구 뒷정리(알림 닫기 + pending 재검사) 주기. 모듈 전역이라 **인스턴스당** 이 간격이다.
//  ⚠️ "장애를 본 적 있으면 그때만" 으로 만들면 안 된다 — 엣지는 인스턴스가 여럿이라 장애를 본
//     인스턴스와 복구 후 첫 글을 받는 인스턴스가 다를 수 있고, 그러면 pending 이 영영 안 풀린다.
//  ⚠️ 인스턴스 여럿이 겹쳐 돌아도 무해하다(같은 행을 ok 로 두 번 바꿔도 결과가 같다).
const SWEEP_MS = 60_000
let lastSweep = 0

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const user = await getUser(req)
    if (user == null) return json({ error: 'login_required' }, 401)
    // 게스트(익명 세션)는 못 쓴다 — 고정 규칙이다(_shared/chat.ts 머리말).
    if (user.is_anonymous) return json({ error: 'login_required' }, 401)

    const { body, lang, room: roomIn } = await req.json()
    const room = normalizeRoom(roomIn)
    const text = String(body ?? '').trim()
    if (!text) return json({ error: 'empty' }, 400)
    if (text.length > MAX_LEN) return json({ error: 'too_long' }, 400)

    if (!CHAT_ALLOW_LINKS && containsLink(text)) return json({ error: 'blocked_link' }, 422)

    const admin = adminClient()

    // 금칙어 = 코드 목록 + 관리자 등록분(`banned_words`, 60초 캐시).
    //   ⚠️ adminClient 가 필요해서 링크 검사보다 뒤에 있다 — 순서가 바뀌어도 결과는 같다(둘 다 422).
    //   ⚠️ OpenAI 모더레이션보다 **앞**이다. 로컬에서 거를 수 있는 글에 돈을 쓸 이유가 없다.
    if (checkBadword(text, await loadBannedWords(admin)).blocked) return json({ error: 'blocked_local' }, 422)
    // ⚠️ 프로필 조회와 모더레이션은 서로 결과를 안 쓴다(poster.name 은 아래 displayName 조립에만,
    //    moderateOpenAI 는 text 만 쓴다). 그리고 여기서 제일 오래 걸리는 건 **OpenAI 왕복**이라
    //    DB 조회를 그 뒤에 줄 세울 이유가 없다 — 같이 내보낸다.
    const [poster, mod] = await Promise.all([resolvePoster(admin, user.id), moderateOpenAI(text)])

    // 채팅 정지 — 내용과 무관하게 막는다. 읽기·시험·게임은 그대로고 **입력만** 잠긴다.
    //   ⚠️ 모더레이션과 **병렬로** 조회한 값을 쓴다. 정지 검사를 앞으로 빼면 OpenAI 왕복이 프로필
    //      조회 뒤로 밀려 정상 사용자 전원의 지연이 늘어난다 — 정지된 사람에게 나가는 모더레이션
    //      호출 한 번이 그보다 싸다(정지는 드물다).
    //   ⚠️ 차수·사유·다음 단계는 화면 안내에 필요해서 같이 내려준다. **사다리 숫자를 프론트에 두지
    //      않기 위해** 서버가 계산해 주는 것이다(단일 출처 = `chat_sanction_days()`).
    if (poster.suspendedUntil != null && new Date(poster.suspendedUntil).getTime() > Date.now()) {
      const { data: sanction } = await admin.rpc('chat_sanction_status', { p_user: user.id })
      return json({ error: 'suspended', sanction: sanction ?? { suspended: true, until: poster.suspendedUntil } }, 403)
    }

    let modStatus: 'ok' | 'pending' = 'ok'
    if (mod.status === 'flagged') return json({ error: 'blocked_mod' }, 422)
    if (mod.status === 'unavailable') {
      // fail-closed 로 돌려놓은 경우에만 막는다(기본은 fail-open — `_shared/chat.ts` 머리말).
      if (CHAT_MOD_FAILCLOSED) return json({ error: 'mod_unavailable' }, 503)
      // 검사를 못 했다는 표시로 pending. 노출은 되지만 복구 뒤 재검사 대상으로 남는다.
      modStatus = 'pending'
      bg(reportModOutage(admin))
    } else if (Date.now() - lastSweep > SWEEP_MS) {
      // 모더레이션이 답을 줬다 = 복구 신호. 열린 장애 알림을 닫고 밀린 pending 을 조금씩 훑는다.
      lastSweep = Date.now()
      bg(clearModOutage(admin).then(() => recheckPending(admin)))
    }

    const contentHash = await sha256Hex(normalizeKo(text))
    const ipHash = await resolveIpHash(req)
    const displayName = poster.name

    const { data, error } = await admin.rpc('chat_post_atomic', {
      p_user: user.id,
      p_ip_hash: ipHash,
      p_body: text,
      p_content_hash: contentHash,
      p_mod_status: modStatus,
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
      mod_status: modStatus,
    })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'error' }, 500)
  }
})
