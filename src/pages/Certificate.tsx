import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'

export interface CertData {
  name: string
  qualification: string
  certNo: string
  issueDate: string
  birth?: string
  scoreText?: string
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}`
}

// 템플릿 이미지 위 빈칸 좌표(% 기준 — 미세조정 쉬움).
// top: 행의 세로 중심 %, left: 값 시작 가로 %, size: cqw(이미지폭 대비 %).
type Field = { key: string; top: number; left: number; size: number }
type CertTemplate = { src: string; fields: Field[] }

// 언어별 자격증 템플릿(public/cert-template[-<lang>].png) + 빈칸 좌표.
// 좌표는 ?cal=1 눈금자로 미세조정. 등록번호(reg) 위치는 디자인마다 다름
// (ko/en/ja/hi=하단 좌측, zh/vi=본문 6번째 줄). 미정 언어는 ko 로 폴백.
const CERT_TEMPLATES: Record<string, CertTemplate> = {
  ko: {
    src: '/cert-template.png',
    fields: [
      { key: 'name', top: 36.7, left: 55, size: 2.4 },
      { key: 'birth', top: 42.2, left: 55, size: 2.0 },
      { key: 'qual', top: 48.1, left: 55, size: 2.0 },
      { key: 'no', top: 53.8, left: 55, size: 2.0 },
      { key: 'date', top: 59.4, left: 55, size: 2.0 },
      { key: 'reg', top: 91.7, left: 17.5, size: 1.6 },
    ],
  },
  en: {
    src: '/cert-template-en.png',
    fields: [
      { key: 'name', top: 33.5, left: 55, size: 2.3 },
      { key: 'birth', top: 41.5, left: 55, size: 1.9 },
      { key: 'qual', top: 49.5, left: 55, size: 1.9 },
      { key: 'no', top: 57, left: 55, size: 1.9 },
      { key: 'date', top: 64.5, left: 55, size: 1.9 },
      { key: 'reg', top: 88, left: 27, size: 1.5 },
    ],
  },
  ja: {
    src: '/cert-template-ja.png',
    fields: [
      { key: 'name', top: 38, left: 48, size: 2.3 },
      { key: 'birth', top: 44, left: 48, size: 1.9 },
      { key: 'qual', top: 49.5, left: 48, size: 1.9 },
      { key: 'no', top: 55, left: 48, size: 1.9 },
      { key: 'date', top: 60.5, left: 48, size: 1.9 },
      { key: 'reg', top: 91, left: 16, size: 1.5 },
    ],
  },
  zh: {
    src: '/cert-template-zh.png',
    fields: [
      { key: 'name', top: 36, left: 48, size: 2.2 },
      { key: 'birth', top: 42, left: 48, size: 1.9 },
      { key: 'qual', top: 47.5, left: 48, size: 1.9 },
      { key: 'no', top: 53, left: 48, size: 1.9 },
      { key: 'date', top: 58.5, left: 48, size: 1.9 },
      { key: 'reg', top: 64, left: 48, size: 1.9 },
    ],
  },
  hi: {
    src: '/cert-template-hi.png',
    fields: [
      { key: 'name', top: 38, left: 49, size: 2.2 },
      { key: 'birth', top: 44, left: 49, size: 1.9 },
      { key: 'qual', top: 49.5, left: 49, size: 1.9 },
      { key: 'no', top: 55, left: 49, size: 1.9 },
      { key: 'date', top: 60.5, left: 49, size: 1.9 },
      { key: 'reg', top: 91, left: 20, size: 1.5 },
    ],
  },
  vi: {
    src: '/cert-template-vi.png',
    fields: [
      { key: 'name', top: 36, left: 49, size: 2.2 },
      { key: 'birth', top: 42, left: 49, size: 1.9 },
      { key: 'qual', top: 47.5, left: 49, size: 1.9 },
      { key: 'no', top: 53, left: 49, size: 1.9 },
      { key: 'date', top: 58.5, left: 49, size: 1.9 },
      { key: 'reg', top: 64, left: 49, size: 1.9 },
    ],
  },
}

const CERT_LANGS = [
  { code: 'ko', label: '한국어' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'zh', label: '中文' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'vi', label: 'Tiếng Việt' },
]

export default function Certificate() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { t, lang } = useT()
  const passed = location.state as CertData | null
  // 미리보기(발급 데이터 없음)에서는 6개 언어 버전을 직접 전환해 볼 수 있게.
  const isPreview = !passed
  const [previewLang, setPreviewLang] = useState(lang)
  const activeLang = isPreview ? previewLang : lang
  const tpl = CERT_TEMPLATES[activeLang] ?? CERT_TEMPLATES.ko

  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>
  const fallbackName =
    (meta.full_name as string) || (meta.name as string) || user?.email?.split('@')[0] || '응시자'
  // 미리보기에서 전환한 언어에 맞춰 자격명도 그 언어로 보여줌(고유명 기본값)
  const QUAL_DEFAULT: Record<string, string> = {
    ko: 'GARA 자격검정', en: 'GARA Certification', ja: 'GARA資格検定',
    zh: 'GARA 资格检定', hi: 'GARA प्रमाणन', vi: 'Chứng nhận GARA',
  }

  const data: CertData = passed ?? {
    name: fallbackName,
    qualification: QUAL_DEFAULT[activeLang] ?? QUAL_DEFAULT.ko,
    certNo: 'GARA-2026-000001',
    issueDate: todayStr(),
  }

  const cal = new URLSearchParams(location.search).has('cal') // ?cal=1 → 보정 눈금자

  const values: Record<string, string> = {
    name: data.name,
    birth: data.birth ?? '',
    qual: data.qualification,
    no: data.certNo,
    date: data.issueDate,
    reg: data.certNo,
  }

  return (
    <div className="cert-page">
      {isPreview && (
        <div className="cert-lang-tabs">
          {CERT_LANGS.map((l) => (
            <button
              key={l.code}
              className={activeLang === l.code ? 'on' : ''}
              onClick={() => setPreviewLang(l.code as typeof lang)}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}

      <div className="cert-canvas">
        <img className="cert-bg" src={tpl.src} alt={t('cert.alt')} />
        {cal && (
          <div className="cert-cal">
            {Array.from({ length: 19 }, (_, i) => (i + 1) * 5).map((p) => (
              <div key={`h${p}`} className="cert-cal-h" style={{ top: `${p}%` }}>
                <span>{p}</span>
              </div>
            ))}
            {Array.from({ length: 19 }, (_, i) => (i + 1) * 5).map((p) => (
              <div key={`v${p}`} className="cert-cal-v" style={{ left: `${p}%` }}>
                <span>{p}</span>
              </div>
            ))}
          </div>
        )}
        {tpl.fields.map((f) => (
          <span
            key={f.key}
            className={`cert-ov cert-ov-${f.key}`}
            style={{ top: `${f.top}%`, left: `${f.left}%`, fontSize: `${f.size}cqw` }}
          >
            {values[f.key]}
          </span>
        ))}
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
