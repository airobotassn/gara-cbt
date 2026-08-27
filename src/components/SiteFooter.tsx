import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { useSiteSettings } from '../lib/siteSettings'

// 전 페이지 공통 푸터 (Stitch GARA Precision 톤). 모든 페이지에서 동일하게 사용.
export default function SiteFooter() {
  const { t } = useT()
  const ref = useRef<HTMLElement>(null)
  // 사업자 정보 — 관리자(홈페이지 관리 > 사이트 정보)가 입력한 값. 결제를 받는 사이트는 표기 의무가 있다.
  const s = useSiteSettings()

  // 좌하단 FAB 이 푸터를 덮지 않도록, 푸터가 올라오면 그 위에서 멈추게 한다.
  //   푸터가 화면에 보이는 높이만큼 --fab-bottom 을 올려주면 fab.css 의 bottom 이 따라간다.
  //   (예전엔 푸터 아래를 112px 비워 피했는데 그만큼 푸터가 커졌다.)
  //   ⚠️ Layout 에서 querySelector('footer') 로 잡으면 라우트 페이지가 나중에 마운트돼(지연 로딩) 못 찾는다.
  //      그래서 푸터 자신이 계산해 알린다.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const apply = () => {
      raf = 0
      const visible = window.innerHeight - el.getBoundingClientRect().top // 푸터가 화면에 들어온 높이
      document.documentElement.style.setProperty(
        '--fab-bottom',
        `${Math.max(24, Math.round(visible) + 24)}px`,
      )
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(apply)
    }
    apply()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    // ⚠️ 스크롤·리사이즈만 보면 '마운트 후 비동기 데이터가 도착해 본문이 길어지는' 경우를 놓친다.
    //    (예: /plan 은 회차 목록이 늦게 와서 마운트 땐 푸터가 화면 중앙 → FAB 이 그 높이로 굳었다.)
    //    ⚠️ document.body 는 안 됨 — 이 앱에선 body 박스가 100vh 로 고정돼 본문이 늘어도 크기가 안 변한다.
    //       실제로 자라는 건 푸터가 속한 페이지 컨테이너라 그걸 관찰한다.
    const ro = new ResizeObserver(onScroll)
    ro.observe(el.parentElement ?? document.body)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      ro.disconnect()
      if (raf) cancelAnimationFrame(raf)
      document.documentElement.style.removeProperty('--fab-bottom')
    }
  }, [])

  const links = [
    { to: '/guide', key: 'nav.guide' },
    { to: '/notice', key: 'nav.notice' },
    { to: '/faq', key: 'nav.support' },
    { to: '/about', key: 'nav.assoc' },
    { to: '/terms', key: 'nav.terms' },
    { to: '/privacy', key: 'nav.privacy' },
  ] as const
  return (
    <footer ref={ref} className="bg-surface-container-lowest border-t border-outline-variant/40">
      {/* 좌하단 FAB 회피용 하단 여백(예전 pb-28 = 112px)은 없앴다 —
          푸터가 화면에 들어오면 Layout 이 FAB 을 숨긴다(.fab-hidden). */}
      <div className="pt-8 pb-6 md:py-7 px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto flex flex-col md:flex-row justify-between items-start gap-4 md:gap-5">
        <div className="flex flex-col gap-1.5">
          <Link to="/" aria-label="CARIS 홈으로" className="flex items-center gap-2 w-fit group">
            <img src="/logo.webp" alt="CARIS" className="h-9 w-9 object-cover rounded-full" />
            <span className="font-title-md text-title-md font-bold text-on-surface group-hover:text-primary transition-colors">CARIS</span>
          </Link>
          {/* 전자상거래법 표기 — 관리자가 채우기 전에는 줄 자체가 안 나온다(빈 라벨만 남는 게 더 나쁘다). */}
          {(() => {
            const j = (...xs: (string | undefined)[]) => xs.filter((x) => x && x.trim()).join(' · ')
            const lines = [
              j(s.company_name && `상호 ${s.company_name}`, s.company_ceo && `대표 ${s.company_ceo}`),
              j(s.company_reg_no && `사업자등록번호 ${s.company_reg_no}`, s.company_sales_no && `통신판매업신고 ${s.company_sales_no}`),
              j(s.company_addr, s.company_tel, s.company_email),
              j(s.privacy_officer && `개인정보보호책임자 ${s.privacy_officer}`),
            ].filter(Boolean)
            return lines.length ? (
              <div className="font-body-md text-[13px] text-outline leading-relaxed">
                {lines.map((l, i) => <div key={i}>{l}</div>)}
              </div>
            ) : null
          })()}
          <p className="font-body-md text-[13px] text-outline">{t('footer.rights')}</p>
        </div>
        <nav className="flex flex-wrap gap-x-5 gap-y-2">
          {links.map((l) => (
            <Link
              key={l.to}
              className="font-body-md text-[15px] font-medium text-on-surface-variant hover:text-primary transition-colors"
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
