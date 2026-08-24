import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { takePostLogin } from '../lib/postLogin'

// 기본 OAuth 콜백 경로. 대부분의 로그인은 결과 페이지로 직접 리다이렉트되지만,
// 그 외 진입점을 위한 폴백. supabase-js가 URL의 토큰을 자동 파싱한다.
export default function AuthCallback() {
  const navigate = useNavigate()
  const { t } = useT()
  useEffect(() => {
    // 복귀 경로 결정.
    //   ⚠️ Supabase 는 redirect_to 의 query(?next=)를 OAuth 왕복 중 유실시킨다(알려진 동작) → 홈으로 폴백.
    //   그래서 복귀 경로는 로그인 직전 저장해 두고 여기서 읽는다(query 는 폴백).
    //   심고 꺼내는 곳은 lib/postLogin 하나다 — 예전엔 심는 쪽(sessionStorage)과 홈 폴백(localStorage)이
    //   서로 다른 저장소를 봐서, 로그인이 홈으로 떨어지면 되돌려 보내는 안전망이 아예 안 돌았다.
    const go = () => {
      let next = takePostLogin()
      if (!next) next = new URLSearchParams(window.location.search).get('next')
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
