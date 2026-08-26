import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { callFunction } from '../lib/supabase'
import { useT } from '../lib/i18n'
import type { VerifyCertResponse } from '../lib/types'

// 자격 진위확인 포털 — 공개(로그인 불필요). /verify/<token>.
// verify-cert 함수가 서버 원본(발급 기록)을 조회한 결과를 공문서 톤으로 표시.
function fmtDate(iso?: string | null) {
  if (!iso) return '-'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '-'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}. ${p(d.getMonth() + 1)}. ${p(d.getDate())}`
}
function fmtDateTime(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}. ${p(d.getMonth() + 1)}. ${p(d.getDate())}. ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// 미리보기 인증서 QR(preview-sample)용 데모 — 실제 조회 없이 '유효' 예시를 그대로 보여준다.
const DEMO_TOKEN = 'preview-sample'
const DEMO_BAD_TOKEN = 'preview-invalid'
function demoResult(): VerifyCertResponse {
  const now = new Date()
  const exp = new Date(now)
  exp.setMonth(exp.getMonth() + 6) // CARIS Beginner = 취득일 +6개월(_shared/cert.ts 의 EXPIRY_MONTHS)
  return {
    valid: true,
    status: 'valid',
    name: '홍*동',
    // ⚠️ **미리보기 증서와 같은 급수여야 한다.** 이 토큰을 QR 에 싣는 건 `/certificate` 미리보기 하나뿐이고
    //    그 증서는 Beginner 다 — 예전엔 여기만 Pro 라 QR 을 찍으면 증서와 급수가 어긋났다(2026-08-26).
    grade: 'CARIS BEGINNER',
    certNo: 'CA-BEG-2026-000001',
    issuedAt: now.toISOString(),
    expiresAt: exp.toISOString(),
  }
}

// 공식 검인(檢印) 엠블럼 — 이중 링 + 비딩(engine-turn) + 원호 문자 + 중앙 판정 글리프.
function Seal({ tone }: { tone: 'ok' | 'warn' | 'bad' }) {
  const ring = tone === 'ok' ? '#1663c7' : tone === 'warn' ? '#b17a1c' : '#b23b32'
  const navy = '#16305b'
  const glyph = tone === 'bad' ? '#e6b7b2' : '#cfe3ff'
  const ticks = Array.from({ length: 72 }, (_, i) => {
    const a = (i / 72) * Math.PI * 2
    const r1 = 56
    const r2 = 63
    return (
      <line
        key={i}
        x1={70 + Math.cos(a) * r1}
        y1={70 + Math.sin(a) * r1}
        x2={70 + Math.cos(a) * r2}
        y2={70 + Math.sin(a) * r2}
        stroke={ring}
        strokeWidth={i % 6 === 0 ? 1.5 : 0.7}
        opacity={0.85}
      />
    )
  })
  return (
    <svg className="vrf-seal" viewBox="0 0 140 140" aria-hidden="true">
      <defs>
        <path id="vrf-arc" d="M 26,70 A 44,44 0 0 1 114,70" fill="none" />
      </defs>
      <circle cx="70" cy="70" r="66" fill="none" stroke={ring} strokeWidth="2.4" />
      <circle cx="70" cy="70" r="54" fill="none" stroke={ring} strokeWidth="0.9" opacity="0.75" />
      {ticks}
      {/* ⚠️ 2026-08-05 세리프(CertGaramond) 제거 — 화면 글씨체는 Pretendard 하나로 통일했다. */}
      <text fontFamily="'Pretendard Variable', Pretendard, sans-serif" fontSize="7.2" letterSpacing="1.6" fontWeight="600" fill={ring}>
        <textPath href="#vrf-arc" startOffset="50%" textAnchor="middle">
          CERTIFICATE&nbsp;·&nbsp;VERIFICATION
        </textPath>
      </text>
      <circle cx="70" cy="70" r="40" fill={navy} />
      <circle cx="70" cy="70" r="40" fill="none" stroke={ring} strokeWidth="1" />
      {tone === 'bad' ? (
        <path d="M59 59 L81 81 M81 59 L59 81" stroke={glyph} strokeWidth="4.6" strokeLinecap="round" />
      ) : (
        <path d="M56 71 l10 11 l19 -25" fill="none" stroke={glyph} strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  )
}

export default function VerifyCert() {
  const { token } = useParams()
  const { t } = useT()
  const isDemo = token === DEMO_TOKEN || token === DEMO_BAD_TOKEN
  // 데모 토큰이면 초기값으로 예시 결과(함수 호출 없음). 실제 토큰만 서버 조회.
  const [data, setData] = useState<VerifyCertResponse | null>(() =>
    token === DEMO_TOKEN ? demoResult() : token === DEMO_BAD_TOKEN ? { valid: false, reason: 'not_found' } : null,
  )
  const [loading, setLoading] = useState(!isDemo)
  const [checkedAt] = useState(() => new Date())

  useEffect(() => {
    if (isDemo) return
    let alive = true
    callFunction<VerifyCertResponse>('verify-cert', { token })
      .then((r) => alive && setData(r))
      .catch(() => alive && setData({ valid: false, reason: 'error' }))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [token, isDemo])

  const ok = !!data?.valid && data.status === 'valid'
  const expired = !!data?.valid && data.status === 'expired'
  const tone: 'ok' | 'warn' | 'bad' = ok ? 'ok' : expired ? 'warn' : 'bad'
  const headline = ok ? t('verify.headline_valid') : expired ? t('verify.headline_expired') : t('verify.headline_invalid')
  const chipText = ok ? t('verify.status_valid') : expired ? t('verify.status_expired') : t('verify.status_invalid')

  return (
    <div className="vrf-page">
      <div className="vrf-doc">
        <div className="vrf-inner">
          <header className="vrf-mast">
            {/* 로고 락업 — CARIS(자격) | GARA(발급기관). 진위확인은 "누가 발급했나"가 핵심이라 둘 다 세운다. */}
            <div className="vrf-brand">
              <img className="vrf-logo" src="/logo.png" alt="CARIS" />
              <span className="vrf-brand-sep" aria-hidden="true" />
              <img className="vrf-logo-gara" src="/gara-wordmark-2026.png" alt="GARA" />
            </div>
            <div className="vrf-authority">Global AI &amp; Robotics Association</div>
            <div className="vrf-rule"><span>◆</span></div>
            <h1 className="vrf-sys">{t('verify.system_sub')}</h1>
          </header>

          {loading ? (
            <div className="vrf-load">
              <div className="vrf-spin" />
              <p>{t('verify.loading')}</p>
            </div>
          ) : (
            <>
              <div className="vrf-verdict">
                <Seal tone={tone} />
                <div className="vrf-headline">{headline}</div>
                <span className={`vrf-chip ${tone}`}>{chipText}</span>
              </div>

              {data?.valid ? (
                <section className="vrf-record">
                  <div className="vrf-record-head">{t('verify.record_title')}</div>
                  <div className="vrf-row"><span className="k">{t('verify.name')}</span><span className="v">{data.name || '-'}</span></div>
                  <div className="vrf-row"><span className="k">{t('verify.grade')}</span><span className="v">{data.grade || '-'}</span></div>
                  <div className="vrf-row"><span className="k">{t('verify.cert_no')}</span><span className="v mono">{data.certNo || '-'}</span></div>
                  <div className="vrf-row"><span className="k">{t('verify.issued_at')}</span><span className="v">{fmtDate(data.issuedAt)}</span></div>
                  <div className="vrf-row"><span className="k">{t('verify.expires_at')}</span><span className="v">{data.expiresAt ? fmtDate(data.expiresAt) : t('verify.no_expiry')}</span></div>
                </section>
              ) : (
                <p className="vrf-invalid-desc">{t('verify.invalid_desc')}</p>
              )}

              {/* ⛔ **데모 안내문('미리보기 예시입니다')은 뺐다(2026-08-26 지시).** 사용설명서에 싣는 증서의 QR 이
                  이 토큰을 가리키는데, 안내문이 붙으면 진위확인 기능을 보여주려고 넣은 그림이 "예시라서 안 된다"
                  로 읽힌다. 실제로 이 토큰을 쓰는 발급 건은 하나도 없다(발급본은 전부 난수 토큰이다).
                  ⚠️ 대가: `/verify/preview-sample` 을 직접 여는 사람에게도 **실재하지 않는 자격증이 '유효'로**
                     보인다. 되살리려면 이 자리에 안내문을 다시 넣으면 된다(문구 키는 6개국어에서 같이 지웠다). */}

              <footer className="vrf-trust">
                <p>{t('verify.trust')}</p>
                <div className="vrf-checked"><span className="lbl">{t('verify.checked_at')} · </span>{fmtDateTime(checkedAt)}</div>
              </footer>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
