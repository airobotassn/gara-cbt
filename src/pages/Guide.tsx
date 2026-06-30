import { type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import SiteFooter from '../components/SiteFooter'

// gara_9 (자격검정 안내) 목업 디자인 그대로 + 라우팅·로그인 연결.
// 원본: stitch_design_critique_assistant/gara_9/code.html (nav 활성 = 자격검정 안내)
// GARA 공식 블루 #004ac6 로 전 페이지 통일 (전역 @theme 와 동일값)
const C = { '--color-primary': '#004ac6', '--color-primary-container': '#004ac6' } as CSSProperties

const AREAS = [
  { icon: 'psychology', tone: 'bg-primary/10 text-primary', h: 'AI 활용·기초', d: '프롬프트 엔지니어링의 기본 원리와 생성형 AI 도구의 특성 이해 및 기본 조작 능력을 평가합니다.', cls: 'md:col-span-2' },
  { icon: 'database', tone: 'bg-secondary/10 text-secondary', h: '데이터·전처리', d: 'AI 모델 학습 및 결과물 도출을 위한 데이터 수집, 정제, 가공 등 전처리 과정의 이해도를 평가합니다.', cls: 'md:col-span-2' },
  { icon: 'model_training', tone: 'bg-tertiary/10 text-tertiary', h: '모델·학습', d: '다양한 AI 모델의 특성을 파악하고, 목적에 맞는 모델 선택 및 미세조정(Fine-tuning) 개념을 평가합니다.', cls: 'md:col-span-2' },
  { icon: 'gavel', tone: 'bg-error/10 text-error', h: '윤리·보안', d: 'AI 활용 시 발생할 수 있는 저작권, 개인정보보호, 편향성 문제 등 윤리적 가이드라인 준수 여부를 평가합니다.', cls: 'md:col-start-2 md:col-span-2' },
  { icon: 'rocket_launch', tone: 'bg-primary-container/10 text-primary-container', h: '실무·적용', d: '텍스트, 이미지, 코딩 등 다양한 비즈니스 상황에서 AI 도구를 활용하여 실제 결과물을 효율적으로 도출하는 종합 문제 해결 능력을 중점적으로 평가합니다.', cls: 'md:col-span-2' },
]
const METHODS = [
  { icon: 'computer', h: 'PC(데스크톱·노트북) 전용', d: '안정적인 검정을 위해 모바일·태블릿 기기에서는 응시가 불가능합니다.' },
  { icon: 'security', h: '보안 브라우저(SEB)', d: '화면 캡처 및 이탈을 원천 차단하는 전용 보안 브라우저를 통해 평가의 신뢰도를 보장합니다.' },
  { icon: 'fact_check', h: '시험환경 테스트', d: '응시 전 반드시 환경 테스트를 거쳐 최적의 시스템 상태를 점검하시기 바랍니다.' },
]
const SCHEDULE = [
  { round: '제 4회 정기시험', date: '2024. 11. 23 (토)', status: '접수중', open: true },
  { round: '제 5회 정기시험', date: '2024. 12. 21 (토)', status: '예정', open: false },
  { round: '제 1회 정기시험 (2025)', date: '2025. 01. 18 (토)', status: '예정', open: false },
]

export default function Guide() {
  const navigate = useNavigate()

  return (
    <div className="bg-background text-on-background min-h-screen" style={C}>
      {/* 헤더 없음 — FAB이 네비 */}
      <main>
        {/* Hero */}
        <section className="relative min-h-[460px] flex items-center overflow-hidden mesh-gradient-bg py-16 px-margin-mobile md:px-margin-desktop">
          <div className="max-w-container-max mx-auto w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-center relative z-10">
            <div className="text-white space-y-6">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white text-primary font-bold text-label-sm uppercase tracking-wider mb-4 shadow-sm border border-white/50">
                <span className="material-symbols-outlined text-[16px]">verified</span>
                GARA Certification
              </div>
              <h1 className="font-display-lg text-display-lg font-bold leading-tight">글로벌 AI 활용 능력의<br />확실한 기준</h1>
              <p className="font-body-lg text-body-lg opacity-90 max-w-lg">GARA는 실무 중심의 생성형 AI 활용 능력을 객관적인 지표로 평가하는 국제 표준 자격입니다. 5가지 핵심 영역을 통해 당신의 완벽한 AI 경쟁력을 증명하세요.</p>
              <div className="pt-4 flex flex-wrap gap-4">
                <button onClick={() => navigate('/exam')} className="bg-white text-primary rounded-xl px-6 py-3 font-label-md text-label-md font-bold hover:bg-surface-container-low transition-colors ambient-shadow flex items-center gap-2">
                  시험 접수하기
                  <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                </button>
                <button onClick={() => navigate('/exam/check')} className="bg-white/60 text-primary rounded-xl px-6 py-3 font-label-md text-label-md font-bold hover:bg-white/80 transition-colors border border-white/50 backdrop-blur-md shadow-lg">모의 테스트</button>
              </div>
            </div>
            <div className="glass-panel rounded-2xl p-8 ambient-shadow border border-white/40">
              <h3 className="font-title-md text-title-md text-on-surface mb-6 flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">calendar_month</span>
                2024년 정기시험 일정
              </h3>
              <div className="space-y-4">
                {SCHEDULE.map((s) => (
                  <div key={s.round} className={`rounded-xl p-4 flex justify-between items-center border ${s.open ? 'bg-white/60 border-white/50 hover:bg-white/80 transition-colors cursor-pointer' : 'bg-white/40 border-white/20 opacity-70'}`}>
                    <div>
                      <div className={`font-label-sm text-label-sm mb-1 ${s.open ? 'text-primary' : 'text-on-surface-variant'}`}>{s.round}</div>
                      <div className={`font-body-md text-body-md text-on-surface ${s.open ? 'font-semibold' : ''}`}>{s.date}</div>
                    </div>
                    <div className={`px-3 py-1 rounded-full font-label-sm text-label-sm ${s.open ? 'bg-primary/10 text-primary' : 'bg-surface-dim text-on-surface-variant'}`}>{s.status}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* 5대 평가 영역 */}
        <section className="py-16 bg-white px-margin-mobile md:px-margin-desktop">
          <div className="max-w-container-max mx-auto">
            <div className="text-center max-w-3xl mx-auto mb-10">
              <h2 className="font-headline-lg md:text-headline-lg text-headline-lg-mobile text-on-surface font-bold mb-4">5대 평가 영역</h2>
              <p className="font-body-md text-body-md text-on-surface-variant">GARA는 AI 기술의 단순 이해를 넘어, 실제 업무 환경에서의 활용 능력을 종합적이고 체계적으로 평가합니다.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-6 gap-6 max-w-[1000px] mx-auto">
              {AREAS.map((a) => (
                <div key={a.h} className={`${a.cls} bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/30 ambient-shadow ambient-shadow-hover transition-all duration-300 w-full h-full`}>
                  <div className={`w-12 h-12 ${a.tone.split(' ')[0]} rounded-xl flex items-center justify-center mb-6`}>
                    <span className={`material-symbols-outlined ${a.tone.split(' ')[1]} text-[24px]`}>{a.icon}</span>
                  </div>
                  <h3 className="font-title-md text-title-md text-on-surface mb-3">{a.h}</h3>
                  <p className="font-body-md text-body-md text-on-surface-variant">{a.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 응시 방법 */}
        <section className="py-16 bg-surface-container-low px-margin-mobile md:px-margin-desktop">
          <div className="max-w-container-max mx-auto">
            <div className="mb-10 text-center">
              <h2 className="font-headline-lg md:text-headline-lg text-headline-lg-mobile text-on-surface font-bold mb-4">응시 방법</h2>
              <p className="font-body-md text-body-md text-on-surface-variant">GARA 자격검정은 공정하고 확실한 환경에서 진행됩니다.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {METHODS.map((m) => (
                <div key={m.h} className="bg-white rounded-2xl p-8 border border-outline-variant/30 ambient-shadow">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
                    <span className="material-symbols-outlined text-primary">{m.icon}</span>
                  </div>
                  <h3 className="font-title-md text-title-md text-on-surface mb-4">{m.h}</h3>
                  <p className="font-body-md text-on-surface-variant">{m.d}</p>
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
