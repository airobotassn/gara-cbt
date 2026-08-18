import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import RankGlobe from '../components/RankGlobe'
import SiteFooter from '../components/SiteFooter'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'
import { callFunction } from '../lib/supabase'

// CBT 메인(랜딩) — 의미 기반 검색 라우터 + 자격검정 CTA
//   검색창 입력 → route-query(임베딩 유사도 + LLM 폴백) → 알맞은 페이지로 이동.
//   서버가 죽어도(함수 미배포·장애) 클라 키워드 폴백으로 안 깨지게 한다.
// route-query 가 반환할 수 있는 목적지(응답 검증용). DEST(route-query) 와 동기화.
const VALID_DESTS = new Set([
  // WORLD ARENA 계열
  '/arena', '/test/select', '/ranking', '/hub', '/games', '/daily',
  // CARIS 자격검정
  '/guide', '/exam/apply', '/exam', '/exam/check', '/certificate',
  // 내 정보
  '/mypage', '/mypage/ebooks', '/ebooks', '/login',
  // 사이트 정보
  '/about', '/notice', '/faq', '/terms', '/privacy',
])

// 최후 폴백: route-query 자체가 실패했을 때(함수 다운 등) 클라에서 키워드로.
// ⚠️ 서버 route-query 의 keywordRoute 와 **완전 동일**(규칙·순서)하게 유지할 것.
//   순서 주의: 아레나 고유어(지역랭킹)는 일반 '랭킹' 보다 먼저, 이북은 허브 '상점' 보다 먼저 걸러야 한다.
function clientKeywordRoute(q: string): string | null {
  const s = q.toLowerCase()
  const h = (re: RegExp) => re.test(s)
  // --- WORLD ARENA 계열 ---
  if (h(/아레나|arena|đấu trường|세계\s?리그|월드\s?리그|world\s?league|世界リーグ|世界联赛|지역\s?(랭킹|순위)|우리\s?(지역|동네|나라)|지도\s?보|세계\s?지도|world\s?map|地図|地图|bản đồ/)) return '/arena'
  if (h(/미니\s?게임|게임|mini\s?game|ゲーム|游戏|trò chơi|버텨라|쏴라|골라라/)) return '/games'
  if (h(/오늘의?\s?(학습|문제|공부)|데일리|daily|今日の(学習|問題)|デイリー|今日学习|每日|học hôm nay|hằng ngày/)) return '/daily'
  // --- 이북(허브 '상점' 보다 먼저) ---
  if (h(/내\s?이북|이북\s?서재|서재|구매한\s?(책|이북|교재)|산\s?책|my\s?e-?book|e-?book\s?library|本棚|購入した本|我的电子书|书架|thư viện\s?ebook/)) return '/mypage/ebooks'
  if (h(/이북|e-?book|전자책|전자\s?교재|교재|電子書籍|电子书|sách điện tử/)) return '/ebooks'
  // --- 캐릭터 허브 ---
  if (h(/허브|캐릭터|아바타|코인|상점|출석|hub|character|avatar|coin|shop|attendance|check[\s-]?in|ハブ|キャラ|コイン|ショップ|出席|角色|金币|商店|签到|nhân vật|điểm danh|cửa hàng/)) return '/hub'
  // --- 이하 기존 순서 유지 ---
  if (h(/랭킹|순위|리더보드|명예의?\s?전당|rank|leaderboard|ランキング|順位|排名|排行|名人堂|xếp hạng|thứ hạng/)) return '/ranking'
  if (h(/마이\s?페이지|내 점수|내 결과|내 성적|응시\s?이력|내 기록|my score|my result|my page|mypage|マイページ|受験履歴|个人中心|我的成绩|trang cá nhân/)) return '/mypage'
  if (h(/자격증|합격증|증명서|인증서|certificate|証明書|合格証|证书|chứng chỉ của/)) return '/certificate'
  if (h(/협회\s?소개|무슨 협회|어떤 단체|기관\s?소개|회사\s?소개|gara|about us|協会について|关于我们|协会介绍|giới thiệu hiệp hội|về chúng tôi/)) return '/about'
  if (h(/공지|소식|안내사항|announcement|notice|お知らせ|公告|thông báo/)) return '/notice'
  if (h(/문의|고객센터|환불|결제|상담|도와|도움|help|contact|support|refund|payment|問い合わせ|カスタマー|返金|客服|退款|hỏi|liên hệ|hoàn tiền|hỗ trợ/)) return '/faq'
  if (h(/모의|환경\s?점검|연습\s?시험|사전\s?점검|seb|mock|practice|system\s?check|模擬|模拟|事前チェック|thi thử/)) return '/exam/check'
  if (h(/일정|날짜|언제|회차|스케줄|schedule|日程|いつ|时间|khi nào|lịch/)) return '/guide'
  if (h(/원서|접수|신청|등록|응시료|register|apply|sign\s?up|願書|申込|受験料|报名|đăng ký|lệ phí/)) return '/exam/apply'
  if (h(/응시|시험 ?보|시험 ?볼|시험 ?시작|시험장|치르|take (the )?exam|sit (the )?exam|受験|参加考试|dự thi|vào thi/)) return '/exam'
  // '카리스/caris' = 자격검정 브랜드명 → 안내로. ('카리스 아레나' 는 위 arena 규칙이 이미 가져갔다)
  if (h(/자격|급수|과목|자격검정|카리스|caris|certif|eligib|資格|资格|試験|kỳ thi|chứng nhận|시험/)) return '/guide'
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
  const [query, setQuery] = useState('')
  const [routing, setRouting] = useState(false)
  const [notFound, setNotFound] = useState(false)

  // 메인에서만 오른쪽 스크롤바를 감춘다(스크롤은 그대로 된다 — 막대만 안 그린다).
  //   푸터를 히어로 아래에 붙이면서 생긴 막대가 검은 우주 배경 옆에 흰 띠로 남아서다.
  //   ⚠️ 문서 스크롤바를 그리는 건 <html> 이다 — .lp 나 body 에 걸면 아무 일도 안 일어난다.
  //      그래서 페이지 스코프 CSS 로 못 쓰고 이 화면이 붙어있는 동안만 루트에 클래스를 건다.
  //   ⚠️ 떠날 때 반드시 벗길 것. 남기면 긴 문서 화면(/guide·/terms)까지 막대가 사라져
  //      아래에 내용이 더 있다는 걸 알 방법이 없어진다.
  useEffect(() => {
    document.documentElement.classList.add('lp-noscrollbar')
    return () => document.documentElement.classList.remove('lp-noscrollbar')
  }, [])

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
    // force-dark: 배경이 항상 검은 우주라 테마 토글과 무관하게 다크 팔레트로 고정한다.
    //   색을 새로 정하는 게 아니라 기존 다크 모드 토큰을 그대로 쓴다(stitch.css 의 .force-dark).
    //   글자색·버튼색·크기는 손대지 않았다 — 지금 다크 모드에서 보이는 그대로다.
    //   ⚠️ force-dark 를 .lp 가 아니라 바깥 겹에 두는 이유 = 아래 <SiteFooter> 까지 같이 덮기 위해서다.
    //      토큰만 갈아끼우는 클래스라(레이아웃 없음) 위치를 올려도 .lp 안 모양은 그대로다.
    <div className="force-dark">
      {/* 히어로는 딱 한 화면(min-height:100vh). 푸터는 그 **바깥 형제**라 처음 뜨는 화면은
          예전과 픽셀이 같고, 스크롤을 내려야 나온다.
          ⚠️ .lp 안에 넣으면 안 된다 — .lp 의 overflow:hidden(지구본 클리핑용)에 잘려 영영 안 보인다. */}
      <div className="lp">
        {/* 우주 + 밤지구 순위 지구본 히어로 (옛 NASA 영상 21.6MB → 경계 데이터 + 렌더러 약 40KB) */}
        <RankGlobe />
        <h1>
          {t('landing.hero_pre')} <span className="em">{t('landing.hero_em')}</span>
          <br />
          {/* 뒷줄의 'CARIS' 만 강조색으로. 브랜드명이라 6개국어 모두 같은 토큰이므로 문자열 분할로 처리한다. */}
          {t('landing.hero_post')
            .split('CARIS')
            .flatMap((part, i) => (i === 0 ? [part] : [<span key={i} className="em">CARIS</span>, part]))}
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
          <button className="cta" onClick={() => navigate('/arena')}>
            {t('landing.cta_diagnose')} <span className="arr">→</span>
          </button>
          <button className="cta-ghost" onClick={() => navigate('/guide')}>
            {t('landing.cta_exam')} <span className="arr">→</span>
          </button>
          <button className="cta-ghost" onClick={() => navigate('/ebooks')}>
            {t('landing.cta_learn')} <span className="arr">→</span>
          </button>
        </div>
      </div>

      {/* 전자상거래법 제10조 — 사업자 정보는 '초기화면'(= 메인 페이지)에 표시해야 한다.
          스크롤 맨 아래는 그 요건을 만족한다(조문이 말하는 건 페이지지 첫 뷰포트가 아니다). */}
      <SiteFooter />
    </div>
  )
}
