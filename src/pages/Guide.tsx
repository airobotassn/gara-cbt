import { useNavigate } from 'react-router-dom'
import HomeLink from '../components/HomeLink'
import { TOTAL_QUESTIONS, TEST_DURATION_MINUTES, RESULT_RELEASE_DAYS } from '../lib/testConfig'

// 자격안내 — GARA 자격검정 소개
export default function Guide() {
  const navigate = useNavigate()
  return (
    <div className="wrap page">
      <HomeLink />
      <h1 className="page-title">GARA 자격검정 안내</h1>
      <p className="page-lead">글로벌 AI·로봇 협회가 시행하는 공인 CBT 자격검정입니다. AI 활용 능력을 객관적으로 평가합니다.</p>

      <section className="page-sec">
        <h2>평가 영역</h2>
        <ul className="page-ul">
          <li><b>AI 활용 · 기초</b> — AI 개념과 활용 전반</li>
          <li><b>데이터 · 전처리</b> — 데이터 이해와 가공</li>
          <li><b>모델 · 학습</b> — 모델 원리와 학습 과정</li>
          <li><b>윤리 · 보안</b> — AI 윤리와 데이터 보안</li>
          <li><b>실무 · 적용</b> — 현업 적용 사례</li>
        </ul>
      </section>

      <section className="page-sec">
        <h2>시험 구성</h2>
        <ul className="page-ul">
          <li>문항 수: <b>{TOTAL_QUESTIONS}문항</b> (4지선다 객관식)</li>
          <li>시험 시간: <b>{TEST_DURATION_MINUTES}분</b></li>
          <li>합격 기준: <b>전체 문항의 60% 이상</b> 정답</li>
          <li>결과 발표: 제출 <b>{RESULT_RELEASE_DAYS}일 후</b> 마이페이지에서 확인</li>
        </ul>
      </section>

      <section className="page-sec">
        <h2>응시 방법</h2>
        <ul className="page-ul">
          <li><b>PC(데스크톱·노트북) 전용</b> — 모바일·태블릿 불가</li>
          <li>화면 캡처·복사·이탈을 차단하는 <b>보안 브라우저(SEB)</b>로 응시</li>
          <li>응시 전 <b>시험환경 테스트</b>로 설치·환경을 미리 점검할 수 있습니다</li>
        </ul>
      </section>

      <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
        <button className="exam-btn" onClick={() => navigate('/exam')}>자격검정 응시하기 →</button>
        <button className="exam-btn-ghost" onClick={() => navigate('/exam/check')}>시험환경 테스트</button>
      </div>
    </div>
  )
}
