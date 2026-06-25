import { useNavigate } from 'react-router-dom'

// CBT 는 PC 전용. 모바일/태블릿 진입 시 안내.
export default function MobileBlock() {
  const navigate = useNavigate()
  return (
    <div className="exam-center">
      <div className="exam-card" style={{ textAlign: 'center', maxWidth: 460 }}>
        <div className="exam-ico">🖥️</div>
        <h2 className="exam-title">PC에서만 응시할 수 있습니다</h2>
        <p className="exam-sub">
          GARA 자격검정은 보안·화면 구성을 위해 <b>데스크톱/노트북</b>에서만 응시할 수 있습니다.
          모바일·태블릿에서는 시험을 시작할 수 없습니다.
        </p>
        <button className="exam-btn-ghost" style={{ marginTop: 18 }} onClick={() => navigate('/')}>
          홈으로
        </button>
      </div>
    </div>
  )
}
