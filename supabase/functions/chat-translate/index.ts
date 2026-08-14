// chat-translate: 채팅 번역 — 창고 조회 → 없는 것만 번역 → 창고에 저장.
//
//  액션 셋.
//   · (기본)   사용자가 번역 토글을 켰을 때. 창고 우선, 미스분만 서버 엔진(Azure → 구글 → 포기).
//   · pending  엣지 워커가 "번역할 것" 목록을 받아간다.
//   · store    엣지 워커가 번역 결과를 되돌려준다.
//
//  ⚠️ 워커에 로직을 두지 않는 게 이 파일의 요점이다. 워커는 브라우저를 굴리기만 하고
//     '무엇을 번역할지'·'무엇을 저장할지'는 전부 여기서 정한다. 그래야 나중에 백엔드를
//     Spring 으로 옮길 때 이 함수 하나만 다시 쓰면 되고 워커는 손대지 않는다.
//
//  ⚠️ 대상 언어를 요청으로 받지 않는다 — profiles.country_code 에서 파생한다.
//     요청으로 받으면 언어를 바꿔가며 (방 × 언어) 조합을 무한히 만드는 길이 열린다.
//     그게 이 기능에서 비용이 폭발하는 유일한 경로다(country-lang.ts 머리 주석 참고).
//
//  ⚠️ _shared 사용 → CLI 로만 배포할 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'
import { CHAT_REQUIRE_LOGIN, normalizeRoom } from '../_shared/chat.ts'
import { langForCountry, sameLang } from '../_shared/country-lang.ts'
import { isTranslatable, translateBatch, type TranslateItem } from '../_shared/translate.ts'

const MAX_IDS = 200

type Admin = ReturnType<typeof adminClient>

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const payload = await req.json().catch(() => ({}))
    const action = String(payload?.action ?? 'translate')

    if (action === 'pending' || action === 'store') {
      const key = Deno.env.get('TRANSLATE_WORKER_KEY')
      // 키를 안 걸어놨으면 워커 경로 자체를 닫는다 — 빈 문자열 비교로 열리면 안 된다.
      if (!key || req.headers.get('x-translate-worker-key') !== key) {
        return json({ error: 'forbidden' }, 403)
      }
      const admin = adminClient()
      return action === 'pending' ? await handlePending(admin, payload) : await handleStore(admin, payload)
    }

    return await handleTranslate(req, payload)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'error' }, 500)
  }
})

// ── 사용자 요청 ────────────────────────────────────────────
async function handleTranslate(req: Request, payload: Record<string, unknown>): Promise<Response> {
  const user = await getUser(req)
  if (user == null) return json({ error: 'login_required' }, 401)
  if (CHAT_REQUIRE_LOGIN && user.is_anonymous) return json({ error: 'login_required' }, 401)

  const admin = adminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('country_code')
    .eq('id', user.id)
    .maybeSingle()

  const lang = langForCountry(profile?.country_code)
  // 국가 미설정 — 온보딩으로 보내라는 기계 코드다. 프론트가 이걸 보고 라우팅한다.
  if (!lang) return json({ error: 'country_required' }, 409)

  const room = normalizeRoom(payload?.room)
  const idsIn = Array.isArray(payload?.ids) ? (payload.ids as unknown[]) : []
  const ids = [...new Set(idsIn.map(Number).filter((n) => Number.isFinite(n)))].slice(0, MAX_IDS)
  if (ids.length === 0) return json({ lang, items: [] })

  // 수요 갱신은 창고 조회보다 **앞**이다. 캐시가 다 맞아도 "이 방을 이 언어로 보고 있다"는
  // 사실은 변하지 않는다. 뒤에 두면 워커가 잘 채워주는 활성 조합일수록 수요가 갱신되지 않아
  // 5일 뒤 조용히 만료된다.
  await admin
    .from('chat_translation_demand')
    .upsert({ room, lang, last_requested_at: new Date().toISOString() }, { onConflict: 'room,lang' })

  const { data: cached } = await admin
    .from('chat_translations')
    .select('message_id, body')
    .eq('lang', lang)
    .in('message_id', ids)

  const hit = new Map<number, string>((cached ?? []).map((r) => [r.message_id as number, r.body as string]))
  const missIds = ids.filter((id) => !hit.has(id))

  if (missIds.length > 0) {
    const { data: rows } = await admin
      .from('chat_messages')
      .select('id, body, src_lang')
      .eq('room', room)
      .eq('mod_status', 'ok')
      .is('deleted_at', null)
      .in('id', missIds)

    const todo = (rows ?? []).filter(
      (r) => isTranslatable(r.body) && !sameLang(r.src_lang, lang),
    )

    if (todo.length > 0) {
      const items: TranslateItem[] = todo.map((r) => ({ text: r.body as string, from: r.src_lang }))
      // Azure → 구글 → 포기. 어느 엔진이 처리했는지는 건마다 다를 수 있어 r.engine 으로 온다.
      const results = await translateBatch(items, lang)

      const inserts: { message_id: number; lang: string; body: string; engine: string }[] = []
      const detected = new Map<string, number[]>()
      results.forEach((r, i) => {
        if (!r) return // 어느 엔진도 못 한 건 — 그냥 뺀다. 프론트가 원문 그대로 둔다
        const row = todo[i]
        const id = row.id as number
        if (!row.src_lang && r.detected) {
          const g = detected.get(r.detected)
          if (g) g.push(id)
          else detected.set(r.detected, [id])
        }
        // 감지해보니 원문이 이미 독자 언어였다 — 저장할 값이 없다.
        // src_lang 만 남기면 다음부터 아예 후보에서 빠진다.
        if (sameLang(r.detected, lang)) return
        hit.set(id, r.text)
        inserts.push({ message_id: id, lang, body: r.text, engine: r.engine })
      })

      // 저장이 반환보다 앞이다 — 반대로 하면 실패 시 사용자는 받았는데 창고는 비어
      // 다음 사람이 같은 돈을 또 낸다.
      if (inserts.length > 0) {
        // 워커와 동시에 같은 행을 쓸 수 있다. 값이 같으니 먼저 쓴 쪽을 남기고 조용히 버린다.
        await admin.from('chat_translations').upsert(inserts, { onConflict: 'message_id,lang', ignoreDuplicates: true })
      }
      await recordSrcLang(admin, detected)
    }
  }

  return json({ lang, items: [...hit].map(([id, body]) => ({ id, body })) })
}

// ── 워커: 할 일 받아가기 ──────────────────────────────────
async function handlePending(admin: Admin, payload: Record<string, unknown>): Promise<Response> {
  const limit = Number(payload?.limit ?? 500)
  const { data, error } = await admin.rpc('chat_translation_pending', {
    p_limit: Number.isFinite(limit) ? limit : 500,
  })
  if (error) return json({ error: error.message }, 500)

  // 유니코드 판정(글자가 하나도 없는 줄)은 SQL 에 두기 어려워 여기서 거른다.
  const rows = (data ?? []).filter((r: { body: string }) => isTranslatable(r.body))
  return json({ items: rows })
}

// ── 워커: 결과 저장 ────────────────────────────────────────
async function handleStore(admin: Admin, payload: Record<string, unknown>): Promise<Response> {
  const itemsIn = Array.isArray(payload?.items) ? (payload.items as Record<string, unknown>[]) : []

  const inserts: { message_id: number; lang: string; body: string; engine: string }[] = []
  const detected = new Map<string, number[]>()
  for (const it of itemsIn) {
    const id = Number(it?.message_id)
    const lang = String(it?.lang ?? '').trim()
    const body = String(it?.body ?? '')
    const src = String(it?.src_lang ?? '').trim()
    if (!Number.isFinite(id)) continue
    // 번역이 실패했어도 언어 판정은 쓸모가 있다 — 그래서 아래 continue 보다 앞이다.
    if (src) {
      const g = detected.get(src)
      if (g) g.push(id)
      else detected.set(src, [id])
    }
    if (!lang || !body || sameLang(src, lang)) continue
    inserts.push({ message_id: id, lang, body, engine: 'edge' })
  }

  if (inserts.length > 0) {
    const { error } = await admin
      .from('chat_translations')
      .upsert(inserts, { onConflict: 'message_id,lang', ignoreDuplicates: true })
    if (error) return json({ error: error.message }, 500)
  }
  await recordSrcLang(admin, detected)

  return json({ ok: true, stored: inserts.length })
}

/**
 * 감지한 원문 언어를 메시지에 기록한다. 언어별로 묶어 한 번씩만 UPDATE 한다
 * (건마다 돌면 30건짜리 배치가 왕복 30번이 된다).
 *  ⚠️ `is('src_lang', null)` — **비어 있을 때만** 채운다. 이미 값이 있으면 먼저 확정된 쪽이 맞다.
 *     덮어쓰면 같은 글의 원문 언어가 요청마다 흔들려 창고가 어긋난다.
 */
async function recordSrcLang(admin: Admin, detected: Map<string, number[]>): Promise<void> {
  for (const [src, ids] of detected) {
    await admin.from('chat_messages').update({ src_lang: src }).in('id', ids).is('src_lang', null)
  }
}
