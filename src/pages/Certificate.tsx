import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'
import { callFunction } from '../lib/supabase'
import { qrMatrix } from '../lib/qr'
import { gradeDisplay, fmtCertDate, certExpiryDate, makeCertNo, gradeOfTitle } from '../lib/certNo'
import type { MyAttemptsResponse } from '../lib/types'

// ===== 인증서 = 확정 시안 PNG(배경·프레임·로고·문구·라벨) + 동적 필드 SVG 오버레이 =====
// 배경 = public/cert-template-v2.png (2026-08 협회 신규 시안 — 좌측 다크 패널 + 우측 영문 서식, 1448×1086).
// 그 위에 값만 얹는다: ①영문 성명 ②급수 ③Certificate ID ④Issue Date ⑤Valid Until ⑥진위확인 QR.
// 좌표는 템플릿을 픽셀 계측해 뽑았다(scratchpad/measure-cert-v2.mjs — 잉크 있는 행 구간 = 기존 텍스트 줄).
// ⚠️ 이름은 **영문만** 각인한다(신규 시안이 영문 서식). 값은 발급 신청 화면에서 입력받아
//    exam_attempts.cert_name_roman 에 저장된 스냅샷 — 자동 로마자 변환은 하지 않는다(성씨 표기가 제각각).
//
// ⚠️ 발급(결제) 전에는 인증서를 **아예 렌더하지 않는다**(preview=true → 결제 유도 화면만).
// 옛 방식(워터마크 얹은 견본 노출)은 캡처 한 장이면 쓸 만한 이미지가 남아 결제할 이유가 약했다.
// 지금은 결제 전 화면에 증서 픽셀 자체가 존재하지 않고, QR 진위확인 토큰(verify_token)도 발급 후에만
// 내려온다 — 어떤 캡처본도 /verify/:token 조회가 안 되므로 위조증서임이 증명된다.
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
  preview?: boolean // true = 발급(결제) 전 — 인증서 대신 결제 유도 화면
  attemptId?: string // 결제 유도 화면 → 발급 전환에 필요(응시 기록 id)
  sample?: boolean // true = 디자인 견본 — 더미 인물 + 진한 워터마크(개인정보·QR 없음)
  gate?: CertData // 견본 화면의 '발급 신청' CTA 가 넘길 결제 게이트 state
}

// 견본에 쓰는 더미 인물 — 실제 응시자 정보는 견본에 싣지 않는다(캡처 유출 시에도 새어나갈 개인정보 0).
// 급수만 진입한 카드의 급수를 따라간다(급수는 시험명이라 개인정보가 아니고, 견본의 목적이 "내 급수 증서 모양"이라서).
const SAMPLE_NAME = '홍길동'
const SAMPLE_ROMAN = 'Gildong Hong' // 각인 순서 = 이름 성
const SAMPLE_SEQ = 0 // makeCertNo 가 0001 로 채운다 — 예시 번호임이 드러나게

// 배경 시안 픽셀 크기 = 뷰박스. 아래 좌표는 전부 이 좌표계(px).
const VB = { w: 1448, h: 1086 }
const SANS = "'Segoe UI','Malgun Gothic',Arial,sans-serif" // 값·캡션(템플릿의 ID 라벨과 같은 계열)
const SERIF = "CariSerif,'Times New Roman',serif" // 이름·급수(템플릿 본문 세리프와 같은 계열, cert.css @font-face)
// 템플릿 잉크색(픽셀 측정: 본문 #000, 바탕 #f2f2f1, 좌측 패널 #011027)
const INK = '#0a0a0a', GRADE_C = '#0b2a6b', VAL_C = '#1a1a1a', CAP_C = '#555b66'
const WM_C = '#8b93a3' // 견본 워터마크 — 밝은 우측·어두운 좌측 어디서나 보이는 중간 회색

// 오버레이 앵커 — 우측 흰 패널 기준(계측값):
//   "This is to certify that" y284~304 · "has successfully…" y426~449 · 라벨 3줄 y678~770(콜론 끝 x746)
//   · GARA 푸터 y965~1000. 패널 중심 x = 928.
const CX = 928 // 우측 패널 가로 중심
const NAME_Y = 388 // 이름 baseline (빈 구간 304~426 의 시각 중앙)
const GRADE_Y = 592 // 급수 baseline (빈 구간 449~678)
const VAL_X = 775 // 값 시작 x (콜론 x746 뒤)
const VAL_ROWS = [694, 733, 770] // Certificate ID / Issue Date / Valid Until 값 baseline
const QRB = { size: 130, x: 1180, y: 655 } // 값 블록 오른쪽 빈 공간(푸터 y965 위)
const CAP_CX = 1245, CAP_Y = 823 // '진위여부 확인' 캡션

function todayStr() {
  return fmtCertDate(new Date())
}

// 영문 성명 — 패널 폭(약 760px)에 맞춰 크기를 줄인다. 세리프 평균 자폭 ≈ 0.5em 기준.
function romanFit(raw: string): { text: string; size: number } {
  const s = raw.trim().replace(/\s+/g, ' ')
  const size = Math.max(38, Math.min(72, Math.round(760 / Math.max(1, s.length * 0.52))))
  return { text: s, size }
}
// 급수 표시어 — "CARIS PRO" → "PRO". 좌측 패널에 CARIS 로고가 이미 크게 있어 급수 단어만 각인한다(옛 시안과 동일).
function gradeWord(full: string) {
  return full.replace(/^CARIS\s+/i, '').trim().toUpperCase()
}
function gradeSize(g: string): number {
  return g.length <= 8 ? 86 : g.length <= 12 ? 74 : 62
}

// 등록번호 마스킹 — 결제 유도 화면에서 마지막 일련번호 구획만 가린다. 예: CA-PRO-2026-0001 → CA-PRO-2026-••••
function maskCertNo(s: string) {
  return s.replace(/[0-9A-Za-z]+$/, (m) => '•'.repeat(Math.max(4, m.length)))
}
// 영문 성명 형식 — 여권 표기 관행(라틴 문자·공백·하이픈·아포스트로피·마침표). 서버와 같은 규칙.
// 서버(my-attempts)는 합쳐진 한 줄만 검증하므로, 아래 합성 결과가 이 규칙을 만족해야 한다.
const ROMAN_RE = /^[A-Za-z][A-Za-z .'-]{1,39}$/
// 성·이름 각 칸 — 한 칸 안에도 공백이 올 수 있다(Van Der Berg · Mary Jane). 첫 글자는 라틴 문자.
const ROMAN_PART_RE = /^[A-Za-z][A-Za-z .'-]{0,38}$/
// 입력 두 칸 → 증서에 각인할 한 줄. ⚠️ 순서는 **이름 성**(2026-08-04 지시) — 화면 입력 순서(성→이름)와 반대다.
function joinRoman(first: string, last: string) {
  return `${first.trim()} ${last.trim()}`.trim().replace(/\s+/g, ' ')
}

// 견본 데이터 — 급수만 승계하고 인물·번호·날짜는 전부 예시값으로 갈아끼운다.
function sampleCert(base: CertData): CertData {
  const gradeFull = base.grade || gradeDisplay(base.qualification)
  const now = new Date()
  return {
    name: SAMPLE_NAME,
    nameRoman: SAMPLE_ROMAN, // 증서에 실제로 찍히는 이름(견본은 더미)
    qualification: gradeFull,
    grade: gradeFull,
    certNo: makeCertNo(gradeOfTitle(gradeFull), now.getFullYear(), SAMPLE_SEQ),
    issueDate: fmtCertDate(now),
    expiryDate: certExpiryDate(gradeFull, now),
    sample: true,
    gate: base.gate,
  }
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
  // 발급 신청 화면에서 입력받는 영문 성명 — 증서에 각인되는 유일한 이름이다.
  // 성·이름을 따로 받는다: 여권 표기를 옮겨 적을 때 어디까지가 성인지 사람마다 달라 한 칸이면 순서가 뒤죽박죽이 된다.
  const [lastDraft, setLastDraft] = useState('')
  const [firstDraft, setFirstDraft] = useState('')
  // 발급 직전 각인 확인 — 이름은 발급 후 못 고치므로 결제 버튼과 실제 발급 사이에 한 단계 둔다.
  const [confirming, setConfirming] = useState(false)
  const romanJoined = joinRoman(firstDraft, lastDraft)
  const romanOk =
    ROMAN_PART_RE.test(lastDraft.trim()) && ROMAN_PART_RE.test(firstDraft.trim()) && ROMAN_RE.test(romanJoined)

  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>
  const fallbackName = (meta.full_name as string) || (meta.name as string) || user?.email?.split('@')[0] || '응시자'

  const baseData: CertData = issuedData ?? passed ?? {
    name: user ? fallbackName : '안형준',
    qualification: 'CARIS Beginner',
    grade: 'CARIS BEGINNER',
    // 개발용 미리보기(state 없이 /certificate 직접 진입)엔 영문 이름이 없으므로 예시값을 채운다(이름 성 순).
    nameRoman: (meta.name_roman as string) || 'Hyeongjun Ahn',
    certNo: 'CA-BEG-2026-0001',
    issueDate: todayStr(),
    expiryDate: certExpiryDate('CARIS Beginner', new Date()),
    verifyToken: 'preview-sample',
  }

  // 견본(sample) 판정 — 발급을 마쳤으면(issuedData) 견본이 아니라 내 원본을 본다.
  const sample = !issuedData && ((baseData.sample ?? false) || location.pathname.endsWith('/sample'))
  const data: CertData = sample ? sampleCert(baseData) : baseData

  // 발급 전(=결제 전) 판정 — 넘겨받은 state 우선, /certificate/preview 로 직접 들어와도 결제 유도 화면.
  // 견본은 결제 게이트가 아니라 증서를 보여주는 화면이라 제외한다.
  const preview = issuedData || sample ? false : (data.preview ?? location.pathname.endsWith('/preview'))

  const gradeFull = data.grade || gradeDisplay(data.qualification)
  const expiryText = data.expiryDate ?? '무기한'
  // 인증서에 각인되는 이름 = 영문 성명 하나뿐(신규 시안이 영문 서식).
  const nm = romanFit(data.nameRoman ?? '')
  const gradeText = gradeWord(gradeFull)
  const gsize = gradeSize(gradeText)
  const values = [data.certNo, data.issueDate, expiryText]

  // QR 은 발급 후에만(토큰이 발급 시점에 생긴다).
  const qr = !preview && data.verifyToken ? qrMatrix(`${window.location.origin}/verify/${data.verifyToken}`, 'M') : null
  const qm = qr ? QRB.size / qr.count : 0

  // 발급 버튼 → 바로 발급하지 않고 각인될 이름을 한 번 보여준다.
  // 이유: 이름은 발급 후 수정이 불가능한데, 입력칸 순서(성→이름)와 각인 순서(이름 성)가 반대라
  //       칸을 바꿔 적어도 화면상 티가 안 난다. 굳기 전에 실제로 새겨질 모양 그대로 보여주는 게 유일한 방어선이다.
  function askConfirm() {
    if (!romanOk) {
      setIssueErr(t('cert.roman_invalid'))
      return
    }
    setIssueErr('')
    setConfirming(true)
  }

  // 발급 = 유료. 💳 PG 미연동이라 지금은 "결제 성공"을 가정하고 바로 발급한다(이북 구매와 같은 데모 방식).
  // 결제 연동 시 이 함수 첫머리에 결제창 호출 + 결제 검증을 넣고, 검증 성공 뒤에만 issue 를 호출할 것.
  //   nameRoman = 증서에 각인할 영문 성명. 서버가 형식을 다시 검증하고 발급 스냅샷으로 저장한다.
  async function issueNow() {
    const id = data.attemptId
    if (!id || id === 'preview') {
      setIssueErr(t('cert.issue_no_attempt'))
      return
    }
    const roman = romanJoined
    if (!romanOk) {
      setIssueErr(t('cert.roman_invalid'))
      return
    }
    setIssuing(true)
    setIssueErr('')
    try {
      const r = await callFunction<MyAttemptsResponse>('my-attempts', { issue: id, nameRoman: roman })
      setIssuedData({
        ...data,
        preview: false,
        certNo: r.issued?.certNo ?? data.certNo,
        verifyToken: r.issued?.verifyToken,
        nameRoman: r.issued?.nameRoman ?? roman,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      setIssueErr(/name_roman/.test(msg) ? t('cert.roman_invalid') : msg || t('cert.issue_failed'))
      setConfirming(false) // 확인창을 닫아야 카드 안의 에러 문구가 보인다
    } finally {
      setIssuing(false)
    }
  }

  // ===== 발급(결제) 전 = 결제 유도 화면 — 인증서는 한 픽셀도 그리지 않는다 =====
  // 취득 사실(급수·이름·취득일)과 발급하면 풀리는 것만 알려주고 결제로 보낸다.
  // 등록번호는 뒷자리를 가려 "내 번호가 준비돼 있다"는 것만 전달한다.
  if (preview) {
    return (
      <div className="cert-page cert-gate-page">
        <section className="cert-gate">
          <span className="cert-gate-lock material-symbols-outlined" aria-hidden="true">lock</span>
          <h1 className="cert-gate-title">{t('cert.gate_title', { grade: gradeFull })}</h1>
          <p className="cert-gate-lead">{t('cert.gate_lead')}</p>

          <dl className="cert-gate-meta">
            <div>
              <dt>{t('verify.name')}</dt>
              <dd>{data.name}</dd>
            </div>
            <div>
              <dt>{t('verify.grade')}</dt>
              <dd>{gradeFull}</dd>
            </div>
            <div>
              <dt>{t('cert.gate_acquired')}</dt>
              <dd>{data.issueDate}</dd>
            </div>
            <div>
              <dt>{t('verify.cert_no')}</dt>
              <dd className="cert-gate-masked">{maskCertNo(data.certNo)}</dd>
            </div>
          </dl>

          {/* 영문 성명 — 증서에 각인되는 유일한 이름이라 발급 신청 단계에서 받는다.
              여권 표기와 맞춰 본인이 직접 적는다(자동 로마자 변환 금지: 이 = Lee/Yi/Rhee 로 제각각).
              ⚠️ 입력 순서는 성 → 이름인데 증서 각인은 "이름 성" 이다 — hint 가 그 순서를 밝힌다. */}
          <div className="cert-gate-field">
            <div className="cert-gate-names">
              <div>
                <label htmlFor="cert-roman-last">{t('cert.roman_last_label')}</label>
                <input
                  id="cert-roman-last"
                  value={lastDraft}
                  onChange={(e) => { setLastDraft(e.target.value); setIssueErr('') }}
                  onKeyDown={(e) => { if (e.key === 'Enter') askConfirm() }}
                  placeholder={t('cert.roman_last_ph')}
                  maxLength={20}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={issuing}
                />
              </div>
              <div>
                <label htmlFor="cert-roman-first">{t('cert.roman_first_label')}</label>
                <input
                  id="cert-roman-first"
                  value={firstDraft}
                  onChange={(e) => { setFirstDraft(e.target.value); setIssueErr('') }}
                  onKeyDown={(e) => { if (e.key === 'Enter') askConfirm() }}
                  placeholder={t('cert.roman_first_ph')}
                  maxLength={20}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={issuing}
                />
              </div>
            </div>
            <p className="cert-gate-hint">{t('cert.roman_hint')}</p>
          </div>

          <ul className="cert-gate-perks">
            {[t('cert.gate_perk_pdf'), t('cert.gate_perk_qr'), t('cert.gate_perk_no')].map((p) => (
              <li key={p}>
                <span className="material-symbols-outlined" aria-hidden="true">check_circle</span>
                {p}
              </li>
            ))}
          </ul>

          <p className="cert-gate-paid">{t('cert.gate_paid_note')}</p>
          {issueErr && <p className="cert-issue-err">{issueErr}</p>}

          <div className="cert-gate-actions">
            <button className="exam-btn" onClick={askConfirm} disabled={issuing || !romanOk}>
              {issuing ? t('cert.issuing') : t('cert.gate_pay')}
            </button>
            <button className="exam-btn-ghost" onClick={() => navigate(-1)}>{t('cert.gate_later')}</button>
          </div>
        </section>

        {/* 각인 확인 — 결제/발급 직전 마지막 관문. 실제 증서와 같은 세리프로 같은 순서(이름 성)로 보여준다.
            발급 중에는 배경 클릭으로 못 닫는다(요청은 이미 날아갔는데 창만 사라지면 상태를 오해한다). */}
        {confirming && (
          <div className="cert-confirm-overlay" onClick={() => !issuing && setConfirming(false)}>
            <div
              className="cert-confirm"
              role="dialog"
              aria-modal="true"
              aria-labelledby="cert-confirm-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="cert-confirm-title" className="cert-confirm-title">{t('cert.confirm_title')}</h2>
              <p className="cert-confirm-name">{romanJoined}</p>
              <p className="cert-confirm-note">{t('cert.confirm_note')}</p>
              <div className="cert-confirm-actions">
                <button className="exam-btn" onClick={issueNow} disabled={issuing}>
                  {issuing ? t('cert.issuing') : t('cert.confirm_ok')}
                </button>
                <button className="exam-btn-ghost" onClick={() => setConfirming(false)} disabled={issuing}>
                  {t('cert.confirm_edit')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="cert-page">
      {sample && (
        <div className="cert-sample-note">
          <b>{t('cert.sample_badge')}</b>
          <span>{t('cert.sample_note')}</span>
        </div>
      )}
      <div className="cert-canvas">
        <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="cert-svg" role="img" aria-label={t('cert.alt')}>
          <defs>
            {/* 견본 워터마크 — 대각선 반복 타일. SVG 안이라 화면·확대·인쇄·캡처 어디서나 같이 찍힌다.
                견본은 유출돼도 곤란하지 않을 만큼 진하게(원본과 한눈에 구분). */}
            {sample && (
              <pattern id="cert-wm" x="0" y="0" width="640" height="222" patternUnits="userSpaceOnUse" patternTransform="rotate(-28)">
                {/* 색은 중간 회색 — 신규 시안은 좌측이 짙은 남색이라 네이비 워터마크가 그쪽에서 사라진다.
                    밝은 우측 패널과 어두운 좌측 패널 양쪽에서 다 보이는 중간값을 쓴다. */}
                <text x="0" y="60" fontFamily={SANS} fontWeight="800" fontSize="44" letterSpacing="4" fill={WM_C} opacity="0.42">{t('cert.sample_wm')}</text>
                <text x="4" y="104" fontFamily={SANS} fontWeight="700" fontSize="27" letterSpacing="1.2" fill={WM_C} opacity="0.34">{t('cert.sample_wm_sub')}</text>
              </pattern>
            )}
          </defs>

          {/* 배경 = 신규 시안(값 없는 clean 판) */}
          <image href="/cert-template-v2.png" x="0" y="0" width={VB.w} height={VB.h} />

          {/* ① 영문 성명 — "This is to certify that" 아래 빈 구간 */}
          <text x={CX} y={NAME_Y} textAnchor="middle" fontFamily={SERIF} fontWeight="700" fontSize={nm.size} letterSpacing="1" fill={INK}>{nm.text}</text>

          {/* ② 급수 — "…recognized as a" 아래 빈 구간 */}
          <text x={CX} y={GRADE_Y} textAnchor="middle" fontFamily={SERIF} fontWeight="700" fontSize={gsize} letterSpacing="3" fill={GRADE_C}>{gradeText}</text>

          {/* ③④⑤ Certificate ID / Issue Date / Valid Until — 라벨·콜론은 배경에 있고 값만 얹는다 */}
          {values.map((v, i) => (
            <text key={i} x={VAL_X} y={VAL_ROWS[i]} fontFamily={SANS} fontWeight="400" fontSize="25" fill={VAL_C}>{v}</text>
          ))}

          {/* ⑥ QR 진위확인 — 값 블록 오른쪽 빈 공간. 견본엔 토큰이 없어 자리만 잠금 표시 */}
          {sample ? (
            <>
              <rect x={QRB.x} y={QRB.y} width={QRB.size} height={QRB.size} rx="4" fill="#e9ecf3" stroke="#b9c4d8" strokeWidth="1.4" strokeDasharray="7 5" />
              <text x={QRB.x + QRB.size / 2} y={QRB.y + QRB.size / 2 + 6} textAnchor="middle" fontFamily={SANS} fontWeight="700" fontSize="16" fill={CAP_C}>{t('cert.qr_locked')}</text>
            </>
          ) : (
            qr && qr.dark.map(([r, c], i) => (
              <rect key={i} x={QRB.x + c * qm} y={QRB.y + r * qm} width={qm + 0.4} height={qm + 0.4} fill="#141414" />
            ))
          )}
          <text x={CAP_CX} y={CAP_Y} textAnchor="middle" fontFamily={SANS} fontWeight="400" fontSize="19" fill={CAP_C}>{t('cert.qr_caption')}</text>

          {/* 워터마크 오버레이 — 증서 내용 위에 덮는다(맨 마지막 = 최상단) */}
          {sample && (
            <rect x="0" y="0" width={VB.w} height={VB.h} fill="url(#cert-wm)" pointerEvents="none" style={{ userSelect: 'none' }} />
          )}
        </svg>
      </div>

      <div className="cert-actions">
        {sample ? (
          // 견본은 인쇄할 물건이 아니다 — 대신 결제(발급 신청)로 잇는다.
          data.gate && <button className="exam-btn" onClick={() => navigate('/certificate', { state: data.gate })}>{t('cert.sample_cta')}</button>
        ) : (
          <button className="exam-btn" onClick={() => window.print()}>{t('cert.print')}</button>
        )}
        <button className="exam-btn-ghost" onClick={() => navigate(-1)}>{t('cert.back')}</button>
      </div>
    </div>
  )
}
