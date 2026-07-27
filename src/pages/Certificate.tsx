import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'
import { callFunction } from '../lib/supabase'
import { qrMatrix } from '../lib/qr'
import { gradeDisplay, fmtCertDate, certExpiryDate } from '../lib/certNo'
import type { MyAttemptsResponse } from '../lib/types'

// ===== 자격증 = 확정 시안 PNG(배경·프레임·로고·문구·라벨) + 동적 필드 SVG 오버레이 =====
// 배경 = public/cert-template.png (협회 확정 시안에서 값 5종을 지운 clean 판, 1448×1086).
// 그 위에 서버가 내려준 값(CertData)만 얹는다: ①이름 ②영문이름 ③등록번호 ④취득일 ⑤유효기간
// ⑥급수(BEGINNER/PRO/ELITE…) ⑦진위확인 QR. 좌표는 원본 시안을 픽셀 측정해 맞췄다(스크립트로 bbox 산출).
//
// ⚠️ 미리보기(preview) = 유료 발급 전 견본. 캡처는 웹에서 감지 불가라 "발급 전에는 항상 워터마크"가 유일한 방어.
// 진짜 방어는 QR 진위확인 토큰(verify_token)을 발급 전에는 아예 안 내려주는 것 — 캡처본은 /verify/:token
// 조회가 안 되므로 위조증서임이 증명된다.
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

// 배경 시안 픽셀 크기 = 뷰박스. 아래 좌표는 전부 이 좌표계(px).
const VB = { w: 1448, h: 1086 }
const GOTHIC = "'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif" // 이름·값·캡션
const GRADEF = "'Segoe UI','Malgun Gothic',Arial,sans-serif" // 급수(굵은 산세리프)
// 시안 잉크 색(픽셀 측정)
const INK = '#16181d', ROMAN_C = '#565d6b', GRADE_C = '#123a86', VAL_C = '#33383f', CAP_C = '#6b7280', NAVY = '#16305b'

// 오버레이 앵커(원본 시안 bbox 측정값)
const NAME_Y = 528, NAME_CX = 419
const ROMAN_Y = 636, ROMAN_CX = 419
const GRADE_Y = 540, GRADE_CX = 1064
const ULINE = { y: 576, x1: 179, x2: 661, cx: 420 }
const QRB = { size: 132, x: 1171, y: 636 } // 구분선(y808) 위로 올린 위치
const CAP_Y = 794, CAP_CX = 1236
const VAL_X = 296, VAL_ROWS = [884, 938, 994] // 등록번호/취득일/유효기간 값 baseline (라벨은 배경에 있음)

function todayStr() {
  return fmtCertDate(new Date())
}

// 이름 폭·크기 — 시안 3자(≈122px 높이, 폭 348)에 맞추고, 장문/라틴은 축소.
function nameFit(raw: string): { text: string; size: number; len: number } {
  const s = raw.trim()
  const compact = s.replace(/\s+/g, '')
  const cjk = /[ㄱ-힝぀-ヿ一-鿿]/.test(compact) && !/[A-Za-z]/.test(compact)
  if (cjk) {
    const n = compact.length
    const size = n <= 3 ? 104 : n <= 4 ? 90 : n <= 6 ? 72 : 58
    return { text: compact, size, len: Math.min(n * 100, 460) }
  }
  const size = Math.max(52, Math.min(118, Math.round(660 / Math.max(1, s.length * 0.5))))
  return { text: s, size, len: Math.min(s.length * size * 0.55, 560) }
}
// 급수 — 폰트 크기 고정(시안 BEGINNER 높이), 중앙 정렬. 짧은 급수(PRO)도 같은 크기 유지.
function gradeSize(g: string): number {
  return g.length <= 9 ? 108 : g.length <= 12 ? 88 : 70
}

// 등록번호 마스킹 — 마지막 일련번호 구획만 가린다. 예: CA-PRO-2026-0001 → CA-PRO-2026-••••
function maskCertNo(s: string) {
  return s.replace(/[0-9A-Za-z]+$/, (m) => '•'.repeat(Math.max(4, m.length)))
}
// 급수 표시어 — "CARIS PRO" → "PRO"(시안엔 헤더에 CARIS가 이미 있어 급수 단어만 크게 표기).
function gradeWord(full: string) {
  return full.replace(/^CARIS\s+/i, '').trim().toUpperCase()
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
    qualification: 'CARIS Beginner',
    grade: 'CARIS BEGINNER',
    nameRoman: (meta.name_roman as string) || (user ? undefined : 'Ahn Hyeongjun'),
    certNo: 'CA-BEG-2026-0001',
    issueDate: todayStr(),
    expiryDate: certExpiryDate('CARIS Beginner', new Date()),
    verifyToken: 'preview-sample',
  }

  // 미리보기 판정 — 넘겨받은 state 우선, /certificate/preview 로 직접 들어와도 견본으로 연다.
  // 발급을 마치면(issuedData) 무조건 원본.
  const preview = issuedData ? false : (data.preview ?? location.pathname.endsWith('/preview'))

  const gradeFull = data.grade || gradeDisplay(data.qualification)
  const gradeText = gradeWord(gradeFull)
  const expiryText = data.expiryDate ?? '무기한'
  const nm = nameFit(data.name)
  const gsize = gradeSize(gradeText)
  const shownCertNo = preview ? maskCertNo(data.certNo) : data.certNo
  const values = [shownCertNo, data.issueDate, expiryText]
  // 워터마크 2행: 고정 경고문 + 소유자 식별(이름 · 마스킹 등록번호) — 유출본 추적용
  const wmSub = `${data.name.trim()} · ${shownCertNo}`

  // 미리보기에는 QR 을 만들지 않는다(토큰 자체가 없음) — 캡처본은 진위확인이 불가능해진다.
  const qr = !preview && data.verifyToken ? qrMatrix(`${window.location.origin}/verify/${data.verifyToken}`, 'M') : null
  const qm = qr ? QRB.size / qr.count : 0

  // 발급 = 유료. 💳 결제 플로우가 붙으면 이 함수 첫머리에서 결제 성공을 확인한 뒤 issue 를 호출한다.
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
            {/* 미리보기 워터마크 — 45°에 가까운 대각선 반복 타일. SVG 안이라 화면·확대·인쇄 어디서나 같이 찍힌다. */}
            {preview && (
              <pattern id="cert-wm" x="0" y="0" width="566" height="203" patternUnits="userSpaceOnUse" patternTransform="rotate(-28)">
                <text x="0" y="62" fontFamily={GOTHIC} fontWeight="700" fontSize="37" letterSpacing="3" fill={NAVY} opacity="0.17">{t('cert.wm_notice')}</text>
                <text x="4" y="105" fontFamily={GOTHIC} fontWeight="400" fontSize="24" letterSpacing="0.8" fill={NAVY} opacity="0.15">{wmSub}</text>
              </pattern>
            )}
          </defs>

          {/* 배경 = 확정 시안(값 없는 clean 판) */}
          <image href="/cert-template.png" x="0" y="0" width={VB.w} height={VB.h} />

          {/* ① 이름 + 밑줄 장식(시안엔 있던 밑줄을 재현) */}
          <text x={NAME_CX} y={NAME_Y} textAnchor="middle" fontFamily={GOTHIC} fontWeight="800" fontSize={nm.size} textLength={nm.len} lengthAdjust="spacingAndGlyphs" fill={INK}>{nm.text}</text>
          <line x1={ULINE.x1} y1={ULINE.y} x2={ULINE.x2} y2={ULINE.y} stroke="#8fa8d4" strokeWidth="1.6" />
          <path d={`M${ULINE.cx} ${ULINE.y - 6} l7 6 l-7 6 l-7 -6 z`} fill={NAVY} />
          {/* ② 영문 이름 */}
          {data.nameRoman && (
            <text x={ROMAN_CX} y={ROMAN_Y} textAnchor="middle" fontFamily={GOTHIC} fontWeight="400" fontSize="30" letterSpacing="1.5" fill={ROMAN_C}>{data.nameRoman}</text>
          )}

          {/* ⑥ 급수 */}
          <text x={GRADE_CX} y={GRADE_Y} textAnchor="middle" fontFamily={GRADEF} fontWeight="700" fontSize={gsize} letterSpacing="1" fill={GRADE_C}>{gradeText}</text>

          {/* ⑦ QR 진위확인 — 미리보기는 토큰이 없어 자리만 잠금 표시(캡처해도 진위확인 불가) */}
          <rect x={QRB.x - 6} y={QRB.y - 6} width={QRB.size + 12} height={QRB.size + 12} rx="4" fill="#ffffff" />
          {preview ? (
            <>
              <rect x={QRB.x} y={QRB.y} width={QRB.size} height={QRB.size} rx="4" fill="#f1f4fa" stroke="#c6d5ee" strokeWidth="1.4" strokeDasharray="7 5" />
              <text x={QRB.x + QRB.size / 2} y={QRB.y + QRB.size / 2 + 6} textAnchor="middle" fontFamily={GOTHIC} fontWeight="700" fontSize="16" fill={CAP_C}>{t('cert.qr_locked')}</text>
            </>
          ) : (
            qr && qr.dark.map(([r, c], i) => (
              <rect key={i} x={QRB.x + c * qm} y={QRB.y + r * qm} width={qm + 0.4} height={qm + 0.4} fill="#141414" />
            ))
          )}
          {/* "진위여부 확인" 캡션(시안 그대로 재현) */}
          <text x={CAP_CX} y={CAP_Y} textAnchor="middle" fontFamily={GOTHIC} fontWeight="400" fontSize="21" fill={CAP_C}>진위여부 확인</text>

          {/* ③④⑤ 하단 기재값 — 라벨(등록번호/취득일/유효기간)은 배경에 있고, 값만 콜론 뒤에 얹는다 */}
          {values.map((v, i) => (
            <text key={i} x={VAL_X} y={VAL_ROWS[i]} fontFamily={GOTHIC} fontWeight="400" fontSize="32" fill={VAL_C}>{v}</text>
          ))}

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
