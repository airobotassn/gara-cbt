import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { callFunction } from '../lib/supabase'
import { useAuth } from '../context/AuthProvider'
import { PASS_RATIO } from '../lib/testConfig'
import type { ExamResultResponse, SubmitExamResponse } from '../lib/types'

function fmtDate(iso?: string | null) {
  if (!iso) return '-'
  const d = new Date(iso)
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function daysLeft(iso?: string | null) {
  if (!iso) return 0
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000))
}

export default function ExamResult() {
  const { attemptId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const justSubmitted = location.state as SubmitExamResponse | null
  const { user } = useAuth()

  const [data, setData] = useState<ExamResultResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    callFunction<ExamResultResponse>('get-exam-result', { attemptId })
      .then((r) => alive && setData(r))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : '결과를 불러올 수 없습니다.'))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [attemptId])

  // 무효 제출
  if (justSubmitted?.voided) {
    return (
      <div className="exam-center">
        <div className="exam-card" style={{ textAlign: 'center', maxWidth: 480 }}>
          <div className="exam-ico">🚫</div>
          <h2 className="exam-title">응시가 무효 처리되었습니다</h2>
          <p className="exam-sub">관리자에게 문의해 주세요.</p>
          <button className="exam-btn-ghost" style={{ marginTop: 18 }} onClick={() => navigate('/')}>
            홈으로
          </button>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="exam-center">
        <div className="exam-card" style={{ textAlign: 'center' }}>결과를 불러오는 중…</div>
      </div>
    )
  }

  if (err || !data) {
    return (
      <div className="exam-center">
        <div className="exam-card" style={{ textAlign: 'center', maxWidth: 480 }}>
          <div className="exam-ico">⚠️</div>
          <h2 className="exam-title">결과를 불러올 수 없습니다</h2>
          <p className="exam-sub">{err}</p>
          <button className="exam-btn-ghost" style={{ marginTop: 18 }} onClick={() => navigate('/')}>
            홈으로
          </button>
        </div>
      </div>
    )
  }

  // 채점 공개 전
  if (!data.released) {
    return (
      <div className="exam-center">
        <div className="exam-card" style={{ textAlign: 'center', maxWidth: 520 }}>
          <div className="exam-ico">✅</div>
          <h2 className="exam-title">제출이 완료되었습니다</h2>
          <p className="exam-sub">
            총 {data.totalQuestions}문항 응시 답안이 정상 접수되었습니다.
          </p>
          <div className="exam-release">
            <div className="exam-release-row">
              <span>제출 일시</span>
              <b>{fmtDate(data.submittedAt)}</b>
            </div>
            <div className="exam-release-row hi">
              <span>채점 결과 공개</span>
              <b>{fmtDate(data.resultReleaseAt)}</b>
            </div>
            <p className="exam-release-note">
              채점 결과는 <b>{daysLeft(data.resultReleaseAt)}일 후</b> 이 화면에서 확인할 수 있습니다.
            </p>
          </div>
          <button className="exam-btn-ghost" style={{ marginTop: 20 }} onClick={() => navigate('/')}>
            홈으로
          </button>
        </div>
      </div>
    )
  }

  // 채점 공개 후
  const wrong = data.answers.filter((a) => !a.isCorrect)
  const passed = data.totalCorrect >= Math.ceil(data.totalQuestions * PASS_RATIO)
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>
  const certName =
    (meta.full_name as string) || (meta.name as string) || user?.email?.split('@')[0] || '응시자'
  const certNo = `GARA-2026-${String(attemptId ?? '').replace(/-/g, '').slice(0, 6).toUpperCase() || '000001'}`
  const issueDate = (() => {
    const d = new Date()
    return `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}`
  })()
  const scoreText = `${data.totalCorrect} / ${data.totalQuestions}`
  function goCertificate() {
    navigate('/certificate', {
      state: { name: certName, qualification: 'GARA 자격검정', certNo, issueDate, scoreText },
    })
  }
  return (
    <div className="exam-center">
      <div className="exam-card" style={{ maxWidth: 720, width: '100%' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="exam-ico">🏆</div>
          <h2 className="exam-title">채점 결과</h2>
          <div className="exam-score">
            <b>{data.totalCorrect}</b>
            <span> / {data.totalQuestions}</span>
          </div>
          <p className="exam-sub">제출 {fmtDate(data.submittedAt)}</p>
          <div className={`exam-pass ${passed ? 'ok' : 'no'}`}>{passed ? '합 격' : '불합격'}</div>
        </div>

        <div className="exam-review">
          <h3>문항별 결과 ({wrong.length}개 오답)</h3>
          <div className="exam-review-list">
            {data.answers.map((a) => (
              <div key={a.number} className={`exam-review-item ${a.isCorrect ? 'ok' : 'no'}`}>
                <div className="exam-review-top">
                  <span className="exam-review-no">{a.number}</span>
                  <span className="exam-review-mark">{a.isCorrect ? '○ 정답' : '✕ 오답'}</span>
                  {a.subject && <span className="exam-review-cat">{a.subject}</span>}
                </div>
                <div className="exam-review-q">{a.prompt}</div>
                <div className="exam-review-ans">
                  <span>내 답: {a.selectedIndex === null ? '미응답' : a.selectedIndex + 1}번</span>
                  <span className="correct">정답: {a.correctIndex + 1}번</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: 18, display: 'flex', gap: 10, justifyContent: 'center' }}>
          {passed && (
            <button className="exam-btn" onClick={goCertificate}>
              📜 자격증 발급 (PDF)
            </button>
          )}
          <button className="exam-btn-ghost" onClick={() => navigate('/')}>
            홈으로
          </button>
        </div>
      </div>
    </div>
  )
}
