import { Link } from 'react-router-dom'
import { useT } from '../lib/i18n'

// 내부 화면 공통: 뒤로가기 (원형 화살표 칩 + 라벨).
//   기본은 홈(/). 아레나 모듈 화면처럼 돌아갈 곳이 다르면 to·label 로 지정한다.
export default function TopBar({ to = '/', label }: { to?: string; label?: string }) {
  const { t } = useT()
  return (
    <Link to={to} className="topbar">
      <span className="ic">←</span>
      {label ?? t('common.home')}
    </Link>
  )
}
