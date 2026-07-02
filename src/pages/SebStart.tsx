import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import { SEB_REQUIRED, isSEB } from '../lib/seb'
import { DEFAULT_EXAM_SLUG } from '../lib/testConfig'
import type { StartExamResponse } from '../lib/types'
import { useT } from '../lib/i18n'

// SEB 진입점(.seb 의 startURL = /exam/seb). SEB 는 새 브라우저 프로필이라 세션이 없다 →
// (미로그인) 구글 로그인(나중엔 본인인증) → 로그인되면 start-exam → /exam/run 직행. 게이트·prepare 스킵.
// 결제한 시험 확인(entitlement)은 백엔드 준비 후 여기 or start-exam 서버에 붙일 훅 자리.
export default function SebStart() {
  const navigate = useNavigate()
  const { isFullUser, loginWithGoogle, loading } = useAuth()
  const { t } = useT()
  const [err, setErr] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (loading) return // 세션 복원 대기 — 이거 없으면 로그인 직후에도 미로그인으로 오판해 루프
    if (started.current) return

    // SEB 밖에서 이 URL 로 들어오면(직접 접근) 우회 방지 — 운영에선 게이트로 되돌림. dev 는 통과(테스트용).
    if (SEB_REQUIRED && !isSEB()) {
      navigate('/exam', { replace: true })
      return
    }

    // 미로그인 → 구글 로그인. OAuth 는 Supabase Site URL(=메인)로 떨어지므로,
    // 메인(Landing)이 이 표식을 보고 /exam/seb 로 되돌려 이 화면이 재실행되게 한다.
    if (!isFullUser) {
      localStorage.setItem('postLoginRedirect', '/exam/seb')
      loginWithGoogle(`${window.location.origin}/auth/callback?next=${encodeURIComponent('/exam/seb')}`)
      return
    }

    // 로그인됨 → 시험 시작 (start-exam 서버가 토큰으로 신원 검증. 결제 확인 훅은 서버에)
    started.current = true
    ;(async () => {
      try {
        await document.documentElement.requestFullscreen?.().catch(() => {})
        const res = await callFunction<StartExamResponse>('start-exam', { examSlug: DEFAULT_EXAM_SLUG })
        navigate(`/exam/run/${res.attemptId}`, { state: res, replace: true })
      } catch (e) {
        setErr(e instanceof Error ? e.message : t('prep.err_start'))
      }
    })()
  }, [loading, isFullUser, loginWithGoogle, navigate, t])

  return (
    <div className="exam-center">
      <div style={{ textAlign: 'center' }}>
        {err ? (
          <>
            <p className="prep-warn" style={{ marginBottom: 16 }}>{err}</p>
            <button className="exam-btn" onClick={() => window.location.reload()}>{t('seb.entry_retry')}</button>
          </>
        ) : (
          <p className="font-body-lg text-body-lg text-on-surface-variant animate-pulse">{t('seb.entry_loading')}</p>
        )}
      </div>
    </div>
  )
}
