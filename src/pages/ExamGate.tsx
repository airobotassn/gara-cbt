import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import SiteFooter from '../components/SiteFooter'
import { useAuth } from '../context/AuthProvider'
import { isMobileDevice } from '../lib/device'
import MobileBlock from '../components/MobileBlock'
import { RESULT_RELEASE_DAYS } from '../lib/testConfig'
import { useT } from '../lib/i18n'

// gara_4 (CARIS 자격검정 응시 안내/원서접수) 목업 디자인 + 응시 게이트 로직 보존. 헤더 없음(FAB이 네비).
// 원본: stitch_design_critique_assistant/gara_4/code.html
export default function ExamGate() {
  const navigate = useNavigate()
  const { isFullUser, loginWithGoogle } = useAuth()
  const { t } = useT()
  const [loginNotice, setLoginNotice] = useState(false)

  if (isMobileDevice()) return <MobileBlock />

  // 응시 시작: 로그인 체크 → prepare.
  // SEB 실행/설치 안내는 prepare 마지막 단계("시작하기")로 이동. SEB 안에서는 /exam/seb 가 진입점.
  // TODO(응시권): 결제/응시권 백엔드가 생기면 여기서 "결제된(접수 완료) 시험이 있는지" 확인해
  //   - 있으면 그대로 /exam/prepare 로 진행
  //   - 없으면 /guide 로 보내 접수부터 하게 한다(응시게이트로 들어온 모든 진입점을 여기서 일괄 게이팅).
  //   지금은 exam_attempts 가 '응시 시작 후에만' 생겨 '결제했지만 미응시' 상태를 판별할 데이터가 없음
  //   (start-exam 도 과도기라 결제 확인 없이 활성 회차+pro 로 바로 생성) → 데모로 무조건 통과.
  function onStart() {
    if (isFullUser) {
      navigate('/exam/prepare')
    } else {
      setLoginNotice(true)
    }
  }

  // 로그인 안내 팝업에서 실제 구글 로그인 실행
  function doLogin() {
    localStorage.setItem('examIntent', '1')
    loginWithGoogle(`${window.location.origin}/auth/callback?next=${encodeURIComponent('/exam/prepare')}`)
  }

  return (
    <div className="bg-background text-on-surface mesh-bg min-h-screen flex flex-col">
      {/* 로그인 안내 모달 — 응시하기 클릭 시 미로그인이면 노출 */}
      {loginNotice && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" onClick={() => setLoginNotice(false)}>
          <div className="bg-surface-container-lowest rounded-2xl p-8 max-w-md w-full text-center ambient-shadow" onClick={(e) => e.stopPropagation()}>
            <div className="w-16 h-16 rounded-full bg-primary-container/10 text-primary-container flex items-center justify-center mx-auto mb-4">
              <span className="material-symbols-outlined text-[32px]" style={{ fontVariationSettings: "'FILL' 1" }}>lock</span>
            </div>
            <h3 className="font-title-md text-title-md font-bold text-on-surface mb-2">{t('gate.login_modal_title')}</h3>
            <p className="font-body-md text-body-md text-on-surface-variant mb-6">{t('gate.login_modal_desc')}</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button className="bg-primary-container text-on-primary font-label-md text-label-md font-bold px-6 py-3 rounded-xl ambient-shadow inline-flex items-center justify-center" onClick={doLogin}>{t('fab.login')}</button>
              <button className="bg-surface-container-lowest border border-outline-variant text-on-surface-variant font-label-md text-label-md px-6 py-3 rounded-xl hover:border-primary-container hover:text-primary-container transition-colors" onClick={() => setLoginNotice(false)}>{t('common.close')}</button>
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
              {/* 로고만 — 감싸던 원판(테두리·그림자·방사 그라디언트)과 동심원 2개는 제거(2026-08-05).
                  object-contain: logo.png 는 자체 여백이 39% 라 cover 로 채우면 행성이 잘린다. */}
              <img src="/logo.png" alt="CARIS Logo" className="w-full aspect-square max-w-md object-contain" />
            </div>
            <div className="w-full lg:w-7/12 flex flex-col gap-8">
              <div>
                <span className="font-label-sm text-label-sm uppercase text-primary-container bg-primary-container/5 px-4 py-1.5 rounded-full self-start border border-primary-container/10 mb-6 inline-block">Official Certification</span>
                <h2 className="font-headline-lg text-headline-lg md:font-display-lg md:text-display-lg text-on-surface mb-3">{t('gate.title')}</h2>
                <p className="font-body-lg text-body-lg text-on-surface-variant break-keep whitespace-pre-line leading-relaxed">{t('gate.fullname')}</p>
              </div>
              <div className="flex flex-col sm:flex-row gap-4 mt-2">
                <button onClick={onStart} className="bg-primary-container text-on-primary font-title-md text-title-md px-10 py-4 rounded-xl hover:translate-y-[-2px] transition-transform duration-200 ambient-shadow flex items-center justify-center gap-2">
                  {t('gate.btn_start')}
                  <span className="material-symbols-outlined">arrow_forward</span>
                </button>
                <button onClick={() => navigate('/exam/check')} className="bg-surface-container-lowest text-on-surface-variant hover:text-primary-container font-title-md text-title-md px-10 py-4 rounded-xl transition-all border border-outline-variant hover:border-primary-container hover:shadow-md flex items-center justify-center gap-2">
                  {t('gate.btn_check')}
                </button>
              </div>
            </div>
          </section>

          <hr className="border-outline-variant/20" />

          {/* Important Instructions */}
          <section className="flex flex-col gap-8">
            <h3 className="font-title-md text-title-md text-on-surface border-l-4 border-primary-container pl-4">{t('gate.instr_title')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="flex flex-col sm:flex-row items-start gap-5 p-6 rounded-2xl bg-surface-container-lowest border border-surface-container-highest shadow-sm hover:shadow-md transition-shadow">
                <div className="w-14 h-14 flex items-center justify-center rounded-full bg-primary-container/10 text-primary-container flex-shrink-0">
                  <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>event_available</span>
                </div>
                <div>
                  <h4 className="font-title-md text-title-md text-on-surface mb-2">{t('gate.instr_result_h', { d: RESULT_RELEASE_DAYS })}</h4>
                  <p className="font-body-md text-body-md text-on-surface-variant">{t('gate.instr_result_d', { d: RESULT_RELEASE_DAYS })}</p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row items-start gap-5 p-6 rounded-2xl bg-surface-container-lowest border border-error-container shadow-sm hover:shadow-md transition-shadow">
                <div className="w-14 h-14 flex items-center justify-center rounded-full bg-error/10 text-error flex-shrink-0">
                  <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>screen_share</span>
                </div>
                <div>
                  <h4 className="font-title-md text-title-md text-on-surface mb-2">{t('gate.instr_security_h')}</h4>
                  <p className="font-body-md text-body-md text-on-surface-variant">{t('gate.instr_security_d')}</p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row items-start gap-5 p-6 rounded-2xl bg-surface-container-lowest border border-surface-container-highest shadow-sm hover:shadow-md transition-shadow">
                <div className="w-14 h-14 flex items-center justify-center rounded-full bg-secondary/10 text-secondary flex-shrink-0">
                  <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>desktop_windows</span>
                </div>
                <div>
                  <h4 className="font-title-md text-title-md text-on-surface mb-2">{t('gate.instr_pc_h')}</h4>
                  <p className="font-body-md text-body-md text-on-surface-variant">{t('gate.instr_pc_d')}</p>
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
