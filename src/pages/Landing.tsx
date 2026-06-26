import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'

// CBT 메인(랜딩)
export default function Landing() {
  const navigate = useNavigate()
  const { isFullUser } = useAuth()
  const { t } = useT()

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
      <button className="cta" onClick={() => navigate('/exam')}>
        {t('landing.hero_cta')} <span className="arr">→</span>
      </button>
    </div>
  )
}
