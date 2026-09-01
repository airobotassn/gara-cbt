import { useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'

// 최초 로그인 직후 **약관 동의** 화면. 전 경로 게이트(App.tsx TermsGate)가 여기로 보낸다.
//
// 왜 필요한가: 만 14세 미만 아동의 개인정보는 법정대리인 동의 없이 처리할 수 없다(개인정보보호법 §22-2).
//   우리는 구글 로그인 하나뿐이라 나이를 알 방법이 없어서, **가입 연령을 본인이 확인**하는 체크 한 줄로 받는다.
//
// ⛔ **이 화면을 로그인 전으로 옮기지 말 것.** 두 가지가 걸린다:
//    ① 동의는 "누가 언제" 가 계정에 남아야 하는데 로그인 전에는 계정이 없다. 브라우저에 저장하면
//       그 기기에만 남아서, 다른 기기로 로그인하면 동의 기록이 사라진다.
//    ② 이미 세션이 있는 기존 회원은 로그인 버튼을 아예 안 거친다 — 그들에게 받으려면 어차피 여기가 필요하다.
//    → 로그인 전에 두면 이 게이트를 없애는 게 아니라 하나 더 얹는 것이고, 신규 회원은 두 번 동의하게 된다.
//    (진입점이 흩어져 있다는 건 이유가 아니다 — 버튼은 여럿이어도 전부 `loginWithGoogle()` 하나를 부른다.)
//    로그인 화면에는 **고지 한 줄**(`login.age_notice`)만 둔다.
// ⛔ **동의를 안 했다고 계정을 지우지 않는다.** 실수로 나간 사람과, 결제·자격증 이력이 있는 기존 회원이
//    다친다(결제 원장은 법정 보존 대상이다). 동의 전에는 서비스를 못 쓰는 것으로 충분하다.
// ⚠️ **나가는 문(로그아웃)이 반드시 있어야 한다.** 이 게이트는 전 경로를 막으므로, 없으면 동의하지 않은
//    사람이 로그인한 채로 아무 데도 못 가고 갇힌다.
// ⚠️ 문장 안에 링크를 끼우지 않는다 — 어순이 언어마다 달라 번역이 불가능해진다. 문서 링크는 아래 따로 선다.
export default function TermsAgree() {
  const { t } = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const { isFullUser, loading, onboardingLoading, needsTerms, markTermsDone, logout } = useAuth()

  const [checked, setChecked] = useState(false)
  // 광고·마케팅 수신(선택). ⛔ 기본값을 true 로 두지 말 것 — 미리 체크된 항목은 명시적 동의가 아니다.
  const [marketing, setMarketing] = useState(false)
  const [busy, setBusy] = useState(false)

  // 원래 가려던 목적지(내부 경로만 — 오픈 리다이렉트 방지).
  const nextDest = useMemo(() => {
    const q = new URLSearchParams(location.search).get('next')
    const safe = (p: string | null | undefined) => (p && p.startsWith('/') && !p.startsWith('//') ? p : null)
    return safe(q) || '/'
  }, [location.search])

  const [error, setError] = useState('')

  async function agree() {
    if (!checked || busy) return
    setBusy(true)
    setError('')
    try {
      // ⛔ 동의 시각은 **엣지 함수가 찍는다.** profiles 의 그 컬럼은 service role 전용이라
      //    브라우저가 직접 쓸 수 없다 — 열어주면 체크를 안 하고도 통과시킬 수 있다.
      await callFunction('agree-terms', { marketing })
      markTermsDone()
      navigate(nextDest, { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'))
      setBusy(false)
    }
  }

  async function leave() {
    if (busy) return
    setBusy(true)
    await logout()
    navigate('/', { replace: true })
  }

  if (loading || onboardingLoading) return null
  if (!isFullUser) return <Navigate to="/login" replace />
  // 이미 동의한 사람이 URL 로 들어오면 목적지로 돌려보낸다.
  if (!needsTerms) return <Navigate to={nextDest} replace />

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-surface text-on-surface p-6">
      <div className="w-full max-w-md bg-surface-container rounded-3xl border border-outline-variant/60 p-8 shadow-sm">
        <h1 className="text-3xl font-black tracking-tight leading-tight break-keep">{t('terms.gate_title')}</h1>
        <p className="mt-4 text-lg leading-relaxed text-on-surface-variant break-keep">{t('terms.gate_body')}</p>

        <label className="mt-7 flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1 w-5 h-5 flex-none accent-primary"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <span className="text-base leading-relaxed break-keep">{t('terms.gate_check')}</span>
        </label>

        {/* 광고·마케팅 수신 — **선택**이다. 정보통신망법 §50 은 광고성 정보에 명시적 사전 동의를 요구하는데,
            동의를 서비스 이용의 조건으로 걸 수는 없다. 그래서 체크를 안 해도 아래 버튼이 눌린다.
            ⛔ 위 필수 체크와 한 줄로 합치지 말 것 — 합치는 순간 "광고에 동의해야 서비스를 쓴다"가 되어 위법이다. */}
        <label className="mt-4 flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1 w-5 h-5 flex-none accent-primary"
            checked={marketing}
            onChange={(e) => setMarketing(e.target.checked)}
          />
          <span className="text-base leading-relaxed break-keep">{t('terms.gate_marketing')}</span>
        </label>

        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-base text-on-surface-variant underline underline-offset-4">
          {/* ⚠️ 새 탭으로 연다 — 같은 탭에서 열면 체크 상태가 날아가고 돌아올 길도 없다. */}
          <Link to="/terms" target="_blank" rel="noreferrer">{t('terms.gate_view_terms')}</Link>
          <Link to="/privacy" target="_blank" rel="noreferrer">{t('terms.gate_view_privacy')}</Link>
        </div>

        {error && <p className="mt-4 text-base text-error break-keep">{error}</p>}

        <button
          type="button"
          className="mt-7 w-full rounded-xl bg-primary text-on-primary text-lg font-bold py-4 disabled:opacity-50"
          onClick={agree}
          disabled={!checked || busy}
        >
          {t('terms.gate_agree')}
        </button>
        <button
          type="button"
          className="mt-3 w-full rounded-xl border border-outline-variant text-lg font-medium py-3.5 text-on-surface-variant disabled:opacity-50"
          onClick={leave}
          disabled={busy}
        >
          {t('terms.gate_logout')}
        </button>
      </div>
    </div>
  )
}
