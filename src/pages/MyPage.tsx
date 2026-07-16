import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction, supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import SiteFooter from '../components/SiteFooter'
import type { MyAttempt, MyAttemptsResponse } from '../lib/types'
import LearningDashboard from '../components/LearningDashboard'
import { makeCertNo, trackOfTitle, tempSeq } from '../lib/certNo'
import { searchSchools } from '../lib/schools'
import { countryName } from '../lib/regions'

// gara_5 (마이페이지) 목업 디자인 그대로 + 실제 응시 데이터·탭·발급·로그인 게이트 로직 보존.
// 원본: stitch_design_critique_assistant/gara_5/code.html
// primary 는 전역 토큰 사용(라이트 #004ac6 / 다크 #7aa9ff) — 페이지별 오버라이드 제거.

const TABS = [
  { key: 'attempts', labelKey: 'mypage.tab_attempts', to: '/mypage' },
  { key: 'earned', labelKey: 'mypage.tab_earned', to: '/mypage/earned' },
  { key: 'issuance', labelKey: 'mypage.tab_issuance', to: '/mypage/issuance' },
  { key: 'learning', labelKey: 'mypage.tab_learning', to: '/mypage/learning' },
]

function fmtDT(iso?: string | null) {
  if (!iso) return '-'
  const d = new Date(iso)
  return isNaN(d.getTime())
    ? '-'
    : d.toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function fmtDate(iso?: string | null) {
  if (!iso) return '-'
  const d = new Date(iso)
  return `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}`
}
function daysLeft(iso?: string | null) {
  if (!iso) return 0
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000))
}
function certNoOf(a: MyAttempt) {
  // 시험명으로 트랙(Pro/Master) 추정 → 종목·등급코드. 일련번호는 서버 연동 전까지 임시(tempSeq).
  const year = (a.submittedAt ? new Date(a.submittedAt).getFullYear() : 0) || new Date().getFullYear()
  return makeCertNo(trackOfTitle(a.examTitle), year, tempSeq(a.attemptId))
}

// 상태 → 카드 비주얼
function statusInfo(a: MyAttempt) {
  if (a.status === 'expired' || a.status === 'voided') {
    return { icon: 'event_busy', wrap: 'bg-outline/10 border-outline/20', color: 'text-outline', badge: a.status === 'voided' ? 'Voided' : 'Expired', badgeClass: 'bg-error/10 text-error border-error/20', greyed: true }
  }
  if (a.status === 'submitted' && a.released) {
    return { icon: 'task', wrap: 'bg-secondary/10 border-secondary/20', color: 'text-secondary', badge: 'Completed', badgeClass: 'bg-secondary/10 text-secondary border-secondary/20', greyed: false }
  }
  return { icon: 'description', wrap: 'bg-primary/10 border-primary/20', color: 'text-primary', badge: a.status === 'in_progress' ? 'In progress' : 'Scoring', badgeClass: 'bg-primary/10 text-primary border-primary/20', greyed: false }
}

// 내 정보 — 국가/지역(읽기전용, 락) + 학교(클라이언트 수정 가능) 편집.
function ProfileSection() {
  const { user } = useAuth()
  const { t, lang } = useT()
  const [profile, setProfile] = useState<{ country_code: string | null; region_code: string | null; school_id: string | null } | null>(null)
  const [schoolName, setSchoolName] = useState('')
  const [q, setQ] = useState('')
  const [results, setResults] = useState<{ id: string; name: string }[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [msg, setMsg] = useState('')

  // 프로필(국가/지역/학교) 로딩
  useEffect(() => {
    if (!user) return
    let alive = true
    supabase
      .from('profiles')
      .select('country_code,region_code,school_id')
      .eq('id', user.id)
      .maybeSingle()
      .then(async ({ data }) => {
        if (!alive) return
        setProfile(data ?? null)
        if (data?.school_id) {
          const { data: s } = await supabase.from('schools').select('name').eq('id', data.school_id).maybeSingle()
          if (alive) setSchoolName(s?.name ?? '')
        }
      })
    return () => {
      alive = false
    }
  }, [user?.id])

  // 학교 자동완성(디바운스 250ms)
  useEffect(() => {
    const term = q.trim()
    if (!term) {
      setResults([])
      return
    }
    setSearching(true)
    const h = setTimeout(async () => {
      const r = await searchSchools(term)
      setResults(r)
      setSearching(false)
    }, 250)
    return () => clearTimeout(h)
  }, [q])

  async function pick(s: { id: string; name: string }) {
    if (!user) return
    setOpen(false)
    setQ('')
    setResults([])
    const { error } = await supabase.from('profiles').update({ school_id: s.id }).eq('id', user.id)
    if (error) {
      setMsg(t('mypage.school_save_failed'))
      return
    }
    setSchoolName(s.name)
    setProfile((p) => (p ? { ...p, school_id: s.id } : p))
    setMsg(t('mypage.school_saved'))
  }

  const countryLabel = profile?.country_code ? countryName(profile.country_code, lang) : '-'
  const regionLabel = profile?.region_code ? t(`region.${profile.region_code}`) : '-'

  return (
    <section className="bg-surface-container-lowest rounded-2xl p-6 md:p-8 border border-outline-variant/30 ambient-shadow mb-8 md:mb-10">
      <h2 className="font-title-md text-lg md:text-[22px] font-bold text-on-surface mb-5">{t('mypage.profile_title')}</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-2">
        {/* 국가 (읽기전용) */}
        <div>
          <label className="block font-label-md text-[13px] font-semibold text-outline mb-1.5">{t('onboarding.country')}</label>
          <div className="w-full rounded-xl bg-surface-container-low border border-outline-variant/40 px-4 py-3 font-body-md text-on-surface-variant select-none cursor-not-allowed">{countryLabel}</div>
        </div>
        {/* 지역 (읽기전용) */}
        <div>
          <label className="block font-label-md text-[13px] font-semibold text-outline mb-1.5">{t('onboarding.region')}</label>
          <div className="w-full rounded-xl bg-surface-container-low border border-outline-variant/40 px-4 py-3 font-body-md text-on-surface-variant select-none cursor-not-allowed">{regionLabel}</div>
        </div>
      </div>
      <p className="font-body-sm text-[13px] text-outline mb-6 flex items-center gap-1.5">
        <span className="material-symbols-outlined text-[16px]">lock</span>
        {t('mypage.region_locked')}
      </p>

      {/* 학교 (수정 가능) */}
      <div className="relative">
        <label className="block font-label-md text-[13px] font-semibold text-on-surface mb-1.5">{t('mypage.school_label')}</label>
        {schoolName && (
          <div className="mb-2 font-body-md text-on-surface">{schoolName}</div>
        )}
        <input
          type="text"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
            setMsg('')
          }}
          onFocus={() => setOpen(true)}
          placeholder={schoolName ? t('onboarding.school_search') : `${t('mypage.school_none')} — ${t('onboarding.school_search')}`}
          className="w-full rounded-xl bg-surface-container-lowest border border-outline-variant/60 px-4 py-3 font-body-md text-on-surface focus:border-primary focus:outline-none"
        />
        {open && q.trim() && (
          <div className="absolute z-20 mt-1 w-full rounded-xl bg-surface-container-lowest border border-outline-variant/50 shadow-lg overflow-hidden max-h-72 overflow-y-auto">
            {searching && <div className="px-4 py-3 font-body-md text-on-surface-variant">{t('common.loading')}</div>}
            {!searching && results.length === 0 && <div className="px-4 py-3 font-body-md text-on-surface-variant">{t('mypage.school_no_results')}</div>}
            {!searching &&
              results.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => pick(s)}
                  className="block w-full text-left px-4 py-3 font-body-md text-on-surface hover:bg-primary/5 transition-colors"
                >
                  {s.name}
                </button>
              ))}
          </div>
        )}
        {msg && <p className="mt-2 font-body-sm text-[13px] text-primary">{msg}</p>}
      </div>
    </section>
  )
}

export default function MyPage() {
  const navigate = useNavigate()
  const { section } = useParams()
  const tab = section && TABS.some((t) => t.key === section) ? section : 'attempts'
  const { isFullUser, user } = useAuth()
  const { t } = useT()
  const [list, setList] = useState<MyAttempt[] | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!isFullUser) return
    callFunction<{ attempts: MyAttempt[] }>('my-attempts', {})
      .then((r) => setList(r.attempts))
      .catch((e) => setErr(e instanceof Error ? e.message : t('my.load_failed')))
  }, [isFullUser])

  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>
  const name = (meta.full_name as string) || (meta.name as string) || user?.email?.split('@')[0] || t('mypage.default_name')

  // 발급 = 서버 기록(cert_issued_at) — 마이페이지/성적표 어디서 발급해도 '발급 완료'로 남고, 재발급도 가능.
  // 발급 응답에서 진위확인 토큰·확정 자격번호를 받아 자격증(QR)에 실어 보낸다.
  async function goCert(a: MyAttempt) {
    let verifyToken = a.verifyToken ?? undefined
    let certNo = a.certNo ?? certNoOf(a)
    try {
      const r = await callFunction<MyAttemptsResponse>('my-attempts', { issue: a.attemptId })
      if (r.issued) {
        verifyToken = r.issued.verifyToken
        certNo = r.issued.certNo
      }
      setList((prev) => prev?.map((x) => (x.attemptId === a.attemptId ? { ...x, certIssuedAt: new Date().toISOString(), certNo: r.issued?.certNo ?? x.certNo, verifyToken: r.issued?.verifyToken ?? x.verifyToken } : x)) ?? prev)
    } catch {
      /* 발급 기록 실패 — 증서 화면은 열어준다(다음 방문 때 상태 재동기화) */
    }
    navigate('/certificate', {
      state: { name, qualification: a.examTitle ?? t('mypage.exam_fallback'), certNo, issueDate: fmtDate(a.submittedAt), verifyToken, scoreText: `${a.totalCorrect} / ${a.totalQuestions}` },
    })
  }

  // 로그인 안 된 상태 → 로그인 페이지로 이동 (자체 로그인 게이트 제거)
  if (!isFullUser) return <Navigate to="/login" replace />

  const attempts = list ?? []
  const earned = attempts.filter((a) => a.passed === true)
  const loading = !err && list === null

  return (
    <div className="bg-background text-on-background min-h-screen relative overflow-x-hidden">
      {/* 헤더 없음 — FAB이 네비 */}
      <main className="min-h-screen px-margin-mobile md:px-margin-desktop pb-24 pt-12 relative">
        <div
          className="fixed inset-0 mesh-gradient-bg -z-10 pointer-events-none"
          style={{ maskImage: 'linear-gradient(to bottom, white 0%, white 300px, transparent 600px)', WebkitMaskImage: 'linear-gradient(to bottom, white 0%, white 300px, transparent 600px)', opacity: 0.15 }}
        ></div>

        <div className="max-w-5xl mx-auto w-full relative z-10">
          {/* Page Header */}
          <header className="mb-8 md:mb-12">
            <h1 className="font-display-lg text-4xl md:text-display-lg font-bold text-on-surface mb-3 tracking-tight break-keep">{t('mypage.title')}</h1>
            <p className="font-body-lg text-body-lg text-on-surface-variant">
              {t('mypage.greeting_hello')}<strong className="text-primary font-bold">{t('mypage.greeting_name', { name })}</strong>{t('mypage.greeting_tail')}
            </p>
          </header>

          {/* CARIS 자격검정 응시 진입 — FAB에서 이관한 상단 CTA 배너 */}
          {/* TODO(응시권): 결제/응시권 백엔드 생기면 '결제된 시험 있으면 /exam, 없으면 /guide' 분기.
              단, 실제 게이팅은 여기(버튼)가 아니라 ExamGate(/exam) 의 onStart 훅에서 일괄 처리 예정 → 지금은 /exam 유지. */}
          <button
            onClick={() => navigate('/exam')}
            className="group w-full mb-8 md:mb-10 flex items-center justify-between gap-4 rounded-2xl bg-primary-container text-on-primary px-6 py-5 md:px-8 md:py-6 ambient-shadow hover:translate-y-[-2px] transition-transform duration-200 text-left"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[26px]" style={{ fontVariationSettings: "'FILL' 1" }}>edit_document</span>
              </div>
              <div>
                <div className="font-title-md text-lg md:text-[22px] font-bold">{t('mypage.go_exam')}</div>
                <div className="font-body-md text-body-md opacity-90">{t('mypage.cta_sub')}</div>
              </div>
            </div>
            <span className="material-symbols-outlined text-[28px] group-hover:translate-x-1 transition-transform">arrow_forward</span>
          </button>

          {/* 내 정보 — 국가/지역(락) + 학교 편집 */}
          <ProfileSection />

          {/* Tabs */}
          <div className="flex gap-5 sm:gap-8 border-b border-outline-variant/40 mb-8 md:mb-10 overflow-x-auto scrollbar-hide">
            {TABS.map((tb) => (
              <Link
                key={tb.key}
                to={tb.to}
                className={
                  tab === tb.key
                    ? 'pb-4 border-b-[3px] border-primary text-primary font-title-md text-base sm:text-[18px] leading-[24px] font-bold px-1 sm:px-2 whitespace-nowrap'
                    : 'pb-4 border-b-[3px] border-transparent text-outline hover:text-on-surface font-title-md text-base sm:text-[18px] leading-[24px] font-semibold px-1 sm:px-2 transition-colors whitespace-nowrap'
                }
              >
                {t(tb.labelKey)}
              </Link>
            ))}
          </div>

          {err && tab !== 'learning' && <div className="bg-surface-container-lowest rounded-2xl p-8 border border-outline-variant/30 text-center text-on-surface-variant">{err}</div>}
          {loading && tab !== 'learning' && <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center text-on-surface-variant">{t('common.loading')}</div>}

          {/* 학습 대시보드 (CARIS ARENA) — 자체적으로 list-attempts 로딩 */}
          {tab === 'learning' && <LearningDashboard />}

          {/* 시험 응시 현황 */}
          {!loading && !err && tab === 'attempts' && (
            attempts.length === 0 ? (
              <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center">
                <p className="font-body-md text-on-surface-variant mb-5">{t('mypage.empty_attempts')}</p>
                <button onClick={() => navigate('/exam')} className="bg-primary-container text-on-primary font-label-md font-bold px-6 py-3 rounded-xl hover:bg-primary transition-colors ambient-shadow">{t('mypage.go_exam')}</button>
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                {attempts.map((a) => {
                  const s = statusInfo(a)
                  return (
                    <article key={a.attemptId} className={`bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/30 ambient-shadow ambient-shadow-hover transition-all duration-300 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 ${s.greyed ? 'opacity-75' : ''}`}>
                      <div className="flex items-start gap-5 flex-1">
                        <div className={`w-14 h-14 rounded-xl ${s.wrap} flex items-center justify-center shrink-0 border`}>
                          <span className={`material-symbols-outlined ${s.color} text-[28px]`} style={{ fontVariationSettings: "'FILL' 1" }}>{s.icon}</span>
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2">
                            <h3 className={`font-title-md text-lg leading-snug md:text-[22px] md:leading-[28px] font-bold break-keep ${s.greyed ? 'text-on-surface-variant' : 'text-on-surface'}`}>{a.examTitle ?? t('mypage.exam_fallback')}</h3>
                            <span className={`px-3 py-1 ${s.badgeClass} font-label-sm text-[11px] leading-[14px] uppercase tracking-wider font-bold rounded-full border shrink-0`}>{s.badge}</span>
                          </div>
                          <p className="font-body-md text-body-md text-on-surface-variant mb-3">{fmtDT(a.submittedAt)} | {t('mypage.online')}</p>
                          {a.status === 'submitted' && !a.released && (
                            <p className="font-label-md text-[15px] leading-[22px] text-primary font-semibold flex items-center gap-1.5 bg-primary/5 px-3 py-1.5 rounded-lg w-fit">
                              <span className="material-symbols-outlined text-[18px]">schedule</span>
                              {t('mypage.grading', { days: daysLeft(a.resultReleaseAt) })}
                            </p>
                          )}
                          {(a.status === 'expired' || a.status === 'voided') && (
                            <p className="font-body-md text-body-md text-outline">{t('mypage.expired')}</p>
                          )}
                        </div>
                      </div>
                      {a.status === 'submitted' && a.released && (
                        <div className="shrink-0">
                          <button onClick={() => navigate(`/exam/result/${a.attemptId}`)} className="px-6 py-2.5 bg-surface-container-lowest border border-outline-variant text-on-surface font-label-md text-[15px] font-bold rounded-xl hover:bg-surface-container-low hover:border-primary/30 hover:text-primary transition-all duration-200 flex items-center gap-2 shadow-sm">
                            {t('mypage.view_score')}
                            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                          </button>
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            )
          )}

          {/* 자격 취득 현황 */}
          {!loading && !err && tab === 'earned' && (
            earned.length === 0 ? (
              <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center text-on-surface-variant">{t('mypage.empty_earned')}</div>
            ) : (
              <div className="flex flex-col gap-6">
                {earned.map((a) => (
                  <article key={a.attemptId} className="bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/30 ambient-shadow ambient-shadow-hover transition-all duration-300 flex items-start gap-5">
                    <div className="w-14 h-14 rounded-xl bg-secondary/10 border border-secondary/20 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-secondary text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>workspace_premium</span>
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2">
                        <h3 className="font-title-md text-lg leading-snug md:text-[22px] md:leading-[28px] font-bold text-on-surface break-keep">{a.examTitle ?? t('mypage.exam_fallback')}</h3>
                        <span className="px-3 py-1 bg-secondary/10 text-secondary font-label-sm text-[11px] leading-[14px] uppercase tracking-wider font-bold rounded-full border border-secondary/20 shrink-0">{t('mypage.passed')}</span>
                      </div>
                      <p className="font-body-md text-body-md text-on-surface-variant">{fmtDate(a.submittedAt)} | {t('mypage.cert_no')} {a.certNo ?? certNoOf(a)} | {a.totalCorrect ?? 0} / {a.totalQuestions ?? 0}</p>
                    </div>
                  </article>
                ))}
              </div>
            )
          )}

          {/* 자격증 발급 현황 */}
          {!loading && !err && tab === 'issuance' && (
            earned.length === 0 ? (
              <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center text-on-surface-variant">{t('mypage.empty_issuance')}</div>
            ) : (
              <div className="flex flex-col gap-6">
                {earned.map((a) => {
                  const certNo = a.certNo ?? certNoOf(a)
                  const issued = !!a.certIssuedAt
                  return (
                    <article key={a.attemptId} className="bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/30 ambient-shadow ambient-shadow-hover transition-all duration-300 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                      <div className="flex items-start gap-5 flex-1">
                        <div className="w-14 h-14 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-primary text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                        </div>
                        <div>
                          <h3 className="font-title-md text-lg leading-snug md:text-[22px] md:leading-[28px] font-bold text-on-surface mb-2 break-keep">{a.examTitle ?? t('mypage.exam_fallback')}</h3>
                          <p className="font-body-md text-body-md text-on-surface-variant">{t('mypage.cert_no')} {certNo}</p>
                        </div>
                      </div>
                      <div className="shrink-0 flex flex-wrap items-center gap-3">
                        <span className={`px-3 py-1 font-label-sm text-[11px] leading-[14px] uppercase tracking-wider font-bold rounded-full border ${issued ? 'bg-secondary/10 text-secondary border-secondary/20' : 'bg-outline/10 text-outline border-outline/20'}`}>{issued ? 'Issued' : 'Ready'}</span>
                        <button onClick={() => goCert(a)} className="px-6 py-2.5 bg-primary-container text-on-primary font-label-md text-[15px] font-bold rounded-xl hover:bg-primary transition-colors ambient-shadow flex items-center gap-2">
                          {issued ? t('mypage.reissue') : t('mypage.issue')}
                          <span className="material-symbols-outlined text-[18px]">download</span>
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            )
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
