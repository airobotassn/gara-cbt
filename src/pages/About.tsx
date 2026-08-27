import { Link } from 'react-router-dom'
import SiteFooter from '../components/SiteFooter'
import { useT } from '../lib/i18n'

// gara_8 (글로벌 AI 로봇협회 — 협회 소개) 목업 디자인 그대로 + 라우팅 연결. 헤더 없음(FAB이 네비).
// 원본: stitch_design_critique_assistant/gara_8/code.html
export default function About() {
  const { t } = useT()

  return (
    <div className="bg-background text-on-surface antialiased min-h-screen flex flex-col">
      {/* Main Content (헤더 없음 — FAB이 네비) */}
      {/* 히어로 하나뿐인 페이지라 남는 높이를 히어로가 다 먹어야 글이 화면 한가운데 선다.
          (58vh 로 못박으면 아래가 통째로 빈다 — 실제로 그랬다) */}
      <main className="flex-grow flex">
        {/* Hero Section */}
        <section className="relative flex-1 min-h-[58vh] flex items-center justify-center overflow-hidden bg-surface hero-bg">
          {/* 홈으로 — 헤더가 없는 화면이라 여기 말고는 홈으로 갈 길이 FAB 뿐이었다.
              ⚠️ 히어로가 화면 높이를 채우는 섹션이라 **앞에 두면 히어로가 아래로 밀린다** → 위에 얹는다. */}
          <div className="absolute top-6 left-0 right-0 z-30 max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
            <Link to="/" className="gd-back">
              <span className="material-symbols-outlined text-[20px]">arrow_back</span>
              {t('common.home')}
            </Link>
          </div>
          <div className="relative z-20 max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop text-center">
            {/* 협회 공식 로고 — 옛 영문 배지가 있던 자리이자, 배경에 흐릿하게 깔려 있던 그 로고다.
                ⚠️ 원본이 388px 뿐이라 이보다 크게 키우지 말 것(stitch.css 옛 워터마크 주석 참고). */}
            <img
              src="/gara-mark-en.webp"
              alt="GARA · Global AI & Robotics Association"
              className="gara-wordmark h-9 md:h-10 w-auto mx-auto mb-6"
            />
            <h1 className="font-display-lg text-3xl sm:text-4xl md:text-display-lg font-bold tracking-[-0.02em] text-on-surface mb-4 leading-tight break-keep">
              {t('about.hero_line1')}
            </h1>
            <p className="text-primary font-semibold text-lg sm:text-xl md:text-2xl leading-snug break-keep max-w-2xl mx-auto mb-8">
              {t('about.hero_line2')}
            </p>
            <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl mx-auto whitespace-pre-line">
              {t('about.subtitle')}
            </p>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
