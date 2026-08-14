import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { I18nProvider, useT } from './lib/i18n'
import { AuthProvider, useAuth } from './context/AuthProvider'
import { loadSiteSettings, applySiteHead } from './lib/siteSettings'
import { callFunction } from './lib/supabase'
import Layout from './components/Layout'
import SebEscapeHatch from './components/SebEscapeHatch'
import SitePopups from './components/SitePopups'
import Landing from './pages/Landing'
import ExamGate from './pages/ExamGate'
import ExamApply from './pages/ExamApply'
import ExamCheck from './pages/ExamCheck'
import ExamPrepare from './pages/ExamPrepare'
import SebStart from './pages/SebStart'
import CbtRunner from './pages/CbtRunner'
import ExamResult from './pages/ExamResult'
import ExamDone from './pages/ExamDone'
import ExamComplete from './pages/ExamComplete'
import Certificate from './pages/Certificate'
import VerifyCert from './pages/VerifyCert'
import MyPage from './pages/MyPage'
import AuthCallback from './pages/AuthCallback'
import Login from './pages/Login'
import About from './pages/About'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
import Guide from './pages/Guide'
import Plan from './pages/Plan'
import Notice from './pages/Notice'
import NoticeDetail from './pages/NoticeDetail'
import Faq from './pages/Faq'
import LevelSelect from './pages/LevelSelect'
import LevelCert from './pages/LevelCert'
import TestRunner from './pages/TestRunner'
import Result from './pages/Result'
import Ranking from './pages/Ranking'
import Onboarding from './pages/Onboarding'
import NicknameSetup from './pages/NicknameSetup'
import Hub from './pages/Hub'
import Room from './pages/Room'
import WorldArena from './pages/WorldArena'
import MiniGame from './pages/MiniGame'
import MiniGames from './pages/MiniGames'
import Daily from './pages/Daily'
import Ebooks from './pages/Ebooks'
import EbookReader from './pages/EbookReader'
import Checkout from './pages/Checkout'
import PayResult from './pages/PayResult'
const Admin = lazy(() => import('./pages/Admin'))

// 페이지 이동 시 항상 맨 위로 스크롤 (FAB로 이동해도 스크롤 위치 유지되던 문제 해결)
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

// 온보딩(지역) 게이트 — 아레나 진입 시에만.
// 지역(country_code/region_code)은 아레나 집계 랭킹(지역·국가·학교 탭)과 월드맵에서만 쓰인다.
// 자격검정 경로(/exam/*·/certificate·verify-cert)는 이 값을 아예 읽지 않으므로 막지 않는다 —
// 인증서만 따고 나가는 응시자에게 되돌릴 수 없는 선택을 강요하지 않기 위함.
// 마이페이지도 제외(표시 전용, null 이면 '-').
// 지역은 나중에 정해도 집계 RPC 가 조회 시점에 profiles 를 조인하므로 과거 기록까지 소급 반영된다.
const ONBOARDING_ENFORCED = [
  '/arena', // 월드 아레나 지도 (랜딩 CTA · FAB 🌍)
  '/test', // 레벨 응시 (/test/select 등) — 랜딩 검색으로 직행하는 경로가 있어 함께 막는다
  '/ranking', // 명예의 전당
]

// ⚠️ 레벨테스트(/test)를 라우트 단에서 막지 않는다 — 화면은 누구나 들어와 레벨·문항수·승급컷을
//    볼 수 있어야 한다(그게 응시 동기다). 로그인은 **'응시 시작' 버튼에서만** 요구하고,
//    LevelSelect 가 /exam(ExamGate) 와 같은 로그인 안내 모달을 띄운다. 실제 차단은 서버(start-test 익명 401).

// 닉네임 게이트 — 지역과 달리 **전 경로**에서 강제한다.
// 이유: 가입 트리거가 구글 실명을 display_name 에 넣어서, 안 정하면 랭킹·채팅·레벨테스트 인증서에
// 실명이 그대로 노출된다. 미루면 그사이 실명이 새어나가므로 로그인 직후 받는다.
// 예외는 무한 루프를 막기 위한 최소한만(설정 화면 자신 · 로그인/콜백).
const NICKNAME_EXEMPT = ['/onboarding/nickname', '/login', '/auth/callback']

function NicknameGate({ children }: { children: ReactNode }) {
  const { needsNickname, onboardingLoading, isFullUser, loading } = useAuth()
  const { pathname, search } = useLocation()
  if (NICKNAME_EXEMPT.some((p) => pathname === p || pathname.startsWith(p + '/'))) return <>{children}</>
  if (loading || (isFullUser && onboardingLoading)) return <GateSpinner />
  if (isFullUser && needsNickname) {
    const next = encodeURIComponent(pathname + search)
    return <Navigate to={`/onboarding/nickname?next=${next}`} replace />
  }
  return <>{children}</>
}

function OnboardingGate({ children }: { children: ReactNode }) {
  const { needsOnboarding, onboardingLoading, isFullUser, loading } = useAuth()
  const { pathname, search } = useLocation()
  const enforced = ONBOARDING_ENFORCED.some((p) => pathname === p || pathname.startsWith(p + '/'))
  if (!enforced) return <>{children}</>

  // 판정 전에 렌더하면 아레나가 한 프레임 보였다가 튕긴다 → 알 때까지 대기.
  if (loading || (isFullUser && onboardingLoading)) return <GateSpinner />

  if (isFullUser && needsOnboarding) {
    const next = encodeURIComponent(pathname + search)
    return <Navigate to={`/onboarding?next=${next}`} replace />
  }
  return <>{children}</>
}

function GateSpinner() {
  const { t } = useT()
  return (
    <div className="wrap">
      <div className="card pad" style={{ textAlign: 'center', color: 'var(--muted)' }}>
        {t('common.loading')}
      </div>
    </div>
  )
}

/**
 * 사이트 정보 적용 + 접속 기록.
 * ⚠️ 접속 기록은 **로그인 사용자만**, **하루 한 번만** 남긴다 — 매 이동마다 쓰면 접속자 수만큼 쓰기가 생긴다.
 *    이 값이 관리자 대시보드의 "오늘 접속자 · 휴면 회원"의 유일한 출처다(없으면 항상 0명).
 */
function SiteBoot() {
  const { isFullUser } = useAuth()
  useEffect(() => { loadSiteSettings().then(applySiteHead) }, [])
  useEffect(() => {
    if (!isFullUser) return
    // 오늘 이미 찍었으면 건너뛴다(브라우저별 판단이라 완벽하진 않지만 쓰기를 하루 1회로 누른다).
    const todayKst = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
    if (localStorage.getItem('gara_seen_day') === todayKst) return
    callFunction('my-attempts', { action: 'seen' })
      .then(() => localStorage.setItem('gara_seen_day', todayKst))
      .catch(() => { /* 접속 기록 실패는 무시 */ })
  }, [isFullUser])
  return null
}

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <BrowserRouter>
          <SiteBoot />
          {/* 관리자가 등록한 팝업. ⛔ 응시 화면에는 컴포넌트 안에서 라우트로 막는다. */}
          <SitePopups />
          <ScrollToTop />
          {/* SEB(잠금 브라우저) 안에서만 뜨는 탈출 버튼. 라우트가 안 맞아 랜딩으로 튕겨도 나갈 길이 남는다.
              응시 중(/exam/run/*)에는 뜨지 않는다 — 그 화면의 종료는 '포기'라 응시 무효 기록이 따로 남아야 한다. */}
          <SebEscapeHatch />
          <Layout>
            {/* 닉네임(전 경로) → 지역(아레나 계열) 순서. 아레나로 바로 온 사람은 두 화면이 이어서 뜬다. */}
            <NicknameGate>
            <OnboardingGate>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/arena" element={<WorldArena />} />
              <Route path="/hub" element={<Hub />} />
              {/* 남의 방(공개) — 로그인·온보딩 게이트 없음. SNS 에서 눌러 들어온 사람이 방을 봐야 한다. */}
              <Route path="/room/:handle" element={<Room />} />
              <Route path="/games" element={<MiniGames />} />
              <Route path="/games/:gameId" element={<MiniGame />} />
              <Route path="/daily" element={<Daily />} />
              <Route path="/login" element={<Login />} />
              <Route path="/exam" element={<ExamGate />} />
              <Route path="/exam/apply" element={<ExamApply />} />
              <Route path="/exam/check" element={<ExamCheck />} />
              <Route path="/exam/prepare" element={<ExamPrepare />} />
              <Route path="/exam/seb" element={<SebStart />} />
              <Route path="/exam/run/:attemptId" element={<CbtRunner />} />
              <Route path="/exam/result/:attemptId" element={<ExamResult />} />
              <Route path="/exam/complete" element={<ExamComplete />} />
              <Route path="/exam/done" element={<ExamDone />} />
              <Route path="/certificate" element={<Certificate />} />
              {/* 발급(유료) 전 결제 유도 — state 없이 직접 들어와도 결제 게이트로 열린다 */}
              <Route path="/certificate/preview" element={<Certificate />} />
              {/* 디자인 견본 — 더미 인물(홍길동) + 진한 워터마크. 개인정보·진위확인 QR 없음 */}
              <Route path="/certificate/sample" element={<Certificate />} />
              <Route path="/verify/:token" element={<VerifyCert />} />
              {/* 이북: 스토어(구매) ↔ 뷰어(열람). 내 서재는 마이페이지 탭(/mypage/ebooks). */}
              <Route path="/ebooks" element={<Ebooks />} />
              <Route path="/ebooks/read/:id" element={<EbookReader />} />
              {/* 결제: 상품ID만 받아 서버가 주문을 만들고(금액은 서버가 계산) 토스 결제위젯을 띄운다.
                  /pay/success · /pay/fail 은 토스 결제창이 돌아오는 자리 — 주소를 바꾸면 successUrl/failUrl 도 같이 고칠 것. */}
              <Route path="/checkout" element={<Checkout />} />
              <Route path="/pay/success" element={<PayResult />} />
              <Route path="/pay/fail" element={<PayResult />} />
              <Route path="/mypage" element={<MyPage />} />
              <Route path="/mypage/:section" element={<MyPage />} />
              {/* CARIS ARENA 모듈 (/test/*) + 랭킹 */}
              <Route path="/test/select" element={<LevelSelect />} />
              {/* 레벨테스트 인증서 — /test/:attemptId 보다 먼저 둔다(안 그러면 attemptId 로 잡힌다) */}
              <Route path="/test/certificate" element={<LevelCert />} />
              <Route path="/test/:attemptId" element={<TestRunner />} />
              <Route path="/test/result/:attemptId" element={<Result />} />
              <Route path="/ranking" element={<Ranking />} />
              <Route path="/about" element={<About />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/guide" element={<Guide />} />
              <Route path="/plan" element={<Plan />} />
              <Route path="/notice" element={<Notice />} />
              <Route path="/notice/:id" element={<NoticeDetail />} />
              <Route path="/faq" element={<Faq />} />
              <Route
                path="/admin"
                element={
                  <Suspense fallback={<div className="wrap">불러오는 중…</div>}>
                    <Admin />
                  </Suspense>
                }
              />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/onboarding" element={<Onboarding />} />
              <Route path="/onboarding/nickname" element={<NicknameSetup />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </OnboardingGate>
            </NicknameGate>
          </Layout>
        </BrowserRouter>
      </AuthProvider>
    </I18nProvider>
  )
}
