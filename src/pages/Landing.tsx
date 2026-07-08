import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'
import { callFunction } from '../lib/supabase'

// CBT 메인(랜딩) — 의미 기반 검색 라우터 + 자격검정 CTA
//   검색창 입력 → route-query(임베딩 유사도 + LLM 폴백) → 알맞은 페이지로 이동.
//   서버가 죽어도(함수 미배포·장애) 클라 키워드 폴백으로 안 깨지게 한다.
// route-query 가 반환할 수 있는 목적지(응답 검증용). DEST(route-query) 와 동기화.
const VALID_DESTS = new Set([
  '/test/select', '/guide', '/exam/schedule', '/exam/apply', '/exam', '/exam/check',
  '/mypage', '/certificate', '/ranking', '/about', '/notice', '/faq',
])

// 최후 폴백: route-query 자체가 실패했을 때(함수 다운 등) 클라에서 키워드로.
// 서버 keywordRoute 와 동일 순서 + 약관/개인정보/로그인 추가(서버 인텐트엔 없는 것).
function clientKeywordRoute(q: string): string | null {
  const s = q.toLowerCase()
  const h = (re: RegExp) => re.test(s)
  if (h(/랭킹|순위|리더보드|명예의?\s?전당|rank|leaderboard|ランキング|順位|排名|排行|名人堂|xếp hạng|thứ hạng/)) return '/ranking'
  if (h(/마이\s?페이지|내 점수|내 결과|내 성적|응시\s?이력|내 기록|my score|my result|my page|mypage|マイページ|受験履歴|个人中心|我的成绩|trang cá nhân/)) return '/mypage'
  if (h(/자격증|합격증|증명서|인증서|certificate|証明書|合格証|证书|chứng chỉ của/)) return '/certificate'
  if (h(/협회\s?소개|무슨 협회|어떤 단체|기관\s?소개|회사\s?소개|about us|協会について|关于我们|协会介绍|giới thiệu hiệp hội|về chúng tôi/)) return '/about'
  if (h(/공지|소식|안내사항|announcement|notice|お知らせ|公告|thông báo/)) return '/notice'
  if (h(/문의|고객센터|환불|결제|상담|도와|도움|help|contact|support|refund|payment|問い合わせ|カスタマー|返金|客服|退款|hỏi|liên hệ|hoàn tiền|hỗ trợ/)) return '/faq'
  if (h(/모의|환경\s?점검|연습\s?시험|사전\s?점검|seb|mock|practice|模擬|模拟|事前チェック|thi thử/)) return '/exam/check'
  if (h(/일정|날짜|언제|회차|스케줄|schedule|日程|いつ|时间|khi nào|lịch/)) return '/exam/schedule'
  if (h(/원서|접수|신청|등록|응시료|register|apply|sign\s?up|願書|申込|受験料|报名|đăng ký|lệ phí/)) return '/exam/apply'
  if (h(/응시|시험 ?보|시험 ?볼|시험 ?시작|시험장|치르|take (the )?exam|sit (the )?exam|受験|参加考试|dự thi|vào thi/)) return '/exam'
  if (h(/자격|급수|과목|자격검정|certif|eligib|資格|资格|試験|kỳ thi|chứng nhận|시험/)) return '/guide'
  if (h(/레벨|진단|실력|무료|수준|측정|level|test|assess|diagnos|レベル|診断|等级|水平|测评|trình độ|kiểm tra|đánh giá/)) return '/test/select'
  if (h(/약관|이용약관|terms/)) return '/terms'
  if (h(/개인정보|프라이버시|privacy/)) return '/privacy'
  if (h(/로그인|로그아웃|login|sign\s?in/)) return '/login'
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
      {notFound ? <div className="lp-notfound" role="alert">{t('route.notfound')}</div> : null}

      <div className="lp-ctas">
        <button className="cta" onClick={() => navigate('/test/select')}>
          {t('landing.cta_diagnose')} <span className="arr">→</span>
        </button>
        <button className="cta-ghost" onClick={() => navigate('/guide')}>
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
