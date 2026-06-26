import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { callFunction } from '../lib/supabase'
import { useExamGuard } from '../hooks/useAntiCheat'
import { isMobileDevice } from '../lib/device'
import MobileBlock from '../components/MobileBlock'
import SebRequired from '../components/SebRequired'
import { SEB_REQUIRED, isSEB } from '../lib/seb'
import { makePracticeExam } from '../lib/practice'
import { useT } from '../lib/i18n'
import type { StartExamResponse, SubmittedAnswer, SubmitExamResponse } from '../lib/types'

type Tab = 'canvas' | 'sheet' | 'status'

export default function CbtRunner() {
  const { t } = useT()
  const { attemptId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  // 모의 응시(practice)는 SEB 가 새 URL 로 직접 열 수 있어 state 가 없을 수 있음 → 자체 생성
  const start =
    (location.state as StartExamResponse | null) ??
    (attemptId === 'practice' ? makePracticeExam() : null)

  if (isMobileDevice()) return <MobileBlock />
  // 모의 문제(practice)는 SEB 없이도 체험 가능 — 실제 시험만 SEB 강제
  if (SEB_REQUIRED && !isSEB() && attemptId !== 'practice') return <SebRequired />

  // 새로고침 등으로 출제 데이터가 유실되면 다시 시작해야 함
  if (!start || start.attemptId !== attemptId) {
    return (
      <div className="exam-center">
        <div className="exam-card" style={{ textAlign: 'center', maxWidth: 460 }}>
          <div className="exam-ico">⚠️</div>
          <h2 className="exam-title">{t('run.lost_title')}</h2>
          <p className="exam-sub">{t('run.lost_sub')}</p>
          <button className="exam-btn" style={{ marginTop: 18 }} onClick={() => navigate('/exam')}>
            {t('run.to_exam')}
          </button>
        </div>
      </div>
    )
  }

  return <RunnerInner start={start} />
}

function fmt(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

const ZOOMS = [100, 115, 130, 150]

function RunnerInner({ start }: { start: StartExamResponse }) {
  const { t } = useT()
  const navigate = useNavigate()
  const { questions, exam } = start
  const total = questions.length

  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<(number | null)[]>(() => Array(total).fill(null))
  const [tab, setTab] = useState<Tab>('sheet')
  const [zoomI, setZoomI] = useState(0)
  const [memo, setMemo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submittedRef = useRef(false)
  const violationsRef = useRef(0)

  // 문항별 체류시간(초)
  const startTimeRef = useRef<number[]>(Array(total).fill(0))
  const spentRef = useRef<number[]>(Array(total).fill(0))
  useEffect(() => {
    startTimeRef.current[index] = performance.now()
    return () => {
      const t = startTimeRef.current[index]
      if (t) spentRef.current[index] += Math.round((performance.now() - t) / 1000)
    }
  }, [index])

  const buildAnswers = useCallback((): SubmittedAnswer[] => {
    const t = startTimeRef.current[index]
    if (t) {
      spentRef.current[index] += Math.round((performance.now() - t) / 1000)
      startTimeRef.current[index] = performance.now()
    }
    return questions.map((q, i) => ({
      questionId: q.id,
      selectedIndex: selected[i],
      timeSpent: spentRef.current[i],
    }))
  }, [questions, selected, index])

  const doSubmit = useCallback(async () => {
    if (submittedRef.current) return
    submittedRef.current = true
    setSubmitting(true)
    // 모의 문제(practice) — 백엔드 호출 없이 종료
    if (start.attemptId === 'practice') {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
      if (isSEB()) {
        window.location.href = `${window.location.origin}/exam/done` // SEB 종료 URL
        return
      }
      window.alert(t('run.practice_done'))
      navigate('/exam/check')
      return
    }
    try {
      const res = await callFunction<SubmitExamResponse>('submit-exam', {
        attemptId: start.attemptId,
        answers: buildAnswers(),
        violationCount: violationsRef.current,
      })
      // 보안 브라우저면 종료 URL 로 이동 → SEB 자동 종료(결과는 마이페이지에서)
      if (isSEB()) {
        window.location.href = `${window.location.origin}/exam/done`
        return
      }
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
      navigate(`/exam/result/${start.attemptId}`, { state: res, replace: true })
    } catch (e) {
      submittedRef.current = false
      setSubmitting(false)
      alert(e instanceof Error ? e.message : t('run.submit_fail'))
    }
  }, [start.attemptId, buildAnswers, navigate, t])

  // 사용자가 누르는 제출: 미응답 가드 → 경고 → 미응답 문항으로 이동
  const onClickSubmit = useCallback(() => {
    if (submitting) return
    const unanswered: number[] = []
    selected.forEach((s, i) => {
      if (s === null) unanswered.push(i)
    })
    if (unanswered.length > 0) {
      window.alert(
        t('run.unanswered_warn', { n: unanswered.length, first: unanswered[0] + 1 }),
      )
      setIndex(unanswered[0])
      setTab('sheet')
      return
    }
    if (window.confirm(t('run.submit_confirm'))) doSubmit()
  }, [selected, submitting, doSubmit, t])

  // 제한시간 카운트다운 — 0 도달 시 자동 제출
  const deadlineRef = useRef<number | null>(null)
  const durationMs = exam.durationMinutes * 60000
  const [remainMs, setRemainMs] = useState(durationMs)
  useEffect(() => {
    if (deadlineRef.current == null) deadlineRef.current = Date.now() + durationMs
    const tick = () => {
      const left = Math.max(0, (deadlineRef.current as number) - Date.now())
      setRemainMs(left)
      if (left <= 0 && !submittedRef.current) {
        window.alert(t('run.time_up'))
        doSubmit()
      }
    }
    tick()
    const id = window.setInterval(tick, 500)
    return () => clearInterval(id)
  }, [durationMs, doSubmit, t])

  // 부정행위 차단 + 이탈 시 화면 가림
  const { violations, masked } = useExamGuard({ enabled: !submitting })
  useEffect(() => {
    violationsRef.current = violations
  }, [violations])

  function choose(qIdx: number, opt: number) {
    if (submitting) return
    setSelected((arr) => {
      const next = [...arr]
      next[qIdx] = opt
      return next
    })
  }

  const q = questions[index]
  const answeredCount = selected.filter((s) => s !== null).length
  const zoom = ZOOMS[zoomI]
  const elapsedMs = durationMs - remainMs
  const low = remainMs <= 5 * 60000

  return (
    <div className="cbt no-select" onContextMenu={(e) => e.preventDefault()}>
      {masked && (
        <div className="cbt-mask">
          <div>
            🔒 {t('run.mask_title')}
            <div className="cbt-mask-sub">{t('run.mask_sub')}</div>
          </div>
        </div>
      )}

      {/* 상단 바 */}
      <header className="cbt-top">
        <button className="cbt-back" onClick={onClickSubmit} title={t('run.submit')}>
          ‹
        </button>
        <h1 className="cbt-top-title">{t('run.top_title', { title: exam.title })}</h1>
      </header>

      <div className="cbt-main">
        {/* 좌측: 문제 */}
        <section className="cbt-left">
          <div className="cbt-q-head">
            <span className="cbt-q-badge">{t('run.q_badge')}</span>
            <span className="cbt-q-no">{index + 1}</span>
            <span className={`cbt-timer ${low ? 'low' : ''}`} title={t('run.timer_title')}>
              ⏱ {fmt(elapsedMs)} <em>/ {t('run.minutes', { m: exam.durationMinutes })}</em>
            </span>
            <button
              className="cbt-tool"
              onClick={() => setZoomI((i) => (i + 1) % ZOOMS.length)}
              title={t('run.font_size')}
            >
              🔍 {zoom}%
            </button>
          </div>

          <div className="cbt-tags">
            {q.subject && <span className="cbt-tag">{q.subject}</span>}
            {q.topic && <span className="cbt-tag ghost">{q.topic}</span>}
          </div>

          <div className="cbt-q-scroll" style={{ fontSize: `${zoom}%` }}>
            <div className="cbt-q-prompt">{q.prompt}</div>
            <div className="cbt-opts">
              {q.options.map((opt, i) => (
                <button
                  key={i}
                  className={`cbt-opt ${selected[index] === i ? 'sel' : ''}`}
                  onClick={() => choose(index, i)}
                >
                  <span className="cbt-opt-no">{i + 1}</span>
                  <span className="cbt-opt-lab">{opt}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* 우측: 답안지/현황/캔버스 */}
        <section className="cbt-right">
          <div className="cbt-tabs">
            <button className={tab === 'canvas' ? 'on' : ''} onClick={() => setTab('canvas')}>
              🖉 {t('run.tab_canvas')}
            </button>
            <button className={tab === 'sheet' ? 'on' : ''} onClick={() => setTab('sheet')}>
              ☰ {t('run.tab_sheet')}
            </button>
            <button className={tab === 'status' ? 'on' : ''} onClick={() => setTab('status')}>
              ▦ {t('run.tab_status')}
            </button>
          </div>

          {tab === 'sheet' && (
            <div className="cbt-pane">
              <div className="cbt-sheet-head">
                <b>{t('run.tab_sheet')}</b>
                <span>
                  {t('run.completed')} <b>{answeredCount}</b>/{total}
                </span>
              </div>
              <div className="cbt-sheet-scroll">
                <table className="cbt-sheet">
                  <tbody>
                    {questions.map((qq, i) => (
                      <tr key={qq.id} className={i === index ? 'cur' : ''}>
                        <th onClick={() => setIndex(i)}>{i + 1}</th>
                        {[0, 1, 2, 3].map((opt) => (
                          <td key={opt}>
                            <button
                              className={`cbt-bubble ${selected[i] === opt ? 'on' : ''}`}
                              onClick={() => choose(i, opt)}
                            >
                              {opt + 1}
                            </button>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'status' && (
            <div className="cbt-pane">
              <div className="cbt-sheet-head">
                <b>{t('run.tab_status')}</b>
                <span>
                  {t('run.written')} <b>{answeredCount}</b>/{total}
                </span>
              </div>
              <div className="cbt-status-bar">
                <i style={{ width: `${(answeredCount / total) * 100}%` }} />
              </div>
              <div className="cbt-status-legend">
                <span><i className="dot done" /> {t('run.legend_done')}</span>
                <span><i className="dot" /> {t('run.legend_undone')}</span>
                <span><i className="dot cur" /> {t('run.legend_current')}</span>
              </div>
              <div className="cbt-grid">
                {questions.map((qq, i) => (
                  <button
                    key={qq.id}
                    className={`cbt-cell ${selected[i] !== null ? 'done' : ''} ${i === index ? 'cur' : ''}`}
                    onClick={() => setIndex(i)}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === 'canvas' && (
            <div className="cbt-pane">
              <div className="cbt-sheet-head">
                <b>{t('run.tab_canvas')}</b>
                <span>{t('run.canvas_note')}</span>
              </div>
              <textarea
                className="cbt-canvas"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder={t('run.canvas_placeholder')}
              />
            </div>
          )}
        </section>
      </div>

      {/* 하단 바 */}
      <footer className="cbt-foot">
        <div className="cbt-foot-prog">
          <span>
            <b>{index + 1}</b> / {total}
          </span>
          <i className="cbt-pbar">
            <i style={{ width: `${((index + 1) / total) * 100}%` }} />
          </i>
        </div>
        <div className="cbt-foot-btns">
          <button
            className="cbt-btn-ghost"
            disabled={index === 0 || submitting}
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
          >
            {t('run.prev')}
          </button>
          <button
            className="cbt-btn-ghost"
            disabled={index + 1 >= total || submitting}
            onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
          >
            {t('run.next')}
          </button>
          <button className="cbt-btn-dark" disabled={submitting} onClick={onClickSubmit}>
            {submitting ? t('run.submitting') : t('run.submit')}
          </button>
        </div>
      </footer>
    </div>
  )
}
