import { useMemo, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { useAuth } from '../context/AuthProvider'
import { supabase } from '../lib/supabase'
import { RETENTION_DAYS, daysLeftOf, purgeDateOf } from '../lib/withdrawal'

// 탈퇴 신청된 계정으로 로그인했을 때 뜨는 화면. 전 경로 게이트(App.tsx WithdrawnGate)가 여기로 보낸다.
//
// ⛔ **로그인만으로 조용히 복구하지 않는다(2026-08-25 결정).** 탈퇴는 사람이 눌러서 한 것이니
//    되돌리는 것도 눌러야 한다 — 실수로 로그인했다가 되살아나면 탈퇴한 적이 없는 것과 같다.
//    실제로 옛 코드가 SIGNED_IN 에서 조용히 UPDATE 를 쏘려 했는데 그 조건이 구글 로그인 복귀에선
//    거짓이라 한 번도 안 나갔고, 탈퇴 상태로 서비스를 계속 쓴 계정이 남았다.
//
// ⚠️ 남은 보관일수를 **반드시 보여준다.** "복구할래요?" 만 물으면 안 누르고 나간 사람이
//    언제까지 되돌릴 수 있는지 알 방법이 없다.
export default function AccountRestore() {
  const { t } = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const { isFullUser, loading, onboardingLoading, deactivatedAt, markRestored, logout } = useAuth()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // 원래 가려던 목적지(내부 경로만 — 오픈 리다이렉트 방지). NicknameSetup 과 같은 규칙.
  const nextDest = useMemo(() => {
    const q = new URLSearchParams(location.search).get('next')
    const safe = (p: string | null | undefined) => (p && p.startsWith('/') && !p.startsWith('//') ? p : null)
    return safe(q) || '/'
  }, [location.search])

  const info = useMemo(() => {
    if (!deactivatedAt) return null
    return {
      days: Math.max(0, daysLeftOf(deactivatedAt)),
      date: purgeDateOf(deactivatedAt).toLocaleDateString(),
    }
  }, [deactivatedAt])

  async function restore() {
    if (busy) return
    setBusy(true)
    setError('')
    // 판정·닉네임 충돌 처리는 전부 RPC 안에 있다(restore_account). 화면은 결과만 받는다.
    const { data, error: err } = await supabase.rpc('restore_account')
    if (err) {
      setError(t('withdraw.restore_failed'))
      setBusy(false)
      return
    }
    // 탈퇴한 사이 닉네임을 남이 가져갔으면 RPC 가 그것만 놓아주고 계정을 살린다 →
    // markRestored 가 닉네임 게이트를 다시 켜서 곧바로 닉네임 화면이 이어진다.
    const nicknameReset = !!(data as { nicknameReset?: boolean } | null)?.nicknameReset
    markRestored(nicknameReset)
    navigate(nextDest, { replace: true })
  }

  async function leave() {
    await logout()
    navigate('/', { replace: true })
  }

  if (loading || onboardingLoading) return null
  if (!isFullUser) return <Navigate to="/login" replace />
  // 탈퇴 상태가 아닌 사람이 URL 로 들어오면 목적지로 돌려보낸다.
  if (!deactivatedAt) return <Navigate to={nextDest} replace />

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-surface text-on-surface p-6">
      <div className="w-full max-w-md bg-surface-container rounded-3xl border border-outline-variant/60 p-8 shadow-sm">
        <h1 className="text-3xl font-black tracking-tight leading-tight break-keep">{t('withdraw.gate_title')}</h1>
        <p className="mt-4 text-lg leading-relaxed text-on-surface-variant break-keep">
          {t('withdraw.gate_body', { d: RETENTION_DAYS })}
        </p>

        {info && (
          <div className="mt-6 rounded-2xl border border-outline-variant bg-surface px-5 py-4">
            <p className="text-lg font-bold text-error break-keep">
              {t('withdraw.gate_left', { n: info.days })}
            </p>
            <p className="mt-1 text-base text-on-surface-variant break-keep">
              {t('withdraw.gate_purge_on', { date: info.date })}
            </p>
          </div>
        )}

        {error && <p className="mt-4 text-base text-error break-keep">{error}</p>}

        <button
          type="button"
          className="mt-6 w-full rounded-xl bg-primary text-on-primary text-lg font-bold py-4 disabled:opacity-50"
          onClick={restore}
          disabled={busy}
        >
          {busy ? t('withdraw.restoring') : t('withdraw.gate_restore')}
        </button>
        <button
          type="button"
          className="mt-3 w-full rounded-xl border border-outline-variant text-lg font-medium py-3.5 text-on-surface-variant disabled:opacity-50"
          onClick={leave}
          disabled={busy}
        >
          {t('withdraw.gate_logout')}
        </button>
      </div>
    </div>
  )
}
