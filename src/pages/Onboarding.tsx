import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import { fetchGeoPrefill } from '../lib/geo'
import { REGIONS, countryName, isValidRegion } from '../lib/regions'

// 아레나(/arena·/test/*·/ranking) 최초 진입 시 지역 확정 화면. 한 번 정하면 되돌릴 수 없음(set-region 이 잠금).
// 2단계: 1) 왜 받는지 설명 → 2) 입력. 자격검정 경로에선 뜨지 않는다(지역을 쓰지 않으므로).
// 학교는 여기서 받지 않음(마이페이지에서 별도 수정). 스킵 버튼 없음.
export default function Onboarding() {
  const { t, lang } = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const { needsOnboarding, onboardingLoading, isFullUser, markOnboardingDone } = useAuth()

  const [step, setStep] = useState<1 | 2>(1)
  const [region, setRegion] = useState('')
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

  // 마운트 시 IP 기반 지역 프리필(실패해도 무시). 1단계를 읽는 동안 조용히 채워둔다.
  useEffect(() => {
    let alive = true
    fetchGeoPrefill().then((geo) => {
      if (!alive) return
      if (geo.region_code && isValidRegion(geo.region_code)) setRegion(geo.region_code)
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
      // ⚠️ navigate 전에 반드시 해제. 안 하면 nextDest 가 아레나 경로일 때 OnboardingGate 가
      // 여기로 다시 튕겨서 새로고침해야만 넘어간다.
      markOnboardingDone()
      navigate(nextDest, { replace: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // 409(이미 잠김)면 이미 확정된 상태이므로 그대로 진행.
      if (/already_locked|409/.test(msg)) {
        markOnboardingDone()
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
        {step === 1 ? (
          <>
            <h1 className="text-4xl font-black tracking-tight leading-tight break-keep">
              {t('onboarding.intro_title')}
            </h1>
            <p className="mt-5 text-xl leading-relaxed text-on-surface-variant break-keep">
              {t('onboarding.intro_body')}
            </p>
            <button
              type="button"
              className="mt-10 w-full rounded-xl bg-primary text-on-primary text-lg font-bold py-4"
              onClick={() => setStep(2)}
            >
              {t('onboarding.intro_next')}
            </button>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-black tracking-tight leading-tight mb-7 break-keep">
              {t('onboarding.title')}
            </h1>

            {/* 국가: Phase 1 은 지역(KR-xx)에서 파생 → 읽기 전용 표시 */}
            <label className="block text-base font-medium text-on-surface-variant mb-1">
              {t('onboarding.country')}
            </label>
            <div className="w-full mb-5 rounded-xl border border-outline-variant bg-surface-container-high px-4 py-3 text-lg text-on-surface-variant select-none">
              {countryName(countryCode, lang)}
            </div>

            <label
              className="block text-base font-medium text-on-surface-variant mb-1"
              htmlFor="ob-region"
            >
              {t('onboarding.region')}
            </label>
            <select
              id="ob-region"
              className="w-full rounded-xl border border-outline-variant bg-surface px-4 py-3 text-lg text-on-surface"
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

            {/* 되돌릴 수 없는 결정이므로 작은 글씨로 흘리지 않는다. */}
            <p className="mt-6 text-lg font-bold text-error leading-snug break-keep">
              {t('onboarding.lock_warn')}
            </p>

            {error && <p className="mt-3 text-base text-error break-keep">{error}</p>}

            <button
              type="button"
              className="mt-6 w-full rounded-xl bg-primary text-on-primary text-lg font-bold py-4 disabled:opacity-50"
              onClick={handleStart}
              disabled={!region || submitting}
            >
              {t('onboarding.start')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
