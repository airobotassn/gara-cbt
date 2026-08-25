import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { callFunction } from '../lib/supabase'
import { useInputGuard, useLeaveGuard } from '../hooks/useAntiCheat'
import { isMobileDevice } from '../lib/device'
import MobileBlock from '../components/MobileBlock'
import SebRequired from '../components/SebRequired'
import SebExitButton from '../components/SebExitButton'
import { SEB_REQUIRED, isSEB } from '../lib/seb'
import { examAuthHeaders } from '../lib/examToken'
import { HEARTBEAT_MS, primeExamSession, sendClosed, sendPing, type DraftAnswer } from '../lib/examSession'
import { makePracticeExam } from '../lib/practice'
import { useT } from '../lib/i18n'
import type { StartExamResponse, SubmittedAnswer, SubmitExamResponse } from '../lib/types'

// gara_6 (정기시험 응시 화면) 목업 디자인 + 응시 로직(타이머·부정행위·OMR·제출) 전부 보존.
// 원본: stitch_design_critique_assistant/gara_6/code.html
// CBT(응시 화면)는 테마와 무관하게 항상 라이트 — 루트에 .force-light 적용(다크 토큰 무시).

export default function CbtRunner() {
  const { t } = useT()
  const { attemptId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  // 관리자 검수용 미리보기 — 등록시험 세트를 실제 응시 화면 그대로 렌더(SEB·모바일·서버 제출 없음).
  //   /exam/run/preview?examId=<id> 로 진입(새 탭 가능) → admin.examPreview 로 세트 로드.
  const preview = attemptId === 'preview'
  const examId = preview ? new URLSearchParams(location.search).get('examId') || '' : ''
  const [pStart, setPStart] = useState<StartExamResponse | null>(
    preview ? ((location.state as StartExamResponse | null) ?? null) : null,
  )
  const [pErr, setPErr] = useState('')
  useEffect(() => {
    if (!preview || pStart || !examId) return
    let alive = true
    callFunction<StartExamResponse>('admin', { action: 'examPreview', examId })
      .then((r) => alive && setPStart(r))
      .catch((e) => alive && setPErr(e instanceof Error ? e.message : '미리보기를 불러오지 못했습니다.'))
    return () => {
      alive = false
    }
  }, [preview, pStart, examId])

  if (preview) {
    if (!examId) return <PreviewNotice title="미리보기를 열 수 없습니다" sub="미리보기할 시험(examId)이 지정되지 않았습니다." onBack={() => navigate('/admin')} />
    if (pErr) return <PreviewNotice title="미리보기를 열 수 없습니다" sub={pErr} onBack={() => navigate('/admin')} />
    if (!pStart) return <PreviewNotice title="시험 화면 미리보기" sub="등록된 문항을 불러오는 중…" />
    return <RunnerInner start={pStart} />
  }

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
          {/* ⚠️ SEB 안에서는 '/exam' 으로 보내봐야 거기도 나가는 길이 없다 — 잠금 브라우저에선
              종료 버튼만 준다(뒤로가기·주소창이 막혀 있어 이게 유일한 탈출구다). */}
          {isSEB() ? (
            <SebExitButton className="bg-primary text-on-primary font-label-md font-bold px-6 py-3 rounded-xl hover:shadow-lg transition-all" />
          ) : (
            <button className="bg-primary text-on-primary font-label-md font-bold px-6 py-3 rounded-xl hover:shadow-lg transition-all" onClick={() => navigate('/exam')}>
              {t('run.to_exam')}
            </button>
          )}
        </div>
      </div>
    )
  }

  return <RunnerInner start={start} />
}

// 미리보기 로딩/오류 안내 — 실제 응시 화면과 동일한 라이트 테마.
function PreviewNotice({ title, sub, onBack }: { title: string; sub: string; onBack?: () => void }) {
  return (
    <div className="force-light bg-surface min-h-screen flex items-center justify-center p-6">
      <div className="bg-surface-container-lowest rounded-2xl p-10 border border-outline-variant/30 text-center max-w-md w-full shadow-sm">
        <div className="text-[40px] mb-3">{onBack ? '⚠️' : '⏳'}</div>
        <h2 className="font-title-md text-title-md font-bold text-on-surface mb-2">{title}</h2>
        <p className="font-body-md text-body-md text-on-surface-variant mb-6">{sub}</p>
        {onBack && (
          <button className="bg-primary text-on-primary font-label-md font-bold px-6 py-3 rounded-xl hover:shadow-lg transition-all" onClick={onBack}>
            관리자로 돌아가기
          </button>
        )}
      </div>
    </div>
  )
}

function fmt(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function RunnerInner({ start }: { start: StartExamResponse }) {
  const { t } = useT()
  const navigate = useNavigate()
  const { questions, exam } = start
  const total = questions.length
  const preview = start.attemptId === 'preview' // 관리자 검수 미리보기 — 서버 제출·부정행위 가드 없음

  const [index, setIndex] = useState(0)
  // 끊겼다 돌아온 응시는 **중간 저장된 답으로 시작**한다(서버가 start-exam 응답에 실어준다).
  // 처음 시작한 응시면 전부 비어 있어 기존과 똑같다.
  const [selected, setSelected] = useState<(number | null)[]>(() => {
    const base: (number | null)[] = Array(total).fill(null)
    for (const a of start.saved ?? []) {
      const i = questions.findIndex((q) => q.number === a.number)
      if (i >= 0) base[i] = a.selectedIndex
    }
    return base
  })
  const [texts, setTexts] = useState<string[]>(() => {
    const base: string[] = Array(total).fill('')
    for (const a of start.saved ?? []) {
      const i = questions.findIndex((q) => q.number === a.number)
      if (i >= 0) base[i] = a.answerText ?? ''
    }
    return base
  }) // 주관식 답안
  const [submitting, setSubmitting] = useState(false)
  const [askQuit, setAskQuit] = useState(false) // 종료(포기) 확인 모달 — 네이티브 confirm은 전체화면 해제+포커스 이탈로 부정행위 오탐 유발 → 금지
  const submittedRef = useRef(false)

  // 문제 영역 / 답안지(OMR) 스크롤 컨테이너 + 답안지 각 행 — 문항 이동 시 답안지를 따라가게 하는 데 쓴다.
  const paperRef = useRef<HTMLElement>(null)
  const omrRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])

  // 답한 문항 수 — 하트비트/종료신호에 같이 실어 "끊긴 시점에 어디까지 풀었나"를 남긴다.
  //   (아무것도 안 풀고 훑기만 하다 나갔는지가 복구 판단에서 갈리는 지점이다.)
  const answeredNow = useCallback(
    () => questions.reduce((n, q, i) => n + ((q.kind === 'short' ? texts[i].trim() !== '' : selected[i] !== null) ? 1 : 0), 0),
    [questions, selected, texts],
  )
  // 최신 값을 ref 로 복사해 둔다 — 아래 하트비트/언로드 핸들러가 답안이 바뀔 때마다
  // 재등록되지 않게 하려는 것이다(30초 타이머가 매 클릭마다 리셋되면 하트비트가 안 나간다).
  const answeredRef = useRef(0)
  // 하트비트가 실어 보낼 답안 스냅샷 — 값이 바뀔 때마다 타이머를 다시 걸지 않으려고 ref 에 둔다.
  const draftRef = useRef<DraftAnswer[]>([])
  useEffect(() => {
    answeredRef.current = answeredNow()
    draftRef.current = questions.map((q, i) => ({
      number: q.number,
      selectedIndex: q.kind === 'short' ? null : selected[i],
      answerText: q.kind === 'short' ? texts[i] : null,
    }))
  }, [answeredNow, questions, selected, texts])

  // 생존 신호 — 실제 응시에서만. 미리보기·모의는 서버에 기록할 게 없다.
  const traced = !preview && start.attemptId !== 'practice'
  useEffect(() => {
    if (!traced) return
    // 떠나는 순간 쓸 인증 헤더를 미리 만들어 둔다(그때 만들면 늦는다 — examSession.ts 주석 참고).
    void primeExamSession()
    sendPing(start.attemptId, answeredRef.current, draftRef.current)
    const id = window.setInterval(() => sendPing(start.attemptId, answeredRef.current, draftRef.current), HEARTBEAT_MS)
    // ⚠️ `pagehide` 를 쓴다. `beforeunload` 는 SEB·모바일에서 안 오는 경우가 있고,
    //    `unload` 는 keepalive 요청이 씹히는 브라우저가 있다.
    const onHide = () => {
      if (submittedRef.current) return // 제출·종료로 끝낸 건은 이미 서버가 안다
      sendClosed(start.attemptId, answeredRef.current, 'unload')
    }
    window.addEventListener('pagehide', onHide)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('pagehide', onHide)
    }
  }, [traced, start.attemptId])

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

  // 문항 응답 완료 여부 — 객관식=보기 선택, 주관식=텍스트 입력
  const isAnswered = useCallback(
    (i: number) => (questions[i].kind === 'short' ? texts[i].trim() !== '' : selected[i] !== null),
    [questions, selected, texts],
  )

  const buildAnswers = useCallback((): SubmittedAnswer[] => {
    const t = startTimeRef.current[index]
    if (t) {
      spentRef.current[index] += Math.round((performance.now() - t) / 1000)
      startTimeRef.current[index] = performance.now()
    }
    return questions.map((q, i) => ({
      questionId: q.id,
      selectedIndex: q.kind === 'short' ? null : selected[i],
      answerText: q.kind === 'short' ? texts[i] : null,
      timeSpent: spentRef.current[i],
    }))
  }, [questions, selected, texts, index])

  const doSubmit = useCallback(async () => {
    if (submittedRef.current) return
    submittedRef.current = true
    setSubmitting(true)
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
    // 검수 미리보기 — 서버 제출 없이 관리자 페이지로 복귀
    if (preview) {
      navigate('/admin', { replace: true })
      return
    }
    // 모의 문제(practice) — 백엔드 호출 없이 완료 화면으로
    if (start.attemptId === 'practice') {
      navigate('/exam/complete', { state: { mode: 'practice', seb: isSEB() }, replace: true })
      return
    }
    try {
      // ⚠️ SEB 안에는 로그인 세션이 없다 — /exam/seb 가 받아둔 시험 전용 토큰을 헤더로 실어야 제출이 된다.
      //    일반 브라우저에서는 토큰이 없어 헤더가 undefined 이고, 서버가 평소처럼 세션을 본다.
      const res = await callFunction<SubmitExamResponse>('submit-exam', {
        attemptId: start.attemptId,
        answers: buildAnswers(),
      }, examAuthHeaders())
      // 보안 브라우저: 완료 화면을 거쳐 SEB 종료(결과는 발표일 이후 마이페이지). 일반 브라우저(개발): 결과 페이지로.
      if (isSEB()) {
        navigate('/exam/complete', { state: { mode: 'submitted', seb: true }, replace: true })
        return
      }
      navigate(`/exam/result/${start.attemptId}`, { state: res, replace: true })
    } catch (e) {
      submittedRef.current = false
      setSubmitting(false)
      alert(e instanceof Error ? e.message : t('run.submit_fail'))
    }
  }, [start.attemptId, preview, buildAnswers, navigate, t])

  // 종료(포기): 이번 응시를 무효 처리하고 시험을 빠져나간다. 채점 없음.
  const doQuit = useCallback(async () => {
    if (submittedRef.current) return
    submittedRef.current = true
    setAskQuit(false)
    setSubmitting(true)
    // 검수 미리보기 — 무효 기록 없이 관리자 페이지로 복귀
    if (preview) {
      navigate('/admin', { replace: true })
      return
    }
    const practice = start.attemptId === 'practice'
    // 실제 시험만 서버에 무효 기록(모의는 백엔드 호출 없음). 기록 실패해도 응시자는 나가도록 둔다(서버는 TTL 만료로 정리).
    if (!practice) {
      try {
        await callFunction('submit-exam', { attemptId: start.attemptId, answers: [], voided: true }, examAuthHeaders())
      } catch {
        /* 무효 기록 실패 — 그래도 종료 진행 */
      }
    }
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
    // 완료 화면으로 — SEB 는 거기서 종료 URL 로 이동해 자동 종료
    navigate('/exam/complete', {
      state: { mode: practice ? 'practice' : 'voided', seb: isSEB() },
      replace: true,
    })
  }, [start.attemptId, preview, navigate])

  // 사용자가 누르는 제출: 미응답 가드 → 경고 → 미응답 문항으로 이동
  const onClickSubmit = useCallback(() => {
    if (submitting) return
    // 검수 미리보기 — 미응답 가드 없이 종료 확인만
    if (preview) {
      if (window.confirm('미리보기를 종료할까요?')) doSubmit()
      return
    }
    const unanswered: number[] = []
    questions.forEach((_, i) => {
      if (!isAnswered(i)) unanswered.push(i)
    })
    if (unanswered.length > 0) {
      window.alert(t('run.unanswered_warn', { n: unanswered.length, first: unanswered[0] + 1 }))
      setIndex(unanswered[0])
      return
    }
    if (window.confirm(t('run.submit_confirm'))) doSubmit()
  }, [questions, isAnswered, submitting, preview, doSubmit, t])

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
  const guardEnabled = !submitting && !preview && start.attemptId !== 'practice' && !isSEB()
  const { masked: inputMasked } = useInputGuard({ enabled: guardEnabled })
  const { masked: leaveMasked } = useLeaveGuard({ enabled: guardEnabled })
  const masked = inputMasked || leaveMasked

  const choose = useCallback((qIdx: number, opt: number) => {
    if (submitting) return
    setSelected((arr) => {
      const next = [...arr]
      next[qIdx] = opt
      return next
    })
  }, [submitting])

  // 키보드 조작 — 숫자키(1~4)로 보기 선택, ←/→ 로 이전·다음 문항. 레벨테스트(TestRunner)와 같은 규칙.
  //   · 주관식(short)은 choices 가 [] 라 숫자키가 자연히 무시되고, 답안 textarea 에 포커스가 있는 동안엔
  //     숫자·화살표를 전부 흘려보낸다(타이핑과 캐럿 이동이 우선).
  //   · 첫/마지막 문항에서의 ←/→ 는 아무것도 안 한다 — 하단 이전·다음 버튼의 disabled 조건과 동일.
  //     제출은 미응답 가드가 붙은 '제출' 버튼 전용이다(화살표로 시험이 끝나면 안 된다).
  //   · 부정행위 가림(masked)·제출 중·종료 모달일 땐 리스너를 아예 안 건다.
  //   · 마우스로 보기를 고른 뒤 →로 넘기면 그 버튼에 포커스가 남아 다음 문항에서 Enter 가 엉뚱한 보기를
  //     누르므로 문항 이동 시 포커스를 푼다(blur 는 버블링 안 해 이탈감지와 무관).
  useEffect(() => {
    if (submitting || masked || askQuit) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return

      const cur = questions[index]
      const n = Number(e.key) // 숫자열·넘패드 모두 e.key 는 '1'…'9'
      if (cur.kind !== 'short' && Number.isInteger(n) && n >= 1 && n <= cur.choices.length) {
        e.preventDefault()
        choose(index, n - 1)
        return
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const to = e.key === 'ArrowRight' ? index + 1 : index - 1
        if (to < 0 || to >= total) return
        e.preventDefault()
        if (el instanceof HTMLElement) el.blur()
        setIndex(to)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [submitting, masked, askQuit, questions, index, total, choose])

  function writeText(qIdx: number, v: string) {
    if (submitting) return
    setTexts((arr) => {
      const next = [...arr]
      next[qIdx] = v
      return next
    })
  }

  const q = questions[index]
  const answeredCount = questions.reduce((n, _, i) => n + (isAnswered(i) ? 1 : 0), 0)
  const low = remainMs <= 5 * 60000

  // 문항이 바뀌면 문제 영역은 맨 위부터 읽게 되돌린다(답 선택으로는 움직이면 안 되므로 index 에만 반응).
  useEffect(() => {
    paperRef.current?.scrollTo({ top: 0 })
  }, [index])

  // 답안지를 현재 문항에 맞춘다 — 문항을 옮겼을 때뿐 아니라 **왼쪽에서 답을 고른 순간**에도.
  //   (답안지를 1번 근처로 올려둔 채 20번을 풀면, 3번을 찍어도 어디에 표기됐는지 안 보이던 문제)
  //   이미 보이는 행이면 아무것도 하지 않는다 — 답안지에서 직접 번호/보기를 누른 경우 화면이 튀지 않도록.
  //   컨테이너 안에서만 움직여야 해서 scrollIntoView(조상까지 스크롤) 대신 직접 계산한다.
  const curMark = q.kind === 'short' ? (texts[index].trim() ? 1 : 0) : selected[index]
  useEffect(() => {
    const row = rowRefs.current[index]
    const box = omrRef.current
    if (!row || !box) return
    const r = row.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    const pad = 12
    if (r.top < b.top + pad) box.scrollBy({ top: r.top - b.top - pad, behavior: 'smooth' })
    else if (r.bottom > b.bottom - pad) box.scrollBy({ top: r.bottom - b.bottom + pad, behavior: 'smooth' })
  }, [index, curMark])

  // 루트를 뷰포트 높이에 '고정'한다(min-h 가 아니라 h + overflow-hidden).
  //   min-h-screen 이면 컨테이너가 내용만큼 늘어나 안쪽 overflow-y-auto 가 아예 발동하지 않고
  //   페이지 전체가 스크롤된다 → 문제와 답안지가 한 덩어리로 같이 움직이던 원인.
  //   (응시 화면은 isMobileDevice() 로 모바일을 막으므로 데스크톱 전제로 잡아도 안전)
  return (
    <div
      className="force-light bg-surface h-dvh overflow-hidden flex flex-col font-body-md text-on-surface no-select"
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
      <header className="bg-surface-container-lowest border-b border-outline-variant/30 h-16 shrink-0 flex items-center px-4 md:px-margin-desktop justify-between z-50">
        <div className="flex items-center gap-2">
          <img alt="CARIS" className="h-8 w-8 object-cover rounded-full" src="/logo.png" />
          <span className="font-title-md text-title-md font-bold text-on-surface tracking-tight">{t('run.top_title', { title: exam.title })}</span>
          {preview && (
            <span className="ml-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 border border-amber-500/30 text-[11px] font-bold">검수 미리보기</span>
          )}
        </div>
        <div className="flex items-center gap-4 md:gap-6">
          {/* 진행 게이지 — 푼 문항 수 / 전체 (돋보기 자리 대체) */}
          <div className="flex items-center gap-2 px-4 py-2 rounded-full border bg-primary/5 border-primary/20" title={t('run.progress_title')}>
            <div className="w-14 md:w-16 h-1.5 rounded-full bg-primary/15 overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${total ? (answeredCount / total) * 100 : 0}%` }}></div>
            </div>
            <span className="font-bold text-[14px] text-primary tabular-nums">{answeredCount}/{total}</span>
          </div>
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full border ${low ? 'bg-error/5 border-error/20' : 'bg-primary/5 border-primary/20'}`} title={t('run.timer_title')}>
            <span className={`material-symbols-outlined text-[20px] ${low ? 'text-error' : 'text-primary'}`}>timer</span>
            <span className={`font-bold text-[16px] tabular-nums ${low ? 'text-error' : 'text-primary'}`}>{fmt(remainMs)}</span>
          </div>
          {/* 종료(포기) — 응시를 무효 처리하고 나감. 실수 방지 위해 확인 모달 경유 */}
          <button
            type="button"
            disabled={submitting}
            onClick={() => setAskQuit(true)}
            title={t('run.quit')}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-outline-variant text-on-surface-variant font-semibold hover:bg-error/5 hover:border-error/40 hover:text-error transition-colors disabled:opacity-40"
          >
            <span className="material-symbols-outlined text-[20px]">logout</span>
            <span className="font-label-sm text-label-sm">{t('run.quit')}</span>
          </button>
        </div>
      </header>

      {/* Split */}
      {/* min-h-0 이 없으면 flex 자식의 기본 min-height:auto 때문에 내용만큼 늘어나 스크롤이 안 생긴다. */}
      <main className="flex-1 min-h-0 flex flex-col lg:flex-row w-full overflow-hidden bg-surface-container-lowest">
        {/* Left: 문제 — 답안지와 독립 스크롤 */}
        <section ref={paperRef} className="flex-[6] min-h-0 flex flex-col bg-surface-container-lowest border-r border-outline-variant/30 overflow-y-auto">
          <div className="p-8 md:p-12 flex flex-col gap-8 w-full">
            <div className="flex items-start justify-between border-b border-outline-variant/30 pb-4">
              <div className="flex items-baseline gap-2">
                <span className="font-title-md text-title-md text-outline font-bold">{t('run.question')}</span>
                <span className="font-headline-lg text-headline-lg font-black text-primary tracking-tight">{index + 1}</span>
              </div>
              <div className="flex gap-2">
                {q.subject && <span className="px-3 py-1 bg-primary/10 text-primary text-[11px] uppercase tracking-wider font-bold rounded-full border border-primary/20">{q.subject}</span>}
              </div>
            </div>
            <div className="space-y-4">
              <h2 className="font-title-md text-xl md:text-2xl font-bold text-on-surface leading-snug break-keep">{q.prompt}</h2>
            </div>
            {q.kind === 'short' ? (
              <div className="mt-2 pb-12">
                <textarea
                  value={texts[index]}
                  onChange={(e) => writeText(index, e.target.value)}
                  disabled={submitting}
                  rows={8}
                  placeholder={t('run.short_placeholder')}
                  className="w-full rounded-xl border border-outline-variant/50 bg-surface-container-lowest p-4 font-body-md text-body-md text-on-surface leading-relaxed resize-y focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all"
                />
                <div className="mt-2 flex justify-between font-label-sm text-label-sm text-on-surface-variant">
                  <span>{t('run.short_hint')}</span>
                  <span className="tabular-nums">{texts[index].length}{t('run.short_chars')}</span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 mt-2 pb-12">
                {q.choices.map((opt, i) => {
                  const sel = selected[index] === i
                  return (
                    <button
                      key={i}
                      onClick={() => choose(index, i)}
                      className={`group relative flex items-center p-4 rounded-xl text-left transition-all cursor-pointer shadow-sm ${sel ? 'border-2 border-primary bg-primary-fixed/10' : 'border border-outline-variant/50 bg-surface-container-lowest hover:bg-surface-container-low hover:border-primary/50 hover:shadow'}`}
                    >
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center font-label-sm text-label-sm shrink-0 mr-3 transition-all ${sel ? 'bg-primary border-primary text-on-primary' : 'border border-outline-variant text-outline group-hover:border-primary group-hover:text-primary'}`}>{i + 1}</div>
                      <span className={`font-body-md text-body-md ${sel ? 'font-semibold text-primary' : 'text-on-surface'}`}>{opt}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        {/* Right: 답안지/현황 */}
        <section className="flex-[4] min-h-0 flex flex-col bg-surface overflow-hidden">
          {/* 답안지(OMR) — 진행 현황 포함 (별도 '현황' 탭 없음). 문제 영역과 독립 스크롤. */}
            <div ref={omrRef} className="p-6 flex-1 min-h-0 overflow-y-auto bg-surface-container-low">
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
                    <div
                      key={qq.id}
                      ref={(el) => { rowRefs.current[i] = el }}
                      className={`grid grid-cols-[80px_1fr] border-b border-outline-variant/20 transition-colors ${cur ? 'bg-primary/5' : 'hover:bg-surface-container-low'}`}
                    >
                      <button onClick={() => setIndex(i)} className={`py-4 flex items-center justify-center font-title-md text-[16px] border-r border-outline-variant/20 relative ${cur ? 'font-bold text-primary' : 'text-on-surface-variant'}`}>
                        {cur && <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary rounded-r-sm"></div>}
                        {i + 1}
                      </button>
                      {qq.kind === 'short' ? (
                        // 주관식 — 1~4 대신 작성 여부 표시(클릭 시 해당 문항으로 이동)
                        <button onClick={() => setIndex(i)} className="py-4 flex items-center gap-2 px-4 text-left">
                          <span className={`material-symbols-outlined text-[18px] ${isAnswered(i) ? 'text-primary' : 'text-outline'}`} style={isAnswered(i) ? { fontVariationSettings: "'FILL' 1" } : undefined}>
                            {isAnswered(i) ? 'edit_note' : 'edit'}
                          </span>
                          <span className={`font-label-sm text-label-sm ${isAnswered(i) ? 'text-primary font-semibold' : 'text-on-surface-variant'}`}>
                            {t('run.short_label')} · {isAnswered(i) ? t('run.short_done') : t('run.short_todo')}
                          </span>
                        </button>
                      ) : (
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
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
        </section>
      </main>

      {/* Bottom Action Bar */}
      <footer className="bg-surface-container-lowest border-t border-outline-variant/30 p-4 shrink-0 flex items-center justify-between z-50 relative">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-primary text-[16px]">{index + 1}</span>
            <span className="text-outline text-[14px]">/ {total}</span>
          </div>
          {/* 키보드 단축키 안내 — 이 화면은 isMobileDevice() 로 모바일을 막아 데스크톱 전제라 조건 없이 표시.
              주관식은 보기가 없어 숫자키가 안 먹으므로 이동 안내만 띄운다. */}
          <span className="text-[12px] text-outline tabular-nums whitespace-nowrap">
            {q.kind === 'short' ? t('kbd.hint_nav') : t('kbd.hint', { n: q.choices.length })}
          </span>
        </div>
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-3">
          <button disabled={index === 0 || submitting} onClick={() => setIndex((i) => Math.max(0, i - 1))} className="px-6 py-2 rounded-lg border border-outline-variant text-on-surface-variant font-semibold hover:bg-surface-container transition-colors disabled:opacity-40">{t('run.prev')}</button>
          <button disabled={index + 1 >= total || submitting} onClick={() => setIndex((i) => Math.min(total - 1, i + 1))} className="px-6 py-2 rounded-lg border border-outline-variant text-on-surface-variant font-semibold hover:bg-surface-container transition-colors disabled:opacity-40">{t('run.next')}</button>
        </div>
        <button disabled={submitting} onClick={onClickSubmit} className="px-8 py-2 rounded-lg bg-primary text-on-primary font-bold hover:shadow-lg transition-all disabled:opacity-60">{submitting ? t('run.submitting') : t('run.submit')}</button>
      </footer>

      {/* 종료(포기) 확인 모달 — 페이지 내 렌더(네이티브 confirm 금지: 부정행위 오탐 방지) */}
      {askQuit && (
        <div className="fixed inset-0 z-[300] bg-black/45 flex items-center justify-center p-6">
          <div className="bg-surface-container-lowest rounded-2xl p-8 border border-outline-variant/30 text-center max-w-md w-full shadow-xl">
            <div className="w-14 h-14 rounded-full bg-error/10 flex items-center justify-center mx-auto mb-4">
              <span className="material-symbols-outlined text-error text-[28px]">logout</span>
            </div>
            <h2 className="font-title-md text-title-md font-bold text-on-surface mb-2">{t('run.quit_title')}</h2>
            <p className="font-body-md text-body-md text-on-surface-variant whitespace-pre-line mb-6">{t('run.quit_confirm')}</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setAskQuit(false)}
                className="flex-1 px-6 py-3 rounded-xl border border-outline-variant text-on-surface-variant font-bold hover:bg-surface-container transition-colors"
              >
                {t('run.quit_no')}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={doQuit}
                className="flex-1 px-6 py-3 rounded-xl bg-error text-on-error font-bold hover:shadow-lg transition-all disabled:opacity-60"
              >
                {t('run.quit_yes')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
