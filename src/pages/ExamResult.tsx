import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { callFunction } from '../lib/supabase'
import HomeLink from '../components/HomeLink'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'
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
      <div className="exam-center">
        <div className="exam-card" style={{ textAlign: 'center', maxWidth: 480 }}>
          <div className="exam-ico">🚫</div>
          <h2 className="exam-title">{t('result.voided_title')}</h2>
          <p className="exam-sub">{t('result.voided_sub')}</p>
          <button className="exam-btn-ghost" style={{ marginTop: 18 }} onClick={() => navigate('/')}>
            {t('result.home')}
          </button>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="exam-center">
        <div className="exam-card" style={{ textAlign: 'center' }}>{t('result.loading')}</div>
      </div>
    )
  }

  if (err || !data) {
    return (
      <div className="exam-center">
        <div className="exam-card" style={{ textAlign: 'center', maxWidth: 480 }}>
          <div className="exam-ico">⚠️</div>
          <h2 className="exam-title">{t('result.load_failed_title')}</h2>
          <p className="exam-sub">{err}</p>
          <button className="exam-btn-ghost" style={{ marginTop: 18 }} onClick={() => navigate('/')}>
            {t('result.home')}
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
          <h2 className="exam-title">{t('result.submitted_title')}</h2>
          <p className="exam-sub">
            {t('result.submitted_sub', { n: data.totalQuestions })}
          </p>
          <div className="exam-release">
            <div className="exam-release-row">
              <span>{t('result.submitted_at')}</span>
              <b>{fmtDate(data.submittedAt)}</b>
            </div>
            <div className="exam-release-row hi">
              <span>{t('result.release_at')}</span>
              <b>{fmtDate(data.resultReleaseAt)}</b>
            </div>
            <p className="exam-release-note">
              {t('result.release_note_pre')}<b>{t('result.release_days', { d: daysLeft(data.resultReleaseAt) })}</b>{t('result.release_note_post')}
            </p>
          </div>
          <button className="exam-btn-ghost" style={{ marginTop: 20 }} onClick={() => navigate('/')}>
            {t('result.home')}
          </button>
        </div>
      </div>
    )
  }

  // 채점 공개 후
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
    localStorage.setItem(`cert_issued_${certNo}`, new Date().toISOString())
    navigate('/certificate', {
      state: { name: certName, qualification: 'GARA 자격검정', certNo, issueDate, scoreText },
    })
  }
  return (
    <div className="exam-center">
      <HomeLink />
      <div className="exam-card" style={{ maxWidth: 720, width: '100%' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="exam-ico">🏆</div>
          <h2 className="exam-title">{t('result.graded_title')}</h2>
          <div className="exam-score">
            <b>{data.totalCorrect}</b>
            <span> / {data.totalQuestions}</span>
          </div>
          <p className="exam-sub">{t('result.submitted_prefix')} {fmtDate(data.submittedAt)}</p>
          <div className={`exam-pass ${passed ? 'ok' : 'no'}`}>{passed ? t('result.pass') : t('result.fail')}</div>
        </div>

        <div className="exam-result-note">{t('result.pass_criteria')}</div>

        <div style={{ textAlign: 'center', marginTop: 18, display: 'flex', gap: 10, justifyContent: 'center' }}>
          {passed && (
            <button className="exam-btn" onClick={goCertificate}>
              {t('result.issue_cert')}
            </button>
          )}
          <button className="exam-btn-ghost" onClick={() => navigate(-1)}>
            {t('result.back')}
          </button>
        </div>
      </div>
    </div>
  )
}
