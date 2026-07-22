import { useState, type CSSProperties } from 'react'
import { useT, type Lang } from '../lib/i18n'

// 월 단위 달력형 활동 표시. days: 'YYYY-MM-DD' → 활동 강도.
//   하위호환: 옛 시그니처(숫자=응시 레벨)와 신규 시그니처(지배 활동종류+총점+풀콤)를 유니온으로 함께 받는다.
// TODO(#5 미구현): 신규 시그니처(dominant=attendance/learn/minigame)는 아직 실제 호출자가 없다 —
//   현재 유일한 호출자(LearningDashboard)는 옛 시그니처(레벨테스트 응시일=숫자)만 넘겨 dominant='leveltest'
//   (금색)만 나온다. attendance/learn/minigame 색을 살리려면 get-hub 가 activity_ledger+daily_activity
//   기반 일별 활동 breakdown 을 반환하고 그걸 신규 시그니처로 매핑하는 생산자가 배선돼야 한다.
export type DayActivity = { dominant?: 'attendance' | 'learn' | 'minigame' | 'leveltest'; total: number; full?: boolean }
export type DayEntry = number | DayActivity

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// 지배 활동종류 → 색(설계 §7.3: 출석=회색 / 학습=파랑 / 게임=주황 / 응시=금색).
const DOMINANT_COLOR: Record<NonNullable<DayActivity['dominant']>, string> = {
  attendance: '#8b9099',
  learn: 'var(--blue)',
  minigame: '#e0912f',
  leveltest: '#e3b23c',
}
// 활동점수 정규화 상한(오파시티 스케일용) — 하루 최대 기여 근사치(scoring.ts ACTIVITY_DELTA 상한 합과 정합).
const MAX_DAY_SCORE = 90

function normalizeEntry(v: DayEntry | undefined): DayActivity | null {
  if (v === undefined) return null
  if (typeof v === 'number') return v > 0 ? { dominant: 'leveltest', total: v } : null
  return v.total > 0 || v.full ? v : null
}

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

export default function ContributionGraph({ days }: { days: Map<string, DayEntry> }) {
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
    if (normalizeEntry(days.get(key(year, month, d)))) monthActive++
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
          const entry = normalizeEntry(days.get(key(year, month, d)))
          const cellDate = new Date(year, month, d)
          const isToday = cellDate.getTime() === today.getTime()
          const future = cellDate > today
          const opacity = entry ? Math.min(1, 0.32 + 0.68 * Math.min(1, entry.total / MAX_DAY_SCORE)) : undefined
          const style: CSSProperties | undefined = entry
            ? { backgroundColor: DOMINANT_COLOR[entry.dominant ?? 'leveltest'], opacity, borderColor: entry.full ? '#e3b23c' : undefined }
            : undefined
          const tip = entry
            ? `${t(`cal.dominant_${entry.dominant ?? 'leveltest'}`)} · ${entry.total}${entry.full ? ` · ${t('cal.full_combo')}` : ''}`
            : t('cal.none')
          return (
            <div
              key={i}
              className={`calm-cell ${entry ? 'active' : ''} ${entry?.full ? 'full' : ''} ${isToday ? 'today' : ''} ${future ? 'future' : ''}`}
              style={style}
              title={tip}
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
