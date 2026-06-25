import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import HomeLink from '../components/HomeLink'

export interface CertData {
  name: string
  qualification: string // 자격종목
  certNo: string // 자격번호
  issueDate: string // 발급일 (YYYY. MM. DD)
  scoreText?: string // 성적 (선택)
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}`
}

// 합격 시 자격증(상장형) — 이름 등 자동 입력 + PDF 저장(인쇄)
export default function Certificate() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const passed = location.state as CertData | null

  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>
  const fallbackName =
    (meta.full_name as string) || (meta.name as string) || user?.email?.split('@')[0] || '응시자'

  // state 가 없으면(직접 방문) 샘플 데이터로 미리보기
  const data: CertData = passed ?? {
    name: fallbackName,
    qualification: 'GARA 자격검정',
    certNo: 'GARA-2026-000001',
    issueDate: todayStr(),
    scoreText: undefined,
  }

  const verifyUrl = `https://gara-cbt.airobotassn.workers.dev/cert/${encodeURIComponent(data.certNo)}`
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=90x90&margin=0&data=${encodeURIComponent(verifyUrl)}`

  return (
    <div className="cert-page">
      <HomeLink />

      <div className="cert-paper">
        <div className="cert-frame">
          <div className="cert-no">No. {data.certNo}</div>

          <div className="cert-emblem">
            <span className="cert-emblem-in">GARA</span>
          </div>

          <h1 className="cert-title">자&nbsp;격&nbsp;증</h1>
          <div className="cert-sub">CERTIFICATE OF QUALIFICATION</div>

          <div className="cert-fields">
            <div className="cert-row"><span>성&emsp;명</span><b>{data.name}</b></div>
            <div className="cert-row"><span>자격종목</span><b>{data.qualification}</b></div>
            <div className="cert-row"><span>자격번호</span><b>{data.certNo}</b></div>
            {data.scoreText && (
              <div className="cert-row"><span>성&emsp;적</span><b>{data.scoreText}</b></div>
            )}
            <div className="cert-row"><span>발급일자</span><b>{data.issueDate}</b></div>
          </div>

          <p className="cert-body">
            위 사람은 <b>글로벌 AI·로봇 협회</b>가 시행한 <b>{data.qualification}</b>에
            합격하였으므로 이 증서를 수여합니다.
          </p>

          <div className="cert-foot">
            <div className="cert-issue-date">{data.issueDate}</div>
            <div className="cert-org">
              <div className="cert-org-name">글로벌 AI·로봇 협회</div>
              <div className="cert-org-en">Global AI &amp; Robotics Association</div>
              <div className="cert-ceo">
                회&emsp;장&emsp;&emsp;&emsp;&emsp;&emsp;<span className="cert-seal">印</span>
              </div>
            </div>
          </div>

          <img className="cert-qr" src={qrSrc} alt="인증 QR" />
        </div>
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
