import { Link } from 'react-router-dom'

// 응시 전 화면(진입·점검·안내) 상단 좌측 홈 이동 — 레벨테스트 TopBar 스타일 칩
export default function HomeLink() {
  return (
    <Link to="/" className="topbar exam-topbar">
      <span className="ic">←</span> 홈으로
    </Link>
  )
}
