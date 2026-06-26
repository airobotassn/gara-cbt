import { useNavigate } from 'react-router-dom'
import HomeLink from '../components/HomeLink'
import { TOTAL_QUESTIONS, TEST_DURATION_MINUTES, RESULT_RELEASE_DAYS } from '../lib/testConfig'
import { useT } from '../lib/i18n'

// 자격안내 — GARA 자격검정 소개
export default function Guide() {
  const navigate = useNavigate()
  const { t } = useT()
  return (
    <div className="wrap page">
      <HomeLink />
      <h1 className="page-title">{t('guide.title')}</h1>
      <p className="page-lead">{t('guide.lead')}</p>

      <section className="page-sec">
        <h2>{t('guide.areas.title')}</h2>
        <ul className="page-ul">
          <li><b>{t('guide.areas.1.h')}</b> — {t('guide.areas.1.d')}</li>
          <li><b>{t('guide.areas.2.h')}</b> — {t('guide.areas.2.d')}</li>
          <li><b>{t('guide.areas.3.h')}</b> — {t('guide.areas.3.d')}</li>
          <li><b>{t('guide.areas.4.h')}</b> — {t('guide.areas.4.d')}</li>
          <li><b>{t('guide.areas.5.h')}</b> — {t('guide.areas.5.d')}</li>
        </ul>
      </section>

      <section className="page-sec">
        <h2>{t('guide.exam.title')}</h2>
        <ul className="page-ul">
          <li>{t('guide.exam.count.label')} <b>{t('guide.exam.count.value', { n: TOTAL_QUESTIONS })}</b> {t('guide.exam.count.note')}</li>
          <li>{t('guide.exam.time.label')} <b>{t('guide.exam.time.value', { n: TEST_DURATION_MINUTES })}</b></li>
          <li>{t('guide.exam.pass.label')} <b>{t('guide.exam.pass.value')}</b> {t('guide.exam.pass.note')}</li>
          <li>{t('guide.exam.result.label')} {t('guide.exam.result.pre')} <b>{t('guide.exam.result.value', { n: RESULT_RELEASE_DAYS })}</b> {t('guide.exam.result.note')}</li>
        </ul>
      </section>

      <section className="page-sec">
        <h2>{t('guide.how.title')}</h2>
        <ul className="page-ul">
          <li><b>{t('guide.how.1.h')}</b> — {t('guide.how.1.d')}</li>
          <li>{t('guide.how.2.pre')} <b>{t('guide.how.2.h')}</b>{t('guide.how.2.post')}</li>
          <li>{t('guide.how.3.pre')} <b>{t('guide.how.3.h')}</b>{t('guide.how.3.post')}</li>
        </ul>
      </section>

      <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
        <button className="exam-btn" onClick={() => navigate('/exam')}>{t('guide.cta.take')}</button>
        <button className="exam-btn-ghost" onClick={() => navigate('/exam/check')}>{t('guide.cta.check')}</button>
      </div>
    </div>
  )
}
