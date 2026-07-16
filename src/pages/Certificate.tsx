import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'
import { qrMatrix } from '../lib/qr'

export interface CertData {
  name: string
  qualification: string
  certNo: string
  issueDate: string
  birth?: string
  scoreText?: string
  verifyToken?: string // QR 진위확인 토큰(발급된 실제 자격증에만)
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}`
}

// 서체 역할: kr=명조(한/중/일), lat=개러몬드(라틴), dev=데바나가리(힌디는 내장 폰트 없어 시스템)
const F = {
  kr: "'CertMyeongjo','Batang','Yu Mincho','SimSun',serif",
  lat: "'CertGaramond','CertMyeongjo','Georgia',serif",
  dev: "'Nirmala UI','CertMyeongjo',serif",
} as const
const SANS = "'Malgun Gothic','Segoe UI',sans-serif"

type CLang = 'ko' | 'en' | 'ja' | 'zh' | 'hi' | 'vi'
type CertText = {
  title: string
  titleSize: number
  titleSpacing: number
  titleFont: keyof typeof F
  sub: string
  font: keyof typeof F
  labelSize: number
  labels: [string, string, string, string, string]
  nameSpacing: number
  body1: string
  body2: string
  presTitle: string
  presName: string
  presNameSpacing: number
  regPrefix: string
  verifyCaption: string // QR 하단 안내
}

// 자격증 위 고정 문구(언어별). 값(이름·자격명·번호·날짜)은 CertData 에서 주입.
const CERT_TEXT: Record<CLang, CertText> = {
  ko: {
    title: '자격증', titleSize: 130, titleSpacing: 76, titleFont: 'kr',
    sub: 'CERTIFICATE OF QUALIFICATION', font: 'kr', labelSize: 33,
    labels: ['성  명', '생년월일', '자 격 명', '자격번호', '취 득 일'], nameSpacing: 6,
    body1: '위 사람은 글로벌 AI·로봇 협회가 시행한',
    body2: 'CARIS 자격검정에 합격하였으므로 이 증서를 수여합니다.',
    presTitle: '협회장', presName: '황모아', presNameSpacing: 18, regPrefix: '등록번호 : ',
    verifyCaption: '스캔하여 진위 확인',
  },
  en: {
    title: 'CERTIFICATE', titleSize: 92, titleSpacing: 12, titleFont: 'lat',
    sub: 'OF QUALIFICATION', font: 'lat', labelSize: 28,
    labels: ['Name', 'Date of Birth', 'Qualification', 'Certificate No.', 'Date of Issue'], nameSpacing: 2,
    body1: 'This certifies that the person named above has passed',
    body2: 'the CARIS qualification examination held by the Global AI & Robotics Association.',
    presTitle: 'President', presName: 'Hwang Moa', presNameSpacing: 3, regPrefix: 'Reg. No. : ',
    verifyCaption: 'Scan to verify',
  },
  ja: {
    title: '資格証', titleSize: 130, titleSpacing: 76, titleFont: 'kr',
    sub: 'CERTIFICATE OF QUALIFICATION', font: 'kr', labelSize: 33,
    labels: ['氏  名', '生年月日', '資 格 名', '資格番号', '取 得 日'], nameSpacing: 6,
    body1: '上記の者は、グローバルAI・ロボット協会が実施した',
    body2: 'CARIS資格検定に合格したことをここに証します。',
    presTitle: '会長', presName: 'ファン・モア', presNameSpacing: 5, regPrefix: '登録番号 : ',
    verifyCaption: 'スキャンして真偽確認',
  },
  zh: {
    title: '资格证', titleSize: 130, titleSpacing: 76, titleFont: 'kr',
    sub: 'CERTIFICATE OF QUALIFICATION', font: 'kr', labelSize: 33,
    labels: ['姓  名', '出生日期', '资格名称', '资格编号', '取得日期'], nameSpacing: 6,
    body1: '兹证明上述人员已通过全球AI·机器人协会举办的',
    body2: 'CARIS资格检定，特颁发此证书。',
    presTitle: '会长', presName: 'Hwang Moa', presNameSpacing: 3, regPrefix: '注册编号 : ',
    verifyCaption: '扫码验证真伪',
  },
  hi: {
    title: 'प्रमाण पत्र', titleSize: 76, titleSpacing: 4, titleFont: 'dev',
    sub: 'CERTIFICATE OF QUALIFICATION', font: 'dev', labelSize: 28,
    labels: ['नाम', 'जन्म तिथि', 'योग्यता', 'प्रमाणपत्र सं.', 'प्राप्ति तिथि'], nameSpacing: 2,
    body1: 'प्रमाणित किया जाता है कि उपर्युक्त व्यक्ति ने ग्लोबल AI·रोबोट एसोसिएशन',
    body2: 'द्वारा आयोजित CARIS योग्यता परीक्षा उत्तीर्ण की है।',
    presTitle: 'अध्यक्ष', presName: 'Hwang Moa', presNameSpacing: 3, regPrefix: 'पंजीकरण सं. : ',
    verifyCaption: 'सत्यापन हेतु स्कैन करें',
  },
  vi: {
    title: 'CHỨNG CHỈ', titleSize: 88, titleSpacing: 10, titleFont: 'lat',
    sub: 'CERTIFICATE OF QUALIFICATION', font: 'lat', labelSize: 27,
    labels: ['Họ và tên', 'Ngày sinh', 'Tên chứng chỉ', 'Số chứng chỉ', 'Ngày cấp'], nameSpacing: 2,
    body1: 'Chứng nhận người có tên trên đã đạt kỳ thi chứng nhận CARIS',
    body2: 'do Hiệp hội AI·Robot Toàn cầu tổ chức.',
    presTitle: 'Chủ tịch', presName: 'Hwang Moa', presNameSpacing: 3, regPrefix: 'Số đăng ký : ',
    verifyCaption: 'Quét để xác thực',
  },
}

const QUAL_DEFAULT: Record<CLang, string> = {
  ko: 'CARIS 자격검정', en: 'CARIS Certification', ja: 'CARIS資格検定',
  zh: 'CARIS 资格检定', hi: 'CARIS प्रमाणन', vi: 'Chứng nhận CARIS',
}

const CERT_LANGS: { code: CLang; label: string }[] = [
  { code: 'ko', label: '한국어' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'zh', label: '中文' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'vi', label: 'Tiếng Việt' },
]

const LABEL_Y = [384, 442, 503, 562, 621]

export default function Certificate() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { t, lang } = useT()
  const passed = location.state as CertData | null
  // 미리보기(발급 데이터 없음)에서는 6개 언어 버전을 직접 전환.
  const isPreview = !passed
  const [previewLang, setPreviewLang] = useState<CLang>(lang as CLang)
  const activeLang = (isPreview ? previewLang : lang) as CLang
  const T = CERT_TEXT[activeLang] ?? CERT_TEXT.ko

  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>
  const fallbackName =
    (meta.full_name as string) || (meta.name as string) || user?.email?.split('@')[0] || '응시자'

  const data: CertData = passed ?? {
    name: fallbackName,
    qualification: QUAL_DEFAULT[activeLang] ?? QUAL_DEFAULT.ko,
    certNo: 'CA-PRO-2026-0001',
    issueDate: todayStr(),
    verifyToken: 'preview-sample', // 미리보기용(스캔 시 '무효' — 배치 확인용)
  }

  const krPres = activeLang === 'ko' || activeLang === 'ja' || activeLang === 'zh'
  const values = [data.birth ?? '', data.qualification, data.certNo, data.issueDate]

  // QR 진위확인 — 발급된 자격증(verifyToken)만. /verify/<token> 를 인코딩해 SVG에 인라인.
  const qr = data.verifyToken
    ? qrMatrix(`${window.location.origin}/verify/${data.verifyToken}`, 'M')
    : null

  return (
    <div className="cert-page">
      {isPreview && (
        <div className="cert-lang-tabs">
          {CERT_LANGS.map((l) => (
            <button
              key={l.code}
              className={activeLang === l.code ? 'on' : ''}
              onClick={() => setPreviewLang(l.code)}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}

      <div className="cert-canvas">
        <svg viewBox="0 0 1536 1024" className="cert-svg" role="img" aria-label={t('cert.alt')}>
          <image href="/cert-bg.jpg" x="0" y="0" width="1536" height="1024" />

          {/* 제목 */}
          <text x="768" y="230" textAnchor="middle" fontFamily={F[T.titleFont]} fontWeight="800" fontSize={T.titleSize} letterSpacing={T.titleSpacing} fill="#152c55">
            {T.title}
          </text>
          <text x="768" y="288" textAnchor="middle" fontFamily={F.lat} fontWeight="600" fontSize="28" letterSpacing="6" fill="#b8912f">
            {T.sub}
          </text>

          {/* 로고 워드마크(배경엔 엠블럼만 있음) */}
          <text x="310" y="640" textAnchor="middle" fontFamily={SANS} fontWeight="800" fontSize="54" letterSpacing="4" fill="#12294e">GARA</text>
          <text x="310" y="674" textAnchor="middle" fontFamily={SANS} fontWeight="700" fontSize="20" fill="#12294e">Global AI &amp; Robotics Association</text>

          {/* 기재 라벨 */}
          <g fontFamily={F[T.font]} fontWeight="800" fontSize={T.labelSize} fill="#1b3057">
            {T.labels.map((lb, i) => (
              <text key={i} x="752" y={LABEL_Y[i]} textAnchor="end">{lb}</text>
            ))}
            {LABEL_Y.map((y, i) => (
              <text key={i} x="770" y={y}>:</text>
            ))}
          </g>
          {/* 기재 값 */}
          <g fontFamily={F[T.font]} fontWeight="400" fontSize="34" fill="#10254a">
            <text x="802" y="385" fontWeight="800" fontSize="38" letterSpacing={T.nameSpacing}>{data.name}</text>
            {values.map((v, i) => (
              <text key={i} x="802" y={LABEL_Y[i + 1]}>{v}</text>
            ))}
          </g>

          {/* 본문 */}
          <g fontFamily={F[T.font]} fontWeight="800" fontSize="32" fill="#142c55" textAnchor="middle">
            <text x="768" y="725">{T.body1}</text>
            <text x="768" y="777">{T.body2}</text>
          </g>

          {/* 하단 */}
          <text x="768" y="850" textAnchor="middle" fontFamily={SANS} fontWeight="800" fontSize="38" letterSpacing="0.5" fill="#142c55">Global AI &amp; Robotics Association</text>
          <text x="718" y="908" textAnchor="end" fontFamily={krPres ? SANS : F[T.font]} fontWeight="600" fontSize="26" fill="#14284f">{T.presTitle}</text>
          <text x="756" y="910" fontFamily={F[T.font]} fontWeight="800" fontSize="44" letterSpacing={T.presNameSpacing} fill="#14284f">{T.presName}</text>
          <text x="245" y="922" fontFamily={SANS} fontWeight="600" fontSize="23" fill="#2c3f66">{T.regPrefix}{data.certNo}</text>

          {/* QR 진위확인 — 우측 양피지 여백. 남색 격자 + 금박 이중선 프레임(자격증 금테 어휘) + 금박 명조 캡션.
              배경 금테 코너 장식과 겹치지 않게 배치. 발급 자격증만. */}
          {qr && (() => {
            // 우하단 검인 위치 — 6개국어 전부 본문/서명/장식과 겹치지 않는 좌표로 확정.
            const SIZE = 88
            const X = 1108
            const Y = 810
            const m = SIZE / qr.count
            const NAVY = '#16305b'
            const GOLD = '#b8912f'
            const PAD = 12
            const iL = X - PAD
            const iT = Y - PAD
            const iW = SIZE + PAD * 2
            const capY = iT + iW + 34
            const cx = X + SIZE / 2
            return (
              <g>
                {/* 금박 이중선 프레임(자격증 프레임과 동일 어휘) */}
                <rect x={iL - 5} y={iT - 5} width={iW + 10} height={iW + 10} fill="none" stroke={GOLD} strokeWidth={1.4} opacity={0.85} />
                <rect x={iL} y={iT} width={iW} height={iW} fill="none" stroke={GOLD} strokeWidth={0.7} opacity={0.6} />
                {qr.dark.map(([r, c], i) => (
                  <rect key={i} x={X + c * m} y={Y + r * m} width={m + 0.4} height={m + 0.4} fill={NAVY} />
                ))}
                {/* 캡션 — 금박 명조. 위에 작은 마름모(자격증 디바이더 어휘, 폭 무관하게 중앙 고정) */}
                <path d={`M${cx} ${capY - 26} l5.5 5.5 l-5.5 5.5 l-5.5 -5.5 z`} fill={GOLD} opacity={0.85} />
                <text x={cx} y={capY} textAnchor="middle" fontFamily={F[T.font]} fontWeight="700" fontSize="20" letterSpacing="0.5" fill={GOLD}>{T.verifyCaption}</text>
              </g>
            )
          })()}
        </svg>
      </div>

      <div className="cert-actions">
        <button className="exam-btn" onClick={() => window.print()}>
          {t('cert.print')}
        </button>
        <button className="exam-btn-ghost" onClick={() => navigate(-1)}>
          {t('cert.back')}
        </button>
      </div>
    </div>
  )
}
