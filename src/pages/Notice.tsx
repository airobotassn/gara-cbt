import { useState } from 'react'
import { useT } from '../lib/i18n'
import SiteFooter from '../components/SiteFooter'

// gara_2 (공지사항) 목업 디자인 그대로 + 실제 동작(네비·로그인·필터·펼침) 연결.
// 원본: stitch_design_critique_assistant/gara_2/code.html

// 내부 필터/카테고리 값은 안정적인 영문 키로 유지(번역 라벨은 t()로 렌더)
const FILTERS = ['all', 'guide', 'general', 'maintenance', 'event']

// 실제 공지 데이터(i18n) — 목업 카드 디자인에 채워 동작하게
const NOTICES = [
  { id: 'item1', date: '2026. 06. 25', cat: 'guide', tagKey: 'notice', tagClass: 'bg-[#004ac6] text-white' },
  { id: 'item2', date: '2026. 06. 20', cat: 'guide', tagKey: 'guide', tagClass: 'bg-surface-container-high text-on-surface' },
  { id: 'item3', date: '2026. 06. 15', cat: 'general', tagKey: 'required', tagClass: 'bg-error/10 text-error' },
]

export default function Notice() {
  const { t } = useT()
  const [filter, setFilter] = useState('all')
  const [openId, setOpenId] = useState<string | null>(null)

  const list = filter === 'all' ? NOTICES : NOTICES.filter((n) => n.cat === filter)
  const featured = list[0]
  const rest = list.slice(1)

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
          <div className="absolute inset-0 bg-gradient-to-b from-[#004ac6]/5 to-transparent pointer-events-none"></div>
          <div className="relative z-10 px-4">
            <span className="inline-block px-4 py-1.5 rounded-full bg-surface-container-lowest/60 text-[#004ac6] font-label-sm text-label-sm uppercase tracking-wider mb-6 shadow-sm border border-white/50 backdrop-blur-md">Notice / Announcements</span>
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
              <button key={f} onClick={() => setFilter(f)} className="px-6 py-2.5 rounded-full bg-[#004ac6] text-white font-label-md text-label-md whitespace-nowrap shadow-sm hover:bg-[#003ea8] transition-colors">{t(`notice.filter_${f}`)}</button>
            ) : (
              <button key={f} onClick={() => setFilter(f)} className="px-6 py-2.5 rounded-full bg-surface-container-lowest border border-outline-variant/50 text-on-surface-variant hover:border-[#004ac6] hover:text-[#004ac6] transition-colors font-label-md text-label-md whitespace-nowrap shadow-sm">{t(`notice.filter_${f}`)}</button>
            ),
          )}
        </div>

        {list.length === 0 && (
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 p-12 text-center text-on-surface-variant">
            {t('notice.empty', { filter: t(`notice.filter_${filter}`) })}
          </div>
        )}

        {/* Featured Announcement */}
        {featured && (
          <div className="group relative block w-full bg-surface-container-lowest rounded-2xl border border-[#004ac6]/20 p-8 md:p-10 mb-8 transition-all duration-300 hover:shadow-lg hover:border-[#004ac6]/40 overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-[#004ac6]/5 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>
            <div className="relative z-10 flex flex-col md:flex-row gap-6 md:items-start justify-between">
              <div className="flex-grow">
                <div className="flex items-center gap-3 mb-4">
                  <span className={`${featured.tagClass} px-3 py-1 rounded-full font-label-sm text-label-sm tracking-wide`}>{t(`notice.tag_${featured.tagKey}`)}</span>
                  <span className="text-on-surface-variant font-label-md text-label-md flex items-center gap-1.5"><span className="material-symbols-outlined text-[18px]">calendar_today</span>{featured.date}</span>
                </div>
                <h2 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface mb-4 break-keep">{t(`notice.${featured.id}.title`)}</h2>
                <p className="font-body-lg text-body-lg text-on-surface-variant max-w-3xl leading-relaxed">{t(`notice.${featured.id}.body`)}</p>
              </div>
            </div>
          </div>
        )}

        {/* Refined List View */}
        {rest.length > 0 && (
          <div className="flex flex-col gap-0 border-t border-outline-variant/30">
            {rest.map((n) => {
              const isOpen = openId === n.id
              return (
                <button
                  key={n.id}
                  onClick={() => setOpenId(isOpen ? null : n.id)}
                  className="group block w-full text-left py-6 border-b border-outline-variant/30 hover:bg-surface-container-low/50 transition-colors px-4 -mx-4 rounded-xl"
                >
                  <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-8">
                    <div className="flex items-center gap-4 md:w-48 flex-shrink-0">
                      <span className={`${n.tagClass} px-3 py-1 rounded-md font-label-sm text-label-sm whitespace-nowrap min-w-[60px] text-center`}>{t(`notice.tag_${n.tagKey}`)}</span>
                      <span className="text-outline font-label-md text-label-md whitespace-nowrap">{n.date}</span>
                    </div>
                    <div className="flex-grow flex items-center justify-between gap-4">
                      <h3 className={`font-title-md text-title-md text-on-surface group-hover:text-[#004ac6] transition-colors ${isOpen ? '' : 'line-clamp-1'}`}>{t(`notice.${n.id}.title`)}</h3>
                      <span className={`material-symbols-outlined text-outline group-hover:text-[#004ac6] transition-all duration-300 hidden md:block ${isOpen ? 'rotate-90' : ''}`}>arrow_forward</span>
                    </div>
                  </div>
                  {isOpen && (
                    <p className="mt-4 md:pl-[calc(12rem+2rem)] font-body-md text-body-md text-on-surface-variant leading-relaxed">{t(`notice.${n.id}.body`)}</p>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  )
}
