import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { callFunction } from '../lib/supabase'
import { useInputGuard, useLeaveGuard } from '../hooks/useAntiCheat'
import { isMobileDevice } from '../lib/device'
import MobileBlock from '../components/MobileBlock'
import SebRequired from '../components/SebRequired'
import { SEB_REQUIRED, isSEB } from '../lib/seb'
import { makePracticeExam } from '../lib/practice'
import { useT } from '../lib/i18n'
import type { StartExamResponse, SubmittedAnswer, SubmitExamResponse } from '../lib/types'

type Tab = 'sheet' | 'status'

// gara_6 (정기시험 응시 화면) 목업 디자인 + 응시 로직(타이머·부정행위·OMR·제출) 전부 보존.
// 원본: stitch_design_critique_assistant/gara_6/code.html
// CBT(응시 화면)는 테마와 무관하게 항상 라이트 — 루트에 .force-light 적용(다크 토큰 무시).

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
      <div className="force-light bg-surface min-h-screen flex items-center justify-center p-6">
        <div className="bg-surface-container-lowest rounded-2xl p-10 border border-outline-variant/30 text-center max-w-md w-full shadow-sm">
          <div className="text-[40px] mb-3">⚠️</div>
          <h2 className="font-title-md text-title-md font-bold text-on-surface mb-2">{t('run.lost_title')}</h2>
          <p className="font-body-md text-body-md text-on-surface-variant mb-6">{t('run.lost_sub')}</p>
          <button className="bg-primary text-on-primary font-label-md font-bold px-6 py-3 rounded-xl hover:shadow-lg transition-all" onClick={() => navigate('/exam')}>
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
  const [submitting, setSubmitting] = useState(false)
  const submittedRef = useRef(false)

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
      window.alert(t('run.unanswered_warn', { n: unanswered.length, first: unanswered[0] + 1 }))
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

  // 브라우저 JS 보조 가드 — SEB 안 쓰는 응시용 + 개발 폴백. 화면 미리보기(practice)는 제외.
  const guardEnabled = !submitting && start.attemptId !== 'practice' && !isSEB()
  const { masked: inputMasked } = useInputGuard({ enabled: guardEnabled })
  const { masked: leaveMasked } = useLeaveGuard({ enabled: guardEnabled })
  const masked = inputMasked || leaveMasked

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
    <div
      className="force-light bg-surface min-h-screen flex flex-col font-body-md text-on-surface no-select"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* 부정행위 마스크 */}
      {masked && (
        <div className="fixed inset-0 z-[200] bg-surface/95 backdrop-blur-md flex items-center justify-center text-center p-8">
          <div>
            <div className="text-[44px] mb-3">🔒</div>
            <div className="font-headline-lg-mobile text-headline-lg-mobile font-bold text-on-surface">{t('run.mask_title')}</div>
            <div className="font-body-md text-body-md text-on-surface-variant mt-2">{t('run.mask_sub')}</div>
          </div>
        </div>
      )}

      {/* Exam Header */}
      <header className="bg-surface-container-lowest border-b border-outline-variant/30 h-16 flex items-center px-4 md:px-margin-desktop justify-between sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <img alt="GARA" className="h-8 w-8 object-cover rounded-full" src="/logo.png" />
          <span className="font-title-md text-title-md font-bold text-on-surface tracking-tight">{t('run.top_title', { title: exam.title })}</span>
        </div>
        <div className="flex items-center gap-6">
          <button onClick={() => setZoomI((i) => (i + 1) % ZOOMS.length)} className="flex items-center gap-2 text-on-surface-variant font-label-md hover:text-primary transition-colors" title={t('run.font_size')}>
            <span className="material-symbols-outlined text-[20px]">zoom_in</span><span>{zoom}%</span>
          </button>
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full border ${low ? 'bg-error/5 border-error/20' : 'bg-primary/5 border-primary/20'}`} title={t('run.timer_title')}>
            <span className={`material-symbols-outlined text-[20px] ${low ? 'text-error' : 'text-primary'}`}>timer</span>
            <div className="flex items-baseline gap-1">
              <span className={`font-bold text-[16px] ${low ? 'text-error' : 'text-primary'}`}>{fmt(elapsedMs)}</span>
              <span className="text-[12px] text-outline">/ {fmt(durationMs)}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Split */}
      <main className="flex-1 flex flex-col lg:flex-row w-full overflow-hidden bg-surface-container-lowest">
        {/* Left: 문제 */}
        <section className="flex-[6] flex flex-col bg-surface-container-lowest border-r border-outline-variant/30 overflow-y-auto">
          <div className="p-8 md:p-12 flex flex-col gap-8 w-full" style={{ fontSize: `${zoom}%` }}>
            <div className="flex items-start justify-between border-b border-outline-variant/30 pb-4">
              <div className="flex items-baseline gap-2">
                <span className="font-label-md text-label-md text-outline font-bold">{t('run.question')}</span>
                <span className="font-display-lg text-display-lg font-black text-primary tracking-tighter">{index + 1}</span>
              </div>
              <div className="flex gap-2">
                {q.subject && <span className="px-3 py-1 bg-primary/10 text-primary text-[11px] uppercase tracking-wider font-bold rounded-full border border-primary/20">{q.subject}</span>}
                {q.topic && <span className="px-3 py-1 bg-surface-container text-on-surface-variant text-[11px] uppercase tracking-wider font-bold rounded-full">{q.topic}</span>}
              </div>
            </div>
            <div className="space-y-4">
              <h2 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg font-bold text-on-surface leading-snug break-keep">{q.prompt}</h2>
            </div>
            <div className="flex flex-col gap-3 mt-2 pb-12">
              {q.choices.map((opt, i) => {
                const sel = selected[index] === i
                return (
                  <button
                    key={i}
                    onClick={() => choose(index, i)}
                    className={`group relative flex items-center p-5 rounded-xl text-left transition-all cursor-pointer shadow-sm ${sel ? 'border-2 border-primary bg-primary-fixed/10' : 'border border-outline-variant/50 bg-surface-container-lowest hover:bg-surface-container-low hover:border-primary/50 hover:shadow'}`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-label-md text-label-md shrink-0 mr-4 transition-all ${sel ? 'bg-primary border-primary text-on-primary' : 'border border-outline-variant text-outline group-hover:border-primary group-hover:text-primary'}`}>{i + 1}</div>
                    <span className={`font-body-lg text-body-lg ${sel ? 'font-semibold text-primary' : 'text-on-surface'}`}>{opt}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </section>

        {/* Right: 답안지/현황 */}
        <section className="flex-[4] flex flex-col bg-surface overflow-hidden">
          <div className="flex border-b border-outline-variant/30 bg-surface-container-lowest shrink-0">
            <button onClick={() => setTab('sheet')} className={`flex-1 py-4 text-center font-label-md text-[15px] flex items-center justify-center gap-2 transition-colors ${tab === 'sheet' ? 'font-bold text-primary border-b-[3px] border-primary bg-primary/5' : 'text-outline hover:text-on-surface hover:bg-surface-container'}`}>
              <span className="material-symbols-outlined text-[20px]" style={tab === 'sheet' ? { fontVariationSettings: "'FILL' 1" } : undefined}>list_alt</span> {t('run.tab_sheet')}
            </button>
            <button onClick={() => setTab('status')} className={`flex-1 py-4 text-center font-label-md text-[15px] flex items-center justify-center gap-2 transition-colors ${tab === 'status' ? 'font-bold text-primary border-b-[3px] border-primary bg-primary/5' : 'text-outline hover:text-on-surface hover:bg-surface-container'}`}>
              <span className="material-symbols-outlined text-[20px]">grid_view</span> {t('run.tab_status')}
            </button>
          </div>

          {/* 답안지(OMR) */}
          {tab === 'sheet' && (
            <div className="p-6 flex-1 overflow-y-auto bg-surface-container-low">
              <div className="flex justify-between items-center mb-4 bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/30 shadow-sm">
                <span className="font-title-md text-[16px] font-bold text-on-surface flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-primary block"></span> {t('run.tab_sheet')}</span>
                <span className="font-label-sm text-label-sm text-on-surface-variant">{t('run.completed')} <strong className="text-primary font-bold text-[14px]">{answeredCount}</strong>/{total}</span>
              </div>
              <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl overflow-hidden shadow-sm">
                <div className="grid grid-cols-[80px_1fr] border-b border-outline-variant/30 bg-surface-container-lowest">
                  <div className="py-3 text-center font-label-sm text-label-sm text-on-surface-variant font-bold border-r border-outline-variant/30">{t('run.question')}</div>
                  <div className="grid grid-cols-4 py-3">
                    {[1, 2, 3, 4].map((n) => <div key={n} className="text-center font-label-sm text-label-sm text-on-surface-variant">{n}</div>)}
                  </div>
                </div>
                {questions.map((qq, i) => {
                  const cur = i === index
                  return (
                    <div key={qq.id} className={`grid grid-cols-[80px_1fr] border-b border-outline-variant/20 transition-colors ${cur ? 'bg-primary/5' : 'hover:bg-surface-container-low'}`}>
                      <button onClick={() => setIndex(i)} className={`py-4 flex items-center justify-center font-title-md text-[16px] border-r border-outline-variant/20 relative ${cur ? 'font-bold text-primary' : 'text-on-surface-variant'}`}>
                        {cur && <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary rounded-r-sm"></div>}
                        {i + 1}
                      </button>
                      <div className="grid grid-cols-4 py-4 items-center">
                        {[0, 1, 2, 3].map((opt) => {
                          const on = selected[i] === opt
                          return (
                            <div key={opt} className="flex justify-center">
                              <button onClick={() => choose(i, opt)} className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold transition-colors ${on ? 'bg-primary text-on-primary shadow-sm' : 'border border-outline-variant/60 hover:border-primary/50'}`}>
                                {on ? opt + 1 : ''}
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 문제풀이 현황 */}
          {tab === 'status' && (
            <div className="p-6 flex-1 overflow-y-auto bg-surface-container-low">
              <div className="flex justify-between items-center mb-4 bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/30 shadow-sm">
                <span className="font-title-md text-[16px] font-bold text-on-surface">{t('run.tab_status')}</span>
                <span className="font-label-sm text-label-sm text-on-surface-variant">{t('run.written')} <strong className="text-primary font-bold text-[14px]">{answeredCount}</strong>/{total}</span>
              </div>
              <div className="w-full h-2 bg-surface-container-high rounded-full overflow-hidden mb-5"><div className="h-full bg-primary transition-all" style={{ width: `${(answeredCount / total) * 100}%` }}></div></div>
              <div className="grid grid-cols-5 sm:grid-cols-6 gap-2">
                {questions.map((qq, i) => {
                  const done = selected[i] !== null
                  const cur = i === index
                  return (
                    <button
                      key={qq.id}
                      onClick={() => setIndex(i)}
                      className={`aspect-square rounded-lg font-label-md text-[14px] font-bold flex items-center justify-center border transition-colors ${cur ? 'border-primary ring-2 ring-primary/30 text-primary bg-surface-container-lowest' : done ? 'bg-primary text-on-primary border-primary' : 'bg-surface-container-lowest border-outline-variant/40 text-on-surface-variant hover:border-outline'}`}
                    >
                      {i + 1}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </section>
      </main>

      {/* Bottom Action Bar */}
      <footer className="bg-surface-container-lowest border-t border-outline-variant/30 p-4 flex items-center justify-between sticky bottom-0 z-50 relative">
        <div className="flex items-center gap-2">
          <span className="font-bold text-primary text-[16px]">{index + 1}</span>
          <span className="text-outline text-[14px]">/ {total}</span>
        </div>
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-3">
          <button disabled={index === 0 || submitting} onClick={() => setIndex((i) => Math.max(0, i - 1))} className="px-6 py-2 rounded-lg border border-outline-variant text-on-surface-variant font-semibold hover:bg-surface-container transition-colors disabled:opacity-40">{t('run.prev')}</button>
          <button disabled={index + 1 >= total || submitting} onClick={() => setIndex((i) => Math.min(total - 1, i + 1))} className="px-6 py-2 rounded-lg border border-outline-variant text-on-surface-variant font-semibold hover:bg-surface-container transition-colors disabled:opacity-40">{t('run.next')}</button>
        </div>
        <button disabled={submitting} onClick={onClickSubmit} className="px-8 py-2 rounded-lg bg-primary text-on-primary font-bold hover:shadow-lg transition-all disabled:opacity-60">{submitting ? t('run.submitting') : t('run.submit')}</button>
      </footer>
    </div>
  )
}
