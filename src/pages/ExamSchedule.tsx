import { useNavigate } from 'react-router-dom'
import SiteFooter from '../components/SiteFooter'
import { useT } from '../lib/i18n'
import { SCHEDULE, getRolling } from '../lib/caris'

// 자격검정 접수 — 정기/상시 시험 일정 목록. 항목 클릭 → /exam/apply(원서접수).
export default function ExamSchedule() {
  const navigate = useNavigate()
  const { t, lang } = useT()
  const ROLLING = getRolling(lang)
  const goApply = (state: Record<string, string>) => navigate('/exam/apply', { state })

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

        {/* 정기시험 */}
        <section className="mb-12">
          <h2 className="font-title-md text-title-md font-bold text-on-surface border-l-4 border-primary pl-3 mb-5">{t('sched.regular')}</h2>
          <div className="flex flex-col gap-4">
            {SCHEDULE.map((s) => (
              <div
                key={s.id}
                onClick={s.open ? () => goApply({ roundId: s.id }) : undefined}
                className={`rounded-2xl p-6 border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${s.open ? 'bg-surface-container-lowest border-outline-variant/30 ambient-shadow hover:border-primary/50 hover:shadow-md transition-all cursor-pointer' : 'bg-surface-container-low border-outline-variant/20 opacity-70'}`}
              >
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${s.open ? 'bg-primary/10 text-primary' : 'bg-surface-container-high text-on-surface-variant'}`}>
                    <span className="material-symbols-outlined">event</span>
                  </div>
                  <div>
                    <div className={`font-title-md text-title-md font-bold ${s.open ? 'text-on-surface' : 'text-on-surface-variant'}`}>{t(s.roundKey)}</div>
                    <div className="font-body-md text-body-md text-on-surface-variant">{t('sched.exam_date')} {t(s.dateKey)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 self-end sm:self-auto">
                  <span className={`px-3 py-1.5 rounded-full font-label-md text-label-md font-bold ${s.open ? 'bg-primary/10 text-primary' : 'bg-surface-container-high text-on-surface-variant'}`}>{t(s.open ? 'guide.status_open' : 'guide.status_upcoming')}</span>
                  {s.open && (
                    <span className="inline-flex items-center gap-1 font-label-md text-label-md text-primary font-bold whitespace-nowrap">
                      {t('sched.apply')}<span className="material-symbols-outlined text-[20px]">arrow_forward</span>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 상시시험 */}
        <section>
          <h2 className="font-title-md text-title-md font-bold text-on-surface border-l-4 border-primary pl-3 mb-5">{t('sched.rolling')}</h2>
          <div className="flex flex-col gap-4">
            {ROLLING.map((r) => (
              <div
                key={r.id}
                onClick={() => goApply({ roundLabel: r.name, dateLabel: r.date })}
                className="rounded-2xl p-6 border bg-surface-container-lowest border-outline-variant/30 ambient-shadow hover:border-primary/50 hover:shadow-md transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-secondary/10 text-secondary flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined">event_repeat</span>
                  </div>
                  <div>
                    <div className="font-title-md text-title-md font-bold text-on-surface">{r.name}</div>
                    <div className="font-body-md text-body-md text-on-surface-variant break-keep">{r.desc}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 self-end sm:self-auto">
                  <span className="px-3 py-1.5 rounded-full font-label-md text-label-md font-bold bg-secondary/10 text-secondary whitespace-nowrap">{r.badge}</span>
                  <span className="inline-flex items-center gap-1 font-label-md text-label-md text-primary font-bold whitespace-nowrap">
                    {t('sched.apply')}<span className="material-symbols-outlined text-[20px]">arrow_forward</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
