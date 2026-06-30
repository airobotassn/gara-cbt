import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import SiteFooter from '../components/SiteFooter'
import { callFunction } from '../lib/supabase'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'
import { PASS_RATIO } from '../lib/testConfig'
import type { ExamResultResponse, SubmitExamResponse } from '../lib/types'

// 성적 결과 — 목업 없음. GARA Precision 스타일로 자체 디자인(gara_4/5 톤) + 채점 로직/상태 보존.
function fmtDate(iso?: string | null) {
  if (!iso) return '-'
  const d = new Date(iso)
  return d.toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function daysLeft(iso?: string | null) {
  if (!iso) return 0
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000))
}

// 페이지 셸 (Stitch 네비 + 푸터)
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background text-on-surface mesh-bg min-h-screen flex flex-col">
      {/* 헤더 없음 — FAB이 네비 */}
      <main className="flex-grow pt-12 pb-24 px-margin-mobile md:px-margin-desktop w-full max-w-container-max mx-auto flex items-center justify-center">
        {children}
      </main>

      <SiteFooter />
    </div>
  )
}

// 결과 카드 셸
function Card({ children }: { children: ReactNode }) {
  return (
    <div className="glass-panel rounded-2xl p-8 md:p-14 ambient-shadow max-w-2xl w-full text-center border border-white/40">{children}</div>
  )
}
function Emblem({ icon, tone }: { icon: string; tone: 'primary' | 'secondary' | 'error' }) {
  const map = {
    primary: 'bg-primary/10 text-primary border-primary/20',
    secondary: 'bg-secondary/10 text-secondary border-secondary/20',
    error: 'bg-error/10 text-error border-error/20',
  }
  return (
    <div className={`w-20 h-20 rounded-full ${map[tone]} border flex items-center justify-center mx-auto mb-6`}>
      <span className="material-symbols-outlined text-[40px]" style={{ fontVariationSettings: "'FILL' 1" }}>{icon}</span>
    </div>
  )
}

export default function ExamResult() {
  const { attemptId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const justSubmitted = location.state as SubmitExamResponse | null
  const { user } = useAuth()
  const { t } = useT()

  const [data, setData] = useState<ExamResultResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    callFunction<ExamResultResponse>('get-exam-result', { attemptId })
      .then((r) => alive && setData(r))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : t('result.load_failed')))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [attemptId])

  // 무효 제출
  if (justSubmitted?.voided) {
    return (
      <Shell>
        <Card>
          <Emblem icon="block" tone="error" />
          <h1 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface mb-3">{t('result.voided_title')}</h1>
          <p className="font-body-lg text-body-lg text-on-surface-variant mb-8">{t('result.voided_sub')}</p>
        </Card>
      </Shell>
    )
  }

  if (loading) {
    return (
      <Shell>
        <Card>
          <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin mx-auto mb-6"></div>
          <p className="font-body-lg text-body-lg text-on-surface-variant">{t('result.loading')}</p>
        </Card>
      </Shell>
    )
  }

  if (err || !data) {
    return (
      <Shell>
        <Card>
          <Emblem icon="warning" tone="error" />
          <h1 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface mb-3">{t('result.load_failed_title')}</h1>
          <p className="font-body-md text-body-md text-on-surface-variant mb-8">{err}</p>
        </Card>
      </Shell>
    )
  }

  // 채점 공개 전
  if (!data.released) {
    return (
      <Shell>
        <Card>
          <Emblem icon="schedule" tone="primary" />
          <h1 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface mb-3">{t('result.submitted_title')}</h1>
          <p className="font-body-lg text-body-lg text-on-surface-variant mb-8">{t('result.submitted_sub', { n: data.totalQuestions })}</p>
          <div className="bg-surface-container-low rounded-xl p-6 text-left flex flex-col gap-3 mb-8">
            <div className="flex justify-between items-center">
              <span className="font-body-md text-on-surface-variant">{t('result.submitted_at')}</span>
              <b className="font-body-md text-on-surface">{fmtDate(data.submittedAt)}</b>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-body-md text-primary font-semibold">{t('result.release_at')}</span>
              <b className="font-body-md text-primary">{fmtDate(data.resultReleaseAt)}</b>
            </div>
            <p className="font-label-md text-label-md text-on-surface-variant pt-2 border-t border-outline-variant/20">
              {t('result.release_note_pre')}<b className="text-primary">{t('result.release_days', { d: daysLeft(data.resultReleaseAt) })}</b>{t('result.release_note_post')}
            </p>
          </div>
        </Card>
      </Shell>
    )
  }

  // 채점 공개 후
  const passed = data.totalCorrect >= Math.ceil(data.totalQuestions * PASS_RATIO)
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>
  const certName = (meta.full_name as string) || (meta.name as string) || user?.email?.split('@')[0] || '응시자'
  const certNo = `GARA-2026-${String(attemptId ?? '').replace(/-/g, '').slice(0, 6).toUpperCase() || '000001'}`
  const issueDate = (() => {
    const d = new Date()
    return `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}`
  })()
  const scoreText = `${data.totalCorrect} / ${data.totalQuestions}`
  function goCertificate() {
    localStorage.setItem(`cert_issued_${certNo}`, new Date().toISOString())
    navigate('/certificate', { state: { name: certName, qualification: 'GARA 자격검정', certNo, issueDate, scoreText } })
  }

  return (
    <Shell>
      <Card>
        <Emblem icon={passed ? 'trophy' : 'sentiment_dissatisfied'} tone={passed ? 'secondary' : 'error'} />
        <span className={`inline-block px-4 py-1.5 rounded-full font-label-sm text-label-sm uppercase tracking-wider font-bold mb-5 border ${passed ? 'bg-secondary/10 text-secondary border-secondary/20' : 'bg-error/10 text-error border-error/20'}`}>
          {passed ? t('result.pass') : t('result.fail')}
        </span>
        <h1 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface mb-6">{t('result.graded_title')}</h1>
        <div className="flex items-baseline justify-center gap-2 mb-3">
          <span className="font-display-lg text-display-lg text-primary">{data.totalCorrect}</span>
          <span className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface-variant">/ {data.totalQuestions}</span>
        </div>
        <p className="font-body-md text-body-md text-on-surface-variant mb-8">{t('result.submitted_prefix')} {fmtDate(data.submittedAt)}</p>
        <div className="bg-surface-container-low rounded-xl p-4 font-label-md text-label-md text-on-surface-variant mb-8">{t('result.pass_criteria')}</div>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          {passed && (
            <button onClick={goCertificate} className="bg-primary-container text-on-primary font-title-md text-title-md px-8 py-3 rounded-xl hover:translate-y-[-2px] transition-transform duration-200 ambient-shadow inline-flex items-center justify-center gap-2 font-bold">
              <span className="material-symbols-outlined text-[20px]">workspace_premium</span>
              {t('result.issue_cert')}
            </button>
          )}
          <button onClick={() => navigate(-1)} className="bg-surface-container-lowest text-on-surface-variant hover:text-primary font-title-md text-title-md px-8 py-3 rounded-xl border border-outline-variant hover:border-primary transition-all">{t('result.back')}</button>
        </div>
      </Card>
    </Shell>
  )
}
