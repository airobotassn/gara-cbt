import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { I18nProvider, useT } from './lib/i18n'
import { AuthProvider, useAuth } from './context/AuthProvider'
import { loadSiteSettings, applySiteHead } from './lib/siteSettings'
import { callFunction } from './lib/supabase'
import { ensureCheckedIn } from './lib/autoCheckin'
import { trackVisit } from './lib/visitTrack'
import Layout from './components/Layout'
import SebEscapeHatch from './components/SebEscapeHatch'
import SitePopups from './components/SitePopups'
import Landing from './pages/Landing'

/* ─────────────────────────────────────────────────────────────────────────────
 * 화면은 **들어갈 때 받는다** (2026-08-14)
 *
 * 예전엔 이 파일이 40개 화면을 전부 정적 import 해서, 누가 `/notice` 하나만 열어도
 * 브라우저가 관리자·아레나 지도·자격증·결제 코드까지 통째로 받아 해석했다.
 * 그 결과 첫 진입 JS 가 **1.33MB(gzip 423KB)** 였고 화면마다 "열리기 전에 한 박자
 * 멈추는" 체감의 가장 큰 원인이었다.
 *
 * ⚠️ 랜딩(`Landing`)만 정적으로 남긴다 — 대부분의 사용자가 처음 닿는 화면이라
 *    여기서 청크를 한 번 더 왕복시키면 첫 화면이 오히려 늦어진다.
 * ⚠️ 새 라우트를 추가할 때도 `lazy()` 로 넣을 것. 정적 import 를 하나 섞으면
 *    그 화면이 의존하는 라이브러리까지 첫 진입 번들로 다시 딸려 들어온다
 *    (특히 xlsx·react-quill = 관리자, d3 = 아레나).
 * ⚠️ react-router v7 은 이동을 startTransition 으로 감싸므로, 청크를 받는 동안
 *    이전 화면이 그대로 남아 있다가 교체된다(깜빡임 없음). 아래 Suspense fallback 은
 *    첫 진입처럼 보여줄 이전 화면이 없을 때만 실제로 보인다.
 * ───────────────────────────────────────────────────────────────────────────── */

// CARIS 자격검정 (CBT)
const ExamGate = lazy(() => import('./pages/ExamGate'))
const ExamApply = lazy(() => import('./pages/ExamApply'))
const ExamCheck = lazy(() => import('./pages/ExamCheck'))
const ExamEnvCheck = lazy(() => import('./pages/ExamEnvCheck'))
const ExamPrepare = lazy(() => import('./pages/ExamPrepare'))
const SebStart = lazy(() => import('./pages/SebStart'))
const CbtRunner = lazy(() => import('./pages/CbtRunner'))
const ExamResult = lazy(() => import('./pages/ExamResult'))
const ExamDone = lazy(() => import('./pages/ExamDone'))
const ExamComplete = lazy(() => import('./pages/ExamComplete'))
const Certificate = lazy(() => import('./pages/Certificate'))
const VerifyCert = lazy(() => import('./pages/VerifyCert'))

// 계정 · 마이페이지
const MyPage = lazy(() => import('./pages/MyPage'))
const AuthCallback = lazy(() => import('./pages/AuthCallback'))
const Login = lazy(() => import('./pages/Login'))
const Onboarding = lazy(() => import('./pages/Onboarding'))
const NicknameSetup = lazy(() => import('./pages/NicknameSetup'))
const AccountRestore = lazy(() => import('./pages/AccountRestore'))

// 정적 안내 페이지
const About = lazy(() => import('./pages/About'))
const Privacy = lazy(() => import('./pages/Privacy'))
const Terms = lazy(() => import('./pages/Terms'))
const Guide = lazy(() => import('./pages/Guide'))
const Plan = lazy(() => import('./pages/Plan'))
const Notice = lazy(() => import('./pages/Notice'))
const NoticeDetail = lazy(() => import('./pages/NoticeDetail'))
const Faq = lazy(() => import('./pages/Faq'))

// WORLD ARENA (무료 레벨테스트) — d3 지도가 여기 딸려 있다
const LevelSelect = lazy(() => import('./pages/LevelSelect'))
const LevelCert = lazy(() => import('./pages/LevelCert'))
const LevelRecord = lazy(() => import('./pages/LevelRecord'))
const TestReady = lazy(() => import('./pages/TestReady'))
const TestRunner = lazy(() => import('./pages/TestRunner'))
const Result = lazy(() => import('./pages/Result'))
const Ranking = lazy(() => import('./pages/Ranking'))
const WorldArena = lazy(() => import('./pages/WorldArena'))

// 캐릭터 허브 · 미니게임
const Hub = lazy(() => import('./pages/Hub'))
const Room = lazy(() => import('./pages/Room'))
const MiniGame = lazy(() => import('./pages/MiniGame'))
const MiniGames = lazy(() => import('./pages/MiniGames'))
const Daily = lazy(() => import('./pages/Daily'))

// 러닝 라이브러리 · 결제
const Ebooks = lazy(() => import('./pages/Ebooks'))
const EbookReader = lazy(() => import('./pages/EbookReader'))
const Checkout = lazy(() => import('./pages/Checkout'))
const PayResult = lazy(() => import('./pages/PayResult'))

// 관리자 (xlsx · react-quill 를 끌고 온다 — 절대 정적 import 로 되돌리지 말 것)
const Admin = lazy(() => import('./pages/Admin'))

// 페이지 이동 시 항상 맨 위로 스크롤 (FAB로 이동해도 스크롤 위치 유지되던 문제 해결)
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

// 방문 기록 — 라우트가 바뀔 때마다 한 줄 남긴다. 관리자 홈 대시보드 "방문 통계"(국가·지역·기기·
// 브라우저)의 **유일한** 입력이다. 화면에는 아무것도 그리지 않는다.
//   ⚠️ 여기가 아니라 각 페이지에 넣지 말 것 — 47개 화면에 흩어지면 새 라우트를 추가할 때마다 빠진다.
//   ⚠️ 관리자 경로·개발 서버 제외, 중복 억제, 국가 조회는 전부 lib/visitTrack.ts 안에 있다.
function VisitTracker() {
  const { pathname } = useLocation()
  useEffect(() => {
    trackVisit(pathname)
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

// 탈퇴 게이트 — 닉네임보다 **먼저** 온다. 탈퇴 신청된 계정은 복구를 누르기 전엔 아무것도 못 한다.
// 여태는 플래그가 랭킹에서만 걸러져서, 탈퇴한 계정이 로그인·미니게임·결제까지 그대로 됐다
// (2026-08-24 실제로 그 상태의 계정이 나왔다). 전 경로에서 막는 이유가 그것이다.
// 예외는 무한 루프를 막을 최소한만 — 복구 화면 자신, 로그인/콜백, 그리고 정책 문서
// (탈퇴·파기 규정을 읽을 길은 열어둔다).
const WITHDRAWN_EXEMPT = ['/account/restore', '/login', '/auth/callback', '/terms', '/privacy']

function WithdrawnGate({ children }: { children: ReactNode }) {
  const { deactivatedAt, onboardingLoading, isFullUser, loading } = useAuth()
  const { pathname, search } = useLocation()
  if (WITHDRAWN_EXEMPT.some((p) => pathname === p || pathname.startsWith(p + '/'))) return <>{children}</>
  if (loading || (isFullUser && onboardingLoading)) return <GateSpinner />
  if (isFullUser && deactivatedAt) {
    const next = encodeURIComponent(pathname + search)
    return <Navigate to={`/account/restore?next=${next}`} replace />
  }
  return <>{children}</>
}

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
 * 사이트 정보 적용 + 접속 기록 + 자동 출석.
 * ⚠️ 접속 기록은 **로그인 사용자만**, **하루 한 번만** 남긴다 — 매 이동마다 쓰면 접속자 수만큼 쓰기가 생긴다.
 *    이 값이 관리자 대시보드의 "오늘 접속자 · 휴면 회원"의 유일한 출처다(없으면 항상 0명).
 */
function SiteBoot() {
  const { isFullUser, user } = useAuth()
  const uid = isFullUser ? user?.id : undefined
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
  // 자동 출석 — 옛 '출석' 버튼(허브 레일)을 대신한다. 여기 두는 이유는 **어느 페이지로 들어와도**
  // 찍혀야 해서다(랜딩만 걸면 북마크로 직행한 날은 출석이 빠진다). 화면에는 아무것도 띄우지 않는다.
  //   ⚠️ 판정·중복방지는 서버와 lib/autoCheckin.ts 가 한다 — 여기서 조건을 더 얹지 말 것.
  useEffect(() => {
    if (!uid) return
    void ensureCheckedIn(uid)
  }, [uid])
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
          <VisitTracker />
          {/* SEB(잠금 브라우저) 안에서만 뜨는 탈출 버튼. 라우트가 안 맞아 랜딩으로 튕겨도 나갈 길이 남는다.
              응시 중(/exam/run/*)에는 뜨지 않는다 — 그 화면의 종료는 '포기'라 응시 무효 기록이 따로 남아야 한다. */}
          <SebEscapeHatch />
          <Layout>
            {/* 탈퇴(전 경로) → 닉네임(전 경로) → 지역(아레나 계열) 순서.
                탈퇴가 맨 앞인 이유: 복구하기 전에는 닉네임·지역을 물어볼 이유가 없다. */}
            <WithdrawnGate>
            <NicknameGate>
            <OnboardingGate>
            {/* 화면 청크를 받는 동안의 자리. 라우터가 이동을 transition 으로 감싸므로
                평소 이동에는 이전 화면이 남아 있고, 이 fallback 은 첫 진입에만 스친다. */}
            <Suspense fallback={<GateSpinner />}>
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
              {/* SEB 환경 점검 도착 화면 — 모의 .seb 의 startURL. 모의 문제를 풀지 않고 "떴다" 만 확인하고 나간다. */}
              <Route path="/exam/envcheck" element={<ExamEnvCheck />} />
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
              {/* 응시 전 안내 게이트 — 여기서 「전체화면으로 시작」을 눌러야 응시가 만들어지고
                  하루 횟수가 깎인다. 안내만 보고 나가면 아무것도 소모되지 않는다. */}
              <Route path="/test/ready/:level" element={<TestReady />} />
              {/* 내 기록(옛 마이페이지 '학습 대시보드'의 레벨테스트 몫) — 같은 이유로 :attemptId 보다 먼저 */}
              <Route path="/test/record" element={<LevelRecord />} />
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
              <Route path="/admin" element={<Admin />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/onboarding" element={<Onboarding />} />
              <Route path="/onboarding/nickname" element={<NicknameSetup />} />
              {/* 탈퇴 신청된 계정으로 로그인했을 때 — WithdrawnGate 가 여기로 보낸다. */}
              <Route path="/account/restore" element={<AccountRestore />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
            </OnboardingGate>
            </NicknameGate>
            </WithdrawnGate>
          </Layout>
        </BrowserRouter>
      </AuthProvider>
    </I18nProvider>
  )
}
