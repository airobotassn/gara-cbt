import { Link } from 'react-router-dom'
import { useT } from '../lib/i18n'

// 내부 화면 공통: 홈으로 (원형 화살표 칩 + 라벨).
export default function TopBar() {
  const { t } = useT()
  return (
    <Link to="/" className="topbar">
      <span className="ic">←</span>
      {t('common.home')}
    </Link>
  )
}
