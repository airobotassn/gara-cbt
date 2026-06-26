import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import HomeLink from '../components/HomeLink'
import { useT } from '../lib/i18n'
import type { MyAttempt } from '../lib/types'

const STATUS: Record<string, string> = {
  in_progress: 'my.status.in_progress',
  submitted: 'my.status.submitted',
  voided: 'my.status.voided',
  expired: 'my.status.expired',
}
const TABS = [
  { key: 'attempts', label: 'my.tab.attempts', icon: '📝', to: '/mypage' },
  { key: 'earned', label: 'my.tab.earned', icon: '🏅', to: '/mypage/earned' },
  { key: 'issuance', label: 'my.tab.issuance', icon: '📜', to: '/mypage/issuance' },
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
  const name =
    (meta.full_name as string) || (meta.name as string) || user?.email?.split('@')[0] || '응시자'

  const isIssued = (certNo: string) => !!localStorage.getItem(`cert_issued_${certNo}`)
  function goCert(a: MyAttempt) {
    const certNo = certNoOf(a)
    localStorage.setItem(`cert_issued_${certNo}`, new Date().toISOString())
    setTick((t) => t + 1)
    navigate('/certificate', {
      state: {
        name,
        qualification: a.examTitle ?? 'GARA 자격검정',
        certNo,
        issueDate: fmtDate(a.submittedAt),
        scoreText: `${a.totalCorrect} / ${a.totalQuestions}`,
      },
    })
  }

  if (!isFullUser) {
    return (
      <div className="exam-center">
        <HomeLink />
        <div className="exam-card" style={{ textAlign: 'center', maxWidth: 420 }}>
          <div className="exam-ico">🔒</div>
          <h2 className="exam-title">{t('my.login_required')}</h2>
          <p className="exam-sub">{t('my.login_required_sub')}</p>
          <button className="exam-btn" style={{ marginTop: 16 }} onClick={() => loginWithGoogle()}>
            {t('common.login_google')}
          </button>
        </div>
      </div>
    )
  }

  const attempts = list ?? []
  const earned = attempts.filter((a) => a.passed === true)
  const loading = !err && list === null

  return (
    <div className="wrap mypage">
      <HomeLink />
      <div className="mypage-head">
        <h1>{t('my.title')}</h1>
        <p className="mypage-sub">{t('my.greeting', { name })}</p>
      </div>

      <div className="mypage-tabs">
        {TABS.map((tb) => (
          <Link key={tb.key} to={tb.to} className={tab === tb.key ? 'on' : ''}>
            <span>{tb.icon}</span> {t(tb.label)}
          </Link>
        ))}
      </div>

      {err && <div className="exam-card" style={{ textAlign: 'center' }}>{err}</div>}
      {loading && <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 30 }}>{t('common.loading')}</div>}

      {!loading && !err && tab === 'attempts' && (
        attempts.length === 0 ? (
          <div className="mypage-empty">
            {t('my.empty_attempts')}
            <button className="exam-btn" style={{ marginTop: 14 }} onClick={() => navigate('/exam')}>
              {t('my.take_exam')}
            </button>
          </div>
        ) : (
          <div className="my-list">
            {attempts.map((a) => (
              <div key={a.attemptId} className="my-item">
                <div className="my-item-top">
                  <b className="my-item-title">{a.examTitle ?? 'GARA 자격검정'}</b>
                  <span className={`admin-badge st-${a.status}`}>{STATUS[a.status] ? t(STATUS[a.status]) : a.status}</span>
                </div>
                <div className="my-item-meta">{t('my.submitted_prefix')} {fmtDT(a.submittedAt)}</div>
                <div className="my-item-result">
                  {a.status !== 'submitted' ? (
                    <span className="my-pending">{t('my.not_submitted')}</span>
                  ) : !a.released ? (
                    <span className="my-pending">
                      {t('my.grading_pre')}<b>{t('my.grading_days', { d: daysLeft(a.resultReleaseAt) })}</b>{t('my.grading_post', { date: fmtDate(a.resultReleaseAt) })}
                    </span>
                  ) : (
                    <span className="my-pending">{t('my.released')}</span>
                  )}
                </div>
                {a.released && (
                  <div className="my-item-actions">
                    <button className="exam-btn-ghost sm" onClick={() => navigate(`/exam/result/${a.attemptId}`)}>
                      {t('my.view_score')}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {!loading && !err && tab === 'earned' && (
        earned.length === 0 ? (
          <div className="mypage-empty">{t('my.empty_earned')}</div>
        ) : (
          <div className="my-list">
            {earned.map((a) => (
              <div key={a.attemptId} className="my-item">
                <div className="my-item-top">
                  <b className="my-item-title">{a.examTitle ?? 'GARA 자격검정'}</b>
                  <span className="my-pass ok">{t('my.earned_badge')}</span>
                </div>
                <div className="my-item-meta">
                  {t('my.earned_meta', { date: fmtDate(a.submittedAt), no: certNoOf(a), correct: a.totalCorrect ?? 0, total: a.totalQuestions ?? 0 })}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {!loading && !err && tab === 'issuance' && (
        earned.length === 0 ? (
          <div className="mypage-empty">{t('my.empty_issuance')}</div>
        ) : (
          <div className="my-list">
            {earned.map((a) => {
              const certNo = certNoOf(a)
              const issued = isIssued(certNo)
              return (
                <div key={a.attemptId} className="my-item my-issue-row">
                  <div>
                    <b className="my-item-title">{a.examTitle ?? 'GARA 자격검정'}</b>
                    <div className="my-item-meta">{t('my.cert_no', { no: certNo })}</div>
                  </div>
                  <div className="my-issue-right">
                    <span className={`admin-badge ${issued ? 'st-submitted' : 'st-expired'}`}>
                      {issued ? t('my.issued') : t('my.not_issued')}
                    </span>
                    <button className="exam-btn sm" onClick={() => goCert(a)}>
                      {issued ? t('my.reissue') : t('my.issue')}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}
    </div>
  )
}
