import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'
import { callFunction } from '../lib/supabase'

// CBT 메인(랜딩) — 의미 기반 검색 라우터 + 자격검정 CTA
//   검색창 입력 → route-query(임베딩 유사도 + LLM 폴백) → 알맞은 페이지로 이동.
//   서버가 죽어도(함수 미배포·장애) 클라 키워드 폴백으로 안 깨지게 한다.
const VALID_DESTS = new Set(['/test/select', '/guide', '/faq', '/ranking'])

// 최후 폴백: route-query 자체가 실패했을 때(함수 다운 등) 클라에서 키워드로.
function clientKeywordRoute(q: string): string | null {
  const s = q.toLowerCase()
  if (/랭킹|순위|리더보드|rank|leaderboard|ランキング|順位|排名|排行|xếp hạng|thứ hạng/.test(s)) return '/ranking'
  if (/문의|질문|고객|환불|연락|상담|도움|help|contact|support|refund|問い合わせ|質問|咨询|退款|客服|hỏi|liên hệ|hoàn tiền|hỗ trợ/.test(s)) return '/faq'
  if (/시험|자격|급수|일정|응시|과목|정기|certif|exam|schedule|eligib|試験|資格|考试|资格|证书|chứng chỉ|kỳ thi|lịch thi/.test(s)) return '/guide'
  if (/레벨|진단|실력|테스트|수준|측정|level|test|assess|diagnos|レベル|診断|测评|等级|水平|trình độ|kiểm tra|đánh giá/.test(s)) return '/test/select'
  return null
}

export default function Landing() {
  const navigate = useNavigate()
  const { isFullUser } = useAuth()
  const { t } = useT()
  const [learnSoon, setLearnSoon] = useState(false)
  const [query, setQuery] = useState('')
  const [routing, setRouting] = useState(false)
  const [notFound, setNotFound] = useState(false)

  // 로그인이 홈으로 떨어져도 복귀 표식이 있으면 자동 이동.
  // postLoginRedirect: 지정 경로로(예: SEB 진입 /exam/seb) · examIntent: 응시 준비(/exam/prepare)
  useEffect(() => {
    if (!isFullUser) return
    const dest = localStorage.getItem('postLoginRedirect')
    if (dest) {
      localStorage.removeItem('postLoginRedirect')
      navigate(dest, { replace: true })
      return
    }
    if (localStorage.getItem('examIntent')) {
      localStorage.removeItem('examIntent')
      navigate('/exam/prepare', { replace: true })
    }
  }, [isFullUser, navigate])

  // 검색어 → 의미 기반 라우팅. 실패/미확정이면 클라 키워드 → 그래도 없으면 안내.
  async function goSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q || routing) return
    setNotFound(false)
    setRouting(true)
    try {
      const r = await callFunction<{ dest: string | null }>('route-query', { query: q })
      if (r.dest && VALID_DESTS.has(r.dest)) {
        navigate(r.dest)
        return
      }
      // dest=null(unknown) → 클라 키워드 한 번 더 시도
      const kw = clientKeywordRoute(q)
      if (kw) navigate(kw)
      else setNotFound(true)
    } catch {
      // route-query 자체 실패(함수 다운 등) → 클라 키워드 폴백
      const kw = clientKeywordRoute(q)
      if (kw) navigate(kw)
      else setNotFound(true)
    } finally {
      setRouting(false)
    }
  }

  return (
    <div className="lp">
      <div className="aura" />
      <h1>
        {t('landing.hero_pre')} <span className="em">{t('landing.hero_em')}</span>
        <br />
        {t('landing.hero_post')}
      </h1>

      {/* 의미 기반 검색 라우터 — 입력 의도에 맞는 페이지로 이동 */}
      <form className="lp-search" onSubmit={goSearch}>
        <input
          className="lp-search-input"
          type="text"
          value={query}
          maxLength={200}
          placeholder={t('route.placeholder')}
          onChange={(e) => { setQuery(e.target.value); if (notFound) setNotFound(false) }}
          disabled={routing}
        />
        <button className="lp-search-btn" type="submit" aria-label={t('landing.cta_diagnose')} disabled={routing}>
          {routing ? '…' : '→'}
        </button>
      </form>
      {notFound ? <div className="lp-soon-note">{t('route.notfound')}</div> : null}

      <div className="lp-ctas">
        <button className="cta-ghost" onClick={() => navigate('/test/select')}>
          {t('landing.cta_diagnose')} <span className="arr">→</span>
        </button>
        <button className="cta" onClick={() => navigate('/exam')}>
          {t('landing.cta_exam')} <span className="arr">→</span>
        </button>
        <button className="cta-ghost soon" onClick={() => setLearnSoon(true)}>
          {t('landing.cta_learn')} <span className="cta-soon-tag">{t('landing.soon')}</span>
        </button>
      </div>
      {learnSoon ? <div className="lp-soon-note">{t('landing.learn_soon')}</div> : null}
    </div>
  )
}
