import { Link } from 'react-router-dom'
import { useT } from '../lib/i18n'

// 전 페이지 공통 푸터 (Stitch GARA Precision 톤). 모든 페이지에서 동일하게 사용.
export default function SiteFooter() {
  const { t } = useT()
  const links = [
    { to: '/guide', key: 'nav.guide' },
    { to: '/notice', key: 'nav.notice' },
    { to: '/faq', key: 'nav.support' },
    { to: '/about', key: 'nav.assoc' },
    { to: '/terms', key: 'nav.terms' },
    { to: '/privacy', key: 'nav.privacy' },
  ] as const
  return (
    <footer className="bg-surface-container-lowest border-t border-outline-variant/40">
      {/* 모바일: 좌하단 고정 FAB(58px)과 콘텐츠가 겹치지 않도록 하단 여백 확보 */}
      <div className="pt-10 pb-28 md:py-10 px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto flex flex-col md:flex-row justify-between items-start gap-6">
        <div className="flex flex-col gap-3">
          <Link to="/" aria-label="GARA 홈으로" className="flex items-center gap-2 w-fit group">
            <img src="/logo.png" alt="GARA" className="h-7 w-7 object-cover rounded-full" />
            <span className="font-title-md text-title-md font-bold text-on-surface group-hover:text-primary transition-colors">GARA</span>
          </Link>
          <p className="font-label-sm text-label-sm text-on-surface-variant">{t('footer.rights')}</p>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2">
          {links.map((l) => (
            <Link
              key={l.to}
              className="font-label-sm text-label-sm text-on-surface-variant hover:text-primary transition-colors"
              to={l.to}
            >
              {t(l.key)}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  )
}
