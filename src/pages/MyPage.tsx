import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
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

// ?demo 미리보기용 — 합격 / 불합격 / 공개전 카드
function makeDummy(): MyAttempt[] {
  const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString()
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
  const demo = new URLSearchParams(location.search).has('demo')
  const { isFullUser, loginWithGoogle, user } = useAuth()
  const [list, setList] = useState<MyAttempt[] | null>(null)
  const [err, setErr] = useState('')

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

  function goCert(a: MyAttempt) {
    const certNo = `GARA-2026-${a.attemptId.replace(/-/g, '').slice(0, 6).toUpperCase()}`
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

  return (
    <div className="wrap mypage">
      <HomeLink />
      <div className="mypage-head">
        <h1>마이페이지</h1>
        <p className="mypage-sub">{name} 님</p>
      </div>

      <h2 className="mypage-h2">응시 내역</h2>

      {err && <div className="exam-card" style={{ textAlign: 'center' }}>{err}</div>}
      {!err && list === null && (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 30 }}>불러오는 중…</div>
      )}
      {!err && list && list.length === 0 && (
        <div className="mypage-empty">
          아직 응시 내역이 없습니다.
          <button className="exam-btn" style={{ marginTop: 14 }} onClick={() => navigate('/exam')}>
            자격검정 응시하기
          </button>
        </div>
      )}

      <div className="my-list">
        {list?.map((a) => (
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
                  채점 결과는 <b>{daysLeft(a.resultReleaseAt)}일 후</b>({fmtDate(a.resultReleaseAt)}) 공개됩니다.
                </span>
              ) : (
                <span className="my-score">
                  <b>{a.totalCorrect}</b> / {a.totalQuestions}
                  <span className={`my-pass ${a.passed ? 'ok' : 'no'}`}>{a.passed ? '합격' : '불합격'}</span>
                </span>
              )}
            </div>

            <div className="my-item-actions">
              {a.status === 'submitted' && (
                <button className="exam-btn-ghost sm" onClick={() => navigate(`/exam/result/${a.attemptId}`)}>
                  결과 보기
                </button>
              )}
              {a.released && a.passed && (
                <button className="exam-btn sm" onClick={() => goCert(a)}>
                  📜 자격증
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
