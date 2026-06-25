import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import HomeLink from '../components/HomeLink'
import type { MyAttempt } from '../lib/types'

const STATUS: Record<string, string> = {
  in_progress: '응시 중',
  submitted: '제출 완료',
  voided: '무효',
  expired: '만료',
}
const TABS = [
  { key: 'attempts', label: '시험 응시 현황', icon: '📝', to: '/mypage' },
  { key: 'earned', label: '자격 취득 현황', icon: '🏅', to: '/mypage/earned' },
  { key: 'issuance', label: '자격증 발급 현황', icon: '📜', to: '/mypage/issuance' },
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
function makeDummy(): MyAttempt[] {
  const iso = (d: number) => new Date(Date.now() - d * 86400000).toISOString()
  const future = new Date(Date.now() + 5 * 86400000).toISOString()
  return [
    { attemptId: 'demo-pass', examTitle: 'GARA 자격검정', status: 'submitted', startedAt: iso(8), submittedAt: iso(8), resultReleaseAt: iso(1), released: true, totalCorrect: 4, totalQuestions: 5, passed: true },
    { attemptId: 'demo-fail', examTitle: 'GARA 자격검정', status: 'submitted', startedAt: iso(8), submittedAt: iso(8), resultReleaseAt: iso(1), released: true, totalCorrect: 1, totalQuestions: 5, passed: false },
    { attemptId: 'demo-pending', examTitle: 'GARA 자격검정', status: 'submitted', startedAt: iso(2), submittedAt: iso(2), resultReleaseAt: future, released: false, totalCorrect: null, totalQuestions: 5, passed: null },
  ]
}

export default function MyPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { section } = useParams()
  const tab = section && TABS.some((t) => t.key === section) ? section : 'attempts'
  const demoQS = new URLSearchParams(location.search).has('demo') ? '?demo' : ''
  const demo = demoQS !== ''

  const { isFullUser, loginWithGoogle, user } = useAuth()
  const [list, setList] = useState<MyAttempt[] | null>(null)
  const [err, setErr] = useState('')
  const [, setTick] = useState(0)

  useEffect(() => {
    if (demo) {
      setList(makeDummy())
      return
    }
    if (!isFullUser) return
    callFunction<{ attempts: MyAttempt[] }>('my-attempts', {})
      .then((r) => setList(r.attempts))
      .catch((e) => setErr(e instanceof Error ? e.message : '내역을 불러올 수 없습니다.'))
  }, [isFullUser, demo])

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

  if (!isFullUser && !demo) {
    return (
      <div className="exam-center">
        <HomeLink />
        <div className="exam-card" style={{ textAlign: 'center', maxWidth: 420 }}>
          <div className="exam-ico">🔒</div>
          <h2 className="exam-title">로그인이 필요합니다</h2>
          <p className="exam-sub">마이페이지는 로그인 후 이용할 수 있습니다.</p>
          <button className="exam-btn" style={{ marginTop: 16 }} onClick={() => loginWithGoogle()}>
            구글로 로그인
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
        <h1>마이페이지</h1>
        <p className="mypage-sub">{name} 님</p>
      </div>

      <div className="mypage-tabs">
        {TABS.map((t) => (
          <Link key={t.key} to={`${t.to}${demoQS}`} className={tab === t.key ? 'on' : ''}>
            <span>{t.icon}</span> {t.label}
          </Link>
        ))}
      </div>

      {err && <div className="exam-card" style={{ textAlign: 'center' }}>{err}</div>}
      {loading && <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 30 }}>불러오는 중…</div>}

      {!loading && !err && tab === 'attempts' && (
        attempts.length === 0 ? (
          <div className="mypage-empty">
            아직 응시 내역이 없습니다.
            <button className="exam-btn" style={{ marginTop: 14 }} onClick={() => navigate('/exam')}>
              자격검정 응시하기
            </button>
          </div>
        ) : (
          <div className="my-list">
            {attempts.map((a) => (
              <div key={a.attemptId} className="my-item">
                <div className="my-item-top">
                  <b className="my-item-title">{a.examTitle ?? 'GARA 자격검정'}</b>
                  <span className={`admin-badge st-${a.status}`}>{STATUS[a.status] ?? a.status}</span>
                </div>
                <div className="my-item-meta">제출 {fmtDT(a.submittedAt)}</div>
                <div className="my-item-result">
                  {a.status !== 'submitted' ? (
                    <span className="my-pending">제출되지 않은 응시입니다.</span>
                  ) : !a.released ? (
                    <span className="my-pending">
                      채점 중 · <b>{daysLeft(a.resultReleaseAt)}일 후</b>({fmtDate(a.resultReleaseAt)}) 발표
                    </span>
                  ) : (
                    <span className="my-pending">결과가 발표되었습니다. 성적을 확인하세요.</span>
                  )}
                </div>
                {a.released && (
                  <div className="my-item-actions">
                    <button className="exam-btn-ghost sm" onClick={() => navigate(`/exam/result/${a.attemptId}`)}>
                      성적 확인
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
          <div className="mypage-empty">취득한 자격이 없습니다.</div>
        ) : (
          <div className="my-list">
            {earned.map((a) => (
              <div key={a.attemptId} className="my-item">
                <div className="my-item-top">
                  <b className="my-item-title">{a.examTitle ?? 'GARA 자격검정'}</b>
                  <span className="my-pass ok">취득</span>
                </div>
                <div className="my-item-meta">
                  취득일 {fmtDate(a.submittedAt)} · 자격번호 {certNoOf(a)} · 점수 {a.totalCorrect}/{a.totalQuestions}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {!loading && !err && tab === 'issuance' && (
        earned.length === 0 ? (
          <div className="mypage-empty">발급 가능한 자격증이 없습니다.</div>
        ) : (
          <div className="my-list">
            {earned.map((a) => {
              const certNo = certNoOf(a)
              const issued = isIssued(certNo)
              return (
                <div key={a.attemptId} className="my-item my-issue-row">
                  <div>
                    <b className="my-item-title">{a.examTitle ?? 'GARA 자격검정'}</b>
                    <div className="my-item-meta">자격번호 {certNo}</div>
                  </div>
                  <div className="my-issue-right">
                    <span className={`admin-badge ${issued ? 'st-submitted' : 'st-expired'}`}>
                      {issued ? '발급 완료' : '미발급'}
                    </span>
                    <button className="exam-btn sm" onClick={() => goCert(a)}>
                      {issued ? '다시 발급' : '자격증 발급'}
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
