import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'

// 기본 OAuth 콜백 경로. 대부분의 로그인은 결과 페이지로 직접 리다이렉트되지만,
// 그 외 진입점을 위한 폴백. supabase-js가 URL의 토큰을 자동 파싱한다.
export default function AuthCallback() {
  const navigate = useNavigate()
  const { t } = useT()
  useEffect(() => {
    // 복귀 경로를 콜백 URL(?next=)에서 읽음 — OAuth 왕복에도 안 날아감. 시험 로그인은 next=/exam/prepare.
    const go = () => {
      const next = new URLSearchParams(window.location.search).get('next')
      navigate(next || '/', { replace: true })
    }
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') go()
    })
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) go()
    })
    return () => sub.subscription.unsubscribe()
  }, [navigate])

  return (
    <div className="wrap">
      <div className="card pad" style={{ textAlign: 'center', color: 'var(--muted)' }}>
        {t('auth.processing')}
      </div>
    </div>
  )
}
