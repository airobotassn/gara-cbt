import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { isMobileDevice } from '../lib/device'
import MobileBlock from '../components/MobileBlock'
import HomeLink from '../components/HomeLink'
import { SEB_REQUIRED, isSEB, sebConfigured, sebLaunchUrl, SEB_INSTALLER_URL } from '../lib/seb'
import { TOTAL_QUESTIONS, TEST_DURATION_MINUTES, RESULT_RELEASE_DAYS } from '../lib/testConfig'

// 자격검정 진입 페이지 — "GARA 자격검정" 응시 + 시험환경 테스트
export default function ExamGate() {
  const navigate = useNavigate()
  const { isFullUser, loginWithGoogle } = useAuth()

  if (isMobileDevice()) return <MobileBlock />

  const inSeb = isSEB()
  const needSebLaunch = SEB_REQUIRED && !inSeb

  // 응시 시작: 일반 브라우저면 먼저 SEB 실행(로그인은 SEB 안에서 1번) / SEB 안이면 로그인→안내
  function onStart() {
    if (needSebLaunch) {
      if (!sebConfigured()) {
        alert('보안 브라우저 설정이 준비되지 않았습니다. 잠시 후 다시 시도하거나 관리자에게 문의해 주세요.')
        return
      }
      // SEB 실행 시도 → 2.5초 안에 창 전환(설치돼 열림)이 없으면 미설치로 보고 설치 안내
      let opened = false
      const mark = () => {
        opened = true
      }
      const onVis = () => {
        if (document.hidden) opened = true
      }
      window.addEventListener('blur', mark, { once: true })
      document.addEventListener('visibilitychange', onVis)
      window.location.href = sebLaunchUrl()
      window.setTimeout(() => {
        window.removeEventListener('blur', mark)
        document.removeEventListener('visibilitychange', onVis)
        if (!opened) {
          if (
            window.confirm(
              '보안 브라우저(SEB)가 설치되어 있지 않은 것 같습니다.\n설치 파일을 내려받으시겠습니까?\n(설치 후 다시 「보안 브라우저로 응시 시작」을 눌러주세요)',
            )
          ) {
            // window.open 은 팝업차단에 막힘 → 현재 탭에서 직접 이동(다운로드 시작)
            window.location.href = SEB_INSTALLER_URL
          }
        }
      }, 1500)
      return
    }
    if (isFullUser) {
      navigate('/exam/prepare')
    } else {
      localStorage.setItem('examIntent', '1')
      loginWithGoogle(`${window.location.origin}/auth/callback?next=${encodeURIComponent('/exam/prepare')}`)
    }
  }

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
          <p>• 모바일·태블릿에서는 응시할 수 없으며, <b>PC(데스크톱·노트북)</b>에서만 응시할 수 있습니다.</p>
        </div>

        <button className="exam-btn-xl" onClick={onStart}>
          {needSebLaunch ? '보안 브라우저로 응시 시작' : isFullUser ? 'GARA 자격검정 응시하기' : '로그인 후 응시하기'}
          <span className="arr">→</span>
        </button>
        {!needSebLaunch && (
          <p className="exam-gate-login-hint">
            자격검정은 본인 확인을 위해 구글 로그인 후 응시합니다.
          </p>
        )}

        <button className="exam-gate-check" onClick={() => navigate('/exam/check')}>
          🧪 처음이신가요? 시험환경 테스트(사전 점검) →
        </button>
      </div>
    </div>
  )
}
