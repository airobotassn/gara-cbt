import { useMemo, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import { NICK_MAX, NICK_MIN, nicknameError } from '../lib/nickname'

// 최초 로그인 직후 닉네임 확정 화면. 전 경로 게이트(App.tsx NicknameGate)가 여기로 보낸다.
// 왜 필수인가: 가입 트리거가 구글 실명을 display_name 에 넣어서, 안 정하면 랭킹·채팅·인증서에 실명이 뜬다.
// 변경은 이후 마이페이지에서 딱 1회만 — 그래서 여기서 "1회 남는다"는 사실을 미리 알린다.
export default function NicknameSetup() {
  const { t } = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const { isFullUser, loading, onboardingLoading, needsNickname, markNicknameDone } = useAuth()

  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // 원래 가려던 목적지(내부 경로만 — 오픈 리다이렉트 방지)
  const nextDest = useMemo(() => {
    const q = new URLSearchParams(location.search).get('next')
    const safe = (p: string | null | undefined) => (p && p.startsWith('/') && !p.startsWith('//') ? p : null)
    return safe(q) || '/'
  }, [location.search])

  const localErr = name ? nicknameError(name) : null

  async function submit() {
    const v = name.trim()
    if (submitting || nicknameError(v)) return
    setSubmitting(true)
    setError('')
    try {
      await callFunction('set-nickname', { nickname: v })
      markNicknameDone()
      navigate(nextDest, { replace: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // 서버 코드 → 사용자 문구. taken/locked 는 화면에서 바로 대처가 갈린다.
      const code = /taken/.test(msg) ? 'taken' : /reserved/.test(msg) ? 'reserved' : /locked/.test(msg) ? 'locked' : 'failed'
      setError(t(`nick.err_${code}`))
      setSubmitting(false)
    }
  }

  if (loading || onboardingLoading) return null
  if (!isFullUser) return <Navigate to="/login" replace />
  // 이미 정한 사람이 URL 로 들어오면 목적지로 돌려보낸다(변경은 마이페이지에서).
  if (!needsNickname) return <Navigate to={nextDest} replace />

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-surface text-on-surface p-6">
      <div className="w-full max-w-md bg-surface-container rounded-3xl border border-outline-variant/60 p-8 shadow-sm">
        <h1 className="text-3xl font-black tracking-tight leading-tight break-keep">{t('nick.title')}</h1>
        <p className="mt-4 text-lg leading-relaxed text-on-surface-variant break-keep">{t('nick.body')}</p>

        <label className="block mt-7 text-base font-medium text-on-surface-variant mb-1" htmlFor="nick-input">
          {t('nick.label')}
        </label>
        <input
          id="nick-input"
          className="w-full rounded-xl border border-outline-variant bg-surface px-4 py-3 text-lg text-on-surface"
          value={name}
          onChange={(e) => { setName(e.target.value); setError('') }}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          maxLength={NICK_MAX}
          autoFocus
          disabled={submitting}
          placeholder={t('nick.placeholder')}
        />
        <p className="mt-2 text-base text-outline break-keep">{t('nick.rule', { min: NICK_MIN, max: NICK_MAX })}</p>

        {/* 변경권이 1회뿐이라는 사실을 작은 글씨로 흘리지 않는다(지역 잠금 안내와 같은 원칙) */}
        <p className="mt-5 text-lg font-bold text-error leading-snug break-keep">{t('nick.once_warn')}</p>

        {(localErr || error) && (
          <p className="mt-3 text-base text-error break-keep">{error || t(`nick.err_${localErr}`)}</p>
        )}

        <button
          type="button"
          className="mt-6 w-full rounded-xl bg-primary text-on-primary text-lg font-bold py-4 disabled:opacity-50"
          onClick={submit}
          disabled={submitting || !!nicknameError(name)}
        >
          {submitting ? t('nick.saving') : t('nick.confirm')}
        </button>
      </div>
    </div>
  )
}
