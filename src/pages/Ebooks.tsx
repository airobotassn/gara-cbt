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
//         금액은 반드시 lib/money.ts 의 usd() 로 찍는다 — 문자열에 `$`·`₩` 를 직접 박지 말 것.
//         실제 청구액(원화) 고지는 결제 화면(/checkout)의 주문요약 아래에서 한다.
//   ⚠️ 강의는 아직 DB 가 없다 — `lib/lectures.ts` 하드코딩(데모). 관리자 등록으로 옮길 때 그 파일 주석 참고.
//   구매한 책을 읽는 곳은 여기가 아니라 마이페이지 › E-BOOK 서재(/mypage/ebooks).
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import { useT } from '../lib/i18n'
import type { TFunc, Lang } from '../lib/i18n'
import { usd } from '../lib/money'
import SiteFooter from '../components/SiteFooter'
import EbookCover from '../components/EbookCover'
import { LEVEL_COLORS, MIN_LEVEL, MAX_LEVEL } from '../lib/testConfigLevel'
import { getTracks, TIER_COLORS } from '../lib/caris'
import { lecturesForLevel, ytEmbed, ytThumb, ytWatch, type Lecture } from '../lib/lectures'
import type { EbookListResp, EbookRow, ServerLecture } from '../lib/types'

type Catalog = 'leveltest' | 'caris'
/** 카탈로그 이름은 급수 이름(Beginner…)과 같은 브랜드 고유명이라 **언어 무관 영문 고정**이다(i18n 사전 아님). */
const CATALOG_LABEL: Record<Catalog, string> = {
  leveltest: 'LEVELTEST E-BOOK',
  caris: 'CARIS E-BOOK',
}
const ANY_COLOR = 'rgb(148 163 184)' // slate-400 — 레벨/급수 색 사다리 밖이라는 뜻으로 무채색

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
  books: number
  lectures: number
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
      const out: Group[] = []
      for (let lv = MIN_LEVEL; lv <= MAX_LEVEL; lv++) {
        out.push({
          key: String(lv),
          label: `Lv.${lv} ${t(`lv.${lv}.name`)}`,
          short: `Lv.${lv}`,
          desc: t(`lv.${lv}.desc`),
          color: LEVEL_COLORS[lv] ?? ANY_COLOR,
          books: catRows.filter((b) => b.targetLevel === lv).length,
          lectures: lecturesForLevel(lv).length,
        })
      }
      const free = catRows.filter((b) => b.targetLevel == null).length
      if (free) out.push({ key: 'any', label: t('ll.any_level'), short: t('ll.any_level'), desc: t('ll.any_level_desc'), color: ANY_COLOR, books: free, lectures: 0 })
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
        books: catRows.filter((b) => b.targetTier === tier.key).length,
        lectures: 0, // 급수별 강의는 아직 데이터가 없다(lectures.ts 는 레벨만 안다)
      })),
    )
    const free = catRows.filter((b) => b.targetTier == null).length
    if (free) out.push({ key: 'any', label: t('ll.any_tier'), short: t('ll.any_tier'), desc: t('ll.any_tier_desc'), color: ANY_COLOR, books: free, lectures: 0 })
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
    if (b.price > 0) {
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
          <header className="mb-5">
            <h1 className="font-display-lg text-3xl md:text-display-lg font-bold text-on-surface mb-2 tracking-tight break-keep">{t('ebook.store_title')}</h1>
            {/* 화면을 보면 아는 걸 글로 또 쓰지 않는다 — "레벨을 고르면 …" 설명문은 2026-08-06 삭제됐다.
                ⚠️ 11~13px 짜리 잔글씨 금지(같은 날 반려) — 보조 문구도 15px 아래로 내리지 말 것. */}
            {/* 가격을 달러로 찍는 목록이라 고정 환산이라는 사실을 여기서 한 번 밝힌다 —
                실제 청구액(원화) 고지는 결제 화면(/checkout)이 결제 버튼 직전에 다시 한다. */}
            <p className="font-body-md text-[15px] text-on-surface-variant break-keep">
              {!isFullUser ? t('ebook.login_to_buy') : t('ebook.store_sub')} {t('pay.currency_hint')}
            </p>
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
                onClick={() => { setCat(k); setPlaying(null); setBookPage(0); setLecPage(0) }}
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
                        <li key={g.key}>
                          <button
                            type="button"
                            onClick={() => pick(g)}
                            aria-current={on ? 'true' : undefined}
                            className={`w-full flex items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors ${on ? 'bg-surface-container-high text-on-surface' : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'}`}
                          >
                            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: g.color, opacity: on ? 1 : 0.42 }} />
                            <span className="min-w-0 flex-1">
                              <span className={`block truncate font-title-md text-[17px] ${on ? 'font-bold' : 'font-semibold'}`}>{g.label}</span>
                              <span className="mt-0.5 block font-body-md text-[14px] text-outline">{t('ll.count', { b: g.books, v: g.lectures })}</span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </Pane>

                {/* 교재·강의를 묶는 겹. 이 겹의 높이 = 둘 중 긴 쪽이고, 두 열이 그 높이로 함께 선다. */}
                <div className="flex min-w-0 flex-1 gap-4">
                  <Pane
                    title={t('ll.books')}
                    count={books.length}
                    className="flex-1 min-w-0"
                    pager={bookPager}
                  >
                    {books.length === 0 ? <PaneEmpty text={noBooks} /> : bookList}
                  </Pane>

                  {/* 데모 안내 꼬리말은 강의가 실제로 있을 때만 — 한 편도 없는 칸(CARIS 급수·레벨 무관)에서는
                      없는 영상을 두고 "샘플입니다" 라고 말하는 꼴이 된다. */}
                  <Pane
                    title={t('ll.lectures')}
                    count={lectures.length}
                    className="flex-1 min-w-0"
                    foot={lectures.length ? t('ll.demo_note') : undefined}
                    pager={lecPager}
                  >
                    {lectures.length === 0 ? <PaneEmpty text={noLectures} /> : lectureList}
                  </Pane>
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
                        <span className="ml-2 font-body-md text-[15px] text-outline">{k === 'books' ? books.length : lectures.length}</span>
                      </button>
                    ))}
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
                    {pane === 'books'
                      ? (books.length === 0 ? <PaneEmpty text={noBooks} /> : bookList)
                      : (lectures.length === 0 ? <PaneEmpty text={noLectures} /> : lectureList)}
                  </div>
                  {/* 꼬리말 = 안내문(강의 탭에서만) + 지금 보고 있는 탭의 페이지 넘김. 둘 다 없으면 띠 자체를 안 그린다. */}
                  {((pane === 'lectures' && lectures.length > 0) || (pane === 'books' ? bookPager : lecPager)) && (
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

      <SiteFooter />
    </div>
  )
}

/** 열 한 칸 — 머리말(고정) + 본문 + 꼬리말(안내문 왼쪽 · 페이지 넘김 오른쪽).
 *  본문은 한 번에 한 항목이라 보통 안 넘치지만, 항목 자체가 화면보다 길면 그때는 여기서 스크롤한다. */
function Pane({
  title, count, foot, pager, className = '', children,
}: {
  title: string
  count?: number
  foot?: string
  pager?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    // ⚠️ 다크가 기본이라 bg-surface-container-lowest(#0d0f15)를 쓰면 페이지 배경(#0a0c11)과 거의 같아
    //    열 경계가 안 보인다(2026-08-06 반려). 한 단 밝은 surface-container-low + 진한 테두리로 띄운다.
    <section className={`flex flex-col min-h-0 rounded-2xl border border-outline-variant bg-surface-container-low ambient-shadow overflow-hidden ${className}`}>
      {/* ⚠️ 열 제목을 11px 대문자 캡션으로 두지 말 것(2026-08-06 반려) — 이 화면의 뼈대라 제목처럼 보여야 한다. */}
      <div className="shrink-0 flex items-baseline gap-2 border-b border-outline-variant/70 px-4 py-3.5">
        <h2 className="font-title-md text-[18px] font-bold text-on-surface">{title}</h2>
        {count !== undefined && <span className="font-body-md text-[15px] text-outline">{count}</span>}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{children}</div>
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
              {/* ⚠️ b.price 는 **원(KRW) 정수**다. 표시가만 달러로 환산한다 — 직접 나누지 말고 usd() 를 쓸 것
                  (환산율 1,500 은 lib/money.ts 한 곳에만 있다). */}
              {b.price > 0 ? usd(b.price, lang) : t('ebook.free')}
            </span>
          )}
          {b.owned ? (
            <button onClick={onLibrary} className="shrink-0 px-4 py-2.5 bg-secondary/10 text-secondary border border-secondary/20 font-label-md text-[16px] font-bold rounded-xl hover:bg-secondary/15 transition-colors">
              {t('ebook.read')}
            </button>
          ) : (
            <button onClick={onBuy} disabled={busy} className="shrink-0 px-4 py-2.5 bg-primary-container text-on-primary font-label-md text-[16px] font-bold rounded-xl hover:bg-primary transition-colors ambient-shadow disabled:opacity-60">
              {busy ? t('ebook.processing') : b.price > 0 ? t('ebook.buy') : t('ebook.get_free')}
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
