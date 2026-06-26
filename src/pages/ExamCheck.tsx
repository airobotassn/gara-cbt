import { useNavigate } from 'react-router-dom'
import { isMobileDevice } from '../lib/device'
import MobileBlock from '../components/MobileBlock'
import HomeLink from '../components/HomeLink'
import { isSEB, SEB_REQUIRED, sebPracticeLaunchUrl, SEB_INSTALLER_URL } from '../lib/seb'
import { makePracticeExam } from '../lib/practice'
import { useT } from '../lib/i18n'

type Check = { ok: boolean; label: string; note: string }

// 시험환경 테스트(사전 점검): 보안 프로그램 설치 + 환경 자동점검 + 모의 1문제
export default function ExamCheck() {
  const navigate = useNavigate()
  const { t, lang } = useT()
  if (isMobileDevice()) return <MobileBlock />

  const inSeb = isSEB()
  const checks: Check[] = [
    {
      ok: !isMobileDevice(),
      label: t('check.chk_pc'),
      note: t('check.chk_pc_ok'),
    },
    {
      ok: window.innerWidth >= 1024,
      label: t('check.chk_screen'),
      note: window.innerWidth >= 1024 ? t('check.chk_screen_ok') : t('check.chk_screen_no'),
    },
    {
      ok: !!document.fullscreenEnabled,
      label: t('check.chk_fs'),
      note: document.fullscreenEnabled ? t('check.chk_fs_ok') : t('check.chk_fs_no'),
    },
    {
      ok: navigator.onLine,
      label: t('check.chk_net'),
      note: navigator.onLine ? t('check.chk_net_ok') : t('check.chk_net_no'),
    },
  ]

  function startPractice() {
    // 실제 시험과 같은 SEB 잠금 환경에서 모의 응시 (배포 환경)
    if (SEB_REQUIRED && !isSEB()) {
      window.location.href = sebPracticeLaunchUrl(lang)
      return
    }
    navigate('/exam/run/practice', { state: makePracticeExam() })
  }

  return (
    <div className="exam-center">
      <HomeLink />
      <div className="exam-card" style={{ maxWidth: 640, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <div className="exam-ico">🧪</div>
          <h2 className="exam-title">{t('check.title')}</h2>
          <p className="exam-sub">{t('check.sub')}</p>
        </div>

        {/* 1단계: 설치 */}
        <section className="check-sec">
          <div className="check-sec-head">
            <span className="check-sec-no">1</span>
            <h3>{t('check.sec1_title')}</h3>
          </div>
          <p className="check-sec-desc">{t('check.sec1_desc')}</p>
          <a
            className="exam-btn"
            href={SEB_INSTALLER_URL}
            target="_blank"
            rel="noreferrer"
            style={{ display: 'inline-block', marginTop: 6 }}
          >
            {t('check.install_btn')}
          </a>
          <p className="check-note">
            {t('check.install_note1')}<br />
            {t('check.install_note2')}
          </p>
        </section>

        {/* 2단계: 자동 점검 */}
        <section className="check-sec">
          <div className="check-sec-head">
            <span className="check-sec-no">2</span>
            <h3>{t('check.sec2_title')}</h3>
          </div>
          <ul className="check-list">
            {checks.map((c) => (
              <li key={c.label} className={c.ok ? 'ok' : 'no'}>
                <span className="ic">{c.ok ? '✓' : '✕'}</span>
                <span className="lab">{c.label}</span>
                <span className="note">{c.note}</span>
              </li>
            ))}
            <li className={inSeb ? 'ok' : 'info'}>
              <span className="ic">{inSeb ? '✓' : 'ℹ'}</span>
              <span className="lab">{t('check.chk_seb')}</span>
              <span className="note">
                {inSeb ? t('check.chk_seb_ok') : t('check.chk_seb_no')}
              </span>
            </li>
          </ul>
          <p className="check-note">{t('check.monitor_note')}</p>
        </section>

        {/* 3단계: 모의 문제 */}
        <section className="check-sec">
          <div className="check-sec-head">
            <span className="check-sec-no">3</span>
            <h3>{t('check.sec3_title')}</h3>
          </div>
          <p className="check-sec-desc">{t('check.sec3_desc')}</p>
          <button className="exam-btn" onClick={startPractice} style={{ marginTop: 6 }}>
            {t('check.practice_btn')}
          </button>
        </section>

        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <button className="exam-btn-ghost" onClick={() => navigate('/exam')}>
            {t('check.back')}
          </button>
        </div>
      </div>
    </div>
  )
}
