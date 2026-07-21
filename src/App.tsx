import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { I18nProvider, useT } from './lib/i18n'
import { AuthProvider, useAuth } from './context/AuthProvider'
import Layout from './components/Layout'
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
import Notice from './pages/Notice'
import NoticeDetail from './pages/NoticeDetail'
import Faq from './pages/Faq'
import LevelSelect from './pages/LevelSelect'
import TestRunner from './pages/TestRunner'
import Result from './pages/Result'
import Ranking from './pages/Ranking'
import Onboarding from './pages/Onboarding'
import Hub from './pages/Hub'
import WorldArena from './pages/WorldArena'
import MiniGame from './pages/MiniGame'
import Daily from './pages/Daily'
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
// 자격증만 따고 나가는 응시자에게 되돌릴 수 없는 선택을 강요하지 않기 위함.
// 마이페이지도 제외(표시 전용, null 이면 '-'). 익명 게스트는 needsOnboarding=false 라 응시에 지장 없음.
// 지역은 나중에 정해도 집계 RPC 가 조회 시점에 profiles 를 조인하므로 과거 기록까지 소급 반영된다.
const ONBOARDING_ENFORCED = [
  '/arena', // 월드 아레나 지도 (랜딩 CTA · FAB 🌍)
  '/test', // 레벨 응시 (/test/select 등) — 랜딩 검색으로 직행하는 경로가 있어 함께 막는다
  '/ranking', // 명예의 전당
]

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

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <BrowserRouter>
          <ScrollToTop />
          <Layout>
            <OnboardingGate>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/arena" element={<WorldArena />} />
              <Route path="/hub" element={<Hub />} />
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
              <Route path="/verify/:token" element={<VerifyCert />} />
              <Route path="/mypage" element={<MyPage />} />
              <Route path="/mypage/:section" element={<MyPage />} />
              {/* CARIS ARENA 모듈 (/test/*) + 랭킹 */}
              <Route path="/test/select" element={<LevelSelect />} />
              <Route path="/test/:attemptId" element={<TestRunner />} />
              <Route path="/test/result/:attemptId" element={<Result />} />
              <Route path="/ranking" element={<Ranking />} />
              <Route path="/about" element={<About />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/guide" element={<Guide />} />
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
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </OnboardingGate>
          </Layout>
        </BrowserRouter>
      </AuthProvider>
    </I18nProvider>
  )
}
