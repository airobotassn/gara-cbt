import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import HomeLink from '../components/HomeLink'

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

// 템플릿 이미지(public/cert-template.png) 위 빈칸 좌표(% 기준 — 미세조정 쉬움).
// top: 행의 세로 중심 %, left: 값 시작 가로 %, size: cqw(이미지폭 대비 %).
const FIELDS = [
  { key: 'name', top: 35.2, left: 54, size: 2.4 },
  { key: 'birth', top: 42.2, left: 54, size: 2.0 },
  { key: 'qual', top: 49.2, left: 54, size: 2.0 },
  { key: 'no', top: 56.2, left: 54, size: 2.0 },
  { key: 'date', top: 63.2, left: 54, size: 2.0 },
  { key: 'reg', top: 91.0, left: 13, size: 1.6 },
] as const

export default function Certificate() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
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
        <img className="cert-bg" src="/cert-template.png" alt="자격증" />
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
        {FIELDS.map((f) => (
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
          📄 PDF로 저장 / 인쇄
        </button>
        <button className="exam-btn-ghost" onClick={() => navigate('/')}>
          홈으로
        </button>
      </div>
    </div>
  )
}
