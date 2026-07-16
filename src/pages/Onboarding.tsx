import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import { fetchGeoPrefill } from '../lib/geo'
import { REGIONS, countryName, isValidRegion } from '../lib/regions'

// 최초 로그인 온보딩: 지역(국가) 확정 화면. 한 번 확정하면 되돌릴 수 없음(set-region이 잠금).
// 학교는 여기서 받지 않음(마이페이지에서 별도 수정). 스킵 버튼 없음.
export default function Onboarding() {
  const { t, lang } = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const { needsOnboarding, onboardingLoading, isFullUser } = useAuth()

  const [region, setRegion] = useState('')
  const [prefilled, setPrefilled] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Phase 1 지역은 ISO 3166-2:KR 이므로 국가는 지역 코드에서 파생(KR). 별도 선택 없음.
  const countryCode = region ? region.slice(0, 2) : 'KR'

  // 원래 가려던 목적지: ?next=(내부 경로만) → location.state.from → '/'. 오픈 리다이렉트 방지.
  const nextDest = useMemo(() => {
    const q = new URLSearchParams(location.search).get('next')
    const fromState = (location.state as { from?: string } | null)?.from
    const safe = (p: string | null | undefined) =>
      p && p.startsWith('/') && !p.startsWith('//') ? p : null
    return safe(q) || safe(fromState) || '/'
  }, [location.search, location.state])

  // 마운트 시 IP 기반 지역 프리필(실패해도 무시).
  useEffect(() => {
    let alive = true
    fetchGeoPrefill().then((geo) => {
      if (!alive) return
      if (geo.region_code && isValidRegion(geo.region_code)) setRegion(geo.region_code)
      setPrefilled(true)
    })
    return () => {
      alive = false
    }
  }, [])

  async function handleStart() {
    if (!region || submitting) return
    setSubmitting(true)
    setError('')
    // set-region 함수는 country === region.slice(0,2)를 강제하므로 국가를 지역 접두어로 보낸다.
    try {
      await callFunction('set-region', { country_code: region.slice(0, 2), region_code: region })
      navigate(nextDest, { replace: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // 409(이미 잠김)면 이미 확정된 상태이므로 그대로 진행.
      if (/already_locked|409/.test(msg)) {
        navigate(nextDest, { replace: true })
        return
      }
      setError(msg)
      setSubmitting(false)
    }
  }

  // 정식 회원이 아니거나 이미 확정한 유저가 직접 URL로 들어오면 목적지로 돌려보냄.
  if (!onboardingLoading && isFullUser && !needsOnboarding) {
    return <Navigate to={nextDest} replace />
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-surface text-on-surface p-6">
      <div className="w-full max-w-md bg-surface-container rounded-3xl border border-outline-variant/60 p-8 shadow-sm">
        <h1 className="text-2xl font-black tracking-tight mb-6 break-keep">{t('onboarding.title')}</h1>

        {/* 국가: Phase 1 은 지역(KR-xx)에서 파생 → 읽기 전용 표시 */}
        <label className="block text-sm font-medium text-on-surface-variant mb-1">
          {t('onboarding.country')}
        </label>
        <div className="w-full mb-5 rounded-xl border border-outline-variant bg-surface-container-high px-4 py-3 text-on-surface-variant select-none">
          {countryName(countryCode, lang)}
        </div>

        <label className="block text-sm font-medium text-on-surface-variant mb-1" htmlFor="ob-region">
          {t('onboarding.region')}
        </label>
        <select
          id="ob-region"
          className="w-full rounded-xl border border-outline-variant bg-surface px-4 py-3 text-on-surface"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          disabled={submitting}
        >
          <option value="" disabled>
            {t('onboarding.region')}
          </option>
          {REGIONS.map((r) => (
            <option key={r.code} value={r.code}>
              {t(r.i18nKey)}
            </option>
          ))}
        </select>
        {prefilled && (
          <p className="mt-1 text-xs text-on-surface-variant">{t('onboarding.region_prefill_hint')}</p>
        )}

        <p className="mt-5 text-sm text-error font-medium break-keep">{t('onboarding.lock_warn')}</p>

        {error && <p className="mt-3 text-sm text-error break-keep">{error}</p>}

        <button
          type="button"
          className="mt-6 w-full rounded-xl bg-primary text-on-primary font-bold py-3 disabled:opacity-50"
          onClick={handleStart}
          disabled={!region || submitting}
        >
          {t('onboarding.start')}
        </button>
      </div>
    </div>
  )
}
