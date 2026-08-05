// ebooks: 이북 스토어·서재·열람 API.
//   - store   : 공개된 이북 목록 (로그인 시 owned 플래그 포함) — 비로그인도 조회 가능
//   - picks   : 레벨테스트 결과창용 추천 목록 (응시 레벨 기준 정렬) — 비로그인도 조회 가능
//   - library : 내가 구매한 이북 목록 (로그인 필수)
//   - buy     : 구매 = 열람 권한 즉시 지급. ⚠️ 결제(PG) 미연동 데모 — 여기가 나중에 결제 검증이 들어갈 자리.
//   - read    : 소유 확인 후 비공개 버킷 HTML 의 서명 URL 발급(뷰어 iframe 이 이걸 연다)
//   ⚠️ _shared 사용 → CLI 로만 배포할 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'

// 서명 URL 유효시간(초). 길면 링크 유출 시 그만큼 오래 열람 가능 → 짧게 두고 재발급.
const SIGNED_URL_TTL = 60 * 60

type Row = Record<string, unknown>

interface TrEntry {
  path?: string
  coverUrl?: string
  title?: string
  author?: string
  description?: string
}
type TrMap = Record<string, TrEntry>

const trMap = (b: Row): TrMap => (b.translations as TrMap | null) ?? {}

// 스토어·서재 카드는 **요청 언어**로 보여준다(제목·소개·표지 모두 그 언어본). 없으면 한국어 원문.
//   langs = 이 책이 가진 번역 언어 목록 → 뷰어의 언어 선택에 쓴다.
function shape(b: Row, owned: boolean, lang: string) {
  const tr = trMap(b)
  const t = tr[lang] ?? {}
  return {
    id: b.id as string,
    title: t.title || (b.title as string),
    author: t.author || ((b.author as string | null) ?? null),
    description: t.description || ((b.description as string | null) ?? null),
    coverUrl: t.coverUrl || ((b.cover_url as string | null) ?? null),
    price: (b.price as number) ?? 0,
    targetLevel: (b.target_level as number | null) ?? null,
    langs: ['ko', ...Object.keys(tr).filter((k) => tr[k]?.path)],
    owned,
  }
}

// 추천 대상 레벨 = 지금 도전할 레벨과 그 다음 레벨 두 칸.
//   예) Lv.3 탈락 → 3·4 / Lv.3 승급(→4) → 4·5.
//   ⚠️ 절댓값 거리로 정렬하면 안 된다 — 아래 레벨이 위 레벨과 같은 거리라 이미 통과한 교재가 끼어든다.
//      (옛 동작: Lv.3 탈락에 3·4·2 가 나갔다.) 아래 레벨은 후보에서 아예 뺀다.
//   (판정은 이제 DB 쿼리의 .in('target_level', [want … want+PICK_SPAN-1]) 이 한다 — 옛 inPickRange 는 제거됐다.)
const PICK_SPAN = 2

async function ownedIds(admin: ReturnType<typeof adminClient>, uid: string): Promise<Set<string>> {
  const { data } = await admin.from('ebook_purchases').select('ebook_id').eq('user_id', uid)
  return new Set((data ?? []).map((r: Row) => r.ebook_id as string))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const body = await req.json().catch(() => ({}))
    const action = body?.action ?? 'store'
    // 화면 언어. 스토어/서재 카드와 본문을 이 언어로 낸다(번역본이 없으면 한국어).
    const lang = String(body?.lang ?? 'ko').trim() || 'ko'
    const admin = adminClient()
    const user = await getUser(req)
    // 익명(게스트) 세션은 구매/서재 대상이 아니다 — 정식 회원만.
    const uid = user && !user.is_anonymous ? user.id : null

    if (action === 'store') {
      const { data, error } = await admin
        .from('ebooks')
        .select('id, title, author, description, cover_url, price, target_level, published, sort_order, created_at, translations')
        .eq('published', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false })
      if (error) return json({ error: error.message }, 400)
      const mine = uid ? await ownedIds(admin, uid) : new Set<string>()
      return json({ ebooks: (data ?? []).map((b: Row) => shape(b, mine.has(b.id as string), lang)) })
    }

    // 결과창 추천 — 응시 레벨에 맞는 책을 위로. 승급했으면 다음 레벨 책을 권한다.
    //   이미 산 책은 빼고(추천할 이유가 없다), 남는 자리는 레벨이 가까운 순 → 스토어 노출순으로 채운다.
    //   레벨 정보가 없으면(level 미전달) 스토어 순서 그대로 = 예전 동작.
    if (action === 'picks') {
      const rawLevel = Math.floor(Number(body?.level))
      const hasLevel = Number.isFinite(rawLevel) && rawLevel >= 1 && rawLevel <= 7
      // 승급자는 이미 그 레벨을 통과했으니 한 칸 위 교재가 맞다(Lv.7 은 그대로).
      const want = hasLevel ? Math.min(7, rawLevel + (body?.promoted ? 1 : 0)) : 0
      const limit = Math.min(12, Math.max(1, Math.floor(Number(body?.limit ?? 3)) || 3))

      // ⚠️ 전량 조회 금지 — 예전엔 published 이북을 통째로 받아 메모리에서 걸렀다(limit 도 없었다).
      //    필요한 건 대상 레벨 몇 권 + 모자랄 때 채울 '레벨 무관' 몇 권뿐이라 **DB 에서 좁혀서 필요한 만큼만** 받는다.
      //    한 방 OR 쿼리로 합치지 않는 이유: 정렬이 sort_order 라, 노출순이 앞선 '레벨 무관' 책이 많으면
      //    limit 안에서 정작 대상 레벨 책을 밀어내 잘못된 폴백이 나온다. 그래서 두 쿼리로 나눈다.
      const SELECT = 'id, title, author, description, cover_url, price, target_level, published, sort_order, created_at, translations'
      let rows: Row[] = []

      if (hasLevel) {
        // ① 대상 레벨: want ~ want+PICK_SPAN-1 (7 초과는 없음). 낮은 레벨(=지금 도전할 레벨) 먼저, 같으면 노출순.
        const wanted = Array.from({ length: PICK_SPAN }, (_, i) => want + i).filter((l) => l <= 7)
        const { data, error } = await admin
          .from('ebooks')
          .select(SELECT)
          .eq('published', true)
          .in('target_level', wanted)
          .order('target_level', { ascending: true })
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: false })
          .limit(limit)
        if (error) return json({ error: error.message }, 400)
        rows = data ?? []

        // ② 모자라면 '레벨 무관'(target_level IS NULL) 으로만 채운다.
        //    아래 레벨로는 채우지 않는다 — 이미 통과한 교재를 다시 권하는 게 추천의 실패 사례였다.
        if (rows.length < limit) {
          const { data: anyLevel, error: e2 } = await admin
            .from('ebooks')
            .select(SELECT)
            .eq('published', true)
            .is('target_level', null)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: false })
            .limit(limit - rows.length)
          if (e2) return json({ error: e2.message }, 400)
          rows = [...rows, ...(anyLevel ?? [])]
        }
      } else {
        // 레벨을 안 주면(디버그·미상) 노출순 앞에서부터.
        const { data, error } = await admin
          .from('ebooks')
          .select(SELECT)
          .eq('published', true)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: false })
          .limit(limit)
        if (error) return json({ error: error.message }, 400)
        rows = data ?? []
      }

      // ⚠️ 보유한 책도 **빼지 않는다**(2026-08-05). 예전엔 제외했는데, 그러면 레벨당 1권 체계에서
      //    한 권만 나오거나 아예 안 뜨는 일이 생겨 "2권 나와야 하는 자리"가 비어 보였다.
      //    대신 owned 플래그로 내려서 화면이 '보유중'으로 구분할 수 있게 한다.
      const mine = uid ? await ownedIds(admin, uid) : new Set<string>()
      const out = rows

      return json({
        ebooks: out.slice(0, limit).map((b: Row) => shape(b, mine.has(b.id as string), lang)),
        // 어떤 레벨을 기준으로 골랐는지(디버그·문구용). 레벨 없이 부르면 null.
        forLevel: hasLevel ? want : null,
      })
    }

    if (action === 'library') {
      if (!uid) return json({ error: '로그인이 필요합니다.' }, 401)
      const { data: purchases } = await admin
        .from('ebook_purchases')
        .select('ebook_id, created_at')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
      const ids = (purchases ?? []).map((p: Row) => p.ebook_id as string)
      if (!ids.length) return json({ ebooks: [] })
      const { data: books } = await admin
        .from('ebooks')
        .select('id, title, author, description, cover_url, price, translations')
        .in('id', ids)
      const byId = new Map((books ?? []).map((b: Row) => [b.id as string, b]))
      // 구매 순(최신 먼저) 유지. 관리자가 삭제한 책은 건너뛴다.
      const ebooks = (purchases ?? [])
        .map((p: Row) => {
          const b = byId.get(p.ebook_id as string)
          return b ? { ...shape(b, true, lang), purchasedAt: p.created_at as string } : null
        })
        .filter(Boolean)
      return json({ ebooks })
    }

    if (action === 'buy') {
      if (!uid) return json({ error: '로그인이 필요합니다.' }, 401)
      const id = String(body?.id ?? '').trim()
      if (!id) return json({ error: 'id 가 필요합니다.' }, 400)

      const { data: book } = await admin
        .from('ebooks')
        .select('id, price, published')
        .eq('id', id)
        .maybeSingle()
      if (!book || !book.published) return json({ error: '판매 중인 이북이 아닙니다.' }, 404)

      // TODO(결제): PG 연동 시 여기서 body.paymentRef 를 검증하고 source='pg' 로 남길 것.
      //   지금은 데모 — 버튼을 누르면 즉시 지급한다. 이미 산 책이면 그대로 성공(멱등).
      const { error } = await admin.from('ebook_purchases').insert({
        user_id: uid,
        ebook_id: id,
        price_paid: book.price ?? 0,
        source: 'demo',
      })
      // 23505 = unique 위반(이미 보유) → 성공으로 취급.
      if (error && (error as { code?: string }).code !== '23505') return json({ error: error.message }, 400)
      return json({ ok: true, owned: true })
    }

    if (action === 'read') {
      if (!uid) return json({ error: '로그인이 필요합니다.' }, 401)
      const id = String(body?.id ?? '').trim()
      if (!id) return json({ error: 'id 가 필요합니다.' }, 400)

      const { data: owned } = await admin
        .from('ebook_purchases')
        .select('id')
        .eq('user_id', uid)
        .eq('ebook_id', id)
        .maybeSingle()
      if (!owned) return json({ error: '구매한 이북만 열람할 수 있습니다.' }, 403)

      const { data: book } = await admin
        .from('ebooks')
        .select('id, title, author, storage_path, translations')
        .eq('id', id)
        .maybeSingle()
      if (!book) return json({ error: '이북을 찾을 수 없습니다.' }, 404)

      // 요청 언어의 번역본이 있으면 그걸, 없으면 원문(ko).
      const tr = trMap(book)
      const entry = tr[lang]
      const path = entry?.path || (book.storage_path as string)

      const { data: signed, error: signErr } = await admin.storage
        .from('ebooks')
        .createSignedUrl(path, SIGNED_URL_TTL)
      if (signErr || !signed?.signedUrl) {
        return json({ error: signErr?.message ?? '본문을 불러올 수 없습니다.' }, 400)
      }

      return json({
        id: book.id,
        title: entry?.title || (book.title as string),
        author: entry?.author || ((book.author as string | null) ?? null),
        url: signed.signedUrl,
        expiresIn: SIGNED_URL_TTL,
        // 실제로 연 언어(요청 언어에 번역본이 없으면 'ko') + 이 책이 가진 언어 목록
        lang: entry?.path ? lang : 'ko',
        langs: ['ko', ...Object.keys(tr).filter((k) => tr[k]?.path)],
      })
    }

    return json({ error: '알 수 없는 action' }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
