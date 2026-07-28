import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { callFunction } from '../lib/supabase'
import { useAntiCheat } from '../hooks/useAntiCheatLevel'
import { MAX_VIOLATIONS, durationMinutesForLevel } from '../lib/testConfigLevel'
import { useT } from '../lib/i18n'
import { axisDef } from '../lib/categories'
import type {
  StartTestResponse,
  ResultResponse,
  SubmittedAnswer,
} from '../lib/testTypes'

export default function TestRunner() {
  const { attemptId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useT()
  const start = location.state as StartTestResponse | null

  if (!start || start.attemptId !== attemptId) {
    return (
      <div className="wrap">
        <div className="card pad" style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>{t('test.nodata')}</p>
          <button
            className="btn-ink"
            style={{ marginTop: 18 }}
            onClick={() => navigate('/test/select')}
          >
            {t('test.restart')}
          </button>
        </div>
      </div>
    )
  }

  return <RunnerInner start={start} />
}

function RunnerInner({ start }: { start: StartTestResponse }) {
  const navigate = useNavigate()
  const { t, lang } = useT()
  const { questions } = start
  const total = questions.length

  const [index, setIndex] = useState(0)
  const [started, setStarted] = useState(false) // 경고 게이트 통과 후 시작
  const [selected, setSelected] = useState<(number | null)[]>(
    () => Array(total).fill(null),
  )
  const [submitting, setSubmitting] = useState(false)
  const [askSubmit, setAskSubmit] = useState(false) // 제출 확인 모달 (네이티브 confirm 대신 — 전체화면/포커스 안 건드려 부정행위 오탐 방지)
  const [askQuit, setAskQuit] = useState(false) // 나가기 확인 모달 (동일 이유로 네이티브 confirm 금지)
  const [voided, setVoided] = useState(false)
  const submittedRef = useRef(false)
  const violationsRef = useRef(0)

  const startTimeRef = useRef<number[]>(Array(total).fill(0))
  const spentRef = useRef<number[]>(Array(total).fill(0))

  useEffect(() => {
    startTimeRef.current[index] = performance.now()
    return () => {
      const started = startTimeRef.current[index]
      if (started) {
        spentRef.current[index] += Math.round((performance.now() - started) / 1000)
      }
    }
  }, [index])

  const buildAnswers = useCallback((): SubmittedAnswer[] => {
    const started = startTimeRef.current[index]
    if (started) {
      spentRef.current[index] += Math.round((performance.now() - started) / 1000)
      startTimeRef.current[index] = performance.now()
    }
    return questions.map((q, i) => ({
      questionId: q.id,
      selectedIndex: selected[i],
      timeSpent: spentRef.current[i],
    }))
  }, [questions, selected, index])

  const submit = useCallback(async () => {
    if (submittedRef.current) return
    submittedRef.current = true
    setSubmitting(true)
    try {
      const res = await callFunction<ResultResponse>('submit-test', {
        attemptId: start.attemptId,
        answers: buildAnswers(),
        violationCount: violationsRef.current,
      })
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
      navigate(`/test/result/${start.attemptId}`, { state: res, replace: true })
    } catch (e) {
      submittedRef.current = false
      setSubmitting(false)
      alert(e instanceof Error ? e.message : t('test.submit_failed'))
    }
  }, [start.attemptId, buildAnswers, navigate, t])

  const voidByCheat = useCallback(() => {
    submittedRef.current = true
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    setVoided(true)
    // 서버에 무효(부정행위) 기록 — fire-and-forget
    callFunction('submit-test', {
      attemptId: start.attemptId,
      answers: [],
      violationCount: violationsRef.current,
      voided: true,
    }).catch(() => {})
  }, [start.attemptId])

  const { violations, lastWarning, enterFullscreen } = useAntiCheat({
    enabled: started && !submitting && !voided,
    onLimitReached: voidByCheat,
  })

  useEffect(() => {
    violationsRef.current = violations
  }, [violations])

  // 제한시간 카운트다운 — 레벨 구간별(문항 수와 같은 값의 분, 문항당 1분). 0 도달 시 자동 제출.
  const durationMin = durationMinutesForLevel(start.level)
  const deadlineRef = useRef<number | null>(null)
  const [remainMs, setRemainMs] = useState(durationMin * 60000)
  useEffect(() => {
    if (!started || voided) return
    if (deadlineRef.current == null) deadlineRef.current = Date.now() + durationMin * 60000
    const tick = () => {
      const left = Math.max(0, (deadlineRef.current as number) - Date.now())
      setRemainMs(left)
      if (left <= 0) submit()
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [started, voided, submit, durationMin])

  // 경고 게이트의 "시작" 버튼에서 호출 — 사용자 제스처라 전체화면 진입이 허용된다.
  async function begin() {
    await enterFullscreen()
    setStarted(true)
  }

  const goNext = useCallback(() => {
    if (index + 1 < total) {
      setIndex((i) => i + 1)
      return
    }
    // 마지막 문항: 페이지 내 모달로 확인(실수 제출 방지). 네이티브 confirm은 전체화면 해제+포커스 이탈로 부정행위 오탐 유발 → 금지.
    // 시간초과 자동제출은 submit() 직접 호출이라 여기 안 탐.
    if (submitting) return
    setAskSubmit(true)
  }, [index, total, submitting])

  const goPrev = useCallback(() => {
    if (index > 0) setIndex((i) => i - 1)
  }, [index])

  const choose = useCallback((optIdx: number) => {
    setSelected((arr) => {
      const next = [...arr]
      next[index] = optIdx
      return next
    })
  }, [index])

  // 키보드 조작 — 숫자키(1~N)로 보기 선택, ←/→ 로 이전·다음 문항.
  //   · 보기 버튼에 이미 번호 뱃지(.opt .key)가 찍혀 있어 숫자키 매핑이 그대로 보인다.
  //   · 마지막 문항에서 → 는 goNext 가 제출 확인 모달을 띄운다(바로 제출 아님).
  //   · 모달이 떠 있거나 제출 중이면 리스너를 아예 안 건다(모달 위에서 문항이 넘어가는 사고 방지).
  //   · 마우스로 보기를 고른 뒤 →로 넘기면 그 버튼에 포커스가 남아 다음 문항에서 Enter 가
  //     엉뚱한 보기를 누르므로, 문항 이동 시 포커스를 푼다(blur 는 버블링 안 해 이탈감지와 무관).
  useEffect(() => {
    if (!started || voided || submitting || askSubmit || askQuit) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return

      const n = Number(e.key) // 숫자열·넘패드 모두 e.key 는 '1'…'9'
      if (Number.isInteger(n) && n >= 1 && n <= questions[index].options.length) {
        e.preventDefault()
        choose(n - 1)
        return
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault()
        if (el instanceof HTMLElement) el.blur()
        if (e.key === 'ArrowRight') goNext()
        else goPrev()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [started, voided, submitting, askSubmit, askQuit, questions, index, choose, goNext, goPrev])

  function quit() {
    if (submitting) return
    setAskQuit(true)
  }
  function doQuit() {
    submittedRef.current = true
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    navigate('/')
  }

  if (voided) {
    return (
      <div className="wrap">
        <div className="card pad" style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: 'var(--danger-bg)',
              display: 'grid',
              placeItems: 'center',
              fontSize: 26,
              margin: '0 auto 14px',
            }}
          >
            🚫
          </div>
          <h2 className="sc-title" style={{ color: 'var(--danger-fg)' }}>
            {t('void.title')}
          </h2>
          <p className="sc-sub" style={{ marginBottom: 24 }}>
            {t('void.body')}
            <b>{t('void.body_strong')}</b>
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button className="btn-ink" onClick={() => navigate('/test/select')}>
              {t('void.restart')}
            </button>
            <button className="btn-ghost" onClick={() => navigate('/')}>
              {t('void.home')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // 시작 전 경고 게이트 — 전체화면/이탈경고/무효 규칙 안내 후 사용자 클릭으로 시작
  if (!started) {
    return (
      <div className="wrap">
        <div className="card pad intro-gate">
          <div className="intro-ico">⚠️</div>
          <h2 className="sc-title">{t('intro.title')}</h2>
          <p className="intro-meta">
            {t('intro.meta', { lv: start.level, q: total, min: durationMin })}
          </p>
          <div className="intro-anticheat">{t('intro.anticheat')}</div>
          <ul className="intro-rules">
            <li>
              <span className="ic">🖥️</span>
              {t('intro.fullscreen')}
            </li>
            <li>
              <span className="ic">🚪</span>
              {t('intro.rule_exit')}
            </li>
            <li>
              <span className="ic">📋</span>
              {t('intro.rule_block')}
            </li>
            <li>
              <span className="ic">🚫</span>
              {t('intro.rule_void', { m: MAX_VIOLATIONS })}
            </li>
          </ul>
          <div className="intro-actions">
            <button className="btn-ghost" onClick={() => navigate('/test/select')}>
              {t('intro.cancel')}
            </button>
            <button className="btn-ink" onClick={begin}>
              {t('intro.start')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const q = questions[index]
  // 상단 게이지 = **푼 문항 수** 기준(현재 위치 아님). 아래 문항 점프 그리드가 현재 위치를 이미 보여주고,
  // CBT 응시 화면(CbtRunner)의 진행 게이지도 같은 기준이라 두 시험의 게이지 의미를 맞춘다.
  const answered = selected.filter((s) => s !== null).length
  const progress = (answered / total) * 100
  const remainSec = Math.ceil(remainMs / 1000)
  const timeStr = `${Math.floor(remainSec / 60)}:${String(remainSec % 60).padStart(2, '0')}`
  const timeLow = remainMs <= 60000

  return (
    <div className="wrap no-select">
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="qtop">
          <div className="qtop-left">
            <div className="count">
              <b>{index + 1}</b> / {total}
            </div>
            {/* 키보드 단축키 안내 — 터치 기기에선 CSS 로 숨긴다(.kbd-hint) */}
            <span className="kbd-hint">{t('kbd.hint', { n: q.options.length })}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              style={{
                fontWeight: 800,
                fontVariantNumeric: 'tabular-nums',
                fontSize: 15,
                color: timeLow ? '#dc2626' : 'var(--ink, #1a2230)',
              }}
            >
              ⏱ {timeStr}
            </span>
            <span className="leave">{t('test.guard', { v: violations })}</span>
            <button className="quit-btn" onClick={quit} disabled={submitting}>
              {t('test.quit')}
            </button>
          </div>
        </div>
        {lastWarning ? (
          <div className="warn">
            ⚠️{' '}
            {t('warn.left', {
              n: violations,
              m: MAX_VIOLATIONS,
              r: t(`warn.${lastWarning}`),
            })}
          </div>
        ) : null}

        <div className="qbody">
          <span className="qcat">◆ {axisDef(q.category, lang).short}</span>
          <div className="qtext">{q.prompt}</div>
          <div className="opts">
            {q.options.map((opt, i) => (
              <button
                key={i}
                className={`opt ${selected[index] === i ? 'sel' : ''}`}
                onClick={() => choose(i)}
              >
                <span className="key">{i + 1}</span>
                <span className="lab">{opt}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 문항 점프 — 문항 수가 레벨 구간별(10/20/30)이라 10열 그리드로 1~3줄이 된다. 번호를 찍어
            30개여도 몇 번인지 바로 보이게 한다(예전엔 숫자 없는 점이라 개수가 늘면 못 알아봤다). */}
        <div className="qnav">
          {questions.map((_, i) => (
            <button
              key={i}
              aria-label={`${i + 1}`}
              className={`${i === index ? 'cur' : ''} ${
                selected[i] !== null ? 'answered' : ''
              }`}
              onClick={() => setIndex(i)}
            >
              {i + 1}
            </button>
          ))}
        </div>

        <div className="qfoot">
          {/* 진행 게이지 + 푼 문항 수 — 한 덩어리로 붙여 막대가 무슨 값인지 자명하게 한다. */}
          <div className="qprog">
            <span className="qprog-bar">
              <i style={{ width: `${progress}%` }} />
            </span>
            <span className="count">{t('test.solved', { a: answered, t: total })}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              className="btn-ghost"
              onClick={goPrev}
              disabled={index === 0 || submitting}
            >
              {t('test.prev')}
            </button>
            <button className="btn-ink" onClick={goNext} disabled={submitting}>
              {submitting
                ? t('test.submitting')
                : index + 1 >= total
                  ? t('test.submit')
                  : t('test.next')}
            </button>
          </div>
        </div>
      </div>

      {askSubmit ? (
        <div
          className="tr-submit-modal"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(0,0,0,0.45)',
            display: 'grid',
            placeItems: 'center',
            padding: 20,
          }}
        >
          <div className="card pad" style={{ maxWidth: 380, width: '100%', textAlign: 'center' }}>
            <p
              style={{
                whiteSpace: 'pre-line',
                fontSize: 16,
                lineHeight: 1.6,
                color: 'var(--txt)',
                margin: 0,
              }}
            >
              {selected.filter((s) => s === null).length > 0
                ? t('test.submit_confirm_unanswered', {
                    n: selected.filter((s) => s === null).length,
                  })
                : t('test.submit_confirm')}
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button className="btn-ghost" style={{ flex: 1 }} onClick={() => setAskSubmit(false)}>
                {t('intro.cancel')}
              </button>
              <button
                className="btn-ink"
                style={{ flex: 1 }}
                disabled={submitting}
                onClick={() => {
                  setAskSubmit(false)
                  submit()
                }}
              >
                {t('test.submit')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {askQuit ? (
        <div
          className="tr-quit-modal"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(0,0,0,0.45)',
            display: 'grid',
            placeItems: 'center',
            padding: 20,
          }}
        >
          <div className="card pad" style={{ maxWidth: 380, width: '100%', textAlign: 'center' }}>
            <p
              style={{
                whiteSpace: 'pre-line',
                fontSize: 16,
                lineHeight: 1.6,
                color: 'var(--txt)',
                margin: 0,
              }}
            >
              {t('test.quit_confirm')}
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button className="btn-ghost" style={{ flex: 1 }} onClick={() => setAskQuit(false)}>
                {t('intro.cancel')}
              </button>
              <button
                className="btn-ink"
                style={{
                  flex: 1,
                  background: 'var(--danger-fg)',
                  borderColor: 'var(--danger-fg)',
                  color: '#fff',
                }}
                onClick={doQuit}
              >
                {t('test.quit')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
