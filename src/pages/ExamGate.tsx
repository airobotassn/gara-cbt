import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { isMobileDevice } from '../lib/device'
import MobileBlock from '../components/MobileBlock'
import HomeLink from '../components/HomeLink'
import { TOTAL_QUESTIONS, TEST_DURATION_MINUTES, RESULT_RELEASE_DAYS } from '../lib/testConfig'

// 자격검정 진입 페이지 — "GARA 자격검정" 응시 + 시험환경 테스트
export default function ExamGate() {
  const navigate = useNavigate()
  const { isFullUser, loginWithGoogle } = useAuth()

  if (isMobileDevice()) return <MobileBlock />

  return (
    <div className="exam-center">
      <HomeLink />
      <div className="exam-gate">
        <div className="exam-gate-badge">GARA</div>
        <h1 className="exam-gate-title">GARA 자격검정</h1>
        <p className="exam-gate-sub">글로벌 AI·로봇 협회 공인 자격검정 (CBT)</p>

        <ul className="exam-gate-meta">
          <li>
            <b>{TOTAL_QUESTIONS}</b>
            <span>문항</span>
          </li>
          <li>
            <b>{TEST_DURATION_MINUTES}</b>
            <span>분</span>
          </li>
          <li>
            <b>4</b>
            <span>지선다</span>
          </li>
        </ul>

        <div className="exam-gate-note">
          <p>• 응시 후 <b>{RESULT_RELEASE_DAYS}일 뒤</b> 채점 결과가 공개됩니다.</p>
          <p>• 시험 중 <b>화면 캡처·복사·이탈</b>은 차단되며 기록됩니다.</p>
          <p>• <b>PC 전용</b> — 모바일·태블릿에서는 응시할 수 없습니다.</p>
        </div>

        {isFullUser ? (
          <button className="exam-btn-xl" onClick={() => navigate('/exam/prepare')}>
            GARA 자격검정 응시하기 <span className="arr">→</span>
          </button>
        ) : (
          <>
            <button className="exam-btn-xl" onClick={() => loginWithGoogle()}>
              로그인 후 응시하기
            </button>
            <p className="exam-gate-login-hint">
              자격검정은 본인 확인을 위해 구글 로그인 후 응시할 수 있습니다.
            </p>
          </>
        )}

        <button className="exam-gate-check" onClick={() => navigate('/exam/check')}>
          🧪 처음이신가요? 시험환경 테스트(사전 점검) →
        </button>
      </div>
    </div>
  )
}
