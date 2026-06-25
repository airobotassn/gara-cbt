import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { I18nProvider } from './lib/i18n'
import { AuthProvider } from './context/AuthProvider'
import Layout from './components/Layout'
import Landing from './pages/Landing'
import ExamGate from './pages/ExamGate'
import ExamCheck from './pages/ExamCheck'
import ExamPrepare from './pages/ExamPrepare'
import CbtRunner from './pages/CbtRunner'
import ExamResult from './pages/ExamResult'
import Certificate from './pages/Certificate'
import MyPage from './pages/MyPage'
import AuthCallback from './pages/AuthCallback'
import About from './pages/About'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
const Admin = lazy(() => import('./pages/Admin'))

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <BrowserRouter>
          <Layout>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/exam" element={<ExamGate />} />
              <Route path="/exam/check" element={<ExamCheck />} />
              <Route path="/exam/prepare" element={<ExamPrepare />} />
              <Route path="/exam/run/:attemptId" element={<CbtRunner />} />
              <Route path="/exam/result/:attemptId" element={<ExamResult />} />
              <Route path="/certificate" element={<Certificate />} />
              <Route path="/mypage" element={<MyPage />} />
              <Route path="/mypage/:section" element={<MyPage />} />
              <Route path="/about" element={<About />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
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
