import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

interface AuthState {
  session: Session | null
  user: User | null
  loading: boolean
  // 구글 계정 보유 = 정식 회원. 익명 유저는 false.
  isFullUser: boolean
  // 세션이 없으면 익명 세션 생성(CARIS ARENA 게스트 응시 시작 직전 호출). CBT 자격검정은 사용 안 함.
  ensureAnonymous: () => Promise<void>
  // 결과창 등에서 구글로 로그인/승격.
  loginWithGoogle: (redirectTo?: string) => Promise<void>
  loginWithKakao: (redirectTo?: string) => Promise<void>
  logout: () => Promise<void>
  // 온보딩(지역 잠금) 게이트: 정식 회원이 아직 지역을 확정하지 않았으면 true.
  needsOnboarding: boolean
  // 정식 회원의 최초 프로필 조회가 끝날 때까지 true. 익명/무세션은 false.
  onboardingLoading: boolean
  // 온보딩 화면에서 지역 확정 성공 직후 호출. 이걸 안 하면 needsOnboarding 이 true 로 남아
  // OnboardingGate 가 목적지에서 다시 /onboarding 으로 튕긴다(새로고침해야 풀리는 버그).
  markOnboardingDone: () => void
}

const AuthContext = createContext<AuthState | undefined>(undefined)

function computeIsFullUser(user: User | null): boolean {
  if (!user) return false
  if (user.is_anonymous) return false
  const identities = user.identities ?? []
  return identities.some((i) => i.provider !== 'anonymous')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [needsOnboarding, setNeedsOnboarding] = useState(false)
  const [onboardingLoading, setOnboardingLoading] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }
    async function loadOnboarding(u: User | null) {
      // 익명/무세션은 게이트 대상 아님.
      if (!u || !computeIsFullUser(u)) {
        setNeedsOnboarding(false)
        setOnboardingLoading(false)
        return
      }
      setOnboardingLoading(true)
      const { data, error } = await supabase
        .from('profiles')
        .select('region_locked_at,country_code,region_code')
        .eq('id', u.id)
        .maybeSingle()
      // 조회 실패 → FAIL-OPEN: 유저를 가두지 않는다.
      if (error) {
        setNeedsOnboarding(false)
        setOnboardingLoading(false)
        return
      }
      // 프로필 행이 없으면(최초) 지역 미확정 → 온보딩 필요.
      setNeedsOnboarding(data == null ? true : data.region_locked_at == null)
      setOnboardingLoading(false)
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
      loadOnboarding(data.session?.user ?? null)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      // 탈퇴(soft delete) 복구: 보관기간 내 재로그인하면 비활성 플래그 해제
      if (event === 'SIGNED_IN' && s?.user && !s.user.is_anonymous) {
        supabase.from('profiles').update({ deactivated_at: null }).eq('id', s.user.id).then(() => {})
        loadOnboarding(s.user)
      }
      if (event === 'SIGNED_OUT') {
        setNeedsOnboarding(false)
        setOnboardingLoading(false)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const user = session?.user ?? null

  // 세션이 전혀 없을 때만 익명 세션 생성(CARIS ARENA 게스트 응시용). 이미 세션 있으면 no-op.
  async function ensureAnonymous() {
    if (!isSupabaseConfigured) throw new Error('Supabase 미설정')
    const { data } = await supabase.auth.getSession()
    if (data.session) return
    const { error } = await supabase.auth.signInAnonymously()
    if (error) throw error
  }

  // 항상 일반 구글 로그인으로 통일(익명 응시 없음).
  async function loginWithGoogle(redirectTo?: string) {
    if (!isSupabaseConfigured) throw new Error('Supabase 미설정')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectTo ?? `${window.location.origin}/auth/callback`,
        // 구글에 로그인된 계정이 하나면 동의화면 없이 그 계정으로 바로 통과한다.
        // 계정 선택창을 매번 띄워 어떤 계정으로 들어갈지 고르게 한다.
        queryParams: { prompt: 'select_account' },
      },
    })
    if (error) throw error
  }

  async function loginWithKakao(redirectTo?: string) {
    if (!isSupabaseConfigured) throw new Error('Supabase 미설정')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'kakao',
      options: {
        redirectTo: redirectTo ?? `${window.location.origin}/auth/callback`,
        // ⚠️ 카카오는 Supabase가 account_email/profile_image/profile_nickname 3개를 강제 요청한다
        // (이 scopes 값은 무시됨). 실제 수집 범위는 카카오 콘솔 '동의항목'에서 제어 —
        // 닉네임=필수, 이메일/프로필사진=선택동의로 두고 앱에선 닉네임만 사용.
        scopes: 'profile_nickname',
      },
    })
    if (error) throw error
  }

  async function logout() {
    await supabase.auth.signOut()
  }

  // set-region 이 200/409(already_locked) 로 끝났다 = 서버 기준 확정. 재조회 없이 낙관적으로 해제.
  function markOnboardingDone() {
    setNeedsOnboarding(false)
    setOnboardingLoading(false)
  }

  const value: AuthState = {
    session,
    user,
    loading,
    isFullUser: computeIsFullUser(user),
    needsOnboarding,
    onboardingLoading,
    markOnboardingDone,
    ensureAnonymous,
    loginWithGoogle,
    loginWithKakao,
    logout,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
