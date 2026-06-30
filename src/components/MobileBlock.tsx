import { useNavigate } from 'react-router-dom'
import { useT } from '../lib/i18n'

// CBT 는 PC 전용. 모바일/태블릿 진입 시 안내.
export default function MobileBlock() {
  const navigate = useNavigate()
  const { t } = useT()
  return (
    <div className="exam-center">
      <div className="exam-card" style={{ textAlign: 'center', maxWidth: 460 }}>
        <div className="exam-ico">🖥️</div>
        <h2 className="exam-title">{t('mobile.title')}</h2>
        <p className="exam-sub">{t('mobile.desc')}</p>
        <button className="exam-btn-ghost" style={{ marginTop: 18 }} onClick={() => navigate('/')}>
          {t('mobile.home')}
        </button>
      </div>
    </div>
  )
}
