import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { useAuth } from '../context/AuthProvider'
import { callFunction, supabase } from '../lib/supabase'
import { fetchGeoPrefill } from '../lib/geo'
import { countryName, countryOptions } from '../lib/regions'
import { loadRegionIndex, loadRegions, type RegionOption } from '../lib/regionCatalog'

// 아레나(/arena·/test/*·/ranking) 최초 진입 시 국가·지역 확정 화면. 확정 후 되돌리려면 마이페이지에서 1회.
// 2단계: 1) 왜 받는지 설명 → 2) 입력. 자격검정 경로에선 뜨지 않는다(지역을 쓰지 않으므로).
// 학교는 여기서 받지 않음(마이페이지에서 별도 수정). 스킵 버튼 없음.
//
// ⚠️ 국가는 전 세계에서 고른다(2026-08-12). 예전엔 지역코드에서 파생한 읽기 전용이라 화면에 늘 '대한민국'이
//    떴고, 외국 사용자는 서울·부산 중 하나를 골라야 넘어갔다(서버도 한국 밖 조합을 400으로 거절했다).
// ⚠️ 지역도 **전 세계**를 고른다(2026-08-12). 목록은 `/arena` 지도가 이미 쓰는 public/geo/adm1/<ISO>.json
//    에서 그대로 읽는다(211개국 · 3,504개 · 6개국어 이름 포함) — 지역 이름을 새로 만들지 않는다.
//    한때 한국만 지역을 물었는데, 아레나는 아무 나라나 파고들어 주(州) 랭킹을 보여주기 때문에
//    사우디 사람이 자기 나라 주 랭킹 화면을 보면서 거기에 영영 못 들어가는 상태였다.
//    지도 데이터가 없는 소수 국가만 국가까지 받는다(그 나라는 아레나에도 주 랭킹이 없다).
// 연령대(age_band)도 여기서 같이 받는다 — 밴드만(10대·20대…), 정확한 나이는 안 받고 '공개 안 함' 도 답으로 친다.
//   지역과 달리 잠기지 않으므로, **지역을 이미 확정한 기존 회원**이 연령대만 비어 있으면
//   이 화면이 연령대만 물어본다(지역 칸은 확정값을 읽기 전용으로 보여준다).
const AGE_BANDS = ['10s', '20s', '30s', '40s', '50s', '60s'] as const

export default function Onboarding() {
  const { t, lang } = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const { needsOnboarding, onboardingLoading, isFullUser, markOnboardingDone, applyRegion, user } = useAuth()

  const [step, setStep] = useState<1 | 2>(1)
  const [country, setCountry] = useState('')
  const [region, setRegion] = useState('')
  const [ageBand, setAgeBand] = useState('')
  // 지역을 이미 확정했는지 = 이 방문은 연령대만 받으면 된다.
  const [regionLocked, setRegionLocked] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  // IP 로 알아낸 접속 국가 — 목록 맨 위에 세운다(선택값은 아래 프리필이 따로 넣는다).
  const [geoCountry, setGeoCountry] = useState<string | null>(null)

  // 지역 목록 — 나라를 고른 뒤 그 나라 파일만 받는다(211개를 한꺼번에 받으면 6MB다).
  const [regionIndex, setRegionIndex] = useState<Record<string, number> | null>(null)
  const [regionList, setRegionList] = useState<RegionOption[]>([])
  const countryList = useMemo(() => countryOptions(lang, geoCountry), [lang, geoCountry])
  // ⚠️ 색인을 아직 못 받았으면 '지역 없음'이 아니라 '모른다'다. 모르는 동안 지역 칸을 감추고 버튼을 열면
  //    한국 사용자가 지역 없이 확정해버린다 → 색인이 오기 전에는 다음 단계로 못 넘어가게 한다.
  const needRegion = !!regionIndex && !!regionIndex[country]

  // 원래 가려던 목적지: ?next=(내부 경로만) → location.state.from → '/'. 오픈 리다이렉트 방지.
  const nextDest = useMemo(() => {
    const q = new URLSearchParams(location.search).get('next')
    const fromState = (location.state as { from?: string } | null)?.from
    const safe = (p: string | null | undefined) =>
      p && p.startsWith('/') && !p.startsWith('//') ? p : null
    return safe(q) || safe(fromState) || '/'
  }, [location.search, location.state])

  // 마운트 시 IP 기반 프리필(실패해도 무시). 1단계를 읽는 동안 조용히 채워둔다.
  //   ⚠️ 국가를 못 알아내면 **비워 둔다**. 예전처럼 'KR' 로 떨어뜨리면 외국 사용자가 화면에 뜬
  //      '대한민국'을 그대로 확정해 버리고, 그건 1회 변경권을 쓰지 않으면 못 되돌린다.
  //   ⛔ **지역은 프리필하지 않는다(2026-08-24).** 시도를 미리 채우면 사용자가 그냥 확정하는 것만으로
  //      IP 유래 위치가 계정에 저장된다 — 이유와 함께 지운 것들은 `lib/geo.ts` 머리 주석에 있다.
  //      지역은 아래 셀렉트에서 **직접** 고른다.
  useEffect(() => {
    let alive = true
    fetchGeoPrefill().then((geo) => {
      if (!alive) return
      if (geo.country_code) {
        setGeoCountry(geo.country_code)
        setCountry((c) => c || geo.country_code!)
      }
    })
    return () => {
      alive = false
    }
  }, [])

  // 어느 나라에 지역 데이터가 있는지(색인) — 한 번만 받는다.
  useEffect(() => {
    let alive = true
    loadRegionIndex().then((idx) => { if (alive) setRegionIndex(idx) })
    return () => { alive = false }
  }, [])

  // 고른 나라의 지역 목록. 화면 언어가 바뀌면 이름도 그 언어로 다시 받는다.
  useEffect(() => {
    let alive = true
    if (!country || !regionIndex?.[country]) { setRegionList([]); return }
    loadRegions(country, lang).then((list) => { if (alive) setRegionList(list) })
    return () => { alive = false }
  }, [country, lang, regionIndex])

  // 이미 지역을 확정한 회원이 연령대만 없어서 온 경우 — 지역 질문을 다시 하지 않는다.
  //   (확정값을 그대로 보내야 set-region 의 국가·지역 교차검증을 통과한다. 서버는 409 로 지역을
  //    거절하지만 연령대는 그 전에 따로 저장되므로 결과적으로 정상 진행된다.)
  //   1단계(지역 안내)도 건너뛴다 — 지역 얘기를 다시 읽힐 이유가 없다.
  useEffect(() => {
    if (!user) return
    let alive = true
    supabase
      .from('profiles')
      .select('region_locked_at,country_code,region_code,age_band')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive || !data?.region_locked_at) return
        setRegionLocked(true)
        // 확정값을 그대로 되돌려 보내야 서버 교차검증을 통과한다. 국가는 지역에서 파생하지 않는다
        // — 지역 없는 나라(한국 밖)로 확정한 회원은 파생할 지역 자체가 없다.
        if (data.country_code) setCountry(data.country_code)
        if (data.region_code) setRegion(data.region_code)
        if (data.age_band) setAgeBand(data.age_band)
        setStep(2)
      })
    return () => {
      alive = false
    }
  }, [user])

  // 보낼 수 있는 상태인가 — 지역은 **목록이 있는 나라에서만** 필수다.
  //   색인을 못 받은 동안(regionIndex === null)은 판단 자체를 미룬다(위 needRegion 주석 참고).
  const ready = !!country && !!regionIndex && (!needRegion || !!region) && !!ageBand

  async function handleStart() {
    if (!ready || submitting) return
    setSubmitting(true)
    setError('')
    try {
      // 지역 없는 나라는 빈 문자열로 보낸다(서버가 null 로 저장한다).
      await callFunction('set-region', {
        country_code: country,
        region_code: needRegion ? region : '',
        age_band: ageBand,
      })
      // ⚠️ navigate 전에 반드시 해제. 안 하면 nextDest 가 아레나 경로일 때 OnboardingGate 가
      // 여기로 다시 튕겨서 새로고침해야만 넘어간다.
      // 컨텍스트의 국가·지역도 같이 채운다 — 목적지가 /ranking·/arena 면 그 화면이 바로 이 값을 쓴다.
      applyRegion(country, needRegion ? region : null)
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
            {/* 지역을 안 묻는 나라에서 "어느 지역에서…" 라고 물으면 화면에 없는 걸 묻는 말이 된다. */}
            <h1 className="text-3xl font-black tracking-tight leading-tight mb-7 break-keep">
              {regionLocked ? t('onboarding.age_title') : needRegion ? t('onboarding.title') : t('onboarding.title_country')}
            </h1>

            {/* 국가 — 전 세계에서 고른다. 접속 국가(IP)가 목록 맨 위에 서고 처음부터 선택돼 있다. */}
            <label
              className="block text-base font-medium text-on-surface-variant mb-1"
              htmlFor={regionLocked ? undefined : 'ob-country'}
            >
              {t('onboarding.country')}
            </label>
            {regionLocked ? (
              <div className="w-full mb-5 rounded-xl border border-outline-variant bg-surface-container-high px-4 py-3 text-lg text-on-surface-variant select-none">
                {country ? countryName(country, lang) : '-'}
              </div>
            ) : (
              <select
                id="ob-country"
                className="w-full mb-5 rounded-xl border border-outline-variant bg-surface px-4 py-3 text-lg text-on-surface"
                value={country}
                // ⚠️ 나라를 바꾸면 지역을 반드시 비운다. 안 비우면 미국을 고른 사람의 값에 KR-11 이 남아
                //    서버 교차검증에 걸리고, 사용자는 이유를 알 수 없는 오류만 본다.
                onChange={(e) => { setCountry(e.target.value); setRegion('') }}
                disabled={submitting}
              >
                <option value="" disabled>
                  {t('onboarding.country')}
                </option>
                {countryList.pinned && (
                  <option value={countryList.pinned.code}>{countryList.pinned.name}</option>
                )}
                {countryList.rest.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}

            {/* 지역 — 목록이 있는 나라(현재 한국)에서만 묻는다. 그 밖의 나라는 이 칸 자체가 없다. */}
            {needRegion && (
              <>
                <label
                  className="block text-base font-medium text-on-surface-variant mb-1"
                  htmlFor={regionLocked ? undefined : 'ob-region'}
                >
                  {t('onboarding.region')}
                </label>
                {regionLocked ? (
                  // 이미 확정된 지역 — 고를 수 없으니 국가와 같은 읽기 전용 칸으로 보여준다.
                  <div className="w-full rounded-xl border border-outline-variant bg-surface-container-high px-4 py-3 text-lg text-on-surface-variant select-none">
                    {regionList.find((r) => r.code === region)?.name ?? region}
                  </div>
                ) : (
                  <select
                    id="ob-region"
                    className="w-full rounded-xl border border-outline-variant bg-surface px-4 py-3 text-lg text-on-surface"
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    disabled={submitting || !regionList.length}
                  >
                    <option value="" disabled>
                      {t('onboarding.region')}
                    </option>
                    {regionList.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                )}
              </>
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
              disabled={!ready || submitting}
            >
              {t('onboarding.start')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
