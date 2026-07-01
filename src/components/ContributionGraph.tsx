import { useState } from 'react'
import { useT, type Lang } from '../lib/i18n'

// 월 단위 달력형 활동 표시. days: 'YYYY-MM-DD' → 활동 강도(현재는 응시 레벨).
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function pad(n: number) {
  return n < 10 ? '0' + n : '' + n
}
function key(y: number, m0: number, d: number) {
  return `${y}-${pad(m0 + 1)}-${pad(d)}`
}
function headerLabel(y: number, m0: number, lang: Lang) {
  if (lang === 'ko') return `${y}년 ${m0 + 1}월`
  if (lang === 'ja') return `${y}年${m0 + 1}月`
  if (lang === 'zh') return `${y}年${m0 + 1}月`
  return `${EN_MONTHS[m0]} ${y}` // en · hi · vi
}

export default function ContributionGraph({ days }: { days: Map<string, number> }) {
  const { t, lang } = useT()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // 보고 있는 달(매월 1일 기준). 기본은 이번 달.
  const [view, setView] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const year = view.getFullYear()
  const month = view.getMonth()

  const startWeekday = new Date(year, month, 1).getDay() // 0=일
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  // 앞쪽 빈칸 + 날짜들 + 뒤쪽 빈칸(주 단위 정렬)
  const cells: (number | null)[] = []
  for (let i = 0; i < startWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  // 미래 달로는 못 넘어가게
  const canNext =
    year < today.getFullYear() ||
    (year === today.getFullYear() && month < today.getMonth())

  function move(delta: number) {
    setView(new Date(year, month + delta, 1))
  }

  const weekdays = t('cal.weekdays').split(',')

  // 이 달의 활동 일수
  let monthActive = 0
  for (let d = 1; d <= daysInMonth; d++) {
    if (days.get(key(year, month, d))) monthActive++
  }

  return (
    <div className="calm">
      <div className="calm-head">
        <button className="hl-arrow" style={{ width: 28, height: 28 }} onClick={() => move(-1)} aria-label="prev">
          ‹
        </button>
        <div className="calm-title">{headerLabel(year, month, lang)}</div>
        <button
          className="hl-arrow"
          style={{ width: 28, height: 28 }}
          onClick={() => move(1)}
          disabled={!canNext}
          aria-label="next"
        >
          ›
        </button>
      </div>

      <div className="calm-grid">
        {weekdays.map((w, i) => (
          <div className="calm-wd" key={`wd${i}`}>
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div className="calm-cell empty" key={i} />
          const active = !!days.get(key(year, month, d))
          const cellDate = new Date(year, month, d)
          const isToday = cellDate.getTime() === today.getTime()
          const future = cellDate > today
          return (
            <div
              key={i}
              className={`calm-cell ${active ? 'active' : ''} ${isToday ? 'today' : ''} ${future ? 'future' : ''}`}
              title={active ? t('cal.did') : t('cal.none')}
            >
              {d}
            </div>
          )
        })}
      </div>

      <div className="calm-legend">
        <span>{t('cal.days_active', { n: monthActive })}</span>
        <span className="calm-scale">
          <i className="calm-cell active" /> {t('cal.active')}
        </span>
      </div>
    </div>
  )
}
