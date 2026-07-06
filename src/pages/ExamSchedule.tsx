import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import SiteFooter from '../components/SiteFooter'
import { useT } from '../lib/i18n'
import { useExamRounds, type RoundStatus } from '../lib/rounds'

// 자격검정 접수 — 정기/상시 시험 일정 목록(DB: exam_rounds). 항목 클릭 → /exam/apply(원서접수).
const STATUS_KEY: Record<RoundStatus, string> = {
  open: 'guide.status_open',
  upcoming: 'guide.status_upcoming',
  closed: 'guide.status_closed',
}
const PAGE_SIZE = 6 // 정기시험은 한 페이지 6개까지, 나머지는 페이징(가까운 순은 useExamRounds가 이미 정렬)

export default function ExamSchedule() {
  const navigate = useNavigate()
  const { t, lang } = useT()
  const { regular, rolling, loading } = useExamRounds(lang)
  // roundId + 라벨/날짜를 같이 넘겨 원서접수 화면이 그대로 표기(접수 흐름은 추후 연결).
  const goApply = (state: Record<string, string>) => navigate(`/exam/apply?round=${state.roundId}`, { state })

  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(regular.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pagedRegular = regular.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  return (
    <div className="bg-background text-on-surface min-h-screen flex flex-col">
      <main className="flex-grow pt-12 pb-24 px-margin-mobile md:px-margin-desktop w-full max-w-container-max mx-auto">
        {/* 헤더 */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary font-label-md text-label-md font-bold mb-4">
            <span className="material-symbols-outlined text-[18px]">calendar_month</span>
            {t('sched.badge')}
          </div>
          <h1 className="font-headline-lg text-headline-lg-mobile md:text-headline-lg font-bold text-on-surface mb-2">{t('sched.title')}</h1>
          <p className="font-body-md text-body-md text-on-surface-variant break-keep">{t('sched.desc')}</p>
        </div>

        {loading && <div className="text-on-surface-variant font-body-md py-6">{t('common.loading')}</div>}

        {/* 정기시험 */}
        {!loading && regular.length > 0 && (
          <section className="mb-12">
            <h2 className="font-title-md text-title-md font-bold text-on-surface border-l-4 border-primary pl-3 mb-5">{t('sched.regular')}</h2>
            <div className="flex flex-col gap-4">
              {pagedRegular.map((s) => (
                <div
                  key={s.id}
                  onClick={s.clickable ? () => goApply({ roundId: s.id, roundLabel: s.title, dateLabel: s.dateText }) : undefined}
                  className={`rounded-2xl p-6 border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${s.clickable ? 'bg-surface-container-lowest border-outline-variant/30 ambient-shadow hover:border-primary/50 hover:shadow-md transition-all cursor-pointer' : 'bg-surface-container-low border-outline-variant/20 opacity-70'}`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${s.clickable ? 'bg-primary/10 text-primary' : 'bg-surface-container-high text-on-surface-variant'}`}>
                      <span className="material-symbols-outlined">event</span>
                    </div>
                    <div>
                      <div className={`font-title-md text-title-md font-bold ${s.clickable ? 'text-on-surface' : 'text-on-surface-variant'}`}>{s.title}</div>
                      <div className="font-body-md text-body-md text-on-surface-variant">{t('sched.exam_date')} {s.dateText}</div>
                      {s.applyText && (
                        <div className="font-body-md text-body-md text-on-surface-variant mt-1">
                          {t('sched.apply_period')} <span className="font-semibold text-on-surface">{s.applyText}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 self-end sm:self-auto">
                    <span className={`px-3 py-1.5 rounded-full font-label-md text-label-md font-bold ${s.clickable ? 'bg-primary/10 text-primary' : 'bg-surface-container-high text-on-surface-variant'}`}>{t(STATUS_KEY[s.status])}</span>
                    {s.clickable && (
                      <span className="inline-flex items-center gap-1 font-label-md text-label-md text-primary font-bold whitespace-nowrap">
                        {t('sched.apply')}<span className="material-symbols-outlined text-[20px]">arrow_forward</span>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {pageCount > 1 && (
              <div className="flex items-center justify-center gap-3 mt-8">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  aria-label={t('sched.prev')}
                  className="w-10 h-10 rounded-xl border border-outline-variant/40 bg-surface-container-lowest text-on-surface-variant flex items-center justify-center hover:border-primary/50 hover:text-primary disabled:opacity-40 disabled:cursor-default transition-colors"
                >
                  <span className="material-symbols-outlined text-[20px]">chevron_left</span>
                </button>
                <span className="font-label-md text-label-md text-on-surface-variant font-semibold tabular-nums">
                  {safePage + 1} / {pageCount}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  disabled={safePage >= pageCount - 1}
                  aria-label={t('sched.next')}
                  className="w-10 h-10 rounded-xl border border-outline-variant/40 bg-surface-container-lowest text-on-surface-variant flex items-center justify-center hover:border-primary/50 hover:text-primary disabled:opacity-40 disabled:cursor-default transition-colors"
                >
                  <span className="material-symbols-outlined text-[20px]">chevron_right</span>
                </button>
              </div>
            )}
          </section>
        )}

        {/* 상시시험 */}
        {!loading && rolling.length > 0 && (
          <section>
            <h2 className="font-title-md text-title-md font-bold text-on-surface border-l-4 border-primary pl-3 mb-5">{t('sched.rolling')}</h2>
            <div className="flex flex-col gap-4">
              {rolling.map((r) => (
                <div
                  key={r.id}
                  onClick={() => goApply({ roundId: r.id, roundLabel: r.title, dateLabel: r.note })}
                  className="rounded-2xl p-6 border bg-surface-container-lowest border-outline-variant/30 ambient-shadow hover:border-primary/50 hover:shadow-md transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-secondary/10 text-secondary flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined">event_repeat</span>
                    </div>
                    <div>
                      <div className="font-title-md text-title-md font-bold text-on-surface">{r.title}</div>
                      {r.note && <div className="font-body-md text-body-md text-on-surface-variant break-keep">{r.note}</div>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 self-end sm:self-auto">
                    <span className="px-3 py-1.5 rounded-full font-label-md text-label-md font-bold bg-secondary/10 text-secondary whitespace-nowrap">{t('sched.rolling_badge')}</span>
                    <span className="inline-flex items-center gap-1 font-label-md text-label-md text-primary font-bold whitespace-nowrap">
                      {t('sched.apply')}<span className="material-symbols-outlined text-[20px]">arrow_forward</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {!loading && regular.length === 0 && rolling.length === 0 && (
          <div className="text-on-surface-variant font-body-md py-6">{t('sched.empty')}</div>
        )}
      </main>

      <SiteFooter />
    </div>
  )
}
