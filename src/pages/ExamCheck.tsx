import { useNavigate } from 'react-router-dom'
import { isMobileDevice } from '../lib/device'
import MobileBlock from '../components/MobileBlock'
import { isSEB, SEB_INSTALLER_URL } from '../lib/seb'
import { makePracticeExam } from '../lib/practice'

type Check = { ok: boolean; label: string; note: string }

// 시험환경 테스트(사전 점검): 보안 프로그램 설치 + 환경 자동점검 + 모의 1문제
export default function ExamCheck() {
  const navigate = useNavigate()
  if (isMobileDevice()) return <MobileBlock />

  const inSeb = isSEB()
  const checks: Check[] = [
    {
      ok: !isMobileDevice(),
      label: 'PC(데스크톱) 환경',
      note: 'PC에서 접속되었습니다.',
    },
    {
      ok: window.innerWidth >= 1024,
      label: '화면 크기',
      note: window.innerWidth >= 1024 ? '응시에 충분합니다.' : '가로 1024px 이상 화면을 권장합니다.',
    },
    {
      ok: !!document.fullscreenEnabled,
      label: '전체화면 지원',
      note: document.fullscreenEnabled ? '전체화면 응시가 가능합니다.' : '브라우저가 전체화면을 막고 있습니다.',
    },
    {
      ok: navigator.onLine,
      label: '인터넷 연결',
      note: navigator.onLine ? '정상 연결됨.' : '인터넷 연결을 확인하세요.',
    },
  ]

  function startPractice() {
    navigate('/exam/run/practice', { state: makePracticeExam() })
  }

  return (
    <div className="exam-center">
      <div className="exam-card" style={{ maxWidth: 640, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <div className="exam-ico">🧪</div>
          <h2 className="exam-title">시험환경 테스트 (사전 점검)</h2>
          <p className="exam-sub">
            실제 시험 전에 <b>보안 프로그램 설치</b>와 <b>응시 환경</b>을 미리 확인하고,
            <b> 모의 문제</b>를 한 문항 풀어보세요.
          </p>
        </div>

        {/* 1단계: 설치 */}
        <section className="check-sec">
          <div className="check-sec-head">
            <span className="check-sec-no">1</span>
            <h3>보안 프로그램(Safe Exam Browser) 설치</h3>
          </div>
          <p className="check-sec-desc">
            GARA 자격검정은 화면 캡처·복사·다른 프로그램을 차단하는 <b>보안 시험 프로그램</b>에서 진행됩니다.
            이 프로그램은 스위스 취리히공대(ETH)가 만든 공식 오픈소스로, 전 세계 대학·시험기관이 사용합니다.
          </p>
          <a className="exam-btn" href={SEB_INSTALLER_URL} download style={{ display: 'inline-block', marginTop: 6 }}>
            보안 프로그램 설치 파일 받기
          </a>
          <p className="check-note">
            · 설치 시 Windows가 <b>“게시자: ETH Zürich”</b> 로 표시되면 정상입니다.<br />
            · “Windows가 PC를 보호했습니다” 창이 뜨면 <b>추가 정보 → 실행</b> 을 누르세요. (정상 설치 과정)
          </p>
        </section>

        {/* 2단계: 자동 점검 */}
        <section className="check-sec">
          <div className="check-sec-head">
            <span className="check-sec-no">2</span>
            <h3>응시 환경 자동 점검</h3>
          </div>
          <ul className="check-list">
            {checks.map((c) => (
              <li key={c.label} className={c.ok ? 'ok' : 'no'}>
                <span className="ic">{c.ok ? '✓' : '✕'}</span>
                <span className="lab">{c.label}</span>
                <span className="note">{c.note}</span>
              </li>
            ))}
            <li className={inSeb ? 'ok' : 'info'}>
              <span className="ic">{inSeb ? '✓' : 'ℹ'}</span>
              <span className="lab">보안 브라우저(SEB)</span>
              <span className="note">
                {inSeb
                  ? '보안 브라우저로 열렸습니다.'
                  : '실제 시험은 보안 브라우저로 열어야 합니다. (모의 문제는 일반 브라우저로도 가능)'}
              </span>
            </li>
          </ul>
          <p className="check-note">
            · <b>모니터 수</b>는 보안 브라우저 실행 시 자동 점검됩니다. 외부 모니터는 <b>1대만</b> 연결하세요.
          </p>
        </section>

        {/* 3단계: 모의 문제 */}
        <section className="check-sec">
          <div className="check-sec-head">
            <span className="check-sec-no">3</span>
            <h3>모의 문제 풀어보기</h3>
          </div>
          <p className="check-sec-desc">
            실제 시험과 <b>똑같은 화면</b>으로 한 문항을 풀어보며 조작에 익숙해지세요. (채점되지 않습니다)
          </p>
          <button className="exam-btn" onClick={startPractice} style={{ marginTop: 6 }}>
            모의 문제 시작
          </button>
        </section>

        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <button className="exam-btn-ghost" onClick={() => navigate('/exam')}>
            자격검정으로 돌아가기
          </button>
        </div>
      </div>
    </div>
  )
}
