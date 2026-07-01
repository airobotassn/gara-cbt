import SiteFooter from '../components/SiteFooter'
import { useT } from '../lib/i18n'

// gara_9 (자격검정 안내) 목업 디자인 그대로 + 라우팅·로그인 연결.
// 원본: stitch_design_critique_assistant/gara_9/code.html (nav 활성 = 자격검정 안내)
// primary 는 전역 토큰 사용(라이트 #004ac6 / 다크 #7aa9ff). 히어로 밴드 위 흰 버튼만 text-[#004ac6] 하드코딩 유지.

const AREAS = [
  { id: 'area1', icon: 'psychology', tone: 'bg-primary/10 text-primary', titleKey: 'guide.area1_title', descKey: 'guide.area1_desc', cls: 'md:col-span-2' },
  { id: 'area2', icon: 'database', tone: 'bg-secondary/10 text-secondary', titleKey: 'guide.area2_title', descKey: 'guide.area2_desc', cls: 'md:col-span-2' },
  { id: 'area3', icon: 'model_training', tone: 'bg-tertiary/10 text-tertiary', titleKey: 'guide.area3_title', descKey: 'guide.area3_desc', cls: 'md:col-span-2' },
  { id: 'area4', icon: 'gavel', tone: 'bg-error/10 text-error', titleKey: 'guide.area4_title', descKey: 'guide.area4_desc', cls: 'md:col-start-2 md:col-span-2' },
  { id: 'area5', icon: 'rocket_launch', tone: 'bg-primary-container/10 text-primary-container', titleKey: 'guide.area5_title', descKey: 'guide.area5_desc', cls: 'md:col-span-2' },
]
const METHODS = [
  { id: 'method1', icon: 'computer', titleKey: 'guide.method1_title', descKey: 'guide.method1_desc' },
  { id: 'method2', icon: 'security', titleKey: 'guide.method2_title', descKey: 'guide.method2_desc' },
  { id: 'method3', icon: 'fact_check', titleKey: 'guide.method3_title', descKey: 'guide.method3_desc' },
]
const SCHEDULE = [
  { id: 'r4', roundKey: 'guide.sched_r4_round', dateKey: 'guide.sched_r4_date', open: true },
  { id: 'r5', roundKey: 'guide.sched_r5_round', dateKey: 'guide.sched_r5_date', open: false },
  { id: 'r1_2027', roundKey: 'guide.sched_r1_round', dateKey: 'guide.sched_r1_date', open: false },
]

export default function Guide() {
  const { t } = useT()

  return (
    <div className="bg-background text-on-background min-h-screen">
      {/* 헤더 없음 — FAB이 네비 */}
      <main>
        {/* Hero */}
        <section className="relative min-h-[460px] flex items-center overflow-hidden mesh-gradient-bg py-16 px-margin-mobile md:px-margin-desktop">
          <div className="max-w-container-max mx-auto w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-center relative z-10">
            <div className="text-on-surface space-y-6">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white text-[#004ac6] font-bold text-label-sm uppercase tracking-wider mb-4 shadow-sm border border-white/50">
                <span className="material-symbols-outlined text-[16px]">verified</span>
                GARA Certification
              </div>
              <h1 className="font-display-lg text-display-lg font-bold leading-tight">{t('guide.hero_title_l1')}<br />{t('guide.hero_title_l2')}</h1>
            </div>
            <div className="glass-panel rounded-2xl p-8 ambient-shadow border border-white/40">
              <h3 className="font-title-md text-title-md text-on-surface mb-6 flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">calendar_month</span>
                {t('guide.schedule_title')}
              </h3>
              <div className="space-y-4">
                {SCHEDULE.map((s) => (
                  <div key={s.id} className={`rounded-xl p-4 flex justify-between items-center border ${s.open ? 'bg-surface-container-lowest/60 border-white/50 hover:bg-surface-container-lowest/80 transition-colors cursor-pointer' : 'bg-surface-container-lowest/40 border-white/20 opacity-70'}`}>
                    <div>
                      <div className={`font-label-sm text-label-sm mb-1 ${s.open ? 'text-primary' : 'text-on-surface-variant'}`}>{t(s.roundKey)}</div>
                      <div className={`font-body-md text-body-md text-on-surface ${s.open ? 'font-semibold' : ''}`}>{t(s.dateKey)}</div>
                    </div>
                    <div className={`px-3 py-1 rounded-full font-label-sm text-label-sm ${s.open ? 'bg-primary/10 text-primary' : 'bg-surface-dim text-on-surface-variant'}`}>{t(s.open ? 'guide.status_open' : 'guide.status_upcoming')}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* 5대 평가 영역 */}
        <section className="py-16 bg-surface-container-lowest px-margin-mobile md:px-margin-desktop">
          <div className="max-w-container-max mx-auto">
            <div className="text-center max-w-3xl mx-auto mb-10">
              <h2 className="font-headline-lg md:text-headline-lg text-headline-lg-mobile text-on-surface font-bold mb-4">{t('guide.areas_title')}</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-6 gap-6 max-w-[1000px] mx-auto">
              {AREAS.map((a) => (
                <div key={a.id} className={`${a.cls} bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/30 ambient-shadow ambient-shadow-hover transition-all duration-300 w-full h-full`}>
                  <div className={`w-12 h-12 ${a.tone.split(' ')[0]} rounded-xl flex items-center justify-center mb-6`}>
                    <span className={`material-symbols-outlined ${a.tone.split(' ')[1]} text-[24px]`}>{a.icon}</span>
                  </div>
                  <h3 className="font-title-md text-title-md text-on-surface mb-3">{t(a.titleKey)}</h3>
                  <p className="font-body-md text-body-md text-on-surface-variant">{t(a.descKey)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 응시 방법 */}
        <section className="py-16 bg-surface-container-low px-margin-mobile md:px-margin-desktop">
          <div className="max-w-container-max mx-auto">
            <div className="mb-10 text-center">
              <h2 className="font-headline-lg md:text-headline-lg text-headline-lg-mobile text-on-surface font-bold mb-4">{t('guide.methods_title')}</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {METHODS.map((m) => (
                <div key={m.id} className="bg-surface-container-lowest rounded-2xl p-8 border border-outline-variant/30 ambient-shadow">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
                    <span className="material-symbols-outlined text-primary">{m.icon}</span>
                  </div>
                  <h3 className="font-title-md text-title-md text-on-surface mb-4">{t(m.titleKey)}</h3>
                  <p className="font-body-md text-on-surface-variant">{t(m.descKey)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
