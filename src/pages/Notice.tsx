import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import SiteFooter from '../components/SiteFooter'

// gara_2 (공지사항) 목업 디자인 그대로 + 실제 동작(네비·필터·펼침) 연결.
// 데이터는 DB(notices)에서 로드 — 관리자(admin 함수)에서 등록/수정.
// 페이로드 절약: 6개국어 JSONB 통째가 아니라 현재 언어(+ko 폴백)만 투영해서 받고,
// 10건 단위 페이지네이션(더보기). 카테고리 필터는 서버측(.eq)이라 페이지와 무관하게 전체 대상.
// 딥링크: /notice?id=<uuid> 로 진입하면 해당 공지를 펼치고 스크롤(공유·홈 연결용).

// 내부 필터 값은 안정적인 영문 키로 유지(번역 라벨은 t()로 렌더)
const FILTERS = ['all', 'guide', 'schedule', 'maintenance', 'event']

// 분류(category) → 배지 스타일. 카드 배지는 "무슨 안내인지"(분류)를 보여주고,
// 필독 공지는 별도 빨간 배지(REQUIRED_CLASS)로 강조한다.
const CAT_CLASS: Record<string, string> = {
  guide: 'bg-surface-container-high text-on-surface',
  schedule: 'bg-primary/10 text-primary',
  maintenance: 'bg-surface-container-high text-on-surface-variant',
  event: 'bg-secondary/10 text-secondary',
}
const REQUIRED_CLASS = 'bg-error/10 text-error'

const PAGE_SIZE = 10

interface Row {
  id: string
  category: string
  required: boolean
  title: string | null
  title_ko?: string | null
  body: string | null
  body_ko?: string | null
  pinned: boolean
  published_at: string
}

// 현재 언어 + 한국어 폴백 컬럼만 JSONB 투영으로 받는다(나머지 언어 미전송).
// lang 은 i18n 의 고정 코드(ko|en|ja|zh|hi|vi)라 문자열 조립 안전.
function projFor(lang: string): string {
  return lang === 'ko'
    ? 'title:title_i18n->>ko, body:body_i18n->>ko'
    : `title:title_i18n->>${lang}, title_ko:title_i18n->>ko, body:body_i18n->>${lang}, body_ko:body_i18n->>ko`
}

async function fetchPage(filter: string, lang: string, offset: number): Promise<Row[]> {
  let q = supabase
    .from('notices')
    .select(`id, category, required, ${projFor(lang)}, pinned, published_at`)
    .eq('published', true)
  if (filter !== 'all') q = q.eq('category', filter)
  const { data } = await q
    .order('pinned', { ascending: false })
    .order('published_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)
  return (data as unknown as Row[] | null) ?? []
}

// 딥링크로 온 공지가 첫 페이지에 없을 때 단건 조회(잘못된 id 는 null)
async function fetchOne(id: string, lang: string): Promise<Row | null> {
  const { data } = await supabase
    .from('notices')
    .select(`id, category, required, ${projFor(lang)}, pinned, published_at`)
    .eq('published', true)
    .eq('id', id)
    .maybeSingle()
  return (data as unknown as Row | null) ?? null
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}. ${p(d.getMonth() + 1)}. ${p(d.getDate())}`
}

// 본문 내 URL 을 클릭 가능한 링크로(순수 텍스트 공지에 접수 링크 등을 넣을 수 있게).
// 캡처 그룹 split → 홀수 인덱스가 URL. 문장 끝 구두점은 링크에서 제외.
const URL_RE = /(https?:\/\/[^\s<>"'()]+)/g
function linkify(text: string) {
  return text.split(URL_RE).map((part, i) => {
    if (i % 2 === 0) return part
    const url = part.replace(/[.,;:!?]+$/, '')
    const tail = part.slice(url.length)
    return (
      <span key={i}>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 break-all hover:opacity-80"
        >
          {url}
        </a>
        {tail}
      </span>
    )
  })
}

export default function Notice() {
  const { t, lang } = useT()
  const [searchParams, setSearchParams] = useSearchParams()
  const [filter, setFilter] = useState('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const reqRef = useRef(0) // 필터/언어 변경 중 도착한 옛 응답 무시용
  const linkIdRef = useRef<string | null>(searchParams.get('id')) // 진입 시 1회만 적용
  const scrollIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }
    const req = ++reqRef.current
    setLoading(true)
    ;(async () => {
      const page = await fetchPage(filter, lang, 0)
      // 딥링크 공지가 첫 페이지 밖이면 단건으로 받아 목록에 덧붙임
      const linkId = linkIdRef.current
      let extra: Row | null = null
      if (linkId && !page.some((r) => r.id === linkId)) {
        extra = await fetchOne(linkId, lang)
      }
      if (reqRef.current !== req) return
      setRows(extra ? [...page, extra] : page)
      setHasMore(page.length === PAGE_SIZE)
      setLoading(false)
      if (linkId) {
        linkIdRef.current = null
        if (extra || page.some((r) => r.id === linkId)) {
          setOpenId(linkId)
          scrollIdRef.current = linkId
        }
      }
    })()
  }, [filter, lang])

  // 딥링크 대상이 렌더된 뒤 그 위치로 스크롤
  useEffect(() => {
    const id = scrollIdRef.current
    if (!id) return
    const el = document.getElementById(`n-${id}`)
    if (el) {
      scrollIdRef.current = null
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [rows])

  async function loadMore() {
    if (loadingMore || loading) return
    const req = reqRef.current
    setLoadingMore(true)
    const page = await fetchPage(filter, lang, rows.length)
    if (reqRef.current === req) {
      // 페이지 사이에 새 공지가 발행되면 offset이 밀려 중복이 올 수 있음 → id 로 걸러 append
      setRows((prev) => {
        const seen = new Set(prev.map((r) => r.id))
        return [...prev, ...page.filter((r) => !seen.has(r.id))]
      })
      setHasMore(page.length === PAGE_SIZE)
    }
    setLoadingMore(false)
  }

  // 펼침/접힘 + URL ?id= 동기화(주소창 복사만으로 특정 공지 공유 가능)
  function toggle(id: string) {
    const next = openId === id ? null : id
    setOpenId(next)
    const sp = new URLSearchParams(searchParams)
    if (next) sp.set('id', next)
    else sp.delete('id')
    setSearchParams(sp, { replace: true })
  }

  // 현재 언어 텍스트(번역 비어 있으면 한국어 폴백)
  const title = (n: Row) => n.title || n.title_ko || ''
  const body = (n: Row) => n.body || n.body_ko || ''

  const featured = rows[0]
  const rest = rows.slice(1)

  return (
    <div className="bg-background text-on-surface min-h-screen relative overflow-x-hidden flex flex-col">
      {/* Ambient Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-[-1]">
        <div className="ambient-mesh bg-surface-mesh-blue top-[-20%] left-[-10%]"></div>
        <div className="ambient-mesh bg-surface-mesh-cyan bottom-[-20%] right-[-10%]"></div>
      </div>

      {/* Main Content Canvas (헤더 없음 — FAB이 네비) */}
      <main className="flex-grow pt-12 pb-24 px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto w-full">
        {/* Hero Section */}
        <div className="relative py-10 md:py-16 mb-12 rounded-3xl overflow-hidden glass-panel border border-white/40 shadow-sm flex flex-col items-center justify-center text-center">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none"></div>
          <div className="relative z-10 px-4">
            <span className="inline-flex items-center gap-2 pl-2.5 pr-4 py-1.5 rounded-full bg-surface-container-lowest/60 text-primary font-label-md text-label-md mb-6 shadow-sm border border-white/50 backdrop-blur-md">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary"><span className="material-symbols-outlined text-[16px]">campaign</span></span>
              {t('notice.eyebrow')}
            </span>
            <h1 className="font-display-lg text-4xl md:text-display-lg text-on-surface mb-6 tracking-tight break-keep">{t('nav.notice')}</h1>
            <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl mx-auto leading-relaxed">
              {t('notice.hero_sub')}
            </p>
          </div>
        </div>

        {/* Categories / Filters */}
        <div className="flex gap-3 overflow-x-auto pb-6 mb-8 scrollbar-hide border-b border-outline-variant/30">
          {FILTERS.map((f) =>
            f === filter ? (
              <button key={f} onClick={() => setFilter(f)} className="px-6 py-2.5 rounded-full bg-primary text-on-primary font-label-md text-label-md whitespace-nowrap shadow-sm hover:opacity-90 transition-colors">{t(`notice.filter_${f}`)}</button>
            ) : (
              <button key={f} onClick={() => setFilter(f)} className="px-6 py-2.5 rounded-full bg-surface-container-lowest border border-outline-variant/50 text-on-surface-variant hover:border-primary hover:text-primary transition-colors font-label-md text-label-md whitespace-nowrap shadow-sm">{t(`notice.filter_${f}`)}</button>
            ),
          )}
        </div>

        {loading && (
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 p-12 text-center text-on-surface-variant">
            {t('common.loading')}
          </div>
        )}

        {!loading && rows.length === 0 && (
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 p-12 text-center text-on-surface-variant">
            {t('notice.empty', { filter: t(`notice.filter_${filter}`) })}
          </div>
        )}

        {/* Featured Announcement */}
        {!loading && featured && (
          <div id={`n-${featured.id}`} className="group relative block w-full bg-surface-container-lowest rounded-2xl border border-primary/20 p-8 md:p-10 mb-8 transition-all duration-300 hover:shadow-lg hover:border-primary/40 overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>
            <div className="relative z-10 flex flex-col md:flex-row gap-6 md:items-start justify-between">
              <div className="flex-grow">
                <div className="flex items-center gap-3 mb-4">
                  {featured.required && (
                    <span className={`${REQUIRED_CLASS} px-3 py-1 rounded-full font-label-sm text-label-sm tracking-wide`}>{t('notice.tag_required')}</span>
                  )}
                  <span className={`${CAT_CLASS[featured.category] ?? CAT_CLASS.guide} px-3 py-1 rounded-full font-label-sm text-label-sm tracking-wide`}>{t(`notice.filter_${featured.category}`)}</span>
                  <span className="text-on-surface-variant font-label-md text-label-md flex items-center gap-1.5"><span className="material-symbols-outlined text-[18px]">calendar_today</span>{fmtDate(featured.published_at)}</span>
                </div>
                <h2 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface mb-4 break-keep">{title(featured)}</h2>
                <p className="font-body-lg text-body-lg text-on-surface-variant leading-relaxed break-keep whitespace-pre-line">{linkify(body(featured))}</p>
              </div>
            </div>
          </div>
        )}

        {/* Refined List View — 헤더(버튼)와 본문을 분리해 본문 속 링크 클릭이 접힘과 안 겹치게 */}
        {!loading && rest.length > 0 && (
          <div className="flex flex-col gap-0 border-t border-outline-variant/30">
            {rest.map((n) => {
              const isOpen = openId === n.id
              return (
                <div key={n.id} id={`n-${n.id}`} className="border-b border-outline-variant/30">
                  <button
                    onClick={() => toggle(n.id)}
                    className="group block w-full text-left py-6 hover:bg-surface-container-low/50 transition-colors px-4 -mx-4 rounded-xl"
                  >
                    <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-8">
                      <div className="flex items-center gap-3 md:w-56 flex-shrink-0">
                        <div className="flex items-center gap-1.5">
                          {n.required && (
                            <span className={`${REQUIRED_CLASS} px-2.5 py-1 rounded-md font-label-sm text-label-sm whitespace-nowrap`}>{t('notice.tag_required')}</span>
                          )}
                          <span className={`${CAT_CLASS[n.category] ?? CAT_CLASS.guide} px-2.5 py-1 rounded-md font-label-sm text-label-sm whitespace-nowrap`}>{t(`notice.filter_${n.category}`)}</span>
                        </div>
                        <span className="text-outline font-label-md text-label-md whitespace-nowrap">{fmtDate(n.published_at)}</span>
                      </div>
                      <div className="flex-grow flex items-center justify-between gap-4">
                        <h3 className={`font-title-md text-title-md text-on-surface group-hover:text-primary transition-colors ${isOpen ? '' : 'line-clamp-1'}`}>{title(n)}</h3>
                        <span className={`material-symbols-outlined text-outline group-hover:text-primary transition-all duration-300 hidden md:block ${isOpen ? 'rotate-90' : ''}`}>arrow_forward</span>
                      </div>
                    </div>
                  </button>
                  {isOpen && (
                    <p className="pb-6 md:pl-[calc(12rem+2rem)] font-body-md text-body-md text-on-surface-variant leading-relaxed whitespace-pre-line">{linkify(body(n))}</p>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Load More */}
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

      <SiteFooter />
    </div>
  )
}
