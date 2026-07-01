import { useNavigate } from 'react-router-dom'
import SiteFooter from '../components/SiteFooter'
import { useT } from '../lib/i18n'

// gara_8 (글로벌 AI 로봇협회 — 협회 소개) 목업 디자인 그대로 + 라우팅 연결. 헤더 없음(FAB이 네비).
// 원본: stitch_design_critique_assistant/gara_8/code.html
export default function About() {
  const navigate = useNavigate()
  const { t } = useT()

  return (
    <div className="bg-background text-on-surface antialiased min-h-screen flex flex-col">
      {/* Main Content (헤더 없음 — FAB이 네비) */}
      <main className="flex-grow">
        {/* Hero Section */}
        <section className="relative min-h-[58vh] flex items-center justify-center overflow-hidden bg-surface hero-bg">
          <div className="relative z-20 max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop text-center">
            <span className="inline-block px-4 py-1.5 rounded-full bg-surface-container-low text-primary font-label-sm text-label-sm tracking-wider uppercase mb-6 border border-outline-variant/30">Global AI &amp; Robotics Association</span>
            <h1 className="font-display-lg text-3xl sm:text-4xl md:text-display-lg text-on-surface mb-6 leading-tight break-keep">
              {t('about.hero_line1')}<br />
              <span className="text-primary">{t('about.hero_line2')}</span>
            </h1>
            <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl mx-auto mb-10 whitespace-pre-line">
              {t('about.subtitle')}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button onClick={() => navigate('/exam')} className="w-full sm:w-auto bg-primary text-white font-title-md text-title-md px-8 py-4 rounded-xl hover:-translate-y-1 hover:shadow-lg transition-all duration-300 flex items-center justify-center gap-2">
                {t('about.cta_exam')}
                <span className="material-symbols-outlined">arrow_forward</span>
              </button>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
