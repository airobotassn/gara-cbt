import { useState } from 'react'
import { useT, type Lang } from '../lib/i18n'

// 월 단위 달력형 **출석** 표시. days = 출석한 날짜('YYYY-MM-DD') 집합.
//   2026-07-29 결정: 잔디에 찍는 활동은 **출석 하나뿐**이다(학습·게임·응시는 표시하지 않는다).
//   출석은 하루 1회 플래그라 강도(농도) 개념이 없어 색은 초록 단색이다.
//   데이터 출처 = get-hub 의 `attendanceDays`(daily_activity.did_attendance, 최근 1년).

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// 출석 색(초록)은 CSS 변수 --attend 하나가 단일 출처 — calendar.css 참고.

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

export default function ContributionGraph({ days }: { days: Set<string> }) {
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

  // 이 달의 출석 일수
  let monthActive = 0
  for (let d = 1; d <= daysInMonth; d++) {
    if (days.has(key(year, month, d))) monthActive++
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

      {/* 이 달 출석 요약 — 달력 위에 크게. 색 범례는 없앴다(표시하는 활동이 출석 하나뿐이라 구분할 색이 없다). */}
      <div className="calm-summary">{t('cal.days_attended', { n: monthActive })}</div>

      <div className="calm-grid">
        {weekdays.map((w, i) => (
          <div className="calm-wd" key={`wd${i}`}>
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div className="calm-cell empty" key={i} />
          const attended = days.has(key(year, month, d))
          const cellDate = new Date(year, month, d)
          const isToday = cellDate.getTime() === today.getTime()
          const future = cellDate > today
          return (
            <div
              key={i}
              className={`calm-cell ${attended ? 'active' : ''} ${isToday ? 'today' : ''} ${future ? 'future' : ''}`}
              title={attended ? t('cal.dominant_attendance') : t('cal.none')}
            >
              {d}
            </div>
          )
        })}
      </div>
    </div>
  )
}
