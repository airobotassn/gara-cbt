import { useEffect, useState, type CSSProperties } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import { useT } from '../lib/i18n'
import SiteFooter from '../components/SiteFooter'
import type { MyAttempt } from '../lib/types'

// gara_5 (마이페이지) 목업 디자인 그대로 + 실제 응시 데이터·탭·발급·로그인 게이트 로직 보존.
// 원본: stitch_design_critique_assistant/gara_5/code.html
// gara_5 는 primary=#004ac6 라 이 페이지에만 토큰 오버라이드.
const PRIMARY_FIX = { '--color-primary': '#004ac6' } as CSSProperties

const TABS = [
  { key: 'attempts', label: '시험 응시 현황', to: '/mypage' },
  { key: 'earned', label: '자격 취득 현황', to: '/mypage/earned' },
  { key: 'issuance', label: '자격증 발급 현황', to: '/mypage/issuance' },
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
  return `GARA-2026-${a.attemptId.replace(/-/g, '').slice(0, 6).toUpperCase()}`
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

export default function MyPage() {
  const navigate = useNavigate()
  const { section } = useParams()
  const tab = section && TABS.some((t) => t.key === section) ? section : 'attempts'
  const { isFullUser, loginWithGoogle, user } = useAuth()
  const { t } = useT()
  const [list, setList] = useState<MyAttempt[] | null>(null)
  const [err, setErr] = useState('')
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!isFullUser) return
    callFunction<{ attempts: MyAttempt[] }>('my-attempts', {})
      .then((r) => setList(r.attempts))
      .catch((e) => setErr(e instanceof Error ? e.message : t('my.load_failed')))
  }, [isFullUser])

  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>
  const name = (meta.full_name as string) || (meta.name as string) || user?.email?.split('@')[0] || '응시자'

  const isIssued = (certNo: string) => !!localStorage.getItem(`cert_issued_${certNo}`)
  function goCert(a: MyAttempt) {
    const certNo = certNoOf(a)
    localStorage.setItem(`cert_issued_${certNo}`, new Date().toISOString())
    setTick((x) => x + 1)
    navigate('/certificate', {
      state: { name, qualification: a.examTitle ?? 'GARA 자격검정', certNo, issueDate: fmtDate(a.submittedAt), scoreText: `${a.totalCorrect} / ${a.totalQuestions}` },
    })
  }

  // ── 로그인 게이트 ──
  if (!isFullUser) {
    return (
      <div className="bg-background text-on-background min-h-screen flex flex-col" style={PRIMARY_FIX}>
        <main className="flex-grow flex items-center justify-center px-margin-mobile md:px-margin-desktop py-16">
          <div className="bg-white rounded-2xl p-10 border border-outline-variant/30 ambient-shadow text-center max-w-md w-full">
            <div className="w-14 h-14 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-5">
              <span className="material-symbols-outlined text-primary text-[28px]">lock</span>
            </div>
            <h2 className="font-title-md text-[22px] leading-[28px] font-bold text-on-surface mb-2">로그인이 필요합니다</h2>
            <p className="font-body-md text-body-md text-on-surface-variant mb-6">마이페이지는 로그인 후 이용할 수 있습니다.</p>
            <button onClick={() => loginWithGoogle()} className="bg-primary-container text-on-primary font-label-md text-label-md font-bold px-6 py-3 rounded-xl hover:bg-primary transition-colors ambient-shadow">구글로 로그인</button>
          </div>
        </main>
        <SiteFooter />
      </div>
    )
  }

  const attempts = list ?? []
  const earned = attempts.filter((a) => a.passed === true)
  const loading = !err && list === null

  return (
    <div className="bg-background text-on-background min-h-screen relative overflow-x-hidden" style={PRIMARY_FIX}>
      {/* 헤더 없음 — FAB이 네비 */}
      <main className="min-h-screen px-margin-mobile md:px-margin-desktop pb-24 pt-12 relative">
        <div
          className="fixed inset-0 mesh-gradient-bg -z-10 pointer-events-none"
          style={{ maskImage: 'linear-gradient(to bottom, white 0%, white 300px, transparent 600px)', WebkitMaskImage: 'linear-gradient(to bottom, white 0%, white 300px, transparent 600px)', opacity: 0.15 }}
        ></div>

        <div className="max-w-5xl mx-auto w-full relative z-10">
          {/* Page Header */}
          <header className="mb-12">
            <h1 className="font-display-lg text-display-lg font-bold text-on-surface mb-3 tracking-tight">마이페이지</h1>
            <p className="font-body-lg text-body-lg text-on-surface-variant">
              안녕하세요, <strong className="text-primary font-bold">{name} 님</strong>. GARA 자격검정 현황을 확인하세요.
            </p>
          </header>

          {/* Tabs */}
          <div className="flex gap-8 border-b border-outline-variant/40 mb-10 overflow-x-auto">
            {TABS.map((tb) => (
              <Link
                key={tb.key}
                to={tb.to}
                className={
                  tab === tb.key
                    ? 'pb-4 border-b-[3px] border-primary text-primary font-title-md text-[18px] leading-[24px] font-bold px-2 whitespace-nowrap'
                    : 'pb-4 border-b-[3px] border-transparent text-outline hover:text-on-surface font-title-md text-[18px] leading-[24px] font-semibold px-2 transition-colors whitespace-nowrap'
                }
              >
                {tb.label}
              </Link>
            ))}
          </div>

          {err && <div className="bg-white rounded-2xl p-8 border border-outline-variant/30 text-center text-on-surface-variant">{err}</div>}
          {loading && <div className="bg-white rounded-2xl p-12 border border-outline-variant/30 text-center text-on-surface-variant">{t('common.loading')}</div>}

          {/* 시험 응시 현황 */}
          {!loading && !err && tab === 'attempts' && (
            attempts.length === 0 ? (
              <div className="bg-white rounded-2xl p-12 border border-outline-variant/30 text-center">
                <p className="font-body-md text-on-surface-variant mb-5">아직 응시 내역이 없습니다.</p>
                <button onClick={() => navigate('/exam')} className="bg-primary-container text-on-primary font-label-md font-bold px-6 py-3 rounded-xl hover:bg-primary transition-colors ambient-shadow">자격검정 응시하기</button>
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                {attempts.map((a) => {
                  const s = statusInfo(a)
                  return (
                    <article key={a.attemptId} className={`bg-white rounded-2xl p-6 border border-outline-variant/30 ambient-shadow ambient-shadow-hover transition-all duration-300 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 ${s.greyed ? 'opacity-75' : ''}`}>
                      <div className="flex items-start gap-5 flex-1">
                        <div className={`w-14 h-14 rounded-xl ${s.wrap} flex items-center justify-center shrink-0 border`}>
                          <span className={`material-symbols-outlined ${s.color} text-[28px]`} style={{ fontVariationSettings: "'FILL' 1" }}>{s.icon}</span>
                        </div>
                        <div>
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className={`font-title-md text-[22px] leading-[28px] font-bold ${s.greyed ? 'text-on-surface-variant' : 'text-on-surface'}`}>{a.examTitle ?? 'GARA 자격검정'}</h3>
                            <span className={`px-3 py-1 ${s.badgeClass} font-label-sm text-[11px] leading-[14px] uppercase tracking-wider font-bold rounded-full border`}>{s.badge}</span>
                          </div>
                          <p className="font-body-md text-body-md text-on-surface-variant mb-3">{fmtDT(a.submittedAt)} | 온라인</p>
                          {a.status === 'submitted' && !a.released && (
                            <p className="font-label-md text-[15px] leading-[22px] text-primary font-semibold flex items-center gap-1.5 bg-primary/5 px-3 py-1.5 rounded-lg w-fit">
                              <span className="material-symbols-outlined text-[18px]">schedule</span>
                              채점 중입니다. 결과는 약 {daysLeft(a.resultReleaseAt)}일 후 발표됩니다.
                            </p>
                          )}
                          {(a.status === 'expired' || a.status === 'voided') && (
                            <p className="font-body-md text-body-md text-outline">응시 기간 만료</p>
                          )}
                        </div>
                      </div>
                      {a.status === 'submitted' && a.released && (
                        <div className="shrink-0">
                          <button onClick={() => navigate(`/exam/result/${a.attemptId}`)} className="px-6 py-2.5 bg-white border border-outline-variant text-on-surface font-label-md text-[15px] font-bold rounded-xl hover:bg-surface-container-low hover:border-primary/30 hover:text-primary transition-all duration-200 flex items-center gap-2 shadow-sm">
                            성적 확인
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
              <div className="bg-white rounded-2xl p-12 border border-outline-variant/30 text-center text-on-surface-variant">아직 취득한 자격이 없습니다.</div>
            ) : (
              <div className="flex flex-col gap-6">
                {earned.map((a) => (
                  <article key={a.attemptId} className="bg-white rounded-2xl p-6 border border-outline-variant/30 ambient-shadow ambient-shadow-hover transition-all duration-300 flex items-start gap-5">
                    <div className="w-14 h-14 rounded-xl bg-secondary/10 border border-secondary/20 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-secondary text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>workspace_premium</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-title-md text-[22px] leading-[28px] font-bold text-on-surface">{a.examTitle ?? 'GARA 자격검정'}</h3>
                        <span className="px-3 py-1 bg-secondary/10 text-secondary font-label-sm text-[11px] leading-[14px] uppercase tracking-wider font-bold rounded-full border border-secondary/20">합격</span>
                      </div>
                      <p className="font-body-md text-body-md text-on-surface-variant">{fmtDate(a.submittedAt)} | 인증번호 {certNoOf(a)} | {a.totalCorrect ?? 0} / {a.totalQuestions ?? 0}</p>
                    </div>
                  </article>
                ))}
              </div>
            )
          )}

          {/* 자격증 발급 현황 */}
          {!loading && !err && tab === 'issuance' && (
            earned.length === 0 ? (
              <div className="bg-white rounded-2xl p-12 border border-outline-variant/30 text-center text-on-surface-variant">발급 가능한 자격증이 없습니다.</div>
            ) : (
              <div className="flex flex-col gap-6">
                {earned.map((a) => {
                  const certNo = certNoOf(a)
                  const issued = isIssued(certNo)
                  return (
                    <article key={a.attemptId} className="bg-white rounded-2xl p-6 border border-outline-variant/30 ambient-shadow ambient-shadow-hover transition-all duration-300 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                      <div className="flex items-start gap-5 flex-1">
                        <div className="w-14 h-14 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-primary text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                        </div>
                        <div>
                          <h3 className="font-title-md text-[22px] leading-[28px] font-bold text-on-surface mb-2">{a.examTitle ?? 'GARA 자격검정'}</h3>
                          <p className="font-body-md text-body-md text-on-surface-variant">인증번호 {certNo}</p>
                        </div>
                      </div>
                      <div className="shrink-0 flex items-center gap-3">
                        <span className={`px-3 py-1 font-label-sm text-[11px] leading-[14px] uppercase tracking-wider font-bold rounded-full border ${issued ? 'bg-secondary/10 text-secondary border-secondary/20' : 'bg-outline/10 text-outline border-outline/20'}`}>{issued ? 'Issued' : 'Ready'}</span>
                        <button onClick={() => goCert(a)} className="px-6 py-2.5 bg-primary-container text-on-primary font-label-md text-[15px] font-bold rounded-xl hover:bg-primary transition-colors ambient-shadow flex items-center gap-2">
                          {issued ? '재발급' : '발급'}
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
