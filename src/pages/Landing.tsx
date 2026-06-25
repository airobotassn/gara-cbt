import { useNavigate } from 'react-router-dom'

// CBT 메인(랜딩) — 레벨테스트 추천검색 제거, 자격검정 응시로 연결
export default function Landing() {
  const navigate = useNavigate()
  return (
    <div className="lp">
      <div className="aura" />
      <h1>
        AI 시대, <span className="em">당신의 실력</span>
        <br />
        GARA 자격검정으로 증명하세요
      </h1>
      <p className="lp-lead">
        글로벌 AI·로봇 협회 공인 CBT 자격검정. PC에서 응시하고, 채점 결과는 일주일 후 공개됩니다.
      </p>
      <button className="cta" onClick={() => navigate('/exam')}>
        자격검정 응시하기 <span className="arr">→</span>
      </button>
    </div>
  )
}
