import { Link } from 'react-router-dom'

// 전 페이지 공통 푸터 (Stitch GARA Precision 톤). 모든 페이지에서 동일하게 사용.
export default function SiteFooter() {
  return (
    <footer className="bg-surface-container-lowest border-t border-outline-variant/40">
      <div className="py-10 px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto flex flex-col md:flex-row justify-between items-start gap-6">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="GARA" className="h-7 w-7 object-contain" />
            <span className="font-title-md text-title-md font-bold text-on-surface">GARA</span>
          </div>
          <p className="font-label-sm text-label-sm text-on-surface-variant">© 2024 GARA. All rights reserved. (주)GARA 자격검정사업단</p>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2">
          <Link className="font-label-sm text-label-sm text-on-surface-variant hover:text-primary transition-colors" to="/guide">자격검정 안내</Link>
          <Link className="font-label-sm text-label-sm text-on-surface-variant hover:text-primary transition-colors" to="/notice">공지사항</Link>
          <Link className="font-label-sm text-label-sm text-on-surface-variant hover:text-primary transition-colors" to="/faq">고객센터</Link>
          <Link className="font-label-sm text-label-sm text-on-surface-variant hover:text-primary transition-colors" to="/about">협회 소개</Link>
          <Link className="font-label-sm text-label-sm text-on-surface-variant hover:text-primary transition-colors" to="/terms">이용약관</Link>
          <Link className="font-label-sm text-label-sm text-on-surface-variant hover:text-primary transition-colors" to="/privacy">개인정보처리방침</Link>
        </nav>
      </div>
    </footer>
  )
}
