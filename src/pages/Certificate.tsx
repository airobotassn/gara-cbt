import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import HomeLink from '../components/HomeLink'
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

// 한국어 템플릿(public/cert-template.png) — 기준 좌표.
const FIELDS_KO: Field[] = [
  { key: 'name', top: 36.7, left: 55, size: 2.4 },
  { key: 'birth', top: 42.2, left: 55, size: 2.0 },
  { key: 'qual', top: 48.1, left: 55, size: 2.0 },
  { key: 'no', top: 53.8, left: 55, size: 2.0 },
  { key: 'date', top: 59.4, left: 55, size: 2.0 },
  { key: 'reg', top: 91.7, left: 17.5, size: 1.6 },
]

// 언어별 자격증 템플릿. 각 언어 이미지를 public/cert-template-<lang>.png 로 넣고
// 여기에 항목을 추가하면 됨(좌표는 ?cal=1 눈금자로 맞춤). 미정 언어는 ko 로 폴백.
const CERT_TEMPLATES: Record<string, CertTemplate> = {
  ko: { src: '/cert-template.png', fields: FIELDS_KO },
}

export default function Certificate() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { t, lang } = useT()
  const tpl = CERT_TEMPLATES[lang] ?? CERT_TEMPLATES.ko
  const passed = location.state as CertData | null

  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>
  const fallbackName =
    (meta.full_name as string) || (meta.name as string) || user?.email?.split('@')[0] || '응시자'

  const data: CertData = passed ?? {
    name: fallbackName,
    qualification: 'GARA 자격검정',
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
      <HomeLink />

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
