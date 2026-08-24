import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { takePostLogin } from '../lib/postLogin'

// 기본 OAuth 콜백 경로. 대부분의 로그인은 결과 페이지로 직접 리다이렉트되지만,
// 그 외 진입점을 위한 폴백. supabase-js가 URL의 토큰을 자동 파싱한다.
export default function AuthCallback() {
  const navigate = useNavigate()
  const { t } = useT()
  const movedRef = useRef(false)
  useEffect(() => {
    // 복귀 경로 결정.
    //   ⚠️ Supabase 는 redirect_to 의 query(?next=)를 OAuth 왕복 중 유실시킨다(알려진 동작) → 홈으로 폴백.
    //   그래서 복귀 경로는 로그인 직전 저장해 두고 여기서 읽는다(query 는 폴백).
    //   심고 꺼내는 곳은 lib/postLogin 하나다 — 예전엔 심는 쪽(sessionStorage)과 홈 폴백(localStorage)이
    //   서로 다른 저장소를 봐서, 로그인이 홈으로 떨어지면 되돌려 보내는 안전망이 아예 안 돌았다.
    // ⛔ **이 화면은 딱 한 번만 이동해야 한다.** 로그인이 성공하면 아래 두 신호가 **둘 다** 온다
    //    (SIGNED_IN 이벤트 · getSession 완료). 막지 않으면 첫 번째가 복귀 주소로 보내면서 표식을
    //    써버리고, 곧이어 두 번째가 "표식이 없네" 하고 **홈으로 덮어쓴다** — 로그인하면 항상
    //    메인으로 떨어지던 원인이 이것이다(2026-08-24 재현·수정). 표식을 지우지 않고 두는 것으로는
    //    못 고친다 — 그러면 다음에 홈에 갈 때마다 같은 곳으로 끌려간다.
    // ⚠️ 빗장은 **이펙트 밖(ref)** 이어야 한다. 이펙트 안에 `let` 으로 두면 StrictMode 가 이펙트를
    //    두 번 돌릴 때 빗장도 두 개가 되어(각자 자기 것만 본다) 그대로 두 번 이동한다 — 실제로
    //    그렇게 만들었다가 재현 테스트가 여전히 홈으로 끝났다.
    const go = () => {
      if (movedRef.current) return
      movedRef.current = true
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
