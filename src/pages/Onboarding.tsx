import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { useAuth } from '../context/AuthProvider'
import { callFunction, supabase } from '../lib/supabase'
import { fetchGeoPrefill } from '../lib/geo'
import { REGIONS, countryName, isValidRegion } from '../lib/regions'

// 아레나(/arena·/test/*·/ranking) 최초 진입 시 지역 확정 화면. 한 번 정하면 되돌릴 수 없음(set-region 이 잠금).
// 2단계: 1) 왜 받는지 설명 → 2) 입력. 자격검정 경로에선 뜨지 않는다(지역을 쓰지 않으므로).
// 학교는 여기서 받지 않음(마이페이지에서 별도 수정). 스킵 버튼 없음.
// 연령대(age_band)도 여기서 같이 받는다 — 밴드만(10대·20대…), 정확한 나이는 안 받고 '공개 안 함' 도 답으로 친다.
//   지역과 달리 잠기지 않으므로, **지역을 이미 확정한 기존 회원**이 연령대만 비어 있으면
//   이 화면이 연령대만 물어본다(지역 칸은 확정값을 읽기 전용으로 보여준다).
const AGE_BANDS = ['10s', '20s', '30s', '40s', '50s', '60s'] as const

export default function Onboarding() {
  const { t, lang } = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const { needsOnboarding, onboardingLoading, isFullUser, markOnboardingDone, user } = useAuth()

  const [step, setStep] = useState<1 | 2>(1)
  const [region, setRegion] = useState('')
  const [ageBand, setAgeBand] = useState('')
  // 지역을 이미 확정했는지 = 이 방문은 연령대만 받으면 된다.
  const [regionLocked, setRegionLocked] = useState(false)
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

  // 이미 지역을 확정한 회원이 연령대만 없어서 온 경우 — 지역 질문을 다시 하지 않는다.
  //   (확정값을 그대로 보내야 set-region 의 국가·지역 교차검증을 통과한다. 서버는 409 로 지역을
  //    거절하지만 연령대는 그 전에 따로 저장되므로 결과적으로 정상 진행된다.)
  //   1단계(지역 안내)도 건너뛴다 — 지역 얘기를 다시 읽힐 이유가 없다.
  useEffect(() => {
    if (!user) return
    let alive = true
    supabase
      .from('profiles')
      .select('region_locked_at,region_code,age_band')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive || !data?.region_locked_at) return
        setRegionLocked(true)
        if (data.region_code) setRegion(data.region_code)
        if (data.age_band) setAgeBand(data.age_band)
        setStep(2)
      })
    return () => {
      alive = false
    }
  }, [user])

  async function handleStart() {
    if (!region || !ageBand || submitting) return
    setSubmitting(true)
    setError('')
    // set-region 함수는 country === region.slice(0,2)를 강제하므로 국가를 지역 접두어로 보낸다.
    try {
      await callFunction('set-region', { country_code: region.slice(0, 2), region_code: region, age_band: ageBand })
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
              {regionLocked ? t('onboarding.age_title') : t('onboarding.title')}
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
              htmlFor={regionLocked ? undefined : 'ob-region'}
            >
              {t('onboarding.region')}
            </label>
            {regionLocked ? (
              // 이미 확정된 지역 — 고를 수 없으니 국가와 같은 읽기 전용 칸으로 보여준다.
              <div className="w-full rounded-xl border border-outline-variant bg-surface-container-high px-4 py-3 text-lg text-on-surface-variant select-none">
                {t(REGIONS.find((r) => r.code === region)?.i18nKey ?? 'onboarding.region')}
              </div>
            ) : (
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
            )}

            {/* 연령대 — 밴드만 받는다. 셀렉트가 아니라 버튼인 이유: 선택지가 7개뿐이고
                '공개 안 함' 이 목록 속 한 줄로 숨으면 안 되는 답이라 화면에 그대로 드러나야 한다. */}
            <label className="block text-base font-medium text-on-surface-variant mt-6 mb-1">
              {t('onboarding.age')}
            </label>
            <p className="text-sm text-on-surface-variant/70 mb-2 break-keep">{t('onboarding.age_hint')}</p>
            <div className="grid grid-cols-3 gap-2">
              {AGE_BANDS.map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={ageBand === v}
                  disabled={submitting}
                  onClick={() => setAgeBand(v)}
                  className={`rounded-xl border px-2 py-3 text-base font-bold leading-tight break-keep transition-colors ${
                    ageBand === v
                      ? 'bg-primary text-on-primary border-primary'
                      : 'bg-surface text-on-surface border-outline-variant'
                  }`}
                >
                  {t(`onboarding.age_${v}`)}
                </button>
              ))}
            </div>
            {/* '공개 안 함' 은 성격이 다른 답이라 밴드 6개와 한 줄 떼어 놓는다 —
                사이에 끼우면 나이 하나를 더 고르는 칸으로 읽힌다. */}
            <button
              type="button"
              aria-pressed={ageBand === 'private'}
              disabled={submitting}
              onClick={() => setAgeBand('private')}
              className={`mt-2 w-full rounded-xl border px-2 py-3 text-base font-bold break-keep transition-colors ${
                ageBand === 'private'
                  ? 'bg-primary text-on-primary border-primary'
                  : 'bg-surface text-on-surface-variant border-outline-variant'
              }`}
            >
              {t('onboarding.age_private')}
            </button>

            {/* 되돌릴 수 없는 결정이므로 작은 글씨로 흘리지 않는다. 지역 한정 경고라
                지역이 이미 잠긴 방문(연령대만 받는 경우)에는 띄우지 않는다. */}
            {!regionLocked && (
              <p className="mt-6 text-lg font-bold text-error leading-snug break-keep">
                {t('onboarding.lock_warn')}
              </p>
            )}

            {error && <p className="mt-3 text-base text-error break-keep">{error}</p>}

            <button
              type="button"
              className="mt-6 w-full rounded-xl bg-primary text-on-primary text-lg font-bold py-4 disabled:opacity-50"
              onClick={handleStart}
              disabled={!region || !ageBand || submitting}
            >
              {t('onboarding.start')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
