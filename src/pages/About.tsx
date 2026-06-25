import { Link } from 'react-router-dom'
import { useT } from '../lib/i18n'
import TopBar from '../components/TopBar'

// 글로벌 AI 로봇협회 간략 소개. 추후 회원/회원사 모집·소식 게시 확장 예정.
export default function About() {
  const { t } = useT()
  return (
    <div className="wrap">
      <TopBar />
      <div className="card pad doc">
        <div className="assoc-hero">
          <img className="assoc-logo" src="/logo.png" alt="GARA" />
          <div className="assoc-en">Global AI &amp; Robotics Association</div>
          <h1 className="assoc-title">{t('about.title')}</h1>
          <p className="assoc-tag">{t('about.tag')}</p>
          <p className="assoc-desc">{t('about.desc')}</p>
        </div>

        <div className="doc-note">{t('about.note')}</div>

        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <Link className="btn-ink" to="/test/select" style={{ textDecoration: 'none' }}>
            {t('landing.cta')} →
          </Link>
        </div>
      </div>
    </div>
  )
}
