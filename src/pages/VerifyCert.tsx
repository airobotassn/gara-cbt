import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import SiteFooter from '../components/SiteFooter'
import { callFunction } from '../lib/supabase'
import { useT } from '../lib/i18n'
import type { VerifyCertResponse } from '../lib/types'

// QR 진위확인 결과 — 공개 페이지(로그인 불필요). /verify/<token>.
// verify-cert 함수가 서버 원본(발급 기록)을 조회해 유효/만료/무효를 판정한 걸 그대로 표시.
function fmtDate(iso?: string | null) {
  if (!iso) return '-'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '-'
  return `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}`
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between items-center gap-3">
      <span className="font-body-md text-body-md text-on-surface-variant shrink-0 whitespace-nowrap">{label}</span>
      <span className={`font-body-md text-body-md text-right break-keep ${strong ? 'font-bold text-on-surface' : 'font-medium text-on-surface'}`}>{value}</span>
    </div>
  )
}

export default function VerifyCert() {
  const { token } = useParams()
  const { t } = useT()
  const [data, setData] = useState<VerifyCertResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    callFunction<VerifyCertResponse>('verify-cert', { token })
      .then((r) => alive && setData(r))
      .catch(() => alive && setData({ valid: false, reason: 'error' }))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [token])

  const ok = !!data?.valid && data.status === 'valid'
  const expired = !!data?.valid && data.status === 'expired'

  const theme = ok
    ? { icon: 'verified', ring: 'bg-primary/10 text-primary border-primary/20', badge: 'bg-primary/10 text-primary border-primary/20', label: t('verify.valid_badge') }
    : expired
      ? { icon: 'schedule', ring: 'bg-secondary/10 text-secondary border-secondary/20', badge: 'bg-secondary/10 text-secondary border-secondary/20', label: t('verify.expired_badge') }
      : { icon: 'gpp_bad', ring: 'bg-error/10 text-error border-error/20', badge: 'bg-error/10 text-error border-error/20', label: t('verify.invalid_badge') }

  return (
    <div className="bg-background text-on-surface mesh-bg min-h-screen flex flex-col">
      <main className="flex-grow pt-12 pb-24 px-margin-mobile md:px-margin-desktop w-full max-w-container-max mx-auto flex items-center justify-center">
        <div className="glass-panel rounded-3xl p-8 md:p-12 ambient-shadow max-w-lg w-full text-center border border-white/40">
          {loading ? (
            <>
              <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin mx-auto mb-6" />
              <p className="font-body-lg text-body-lg text-on-surface-variant">{t('verify.loading')}</p>
            </>
          ) : (
            <>
              <div className={`w-20 h-20 rounded-full ${theme.ring} border flex items-center justify-center mx-auto mb-6`}>
                <span className="material-symbols-outlined text-[40px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  {theme.icon}
                </span>
              </div>
              <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-2xl mb-5 border font-label-md text-label-md font-bold ${theme.badge}`}>
                {theme.label}
              </div>
              <h1 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface mb-1">
                {t('verify.title')}
              </h1>

              {data?.valid ? (
                <div className="bg-surface-container-low/70 rounded-2xl p-5 md:p-6 mt-6 flex flex-col gap-4 text-left border border-outline-variant/20">
                  <Row label={t('verify.name')} value={data.name || '-'} strong />
                  <div className="h-px bg-outline-variant/25" />
                  <Row label={t('verify.grade')} value={data.grade || '-'} />
                  <div className="h-px bg-outline-variant/25" />
                  <Row label={t('verify.cert_no')} value={data.certNo || '-'} />
                  <div className="h-px bg-outline-variant/25" />
                  <Row label={t('verify.issued_at')} value={fmtDate(data.issuedAt)} />
                  <div className="h-px bg-outline-variant/25" />
                  <Row label={t('verify.expires_at')} value={data.expiresAt ? fmtDate(data.expiresAt) : t('verify.no_expiry')} />
                  <div className="h-px bg-outline-variant/25" />
                  <Row label={t('verify.status')} value={expired ? t('verify.status_expired') : t('verify.status_valid')} strong />
                </div>
              ) : (
                <p className="font-body-md text-body-md text-on-surface-variant mt-4 break-keep">{t('verify.invalid_desc')}</p>
              )}
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
