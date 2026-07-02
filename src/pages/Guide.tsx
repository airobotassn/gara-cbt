import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import SiteFooter from '../components/SiteFooter'
import { useT } from '../lib/i18n'
import { getTracks, SCHEDULE } from '../lib/caris'

// gara_9 (자격검정 안내) 목업 디자인 그대로 + 라우팅·로그인 연결.
// 원본: stitch_design_critique_assistant/gara_9/code.html (nav 활성 = 자격검정 안내)
// primary 는 전역 토큰 사용(라이트 #004ac6 / 다크 #7aa9ff). 히어로 밴드 위 흰 버튼만 text-[#004ac6] 하드코딩 유지.


export default function Guide() {
  const { t, lang } = useT()
  const navigate = useNavigate()
  const [track, setTrack] = useState(0)
  const [level, setLevel] = useState(0)
  const TRACKS = getTracks(lang)
  const cur = TRACKS[track]
  const lv = cur.levels[level]
  const isMaster = track === 1
  const goTrack = (i: number) => { setTrack((i + TRACKS.length) % TRACKS.length); setLevel(0) }
  const goLevel = (i: number) => setLevel((i + cur.levels.length) % cur.levels.length)

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
                CARIS Certification
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
                  <div
                    key={s.id}
                    onClick={s.open ? () => navigate('/exam/apply', { state: { roundId: s.id } }) : undefined}
                    className={`rounded-xl p-4 flex justify-between items-center gap-3 border ${s.open ? 'bg-surface-container-lowest/60 border-white/50 hover:bg-surface-container-lowest/80 hover:border-primary/40 transition-colors cursor-pointer' : 'bg-surface-container-lowest/40 border-white/20 opacity-70'}`}
                  >
                    <div>
                      <div className={`font-label-sm text-label-sm mb-1 ${s.open ? 'text-primary' : 'text-on-surface-variant'}`}>{t(s.roundKey)}</div>
                      <div className={`font-body-md text-body-md text-on-surface ${s.open ? 'font-semibold' : ''}`}>{t(s.dateKey)}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`px-3 py-1 rounded-full font-label-sm text-label-sm ${s.open ? 'bg-primary/10 text-primary' : 'bg-surface-dim text-on-surface-variant'}`}>{t(s.open ? 'guide.status_open' : 'guide.status_upcoming')}</span>
                      {s.open && <span className="material-symbols-outlined text-primary text-[20px]">arrow_forward</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* CARIS 자격 소개 — Pro ↔ Master 전환 */}
        <section className="py-16 bg-surface-container-lowest px-margin-mobile md:px-margin-desktop">
          <div className="max-w-container-max mx-auto">
            <div className="text-center max-w-3xl mx-auto mb-10">
              <h2 className="font-headline-lg md:text-headline-lg text-headline-lg-mobile text-on-surface font-bold">{t('guide.cert_intro_title')}</h2>
            </div>

            {/* 트랙 전환: 화살표 + 탭 */}
            <div className="flex items-center justify-center gap-3 sm:gap-4 mb-10">
              <button onClick={() => goTrack(track - 1)} aria-label={t('guide.aria_prev_track')} className="w-11 h-11 rounded-full border border-outline-variant/50 flex items-center justify-center text-on-surface-variant hover:border-primary hover:text-primary transition-colors shrink-0">
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
              <div className="flex gap-1.5 p-1.5 rounded-full bg-surface-container-high">
                {TRACKS.map((tr, i) => (
                  <button key={tr.key} onClick={() => goTrack(i)} className={i === track ? 'px-5 sm:px-7 py-2.5 rounded-full bg-primary text-on-primary font-title-md text-title-md font-bold shadow-sm transition-all' : 'px-5 sm:px-7 py-2.5 rounded-full text-on-surface-variant hover:text-on-surface font-title-md text-title-md font-semibold transition-all'}>{tr.name}</button>
                ))}
              </div>
              <button onClick={() => goTrack(track + 1)} aria-label={t('guide.aria_next_track')} className="w-11 h-11 rounded-full border border-outline-variant/50 flex items-center justify-center text-on-surface-variant hover:border-primary hover:text-primary transition-colors shrink-0">
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
            </div>

            {/* 트랙 패널 */}
            <div className="max-w-4xl mx-auto">
              {/* 트랙 헤더 (핵심 소개) */}
              <div className="text-center mb-8">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary font-label-md text-label-md md:text-body-md font-bold mb-4">
                  <span className="material-symbols-outlined text-[18px] md:text-[20px]">{cur.icon}</span>
                  {cur.eligibility}
                </div>
                <h3 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-[36px] font-bold text-on-surface mb-1">{cur.name}</h3>
                <p className="font-title-md text-title-md md:text-[24px] md:leading-[32px] font-semibold text-on-surface-variant">{cur.tagline}</p>
                <p className="font-body-lg text-body-md md:text-[20px] md:leading-[30px] text-on-surface-variant mt-3 break-keep max-w-xl mx-auto">{cur.caption}</p>
              </div>

              {/* 급수 전환: 화살표 + 급수 (하나의 통합 pill) */}
              <div className="flex justify-center mb-6">
                <div className="inline-flex items-center gap-1 p-1.5 rounded-full bg-surface-container-high border border-outline-variant/20 shadow-sm">
                  <button onClick={() => goLevel(level - 1)} aria-label={t('guide.aria_prev_grade')} className="w-9 h-9 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-highest hover:text-primary transition-colors">
                    <span className="material-symbols-outlined text-[20px]">chevron_left</span>
                  </button>
                  {cur.levels.map((l, i) => (
                    <button key={l.grade} onClick={() => setLevel(i)} className={i === level ? 'min-w-[48px] px-3.5 py-2 rounded-full bg-primary text-on-primary font-label-md text-label-md font-bold shadow-sm transition-all' : 'min-w-[48px] px-3.5 py-2 rounded-full text-on-surface-variant hover:text-on-surface font-label-md text-label-md font-semibold transition-all'}>{l.grade}</button>
                  ))}
                  <button onClick={() => goLevel(level + 1)} aria-label={t('guide.aria_next_grade')} className="w-9 h-9 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-highest hover:text-primary transition-colors">
                    <span className="material-symbols-outlined text-[20px]">chevron_right</span>
                  </button>
                </div>
              </div>

              {/* 단일 급수 카드 */}
              <div className="bg-surface-container-lowest rounded-2xl p-7 md:p-9 border border-outline-variant/30 ambient-shadow">
                {/* 급수 + 대상 */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-7 pb-6 border-b border-outline-variant/20">
                  <span className="inline-flex items-center px-4 py-2 rounded-xl bg-primary text-on-primary font-title-md text-title-md font-bold">{cur.name} {lv.grade}</span>
                  <span className="font-body-md text-body-md text-on-surface-variant break-keep">{isMaster ? `${t('caris.lbl.eligibility')} · ${lv.prereq}` : lv.tag}</span>
                </div>

                {/* 스펙 (라벨 / 값) */}
                <div className="flex flex-col divide-y divide-outline-variant/20">
                  <div className="flex flex-col sm:flex-row gap-2 sm:gap-6 py-5 first:pt-0">
                    <div className="sm:w-28 shrink-0 font-title-md text-body-md text-on-surface-variant font-bold">{t('caris.lbl.subjects')}</div>
                    <ul className="flex-grow flex flex-col gap-2.5">
                      {lv.subjects.map((s, i) => (
                        <li key={i} className="flex items-start gap-2.5 font-body-lg text-body-lg text-on-surface break-keep">
                          <span className="w-6 h-6 rounded-full bg-primary/10 text-primary font-label-sm text-label-sm font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {cur.format ? (
                    <div className="flex flex-col sm:flex-row gap-2 sm:gap-6 py-5">
                      <div className="sm:w-28 shrink-0 font-title-md text-body-md text-on-surface-variant font-bold">{t('caris.lbl.format')}</div>
                      <div className="flex-grow">
                        <p className="font-body-lg text-body-lg text-on-surface break-keep">{cur.format}</p>
                        <p className="font-body-md text-body-md text-on-surface-variant break-keep mt-0.5">{cur.formatSub}</p>
                      </div>
                    </div>
                  ) : lv.method ? (
                    <div className="flex flex-col sm:flex-row gap-2 sm:gap-6 py-5">
                      <div className="sm:w-28 shrink-0 font-title-md text-body-md text-on-surface-variant font-bold">{t('caris.lbl.method')}</div>
                      <div className="flex-grow flex flex-col gap-0.5">
                        {lv.method.split(' · ').map((m, i) => (
                          <p key={i} className="font-body-lg text-body-lg text-on-surface break-keep">{m}</p>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {lv.practical && (
                    <div className="flex flex-col sm:flex-row gap-2 sm:gap-6 py-5">
                      <div className="sm:w-28 shrink-0 font-title-md text-body-md text-on-surface-variant font-bold">{t('caris.lbl.practical')}</div>
                      <p className="flex-grow font-body-lg text-body-lg text-on-surface break-keep">{lv.practical}</p>
                    </div>
                  )}
                </div>

                {/* 합격 기준 */}
                <div className="flex items-start gap-3 mt-6 bg-secondary/10 rounded-xl px-5 py-4">
                  <span className="material-symbols-outlined text-secondary text-[24px] shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                  <div>
                    <div className="font-label-md text-label-md text-on-surface-variant font-semibold">{t('caris.lbl.pass')}</div>
                    <div className="font-title-md text-body-md md:text-title-md text-on-surface font-bold break-keep">{lv.pass}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
