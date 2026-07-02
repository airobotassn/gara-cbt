import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { isSEB } from '../lib/seb'

// 응시 종료 후 "끝났다"는 확실한 마무리 화면. SEB 안에서도 보이도록 quitURL(/exam/done)과 분리한 별도 경로다.
// SEB: 이 화면을 보여준 뒤 버튼/자동 카운트다운으로 /exam/done 으로 이동 → SEB 가 그 URL 에서 자동 종료.
// 일반 브라우저(모의·개발): 응시 현황/홈 버튼 제공.
type Mode = 'submitted' | 'voided' | 'practice'
interface CompleteState {
  mode?: Mode
  seb?: boolean
}

// SEB 자동 종료 대기(초) — 완료 화면을 충분히 읽을 시간을 준 뒤 종료 URL 로 이동.
const AUTO_CLOSE_SEC = 8

export default function ExamComplete() {
  const { t } = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const st = (location.state as CompleteState | null) ?? {}
  const mode: Mode = st.mode ?? 'submitted'
  const seb = st.seb ?? isSEB()

  const quitSeb = () => {
    window.location.href = `${window.location.origin}/exam/done` // SEB 종료 URL
  }

  // SEB: 응시자가 버튼을 안 눌러도 갇히지 않도록 일정 시간 후 자동 종료
  const [left, setLeft] = useState(AUTO_CLOSE_SEC)
  useEffect(() => {
    if (!seb) return
    const id = window.setInterval(() => {
      setLeft((n) => {
        if (n <= 1) {
          window.clearInterval(id)
          window.location.href = `${window.location.origin}/exam/done`
          return 0
        }
        return n - 1
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [seb])

  const voided = mode === 'voided'
  const title = voided
    ? t('complete.voided_title')
    : mode === 'practice'
      ? t('complete.practice_title')
      : t('complete.title')
  const sub = voided
    ? t('complete.voided_sub')
    : mode === 'practice'
      ? t('complete.practice_sub')
      : t('complete.sub')

  return (
    <div className="exam-center">
      <div className="exam-card" style={{ textAlign: 'center', maxWidth: 460 }}>
        <div className="exam-ico">{voided ? '🚫' : '✅'}</div>
        <h2 className="exam-title" style={voided ? { color: 'var(--danger-fg, #ba1a1a)' } : undefined}>
          {title}
        </h2>
        <p className="exam-sub" style={{ whiteSpace: 'pre-line' }}>
          {sub}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
          {seb ? (
            <button className="exam-btn" onClick={quitSeb}>
              {t('complete.close_seb')}
            </button>
          ) : mode === 'practice' ? (
            <>
              <button className="exam-btn" onClick={() => navigate('/exam')}>
                {t('run.to_exam')}
              </button>
              <button className="exam-btn-ghost" onClick={() => navigate('/')}>
                {t('complete.home')}
              </button>
            </>
          ) : (
            <>
              <button className="exam-btn" onClick={() => navigate('/exam/check')}>
                {t('complete.to_check')}
              </button>
              <button className="exam-btn-ghost" onClick={() => navigate('/')}>
                {t('complete.home')}
              </button>
            </>
          )}
        </div>
        {seb && (
          <p className="exam-sub" style={{ marginTop: 14, fontSize: 'var(--fs-sm)', opacity: 0.75 }}>
            {t('complete.auto_close', { n: left })}
          </p>
        )}
      </div>
    </div>
  )
}
