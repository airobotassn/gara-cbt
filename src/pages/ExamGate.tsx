import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { isMobileDevice } from '../lib/device'
import MobileBlock from '../components/MobileBlock'
import HomeLink from '../components/HomeLink'
import { SEB_REQUIRED, isSEB, sebConfigured, sebLaunchUrl, SEB_INSTALLER_URL } from '../lib/seb'
import { TOTAL_QUESTIONS, TEST_DURATION_MINUTES, RESULT_RELEASE_DAYS } from '../lib/testConfig'
import { useT } from '../lib/i18n'

// 자격검정 진입 페이지 — "GARA 자격검정" 응시 + 시험환경 테스트
export default function ExamGate() {
  const navigate = useNavigate()
  const { isFullUser, loginWithGoogle } = useAuth()
  const { t, lang } = useT()
  const [sebNotice, setSebNotice] = useState(false)

  if (isMobileDevice()) return <MobileBlock />

  const inSeb = isSEB()
  const needSebLaunch = SEB_REQUIRED && !inSeb

  // 응시 시작: 일반 브라우저면 먼저 SEB 실행(로그인은 SEB 안에서 1번) / SEB 안이면 로그인→안내
  function onStart() {
    if (needSebLaunch) {
      if (!sebConfigured()) {
        alert(t('gate.seb_not_ready'))
        return
      }
      // 보안 브라우저 실행 시도 + 즉시 안내창(설치 링크는 새 탭)
      window.location.href = sebLaunchUrl(lang)
      setSebNotice(true)
      return
    }
    if (isFullUser) {
      navigate('/exam/prepare')
    } else {
      localStorage.setItem('examIntent', '1')
      loginWithGoogle(`${window.location.origin}/auth/callback?next=${encodeURIComponent('/exam/prepare')}`)
    }
  }

  return (
    <div className="exam-center">
      <HomeLink />

      {sebNotice && (
        <div className="seb-notice-bg" onClick={() => setSebNotice(false)}>
          <div className="seb-notice" onClick={(e) => e.stopPropagation()}>
            <div className="exam-ico">🛡️</div>
            <h3 className="seb-notice-title">{t('gate.seb_opened_q')}</h3>
            <p className="exam-sub">{t('gate.seb_opened_desc')}</p>
            <div className="seb-notice-actions">
              <a className="exam-btn" href={SEB_INSTALLER_URL} target="_blank" rel="noreferrer">
                {t('gate.seb_install_new')}
              </a>
              <button className="exam-btn-ghost" onClick={() => setSebNotice(false)}>
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="exam-gate">
        <div className="exam-gate-badge">GARA</div>
        <h1 className="exam-gate-title">{t('gate.title')}</h1>
        <p className="exam-gate-sub">{t('gate.sub')}</p>

        <ul className="exam-gate-meta">
          <li>
            <b>{TOTAL_QUESTIONS}</b>
            <span>{t('gate.meta_questions')}</span>
          </li>
          <li>
            <b>{TEST_DURATION_MINUTES}</b>
            <span>{t('gate.meta_minutes')}</span>
          </li>
          <li>
            <b>4</b>
            <span>{t('gate.meta_choices')}</span>
          </li>
        </ul>

        <div className="exam-gate-note">
          <p>{t('gate.note_release', { d: RESULT_RELEASE_DAYS })}</p>
          <p>{t('gate.note_block')}</p>
          <p>{t('gate.note_pc')}</p>
        </div>

        <button className="exam-btn-xl" onClick={onStart}>
          {needSebLaunch ? t('gate.btn_seb') : isFullUser ? t('gate.btn_start') : t('gate.btn_login')}
          <span className="arr">→</span>
        </button>
        {!needSebLaunch && (
          <p className="exam-gate-login-hint">{t('gate.login_hint')}</p>
        )}

        <button className="exam-gate-check" onClick={() => navigate('/exam/check')}>
          {t('gate.check_link')}
        </button>
      </div>
    </div>
  )
}
