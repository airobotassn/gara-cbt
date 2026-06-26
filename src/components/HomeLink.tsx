import { Link } from 'react-router-dom'
import { isSEB } from '../lib/seb'
import { useT } from '../lib/i18n'

// 응시 전 화면 상단 좌측 홈 이동 칩. 단, 보안 브라우저(SEB) 안에서는 숨김(탈출 방지).
export default function HomeLink() {
  const { t } = useT()
  if (isSEB()) return null
  return (
    <Link to="/" className="topbar exam-topbar">
      <span className="ic">←</span> {t('common.home')}
    </Link>
  )
}
