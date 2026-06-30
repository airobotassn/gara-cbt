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
  // 결과창 등에서 구글로 로그인/승격.
  loginWithGoogle: (redirectTo?: string) => Promise<void>
  loginWithKakao: (redirectTo?: string) => Promise<void>
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

  // 항상 일반 구글 로그인으로 통일(익명 응시 없음).
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

  const value: AuthState = {
    session,
    user,
    loading,
    isFullUser: computeIsFullUser(user),
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
