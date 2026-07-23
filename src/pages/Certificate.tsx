import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'
import { callFunction } from '../lib/supabase'
import { qrMatrix } from '../lib/qr'
import { gradeDisplay, fmtCertDate, certExpiryDate } from '../lib/certNo'
import type { MyAttemptsResponse } from '../lib/types'

// ===== 자격증 = 순수 벡터 SVG(값·문구·급수·워드마크) + logo.png 엠블럼 =====
// 스크린샷 배경 없음. 프레임·네이비바·워터마크는 벡터, 글자는 전부 내장 폰트 벡터 → 배율/인쇄 선명.
// 이름·급수·등록번호·취득일·유효기간은 서버가 내려준 값(CertData)을 주입.
//
// ⚠️ 미리보기(preview) = 유료 발급 전 견본. 브라우저는 캡처를 감지할 수 없으므로(PrintScreen·캡처도구·
// 폰 카메라 모두 웹에서 불가시) "캡처하면 워터마크"가 아니라 "발급 전에는 항상 워터마크"가 유일한 방어다.
// 워터마크는 심리적 억제일 뿐이고, 실제 방어는 QR 진위확인 토큰(verify_token)을 발급 전에는 아예
// 내려주지 않는 것 — 캡처본은 /verify/:token 조회가 안 되므로 위조증서임이 증명된다.
export interface CertData {
  name: string
  qualification: string // 시험명(급수 폴백)
  grade?: string // 표시 급수(예: 'CARIS PRO')
  nameRoman?: string // 로마자 표기(선택)
  certNo: string
  issueDate: string // 취득일(포맷 완료)
  expiryDate?: string | null // 유효기간 만료일(포맷). null=무기한
  birth?: string
  scoreText?: string
  verifyToken?: string
  preview?: boolean // true = 발급(결제) 전 견본 — 워터마크 + 등록번호 마스킹 + QR 잠금
  attemptId?: string // 미리보기 → 발급 전환에 필요(응시 기록 id)
}

const VB = { w: 743, h: 538 }
const WORDF = "'CariWord','Segoe UI',sans-serif" // CARIS 워드마크(Montserrat)
const SERIF = "'CariSerif','Times New Roman',serif" // 급수(Tinos)
const BODY = "'CariSerif','CertMyeongjo',serif" // 본문: 라틴→Tinos, 한글→명조
const GOTHIC = "'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif" // 이름·라벨
const WORD = '#182a4f', INK = '#141414', GRADE = '#1a3a72', NAVY = '#16305b'
const GRAY = '#8a8f99', FLABEL = '#496fd3', VAL = '#3f4650', FRAME = '#9db6e0', FRAME2 = '#c6d5ee'

const BODY_TEXT = ['위 사람은 Certification for AI & Robotics Integrated Skills', '(CARIS) 자격검정에 합격하였으므로 이 증서를 수여합니다.']

function todayStr() {
  return fmtCertDate(new Date())
}

// 이름 폭·크기 — CJK 짧은 이름은 시안 폭(3자=151)에 맞추고, 라틴/장문은 축소.
function nameFit(raw: string): { text: string; size: number; len: number } {
  const s = raw.trim()
  const compact = s.replace(/\s+/g, '')
  const cjk = /[\u3131-\uD79D\u3040-\u30FF\u4E00-\u9FFF]/.test(compact) && !/[A-Za-z]/.test(compact)
  if (cjk) {
    const n = compact.length
    const size = n <= 3 ? 47 : n <= 4 ? 40 : n <= 6 ? 32 : 26
    return { text: compact, size, len: Math.min(n * 50, 260) }
  }
  const size = Math.max(20, Math.min(46, Math.round(250 / Math.max(1, s.length * 0.5))))
  return { text: s, size, len: Math.min(s.length * size * 0.55, 300) }
}
// 급수 — 가용 폭(331) 채우고, 길면 폰트만 축소.
function gradeFit(g: string): { size: number; len: number } {
  const size = g.length <= 11 ? 54 : g.length <= 14 ? 42 : 32
  return { size, len: 331 }
}

// 등록번호 마스킹 — 마지막 일련번호 구획만 가린다. 예: CA-PRO-2026-0001 → CA-PRO-2026-••••
function maskCertNo(s: string) {
  return s.replace(/[0-9A-Za-z]+$/, (m) => '•'.repeat(Math.max(4, m.length)))
}

export default function Certificate() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { t } = useT()
  const passed = location.state as CertData | null
  // 발급 완료 스냅샷 — 미리보기에서 발급하면 이 값으로 교체돼 워터마크 없는 원본 + QR 이 나온다.
  const [issuedData, setIssuedData] = useState<CertData | null>(null)
  const [issuing, setIssuing] = useState(false)
  const [issueErr, setIssueErr] = useState('')

  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>
  const fallbackName = (meta.full_name as string) || (meta.name as string) || user?.email?.split('@')[0] || '응시자'

  const data: CertData = issuedData ?? passed ?? {
    name: user ? fallbackName : '안형준',
    qualification: 'CARIS Pro',
    grade: 'CARIS PRO',
    nameRoman: (meta.name_roman as string) || (user ? undefined : 'Ahn Hyeongjun'),
    certNo: 'CA-PRO-2026-0001',
    issueDate: todayStr(),
    expiryDate: certExpiryDate('CARIS Pro', new Date()),
    verifyToken: 'preview-sample',
  }

  // 미리보기 판정 — 넘겨받은 state 우선, /certificate/preview 로 직접 들어와도 견본으로 연다.
  // 발급을 마치면(issuedData) 무조건 원본.
  const preview = issuedData ? false : (data.preview ?? location.pathname.endsWith('/preview'))

  const gradeText = data.grade || gradeDisplay(data.qualification)
  const expiryText = data.expiryDate ?? '무기한'
  const nm = nameFit(data.name)
  const gf = gradeFit(gradeText)
  const shownCertNo = preview ? maskCertNo(data.certNo) : data.certNo
  const rows: [string, string][] = [
    ['등록번호', shownCertNo],
    ['취득일', data.issueDate],
    ['유효기간', expiryText],
  ]
  // 워터마크 2행: 고정 경고문 + 소유자 식별(이름 · 마스킹 등록번호) — 유출본 추적용
  const wmSub = `${data.name.trim()} · ${shownCertNo}`

  // 미리보기에는 QR 을 만들지 않는다(토큰 자체가 없음) — 캡처본은 진위확인이 불가능해진다.
  const qr = !preview && data.verifyToken ? qrMatrix(`${window.location.origin}/verify/${data.verifyToken}`, 'M') : null
  const QRB = { x: 568, y: 360, size: 64 }
  const qm = qr ? QRB.size / qr.count : 0
  const cn = (px: number, py: number, sx: number, sy: number) => (
    <path key={`${px}-${py}`} d={`M${px + sx * 6} ${py} h${sx * 15} M${px} ${py + sy * 6} v${sy * 15}`} stroke="#8ca6d6" strokeWidth={1} fill="none" />
  )

  // 발급 = 유료. 💳 결제 플로우가 붙으면 이 함수 첫머리에서 결제 성공을 확인한 뒤 issue 를 호출한다.
  // 발급이 끝나야 서버가 verify_token·확정 등록번호를 만들어 주고, 그때 워터마크 없는 원본으로 바뀐다.
  async function issueNow() {
    const id = data.attemptId
    if (!id || id === 'preview') {
      setIssueErr(t('cert.issue_no_attempt'))
      return
    }
    setIssuing(true)
    setIssueErr('')
    try {
      const r = await callFunction<MyAttemptsResponse>('my-attempts', { issue: id })
      setIssuedData({ ...data, preview: false, certNo: r.issued?.certNo ?? data.certNo, verifyToken: r.issued?.verifyToken })
    } catch (e) {
      setIssueErr(e instanceof Error ? e.message : t('cert.issue_failed'))
    } finally {
      setIssuing(false)
    }
  }

  return (
    <div className="cert-page">
      {preview && (
        <div className="cert-preview-note">
          <b>{t('cert.preview_badge')}</b>
          <span>{t('cert.preview_note')}</span>
        </div>
      )}
      <div className="cert-canvas">
        <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="cert-svg" role="img" aria-label={t('cert.alt')}>
          <defs>
            <linearGradient id="cert-bar" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#0a2f74" /><stop offset="0.55" stopColor="#164f9e" /><stop offset="1" stopColor="#2f74cf" />
            </linearGradient>
            <linearGradient id="cert-barhi" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#5b9be6" /><stop offset="1" stopColor="#2f74cf" />
            </linearGradient>
            {/* 미리보기 워터마크 — 45°에 가까운 대각선 반복 타일. SVG 안에 있으므로 화면·확대·인쇄(PDF) 어디서나 같이 찍힌다. */}
            {preview && (
              <pattern id="cert-wm" x="0" y="0" width="290" height="104" patternUnits="userSpaceOnUse" patternTransform="rotate(-28)">
                <text x="0" y="32" fontFamily={GOTHIC} fontWeight="700" fontSize="19" letterSpacing="1.5" fill={NAVY} opacity="0.17">{t('cert.wm_notice')}</text>
                <text x="2" y="54" fontFamily={GOTHIC} fontWeight="400" fontSize="12.5" letterSpacing="0.4" fill={NAVY} opacity="0.15">{wmSub}</text>
              </pattern>
            )}
          </defs>

          <rect x="0" y="0" width={VB.w} height={VB.h} fill="#ffffff" />
          {/* 워터마크 엠블럼 */}
          <image href="/logo.png" x="250" y="245" width="245" height="245" opacity="0.05" />

          {/* 프레임 */}
          <rect x="30" y="20" width="683" height="498" rx="6" fill="none" stroke={FRAME} strokeWidth="1.4" />
          <rect x="38" y="28" width="667" height="482" rx="4" fill="none" stroke={FRAME2} strokeWidth="0.9" />
          {cn(38, 28, 1, 1)}{cn(705, 28, -1, 1)}{cn(38, 510, 1, -1)}{cn(705, 510, -1, -1)}
          <path d="M30 255 a14 14 0 0 0 0 28 z" fill="#9298a3" />
          <path d="M713 255 a14 14 0 0 1 0 28 z" fill="#9298a3" />

          {/* 네이비 바 */}
          <rect x="38" y="161" width="667" height="19" fill="url(#cert-bar)" />
          <polygon points="595,161 705,161 705,180 655,180" fill="url(#cert-barhi)" opacity="0.6" />

          {/* 헤더 로고 락업 */}
          <image href="/logo.png" x="226" y="30" width="108" height="108" />
          <line x1="346" y1="58" x2="346" y2="118" stroke="#b9c4d8" strokeWidth="1" />
          <text x="352" y="86" fontFamily={WORDF} fontWeight="800" fontSize="31" textLength="111" lengthAdjust="spacingAndGlyphs" fill={WORD}>CARIS</text>
          <text x="360" y="104" fontFamily={GOTHIC} fontWeight="400" fontSize="10.5" fill={GRAY}>Certification for</text>
          <text x="360" y="117" fontFamily={GOTHIC} fontWeight="400" fontSize="10.5" fill={GRAY}>AI &amp; Robotics Integrated Skills</text>

          {/* 이름 */}
          <text x="200" y="278" textAnchor="middle" fontFamily={GOTHIC} fontWeight="700" fontSize={nm.size} textLength={nm.len} lengthAdjust="spacingAndGlyphs" fill={INK}>{nm.text}</text>
          <line x1="126" y1="300" x2="284" y2="300" stroke="#8fa8d4" strokeWidth="1" />
          <path d="M205 295 l5 5 l-5 5 l-5 -5 z" fill={NAVY} />
          {data.nameRoman && (
            <text x="201" y="326" textAnchor="middle" fontFamily={GOTHIC} fontWeight="400" fontSize="13" letterSpacing="1" fill={GRAY}>{data.nameRoman}</text>
          )}

          {/* 급수 */}
          <text x="524" y="295" textAnchor="middle" fontFamily={SERIF} fontWeight="700" fontSize={gf.size} textLength={gf.len} lengthAdjust="spacingAndGlyphs" fill={GRADE}>{gradeText}</text>

          {/* 본문 */}
          <g fontFamily={BODY} fontWeight="400" fontSize="18" fill="#20242c" textAnchor="middle">
            <text x="337" y="391" textLength="381" lengthAdjust="spacingAndGlyphs">{BODY_TEXT[0]}</text>
            <text x="337" y="415" textLength="397" lengthAdjust="spacingAndGlyphs">{BODY_TEXT[1]}</text>
          </g>

          {/* QR 진위확인 — 미리보기는 토큰이 없어 자리만 잠금 표시(캡처해도 진위확인 불가) */}
          <rect x={QRB.x - 3} y={QRB.y - 3} width={QRB.size + 6} height={QRB.size + 6} fill="#ffffff" />
          {preview ? (
            <>
              <rect x={QRB.x} y={QRB.y} width={QRB.size} height={QRB.size} rx="4" fill="#f1f4fa" stroke="#c6d5ee" strokeWidth="1" strokeDasharray="4 3" />
              <text x={QRB.x + QRB.size / 2} y={QRB.y + QRB.size / 2 + 4} textAnchor="middle" fontFamily={GOTHIC} fontWeight="700" fontSize="10" fill={GRAY}>{t('cert.qr_locked')}</text>
            </>
          ) : (
            qr && qr.dark.map(([r, c], i) => (
              <rect key={i} x={QRB.x + c * qm} y={QRB.y + r * qm} width={qm + 0.3} height={qm + 0.3} fill="#141414" />
            ))
          )}
          <text x={QRB.x + QRB.size / 2} y="438" textAnchor="middle" fontFamily={GOTHIC} fontWeight="400" fontSize="9" fill={GRAY}>진위여부 확인</text>

          {/* 하단 구분선 */}
          <line x1="110" y1="445" x2="636" y2="445" stroke="#cdd8ec" strokeWidth="1" />
          <path d={`M${VB.w / 2} 440 l5 5 l-5 5 l-5 -5 z`} fill="#6f8bc0" />

          {/* 하단 기재값 */}
          {rows.map(([k, v], i) => {
            const y = 477 + i * 16
            return (
              <g key={i}>
                <text x="64" y={y} fontFamily={GOTHIC} fontWeight="700" fontSize="11" fill={FLABEL}>{k}</text>
                <text x="112" y={y} fontFamily={GOTHIC} fontWeight="400" fontSize="11" fill={VAL}>:&#8194;{v}</text>
              </g>
            )
          })}

          {/* 하단 로고 */}
          <image href="/logo.png" x="516" y="457" width="58" height="58" />
          <text x="586" y="493" fontFamily={WORDF} fontWeight="800" fontSize="18" textLength="66" lengthAdjust="spacingAndGlyphs" letterSpacing="0.3" fill={WORD}>CARIS</text>

          {/* 워터마크 오버레이 — 증서 내용 위에 덮는다(맨 마지막 = 최상단) */}
          {preview && (
            <rect x="0" y="0" width={VB.w} height={VB.h} fill="url(#cert-wm)" pointerEvents="none" style={{ userSelect: 'none' }} />
          )}
        </svg>
      </div>

      {issueErr && <p className="cert-issue-err">{issueErr}</p>}

      <div className="cert-actions">
        {preview ? (
          <button className="exam-btn" onClick={issueNow} disabled={issuing}>
            {issuing ? t('cert.issuing') : t('cert.issue_now')}
          </button>
        ) : (
          <button className="exam-btn" onClick={() => window.print()}>{t('cert.print')}</button>
        )}
        <button className="exam-btn-ghost" onClick={() => navigate(-1)}>{t('cert.back')}</button>
      </div>
    </div>
  )
}
