import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import { SEB_REQUIRED, isSEB } from '../lib/seb'
import { DEFAULT_EXAM_SLUG } from '../lib/testConfig'
import type { StartExamResponse } from '../lib/types'
import { useT } from '../lib/i18n'

// SEB 진입점(.seb 의 startURL = /exam/seb). SEB 는 새 브라우저 프로필이라 세션이 없다.
// [본인인증 개발중] 구글 로그인 대신 "본인인증수단 개발중" 안내 → 확인 시 익명 세션 확보 후 start-exam → /exam/run.
//   · 본인인증 수단 도입 시 begin() 의 ensureAnonymous 를 실제 인증 플로우로 교체하고 start-exam 익명 차단 복원.
export default function SebStart() {
  const navigate = useNavigate()
  const { ensureAnonymous } = useAuth()
  const { t } = useT()
  const [err, setErr] = useState('')
  const [starting, setStarting] = useState(false)
  const started = useRef(false)

  // SEB 밖에서 이 URL 로 직접 들어오면 우회 방지(운영). dev 는 통과(테스트용).
  useEffect(() => {
    if (SEB_REQUIRED && !isSEB()) navigate('/exam', { replace: true })
  }, [navigate])

  async function begin() {
    if (started.current) return
    started.current = true
    setStarting(true)
    setErr('')
    try {
      // 본인인증 개발 전까지 익명 세션으로 대체(이미 세션 있으면 유지). 실제 인증 도입 시 이 줄 교체.
      await ensureAnonymous()
      await document.documentElement.requestFullscreen?.().catch(() => {})
      const res = await callFunction<StartExamResponse>('start-exam', { examSlug: DEFAULT_EXAM_SLUG })
      navigate(`/exam/run/${res.attemptId}`, { state: res, replace: true })
    } catch (e) {
      started.current = false
      setStarting(false)
      setErr(e instanceof Error ? e.message : t('prep.err_start'))
    }
  }

  return (
    <div className="exam-center">
      <div style={{ textAlign: 'center', maxWidth: 460, margin: '0 auto', padding: 24 }}>
        {err ? (
          <>
            <p className="prep-warn" style={{ marginBottom: 16 }}>{err}</p>
            <button className="exam-btn" onClick={begin}>{t('seb.entry_retry')}</button>
          </>
        ) : starting ? (
          <p className="font-body-lg text-body-lg text-on-surface-variant animate-pulse">{t('seb.entry_loading')}</p>
        ) : (
          <>
            <div style={{ fontSize: 42, marginBottom: 14 }}>🪪</div>
            <h2 className="font-title-md text-title-md font-bold text-on-surface" style={{ marginBottom: 10 }}>
              [본인인증수단 개발중]
            </h2>
            <p className="font-body-md text-body-md text-on-surface-variant" style={{ marginBottom: 22, lineHeight: 1.65 }}>
              현재 본인인증 수단을 준비 중입니다.<br />
              아래 <b>확인</b>을 누르면 시험을 시작합니다.
            </p>
            <button className="exam-btn" onClick={begin}>확인</button>
          </>
        )}
      </div>
    </div>
  )
}
