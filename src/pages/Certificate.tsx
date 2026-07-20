import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'
import { qrMatrix } from '../lib/qr'
import { gradeDisplay, fmtCertDate, certExpiryDate } from '../lib/certNo'

// ===== 자격증 = 순수 벡터 SVG(값·문구·급수·워드마크) + logo.png 엠블럼 =====
// 스크린샷 배경 없음. 프레임·네이비바·워터마크는 벡터, 글자는 전부 내장 폰트 벡터 → 배율/인쇄 선명.
// 이름·급수·등록번호·취득일·유효기간은 서버가 내려준 값(CertData)을 주입.
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

export default function Certificate() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { t } = useT()
  const passed = location.state as CertData | null

  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>
  const fallbackName = (meta.full_name as string) || (meta.name as string) || user?.email?.split('@')[0] || '응시자'

  const data: CertData = passed ?? {
    name: user ? fallbackName : '안형준',
    qualification: 'CARIS Pro',
    grade: 'CARIS PRO',
    nameRoman: (meta.name_roman as string) || (user ? undefined : 'Ahn Hyeongjun'),
    certNo: 'CA-PRO-2026-0001',
    issueDate: todayStr(),
    expiryDate: certExpiryDate('CARIS Pro', new Date()),
    verifyToken: 'preview-sample',
  }

  const gradeText = data.grade || gradeDisplay(data.qualification)
  const expiryText = data.expiryDate ?? '무기한'
  const nm = nameFit(data.name)
  const gf = gradeFit(gradeText)
  const rows: [string, string][] = [
    ['등록번호', data.certNo],
    ['취득일', data.issueDate],
    ['유효기간', expiryText],
  ]

  const qr = data.verifyToken ? qrMatrix(`${window.location.origin}/verify/${data.verifyToken}`, 'M') : null
  const QRB = { x: 568, y: 360, size: 64 }
  const qm = qr ? QRB.size / qr.count : 0
  const cn = (px: number, py: number, sx: number, sy: number) => (
    <path key={`${px}-${py}`} d={`M${px + sx * 6} ${py} h${sx * 15} M${px} ${py + sy * 6} v${sy * 15}`} stroke="#8ca6d6" strokeWidth={1} fill="none" />
  )

  return (
    <div className="cert-page">
      <div className="cert-canvas">
        <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="cert-svg" role="img" aria-label={t('cert.alt')}>
          <defs>
            <linearGradient id="cert-bar" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#0a2f74" /><stop offset="0.55" stopColor="#164f9e" /><stop offset="1" stopColor="#2f74cf" />
            </linearGradient>
            <linearGradient id="cert-barhi" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#5b9be6" /><stop offset="1" stopColor="#2f74cf" />
            </linearGradient>
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

          {/* QR 진위확인 */}
          <rect x={QRB.x - 3} y={QRB.y - 3} width={QRB.size + 6} height={QRB.size + 6} fill="#ffffff" />
          {qr && qr.dark.map(([r, c], i) => (
            <rect key={i} x={QRB.x + c * qm} y={QRB.y + r * qm} width={qm + 0.3} height={qm + 0.3} fill="#141414" />
          ))}
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
        </svg>
      </div>

      <div className="cert-actions">
        <button className="exam-btn" onClick={() => window.print()}>{t('cert.print')}</button>
        <button className="exam-btn-ghost" onClick={() => navigate(-1)}>{t('cert.back')}</button>
      </div>
    </div>
  )
}
