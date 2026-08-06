// 러닝 라이브러리 (/ebooks) — **가로 3열**: 레벨 | 교재(E-BOOK) | 강의.
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
import { lecturesForLevel, ytEmbed, ytThumb, ytWatch, type Lecture } from '../lib/lectures'
import type { EbookListResp, EbookRow } from '../lib/types'

/** 레벨 1~7 + 맨 뒤의 '레벨 무관'(target_level = null 인 교재가 있을 때만). */
type LevelKey = number | 'any'
const ANY_COLOR = 'rgb(148 163 184)' // slate-400 — 레벨 색 사다리 밖이라는 뜻으로 무채색

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
  const [level, setLevel] = useState<LevelKey>(MIN_LEVEL)
  // 좁은 화면 전용 — 3열을 못 세우니 가운데·오른쪽 열을 탭으로 번갈아 보여준다.
  const [pane, setPane] = useState<'books' | 'lectures'>('books')

  useEffect(() => {
    callFunction<EbookListResp>('ebooks', { action: 'store', lang })
      .then((r) => setRows(r.ebooks))
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

  // 왼쪽 열에 세울 레벨 목록. 교재가 없는 레벨도 남긴다 — 사다리가 중간에 비면 레벨이 몇 개인지부터 헷갈린다.
  const levels = useMemo(() => {
    const list = rows ?? []
    const out: { key: LevelKey; color: string; books: number; lectures: number }[] = []
    for (let lv = MIN_LEVEL; lv <= MAX_LEVEL; lv++) {
      out.push({
        key: lv,
        color: LEVEL_COLORS[lv] ?? ANY_COLOR,
        books: list.filter((b) => b.targetLevel === lv).length,
        lectures: lecturesForLevel(lv).length,
      })
    }
    const free = list.filter((b) => b.targetLevel == null).length
    if (free) out.push({ key: 'any', color: ANY_COLOR, books: free, lectures: 0 })
    return out
  }, [rows])

  const books = useMemo(
    () => (rows ?? []).filter((b) => (level === 'any' ? b.targetLevel == null : b.targetLevel === level)),
    [rows, level],
  )
  const lectures = useMemo(() => (level === 'any' ? [] : lecturesForLevel(level)), [level])

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
  const levelName = (k: LevelKey) => (k === 'any' ? t('ll.any_level') : `Lv.${k} ${t(`lv.${k}.name`)}`)
  const levelDesc = level === 'any' ? t('ll.any_level_desc') : t(`lv.${level}.desc`)

  const bookList = (
    <ul className="divide-y divide-outline-variant/70">
      {books.map((b) => (
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
      {lectures.map((lec) => (
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

          {msg && <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 px-5 py-3 font-body-md text-primary">{msg}</div>}
          {err && <div className="bg-surface-container-lowest rounded-2xl p-8 border border-outline-variant/30 text-center text-on-surface-variant">{err}</div>}
          {loading && <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center text-on-surface-variant">{t('common.loading')}</div>}

          {!loading && !err && (
            <>
              {/* ── 넓은 화면: 레벨 | 교재 | 강의 3열.
                  ⚠️ 열 높이를 h-[...] 로 못박지 말 것. 레벨당 교재가 1권이라 화면 높이로 고정하면
                     한 줄 밑으로 수백 px 가 텅 빈 검은 상자가 된다(2026-08-06 그렇게 만들었다가 반려).
                  ⚠️ items-start 도 필수 — 안 주면 세 열이 stretch 로 가장 긴 열(강의)에 맞춰져
                     교재 열 아래가 또 빈다. 각 열은 자기 내용만큼만 서고, max-h 를 넘길 때만 스크롤한다.
                  ⚠️ "항목이 많아지면?" 은 표지·썸네일을 줄일 이유가 아니다 — 그건 이 열 스크롤(또는 나중에
                     페이지 나누기)이 푸는 문제다. 크기를 다시 줄이지 말 것. */}
              <div className="hidden lg:flex gap-4 items-start [&>section]:max-h-[calc(100dvh-208px)]">
                <Pane title={t('ll.level_col')} className="w-[276px] shrink-0">
                  <ul className="p-2.5">
                    {levels.map((lv) => {
                      const on = lv.key === level
                      return (
                        <li key={String(lv.key)}>
                          <button
                            type="button"
                            onClick={() => { setLevel(lv.key); setPlaying(null) }}
                            aria-current={on ? 'true' : undefined}
                            className={`w-full flex items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors ${on ? 'bg-surface-container-high text-on-surface' : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'}`}
                          >
                            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: lv.color, opacity: on ? 1 : 0.42 }} />
                            <span className="min-w-0 flex-1">
                              <span className={`block truncate font-title-md text-[17px] ${on ? 'font-bold' : 'font-semibold'}`}>{levelName(lv.key)}</span>
                              <span className="mt-0.5 block font-body-md text-[14px] text-outline">{t('ll.count', { b: lv.books, v: lv.lectures })}</span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </Pane>

                <Pane title={t('ll.books')} count={books.length} className="flex-1 min-w-0">
                  {books.length === 0 ? <PaneEmpty text={t('ll.no_books')} /> : bookList}
                </Pane>

                <Pane title={t('ll.lectures')} count={lectures.length} className="flex-1 min-w-0" foot={t('ll.demo_note')}>
                  {lectures.length === 0 ? <PaneEmpty text={t('ll.no_lectures')} /> : lectureList}
                </Pane>
              </div>

              {/* ── 좁은 화면: 레벨은 가로 칩, 교재/강의는 탭 하나로 접는다. */}
              <div className="lg:hidden">
                <div className="mb-3 flex gap-2 overflow-x-auto rounded-2xl border border-outline-variant bg-surface-container-low px-3 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {levels.map((lv) => {
                    const on = lv.key === level
                    return (
                      <button
                        key={String(lv.key)}
                        type="button"
                        onClick={() => { setLevel(lv.key); setPlaying(null) }}
                        className={`flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 font-label-md text-[16px] transition-colors ${on ? 'bg-surface-container-high text-on-surface font-bold' : 'text-on-surface-variant'}`}
                      >
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: lv.color, opacity: on ? 1 : 0.42 }} />
                        {lv.key === 'any' ? t('ll.any_level') : `Lv.${lv.key}`}
                      </button>
                    )
                  })}
                </div>

                <p className="mb-3 px-1 font-body-md text-[16px] leading-[24px] text-on-surface-variant break-keep">
                  <b className="text-on-surface">{levelName(level)}</b> — {levelDesc}
                </p>

                {/* 여기도 h-[...] 고정 금지 — 위 3열과 같은 이유(항목 1개일 때 빈 검은 상자가 된다). */}
                <div className="flex flex-col max-h-[calc(100dvh-268px)] rounded-2xl border border-outline-variant bg-surface-container-low ambient-shadow overflow-hidden">
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
                      ? (books.length === 0 ? <PaneEmpty text={t('ll.no_books')} /> : bookList)
                      : (lectures.length === 0 ? <PaneEmpty text={t('ll.no_lectures')} /> : lectureList)}
                  </div>
                  {pane === 'lectures' && (
                    <p className="shrink-0 border-t border-outline-variant/70 px-4 py-2.5 font-body-md text-[14px] text-outline">{t('ll.demo_note')}</p>
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

/** 열 한 칸 — 머리말(고정) + 본문(넘칠 때만 자기 안에서 세로 스크롤) + 선택적 꼬리말. */
function Pane({
  title, count, foot, className = '', children,
}: {
  title: string
  count?: number
  foot?: string
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
      {foot && (
        <p className="shrink-0 border-t border-outline-variant/70 px-4 py-2.5 font-body-md text-[14px] text-outline">{foot}</p>
      )}
    </section>
  )
}

function PaneEmpty({ text }: { text: string }) {
  return <div className="px-5 py-10 text-center font-body-md text-body-md text-outline break-keep">{text}</div>
}

/** 교재 한 줄 — 표지(탭하면 확대) + 제목 + 가격/버튼.
 *    표지는 열 폭의 1/3 정도로 크게 세운다. 목록이라고 썸네일을 줄이면 표지 글자가 아무 데서도 안 읽힌다. */
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
      <button type="button" onClick={onZoom} aria-label={t('ebook.cover_zoom')} className="w-[34%] max-w-[168px] shrink-0 self-start cursor-zoom-in">
        <EbookCover title={b.title} coverUrl={b.coverUrl} width={336} className="w-full" />
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

/** 강의 한 줄 — 열 폭을 꽉 채운 16:9 썸네일 + 제목. 누르면 **그 자리에서** 유튜브 플레이어로 바뀐다.
 *    처음부터 iframe 을 깔지 않는 이유: 줄 수만큼 플레이어가 로드돼 열이 눈에 띄게 무거워진다.
 *    ⚠️ 목록이라고 썸네일을 작게 줄이지 말 것 — 강의가 많아지는 건 이 열의 스크롤이 푸는 문제다. */
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
