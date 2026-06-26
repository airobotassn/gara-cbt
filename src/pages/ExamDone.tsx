import { useNavigate } from 'react-router-dom'
import { useT } from '../lib/i18n'

// 제출 완료 = SEB 종료 URL. 보안 브라우저는 이 주소에 도달하면 자동 종료된다.
export default function ExamDone() {
  const navigate = useNavigate()
  const { t } = useT()
  return (
    <div className="exam-center">
      <div className="exam-card" style={{ textAlign: 'center', maxWidth: 460 }}>
        <div className="exam-ico">✅</div>
        <h2 className="exam-title">{t('done.title')}</h2>
        <p className="exam-sub">
          {t('done.sub1')}
          <br />
          {t('done.sub2')}
        </p>
        <button className="exam-btn" style={{ marginTop: 18 }} onClick={() => navigate('/')}>
          {t('done.home')}
        </button>
      </div>
    </div>
  )
}
