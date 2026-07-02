import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { I18nProvider } from './lib/i18n'
import { AuthProvider } from './context/AuthProvider'
import Layout from './components/Layout'
import Landing from './pages/Landing'
import ExamGate from './pages/ExamGate'
import ExamSchedule from './pages/ExamSchedule'
import ExamApply from './pages/ExamApply'
import ExamCheck from './pages/ExamCheck'
import ExamPrepare from './pages/ExamPrepare'
import CbtRunner from './pages/CbtRunner'
import ExamResult from './pages/ExamResult'
import ExamDone from './pages/ExamDone'
import ExamComplete from './pages/ExamComplete'
import Certificate from './pages/Certificate'
import MyPage from './pages/MyPage'
import AuthCallback from './pages/AuthCallback'
import Login from './pages/Login'
import About from './pages/About'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
import Guide from './pages/Guide'
import Notice from './pages/Notice'
import Faq from './pages/Faq'
import LevelSelect from './pages/LevelSelect'
import TestRunner from './pages/TestRunner'
import Result from './pages/Result'
import Ranking from './pages/Ranking'
const Admin = lazy(() => import('./pages/Admin'))

// 페이지 이동 시 항상 맨 위로 스크롤 (FAB로 이동해도 스크롤 위치 유지되던 문제 해결)
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <BrowserRouter>
          <ScrollToTop />
          <Layout>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/exam" element={<ExamGate />} />
              <Route path="/exam/schedule" element={<ExamSchedule />} />
              <Route path="/exam/apply" element={<ExamApply />} />
              <Route path="/exam/check" element={<ExamCheck />} />
              <Route path="/exam/prepare" element={<ExamPrepare />} />
              <Route path="/exam/run/:attemptId" element={<CbtRunner />} />
              <Route path="/exam/result/:attemptId" element={<ExamResult />} />
              <Route path="/exam/complete" element={<ExamComplete />} />
              <Route path="/exam/done" element={<ExamDone />} />
              <Route path="/certificate" element={<Certificate />} />
              <Route path="/mypage" element={<MyPage />} />
              <Route path="/mypage/:section" element={<MyPage />} />
              {/* 레벨테스트 모듈 (/test/*) + 랭킹 */}
              <Route path="/test/select" element={<LevelSelect />} />
              <Route path="/test/:attemptId" element={<TestRunner />} />
              <Route path="/test/result/:attemptId" element={<Result />} />
              <Route path="/ranking" element={<Ranking />} />
              <Route path="/about" element={<About />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/guide" element={<Guide />} />
              <Route path="/notice" element={<Notice />} />
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
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        </BrowserRouter>
      </AuthProvider>
    </I18nProvider>
  )
}
