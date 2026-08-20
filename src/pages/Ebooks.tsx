// 러닝 라이브러리 (/ebooks) — **가로 3열**: 레벨(급수) | 교재(E-BOOK) | 강의.
//   맨 위 전환 버튼으로 카탈로그가 둘이다(2026-08-11):
//     · LEVELTEST E-BOOK — 무료 레벨테스트용. 왼쪽 열 = 레벨 1~7 (+레벨 무관)
//     · CARIS E-BOOK     — 자격검정용.       왼쪽 열 = 급수 Beginner~Zenith (+급수 무관)
//   책이 어느 쪽에 서는지는 `ebooks.catalog` 한 컬럼이 정한다(관리자 이북 탭에서 고른다).
//   ⚠️ 급수별 강의는 아직 없다 — lectures.ts 는 레벨만 안다. CARIS 탭의 강의 열은 비어 있는 게 맞다.
//   왼쪽에서 레벨을 고르면 가운데·오른쪽이 그 레벨 것으로 갈리고, 각 열은 카페 게시판처럼
//   **자기 안에서 세로로 스크롤**한다(페이지를 내려서 레벨이 바뀌는 구조가 아니다).
//   좁은 화면은 3열이 안 들어가므로 레벨을 상단 가로 칩으로 빼고 교재↔강의를 탭으로 접는다.
//
//   결제(2026-08-06 연동): 유료책 '구매하기' → /checkout?type=ebook&ref=<id> (토스 결제위젯) → 승인 후 지급.
//      0원 책만 이 화면에서 ebooks/buy 로 즉시 지급한다(0원은 결제창을 탈 수 없다). 서버도 무료책만 허용.
//      ⚠️ DB·결제는 원(KRW)이고 **구매자 화면 표시만 달러**다($1 = 1,500원 고정 환산 · 2026-08-07 결정).
//         금액은 반드시 lib/money.ts 의 usdc() 로 찍는다 — 문자열에 `$`·`₩` 를 직접 박지 말 것.
//         실제 청구액(원화) 고지는 결제 화면(/checkout)의 주문요약 아래에서 한다.
//   ⚠️ 강의는 아직 DB 가 없다 — `lib/lectures.ts` 하드코딩(데모). 관리자 등록으로 옮길 때 그 파일 주석 참고.
//   전체구매(2026-08-19): 왼쪽 열 **맨 위** 칸. 레벨 하나가 아니라 카탈로그 전체의 교재·강의를 썸네일로 깔고
//      항목마다 붙은 버튼으로 고른 것만 담는다. **교재와 강의는 각자 따로** 세고 할인도 각자 붙는다 —
//      한 종류를 통으로(7개 전부) 담아야 그 종류값에서 10%. 문구는 고르기 전에도 계속 떠 있다.
//      결제까지 붙어 있다(2026-08-19) — '선택 항목 구매' → /checkout?type=bundle&ref=<카탈로그>&ids=…
//      → payments 가 담은 id 로 금액·할인을 **다시 뽑아** 주문을 만들고, 줄은 payment_items 에 남는다.
//      강의는 값이 0원이고 소유 개념이 없어 결제 대상이 아니다(강의만 담으면 안내만 뜬다).
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import { useT } from '../lib/i18n'
import type { TFunc, Lang } from '../lib/i18n'
import { usdc } from '../lib/money'
import EbookCover from '../components/EbookCover'
import { MIN_LEVEL, MAX_LEVEL } from '../lib/testConfigLevel'
import { getTracks, TIER_COLORS } from '../lib/caris'
import { LECTURES, lecturesForLevel, ytEmbed, ytThumb, ytWatch, type Lecture } from '../lib/lectures'
import type { EbookListResp, EbookRow, ServerLecture } from '../lib/types'

type Catalog = 'leveltest' | 'caris'
/** 카탈로그 이름은 급수 이름(Beginner…)과 같은 브랜드 고유명이라 **언어 무관 영문 고정**이다(i18n 사전 아님). */
const CATALOG_LABEL: Record<Catalog, string> = {
  leveltest: 'LEVELTEST',
  caris: 'CARIS',
}
const ANY_COLOR = 'rgb(148 163 184)' // slate-400 — 레벨/급수 색 사다리 밖이라는 뜻으로 무채색

/** 전체구매 칸의 key — 왼쪽 열 **맨 위**(레벨 1 위)에 서는 특별 칸이라 레벨/급수 key 와 안 겹치게 둔다.
 *  ⛔ **구색이다(2026-08-19 지시)** — 고르기·합계·할인 표시까지가 전부고 묶음 결제는 아직 없다. 두 가지가 없어서다:
 *     · 다건 결제 — payments 는 한 결제에 상품 1건(+이북 곁다리 1건)까지만 안다. 줄 단위 주문을 새로 만들어야 하고,
 *       할인율도 **서버가 다시 계산**해야 한다(금액은 요청으로 받지 않는다 — CLAUDE.md 결제 절).
 *     · 강의 상품 — lectures 테이블에 가격 컬럼도 구매·소유 테이블도 없다(유튜브 임베드라 지금은 그냥 무료 시청).
 *       그래서 여기 강의는 0원으로 잡힌다. 가격이 생기면 BundleItem.price 만 채우면 합계에 그대로 들어간다. */
const BUNDLE_KEY = '__bundle__'
const BUNDLE_COLOR = '#f6c453' // 금색 — 레벨 색 사다리(표지색) 밖이라는 뜻. 전체를 묶는 자리라 따로 논다.
/** 한 종류를 통으로 담았을 때의 할인율(%). 화면 문구(ll.bundle_hint/ll.bundle_on)의 {n} 도 이 값을 받는다
 *  — 숫자를 문구에 박지 말 것. ⚠️ 판정은 **종류 안에서** 한다(교재 7권 / 강의 7편). 섞어서 7개는 할인이 아니다.
 *  ⛔ **서버(_shared/payments.ts 의 BUNDLE_OFF_PCT)와 같은 값이어야 한다.** 어긋나면 화면에 뜬 값과 실제
 *     청구액이 갈린다 — 실제로 깎아주는 건 서버 쪽 값이고, 이 값은 화면에 쓰는 숫자일 뿐이다. */
const BUNDLE_OFF_PCT = 10

/** 전체구매 격자의 한 칸 — 교재와 강의를 **같은 모양**으로 다룬다(둘을 한 목록에서 고르므로).
 *  key 는 접두사로 가른다 — 교재 id(uuid)와 강의 id(유튜브)가 한 Set 에 섞인다. */
type BundleItem = {
  key: string
  /** 원본 id — 교재는 ebooks.id(결제로 넘어가는 값), 강의는 유튜브 id. key 에서 접두사를 벗기지 않으려고 따로 둔다. */
  id: string
  kind: 'book' | 'lecture'
  title: string
  sub: string // 저자(교재) 또는 채널(강의)
  price: number // 달러 센트. 강의는 0 — 위 BUNDLE_KEY 주석 참고
  owned: boolean
  cover: string | null
  ytId: string | null
  level: number | null
}

/** 레벨 칸의 색 점 — **그 레벨 교재 표지의 네온색**에서 뽑은 값이다(표지 그림에서 실측).
 *  ⚠️ testConfigLevel 의 LEVEL_COLORS(연두→빨강)를 쓰지 않는다. 이 화면은 바로 옆에 표지가 서 있어서
 *     사다리색을 쓰면 점과 표지가 서로 다른 색을 말한다. 표지를 새로 뽑으면 이 값도 다시 재야 한다. */
const COVER_COLORS: Record<number, string> = {
  1: '#2edef9', // 시안
  2: '#0632f1', // 파랑
  3: '#755ef4', // 보라
  4: '#8d49f7', // 자주
  5: '#f52c8f', // 핑크
  6: '#f35907', // 주황
  7: '#da1919', // 빨강
}

/** 교재 표지 폭(열 본문 폭 대비). 강의 썸네일은 이 값을 쓰지 않는다 — 영상은 가로가 긴 물건이라
 *  열 폭을 꽉 채우고 제목을 그 밑에 둔다(2026-08-11 지시).
 *  ⚠️ 51% 는 **줄 높이를 강의 줄과 맞추려고 역산한 값**이다(표지 A4 → 폭×1.414 + 패딩 32 ≒ 썸네일 16:9 + 제목·채널).
 *     줄여 놓으면 교재 줄이 짧아 박스 아래가 100px 씩 텅 빈다(실제로 그렇게 만들었다가 지적받음).
 *     ⚠️ max-w 를 걸지 말 것 — 열이 넓어질 때 표지만 안 커져 다시 어긋난다. 상한은 페이지 폭(1240)이 이미 준다. */
const MEDIA_W = 'w-[51%] shrink-0 self-start'

/** 왼쪽 열 한 칸 — 레벨(1~7·무관) 또는 급수(Beginner~Zenith·무관). 두 카탈로그가 같은 모양을 쓴다. */
type Group = {
  key: string // 레벨은 '1'~'7', 급수는 티어 key. 'any' = 그 카탈로그의 '무관' 자리
  label: string // 왼쪽 열 · 좁은 화면 설명줄에 쓰는 이름
  short: string // 좁은 화면 가로 칩(폭이 좁아 짧게)
  desc: string
  color: string
}

export default function Ebooks() {
  const { t, lang } = useT()
  const navigate = useNavigate()
  const { isFullUser } = useAuth()
  const [rows, setRows] = useState<EbookRow[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [loginOpen, setLoginOpen] = useState(false)
  const [zoom, setZoom] = useState<EbookRow | null>(null)
  // 재생 중인 강의 — 한 번에 하나만(iframe 을 여러 개 띄우면 소리가 겹치고 페이지가 무거워진다).
  const [playing, setPlaying] = useState<string | null>(null)
  // 카탈로그 전환. 기본은 LEVELTEST — 지금 책이 다 그쪽에 있다(빈 탭으로 시작하지 않는다).
  const [cat, setCat] = useState<Catalog>('leveltest')
  // 선택은 카탈로그마다 따로 기억한다 — 탭을 왔다 갔다 해도 보던 자리로 돌아온다.
  const [levelSel, setLevelSel] = useState(String(MIN_LEVEL))
  const [tierSel, setTierSel] = useState('beginner')
  // 교재·강의 각각의 페이지(0부터). 한 페이지에 한 개씩 — 아래 clamp 를 거쳐 쓴다.
  const [bookPageRaw, setBookPage] = useState(0)
  const [lecPageRaw, setLecPage] = useState(0)
  // 좁은 화면 전용 — 3열을 못 세우니 가운데·오른쪽 열을 탭으로 번갈아 보여준다.
  const [pane, setPane] = useState<'books' | 'lectures'>('books')
  // 관리자가 등록한 강의(lectures 테이블). ⚠️ 하나라도 있으면 코드에 박힌 목록(lib/lectures.ts)보다 이게 우선이다.
  const [dbLectures, setDbLectures] = useState<ServerLecture[] | null>(null)
  // 전체구매에서 고른 항목(BundleItem.key). 카탈로그를 바꾸면 목록이 통째로 갈리므로 같이 비운다.
  const [picked, setPicked] = useState<Set<string>>(new Set())

  useEffect(() => {
    callFunction<EbookListResp>('ebooks', { action: 'store', lang })
      // ⚠️ catalog·targetTier 는 함수를 다시 배포해야 내려온다 — 그 전 응답은 옛 모양(둘 다 없음)이라
      //    여기서 레벨테스트 카탈로그로 읽어준다. 안 그러면 배포 순서에 따라 목록이 통째로 빈다.
      .then((r) => {
        setRows(r.ebooks.map((b) => ({ ...b, catalog: b.catalog ?? 'leveltest', targetTier: b.targetTier ?? null })))
        setDbLectures(r.lectures ?? [])
      })
      .catch((e) => setErr(e instanceof Error ? e.message : '이북을 불러올 수 없습니다.'))
  }, [isFullUser, lang])

  // 모달은 Esc 로도 닫는다.
  useEffect(() => {
    if (!loginOpen && !zoom) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setLoginOpen(false)
      setZoom(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [loginOpen, zoom])

  const catRows = useMemo(() => (rows ?? []).filter((b) => b.catalog === cat), [rows, cat])

  // 왼쪽 열 목록. 교재가 없는 레벨·급수도 남긴다 — 사다리가 중간에 비면 몇 칸짜리인지부터 헷갈린다.
  //   '무관' 칸만은 해당 교재가 있을 때만 세운다(항상 있으면 빈 칸이 하나 더 있는 것으로 읽힌다).
  const groups = useMemo<Group[]>(() => {
    if (cat === 'leveltest') {
      // ⚠️ 전체구매는 **맨 앞**이다(레벨 1 위 — 2026-08-19 지시). CARIS 탭에는 아직 안 세운다:
      //    급수별 강의가 하나도 없어서 '교재만 있는 전체구매' 가 된다. 열려면 여기서 같이 push 하면 된다.
      const out: Group[] = [{
        key: BUNDLE_KEY,
        label: t('ll.bundle'),
        short: t('ll.bundle'),
        desc: t('ll.bundle_desc'),
        color: BUNDLE_COLOR,
      }]
      for (let lv = MIN_LEVEL; lv <= MAX_LEVEL; lv++) {
        out.push({
          key: String(lv),
          label: `Lv.${lv} ${t(`lv.${lv}.name`)}`,
          short: `Lv.${lv}`,
          desc: t(`lv.${lv}.desc`),
          color: COVER_COLORS[lv] ?? ANY_COLOR,
        })
      }
      const free = catRows.some((b) => b.targetLevel == null)
      if (free) out.push({ key: 'any', label: t('ll.any_level'), short: t('ll.any_level'), desc: t('ll.any_level_desc'), color: ANY_COLOR })
      return out
    }
    // 급수 목록·설명은 /guide 와 같은 출처(getTracks)를 쓴다 — 여기서 새로 쓰면 문구가 두 벌이 된다.
    const out: Group[] = getTracks(lang).flatMap((track) =>
      track.tiers.map((tier) => ({
        key: tier.key,
        label: tier.name, // 급수 이름은 브랜드 고유명(언어 무관 영문)
        short: tier.name,
        desc: tier.target ?? tier.prereq ?? track.name,
        color: TIER_COLORS[tier.key] ?? ANY_COLOR,
      })),
    )
    const free = catRows.some((b) => b.targetTier == null)
    if (free) out.push({ key: 'any', label: t('ll.any_tier'), short: t('ll.any_tier'), desc: t('ll.any_tier_desc'), color: ANY_COLOR })
    return out
  }, [cat, catRows, lang, t])

  // 고른 칸이 사라졌으면(예: '무관' 칸의 마지막 책이 없어짐) 맨 앞으로 — 빈 화면을 보여주지 않는다.
  const sel = cat === 'leveltest' ? levelSel : tierSel
  const setSel = cat === 'leveltest' ? setLevelSel : setTierSel
  const active = groups.find((g) => g.key === sel) ?? groups[0]

  const books = useMemo(() => {
    if (!active) return []
    if (cat === 'leveltest') {
      return catRows.filter((b) => (active.key === 'any' ? b.targetLevel == null : b.targetLevel === Number(active.key)))
    }
    return catRows.filter((b) => (active.key === 'any' ? b.targetTier == null : b.targetTier === active.key))
  }, [catRows, cat, active])
  // 강의 = 관리자 등록(DB)이 우선, 하나도 없으면 코드에 박힌 기본 목록.
  //   ⚠️ 급수(CARIS)별 강의는 코드 목록엔 아예 없다 — 그건 DB 로만 채워진다.
  const lectures = useMemo(() => {
    if (!active) return []
    const db = (dbLectures ?? []).filter((l) => l.catalog === cat)
    if (db.length) {
      return db
        .filter((l) => (cat === 'leveltest'
          ? (active.key === 'any' ? l.targetLevel == null : l.targetLevel === Number(active.key))
          : (active.key === 'any' ? l.targetTier == null : l.targetTier === active.key)))
        .map((l) => ({ id: l.youtubeId, title: l.title, channel: l.channel, level: l.targetLevel ?? 0 }))
    }
    return cat === 'leveltest' && active.key !== 'any' ? lecturesForLevel(Number(active.key)) : []
  }, [cat, active, dbLectures])

  // ── 전체구매 ─────────────────────────────────────────────
  // 레벨을 가리지 않고 이 카탈로그의 교재 전부 + 강의 전부. 레벨 오름차순(무관은 뒤)으로 세운다.
  const bundleItems = useMemo<BundleItem[]>(() => {
    const books: BundleItem[] = catRows
      .slice()
      .sort((a, b) => (a.targetLevel ?? 99) - (b.targetLevel ?? 99))
      .map((b) => ({
        key: `b:${b.id}`, id: b.id, kind: 'book', title: b.title, sub: b.author ?? '',
        price: b.price_usd_cents, owned: b.owned, cover: b.coverUrl, ytId: null, level: b.targetLevel,
      }))
    // 강의는 목록 화면과 같은 규칙 — DB 에 하나라도 있으면 그게 우선, 없으면 코드에 박힌 기본 목록.
    const db = (dbLectures ?? []).filter((l) => l.catalog === cat)
    const src = db.length
      ? db.map((l) => ({ id: l.youtubeId, title: l.title, channel: l.channel, level: l.targetLevel ?? 0 }))
      : (cat === 'leveltest' ? LECTURES : [])
    const lecs: BundleItem[] = src
      .slice()
      .sort((a, b) => (a.level || 99) - (b.level || 99))
      .map((l) => ({
        key: `l:${l.id}`, id: l.id, kind: 'lecture', title: l.title, sub: l.channel,
        price: 0, owned: false, cover: null, ytId: l.id, level: l.level || null,
      }))
    return [...books, ...lecs]
  }, [catRows, dbLectures, cat])

  // 집계는 **교재·강의 따로**다(2026-08-19 지시). 할인도 각자 붙는다 — 교재 7권을 통으로 담으면 교재값에서
  //   10%, 강의 7편을 통으로 담으면 강의값에서 10%. 한쪽만 채워도 그쪽은 할인이 붙고, 섞어서 7개를 담는 건
  //   어느 쪽도 아니다. ⚠️ 두 종류를 한 주머니로 합치지 말 것 — 합치면 교재만 사려는 사람이 강의까지 담아야
  //   할인을 받게 되어 "7개를 통으로" 라는 조건 자체가 다른 말이 된다.
  const bundleKinds = useMemo(() => {
    // 이미 산 교재는 담을 게 없으니 분모에서 빠진다 — 안 빼면 '전체 선택' 을 눌러도 영영 전체가 안 돼 할인이 못 붙는다.
    const of = (kind: BundleItem['kind']) => {
      const items = bundleItems.filter((i) => i.kind === kind)
      const sellable = items.filter((i) => !i.owned)
      const chosen = sellable.filter((i) => picked.has(i.key))
      // ⚠️ 세트의 크기는 **그 종류 전체 개수**(레벨 1~7 = 7)다. '살 수 있는 것' 개수로 쓰면 안 된다 —
      //    다 가진 사람 화면에서 분모가 0 이 되어 "0개 전부 담으면 10% 할인" 이 뜬다(실제로 나왔다).
      // ⛔ 할인은 **7개를 통으로 담았을 때만**(2026-08-19 지시). 이미 가진 책은 담을 수 없으므로 한 권이라도
      //    보유한 사람은 이 할인을 못 받는다 — 보유분을 세트의 일부로 쳐주려면 **서버 판정(resolveBundle)과
      //    한 벌로** 바꿔야 한다. 한쪽만 고치면 화면 금액과 청구액이 갈린다.
      // ⚠️ 한 권짜리 카탈로그에서 할인을 걸지 않는다 — 그건 묶음이 아니라 단품이고, 서버도 2권부터 받는다.
      const done = chosen.length
      const all = items.length >= 2 && chosen.length === items.length
      const raw = chosen.reduce((sum, i) => sum + i.price, 0)
      // ⚠️ 표시 전용 계산이다. 실제 청구액은 언제나 서버가 상품ID로 다시 뽑는다(금액을 요청으로 받지 않는다).
      return { items, sellable, chosen, done, all, raw, total: all ? Math.round((raw * (100 - BUNDLE_OFF_PCT)) / 100) : raw }
    }
    return { book: of('book'), lecture: of('lecture') }
  }, [bundleItems, picked])

  // 한 화면에 **한 개씩**, 나머지는 페이지로 넘긴다(2026-08-11 결정 — 열 안 스크롤 대신).
  //   ⚠️ 페이지 번호는 state 에 두되 **범위를 벗어나면 그때그때 접는다**(clamp). 레벨을 바꿀 때마다
  //      useEffect 로 0 을 다시 밀어넣으면 렌더가 한 번 더 돌고, 그 사이 빈 화면이 스친다.
  const bookPage = Math.min(bookPageRaw, Math.max(0, books.length - 1))
  const lecPage = Math.min(lecPageRaw, Math.max(0, lectures.length - 1))
  const pagedBooks = books.slice(bookPage, bookPage + 1)
  const pagedLectures = lectures.slice(lecPage, lecPage + 1)
  // ⚠️ 넘길 게 없으면 **undefined 를 넘긴다** — `<Pager>` 가 내부에서 null 을 반환해도 엘리먼트 객체 자체는
  //    truthy 라, 꼬리말 자리가 "그릴 게 있다"고 판단해 빈 띠만 남는다.
  const bookPager = books.length > 1 ? <Pager page={bookPage} total={books.length} onGo={setBookPage} t={t} /> : undefined
  const lecPager = lectures.length > 1
    ? <Pager page={lecPage} total={lectures.length} onGo={(p) => { setLecPage(p); setPlaying(null) }} t={t} />
    : undefined

  // 로그인 수단이 구글만이 아니라서(카카오도 있음) 특정 provider 를 호출하지 않고 로그인 페이지로 보낸다.
  function goLogin() {
    try { sessionStorage.setItem('postLoginRedirect', '/ebooks') } catch { /* 무시 */ }
    navigate('/login')
  }

  async function buy(b: EbookRow) {
    if (!isFullUser) {
      setLoginOpen(true) // 바로 OAuth 로 튕기지 않고 모달로 한 번 받아준다
      return
    }
    // 유료책은 결제 화면으로 넘긴다. 금액은 URL 로 넘기지 않는다 — 서버가 상품ID로 다시 계산한다.
    if (b.price_usd_cents > 0) {
      navigate(`/checkout?type=ebook&ref=${encodeURIComponent(b.id)}`)
      return
    }
    // 0원 책만 이 자리에서 즉시 지급(결제창을 탈 수 없으므로). 서버도 무료책만 허용한다.
    setBusy(b.id)
    setMsg('')
    try {
      await callFunction('ebooks', { action: 'buy', id: b.id })
      setRows((prev) => prev?.map((x) => (x.id === b.id ? { ...x, owned: true } : x)) ?? prev)
      setMsg(t('ebook.bought'))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('ebook.load_failed'))
    } finally {
      setBusy(null)
    }
  }

  function togglePick(key: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  /** 전체 선택 ↔ 해제 — **그 종류 안에서만** 움직인다(교재 버튼이 강의를 건드리면 안 된다). */
  function pickAllOf(kind: BundleItem['kind']) {
    const st = kind === 'book' ? bundleKinds.book : bundleKinds.lecture
    setPicked((prev) => {
      const next = new Set(prev)
      for (const i of st.sellable) {
        if (st.all) next.delete(i.key)
        else next.add(i.key)
      }
      return next
    })
  }
  /** 담은 것 결제 — 교재만 결제 대상이다(강의는 파는 물건이 아니다).
   *  ⚠️ 금액도 할인도 URL 에 싣지 않는다. 넘기는 건 카탈로그와 이북 id 목록뿐이고, 서버가 다시 뽑는다.
   *  한 권이면 단품 경로로 보낸다 — 서버가 묶음을 2권부터 받고(단품 중복방어가 그쪽에 있다), 한 권에
   *  묶음 할인이 붙으면 같은 책이 화면 두 곳에서 다른 값이 된다. */
  function buyBundle(kind: BundleItem['kind']) {
    if (!isFullUser) {
      setLoginOpen(true)
      return
    }
    const st = kind === 'book' ? bundleKinds.book : bundleKinds.lecture
    const books = st.chosen.filter((i) => i.kind === 'book')
    if (books.length === 0) {
      setMsg(t('ll.bundle_nofee'))
      return
    }
    if (books.length === 1) {
      navigate(`/checkout?type=ebook&ref=${encodeURIComponent(books[0].id)}`)
      return
    }
    const ids = books.map((i) => i.id).join(',')
    navigate(`/checkout?type=bundle&ref=${encodeURIComponent(cat)}&ids=${encodeURIComponent(ids)}`)
  }

  const loading = !err && rows === null
  const noBooks = t(cat === 'caris' ? 'll.no_books_tier' : 'll.no_books')
  const noLectures = t(cat === 'caris' ? 'll.no_lectures_tier' : 'll.no_lectures')

  // 레벨·급수를 바꾸면 목록이 통째로 갈리므로 페이지도 1쪽으로 돌린다(3쪽을 보다 옮겼는데 3쪽이 없는 칸이면 헷갈린다).
  function pick(g: Group) {
    setSel(g.key)
    setPlaying(null)
    setBookPage(0)
    setLecPage(0)
  }

  const bookList = (
    <ul className="divide-y divide-outline-variant/70">
      {pagedBooks.map((b) => (
        <BookRow
          key={b.id}
          b={b}
          t={t}
          lang={lang}
          busy={busy === b.id}
          onZoom={() => setZoom(b)}
          onBuy={() => buy(b)}
          onLibrary={() => navigate('/mypage/ebooks')}
        />
      ))}
    </ul>
  )
  const lectureList = (
    <ul className="divide-y divide-outline-variant/70">
      {pagedLectures.map((lec) => (
        <LectureRow
          key={lec.id}
          lec={lec}
          t={t}
          playing={playing === lec.id}
          onPlay={() => setPlaying((p) => (p === lec.id ? null : lec.id))}
        />
      ))}
    </ul>
  )

  // 전체구매도 **교재 상자 / 강의 상자 둘**이다(2026-08-19 지시) — 평소 3열 구조를 그대로 쓴다.
  //   ⚠️ 한 상자에 두 구역으로 넣지 말 것. 할인이 종류마다 따로 붙는데 상자가 하나면 어느 값이 어느 조건으로
  //      깎인 건지 화면에서 안 갈린다("통으로 되어 있는 느낌" 으로 한 번 반려됨).
  //   ⚠️ 칸 최소폭은 **교재·강의 같은 값**이다. 강의만 넓게 잡으면(16:9 라 그러기 쉽다) 한 줄에 한 개만 서서
  //      교재 열은 촘촘한데 강의 열만 휑하고, 몇 편인지도 한눈에 안 들어온다(2026-08-19 지적).
  //      그림 비율만 다르다(표지 세로 A4 / 썸네일 가로 16:9). 칸 수는 auto-fill 로 폭이 정한다.
  const bundleGridOf = (kind: BundleItem['kind']) => {
    const st = kind === 'book' ? bundleKinds.book : bundleKinds.lecture
    if (st.items.length === 0) return <PaneEmpty text={t('ll.bundle_empty')} />
    return (
      <ul
        className="grid gap-3 p-4"
        // ⚠️ minmax 를 그냥 px 로 두면 좁은 화면에서 한 칸이 열 폭보다 커져 **1열**이 된다
        //    (390px 에서 표지 하나가 화면을 통째로 먹었다). min(100%, …) 로 감싸 2열이 서게 한다.
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 150px), 1fr))' }}
      >
        {st.items.map((i) => (
          <BundleCard
            key={i.key}
            item={i}
            on={picked.has(i.key)}
            t={t}
            lang={lang}
            onToggle={() => togglePick(i.key)}
            onOpen={() => navigate('/mypage/ebooks')}
          />
        ))}
      </ul>
    )
  }

  // 상자마다 제 요약 띠 — 그 종류의 현황·소계·할인·전체 선택·구매가 다 여기 있다(옆 상자와 아무 상관 없다).
  //   본문 밖(고정)에 둔다 — 안에 두면 스크롤에 밀려 합계·할인이 화면에서 사라진다.
  //   ⚠️ 좁은 화면에서는 **위**에 붙인다. 아래에 두면 상자 바닥이 곧 화면 바닥이라 떠 있는 FAB(왼쪽 아래)가
  //      버튼을 덮는다(실제로 '전체 선택' 이 반쯤 가려졌다).
  const bundleBar = (kind: BundleItem['kind'], edge: 'top' | 'bottom') => {
    const st = kind === 'book' ? bundleKinds.book : bundleKinds.lecture
    if (st.items.length === 0) return null // 그릴 게 없으면 띠도 없다("0 / 0개 선택" 같은 말이 안 나오게)
    return (
      <div className={`shrink-0 px-4 py-3 ${edge === 'top' ? 'border-b' : 'border-t'} border-outline-variant/70`}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="font-title-md text-[18px] font-bold text-on-surface">
              {t('ll.pick_of', { a: String(st.done), b: String(st.items.length) })}
              {st.raw > 0 && (
                <>
                  <span className="mx-2 text-outline">·</span>
                  {usdc(st.total, lang)}
                  {/* 깎이기 전 값을 취소선으로 같이 보여준다 — 얼마가 빠졌는지 그 줄에서 바로 읽힌다. */}
                  {st.all && st.raw > st.total && (
                    <span className="ml-1.5 font-body-md text-[15px] font-normal text-outline line-through">{usdc(st.raw, lang)}</span>
                  )}
                </>
              )}
            </p>
            {/* ⚠️ 할인 문구는 **고르기 전에도 항상** 떠 있어야 한다(2026-08-19 요청). 다 담으면 '적용' 으로 바뀐다. */}
            <p className={`mt-0.5 font-body-md text-[15px] break-keep ${st.all ? 'font-bold text-secondary' : 'text-on-surface-variant'}`}>
              {t(st.all ? 'll.bundle_on' : 'll.bundle_hint', { c: String(st.items.length), n: String(BUNDLE_OFF_PCT) })}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => pickAllOf(kind)}
              disabled={st.sellable.length === 0}
              className="rounded-xl border border-outline-variant px-4 py-2.5 font-label-md text-[16px] font-bold text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-40"
            >
              {st.all ? t('ll.pick_none') : t('ll.pick_all')}
            </button>
            <button
              type="button"
              onClick={() => buyBundle(kind)}
              disabled={st.chosen.length === 0}
              className="rounded-xl bg-primary-container px-5 py-2.5 font-label-md text-[16px] font-bold text-on-primary ambient-shadow transition-colors hover:bg-primary disabled:opacity-40"
            >
              {t('ll.bundle_buy')}
            </button>
          </div>
        </div>
      </div>
    )
  }
  const isBundle = active?.key === BUNDLE_KEY

  return (
    <div className="bg-background text-on-background min-h-screen relative overflow-x-clip flex flex-col">
      <main className="flex-grow px-margin-mobile md:px-margin-desktop pb-16 pt-10 relative">
        <div
          className="fixed inset-0 mesh-gradient-bg -z-10 pointer-events-none"
          style={{ maskImage: 'linear-gradient(to bottom, white 0%, white 300px, transparent 600px)', WebkitMaskImage: 'linear-gradient(to bottom, white 0%, white 300px, transparent 600px)', opacity: 0.15 }}
        ></div>

        <div className="max-w-[1240px] mx-auto w-full relative z-10">
          {/* 안내문은 여기 머리말에 둔다 — 화면 맨 아래에 깔면 떠 있는 FAB(왼쪽 아래)·맨위로 버튼(오른쪽 아래)에
              그대로 덮여 글자가 잘린다. 실제로 그렇게 만들었다가 반려됐다(2026-08-06). */}
          {/* 메인으로 — /notice·/exam/apply 등 다른 화면 상단에 있는 그 뒤로가기와 같은 모양이다.
              이 화면엔 헤더가 없어서 여기 말고는 홈으로 돌아갈 길이 FAB 뿐이다. */}
          <Link to="/" className="inline-flex items-center gap-1.5 text-on-surface-variant hover:text-primary font-label-md text-label-md mb-6 transition-colors">
            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
            {t('common.home')}
          </Link>

          <header className="mb-5">
            <h1 className="font-display-lg text-3xl md:text-display-lg font-bold text-on-surface mb-2 tracking-tight break-keep">{t('ebook.store_title')}</h1>
            {/* 화면을 보면 아는 걸 글로 또 쓰지 않는다 — "레벨을 고르면 …" 설명문은 2026-08-06 삭제됐다.
                ⚠️ 11~13px 짜리 잔글씨 금지(같은 날 반려) — 보조 문구도 15px 아래로 내리지 말 것. */}
            {/* 서재 안내·달러 고정환산 고지는 2026-08-13 삭제(요청). 환산 고지는 결제 화면(/checkout)이
                결제 버튼 직전에 하므로 여기서 빠져도 고지 자체는 남는다.
                비로그인 안내만 남긴다 — 살 수 있는지 없는지는 화면만 봐선 모른다. */}
            {!isFullUser && (
              <p className="font-body-md text-[15px] text-on-surface-variant break-keep">{t('ebook.login_to_buy')}</p>
            )}
          </header>

          {/* 카탈로그 전환 — 자격검정(CARIS) 교재와 레벨테스트 교재는 겨냥하는 시험이 다르다.
              한 목록에 섞으면 왼쪽 열이 '레벨 7칸 + 급수 6칸' 13칸짜리가 돼 무엇을 고르는 화면인지 흐려진다. */}
          <div
            className="mb-4 inline-flex flex-wrap gap-1 rounded-full border border-outline-variant bg-surface-container-low p-1"
            role="group"
            aria-label={t('ll.catalog')}
          >
            {(['leveltest', 'caris'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => { setCat(k); setPlaying(null); setBookPage(0); setLecPage(0); setPicked(new Set()) }}
                aria-pressed={cat === k}
                className={`rounded-full px-5 py-2.5 font-label-md text-[16px] font-bold tracking-tight transition-colors ${cat === k ? 'bg-surface-container-high text-on-surface' : 'text-on-surface-variant hover:text-on-surface'}`}
              >
                {CATALOG_LABEL[k]}
              </button>
            ))}
          </div>

          {msg && <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 px-5 py-3 font-body-md text-primary">{msg}</div>}
          {err && <div className="bg-surface-container-lowest rounded-2xl p-8 border border-outline-variant/30 text-center text-on-surface-variant">{err}</div>}
          {loading && <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center text-on-surface-variant">{t('common.loading')}</div>}

          {!loading && !err && (
            <>
              {/* ── 넓은 화면: 레벨 | 교재 | 강의 3열.
                  ⚠️ 열 높이를 h-[...] 로 못박지 말 것. 레벨당 교재가 1권이라 화면 높이로 고정하면
                     한 줄 밑으로 수백 px 가 텅 빈 검은 상자가 된다(2026-08-06 그렇게 만들었다가 반려).
                  ⚠️ 교재·강의 **두 박스는 서로 높이를 맞춘다**(2026-08-11 요청) — 짧은 쪽이 긴 쪽만큼 선다.
                     그래서 둘을 한 겹으로 묶었다(기본 stretch). 레벨 열은 여기 들어가지 않는다 —
                     칸 수가 고정이라 같이 늘리면 아래가 통째로 빈다.
                     ⚠️ 화면 높이에 맞춰 늘리는 게 아니다(그게 2026-08-06 반려된 것). **긴 쪽 내용만큼**이다.
                  ⚠️ "항목이 많아지면?" 은 표지·썸네일을 줄일 이유가 아니다 — 그건 이 열 스크롤(또는 나중에
                     페이지 나누기)이 푸는 문제다. 크기를 다시 줄이지 말 것. */}
              {/* ⚠️ max-h 는 카탈로그 전환 버튼 줄(52px + 여백 16)까지 뺀 값이다 — 위에 뭘 더 얹으면 여기도 다시 잴 것.
                  두 열을 묶은 겹에도 같이 걸린다(&>*) — 안 걸면 그 겹만 화면 밖으로 자란다. */}
              <div className="hidden lg:flex gap-4 items-start [&>*]:max-h-[calc(100dvh-276px)]">
                <Pane title={t(cat === 'caris' ? 'll.tier_col' : 'll.level_col')} className="w-[276px] shrink-0">
                  <ul className="p-2.5">
                    {groups.map((g) => {
                      const on = g.key === active?.key
                      return (
                        <Fragment key={g.key}>
                          <li>
                            <button
                              type="button"
                              onClick={() => pick(g)}
                              aria-current={on ? 'true' : undefined}
                              className={`w-full flex items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors ${on ? 'bg-surface-container-high text-on-surface' : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'}`}
                            >
                              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: g.color, opacity: on ? 1 : 0.42 }} />
                              <span className={`min-w-0 flex-1 truncate font-title-md text-[17px] ${on ? 'font-bold' : 'font-semibold'}`}>{g.label}</span>
                              {/* 할인은 목록에서도 보인다 — 들어가 봐야 아는 혜택이면 아무도 안 누른다. */}
                              {g.key === BUNDLE_KEY && (
                                <span className="shrink-0 rounded-full bg-secondary/15 px-2 py-0.5 font-label-md text-[14px] font-bold text-secondary">-{BUNDLE_OFF_PCT}%</span>
                              )}
                            </button>
                          </li>
                          {/* 전체구매는 레벨 사다리의 한 칸이 아니다 — 선을 그어 사다리와 떼어 놓는다. */}
                          {g.key === BUNDLE_KEY && <li aria-hidden className="mx-3 my-2 h-px bg-outline-variant/60" />}
                        </Fragment>
                      )
                    })}
                  </ul>
                </Pane>

                {/* 교재·강의를 묶는 겹. 이 겹의 높이 = 둘 중 긴 쪽이고, 두 열이 그 높이로 함께 선다.
                    전체구매 칸에서는 두 열을 접고 한 열(격자)로 편다 — 교재·강의를 한 목록에서 고르는 화면이라 나눌 이유가 없다. */}
                <div className="flex min-w-0 flex-1 gap-4">
                  {isBundle ? (
                  <>
                    <Pane title={t('ll.books')} className="flex-1 min-w-0" bar={bundleBar('book', 'bottom')}>{bundleGridOf('book')}</Pane>
                    <Pane title={t('ll.lectures')} className="flex-1 min-w-0" bar={bundleBar('lecture', 'bottom')}>{bundleGridOf('lecture')}</Pane>
                  </>
                  ) : (
                  <>
                  <Pane
                    title={t('ll.books')}
                    className="flex-1 min-w-0"
                    pager={bookPager}
                  >
                    {books.length === 0 ? <PaneEmpty text={noBooks} /> : bookList}
                  </Pane>

                  {/* 데모 안내 꼬리말은 강의가 실제로 있을 때만 — 한 편도 없는 칸(CARIS 급수·레벨 무관)에서는
                      없는 영상을 두고 "샘플입니다" 라고 말하는 꼴이 된다. */}
                  <Pane
                    title={t('ll.lectures')}
                    className="flex-1 min-w-0"
                    foot={lectures.length ? t('ll.demo_note') : undefined}
                    pager={lecPager}
                  >
                    {lectures.length === 0 ? <PaneEmpty text={noLectures} /> : lectureList}
                  </Pane>
                  </>
                  )}
                </div>
              </div>

              {/* ── 좁은 화면: 레벨은 가로 칩, 교재/강의는 탭 하나로 접는다. */}
              <div className="lg:hidden">
                <div className="mb-3 flex gap-2 overflow-x-auto rounded-2xl border border-outline-variant bg-surface-container-low px-3 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {groups.map((g) => {
                    const on = g.key === active?.key
                    return (
                      <button
                        key={g.key}
                        type="button"
                        onClick={() => pick(g)}
                        className={`flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 font-label-md text-[16px] transition-colors ${on ? 'bg-surface-container-high text-on-surface font-bold' : 'text-on-surface-variant'}`}
                      >
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color, opacity: on ? 1 : 0.42 }} />
                        {g.short}
                      </button>
                    )
                  })}
                </div>

                {active && (
                  <p className="mb-3 px-1 font-body-md text-[16px] leading-[24px] text-on-surface-variant break-keep">
                    <b className="text-on-surface">{active.label}</b> — {active.desc}
                  </p>
                )}

                {/* 여기도 h-[...] 고정 금지 — 위 3열과 같은 이유(항목 1개일 때 빈 검은 상자가 된다). */}
                <div className="flex flex-col max-h-[calc(100dvh-336px)] rounded-2xl border border-outline-variant bg-surface-container-low ambient-shadow overflow-hidden">
                  <div className="flex shrink-0 border-b border-outline-variant/70">
                    {(['books', 'lectures'] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setPane(k)}
                        className={`flex-1 px-4 py-3.5 font-title-md text-[17px] transition-colors ${pane === k ? 'text-on-surface font-bold border-b-2 border-primary' : 'text-on-surface-variant'}`}
                      >
                        {t(k === 'books' ? 'll.books' : 'll.lectures')}
                      </button>
                    ))}
                  </div>
                  {/* 전체구매는 이 탭이 곧 '교재 / 강의 따로' 다 — 보고 있는 탭의 요약 띠만 위에 붙인다. */}
                  {isBundle && bundleBar(pane === 'books' ? 'book' : 'lecture', 'top')}
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
                    {isBundle
                      ? bundleGridOf(pane === 'books' ? 'book' : 'lecture')
                      : pane === 'books'
                        ? (books.length === 0 ? <PaneEmpty text={noBooks} /> : bookList)
                        : (lectures.length === 0 ? <PaneEmpty text={noLectures} /> : lectureList)}
                  </div>
                  {/* 꼬리말 = 안내문(강의 탭에서만) + 지금 보고 있는 탭의 페이지 넘김. 둘 다 없으면 띠 자체를 안 그린다. */}
                  {!isBundle && ((pane === 'lectures' && lectures.length > 0) || (pane === 'books' ? bookPager : lecPager)) && (
                    <div className="shrink-0 flex items-center justify-between gap-3 border-t border-outline-variant/70 px-4 py-2">
                      <p className="min-w-0 font-body-md text-[14px] text-outline">
                        {pane === 'lectures' && lectures.length > 0 ? t('ll.demo_note') : ''}
                      </p>
                      {pane === 'books' ? bookPager : lecPager}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </main>

      {/* 표지 확대 — 목록 썸네일은 작아서 표지 글자가 안 읽힌다. 탭하면 화면 가득. 배경 아무 데나 눌러 닫는다. */}
      {zoom && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm cursor-zoom-out"
          role="dialog"
          aria-modal="true"
          aria-label={zoom.title}
          onClick={() => setZoom(null)}
        >
          {zoom.coverUrl ? (
            <img src={zoom.coverUrl} alt={zoom.title} className="max-h-[92dvh] max-w-[min(100%,620px)] w-auto h-auto rounded-xl shadow-2xl" />
          ) : (
            <div className="w-[min(90vw,360px)]"><EbookCover title={zoom.title} coverUrl={null} className="w-full" /></div>
          )}
        </div>
      )}

      {/* 로그인 유도 모달 — 비로그인이 구매를 눌렀을 때. 배경 클릭·Esc·닫기로 취소(강제 이동 아님). */}
      {loginOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-5 bg-black/40 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ebook-login-title"
          onClick={() => setLoginOpen(false)}
        >
          <div className="w-full max-w-xs bg-surface-container-lowest rounded-2xl border border-outline-variant/30 p-6 ambient-shadow text-center" onClick={(e) => e.stopPropagation()}>
            <h2 id="ebook-login-title" className="font-title-md text-lg font-bold text-on-surface break-keep mb-5">{t('ebook.login_modal_title')}</h2>
            <button onClick={goLogin} className="w-full px-5 py-3 bg-primary-container text-on-primary font-label-md text-[15px] font-bold rounded-xl hover:bg-primary transition-colors ambient-shadow">
              {t('common.login')}
            </button>
            <button onClick={() => setLoginOpen(false)} className="mt-2.5 w-full px-5 py-2.5 text-on-surface-variant font-label-md text-[14px] font-bold rounded-xl hover:text-primary transition-colors">
              {t('common.close')}
            </button>
          </div>
        </div>
      )}

    </div>
  )
}

/** 열 한 칸 — 머리말(고정) + 본문 + 꼬리말(안내문 왼쪽 · 페이지 넘김 오른쪽).
 *  본문은 한 번에 한 항목이라 보통 안 넘치지만, 항목 자체가 화면보다 길면 그때는 여기서 스크롤한다. */
function Pane({
  title, foot, pager, bar, className = '', children,
}: {
  title: string
  foot?: string
  pager?: React.ReactNode
  /** 본문 **밖**에 고정으로 붙는 띠(전체구매 요약). 꼬리말과 달리 폭을 통째로 쓴다. */
  bar?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    // ⚠️ 다크가 기본이라 bg-surface-container-lowest(#0d0f15)를 쓰면 페이지 배경(#0a0c11)과 거의 같아
    //    열 경계가 안 보인다(2026-08-06 반려). 한 단 밝은 surface-container-low + 진한 테두리로 띄운다.
    <section className={`flex flex-col min-h-0 rounded-2xl border border-outline-variant bg-surface-container-low ambient-shadow overflow-hidden ${className}`}>
      {/* ⚠️ 열 제목을 11px 대문자 캡션으로 두지 말 것(2026-08-06 반려) — 이 화면의 뼈대라 제목처럼 보여야 한다. */}
      <div className="shrink-0 border-b border-outline-variant/70 px-4 py-3.5">
        <h2 className="font-title-md text-[18px] font-bold text-on-surface">{title}</h2>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{children}</div>
      {bar}
      {(foot || pager) && (
        <div className="shrink-0 flex items-center justify-between gap-3 border-t border-outline-variant/70 px-4 py-2">
          <p className="min-w-0 font-body-md text-[14px] text-outline">{foot ?? ''}</p>
          {pager}
        </div>
      )}
    </section>
  )
}

/** 페이지 넘김 — 한 페이지에 한 개라 페이지 수 = 항목 수다. 한 개뿐이면 아예 그리지 않는다. */
function Pager({ page, total, onGo, t }: { page: number; total: number; onGo: (p: number) => void; t: TFunc }) {
  if (total <= 1) return null
  const btn = 'flex h-9 w-9 items-center justify-center rounded-lg text-[20px] leading-none text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface disabled:opacity-30 disabled:hover:bg-transparent'
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button type="button" onClick={() => onGo(page - 1)} disabled={page <= 0} aria-label={t('ll.prev')} className={btn}>‹</button>
      {/* tabular-nums — 자릿수가 바뀌어도 버튼이 좌우로 흔들리지 않는다. */}
      <span className="px-1.5 font-body-md text-[15px] tabular-nums text-on-surface-variant">{page + 1} / {total}</span>
      <button type="button" onClick={() => onGo(page + 1)} disabled={page >= total - 1} aria-label={t('ll.next')} className={btn}>›</button>
    </div>
  )
}

function PaneEmpty({ text }: { text: string }) {
  return <div className="px-5 py-10 text-center font-body-md text-body-md text-outline break-keep">{text}</div>
}

/** 교재 한 줄 — 표지(탭하면 확대) + 제목 + 가격/버튼.
 *    표지 폭은 강의 썸네일과 같은 MEDIA_W 다(2026-08-11 — 두 열의 항목 크기를 맞췄다).
 *    목록이라고 더 줄이지 말 것 — 표지 글자가 아무 데서도 안 읽힌다. */
function BookRow({
  b, t, lang, busy, onZoom, onBuy, onLibrary,
}: {
  b: EbookRow
  t: TFunc
  lang: Lang
  busy: boolean
  onZoom: () => void
  onBuy: () => void
  onLibrary: () => void
}) {
  return (
    <li className="flex gap-4 px-4 py-4 transition-colors hover:bg-surface-container/60">
      {/* self-start 필수 — flex 자식 기본값 stretch 라 표지 박스가 줄 높이만큼 늘어나 A4 비율이 깨진다. */}
      <button type="button" onClick={onZoom} aria-label={t('ebook.cover_zoom')} className={`${MEDIA_W} cursor-zoom-in`}>
        {/* width = 표시 폭(약 222)의 2배 — 고밀도 화면에서 표지 글자가 뭉개지지 않게 스토리지 변환으로 받는다. */}
        <EbookCover title={b.title} coverUrl={b.coverUrl} width={444} className="w-full" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="font-title-md text-[19px] font-bold text-on-surface break-keep line-clamp-2">{b.title}</h3>
        {b.author && <p className="mt-1 font-body-md text-[15px] text-outline truncate">{b.author}</p>}
        {b.description && <p className="mt-2 font-body-md text-[15px] leading-[23px] text-on-surface-variant line-clamp-4 break-keep">{b.description}</p>}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3">
          {/* 이미 산 책에 가격을 계속 띄우면 아직 안 산 것처럼 읽힌다 — 값 자리에 '보유 중'을 대신 둔다. */}
          {b.owned ? (
            <span className="inline-flex items-center gap-1.5 font-title-md text-[17px] font-bold text-secondary">
              <span className="material-symbols-outlined text-[20px]">check_circle</span>
              {t('ebook.owned')}
            </span>
          ) : (
            <span className="font-title-md text-[19px] font-bold text-on-surface">
              {/* ⚠️ b.price_usd_cents 는 **달러 센트**다. 문자열에 `$` 를 직접 박지 말고 usdc() 를 쓸 것
                  (환산율 1,500 은 lib/money.ts 한 곳에만 있다). */}
              {b.price_usd_cents > 0 ? usdc(b.price_usd_cents, lang) : t('ebook.free')}
            </span>
          )}
          {b.owned ? (
            <button onClick={onLibrary} className="shrink-0 px-4 py-2.5 bg-secondary/10 text-secondary border border-secondary/20 font-label-md text-[16px] font-bold rounded-xl hover:bg-secondary/15 transition-colors">
              {t('ebook.read')}
            </button>
          ) : (
            <button onClick={onBuy} disabled={busy} className="shrink-0 px-4 py-2.5 bg-primary-container text-on-primary font-label-md text-[16px] font-bold rounded-xl hover:bg-primary transition-colors ambient-shadow disabled:opacity-60">
              {busy ? t('ebook.processing') : b.price_usd_cents > 0 ? t('ebook.buy') : t('ebook.get_free')}
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

/** 강의 한 줄 — **열 폭을 꽉 채운 가로 16:9 썸네일** + 그 **밑에** 제목·채널(2026-08-11 지시).
 *    누르면 그 자리에서 유튜브 플레이어로 바뀐다. 처음부터 iframe 을 깔지 않는 이유:
 *    줄 수만큼 플레이어가 로드돼 열이 눈에 띄게 무거워진다.
 *    ⚠️ 교재 표지처럼 왼쪽으로 세우지 말 것 — 영상은 가로가 긴 물건이라 옆에 글을 붙이면 그림이 작아진다.
 *       (표지는 계속 왼쪽 + 오른쪽 글. 두 열은 **박스 높이**로 맞추지 항목 배치로 맞추지 않는다.) */
function LectureRow({
  lec, t, playing, onPlay,
}: {
  lec: Lecture
  t: TFunc
  playing: boolean
  onPlay: () => void
}) {
  // 썸네일이 404 면(영상이 내려갔거나 id 오타) 이미지를 지우고 아래 그라데이션 판이 드러나게 둔다.
  const [thumbDead, setThumbDead] = useState(false)

  return (
    <li className="px-4 py-4 transition-colors hover:bg-surface-container/60">
      <div className="relative aspect-video overflow-hidden rounded-xl bg-gradient-to-br from-slate-700 to-slate-900">
        {playing ? (
          <iframe
            src={ytEmbed(lec.id)}
            title={lec.title}
            className="absolute inset-0 h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        ) : (
          <button type="button" onClick={onPlay} className="group absolute inset-0 h-full w-full" aria-label={`${t('ll.play')} — ${lec.title}`}>
            {!thumbDead && (
              <img
                src={ytThumb(lec.id)}
                alt=""
                loading="lazy"
                decoding="async"
                onError={() => setThumbDead(true)}
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              />
            )}
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/25 bg-black/55 backdrop-blur-sm transition-transform duration-200 group-hover:scale-110">
                <svg viewBox="0 0 24 24" className="h-6 w-6 translate-x-[1px] fill-white" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
              </span>
            </span>
          </button>
        )}
      </div>
      <h4 className="mt-3.5 font-title-md text-[19px] font-bold text-on-surface break-keep line-clamp-2">{lec.title}</h4>
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <span className="min-w-0 truncate font-body-md text-[15px] text-outline">{lec.channel}</span>
        {/* 임베드를 막아둔 영상은 플레이어가 오류를 뱉는다 — 그때의 탈출구. */}
        <a href={ytWatch(lec.id)} target="_blank" rel="noreferrer" className="shrink-0 font-label-md text-[15px] font-bold text-on-surface-variant hover:text-primary transition-colors">
          {t('ll.watch_yt')} ↗
        </a>
      </div>
    </li>
  )
}

/** 전체구매 격자의 한 칸 — 썸네일 + 제목 + (가격 · 선택 버튼).
 *  교재는 세로 표지, 강의는 16:9 썸네일이라 그림 자리만 다르고 나머지 줄은 같은 모양으로 맞춘다.
 *  ⚠️ 강의 썸네일은 여기서 재생하지 않는다 — 고르는 화면이라 소리가 나면 방해가 된다(재생은 강의 열에서). */
function BundleCard({
  item, on, t, lang, onToggle, onOpen,
}: {
  item: BundleItem
  on: boolean
  t: TFunc
  lang: Lang
  onToggle: () => void
  /** 이미 가진 책 — 담기 대신 서재로 보낸다(강의는 owned 가 없어 안 불린다). */
  onOpen: () => void
}) {
  return (
    <li
      className={`flex flex-col overflow-hidden rounded-xl border transition-colors ${
        on ? 'border-primary bg-primary/5' : 'border-outline-variant/70 bg-surface-container/40'
      } ${item.owned ? 'opacity-70' : ''}`}
    >
      {item.kind === 'book' ? (
        <div className="p-2.5">
          {/* width = 표시 폭의 2배 — 고밀도 화면에서 표지 글자가 뭉개지지 않게 스토리지 변환으로 받는다. */}
          <EbookCover title={item.title} coverUrl={item.cover} width={344} className="w-full rounded-lg" />
        </div>
      ) : (
        // 표지와 같은 여백·모서리로 맞춘다 — 한 격자에 나란히 서지는 않지만 두 상자가 같은 카드로 읽혀야 한다.
        <div className="p-2.5">
          <div className="relative aspect-video overflow-hidden rounded-lg bg-gradient-to-br from-slate-700 to-slate-900">
            {item.ytId && (
              <img src={ytThumb(item.ytId)} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
            )}
          </div>
        </div>
      )}
      <div className="flex flex-1 flex-col px-3 pb-3 pt-2.5">
        {/* ⚠️ 15px 아래로 내리지 말 것 — 이 화면은 잔글씨 금지다(2026-08-06 반려). */}
        <span className="font-label-md text-[15px] text-outline">
          {item.level ? `Lv.${item.level} · ` : ''}
          {t(item.kind === 'book' ? 'll.books' : 'll.lectures')}
        </span>
        <h4 className="mt-1 font-title-md text-[17px] font-bold text-on-surface break-keep line-clamp-2">{item.title}</h4>
        {/* 부가 한 줄은 **교재의 저자만**. 강의 채널명은 안 그린다(2026-08-19 지시) — 고르는 화면에서
            제목 밑에 또 한 줄이 붙으면 설명글처럼 읽히고, 채널은 고르는 데 쓰는 정보가 아니다.
            ⚠️ 강의 열(LectureRow)의 채널명은 그대로다 — 거기선 영상 출처라 필요하다. */}
        {item.kind === 'book' && item.sub && (
          <p className="mt-1 truncate font-body-md text-[15px] text-outline">{item.sub}</p>
        )}
        <div className="mt-auto flex items-center justify-between gap-2 pt-3">
          {/* 이미 산 책에 값을 계속 띄우면 아직 안 산 것처럼 읽힌다 — 값 자리에 '보유 중'을 대신 둔다
              (교재 열의 BookRow 와 같은 규칙). 오른쪽 버튼은 담기 대신 서재로 보낸다. */}
          {item.owned ? (
            <span className="inline-flex items-center gap-1 font-title-md text-[17px] font-bold text-secondary">
              <span className="material-symbols-outlined text-[19px]">check_circle</span>
              {t('ebook.owned')}
            </span>
          ) : (
            // ⚠️ 금액은 usdc() 로만 찍는다(달러 센트) — 문자열에 $ 를 직접 박지 말 것.
            <span className="font-title-md text-[17px] font-bold text-on-surface">
              {item.price > 0 ? usdc(item.price, lang) : t('ebook.free')}
            </span>
          )}
          {item.owned ? (
            <button
              type="button"
              onClick={onOpen}
              className="shrink-0 rounded-lg border border-secondary/25 bg-secondary/10 px-3.5 py-2 font-label-md text-[15px] font-bold text-secondary transition-colors hover:bg-secondary/15"
            >
              {t('ebook.view')}
            </button>
          ) : (
            <button
              type="button"
              onClick={onToggle}
              aria-pressed={on}
              className={`shrink-0 rounded-lg px-3.5 py-2 font-label-md text-[15px] font-bold transition-colors ${
                on ? 'bg-primary-container text-on-primary' : 'border border-outline-variant text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {on ? `✓ ${t('ll.picked')}` : t('ll.pick')}
            </button>
          )}
        </div>
      </div>
    </li>
  )
}
