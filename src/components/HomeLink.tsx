import { Link } from 'react-router-dom'

// 응시 전 화면(진입·점검·안내) 좌상단 홈 이동 링크
export default function HomeLink() {
  return (
    <Link to="/" className="exam-home">
      ← 홈
    </Link>
  )
}
