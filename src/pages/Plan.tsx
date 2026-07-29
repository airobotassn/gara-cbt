import { useNavigate } from 'react-router-dom'
import SiteFooter from '../components/SiteFooter'
import { useT } from '../lib/i18n'
import { useExamRounds, type RoundStatus } from '../lib/rounds'

// /plan — CARIS 시험 일정. 원래 /guide 히어로 우측 패널 + 상시시험 섹션이던 것을 별도 페이지로 분리했다
// (2026-07 /guide 개편). /guide 히어로의 'CARIS PLAN' 버튼이 유일한 진입로.
// ⚠️ 페이지 배경(.guide-page)은 guide.css 가 단일 출처 — 두 페이지가 같은 표면을 써야 해서 의도적으로 공유한다.

const STATUS_KEY: Record<RoundStatus, string> = {
  open: 'guide.status_open',
  upcoming: 'guide.status_upcoming',
  closed: 'guide.status_closed',
}

export default function Plan() {
  const { t, lang } = useT()
  const navigate = useNavigate()
  const { regular, rolling, loading } = useExamRounds(lang)

  const apply = (id: string, label: string, dateLabel: string) =>
    navigate(`/exam/apply?round=${id}`, { state: { roundId: id, roundLabel: label, dateLabel } })

  return (
    <div className="guide-page text-on-background min-h-screen">
      <main className="pl-wrap px-margin-mobile md:px-margin-desktop">
        <div className="max-w-container-max mx-auto">
          <button type="button" className="pl-back" onClick={() => navigate('/guide')}>
            <span className="material-symbols-outlined">arrow_back</span>
            {t('plan.back')}
          </button>

          <div className="pl-head">
            <h1>CARIS <em>PLAN</em></h1>
            <p>{t('plan.sub')}</p>
          </div>

          {!loading && regular.length === 0 && rolling.length === 0 && (
            <p className="pl-empty">{t('sched.empty')}</p>
          )}

          {regular.length > 0 && (
            <section className="pl-sec">
              {/* 정기시험은 섹션 헤더 없이 카드만 — 상시시험이 있을 때만 아래에 구분 헤더가 붙는다. */}
              <div className="pl-rounds">
                {regular.map((s) => (
                  <article
                    key={s.id}
                    className={`pl-rd${s.clickable ? ' is-open' : ' is-off'}`}
                    onClick={s.clickable ? () => apply(s.id, s.title, s.dateText) : undefined}
                    role={s.clickable ? 'button' : undefined}
                    tabIndex={s.clickable ? 0 : undefined}
                    onKeyDown={s.clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apply(s.id, s.title, s.dateText) } } : undefined}
                  >
                    <div className="pl-rd-top">
                      <span className="pl-rd-title">{s.title}</span>
                      <span className="pl-pill">{t(STATUS_KEY[s.status])}</span>
                    </div>
                    <div className="pl-rd-date">{s.dateText}</div>
                    {s.applyText && (
                      <div className="pl-rd-apply">
                        {t('sched.apply_period')}
                        <b>
                          {(() => {
                            const [a1, a2] = s.applyText.split('~')
                            return a2 !== undefined
                              ? <><span className="whitespace-nowrap">{a1.trim()}</span>{' ~ '}<span className="whitespace-nowrap">{a2.trim()}</span></>
                              : s.applyText
                          })()}
                        </b>
                      </div>
                    )}
                    {s.clickable && (
                      <span className="pl-go">
                        {t('sched.apply')}
                        <span className="material-symbols-outlined">arrow_forward</span>
                      </span>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}

          {rolling.length > 0 && (
            <section className="pl-sec">
              <h2 className="pl-sec-head">
                <span className="material-symbols-outlined">event_repeat</span>
                {t('sched.rolling')}
              </h2>
              <div className="pl-rollings">
                {rolling.map((r) => (
                  <article
                    key={r.id}
                    className="pl-rolling"
                    onClick={() => apply(r.id, r.title, r.note)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apply(r.id, r.title, r.note) } }}
                  >
                    <div className="pl-rolling-l">
                      <span className="pl-rolling-ic"><span className="material-symbols-outlined">event_available</span></span>
                      <div>
                        <h3>{r.title}</h3>
                        {r.note && <p>{r.note}</p>}
                      </div>
                    </div>
                    <div className="pl-rolling-r">
                      <span className="pl-pill is-rolling">{t('sched.rolling_badge')}</span>
                      <span className="pl-go">
                        {t('sched.apply')}
                        <span className="material-symbols-outlined">arrow_forward</span>
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
