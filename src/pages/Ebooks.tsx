// 러닝 라이브러리 (/ebooks) — **가로 3열**: 레벨(급수) | E-Book | 강의.
//   맨 위 전환 버튼으로 카탈로그가 둘이다(2026-08-11):
//     · LEVELTEST E-BOOK — 무료 레벨테스트용. 왼쪽 열 = 레벨 1~7 (+레벨 무관)
//     · CARIS E-BOOK     — 자격검정용.       왼쪽 열 = 급수 Beginner~Zenith (+급수 무관)
//   책·강의가 어느 쪽에 서는지는 `catalog` 한 컬럼이 정한다(관리자 탭에서 고른다).
//   왼쪽에서 레벨을 고르면 가운데·오른쪽이 그 레벨 것으로 갈리고, 각 열은 카페 게시판처럼
//   **자기 안에서 세로로 스크롤**한다(페이지를 내려서 레벨이 바뀌는 구조가 아니다).
//   좁은 화면은 3열이 안 들어가므로 레벨을 상단 가로 칩으로 빼고 E-Book↔강의를 탭으로 접는다.
//   ⚠️ 3열 뼈대·항목 줄은 **components/LearningLibrary.tsx** 가 단일 출처다 — 마이페이지 서재가 같은 걸 쓴다.
//
//   결제(2026-08-06 연동): 유료 '구매하기' → /checkout?type=ebook|lecture&ref=<id> → 승인 후 지급.
//      0원짜리만 이 화면에서 ebooks/buy 로 즉시 지급한다(0원은 결제창을 탈 수 없다). 서버도 무료만 허용.
//      금액은 반드시 lib/money.ts 의 usdc() 로 찍는다 — 문자열에 `$`·`₩` 를 직접 박지 말 것.
//      실제 청구액(원화) 고지는 결제 화면(/checkout)의 주문요약 아래에서 한다.
//
//   ⛔ **강의도 유료 상품이다(2026-08-25).** 사기 전엔 썸네일·제목·소개만 보이고 재생은 산 뒤에 열린다
//      (서버가 미소유에게 youtube_id 를 안 내려준다). 산 강의는 마이페이지 서재에서 본다.
//      ⚠️ 파는 강의는 **미등록(unlisted) 업로드**여야 한다 — 공개 영상은 링크만 알면 누구나 본다.
//      ⚠️ 옛 '유튜브에서 보기' 링크는 제거됐다(2026-08-25 지시) — 돈 받고 파는 물건 옆에 무료로 가는
//         길을 두면 그 자체로 앞뒤가 안 맞는다.
//   전체구매(2026-08-19): 왼쪽 열 **맨 위** 칸. 레벨 하나가 아니라 카탈로그 전체의 교재·강의를 썸네일로 깔고
//      항목마다 붙은 버튼으로 고른 것만 담는다. **교재와 강의는 각자 따로** 세고 할인도 각자 붙는다 —
//      한 종류를 통으로(7개 전부) 담아야 그 종류값에서 10%. 문구는 고르기 전에도 계속 떠 있다.
//      결제까지 붙어 있다 — '선택 항목 구매' → /checkout?type=bundle&kind=ebook|lecture&ref=<카탈로그>&ids=…
//      → payments 가 담은 id 로 금액·할인을 **다시 뽑아** 주문을 만들고, 줄은 payment_items 에 남는다.
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import { useT } from '../lib/i18n'
import type { TFunc, Lang } from '../lib/i18n'
import { usdc } from '../lib/money'
import EbookCover from '../components/EbookCover'
import {
  BookRow,
  LectureRow,
  LibraryFrame,
  PaneEmpty,
  Pager,
  type LibGroup,
} from '../components/LearningLibrary'
import { ANY_COLOR, COVER_COLORS } from '../lib/coverColors'
import { MIN_LEVEL, MAX_LEVEL } from '../lib/testConfigLevel'
import { getTracks, TIER_COLORS } from '../lib/caris'
import type { EbookListResp, EbookRow, ServerLecture } from '../lib/types'
import { rememberPostLogin } from '../lib/postLogin'

type Catalog = 'leveltest' | 'caris'
/** 카탈로그 이름은 급수 이름(Beginner…)과 같은 브랜드 고유명이라 **언어 무관 영문 고정**이다(i18n 사전 아님). */
const CATALOG_LABEL: Record<Catalog, string> = {
  leveltest: 'LEVELTEST',
  caris: 'CARIS',
}
/** 전체구매 칸의 key — 왼쪽 열 **맨 위**(레벨 1 위)에 서는 특별 칸이라 레벨/급수 key 와 안 겹치게 둔다.
 *  교재 묶음·강의 묶음이 **각자 따로** 결제된다(한 묶음에 한 종류 — 서버 resolveBundle 과 한 벌). */
const BUNDLE_KEY = '__bundle__'
const BUNDLE_COLOR = '#f6c453' // 금색 — 레벨 색 사다리(표지색) 밖이라는 뜻. 전체를 묶는 자리라 따로 논다.
/** 한 종류를 통으로 담았을 때의 할인율(%). 화면 문구(ll.bundle_hint/ll.bundle_on)의 {n} 도 이 값을 받는다
 *  — 숫자를 문구에 박지 말 것. ⚠️ 판정은 **종류 안에서** 한다(교재 7권 / 강의 7편). 섞어서 7개는 할인이 아니다.
 *  ⛔ **서버(_shared/payments.ts 의 BUNDLE_OFF_PCT)와 같은 값이어야 한다.** 어긋나면 화면에 뜬 값과 실제
 *     청구액이 갈린다 — 실제로 깎아주는 건 서버 쪽 값이고, 이 값은 화면에 쓰는 숫자일 뿐이다. */
const BUNDLE_OFF_PCT = 10

/** 전체구매 격자의 한 칸 — 교재와 강의를 **같은 모양**으로 다룬다(둘을 한 목록에서 고르므로).
 *  key 는 접두사로 가른다 — 교재 id 와 강의 id 가 한 Set 에 섞인다(둘 다 uuid 라 접두사 없이는 못 가른다). */
type BundleItem = {
  key: string
  /** 원본 id — **결제로 넘어가는 값**이다. 교재는 ebooks.id, 강의는 lectures.id(유튜브 id 가 아니다). */
  id: string
  kind: 'book' | 'lecture'
  title: string
  sub: string // 저자(교재) 또는 채널(강의)
  price: number // 달러 센트
  owned: boolean
  cover: string | null // 교재 표지(세로)
  thumb: string | null // 강의 썸네일(가로 16:9)
  level: number | null
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
  const [pane, setPane] = useState<string>('books')
  // 관리자가 등록한 강의(lectures 테이블). ⛔ 여기가 유일한 출처다 — 코드에 박힌 폴백은 제거됐다
  //   (파는 물건이 된 뒤로, DB 에 없는 강의는 사지도 갖지도 못하므로 화면에 두면 유령 항목이 된다).
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
  const groups = useMemo<LibGroup[]>(() => {
    // 할인은 목록에서도 보인다 — 들어가 봐야 아는 혜택이면 아무도 안 누른다.
    const bundleBadge = (
      <span className="shrink-0 rounded-full bg-secondary/15 px-2 py-0.5 font-label-md text-[14px] font-bold text-secondary">-{BUNDLE_OFF_PCT}%</span>
    )
    if (cat === 'leveltest') {
      // ⚠️ 전체구매는 **맨 앞**이다(레벨 1 위 — 2026-08-19 지시). CARIS 탭에는 아직 안 세운다:
      //    급수별 강의가 하나도 없어서 '교재만 있는 전체구매' 가 된다. 열려면 여기서 같이 push 하면 된다.
      const out: LibGroup[] = [{
        key: BUNDLE_KEY,
        label: t('ll.bundle'),
        short: t('ll.bundle'),
        desc: t('ll.bundle_desc'),
        color: BUNDLE_COLOR,
        badge: bundleBadge,
        // 전체구매는 레벨 사다리의 한 칸이 아니다 — 선을 그어 사다리와 떼어 놓는다.
        divider: true,
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
    const out: LibGroup[] = getTracks(lang).flatMap((track) =>
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
  // 강의 = 관리자 등록(DB) **하나뿐**이다. DB 가 비면 강의 열도 비는 게 맞다(위 dbLectures 주석 참고).
  const catLectures = useMemo(() => (dbLectures ?? []).filter((l) => l.catalog === cat), [dbLectures, cat])
  const lectures = useMemo(() => {
    if (!active) return []
    return catLectures.filter((l) => (cat === 'leveltest'
      ? (active.key === 'any' ? l.targetLevel == null : l.targetLevel === Number(active.key))
      : (active.key === 'any' ? l.targetTier == null : l.targetTier === active.key)))
  }, [cat, active, catLectures])

  // ── 전체구매 ─────────────────────────────────────────────
  // 레벨을 가리지 않고 이 카탈로그의 교재 전부 + 강의 전부. 레벨 오름차순(무관은 뒤)으로 세운다.
  const bundleItems = useMemo<BundleItem[]>(() => {
    const books: BundleItem[] = catRows
      .slice()
      .sort((a, b) => (a.targetLevel ?? 99) - (b.targetLevel ?? 99))
      .map((b) => ({
        key: `b:${b.id}`, id: b.id, kind: 'book', title: b.title, sub: b.author ?? '',
        price: b.price_usd_cents, owned: b.owned, cover: b.coverUrl, thumb: null, level: b.targetLevel,
      }))
    const lecs: BundleItem[] = catLectures
      .slice()
      .sort((a, b) => (a.targetLevel ?? 99) - (b.targetLevel ?? 99))
      .map((l) => ({
        // ⚠️ id 는 **lectures.id(uuid)** 다 — 결제로 넘어가는 값이라 유튜브 id 를 넣으면 서버가 못 찾는다.
        key: `l:${l.id}`, id: l.id, kind: 'lecture', title: l.title, sub: l.channel,
        price: l.price_usd_cents, owned: l.owned, cover: null, thumb: l.thumbUrl, level: l.targetLevel,
      }))
    return [...books, ...lecs]
  }, [catRows, catLectures])

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
    rememberPostLogin('/ebooks')
    navigate('/login')
  }

  /** 이북·강의 구매 — **한 함수**다. 유료는 결제 화면으로, 0원은 그 자리에서 지급(서버도 무료만 허용).
   *  ⚠️ 금액은 URL 로 넘기지 않는다 — 서버가 상품ID로 다시 계산한다. */
  async function buy(kind: 'ebook' | 'lecture', id: string, price: number) {
    if (!isFullUser) {
      setLoginOpen(true) // 바로 OAuth 로 튕기지 않고 모달로 한 번 받아준다
      return
    }
    if (price > 0) {
      navigate(`/checkout?type=${kind}&ref=${encodeURIComponent(id)}`)
      return
    }
    setBusy(id)
    setMsg('')
    try {
      await callFunction('ebooks', { action: 'buy', id, kind })
      if (kind === 'ebook') {
        setRows((prev) => prev?.map((x) => (x.id === id ? { ...x, owned: true } : x)) ?? prev)
      } else {
        // ⚠️ 강의는 owned 만 켜면 재생이 안 된다 — youtubeId 가 미소유일 때 null 로 내려오기 때문이다.
        //    목록을 다시 받아 그 값을 채운다(서버가 소유자에게만 준다).
        const r = await callFunction<EbookListResp>('ebooks', { action: 'store', lang })
        setDbLectures(r.lectures ?? [])
      }
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
  /**
   * 전체 선택 ↔ 해제 — **그 종류 안에서만** 움직인다(교재 버튼이 강의를 건드리면 안 된다).
   * ⚠️ 기준은 **담은 게 하나라도 있나**(`done > 0`)다. 예전엔 할인 조건(`all` = 전권을 담았나)을 썼는데,
   *    `all` 은 이미 산 책까지 분모에 넣기 때문에 **한 권이라도 보유한 사람은 영영 true 가 안 됐다**
   *    → 버튼이 계속 '전체 선택' 인 채로 담기만 하고 **푸는 길이 없었다**(2026-08-21 신고).
   *    할인 판정과 버튼 동작은 다른 문제다 — `all` 은 서버(resolveBundle)와 한 벌이라 그대로 둔다.
   */
  function pickAllOf(kind: BundleItem['kind']) {
    const st = kind === 'book' ? bundleKinds.book : bundleKinds.lecture
    const clear = st.done > 0
    setPicked((prev) => {
      const next = new Set(prev)
      for (const i of st.items) {
        // 해제는 items 전체를 훑는다 — 담아둔 뒤 그 책을 사버린 경우처럼 sellable 에서 빠진 키도 털어낸다.
        if (clear) next.delete(i.key)
        else if (!i.owned) next.add(i.key)
      }
      return next
    })
  }
  /** 담은 것 결제 — **그 종류만** 넘긴다(교재 묶음 / 강의 묶음. 한 묶음에 두 종류를 섞지 않는다).
   *  ⚠️ 금액도 할인도 URL 에 싣지 않는다. 넘기는 건 종류·카탈로그·id 목록뿐이고, 서버가 다시 뽑는다.
   *  하나면 단품 경로로 보낸다 — 서버가 묶음을 2개부터 받고(단품 중복방어가 그쪽에 있다), 하나에
   *  묶음 할인이 붙으면 같은 것이 화면 두 곳에서 다른 값이 된다. */
  function buyBundle(kind: BundleItem['kind']) {
    if (!isFullUser) {
      setLoginOpen(true)
      return
    }
    const st = kind === 'book' ? bundleKinds.book : bundleKinds.lecture
    const type = kind === 'book' ? 'ebook' : 'lecture'
    const chosen = st.chosen
    if (chosen.length === 0) return
    // 전부 0원이면 결제창을 못 탄다 — 서버가 그 자리에서 지급하므로 그대로 보내도 된다(단품도 같은 취급).
    if (chosen.length === 1) {
      navigate(`/checkout?type=${type}&ref=${encodeURIComponent(chosen[0].id)}`)
      return
    }
    const ids = chosen.map((i) => i.id).join(',')
    navigate(`/checkout?type=bundle&kind=${type}&ref=${encodeURIComponent(cat)}&ids=${encodeURIComponent(ids)}`)
  }

  const loading = !err && rows === null
  const noBooks = t(cat === 'caris' ? 'll.no_books_tier' : 'll.no_books')
  const noLectures = t(cat === 'caris' ? 'll.no_lectures_tier' : 'll.no_lectures')

  // 레벨·급수를 바꾸면 목록이 통째로 갈리므로 페이지도 1쪽으로 돌린다(3쪽을 보다 옮겼는데 3쪽이 없는 칸이면 헷갈린다).
  function pick(g: LibGroup) {
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
          onBuy={() => buy('ebook', b.id, b.price_usd_cents)}
          onOpen={() => navigate('/mypage/ebooks')}
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
          lang={lang}
          busy={busy === lec.id}
          playing={playing === lec.id}
          onPlay={() => setPlaying((p) => (p === lec.id ? null : lec.id))}
          onBuy={() => buy('lecture', lec.id, lec.price_usd_cents)}
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
              disabled={st.sellable.length === 0 && st.done === 0}
              className="rounded-xl border border-outline-variant px-4 py-2.5 font-label-md text-[16px] font-bold text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-40"
            >
              {st.done > 0 ? t('ll.pick_none') : t('ll.pick_all')}
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
          <Link to="/" className="gd-back mb-6">
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
                /* 선택 표시는 **면 밝기가 아니라 액센트 링**이다 — 면을 한 단 밝히는 것만으로는
                   다크에서 어느 쪽이 켜졌는지 안 보였다(2026-09-01). 링은 inset 그림자라 칸 크기가 안 변한다. */
                className={`rounded-full px-5 py-2.5 font-label-md text-[16px] font-bold tracking-tight transition ${cat === k ? 'bg-surface-container-lowest text-on-surface shadow-[inset_0_0_0_1.5px_var(--color-primary)]' : 'text-on-surface-variant hover:text-on-surface'}`}
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
              {/* ⚠️ 세 열의 **높이를 맞춘다**(2026-08-21 요청) — `items-stretch`(flex 기본)라 셋 다 제일 긴 열만큼 선다.
                  ⚠️ 여전히 **화면 높이로 못박는 게 아니다**(그게 2026-08-06 반려된 것). 기준은 제일 긴 열의 내용이고,
                     그게 max-h 를 넘을 때만 각 열이 자기 안에서 스크롤한다.
                  ⚠️ 짧은 열은 아래가 빈다 — 지금은 레벨 열(전체구매+7레벨)이 제일 길어서 교재·강의 아래가 남는다.
                     그게 싫으면 `items-start` 로 되돌리면 되고, 그러면 레벨 열만 따로 논다. */}
              {/* 3열 뼈대는 components/LearningLibrary.tsx 가 그린다 — 마이페이지 서재가 같은 걸 쓴다.
                  전체구매 칸에서는 두 열이 '교재 격자 / 강의 격자'가 되고 요약 띠가 각자 붙는다. */}
              <LibraryFrame
                groups={groups}
                activeKey={active?.key}
                onPick={pick}
                colTitle={t(cat === 'caris' ? 'll.tier_col' : 'll.level_col')}
                pane={pane}
                onPane={setPane}
                /* ⚠️ 카탈로그 전환 버튼 줄(52px + 여백 16)까지 뺀 값이다 — 위에 뭘 더 얹으면 여기도 다시 잴 것. */
                wideMaxH="calc(100dvh - 276px)"
                narrowMaxH="calc(100dvh - 336px)"
                panes={[
                  {
                    key: 'books',
                    title: t('ll.books'),
                    body: isBundle
                      ? bundleGridOf('book')
                      : books.length === 0 ? <PaneEmpty text={noBooks} /> : bookList,
                    pager: isBundle ? undefined : bookPager,
                    bar: isBundle ? (edge) => bundleBar('book', edge) : undefined,
                  },
                  {
                    key: 'lectures',
                    title: t('ll.lectures'),
                    body: isBundle
                      ? bundleGridOf('lecture')
                      : lectures.length === 0 ? <PaneEmpty text={noLectures} /> : lectureList,
                    pager: isBundle ? undefined : lecPager,
                    bar: isBundle ? (edge) => bundleBar('lecture', edge) : undefined,
                  },
                ]}
              />
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
  /** 이미 가진 것 — 담기 대신 서재로 보낸다(교재·강의 둘 다). */
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
            {/* ⚠️ 서버가 준 thumbUrl 을 그대로 쓴다 — 여기서 유튜브 주소를 만들면 미소유 강의의 영상 id 가 필요해진다. */}
            {item.thumb && (
              <img src={item.thumb} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
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
