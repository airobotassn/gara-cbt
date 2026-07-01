import { useState } from 'react'
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
import type { StartExamResponse } from '../lib/types'
import { useT } from '../lib/i18n'

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
