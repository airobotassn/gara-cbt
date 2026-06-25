import { useNavigate } from 'react-router-dom'

// 제출 완료 = SEB 종료 URL. 보안 브라우저는 이 주소에 도달하면 자동 종료된다.
export default function ExamDone() {
  const navigate = useNavigate()
  return (
    <div className="exam-center">
      <div className="exam-card" style={{ textAlign: 'center', maxWidth: 460 }}>
        <div className="exam-ico">✅</div>
        <h2 className="exam-title">제출이 완료되었습니다</h2>
        <p className="exam-sub">
          응시가 정상적으로 접수되었습니다. 보안 브라우저는 자동으로 종료됩니다.
          <br />
          채점 결과는 발표일 이후 <b>마이페이지</b>에서 확인할 수 있습니다.
        </p>
        <button className="exam-btn" style={{ marginTop: 18 }} onClick={() => navigate('/')}>
          홈으로
        </button>
      </div>
    </div>
  )
}
