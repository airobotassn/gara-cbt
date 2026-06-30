import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'

// gara_10 (로그인) 목업 디자인 그대로 + 실제 구글/카카오 OAuth 연결. 헤더 없음(FAB이 네비).
// 원본: stitch_design_critique_assistant/gara_10/code.html
export default function Login() {
  const { t } = useT()
  const navigate = useNavigate()
  const { isFullUser, loginWithGoogle, loginWithKakao } = useAuth()

  // 이미 로그인 상태면 마이페이지로
  if (isFullUser) return <Navigate to="/mypage" replace />

  const footerLinks = (
    <>
      <Link className="hover:text-primary transition-colors" to="/terms">{t('nav.terms')}</Link>
      <Link className="hover:text-primary transition-colors" to="/privacy">{t('nav.privacy')}</Link>
      <Link className="hover:text-primary transition-colors" to="/faq">{t('nav.support')}</Link>
    </>
  )

  return (
    <div className="min-h-screen flex flex-col lg:flex-row w-full bg-surface text-on-surface">
      {/* Left Panel: Brand & Typography */}
      <div className="w-full lg:w-[55%] bg-surface flex flex-col justify-between p-8 sm:p-12 lg:p-24 relative overflow-hidden shrink-0 border-b lg:border-b-0 lg:border-r border-outline-variant/30">
        {/* Abstract Background Element */}
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-primary/5 rounded-full blur-3xl opacity-80 pointer-events-none"></div>
        {/* Header / Logo */}
        <div className="relative z-10">
          <button
            onClick={() => navigate('/')}
            className="w-16 h-16 flex items-center justify-center group mb-16 lg:mb-32 rounded-full overflow-hidden"
            aria-label="GARA"
          >
            <img
              alt="GARA Logo"
              className="w-full h-full object-cover rounded-full transition-transform duration-700 ease-out group-hover:scale-110"
              src="/logo.png"
            />
          </button>
          <div className="max-w-xl">
            <h1 className="text-5xl sm:text-6xl lg:text-[80px] font-black tracking-[-0.04em] text-on-surface leading-[1.1] mb-8 break-keep">
              {t('login.welcome')}
            </h1>
            <p className="text-xl lg:text-2xl text-on-surface-variant font-medium leading-relaxed tracking-tight break-keep">
              {t('login.subtitle_l1')}<br className="hidden sm:block" />
              {t('login.subtitle_l2')}
            </p>
          </div>
        </div>
        {/* Footer Links (Desktop) */}
        <footer className="hidden lg:flex flex-col gap-4 relative z-10 mt-32">
          <span className="font-bold text-on-surface text-sm tracking-wide uppercase">GARA Precision</span>
          <div className="flex flex-wrap gap-6 text-sm text-on-surface-variant font-medium">{footerLinks}</div>
          <span className="text-outline-variant text-xs mt-2">{t('footer.rights')}</span>
        </footer>
      </div>

      {/* Right Panel: Interaction */}
      <div className="w-full lg:w-[45%] bg-surface flex flex-col justify-center items-center p-8 sm:p-12 lg:p-24 relative">
        <div className="w-full max-w-md flex flex-col gap-6 lg:gap-8">
          {/* Google Block */}
          <button
            onClick={() => loginWithGoogle()}
            className="group w-full bg-surface-container-lowest rounded-[32px] p-8 sm:p-10 flex flex-col items-start gap-12 border-2 border-outline-variant/30 hover:border-primary hover:shadow-[0_8px_30px_rgba(0,74,198,0.08)] transition-all duration-500 hover:-translate-y-1 relative overflow-hidden text-left focus:outline-none focus:ring-4 focus:ring-primary/20"
          >
            <div className="w-14 h-14 bg-surface rounded-2xl flex items-center justify-center transition-transform duration-500 group-hover:scale-110 shadow-sm border border-outline-variant/10">
              <svg className="w-7 h-7" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold text-on-surface tracking-tight mb-2">{t('login.google_title')}</h2>
              <p className="text-on-surface-variant font-medium">{t('login.google_sub')}</p>
            </div>
            <div className="absolute top-10 right-10 opacity-0 group-hover:opacity-100 transition-opacity duration-500 transform translate-x-4 group-hover:translate-x-0">
              <svg className="w-8 h-8 text-primary/30" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M14 5l7 7m0 0l-7 7m7-7H3" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
              </svg>
            </div>
          </button>

          {/* Kakao Block */}
          <button
            onClick={() => loginWithKakao()}
            className="group w-full bg-[#FEE500] rounded-[32px] p-8 sm:p-10 flex flex-col items-start gap-12 border-2 border-[#FEE500] hover:border-[#E5CD00] hover:shadow-[0_8px_30px_rgba(254,229,0,0.3)] transition-all duration-500 hover:-translate-y-1 relative overflow-hidden text-left focus:outline-none focus:ring-4 focus:ring-[#FEE500]/50"
          >
            <div className="w-14 h-14 bg-black/5 rounded-2xl flex items-center justify-center transition-transform duration-500 group-hover:scale-110">
              <svg className="w-8 h-8 text-black" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 3C6.48 3 2 6.47 2 10.75c0 2.76 1.83 5.17 4.63 6.47-.14.48-.52 1.76-.55 1.88-.06.2.04.22.18.12.1-.06 1.76-1.18 2.47-1.67a11.23 11.23 0 0 0 3.27.49c5.52 0 10-3.47 10-7.75S17.52 3 12 3z" fill="currentColor" />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold text-black/90 tracking-tight mb-2">{t('login.kakao_title')}</h2>
              <p className="text-black/60 font-medium">{t('login.kakao_sub')}</p>
            </div>
            <div className="absolute top-10 right-10 opacity-0 group-hover:opacity-100 transition-opacity duration-500 transform translate-x-4 group-hover:translate-x-0">
              <svg className="w-8 h-8 text-black/20" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M14 5l7 7m0 0l-7 7m7-7H3" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
              </svg>
            </div>
          </button>
        </div>

        {/* Footer Links (Mobile) */}
        <footer className="lg:hidden flex flex-col items-center gap-4 mt-24 text-center w-full">
          <div className="flex flex-wrap justify-center gap-4 text-sm text-on-surface-variant font-medium">{footerLinks}</div>
          <span className="text-outline-variant text-xs mt-2">{t('footer.rights')}</span>
        </footer>
      </div>
    </div>
  )
}
