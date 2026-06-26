import HomeLink from '../components/HomeLink'
import { useT } from '../lib/i18n'

// 공지사항 — 현재는 정적. 추후 관리자 등록(DB)로 확장 가능.
const NOTICES = [
  { date: '2026. 06. 25', key: 'item1' },
  { date: '2026. 06. 25', key: 'item2' },
  { date: '2026. 06. 25', key: 'item3' },
]

export default function Notice() {
  const { t } = useT()
  return (
    <div className="wrap page">
      <HomeLink />
      <h1 className="page-title">{t('notice.title')}</h1>
      <div className="notice-list">
        {NOTICES.map((n) => (
          <div key={n.key} className="notice-item">
            <div className="notice-top">
              <b className="notice-title">{t(`notice.${n.key}.title`)}</b>
              <span className="notice-date">{n.date}</span>
            </div>
            <p className="notice-body">{t(`notice.${n.key}.body`)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
