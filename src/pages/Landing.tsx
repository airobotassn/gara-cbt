import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'

// CBT 메인(랜딩)
export default function Landing() {
  const navigate = useNavigate()
  const { isFullUser } = useAuth()

  // 시험 로그인이 (Site URL 설정 등으로) 홈으로 떨어져도, '시험 의도' 표식이 있으면 안내 화면으로 자동 이동
  useEffect(() => {
    if (isFullUser && localStorage.getItem('examIntent')) {
      localStorage.removeItem('examIntent')
      navigate('/exam/prepare', { replace: true })
    }
  }, [isFullUser, navigate])

  return (
    <div className="lp">
      <div className="aura" />
      <h1>
        피지컬 AI 시대, <span className="em">당신의 실력</span>
        <br />
        GARA 자격검정으로 증명하세요
      </h1>
      <button className="cta" onClick={() => navigate('/exam')}>
        자격검정 응시하기 <span className="arr">→</span>
      </button>
    </div>
  )
}
