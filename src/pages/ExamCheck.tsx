import { useNavigate } from 'react-router-dom'
import SiteFooter from '../components/SiteFooter'
import { isMobileDevice } from '../lib/device'
import MobileBlock from '../components/MobileBlock'
import { isSEB, SEB_REQUIRED, sebPracticeLaunchUrl, SEB_INSTALLER_URL } from '../lib/seb'
import { makePracticeExam } from '../lib/practice'
import { useT } from '../lib/i18n'

// gara_3 (시험환경 테스트) 목업 디자인 그대로 + 실제 점검 로직(SEB 감지·환경체크·모의응시) 보존.
// 원본: stitch_design_critique_assistant/gara_3/code.html
type Check = { ok: boolean; label: string; note: string }

export default function ExamCheck() {
  const navigate = useNavigate()
  const { t, lang } = useT()
  if (isMobileDevice()) return <MobileBlock />

  const inSeb = isSEB()
  const checks: Check[] = [
    { ok: !isMobileDevice(), label: t('check.chk_pc'), note: t('check.chk_pc_ok') },
    { ok: window.innerWidth >= 1024, label: t('check.chk_screen'), note: window.innerWidth >= 1024 ? t('check.chk_screen_ok') : t('check.chk_screen_no') },
    { ok: !!document.fullscreenEnabled, label: t('check.chk_fs'), note: document.fullscreenEnabled ? t('check.chk_fs_ok') : t('check.chk_fs_no') },
    { ok: navigator.onLine, label: t('check.chk_net'), note: navigator.onLine ? t('check.chk_net_ok') : t('check.chk_net_no') },
  ]

  function startPractice() {
    if (SEB_REQUIRED && !isSEB()) {
      window.location.href = sebPracticeLaunchUrl(lang)
      return
    }
    navigate('/exam/run/practice', { state: makePracticeExam() })
  }

  return (
    <div className="bg-background text-on-surface min-h-screen flex flex-col antialiased">
      {/* 헤더 없음 — FAB이 네비 */}
      <main className="flex-grow pt-12 pb-24 px-margin-mobile md:px-margin-desktop w-full max-w-container-max mx-auto">
        <div className="glass-panel rounded-2xl p-8 md:p-10 ambient-shadow flex flex-col gap-12 max-w-4xl mx-auto border-white/40">
          {/* Header */}
          <div className="flex flex-col items-center text-center gap-6">
            <div className="relative w-32 aspect-square rounded-full bg-surface-container-lowest flex items-center justify-center overflow-hidden border border-surface-container-highest shadow-xl shadow-primary-container/5">
              <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-primary-container via-transparent to-transparent"></div>
              <div className="z-10 w-full h-full flex items-center justify-center p-3 rounded-full overflow-hidden">
                <img alt="GARA Logo" className="w-full h-full object-cover rounded-full scale-105" src="/logo.png" />
              </div>
              <div className="absolute w-full h-full border border-primary-container/10 rounded-full" style={{ transform: 'scale(0.8)' }}></div>
              <div className="absolute w-full h-full border border-primary-container/5 rounded-full" style={{ transform: 'scale(0.6)' }}></div>
            </div>
            <div>
              <h1 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface mb-4">{t('check.title')}</h1>
              <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl mx-auto">{t('check.sub')}</p>
            </div>
          </div>

          <div className="space-y-8">
            {/* Step 1: 설치 */}
            <div className="flex flex-col sm:flex-row items-start gap-6 p-8 rounded-2xl bg-surface-container-lowest border border-surface-container-highest shadow-sm hover:shadow-md transition-shadow">
              <div className="p-4 rounded-full bg-primary-container/10 text-primary-container flex-shrink-0 flex items-center justify-center w-14 h-14 font-title-md text-title-md font-bold">1</div>
              <div className="flex-grow">
                <h2 className="font-title-md text-title-md font-bold text-on-surface mb-2">{t('check.sec1_title')}</h2>
                <p className="font-body-md text-body-md text-on-surface-variant mb-6">{t('check.sec1_desc')}</p>
                <a href={SEB_INSTALLER_URL} target="_blank" rel="noreferrer" className="bg-primary-container text-on-primary font-title-md text-title-md px-8 py-3 rounded-xl hover:translate-y-[-2px] transition-transform duration-200 ambient-shadow inline-flex items-center justify-center gap-2 w-full md:w-auto font-bold">
                  <span className="material-symbols-outlined text-[20px]">download</span>
                  {t('check.install_btn')}
                </a>
                <div className="mt-5 rounded-xl bg-surface-container-low border border-outline-variant/40 px-5 py-4 flex flex-col gap-2">
                  <p className="font-body-md text-body-md text-on-surface-variant break-keep leading-relaxed">{t('check.install_note1')}</p>
                  <p className="font-body-md text-body-md text-on-surface-variant break-keep leading-relaxed">{t('check.install_note2')}</p>
                </div>
              </div>
            </div>

            {/* Step 2: 자동 점검 */}
            <div className="flex flex-col sm:flex-row items-start gap-6 p-8 rounded-2xl bg-surface-container-lowest border border-surface-container-highest shadow-sm hover:shadow-md transition-shadow">
              <div className="p-4 rounded-full bg-primary-container/10 text-primary-container flex-shrink-0 flex items-center justify-center w-14 h-14 font-title-md text-title-md font-bold">2</div>
              <div className="flex-grow">
                <h2 className="font-title-md text-title-md font-bold text-on-surface mb-6">{t('check.sec2_title')}</h2>
                <ul className="space-y-4">
                  {checks.map((c) => (
                    <li key={c.label} className="flex items-start gap-3">
                      <span
                        className={`material-symbols-outlined mt-0.5 ${c.ok ? 'text-primary-container' : 'text-error'}`}
                        style={c.ok ? { fontVariationSettings: "'FILL' 1" } : undefined}
                      >
                        {c.ok ? 'check_circle' : 'cancel'}
                      </span>
                      <div>
                        <span className="font-label-md text-label-md font-bold text-on-surface">{c.label}</span>
                        <span className="font-body-md text-body-md text-on-surface-variant ml-2">{c.note}</span>
                      </div>
                    </li>
                  ))}
                  <li className="flex items-start gap-3">
                    <span
                      className={`material-symbols-outlined mt-0.5 ${inSeb ? 'text-primary-container' : 'text-outline'}`}
                      style={inSeb ? { fontVariationSettings: "'FILL' 1" } : undefined}
                    >
                      {inSeb ? 'check_circle' : 'info'}
                    </span>
                    <div>
                      <span className="font-label-md text-label-md font-bold text-on-surface">{t('check.chk_seb')}</span>
                      <span className="font-body-md text-body-md text-on-surface-variant ml-2">{inSeb ? t('check.chk_seb_ok') : t('check.chk_seb_no')}</span>
                    </div>
                  </li>
                </ul>
              </div>
            </div>

            {/* Step 3: 모의 문제 */}
            <div className="flex flex-col sm:flex-row items-start gap-6 p-8 rounded-2xl bg-surface-container-lowest border border-surface-container-highest shadow-sm hover:shadow-md transition-shadow">
              <div className="p-4 rounded-full bg-primary-container/10 text-primary-container flex-shrink-0 flex items-center justify-center w-14 h-14 font-title-md text-title-md font-bold">3</div>
              <div className="flex-grow">
                <h2 className="font-title-md text-title-md font-bold text-on-surface mb-2">{t('check.sec3_title')}</h2>
                <p className="font-body-md text-body-md text-on-surface-variant mb-6">{t('check.sec3_desc')}</p>
                <button onClick={startPractice} className="bg-primary-container text-on-primary font-title-md text-title-md px-8 py-3 rounded-xl hover:translate-y-[-2px] transition-transform duration-200 ambient-shadow inline-flex items-center justify-center gap-2 w-full md:w-auto font-bold">
                  <span className="material-symbols-outlined text-[20px]">play_arrow</span>
                  {t('check.practice_btn')}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-8 flex justify-center">
            <button onClick={() => navigate('/exam')} className="bg-surface-container-lowest text-on-surface-variant hover:text-primary-container font-title-md text-title-md px-8 py-3 rounded-xl transition-all border border-outline-variant hover:border-primary-container hover:shadow-md inline-flex items-center justify-center gap-2">
              <span className="material-symbols-outlined text-[20px]">arrow_back</span>
              {t('check.back')}
            </button>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
