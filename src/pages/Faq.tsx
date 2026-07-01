import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../lib/i18n'
import SiteFooter from '../components/SiteFooter'

// gara_1 (고객센터) 목업 디자인 + 실제 동작(검색·카테고리 필터·아코디언) 연결.
// 원본: stitch_design_critique_assistant/gara_1/code.html

// labelKey = i18n 키(인덱스 0~4 순서 고정, FAQS.cat 가 이 인덱스를 참조)
const CATEGORIES = [
  { icon: 'calendar_month', labelKey: 'faq.cat_schedule' },
  { icon: 'computer', labelKey: 'faq.cat_system' },
  { icon: 'credit_card', labelKey: 'faq.cat_payment' },
  { icon: 'workspace_premium', labelKey: 'faq.cat_grading' },
  { icon: 'domain', labelKey: 'faq.cat_corporate' },
]

// 실제 FAQ(i18n) — cat = CATEGORIES 인덱스로 분류해 실제 필터링, tag 라벨도 i18n
const FAQS = [
  { id: 'q1', cat: 1 },
  { id: 'q2', cat: 1 },
  { id: 'q3', cat: 3 },
  { id: 'q4', cat: 3 },
  { id: 'q5', cat: 0 },
  { id: 'q6', cat: 3 },
  { id: 'q7', cat: 0 },
]

export default function Faq() {
  const { t } = useT()
  const [cat, setCat] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const searching = q.length > 0
  // 검색 중이면 전체에서 검색, 아니면 선택한 카테고리로 필터
  const list = FAQS.filter((f) =>
    searching
      ? t(`faq.${f.id}.q`).toLowerCase().includes(q) || t(`faq.${f.id}.a`).toLowerCase().includes(q)
      : f.cat === cat,
  )

  return (
    <div className="bg-background text-on-background font-body-md min-h-screen flex flex-col relative overflow-x-hidden">
      {/* Main Content Canvas (헤더 없음 — FAB이 네비) */}
      <main className="flex-grow w-full pb-24 pt-12">
        {/* Hero Section */}
        <div className="px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto mb-10 mt-8">
          <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-6 md:p-10 relative overflow-hidden shadow-sm mesh-gradient">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-secondary/5 pointer-events-none"></div>
            <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-12">
              <div className="w-full md:w-1/2">
                <span className="inline-flex items-center gap-2 pl-2.5 pr-4 py-1.5 rounded-full bg-surface-container-lowest/70 text-primary font-title-md text-label-md font-semibold mb-6 shadow-sm border border-primary/15 backdrop-blur-md">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary"><span className="material-symbols-outlined text-[16px]">support_agent</span></span>
                  {t('faq.eyebrow2')}
                </span>
                <h1 className="font-display-lg text-4xl md:text-[56px] leading-[1.1] font-bold mb-6 tracking-tight text-on-surface break-keep">
                  {t('faq.hero_title')} <br /><span className="text-primary">{t('faq.hero_title_em')}</span>
                </h1>
                <div className="relative group max-w-xl">
                  <span className="material-symbols-outlined absolute left-5 top-1/2 -translate-y-1/2 text-primary/60 group-focus-within:text-primary transition-colors text-xl">search</span>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="w-full bg-surface-container-lowest/80 backdrop-blur-sm border border-outline-variant/50 rounded-2xl py-4 pl-14 pr-6 text-body-lg focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all shadow-sm outline-none placeholder:text-on-surface-variant/50"
                    placeholder={t('faq.search_ph')}
                    type="text"
                  />
                </div>
              </div>
              <div className="w-full md:w-5/12 hidden md:block">
                <div className="grid grid-cols-2 gap-4">
                  <Link to="/guide" className="glass-card p-6 rounded-2xl flex flex-col gap-3 translate-y-8 hover:shadow-md transition-shadow">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary"><span className="material-symbols-outlined">event_available</span></div>
                    <h3 className="font-title-md text-base font-bold text-on-surface">{t('faq.card_schedule_title')}</h3>
                    <p className="text-sm text-on-surface-variant leading-relaxed">{t('faq.card_schedule_desc')}</p>
                  </Link>
                  <Link to="/mypage" className="glass-card p-6 rounded-2xl flex flex-col gap-3 hover:shadow-md transition-shadow">
                    <div className="w-10 h-10 rounded-full bg-secondary/10 flex items-center justify-center text-secondary"><span className="material-symbols-outlined">verified_user</span></div>
                    <h3 className="font-title-md text-base font-bold text-on-surface">{t('faq.card_verify_title')}</h3>
                    <p className="text-sm text-on-surface-variant leading-relaxed">{t('faq.card_verify_desc')}</p>
                  </Link>
                </div>
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
                {CATEGORIES.map((c, i) => {
                  const active = i === cat && !searching
                  const count = FAQS.filter((f) => f.cat === i).length
                  return active ? (
                    <button key={c.labelKey} onClick={() => { setCat(i); setQuery('') }} className="flex items-center gap-4 p-4 rounded-xl transition-all text-left shadow-md bg-primary-container text-on-primary">
                      <span className="material-symbols-outlined text-white/80">{c.icon}</span>
                      <div><span className="block font-title-md text-base font-semibold">{t(c.labelKey)}</span></div>
                    </button>
                  ) : (
                    <button key={c.labelKey} onClick={() => { setCat(i); setQuery('') }} className="flex items-center justify-between gap-4 p-4 rounded-xl hover:bg-surface-container-low text-on-surface-variant hover:text-on-surface transition-all text-left group">
                      <span className="flex items-center gap-4">
                        <span className="material-symbols-outlined text-outline-variant group-hover:text-primary transition-colors">{c.icon}</span>
                        <span className="block font-title-md text-base font-semibold group-hover:text-primary transition-colors">{t(c.labelKey)}</span>
                      </span>
                      {count > 0 && <span className="font-label-sm text-label-sm text-outline">{count}</span>}
                    </button>
                  )
                })}
              </nav>
              <div className="mt-12 p-6 rounded-xl bg-surface-container-low border border-outline-variant/20 shadow-sm">
                <h3 className="font-title-md font-bold mb-2">{t('faq.help_title')}</h3>
                <p className="text-sm text-on-surface-variant mb-4">{t('faq.help_body')}</p>
                <Link className="group inline-flex items-center gap-1.5 text-primary font-label-md hover:text-primary-container transition-colors" to="/notice">
                  <span className="group-hover:underline">{t('faq.help_link')}</span>
                  <span className="material-symbols-outlined text-base transition-transform group-hover:translate-x-0.5">arrow_forward</span>
                </Link>
              </div>
            </div>
          </aside>

          {/* Main FAQ Content */}
          <div className="w-full lg:w-3/4">
            <div className="mb-8 pb-6 border-b border-outline-variant/40">
              <h2 className="font-headline-lg text-2xl md:text-headline-lg font-bold text-on-surface mb-2 break-keep">{searching ? t('faq.search_results') : t(CATEGORIES[cat].labelKey)}</h2>
              <p className="text-on-surface-variant font-body-md">{searching ? t('faq.searching_sub', { query }) : t('faq.cat_sub')}</p>
            </div>
            <div className="flex flex-col gap-6">
              {list.map((f) => {
                const isOpen = open === f.id
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
                        <div className="flex items-center gap-2 mb-2">
                          <span className={isOpen
                            ? 'px-2 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-bold tracking-wider uppercase'
                            : 'px-2 py-0.5 rounded bg-surface-container text-primary text-[10px] font-bold tracking-wider uppercase'}>
                            {t(`faq.${f.id}.tag`)}
                          </span>
                        </div>
                        <h3 className={isOpen
                          ? 'font-title-md text-lg font-bold text-primary'
                          : 'font-title-md text-lg font-bold text-on-surface group-hover:text-primary-container transition-colors'}>
                          {t(`faq.${f.id}.q`)}
                        </h3>
                      </div>
                      <span className={isOpen ? 'material-symbols-outlined text-primary' : 'material-symbols-outlined text-outline-variant group-hover:text-primary transition-colors'}>
                        {isOpen ? 'do_not_disturb_on' : 'add_circle'}
                      </span>
                    </div>
                    {isOpen && (
                      <div className="mt-4 pt-4 border-t border-outline-variant/10">
                        <p className="text-on-surface-variant font-body-md leading-relaxed">{t(`faq.${f.id}.a`)}</p>
                      </div>
                    )}
                  </div>
                )
              })}
              {list.length === 0 && (
                <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-10 text-center text-on-surface-variant">
                  {searching ? t('faq.no_results', { query }) : t('faq.cat_empty')}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
