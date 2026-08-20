import { useNavigate } from 'react-router-dom'
import { useT, type Lang } from '../lib/i18n'
import { fmtShort, useExamRounds, type RoundStatus, type RoundView } from '../lib/rounds'
import { gradeAndReleaseWindows } from '../lib/examSchedule'

// /plan — CARIS 시험 일정. 원래 /guide 히어로 우측 패널 + 상시시험 섹션이던 것을 별도 페이지로 분리했다
// (2026-07 /guide 개편). /guide 히어로의 'CARIS PLAN' 버튼이 유일한 진입로.
// ⚠️ 페이지 배경(.guide-page)은 guide.css 가 단일 출처 — 두 페이지가 같은 표면을 써야 해서 의도적으로 공유한다.

// 접수중 회차의 일정 4줄. 날짜는 그 회차 값에서 오고, 여기엔 '어느 줄이 무슨 이름·무슨 색인가'만 둔다.
//  · color: 왼쪽 칩 색. --g-card 와 섞어 쓰므로 다크에서도 같은 규칙으로 옅어진다.
const STEPS = [
  { key: 'apply', name: 'plan.step_apply', color: '#2563eb' },
  { key: 'exam', name: 'plan.step_exam', color: '#38bdf8' },
  { key: 'grade', name: 'plan.step_grade', color: '#f5a524' },
  { key: 'result', name: 'plan.step_result', color: '#22c55e' },
] as const

/** 접수중 회차의 일정 줄. 값이 없는 줄은 아예 빼고(‘-’ 를 찍지 않는다) 만든다. */
function scheduleRows(r: RoundView, lang: Lang) {
  const out: { key: string; name: string; color: string; text: string }[] = []
  const put = (key: string, text: string) => {
    const st = STEPS.find((s) => s.key === key)
    if (st && text) out.push({ key, name: st.name, color: st.color, text })
  }
  const range = (a: string | null, b: string | null) =>
    a && b ? `${fmtShort(a, lang)} ~ ${fmtShort(b, lang)}` : ''

  put('apply', range(r.applyStartAt, r.applyEndAt))
  put('exam', range(r.examStartAt, r.examEndAt))
  // 채점·합격자 조회는 저장돼 있지 않다 — 응시 창이 그 달 11~20일이면 규칙에서 계산해 낸다.
  // 규칙 밖 회차(옛 회차)는 null 이라 두 줄이 통째로 빠진다.
  const w = gradeAndReleaseWindows(r.examStartAt, r.examEndAt)
  if (w) {
    put('grade', range(w.gradeStart, w.gradeEnd))
    put('result', `${fmtShort(w.releaseStart, lang)} ${w.releaseHour}:00 ~ ${fmtShort(w.releaseEnd, lang)}`)
  }
  return out
}

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

          {/* 지금 접수중인 회차의 실제 일정. 일반론("매월 1~10일 …")은 안 쓴다 — 응시자가 알아야 하는 건
              자기가 지금 신청하는 회차의 날짜다.
              ⚠️ 채점·합격자 조회는 저장된 값이 아니라 **응시 창에서 계산**한다(그 달 11~20일이면 21~24 채점,
                 25일 10시부터 조회). 규칙 밖인 옛 회차는 그 두 줄이 빠진다 — 없는 날짜를 지어내지 않는다. */}
          {(() => {
            const open = regular.find((r) => r.status === 'open')
            if (!open) return null
            const rows = scheduleRows(open, lang)
            if (!rows.length) return null
            return (
              <section className="pl-sec">
                <h2 className="pl-crit-title">
                  {open.title}
                  <span className="pl-pill">{t(STATUS_KEY.open)}</span>
                </h2>
                <div className="pl-crit">
                  {rows.map((row) => (
                    <div key={row.key} className="pl-crit-row" style={{ ['--c' as string]: row.color }}>
                      <span className="pl-crit-chip">{t(row.name)}</span>
                      <b className="pl-crit-when">{row.text}</b>
                    </div>
                  ))}
                </div>
              </section>
            )
          })()}

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
                    {/* 큰 줄 = 응시 기간(11~20일). 예전엔 '시험일 하루' 였는데 월 규칙에서는 열흘이라
                        라벨 없이 날짜만 두면 접수기간과 구분이 안 된다. */}
                    <div className="pl-rd-date">
                      <span className="pl-rd-datelbl">{t('sched.exam_period')}</span>
                      {s.dateText}
                    </div>
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

    </div>
  )
}
