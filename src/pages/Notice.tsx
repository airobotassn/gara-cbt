import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { loadBoardCats, catName, type BoardCat } from '../lib/boardCats'

// gara_2 (공지사항) — 게시판 목록. 항목 클릭 → 상세 페이지(/notice/:id)로 이동(구 인라인 아코디언 폐지).
// 데이터는 DB(notices)에서 로드 — 관리자(admin 함수)에서 등록/수정(리치 HTML 본문).
// 페이로드 절약: 목록은 제목만(현재 언어 +ko 폴백) 받고, 10건 단위 페이지네이션(더보기).
// 제목 밑 본문 미리보기는 없앴다(2026-08-20) — 그래서 목록 조회에 body 를 아예 안 싣는다.
// 구 딥링크 /notice?id=<uuid> 는 /notice/<uuid> 로 리다이렉트(공유 링크 호환).

// 분류는 DB(board_categories)에서 온다 — 관리자가 만들고 지운다(2026-08-19). 여기 목록을 박지 말 것.
//
// ⚠️ **분류 배지는 색을 나누지 않는다.** 예전엔 분류마다 색이 달랐는데, 분류가 4개일 때도 무슨 색이
//    무슨 분류인지 아무도 못 외웠고, 관리자가 분류를 늘릴 수 있게 되면서 새 분류의 색을 정하는 문제만
//    남았다. 눈에 띄어야 하는 건 빨간 '필독' 하나다(2026-08-19 결정).
const CAT_CLASS = 'bg-surface-container-high text-on-surface-variant'
const REQUIRED_CLASS = 'bg-error/10 text-error'

const PAGE_SIZE = 10

interface Row {
  id: string
  category: string
  required: boolean
  title: string | null
  title_ko?: string | null
  pinned: boolean
  published_at: string
}

function projFor(lang: string): string {
  return lang === 'ko'
    ? 'title:title_i18n->>ko'
    : `title:title_i18n->>${lang}, title_ko:title_i18n->>ko`
}

// ⚠️ catKeys = 지금 있는 분류 전부. '전체' 에서도 이걸로 걸러야 **지워진 분류의 글이 안 보인다**
//    (그 글들은 삭제되지 않고 관리자 쪽 '미분류' 에 남아 있다 — lib/boardCats.ts 주석 참고).
async function fetchPage(filter: string, lang: string, offset: number, catKeys: string[]): Promise<Row[]> {
  let q = supabase
    .from('notices')
    .select(`id, category, required, ${projFor(lang)}, pinned, published_at`)
    .eq('published', true)
  q = filter !== 'all' ? q.eq('category', filter) : q.in('category', catKeys)
  const { data } = await q
    .order('pinned', { ascending: false })
    .order('published_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)
  return (data as unknown as Row[] | null) ?? []
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}. ${p(d.getMonth() + 1)}. ${p(d.getDate())}`
}

export default function Notice() {
  const { t, lang } = useT()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [filter, setFilter] = useState('all')
  // null = 아직 못 받음. 빈 배열(=분류가 하나도 없음)과 구분해야 한다 — 못 받은 동안 목록을 조회하면
  // 걸러낼 키가 없어서 빈 게시판이 한 번 스친다.
  const [cats, setCats] = useState<BoardCat[] | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const reqRef = useRef(0) // 필터/언어 변경 중 도착한 옛 응답 무시용

  // 구 공유 링크 /notice?id=<uuid> → 상세 페이지로 승격
  useEffect(() => {
    const id = searchParams.get('id')
    if (id) navigate(`/notice/${id}`, { replace: true })
  }, [])

  // 분류 먼저(한 번만). 언어가 바뀌어도 다시 안 받는다 — 6개국어 이름이 한 행에 다 들어 있다.
  useEffect(() => {
    let alive = true
    loadBoardCats('notice').then((c) => {
      if (alive) setCats(c)
    })
    return () => {
      alive = false
    }
  }, [])

  const catKeys = (cats ?? []).map((c) => c.key)
  const catKeysSig = catKeys.join(',') // 배열은 렌더마다 새 참조라 deps 에 그대로 못 넣는다

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }
    if (cats === null) return // 분류를 받기 전엔 조회하지 않는다(위 주석)
    const req = ++reqRef.current
    setLoading(true)
    ;(async () => {
      const page = await fetchPage(filter, lang, 0, catKeysSig ? catKeysSig.split(',') : [])
      if (reqRef.current !== req) return
      setRows(page)
      setHasMore(page.length === PAGE_SIZE)
      setLoading(false)
    })()
  }, [filter, lang, cats, catKeysSig])

  async function loadMore() {
    if (loadingMore || loading) return
    const req = reqRef.current
    setLoadingMore(true)
    const page = await fetchPage(filter, lang, rows.length, catKeys)
    if (reqRef.current === req) {
      setRows((prev) => {
        const seen = new Set(prev.map((r) => r.id))
        return [...prev, ...page.filter((r) => !seen.has(r.id))]
      })
      setHasMore(page.length === PAGE_SIZE)
    }
    setLoadingMore(false)
  }

  /** 분류 이름 — 'all' 만 사전(전체)이고 나머지는 DB 에서 온 이름이다. */
  const filterLabel = (key: string) =>
    key === 'all' ? t('notice.filter_all') : catName((cats ?? []).find((c) => c.key === key), lang)

  const title = (n: Row) => n.title || n.title_ko || ''

  const featured = rows[0]
  const rest = rows.slice(1)

  return (
    <div className="bg-background text-on-surface min-h-screen relative overflow-x-hidden flex flex-col">
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-[-1]">
        <div className="ambient-mesh bg-surface-mesh-blue top-[-20%] left-[-10%]"></div>
        <div className="ambient-mesh bg-surface-mesh-cyan bottom-[-20%] right-[-10%]"></div>
      </div>

      <main className="flex-grow pt-12 pb-24 px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto w-full">
        {/* Hero */}
        <div className="relative py-10 md:py-16 mb-12 rounded-3xl overflow-hidden glass-panel border border-white/40 shadow-sm flex flex-col items-center justify-center text-center">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none"></div>
          <div className="relative z-10 px-4">
            <span className="inline-flex items-center gap-2 pl-2.5 pr-4 py-1.5 rounded-full bg-surface-container-lowest/60 text-primary font-label-md text-label-md mb-6 shadow-sm border border-white/50 backdrop-blur-md">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary"><span className="material-symbols-outlined text-[16px]">campaign</span></span>
              {t('notice.eyebrow')}
            </span>
            <h1 className="font-display-lg text-4xl md:text-display-lg text-on-surface tracking-tight break-keep">{t('nav.notice')}</h1>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 overflow-x-auto pb-6 mb-8 scrollbar-hide border-b border-outline-variant/30">
          {['all', ...catKeys].map((f) =>
            f === filter ? (
              <button key={f} onClick={() => setFilter(f)} className="px-6 py-2.5 rounded-full bg-primary text-on-primary font-label-md text-label-md whitespace-nowrap shadow-sm hover:opacity-90 transition-colors">{filterLabel(f)}</button>
            ) : (
              <button key={f} onClick={() => setFilter(f)} className="px-6 py-2.5 rounded-full bg-surface-container-lowest border border-outline-variant/50 text-on-surface-variant hover:border-primary hover:text-primary transition-colors font-label-md text-label-md whitespace-nowrap shadow-sm">{filterLabel(f)}</button>
            ),
          )}
        </div>

        {loading && (
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 p-12 text-center text-on-surface-variant">{t('common.loading')}</div>
        )}

        {!loading && rows.length === 0 && (
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 p-12 text-center text-on-surface-variant">{t('notice.empty', { filter: filterLabel(filter) })}</div>
        )}

        {/* Featured — 최신/고정 1건 큰 카드 */}
        {!loading && featured && (
          <Link to={`/notice/${featured.id}`} className="group relative block w-full bg-surface-container-lowest rounded-2xl border border-primary/20 p-8 md:p-10 mb-8 transition-all duration-300 hover:shadow-lg hover:border-primary/40 overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>
            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                {featured.required && (
                  <span className={`${REQUIRED_CLASS} px-3 py-1 rounded-full font-label-sm text-label-sm tracking-wide`}>{t('notice.tag_required')}</span>
                )}
                <span className={`${CAT_CLASS} px-3 py-1 rounded-full font-label-sm text-label-sm tracking-wide`}>{filterLabel(featured.category)}</span>
                <span className="text-on-surface-variant font-label-md text-label-md flex items-center gap-1.5"><span className="material-symbols-outlined text-[18px]">calendar_today</span>{fmtDate(featured.published_at)}</span>
              </div>
              <h2 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface mb-3 break-keep group-hover:text-primary transition-colors">{title(featured)}</h2>
              <span className="inline-flex items-center gap-1 mt-5 text-primary font-label-md text-label-md">{t('notice.read_more')}<span className="material-symbols-outlined text-[18px] group-hover:translate-x-1 transition-transform">arrow_forward</span></span>
            </div>
          </Link>
        )}

        {/* 목록 */}
        {!loading && rest.length > 0 && (
          <div className="flex flex-col gap-0 border-t border-outline-variant/30">
            {rest.map((n) => (
              <Link key={n.id} to={`/notice/${n.id}`} className="group block w-full text-left py-6 px-4 -mx-4 rounded-xl border-b border-outline-variant/30 hover:bg-surface-container-low/50 transition-colors">
                <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-8">
                  <div className="flex items-center gap-3 md:w-56 flex-shrink-0">
                    <div className="flex items-center gap-1.5">
                      {n.required && (
                        <span className={`${REQUIRED_CLASS} px-2.5 py-1 rounded-md font-label-sm text-label-sm whitespace-nowrap`}>{t('notice.tag_required')}</span>
                      )}
                      <span className={`${CAT_CLASS} px-2.5 py-1 rounded-md font-label-sm text-label-sm whitespace-nowrap`}>{filterLabel(n.category)}</span>
                    </div>
                    <span className="text-outline font-label-md text-label-md whitespace-nowrap">{fmtDate(n.published_at)}</span>
                  </div>
                  <div className="flex-grow min-w-0 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="font-title-md text-title-md text-on-surface group-hover:text-primary transition-colors line-clamp-1">{title(n)}</h3>
                    </div>
                    <span className="material-symbols-outlined text-outline group-hover:text-primary group-hover:translate-x-1 transition-all hidden md:block shrink-0">arrow_forward</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {!loading && hasMore && (
          <div className="mt-10 text-center">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="px-8 py-3 rounded-full bg-surface-container-lowest border border-outline-variant/50 text-on-surface-variant hover:border-primary hover:text-primary transition-colors font-label-md text-label-md shadow-sm disabled:opacity-60 disabled:pointer-events-none"
            >
              {loadingMore ? t('common.loading') : t('notice.more')}
            </button>
          </div>
        )}
      </main>

    </div>
  )
}
