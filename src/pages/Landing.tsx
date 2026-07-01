import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'
import { LEVELTEST_URL } from '../lib/testConfig'

// CBT 메인(랜딩)
export default function Landing() {
  const navigate = useNavigate()
  const { isFullUser } = useAuth()
  const { t } = useT()
  const [learnSoon, setLearnSoon] = useState(false)

  // 시험 로그인이 (Site URL 설정 등으로) 홈으로 떨어져도, '시험 의도' 표식이 있으면 안내 화면으로 자동 이동
  useEffect(() => {
    if (isFullUser && localStorage.getItem('examIntent')) {
      localStorage.removeItem('examIntent')
      navigate('/exam/prepare', { replace: true })
    }
  }, [isFullUser, navigate])

  return (
    <div className="lp">
      <div className="aura" />
      <h1>
        {t('landing.hero_pre')} <span className="em">{t('landing.hero_em')}</span>
        <br />
        {t('landing.hero_post')}
      </h1>
      <div className="lp-ctas">
        <a className="cta-ghost" href={LEVELTEST_URL}>
          {t('landing.cta_diagnose')} <span className="arr">↗</span>
        </a>
        <button className="cta" onClick={() => navigate('/exam')}>
          {t('landing.cta_exam')} <span className="arr">→</span>
        </button>
        <button className="cta-ghost soon" onClick={() => setLearnSoon(true)}>
          {t('landing.cta_learn')} <span className="cta-soon-tag">{t('landing.soon')}</span>
        </button>
      </div>
      {learnSoon ? <div className="lp-soon-note">{t('landing.learn_soon')}</div> : null}
    </div>
  )
}
