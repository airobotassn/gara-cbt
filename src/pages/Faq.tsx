import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { loadBoardCats, catName, type BoardCat } from '../lib/boardCats'

// gara_1 (고객센터) 목업 디자인 + 실제 동작(검색·카테고리 필터·아코디언) 연결.
// 데이터는 DB(faqs, 6개국어)에서 로드 — 관리자(admin 함수)에서 등록/수정.
//
// 사이드바 분류도 DB 다(board_categories, kind='faq' — 2026-08-19). 관리자가 만들고 지운다.
//   ⛔ 분류가 지워진 FAQ 는 여기서 안 보인다(글은 남아 있고 관리자 '미분류' 에서 다시 지정하면 돌아온다).
//      아이콘이 비어 있으면 기본 아이콘을 쓴다 — 새 분류를 만들 때 아이콘은 선택이다.
const FALLBACK_ICON = 'help'

interface Row {
  id: string
  category: string
  question_i18n: Record<string, string>
  answer_i18n: Record<string, string>
  tag_i18n: Record<string, string>
  sort: number
}

export default function Faq() {
  const { t, lang } = useT()
  // null = 아직 못 받음. 첫 분류를 기본 선택으로 삼는다(예전엔 'schedule' 하드코딩이었다).
  const [cats, setCats] = useState<BoardCat[] | null>(null)
  const [cat, setCat] = useState<string>('')
  const [open, setOpen] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const resultsRef = useRef<HTMLDivElement>(null)

  // 검색은 타이핑하는 대로 걸러진다(그건 그대로 둔다). 엔터·버튼이 하는 일은
  //   ① 모바일 키보드를 접고 ② 히어로 아래에 있는 결과로 스크롤해 주는 것뿐이다.
  //   ⚠️ 여기서 필터를 '확정' 방식으로 바꾸지 말 것 — 지금 화면은 한 글자마다 반응하는 게 기본 동작이다.
  function onSearch(e: React.FormEvent) {
    e.preventDefault()
    ;(document.activeElement as HTMLElement | null)?.blur()
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useEffect(() => {
    let alive = true
    loadBoardCats('faq').then((c) => {
      if (!alive) return
      setCats(c)
      // 아직 아무것도 안 고른 상태면 첫 분류로. 사용자가 이미 골랐으면 건드리지 않는다.
      setCat((cur) => cur || c[0]?.key || '')
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!isSupabaseConfigured) {
        if (alive) setLoading(false)
        return
      }
      const { data } = await supabase
        .from('faqs')
        .select('id, category, question_i18n, answer_i18n, tag_i18n, sort')
        .eq('published', true)
        .order('sort', { ascending: true })
        .order('created_at', { ascending: true })
      if (alive) {
        setRows((data as Row[] | null) ?? [])
        setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const pick = (m: Record<string, string> | null | undefined) => m?.[lang] ?? m?.ko ?? ''

  const q = query.trim().toLowerCase()
  const searching = q.length > 0
  const catList = cats ?? []
  // ⚠️ 지워진 분류의 글은 목록에서 뺀다 — 검색 결과에서도 마찬가지다(안 빼면 사이드바엔 없는 글이 검색으로 나온다).
  const known = new Set(catList.map((c) => c.key))
  const live = rows.filter((f) => known.has(f.category))
  const list = live.filter((f) =>
    searching
      ? pick(f.question_i18n).toLowerCase().includes(q) || pick(f.answer_i18n).toLowerCase().includes(q)
      : f.category === cat,
  )
  const catLabel = (key: string) => catName(catList.find((c) => c.key === key), lang) || t('faq.title')
  // 항목이 있는 카테고리만 사이드바에 노출(빈 탭 숨김). 로딩 중엔 전체 유지(깜빡임 방지),
  // 현재 선택된 탭은 비어도 유지(선택 탭이 사라지는 혼란 방지).
  const visibleCats = loading ? catList : catList.filter((c) => c.key === cat || live.some((f) => f.category === c.key))

  const helpBox = (
    <div className="p-6 rounded-xl bg-surface-container-low border border-outline-variant/20 shadow-sm">
      <h3 className="font-title-md font-bold mb-2">{t('faq.help_title')}</h3>
      <p className="text-sm text-on-surface-variant mb-4">{t('faq.help_body')}</p>
      {/* FAQ 를 다 읽고도 안 풀렸으면 갈 곳은 공지사항이 아니라 **1:1 문의**다(2026-08-20).
          ⚠️ /mypage 는 로그인 전용이라 비로그인은 로그인 화면으로 간다 — 문의는 답변을 받을 계정이
             있어야 성립하므로 그게 맞는 흐름이다. */}
      <Link className="group inline-flex items-center gap-1.5 text-primary font-label-md hover:text-primary-container transition-colors" to="/mypage/inquiry">
        <span className="group-hover:underline">{t('faq.help_link')}</span>
        <span className="material-symbols-outlined text-base transition-transform group-hover:translate-x-0.5">arrow_forward</span>
      </Link>
    </div>
  )

  return (
    <div className="bg-background text-on-background font-body-md min-h-screen flex flex-col relative overflow-x-hidden">
      {/* Main Content Canvas (헤더 없음 — FAB이 네비) */}
      <main className="flex-grow w-full pb-24 pt-12">
        {/* 홈으로 — 헤더가 없는 화면이라(FAB 이 네비) 여기 말고는 홈으로 갈 길이 FAB 뿐이었다.
            ⚠️ main 에 폭 제한이 없어서 아래 히어로와 같은 컨테이너로 감싼다(안 그러면 칩만 화면 끝에 붙는다). */}
        <div className="px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto">
          <Link to="/" className="gd-back mb-6">
            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
            {t('common.home')}
          </Link>
        </div>

        {/* Hero Section */}
        <div className="px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto mb-10 mt-8">
          <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-6 md:p-10 relative overflow-hidden shadow-sm mesh-gradient">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-secondary/5 pointer-events-none"></div>
            <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-12">
              {/* 오른쪽 카드 2장(CARIS PLAN·자격 검증)은 2026-08-20 제거 — 폭을 절반으로
                  두면 데스크톱에서 히어로 오른쪽이 통째로 텅 빈다. */}
              <div className="w-full">
                <span className="inline-flex items-center gap-2 pl-2.5 pr-4 py-1.5 rounded-full bg-surface-container-lowest/70 text-primary font-title-md text-label-md font-semibold mb-6 shadow-sm border border-primary/15 backdrop-blur-md">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary"><span className="material-symbols-outlined text-[16px]">support_agent</span></span>
                  {t('faq.eyebrow2')}
                </span>
                <h1 className="font-display-lg text-4xl md:text-[56px] leading-[1.1] font-bold mb-6 tracking-tight text-on-surface break-keep">
                  {t('faq.hero_title')} <br /><span className="text-primary">{t('faq.hero_title_em')}</span>
                </h1>
                {/* 엔터 버튼은 메인(랜딩) 검색창과 같은 물건이다 — 같은 클래스(`.lp-search-btn`)를 쓴다.
                    ⚠️ 색·크기를 여기서 다시 쓰지 말 것: 두 벌이 되면 메인만 고쳤을 때 조용히 갈린다. */}
                <form className="relative group max-w-xl" onSubmit={onSearch}>
                  {/* ⚠️ z-10 필수 — input 의 `backdrop-blur-sm` 이 스태킹 컨텍스트를 만들어서
                      앞에 있는 절대배치 아이콘을 덮어버린다(그동안 돋보기가 안 보이던 이유). */}
                  <span className="material-symbols-outlined absolute left-5 top-1/2 -translate-y-1/2 z-10 text-primary/60 group-focus-within:text-primary transition-colors text-xl">search</span>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="w-full bg-surface-container-lowest/80 backdrop-blur-sm border border-outline-variant/50 rounded-2xl py-4 pl-14 pr-[68px] text-body-lg focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all shadow-sm outline-none placeholder:text-on-surface-variant/50"
                    placeholder={t('faq.search_ph')}
                    type="text"
                  />
                  <button
                    className="lp-search-btn absolute right-2 top-1/2 -translate-y-1/2"
                    type="submit"
                    aria-label={t('faq.search_go')}
                  >
                    →
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>

        {/* Asymmetrical Layout: Categories & Content */}
        <div className="px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto flex flex-col lg:flex-row gap-12 lg:gap-20">
          {/* Sidebar */}
          <aside className="w-full lg:w-1/4 shrink-0">
            <div className="sticky top-12">
              <nav className="flex flex-col gap-2">
                {visibleCats.map((c) => {
                  const active = c.key === cat && !searching
                  const count = live.filter((f) => f.category === c.key).length
                  return active ? (
                    <button key={c.key} onClick={() => { setCat(c.key); setQuery('') }} className="flex items-center gap-4 p-4 rounded-xl transition-all text-left shadow-md bg-primary-container text-on-primary">
                      <span className="material-symbols-outlined text-white/80">{c.icon || FALLBACK_ICON}</span>
                      <div><span className="block font-title-md text-base font-semibold">{catName(c, lang)}</span></div>
                    </button>
                  ) : (
                    <button key={c.key} onClick={() => { setCat(c.key); setQuery('') }} className="flex items-center justify-between gap-4 p-4 rounded-xl hover:bg-surface-container-low text-on-surface-variant hover:text-on-surface transition-all text-left group">
                      <span className="flex items-center gap-4">
                        <span className="material-symbols-outlined text-outline-variant group-hover:text-primary transition-colors">{c.icon || FALLBACK_ICON}</span>
                        <span className="block font-title-md text-base font-semibold group-hover:text-primary transition-colors">{catName(c, lang)}</span>
                      </span>
                      {count > 0 && <span className="font-label-sm text-label-sm text-outline">{count}</span>}
                    </button>
                  )
                })}
              </nav>
              <div className="hidden lg:block mt-12">{helpBox}</div>
            </div>
          </aside>

          {/* Main FAQ Content */}
          <div className="w-full lg:w-3/4" ref={resultsRef}>
            <div className="mb-8 pb-6 border-b border-outline-variant/40">
              {/* 분류 이름 밑 설명문은 없앴다(2026-08-20) — 검색 결과일 때 '‘…’ 관련 문항입니다' 만 남는다. */}
              <h2 className={`font-headline-lg text-2xl md:text-headline-lg font-bold text-on-surface break-keep ${searching ? 'mb-2' : ''}`}>{searching ? t('faq.search_results') : catLabel(cat)}</h2>
              {searching && <p className="text-on-surface-variant font-body-md">{t('faq.searching_sub', { query })}</p>}
            </div>
            <div className="flex flex-col gap-6">
              {list.map((f) => {
                const isOpen = open === f.id
                const tag = pick(f.tag_i18n)
                return (
                  <div
                    key={f.id}
                    onClick={() => setOpen(isOpen ? null : f.id)}
                    className={
                      isOpen
                        ? 'bg-surface-container-lowest border-2 border-primary/20 rounded-xl p-6 shadow-sm cursor-pointer'
                        : 'group bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-6 hover:border-primary/40 hover:shadow-md transition-all cursor-pointer'
                    }
                  >
                    <div className="flex justify-between items-start gap-4">
                      <div className="flex-grow">
                        {tag && (
                          <div className="flex items-center gap-2 mb-2">
                            <span className={isOpen
                              ? 'px-2 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-bold tracking-wider uppercase'
                              : 'px-2 py-0.5 rounded bg-surface-container text-primary text-[10px] font-bold tracking-wider uppercase'}>
                              {tag}
                            </span>
                          </div>
                        )}
                        <h3 className={isOpen
                          ? 'font-title-md text-lg font-bold text-primary'
                          : 'font-title-md text-lg font-bold text-on-surface group-hover:text-primary-container transition-colors'}>
                          {pick(f.question_i18n)}
                        </h3>
                      </div>
                      <span className={isOpen ? 'material-symbols-outlined text-primary' : 'material-symbols-outlined text-outline-variant group-hover:text-primary transition-colors'}>
                        {isOpen ? 'do_not_disturb_on' : 'add_circle'}
                      </span>
                    </div>
                    {isOpen && (
                      <div className="mt-4 pt-4 border-t border-outline-variant/10">
                        <p className="text-on-surface-variant font-body-md leading-relaxed whitespace-pre-line">{pick(f.answer_i18n)}</p>
                      </div>
                    )}
                  </div>
                )
              })}
              {loading && (
                <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-10 text-center text-on-surface-variant">
                  {t('common.loading')}
                </div>
              )}
              {!loading && list.length === 0 && (
                <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-10 text-center text-on-surface-variant">
                  {searching ? t('faq.no_results', { query }) : t('faq.cat_empty')}
                </div>
              )}
            </div>
          </div>
          <div className="lg:hidden">{helpBox}</div>
        </div>
      </main>

    </div>
  )
}
