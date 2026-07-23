// ebooks: 이북 스토어·서재·열람 API.
//   - store   : 공개된 이북 목록 (로그인 시 owned 플래그 포함) — 비로그인도 조회 가능
//   - library : 내가 구매한 이북 목록 (로그인 필수)
//   - buy     : 구매 = 열람 권한 즉시 지급. ⚠️ 결제(PG) 미연동 데모 — 여기가 나중에 결제 검증이 들어갈 자리.
//   - read    : 소유 확인 후 비공개 버킷 HTML 의 서명 URL 발급(뷰어 iframe 이 이걸 연다)
//   ⚠️ _shared 사용 → CLI 로만 배포할 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'

// 서명 URL 유효시간(초). 길면 링크 유출 시 그만큼 오래 열람 가능 → 짧게 두고 재발급.
const SIGNED_URL_TTL = 60 * 60

type Row = Record<string, unknown>

function shape(b: Row, owned: boolean) {
  return {
    id: b.id as string,
    title: b.title as string,
    author: (b.author as string | null) ?? null,
    description: (b.description as string | null) ?? null,
    coverUrl: (b.cover_url as string | null) ?? null,
    price: (b.price as number) ?? 0,
    owned,
  }
}

async function ownedIds(admin: ReturnType<typeof adminClient>, uid: string): Promise<Set<string>> {
  const { data } = await admin.from('ebook_purchases').select('ebook_id').eq('user_id', uid)
  return new Set((data ?? []).map((r: Row) => r.ebook_id as string))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const body = await req.json().catch(() => ({}))
    const action = body?.action ?? 'store'
    const admin = adminClient()
    const user = await getUser(req)
    // 익명(게스트) 세션은 구매/서재 대상이 아니다 — 정식 회원만.
    const uid = user && !user.is_anonymous ? user.id : null

    if (action === 'store') {
      const { data, error } = await admin
        .from('ebooks')
        .select('id, title, author, description, cover_url, price, published, sort_order, created_at')
        .eq('published', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false })
      if (error) return json({ error: error.message }, 400)
      const mine = uid ? await ownedIds(admin, uid) : new Set<string>()
      return json({ ebooks: (data ?? []).map((b: Row) => shape(b, mine.has(b.id as string))) })
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
        .select('id, title, author, description, cover_url, price')
        .in('id', ids)
      const byId = new Map((books ?? []).map((b: Row) => [b.id as string, b]))
      // 구매 순(최신 먼저) 유지. 관리자가 삭제한 책은 건너뛴다.
      const ebooks = (purchases ?? [])
        .map((p: Row) => {
          const b = byId.get(p.ebook_id as string)
          return b ? { ...shape(b, true), purchasedAt: p.created_at as string } : null
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
        .select('id, title, author, storage_path')
        .eq('id', id)
        .maybeSingle()
      if (!book) return json({ error: '이북을 찾을 수 없습니다.' }, 404)

      const { data: signed, error: signErr } = await admin.storage
        .from('ebooks')
        .createSignedUrl(book.storage_path as string, SIGNED_URL_TTL)
      if (signErr || !signed?.signedUrl) {
        return json({ error: signErr?.message ?? '본문을 불러올 수 없습니다.' }, 400)
      }

      return json({
        id: book.id,
        title: book.title,
        author: book.author ?? null,
        url: signed.signedUrl,
        expiresIn: SIGNED_URL_TTL,
      })
    }

    return json({ error: '알 수 없는 action' }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
