import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import { isMobileDevice } from '../lib/device'
import MobileBlock from '../components/MobileBlock'
import {
  SEB_REQUIRED,
  isSEB,
  sebConfigured,
  sebLaunchUrl,
  SEB_INSTALLER_URL,
} from '../lib/seb'
import {
  DEFAULT_EXAM_SLUG,
  TEST_DURATION_MINUTES,
  RESULT_RELEASE_DAYS,
} from '../lib/testConfig'
import type { StartExamResponse, MyAttempt } from '../lib/types'
import { useT } from '../lib/i18n'

// SEB 는 별도 앱이라, 시험이 끝나 SEB 가 닫혀도 이 브라우저 탭은 준비 화면에 그대로 남는다.
// → SEB 실행 시 "현재 완료된 응시 목록"을 기준선으로 저장하고, 이 탭에서 my-attempts 를 폴링하다가
//   기준선에 없던 '끝난 응시'가 나타나면(=SEB 에서 방금 제출/무효) 자동으로 완료 화면으로 넘긴다.
const SEB_WAIT_KEY = 'examSebWait' // localStorage: { at:number, finished:string[] }
const SEB_WAIT_TTL_MS = 4 * 60 * 60 * 1000 // 응시 TTL(240분)과 맞춤 — 오래된 대기 마커는 무시
const SEB_POLL_MS = 4000

const STEP_KEYS = [
  'prep.step_guide',
  'prep.step_notice',
  'prep.step_seb',
  'prep.step_menu',
  'prep.step_practice',
  'prep.step_ready',
]

// 국가공인 CBT 형태의 응시 전 단계 플로우 (창을 하나씩 넘기며 진행)
export default function ExamPrepare() {
  const navigate = useNavigate()
  const { isFullUser, loginWithGoogle } = useAuth()
  const { t, lang } = useT()
  const [step, setStep] = useState(0)
  const [agree, setAgree] = useState(false)
  const [practice, setPractice] = useState<number | null>(null)
  const [starting, setStarting] = useState(false)
  const [err, setErr] = useState('')
  const [waiting, setWaiting] = useState(false) // SEB 실행 후, 시험 종료를 이 탭에서 기다리는 중

  // 새로고침 등으로 재진입해도 대기 상태 복구(오래된 마커는 폐기)
  useEffect(() => {
    const raw = localStorage.getItem(SEB_WAIT_KEY)
    if (!raw) return
    try {
      const w = JSON.parse(raw) as { at?: number }
      if (!w?.at || Date.now() - w.at > SEB_WAIT_TTL_MS) {
        localStorage.removeItem(SEB_WAIT_KEY)
        return
      }
      setWaiting(true)
    } catch {
      localStorage.removeItem(SEB_WAIT_KEY)
    }
  }, [])

  // 대기 중: my-attempts 를 폴링 + 탭 복귀(focus/visibility) 시 즉시 재확인.
  // 기준선(finished)에 없던 '끝난 응시'가 보이면 SEB 에서 방금 끝난 것 → 완료 화면으로.
  useEffect(() => {
    if (!waiting) return
    let stopped = false
    const check = async () => {
      if (stopped) return
      const raw = localStorage.getItem(SEB_WAIT_KEY)
      if (!raw) return
      let w: { at: number; finished: string[] }
      try {
        w = JSON.parse(raw)
      } catch {
        localStorage.removeItem(SEB_WAIT_KEY)
        setWaiting(false)
        return
      }
      if (Date.now() - w.at > SEB_WAIT_TTL_MS) {
        localStorage.removeItem(SEB_WAIT_KEY)
        setWaiting(false)
        return
      }
      try {
        const { attempts } = await callFunction<{ attempts: MyAttempt[] }>('my-attempts', {})
        const baseline = new Set(w.finished ?? [])
        const done = (attempts ?? []).find(
          (a) => a.status !== 'in_progress' && !baseline.has(a.attemptId),
        )
        if (done && !stopped) {
          localStorage.removeItem(SEB_WAIT_KEY)
          setWaiting(false)
          navigate('/exam/complete', {
            state: { mode: done.status === 'submitted' ? 'submitted' : 'voided', seb: false },
            replace: true,
          })
        }
      } catch {
        /* 네트워크 일시 오류 — 다음 폴에서 재시도 */
      }
    }
    const id = window.setInterval(check, SEB_POLL_MS)
    const onVis = () => {
      if (!document.hidden) check()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', check)
    check()
    return () => {
      stopped = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', check)
    }
  }, [waiting, navigate])

  if (isMobileDevice()) return <MobileBlock />

  const inSeb = isSEB()
  const checks = [
    { ok: !isMobileDevice(), label: t('prep.chk_pc') },
    { ok: window.innerWidth >= 1024, label: t('prep.chk_screen') },
    { ok: !!document.fullscreenEnabled, label: t('prep.chk_fs') },
    { ok: navigator.onLine, label: t('prep.chk_net') },
  ]

  async function startExam() {
    if (!isFullUser) {
      localStorage.setItem('examIntent', '1')
      loginWithGoogle(`${window.location.origin}/auth/callback?next=${encodeURIComponent('/exam/prepare')}`)
      return
    }
    if (!agree || starting) return
    setErr('')

    // 보안 브라우저가 필요한데 일반 브라우저면 → SEB 로 시험 열기
    if (SEB_REQUIRED && !inSeb) {
      if (!sebConfigured()) {
        setErr(t('prep.err_seb_not_ready'))
        return
      }
      // 현재 완료된 응시를 기준선으로 저장 → SEB 에서 시험이 끝나면 이 탭이 감지해 자동 전환
      try {
        const { attempts } = await callFunction<{ attempts: MyAttempt[] }>('my-attempts', {})
        const finished = (attempts ?? [])
          .filter((a) => a.status !== 'in_progress')
          .map((a) => a.attemptId)
        localStorage.setItem(SEB_WAIT_KEY, JSON.stringify({ at: Date.now(), finished }))
        setWaiting(true)
      } catch {
        /* 기준선 조회 실패 — 자동 전환은 건너뛰고 SEB 실행만 진행(수동 이동 가능) */
      }
      window.location.href = sebLaunchUrl(lang)
      return
    }

    setStarting(true)
    try {
      try {
        await document.documentElement.requestFullscreen?.()
      } catch {
        /* 무시 */
      }
      const res = await callFunction<StartExamResponse>('start-exam', {
        examSlug: DEFAULT_EXAM_SLUG,
      })
      navigate(`/exam/run/${res.attemptId}`, { state: res })
    } catch (e) {
      setStarting(false)
      setErr(e instanceof Error ? e.message : t('prep.err_start'))
    }
  }

  const last = step === STEP_KEYS.length - 1

  if (waiting) {
    return (
      <div className="exam-center">
        <div className="exam-card" style={{ textAlign: 'center', maxWidth: 460 }}>
          <div className="exam-ico">🖥️</div>
          <h2 className="exam-title">{t('prep.waiting_title')}</h2>
          <p className="exam-sub" style={{ whiteSpace: 'pre-line' }}>
            {t('prep.waiting_sub')}
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
            <button className="exam-btn" onClick={() => navigate('/exam/check')}>
              {t('complete.to_check')}
            </button>
            <button
              className="exam-btn-ghost"
              onClick={() => {
                localStorage.removeItem(SEB_WAIT_KEY)
                setWaiting(false)
              }}
            >
              {t('prep.waiting_cancel')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="exam-center">
      <div className="prep">
        <ol className="prep-steps">
          {STEP_KEYS.map((s, i) => (
            <li key={s} className={`${i === step ? 'on' : ''} ${i < step ? 'done' : ''}`}>
              <span className="prep-no">{i < step ? '✓' : i + 1}</span>
              <span className="prep-label">{t(s)}</span>
            </li>
          ))}
        </ol>

        <div className="prep-body">
          <h2 className="prep-title">{t(STEP_KEYS[step])}</h2>

          {/* 0. 안내사항 */}
          {step === 0 && (
            <div className="prep-text">
              <p>{t('prep.guide_lead')}</p>
              <ul>
                <li>{t('prep.guide_li2')}</li>
                <li>{t('prep.guide_li3', { d: RESULT_RELEASE_DAYS })}</li>
                <li>{t('prep.guide_li4')}</li>
              </ul>
            </div>
          )}

          {/* 1. 유의사항 */}
          {step === 1 && (
            <div className="prep-text">
              <p>{t('prep.notice_lead')}</p>
              <ul>
                <li>{t('prep.notice_li1')}</li>
                <li>{t('prep.notice_li2')}</li>
                <li>{t('prep.notice_li3')}</li>
                <li>{t('prep.notice_li4')}</li>
                <li>{t('prep.notice_li5')}</li>
              </ul>
            </div>
          )}

          {/* 2. 보안 프로그램 설치 */}
          {step === 2 && (
            <div className="prep-text">
              {inSeb ? (
                <div className="prep-seb-ok">{t('prep.seb_running')}</div>
              ) : (
                <>
                  <p>{t('prep.seb_desc')}</p>
                  <a
                    className="exam-btn"
                    href={SEB_INSTALLER_URL}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: 'inline-block', margin: '6px 0' }}
                  >
                    {t('prep.seb_install_btn')}
                  </a>
                  <ul>
                    <li>{t('prep.seb_li1')}</li>
                    <li>{t('prep.seb_li2')}</li>
                    <li>{t('prep.seb_li3')}</li>
                  </ul>
                </>
              )}
            </div>
          )}

          {/* 3. 메뉴 설명 */}
          {step === 3 && (
            <div className="prep-text">
              <p>{t('prep.menu_lead')}</p>
              <ul>
                <li>{t('prep.menu_li1')}</li>
                <li>{t('prep.menu_li2')}</li>
                <li>{t('prep.menu_li3')}</li>
                <li>{t('prep.menu_li5')}</li>
              </ul>
            </div>
          )}

          {/* 4. 문제풀이 연습 + 환경 점검 */}
          {step === 4 && (
            <div className="prep-practice">
              <h4 className="prep-sub">{t('prep.check_title')}</h4>
              <ul className="check-list" style={{ marginBottom: 18 }}>
                {checks.map((c) => (
                  <li key={c.label} className={c.ok ? 'ok' : 'no'}>
                    <span className="ic">{c.ok ? '✓' : '✕'}</span>
                    <span className="lab">{c.label}</span>
                    <span className="note">{c.ok ? t('prep.check_ok') : t('prep.check_no')}</span>
                  </li>
                ))}
                <li className={inSeb ? 'ok' : 'info'}>
                  <span className="ic">{inSeb ? '✓' : 'ℹ'}</span>
                  <span className="lab">{t('prep.chk_seb')}</span>
                  <span className="note">{inSeb ? t('prep.chk_seb_running') : t('prep.chk_seb_info')}</span>
                </li>
              </ul>

              <h4 className="prep-sub">{t('prep.sample_title')}</h4>
              <p className="prep-note">{t('prep.sample_note')}</p>
              <div className="prep-sample">
                <div className="prep-sample-q">
                  <span className="prep-sample-no">{t('prep.sample_eg')}</span>
                  {t('prep.sample_q')}
                </div>
                <div className="cbt-opts">
                  {[
                    t('prep.sample_opt1'),
                    t('prep.sample_opt2'),
                    t('prep.sample_opt3'),
                    t('prep.sample_opt4'),
                  ].map((opt, i) => (
                    <button
                      key={i}
                      className={`cbt-opt ${practice === i ? 'sel' : ''}`}
                      onClick={() => setPractice(i)}
                    >
                      <span className="cbt-opt-no">{i + 1}</span>
                      <span className="cbt-opt-lab">{opt}</span>
                    </button>
                  ))}
                </div>
                {practice !== null && (
                  <div className={`prep-sample-fb ${practice === 0 ? 'ok' : 'no'}`}>
                    {practice === 0 ? t('prep.sample_fb_ok') : t('prep.sample_fb_no')}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 5. 시험 준비 완료 */}
          {step === 5 && (
            <div className="prep-text">
              <p>{t('prep.ready_lead')}</p>
              <ul>
                <li>{t('prep.ready_li1')}</li>
                <li>{t('prep.ready_li2', { min: TEST_DURATION_MINUTES })}</li>
              </ul>
              <label className="prep-agree">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>{t('prep.agree')}</span>
              </label>
              {!isFullUser && <p className="prep-warn">{t('prep.login_warn')}</p>}
              {err && <p className="prep-warn">{err}</p>}
            </div>
          )}
        </div>

        <div className="prep-foot">
          <button
            className="exam-btn-ghost"
            disabled={step === 0 || starting}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            {t('prep.prev')}
          </button>
          {!last ? (
            <button className="exam-btn" onClick={() => setStep((s) => s + 1)}>
              {t('prep.next')}
            </button>
          ) : (
            <button className="exam-btn" disabled={(!agree && isFullUser) || starting} onClick={startExam}>
              {starting ? t('prep.starting') : isFullUser ? t('prep.start') : t('prep.start_login')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
