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
  // 세션이 전혀 없으면 익명 세션을 만든다(시험 시작 직전 호출).
  ensureAnonymous: () => Promise<void>
  // 결과창 등에서 구글로 로그인/승격. 익명 세션이 있으면 linkIdentity로 데이터 유지.
  loginWithGoogle: (redirectTo?: string) => Promise<void>
  logout: () => Promise<void>
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

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      // 탈퇴(soft delete) 복구: 보관기간 내 재로그인하면 비활성 플래그 해제
      if (event === 'SIGNED_IN' && s?.user && !s.user.is_anonymous) {
        supabase.from('profiles').update({ deactivated_at: null }).eq('id', s.user.id).then(() => {})
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const user = session?.user ?? null

  async function ensureAnonymous() {
    if (!isSupabaseConfigured) throw new Error('Supabase 미설정')
    const { data } = await supabase.auth.getSession()
    if (data.session) return
    const { error } = await supabase.auth.signInAnonymously()
    if (error) throw error
  }

  // linkIdentity는 "이미 가입된 구글 계정" 충돌이 있어 쓰지 않는다.
  // 항상 일반 구글 로그인으로 통일하고, 익명 attempt는 claim 토큰으로 이관(get-result).
  async function loginWithGoogle(redirectTo?: string) {
    if (!isSupabaseConfigured) throw new Error('Supabase 미설정')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectTo ?? `${window.location.origin}/auth/callback`,
      },
    })
    if (error) throw error
  }

  async function logout() {
    await supabase.auth.signOut()
  }

  const value: AuthState = {
    session,
    user,
    loading,
    isFullUser: computeIsFullUser(user),
    ensureAnonymous,
    loginWithGoogle,
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
