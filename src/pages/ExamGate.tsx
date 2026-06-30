import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import SiteFooter from '../components/SiteFooter'
import { useAuth } from '../context/AuthProvider'
import { isMobileDevice } from '../lib/device'
import MobileBlock from '../components/MobileBlock'
import { SEB_REQUIRED, isSEB, sebConfigured, sebLaunchUrl, SEB_INSTALLER_URL } from '../lib/seb'
import { TOTAL_QUESTIONS, TEST_DURATION_MINUTES, RESULT_RELEASE_DAYS } from '../lib/testConfig'
import { useT } from '../lib/i18n'

// gara_4 (GARA 자격검정 응시 안내/원서접수) 목업 디자인 + 응시 게이트 로직 보존. 헤더 없음(FAB이 네비).
// 원본: stitch_design_critique_assistant/gara_4/code.html
export default function ExamGate() {
  const navigate = useNavigate()
  const { isFullUser, loginWithGoogle } = useAuth()
  const { t, lang } = useT()
  const [sebNotice, setSebNotice] = useState(false)

  if (isMobileDevice()) return <MobileBlock />

  const inSeb = isSEB()
  const needSebLaunch = SEB_REQUIRED && !inSeb

  // 응시 시작: 일반 브라우저면 먼저 SEB 실행 / SEB 안이면 로그인→안내
  function onStart() {
    if (needSebLaunch) {
      if (!sebConfigured()) {
        alert(t('gate.seb_not_ready'))
        return
      }
      window.location.href = sebLaunchUrl(lang)
      setSebNotice(true)
      return
    }
    if (isFullUser) {
      navigate('/exam/prepare')
    } else {
      localStorage.setItem('examIntent', '1')
      loginWithGoogle(`${window.location.origin}/auth/callback?next=${encodeURIComponent('/exam/prepare')}`)
    }
  }

  return (
    <div className="bg-background text-on-surface mesh-bg min-h-screen flex flex-col">
      {/* SEB 실행 안내 모달 */}
      {sebNotice && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" onClick={() => setSebNotice(false)}>
          <div className="bg-surface-container-lowest rounded-2xl p-8 max-w-md w-full text-center ambient-shadow" onClick={(e) => e.stopPropagation()}>
            <div className="w-16 h-16 rounded-full bg-primary-container/10 text-primary-container flex items-center justify-center mx-auto mb-4">
              <span className="material-symbols-outlined text-[32px]" style={{ fontVariationSettings: "'FILL' 1" }}>security</span>
            </div>
            <h3 className="font-title-md text-title-md font-bold text-on-surface mb-2">{t('gate.seb_opened_q')}</h3>
            <p className="font-body-md text-body-md text-on-surface-variant mb-6">{t('gate.seb_opened_desc')}</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <a className="bg-primary-container text-on-primary font-label-md text-label-md font-bold px-6 py-3 rounded-xl ambient-shadow inline-flex items-center justify-center" href={SEB_INSTALLER_URL} target="_blank" rel="noreferrer">{t('gate.seb_install_new')}</a>
              <button className="bg-surface-container-lowest border border-outline-variant text-on-surface-variant font-label-md text-label-md px-6 py-3 rounded-xl hover:border-primary-container hover:text-primary-container transition-colors" onClick={() => setSebNotice(false)}>{t('common.close')}</button>
            </div>
          </div>
        </div>
      )}

      {/* 헤더 없음 — FAB이 네비 */}
      <main className="flex-grow pt-12 pb-24 px-margin-mobile md:px-margin-desktop w-full max-w-container-max mx-auto">
        <div className="glass-panel rounded-2xl p-8 md:p-10 ambient-shadow flex flex-col gap-16">
          {/* Hero Split */}
          <section className="flex flex-col lg:flex-row gap-16 items-center">
            <div className="w-full lg:w-5/12 flex justify-center items-center">
              <div className="relative w-full aspect-square max-w-md rounded-full bg-surface-container-lowest flex items-center justify-center overflow-hidden border border-surface-container-highest shadow-xl shadow-primary-container/5">
                <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-primary-container via-transparent to-transparent"></div>
                <div className="z-10 w-2/3 h-2/3 flex items-center justify-center rounded-full overflow-hidden">
                  <img src="/logo.png" alt="GARA Logo" className="w-full h-full object-cover scale-105" />
                </div>
                <div className="absolute w-full h-full border border-primary-container/10 rounded-full" style={{ transform: 'scale(0.8)' }}></div>
                <div className="absolute w-full h-full border border-primary-container/5 rounded-full" style={{ transform: 'scale(0.6)' }}></div>
              </div>
            </div>
            <div className="w-full lg:w-7/12 flex flex-col gap-8">
              <div>
                <span className="font-label-sm text-label-sm uppercase text-primary-container bg-primary-container/5 px-4 py-1.5 rounded-full self-start border border-primary-container/10 mb-6 inline-block">Official Certification</span>
                <h2 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface mb-4">GARA 자격검정</h2>
              </div>
              <div className="flex flex-col sm:flex-row gap-4 mt-2">
                <button onClick={onStart} className="bg-primary-container text-on-primary font-title-md text-title-md px-10 py-4 rounded-xl hover:translate-y-[-2px] transition-transform duration-200 ambient-shadow flex items-center justify-center gap-2">
                  GARA 자격검정 응시하기
                  <span className="material-symbols-outlined">arrow_forward</span>
                </button>
                <button onClick={() => navigate('/exam/check')} className="bg-surface-container-lowest text-on-surface-variant hover:text-primary-container font-title-md text-title-md px-10 py-4 rounded-xl transition-all border border-outline-variant hover:border-primary-container hover:shadow-md flex items-center justify-center gap-2">
                  시험환경 테스트
                </button>
              </div>
              {!isFullUser && !needSebLaunch && (
                <p className="font-label-md text-label-md text-on-surface-variant">응시하려면 구글 로그인이 필요합니다. (비로그인 시 자동 안내)</p>
              )}
            </div>
          </section>

          <hr className="border-outline-variant/20" />

          {/* Exam Stats */}
          <section className="bg-surface-container-lowest rounded-2xl border border-surface-container-highest p-10 shadow-sm">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 md:gap-4">
              <div className="flex flex-col gap-2 w-full md:w-1/3">
                <div className="flex items-center gap-2 text-primary-container mb-2">
                  <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>format_list_numbered</span>
                  <span className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">Questions</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-display-lg text-display-lg text-on-surface">{TOTAL_QUESTIONS}</span>
                  <span className="font-body-md text-body-md text-on-surface-variant">문항</span>
                </div>
              </div>
              <div className="hidden md:block w-px h-20 bg-outline-variant/30"></div>
              <div className="flex flex-col gap-2 w-full md:w-1/3">
                <div className="flex items-center gap-2 text-primary-container mb-2">
                  <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>timer</span>
                  <span className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">Duration</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-display-lg text-display-lg text-on-surface">{TEST_DURATION_MINUTES}</span>
                  <span className="font-body-md text-body-md text-on-surface-variant">분</span>
                </div>
              </div>
              <div className="hidden md:block w-px h-20 bg-outline-variant/30"></div>
              <div className="flex flex-col gap-2 w-full md:w-1/3">
                <div className="flex items-center gap-2 text-primary-container mb-2">
                  <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>fact_check</span>
                  <span className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">Format</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-display-lg text-display-lg text-on-surface">4</span>
                  <span className="font-body-md text-body-md text-on-surface-variant">지선다형 객관식</span>
                </div>
              </div>
            </div>
          </section>

          {/* Important Instructions */}
          <section className="flex flex-col gap-8">
            <h3 className="font-title-md text-title-md text-on-surface border-l-4 border-primary-container pl-4">Important Instructions</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="flex flex-col sm:flex-row items-start gap-5 p-6 rounded-2xl bg-surface-container-lowest border border-surface-container-highest shadow-sm hover:shadow-md transition-shadow">
                <div className="p-4 rounded-full bg-primary-container/10 text-primary-container flex-shrink-0">
                  <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>event_available</span>
                </div>
                <div>
                  <h4 className="font-title-md text-title-md text-on-surface mb-2">결과 발표 ({RESULT_RELEASE_DAYS}일 후)</h4>
                  <p className="font-body-md text-body-md text-on-surface-variant">시험 종료 후 {RESULT_RELEASE_DAYS}일 이내에 개별 통보됩니다.</p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row items-start gap-5 p-6 rounded-2xl bg-surface-container-lowest border border-error-container shadow-sm hover:shadow-md transition-shadow">
                <div className="p-4 rounded-full bg-error/10 text-error flex-shrink-0">
                  <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>screen_share</span>
                </div>
                <div>
                  <h4 className="font-title-md text-title-md text-on-surface mb-2">보안 규정 (캡처 금지)</h4>
                  <p className="font-body-md text-body-md text-on-surface-variant">시험 중 화면 캡처 및 외부 기기 사용이 엄격히 금지됩니다.</p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row items-start gap-5 p-6 rounded-2xl bg-surface-container-lowest border border-surface-container-highest shadow-sm hover:shadow-md transition-shadow">
                <div className="p-4 rounded-full bg-secondary/10 text-secondary flex-shrink-0">
                  <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>desktop_windows</span>
                </div>
                <div>
                  <h4 className="font-title-md text-title-md text-on-surface mb-2">환경 요구사항 (PC 전용)</h4>
                  <p className="font-body-md text-body-md text-on-surface-variant">원활한 진행을 위해 반드시 데스크톱 환경에서 응시해 주십시오.</p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
