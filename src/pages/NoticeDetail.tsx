import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import DOMPurify from 'dompurify'
import { useT } from '../lib/i18n'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

// 공지 상세 페이지 (/notice/:id) — 게시판 글 상세. 본문은 리치 HTML(관리자 WYSIWYG 작성)을
// DOMPurify 로 sanitize 후 렌더. 구 평문 공지(태그 없음)는 줄바꿈 유지(pre-line) + URL 링크.
const CAT_CLASS: Record<string, string> = {
  guide: 'bg-surface-container-high text-on-surface',
  schedule: 'bg-primary/10 text-primary',
  maintenance: 'bg-surface-container-high text-on-surface-variant',
  event: 'bg-secondary/10 text-secondary',
}
const REQUIRED_CLASS = 'bg-error/10 text-error'

interface Row {
  id: string
  category: string
  required: boolean
  title: string | null
  title_ko?: string | null
  body: string | null
  body_ko?: string | null
  published_at: string
}

// 현재 언어(+한국어 폴백) 컬럼만 JSONB 투영
function projFor(lang: string): string {
  return lang === 'ko'
    ? 'title:title_i18n->>ko, body:body_i18n->>ko'
    : `title:title_i18n->>${lang}, title_ko:title_i18n->>ko, body:body_i18n->>${lang}, body_ko:body_i18n->>ko`
}
function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}. ${p(d.getMonth() + 1)}. ${p(d.getDate())}`
}
const looksHtml = (s: string) => /<\/?[a-z][\s\S]*>/i.test(s)

// 평문 공지용 URL → 링크(구 데이터 호환)
const URL_RE = /(https?:\/\/[^\s<>"'()]+)/g
function linkify(text: string) {
  return text.split(URL_RE).map((part, i) => {
    if (i % 2 === 0) return part
    const url = part.replace(/[.,;:!?]+$/, '')
    const tail = part.slice(url.length)
    return (
      <span key={i}>
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 break-all hover:opacity-80">{url}</a>
        {tail}
      </span>
    )
  })
}

export default function NoticeDetail() {
  const { id } = useParams()
  const { t, lang } = useT()
  const [row, setRow] = useState<Row | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isSupabaseConfigured || !id) {
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    supabase
      .from('notices')
      .select(`id, category, required, ${projFor(lang)}, published_at`)
      .eq('published', true)
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return
        setRow((data as unknown as Row | null) ?? null)
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [id, lang])

  const title = row ? row.title || row.title_ko || '' : ''
  const body = row ? row.body || row.body_ko || '' : ''

  return (
    <div className="bg-background text-on-surface min-h-screen relative overflow-x-hidden flex flex-col">
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-[-1]">
        <div className="ambient-mesh bg-surface-mesh-blue top-[-20%] left-[-10%]"></div>
        <div className="ambient-mesh bg-surface-mesh-cyan bottom-[-20%] right-[-10%]"></div>
      </div>

      <main className="flex-grow pt-12 pb-24 px-margin-mobile md:px-margin-desktop max-w-3xl mx-auto w-full">
        <Link to="/notice" className="inline-flex items-center gap-1.5 text-on-surface-variant hover:text-primary font-label-md text-label-md mb-6 transition-colors">
          <span className="material-symbols-outlined text-[20px]">arrow_back</span>
          {t('notice.back_list')}
        </Link>

        {loading && (
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 p-12 text-center text-on-surface-variant">{t('common.loading')}</div>
        )}

        {!loading && !row && (
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 p-12 text-center text-on-surface-variant">{t('notice.not_found')}</div>
        )}

        {!loading && row && (
          <article className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 p-8 md:p-10 ambient-shadow">
            <div className="flex items-center gap-3 mb-5 flex-wrap">
              {row.required && (
                <span className={`${REQUIRED_CLASS} px-3 py-1 rounded-full font-label-sm text-label-sm tracking-wide`}>{t('notice.tag_required')}</span>
              )}
              <span className={`${CAT_CLASS[row.category] ?? CAT_CLASS.guide} px-3 py-1 rounded-full font-label-sm text-label-sm tracking-wide`}>{t(`notice.filter_${row.category}`)}</span>
              <span className="text-on-surface-variant font-label-md text-label-md flex items-center gap-1.5"><span className="material-symbols-outlined text-[18px]">calendar_today</span>{fmtDate(row.published_at)}</span>
            </div>
            <h1 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface mb-7 break-keep border-b border-outline-variant/30 pb-6">{title}</h1>
            {looksHtml(body) ? (
              <div className="notice-content text-body-lg" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(body) }} />
            ) : (
              <div className="notice-content text-body-lg whitespace-pre-line break-keep">{linkify(body)}</div>
            )}
          </article>
        )}
      </main>

    </div>
  )
}
