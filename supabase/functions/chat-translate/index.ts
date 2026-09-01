// chat-translate: 채팅 번역 — 창고 조회 → 없는 것만 번역 → 창고에 저장.
//
//  액션 셋.
//   · (기본)   사용자가 번역 토글을 켰을 때. **창고에 있는 것만 돌려준다.**
//              ⛔ 서버 번역 엔진은 없다 — 없는 건 수요로 등록만 하고 워커가 채운다.
//                 그래서 새 조합의 첫 요청은 반드시 빈손이고, 프론트가 재시도로 집어간다.
//   · pending  엣지 워커가 "번역할 것" 목록을 받아간다.
//   · store    엣지 워커가 번역 결과를 되돌려준다.
//
//  ⚠️ 워커에 로직을 두지 않는 게 이 파일의 요점이다. 워커는 브라우저를 굴리기만 하고
//     '무엇을 번역할지'·'무엇을 저장할지'는 전부 여기서 정한다. 그래야 나중에 백엔드를
//     Spring 으로 옮길 때 이 함수 하나만 다시 쓰면 되고 워커는 손대지 않는다.
//
//  ⚠️ 대상 언어를 요청으로 받지 않는다 — profiles.country_code 에서 파생한다.
//     요청으로 받으면 언어를 바꿔가며 (글 × 언어) 조합을 무한히 만드는 길이 열린다.
//     그게 이 기능에서 비용이 폭발하는 유일한 경로다(country-lang.ts 머리 주석 참고).
//
//  ⚠️ 수요는 **글 단위**다(2026-09-01, 옛 구조는 방 단위). 화면이 띄운 글 번호가 그대로 일감이 되고,
//     뜬 적 없는 글은 번역되지 않는다. 요청에 담긴 room 은 더 쓰지 않는다(글 번호로 직접 찾는다).
//
//  ⚠️ _shared 사용 → CLI 로만 배포할 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'
import { CHAT_REQUIRE_LOGIN } from '../_shared/chat.ts'
import { langForCountry, sameLang } from '../_shared/country-lang.ts'
import { isTranslatable } from '../_shared/translate.ts'

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

  const idsIn = Array.isArray(payload?.ids) ? (payload.ids as unknown[]) : []
  const ids = [...new Set(idsIn.map(Number).filter((n) => Number.isFinite(n)))].slice(0, MAX_IDS)
  if (ids.length === 0) return json({ lang, items: [] })

  // ⚠️ **창고 조회가 수요 등록보다 앞이다(2026-09-01).** 이미 번역된 글을 수요에 적을 이유가 없고,
  //    무엇이 없는지는 조회를 해봐야 알기 때문이다. (방 단위였을 땐 반대였다 — 조회 결과와 무관하게
  //    "이 방을 보고 있다"는 한 줄의 시각을 갱신해야 했다.)
  // ⚠️ body 가 null 인 행(= 엔진이 못 한 글)도 **같이 받는다.** 응답에는 넣지 않지만 '행이 있다'는
  //    사실은 봐야 한다 — 안 그러면 못 하는 글을 요청마다 수요에 다시 적어 넣는다.
  const { data: rows } = await admin
    .from('chat_translations')
    .select('message_id, body')
    .eq('lang', lang)
    .in('message_id', ids)

  const have = new Set((rows ?? []).map((r) => r.message_id as number))
  // 화면엔 원문이 남아야 하므로 실패 표식(body=null)은 돌려주지 않는다 —
  // 여기서 안 거르면 프론트가 null 을 번역문으로 그린다.
  const items = (rows ?? [])
    .filter((r) => r.body != null)
    .map((r) => ({ id: r.message_id as number, body: r.body as string }))

  // ⛔ **화면이 실제로 띄운 글만 수요가 된다.** 방 단위였을 땐 한 사람이 한 번 켜면 그 방의 모든 글이,
  //    그리고 그 뒤 5일간의 모든 글이 번역 대상이었다 — 켠 사람이 나가도 서버는 알 길이 없다
  //    (끄는 신호도 나가는 신호도 오지 않는다). 뜬 적 없는 글은 이제 번역되지 않는다.
  const missing = ids.filter((id) => !have.has(id))
  if (missing.length > 0) {
    await admin
      .from('chat_translation_demand')
      .upsert(missing.map((id) => ({ message_id: id, lang })), {
        onConflict: 'message_id,lang',
        ignoreDuplicates: true,
      })
  }

  // 창고에 있는 것만 돌려준다. 없는 건 방금 수요로 적었으니 워커가 채운다 —
  // 프론트가 잠시 뒤 다시 물어본다(ChatBoard 의 fetchWithRetry).
  return json({ lang, items })
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

  const inserts: { message_id: number; lang: string; body: string | null; engine: string }[] = []
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
    if (!lang || sameLang(src, lang)) continue
    // ⚠️ failed = 엔진이 이 글을 번역하지 못했다. **body 를 null 로 기록해 재시도를 끊는다** —
    //    안 남기면 pending 이 매 초 같은 글을 다시 내주고 워커가 영원히 헛돈다.
    if (it?.failed === true) {
      inserts.push({ message_id: id, lang, body: null, engine: 'edge' })
      continue
    }
    if (!body) continue
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
