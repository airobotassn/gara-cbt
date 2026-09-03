// ebooks: 러닝 라이브러리(이북 + 강의) 스토어·서재·열람 API.
//   - store   : 공개된 이북·강의 목록 (로그인 시 owned 플래그 포함) — 비로그인도 조회 가능
//   - picks   : 레벨테스트 결과창용 추천 목록 (응시 레벨 기준 정렬) — 비로그인도 조회 가능
//   - library : 내가 구매한 이북·강의 목록 (로그인 필수)
//   - buy     : **무료(0원) 전용** 즉시 지급(이북·강의). 유료는 402 로 막고 payments 함수(결제)만 지급한다.
//   - read    : 소유 확인 후 비공개 버킷 HTML 의 서명 URL 발급(뷰어 iframe 이 이걸 연다) + 열람 기록(ebook_reads)
//   - play    : 강의 재생 — 소유 확인 후 **Bunny 서명 임베드 URL** 발급 + 재생 기록(lecture_plays)
//   - progress: 강의 재생 위치 저장(이어보기)
//
// ⛔ **영상 출처가 둘이다 — 강의마다 유튜브 아니면 Bunny 다**(2026-09-03. DB CHECK lectures_source_chk).
//    · **유튜브**(기존 무료 강의) — 사기 전에 youtube_id 를 안 내려준다. 유튜브 영상은 id 만 알면 누구나
//      보므로 그 값이 곧 상품이고, 미소유자에게 주면 결제가 장식이 된다.
//      ⚠️ 폴백 썸네일(img.youtube.com/vi/<id>/…)에는 그 id 가 박혀 있다. 완전히 막으려면 관리자가
//         lectures.thumb_url 에 자체 썸네일을 넣어야 하고, 파는 영상은 **미등록(unlisted)** 이어야 한다.
//    · **Bunny**(유료 강의) — 위 은닉이 필요 없다. id 를 알아도 **서명이 없으면 재생이 안 되기 때문**이다.
//      그래서 썸네일에 id 가 박혀도 괜찮고, 대신 재생 주소를 목록에 실을 수 없다(만료되므로 play 로 받는다).
//   ⛔ 유튜브 쪽 은닉 규칙을 "이제 필요 없다"고 걷어내지 말 것 — **Bunny 강의에만** 해당되는 얘기다.
//   ⚠️ _shared 사용 → CLI 로만 배포할 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'
import { TIER_LABEL } from '../_shared/exam-tickets.ts'
import { BUNNY_EMBED_TTL, bunnyConfigured, bunnyThumbUrl, signBunnyEmbed } from '../_shared/bunny.ts'

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
    // 정가는 달러 센트(100 = $1.00).
    price_usd_cents: (b.price_usd_cents as number) ?? 0,
    // 카탈로그 = 화면 맨 위 전환 버튼(LEVELTEST / CARIS). 분류값은 카탈로그마다 한 쪽만 채워진다
    // (DB CHECK ebooks_catalog_target_chk). 서재(library)처럼 컬럼을 안 뽑는 곳에선 옛 동작으로 읽힌다.
    catalog: ((b.catalog as string | null) ?? 'leveltest') as 'leveltest' | 'caris',
    targetLevel: (b.target_level as number | null) ?? null,
    targetTier: (b.target_tier as string | null) ?? null,
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

/** 서재(library) 진열 순서 = **레벨 사다리 1→7**. 낮을수록 앞(2026-08-12).
 *  옛 동작은 구매순(최신 먼저)이었는데 카드에 구매일이 안 보여서 "무슨 순인지 모르겠다"가 됐다.
 *  ⚠️ 레벨/급수 무관(null)은 맨 뒤 — 사다리에 안 서는 책을 앞에 두면 Lv.1 교재로 읽힌다.
 *  ⚠️ CARIS 책은 레벨이 없고 급수를 쓴다(DB CHECK 상 둘 중 한 쪽만 찬다). 그래서 레벨 묶음이 끝난
 *     뒤에 급수 사다리(Beginner→Zenith) 순으로 선다 — 두 사다리를 한 줄에 섞으면 순서가 다시 흐려진다.
 *  급수 순서의 출처는 TIER_LABEL 키 순서다(표를 새로 쓰면 두 벌이 된다). */
const SHELF_LAST = 99
const TIER_RANK: Record<string, number> = Object.fromEntries(Object.keys(TIER_LABEL).map((k, i) => [k, i]))
const shelfKey = (b: { catalog: string; targetLevel: number | null; targetTier: string | null }): number =>
  b.catalog === 'caris' ? 100 + (TIER_RANK[b.targetTier ?? ''] ?? SHELF_LAST) : (b.targetLevel ?? SHELF_LAST)

async function ownedIds(admin: ReturnType<typeof adminClient>, uid: string): Promise<Set<string>> {
  const { data } = await admin.from('ebook_purchases').select('ebook_id').eq('user_id', uid)
  return new Set((data ?? []).map((r: Row) => r.ebook_id as string))
}

async function ownedLectureIds(admin: ReturnType<typeof adminClient>, uid: string): Promise<Set<string>> {
  const { data } = await admin.from('lecture_purchases').select('lecture_id').eq('user_id', uid)
  return new Set((data ?? []).map((r: Row) => r.lecture_id as string))
}

/** 유튜브가 무료로 주는 정적 썸네일. 관리자가 thumb_url 을 넣었으면 그게 이긴다. */
const ytThumb = (id: string) => `https://img.youtube.com/vi/${id}/hqdefault.jpg`

/** 제목·소개 번역본 한 칸 꺼내기. 없으면 **한국어 원문**(원본 컬럼이 ko 의 단일 출처다).
 *  ⚠️ 아직 번역이 안 된 강의는 그 강의만 한국어로 뜬다 — 빈 칸이 되면 안 된다. */
const trField = (i18n: unknown, lang: string, ko: string): string =>
  (((i18n as Record<string, string> | null) ?? {})[lang] ?? '').trim() || ko

/** 강의 한 줄.
 *  제목·소개는 이북의 shape() 와 같이 **요청 언어**로 준다(2026-08-26. 그전엔 번역이 아예 없어서,
 *  러닝 라이브러리를 영어로 보면 이북 열만 영어고 강의 열은 한국어였다). 채널은 화면에서 뺀 값이라 그대로.
 *
 *  ⛔ **재생 경로가 출처마다 다르다**(source). 화면이 이걸 보고 갈라 쓴다:
 *     · youtube — `youtubeId` 로 바로 재생. **소유자에게만** 내려간다(위 파일 머리 주석).
 *     · bunny   — 여기선 아무것도 안 준다. 재생 버튼을 눌렀을 때 `play` 액션이 서명 URL 을 만들어 준다.
 *  ⛔ **bunny_video_id 를 내려보내지 않는다.** 화면이 그 값으로 할 수 있는 일이 없고(URL 은 서버가 서명한다),
 *     안 주면 실수로 프론트에 재생 경로가 생길 여지 자체가 없다. */
function shapeLecture(l: Row, owned: boolean, lang: string) {
  const bunnyId = (l.bunny_video_id as string | null) ?? null
  const ytId = (l.youtube_id as string | null) ?? null
  return {
    id: l.id as string,
    catalog: ((l.catalog as string | null) ?? 'leveltest') as 'leveltest' | 'caris',
    targetLevel: (l.target_level as number | null) ?? null,
    targetTier: (l.target_tier as string | null) ?? null,
    title: trField(l.title_i18n, lang, l.title as string),
    channel: (l.channel as string | null) ?? '',
    description: trField(l.description_i18n, lang, (l.description as string | null) ?? ''),
    price_usd_cents: (l.price_usd_cents as number) ?? 0,
    source: (bunnyId ? 'bunny' : 'youtube') as 'bunny' | 'youtube',
    // 관리자가 올린 썸네일이 이긴다. 없으면 출처가 알아서 준 그림으로 폴백한다.
    //   ⚠️ Bunny 썸네일 주소는 서버가 완성한다 — 풀존 호스트를 프론트에 박으면 라이브러리를 갈 때
    //      배포가 두 번이 된다(ytThumb 를 서버가 만드는 것과 같은 이유).
    thumbUrl: (l.thumb_url as string | null) || (bunnyId ? bunnyThumbUrl(bunnyId) : ytId ? ytThumb(ytId) : null) || '',
    youtubeId: owned && !bunnyId ? ytId : null,
    owned,
  }
}

/** 강의 목록 select — 소유 판정 전이라 영상 id 도 뽑는다(내려줄지는 shapeLecture 가 정한다). */
const LECTURE_COLS = 'id, catalog, target_level, target_tier, youtube_id, bunny_video_id, title, title_i18n, channel, description, description_i18n, price_usd_cents, thumb_url, sort_order, created_at'

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
      // 두 카탈로그를 한 번에 내려주고 화면이 전환 버튼으로 가른다 — 권수가 적어 나눠 부를 이유가 없고,
      // 탭을 눌렀을 때 다시 기다리지 않는다.
      // 강의도 같이 내려준다 — 화면이 교재·강의를 나란히 그리므로 한 번에 받는 게 맞다.
      //   ⚠️ 넷은 서로의 결과를 안 쓴다(보유 목록은 uid 만, 목록은 인자가 없다) → 한 파로 내보낸다.
      const [{ data, error }, mine, { data: lec }, mineLec] = await Promise.all([
        admin
          .from('ebooks')
          .select('id, title, author, description, cover_url, price_usd_cents, catalog, target_level, target_tier, published, sort_order, created_at, translations')
          .eq('published', true)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: false }),
        uid ? ownedIds(admin, uid) : Promise.resolve(new Set<string>()),
        admin
          .from('lectures')
          .select(LECTURE_COLS)
          .eq('published', true)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: false }),
        uid ? ownedLectureIds(admin, uid) : Promise.resolve(new Set<string>()),
      ])
      if (error) return json({ error: error.message }, 400)
      return json({
        ebooks: (data ?? []).map((b: Row) => shape(b, mine.has(b.id as string), lang)),
        lectures: (lec ?? []).map((l: Row) => shapeLecture(l, mineLec.has(l.id as string), lang)),
      })
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
      const SELECT = 'id, title, author, description, cover_url, price_usd_cents, catalog, target_level, target_tier, published, sort_order, created_at, translations'
      // ⚠️ 추천은 **레벨테스트 카탈로그만** 본다. CARIS 교재는 급수(자격검정)에 묶인 물건이라
      //    레벨테스트 결과창에 섞이면 "Lv.3 탈락자에게 Elite 교재" 같은 추천이 나간다.
      //    특히 '레벨 무관' 폴백(②)이 위험하다 — CARIS 책은 target_level 이 항상 null 이라 전부 걸린다.
      const CATALOG = 'leveltest'
      let rows: Row[] = []

      if (hasLevel) {
        // ① 대상 레벨: want ~ want+PICK_SPAN-1 (7 초과는 없음). 낮은 레벨(=지금 도전할 레벨) 먼저, 같으면 노출순.
        const wanted = Array.from({ length: PICK_SPAN }, (_, i) => want + i).filter((l) => l <= 7)
        const { data, error } = await admin
          .from('ebooks')
          .select(SELECT)
          .eq('published', true)
          .eq('catalog', CATALOG)
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
            .eq('catalog', CATALOG)
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
          .eq('catalog', CATALOG)
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
      // 서재 화면(마이페이지)이 러닝 라이브러리와 같은 3열이라 **강의도 같이** 내려준다.
      //   ⚠️ 둘은 서로의 결과를 안 쓴다 → 한 파로 내보낸다.
      const [{ data: purchases }, { data: lecBuys }] = await Promise.all([
        admin
          .from('ebook_purchases')
          .select('ebook_id, created_at')
          .eq('user_id', uid)
          .order('created_at', { ascending: false }),
        admin
          .from('lecture_purchases')
          .select('lecture_id, created_at')
          .eq('user_id', uid)
          .order('created_at', { ascending: false }),
      ])
      const ids = (purchases ?? []).map((p: Row) => p.ebook_id as string)
      const lecIds = (lecBuys ?? []).map((p: Row) => p.lecture_id as string)

      // ⚠️ catalog·target_* 를 같이 뽑아야 한다 — 안 뽑으면 shape() 가 전부 '레벨 무관 leveltest'로 읽어
      //    아래 진열 순서가 통째로 무너진다(옛 select 가 그랬다).
      const [{ data: books }, { data: lecs }] = await Promise.all([
        ids.length
          ? admin
              .from('ebooks')
              .select('id, title, author, description, cover_url, price_usd_cents, translations, catalog, target_level, target_tier')
              .in('id', ids)
          : Promise.resolve({ data: [] as Row[] }),
        lecIds.length
          ? admin.from('lectures').select(LECTURE_COLS).in('id', lecIds)
          : Promise.resolve({ data: [] as Row[] }),
      ])

      const byId = new Map((books ?? []).map((b: Row) => [b.id as string, b]))
      // 관리자가 삭제한 책은 건너뛴다.
      const ebooks = (purchases ?? []).flatMap((p: Row) => {
        const b = byId.get(p.ebook_id as string)
        return b ? [{ ...shape(b, true, lang), purchasedAt: p.created_at as string }] : []
      })
      const lecById = new Map((lecs ?? []).map((l: Row) => [l.id as string, l]))
      // ⚠️ 여기 오는 강의는 **전부 소유**다 → youtubeId 가 내려간다(그래야 서재에서 재생된다).
      //    비공개로 내린 강의도 그대로 보여준다 — 산 사람의 시청권까지 회수하는 건 다른 얘기다.
      const lectures = (lecBuys ?? []).flatMap((p: Row) => {
        const l = lecById.get(p.lecture_id as string)
        return l ? [{ ...shapeLecture(l, true, lang), purchasedAt: p.created_at as string }] : []
      })

      // 레벨 사다리 순으로 진열(shelfKey 주석 참고). sort 가 안정 정렬이라 같은 레벨끼리는
      // 위 쿼리가 준 구매순(최신 먼저)이 그대로 남는다.
      ebooks.sort((a, b) => shelfKey(a) - shelfKey(b))
      lectures.sort((a, b) => shelfKey(a) - shelfKey(b))
      return json({ ebooks, lectures })
    }

    if (action === 'buy') {
      if (!uid) return json({ error: '로그인이 필요합니다.' }, 401)
      const id = String(body?.id ?? '').trim()
      if (!id) return json({ error: 'id 가 필요합니다.' }, 400)
      // 강의도 같은 경로로 산다(무료 전용). 표만 다르고 규칙은 한 벌이다.
      const isLec = body?.kind === 'lecture'
      const table = isLec ? 'lectures' : 'ebooks'
      const buyTable = isLec ? 'lecture_purchases' : 'ebook_purchases'
      const fkCol = isLec ? 'lecture_id' : 'ebook_id'
      const notSelling = isLec ? '판매 중인 강의가 아닙니다.' : '판매 중인 이북이 아닙니다.'

      const { data: item } = await admin
        .from(table)
        .select('id, price_usd_cents, published')
        .eq('id', id)
        .maybeSingle()
      if (!item || !item.published) return json({ error: notSelling }, 404)

      // ⚠️ **무료 전용 경로다.** 결제가 붙은 뒤로 유료를 여기서 지급하면 결제를 통째로 우회할 수 있다
      //    (프론트를 안 거치고 이 함수를 직접 부르면 그만이다). 유료는 payments 함수만 지급한다.
      if ((item.price_usd_cents as number) > 0) {
        return json({ error: isLec ? '결제가 필요한 강의입니다.' : '결제가 필요한 이북입니다.', needsPayment: true }, 402)
      }

      // 0원은 결제창을 탈 수 없으므로 여기서 바로 지급한다. 이미 산 것이면 그대로 성공(멱등).
      const { error } = await admin.from(buyTable).insert({
        user_id: uid,
        [fkCol]: id,
        price_paid: 0,
        source: 'free',
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

      // 열람 기록(사람×책). 관리자 화면이 환불 판단에 쓴다 — 여기가 **클라가 못 건너뛰는 유일한 길목**이라
      // 서명 URL 발급에 성공한 뒤에 찍는다(발급이 실패하면 못 읽으므로 열람이 아니다).
      //   ⚠️ 실패는 삼킨다. 기록이 안 됐다고 산 책을 못 열게 만들면 본말이 전도된다.
      //   ⚠️ 횟수는 10분 창으로 접힌다(ebook_mark_read) — 새로고침·언어 전환이 열람 횟수를 부풀리지 않게.
      try {
        await admin.rpc('ebook_mark_read', { p_user: uid, p_ebook: book.id })
      } catch { /* 기록 실패가 열람을 막지 않는다 */ }

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

    // ── 강의 재생 (Bunny 전용) ───────────────────────────────────
    // 이북 `read` 와 **같은 모양**이다: 소유 확인 → 서명 URL 발급 → 기록. 규칙을 한 벌로 유지할 것.
    //
    // ⛔ **이 주소를 목록(store·library)에 실을 수 없다.** 3시간이면 만료되므로, 탭을 열어둔 채
    //    나중에 누르면 죽은 주소가 된다. 그래서 재생 버튼을 누른 그 순간에 받아 간다.
    // ⛔ **유튜브 강의는 이 경로를 안 탄다.** 유튜브는 목록에 실린 youtubeId 로 바로 재생한다.
    if (action === 'play') {
      if (!uid) return json({ error: '로그인이 필요합니다.' }, 401)
      const id = String(body?.id ?? '').trim()
      if (!id) return json({ error: 'id 가 필요합니다.' }, 400)

      // ⛔ **소유 확인이 먼저다.** 이 한 줄이 결제의 유일한 방어선이라, 강의를 조회하기 전에 건다.
      //    (환불로 lecture_purchases 행이 사라지면 그 순간부터 여기서 막힌다 — 회수 코드가 따로 필요 없다.)
      const { data: owned } = await admin
        .from('lecture_purchases')
        .select('user_id')
        .eq('user_id', uid)
        .eq('lecture_id', id)
        .maybeSingle()
      if (!owned) return json({ error: '구매한 강의만 시청할 수 있습니다.' }, 403)

      const { data: lec } = await admin
        .from('lectures')
        .select('id, bunny_video_id')
        .eq('id', id)
        .maybeSingle()
      if (!lec) return json({ error: '강의를 찾을 수 없습니다.' }, 404)
      const videoId = (lec.bunny_video_id as string | null) ?? ''
      // 유튜브 강의를 여기로 부른 경우 — 화면 로직이 어긋난 것이므로 조용히 넘기지 않는다.
      if (!videoId) return json({ error: '이 강의는 다른 방식으로 재생됩니다.' }, 400)
      // ⚠️ 시크릿이 안 들어온 배포본에서 서명하면 **아무나 통과하는 토큰**이 나간다. 그 전에 막는다.
      if (!bunnyConfigured()) return json({ error: '영상 서버 설정이 필요합니다. 관리자에게 문의해 주세요.' }, 503)

      // 이어보기 지점 + 발급 원장. ⚠️ 조회와 증분을 한 번에 못 하므로 먼저 읽고 뒤에 쓴다.
      const { data: prev } = await admin
        .from('lecture_plays')
        .select('position_sec, plays')
        .eq('user_id', uid)
        .eq('lecture_id', id)
        .maybeSingle()
      const positionSec = Math.max(0, (prev?.position_sec as number | null) ?? 0)

      const embedUrl = await signBunnyEmbed(videoId, positionSec)

      // 발급 기록. ⚠️ 실패는 삼킨다 — 기록이 안 됐다고 산 강의를 못 보게 만들면 본말이 전도된다.
      //   (⛔ 다만 이 값이 비면 트래픽 폭주를 우리 DB 에서 못 본다. 마이그레이션 주석 참고.)
      try {
        await admin.from('lecture_plays').upsert({
          user_id: uid,
          lecture_id: id,
          position_sec: positionSec,
          plays: (((prev?.plays as number | null) ?? 0) + 1),
          last_at: new Date().toISOString(),
        })
      } catch { /* 기록 실패가 시청을 막지 않는다 */ }

      // ⛔ embedUrl 을 로그에 남기지 말 것 — 토큰이 통째로 들어 있다.
      return json({ embedUrl, positionSec, expiresIn: BUNNY_EMBED_TTL })
    }

    // 재생 위치 저장(이어보기). 플레이어가 도는 동안 주기적으로 부른다.
    //   ⚠️ 소유 확인을 여기서도 한다 — 남의 기록을 덮어쓰는 건 못 하지만(PK 가 uid), 안 산 강의로
    //      행을 만들어 원장을 더럽힐 수는 있다.
    //   ⚠️ 실패해도 화면은 아무것도 안 한다(재생이 우선). 그래서 오류 문구를 공들여 쓸 자리가 아니다.
    if (action === 'progress') {
      if (!uid) return json({ error: '로그인이 필요합니다.' }, 401)
      const id = String(body?.id ?? '').trim()
      const sec = Math.max(0, Math.floor(Number(body?.positionSec ?? 0)) || 0)
      if (!id) return json({ error: 'id 가 필요합니다.' }, 400)

      const { data: owned } = await admin
        .from('lecture_purchases')
        .select('user_id')
        .eq('user_id', uid)
        .eq('lecture_id', id)
        .maybeSingle()
      if (!owned) return json({ error: '구매한 강의만 시청할 수 있습니다.' }, 403)

      // ⚠️ plays 는 건드리지 않는다 — 여기서 올리면 30초마다 오르는 값이 되어 발급 원장이 뜻을 잃는다.
      const { error } = await admin
        .from('lecture_plays')
        .upsert({ user_id: uid, lecture_id: id, position_sec: sec, last_at: new Date().toISOString() })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    return json({ error: '알 수 없는 action' }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
