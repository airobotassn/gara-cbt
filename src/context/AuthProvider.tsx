import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { needsConsent } from '../lib/consent'

interface AuthState {
  session: Session | null
  user: User | null
  loading: boolean
  // 구글 계정 보유 = 정식 회원. 익명 유저는 false.
  isFullUser: boolean
  // 세션이 없으면 익명 세션 생성. 호출부 셋:
  //   · LevelSelect(/test/select) — 게스트 응시. 결과는 총점만, 누적 미반영(2026-08-06 부활).
  //   · MiniGame(/games/:id)      — 게스트 플레이. 티켓을 안 받아 랭킹에 안 올라간다.
  //   · SebStart(/exam/seb)       — SEB 는 새 브라우저 프로필이라 세션이 없는데 본인인증 수단이 아직 없다.
  //                                 본인인증이 붙으면 이 호출만 교체할 것.
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
  // 닉네임 게이트: 정식 회원이 아직 닉네임을 정하지 않았으면 true(전 경로에서 강제).
  // 가입 트리거가 구글 실명을 display_name 에 넣지만 nickname_set_at 이 null 이라 '미설정'이다.
  needsNickname: boolean
  // 닉네임 설정 성공 직후 호출(markOnboardingDone 과 같은 이유 — 안 하면 목적지에서 다시 튕긴다).
  markNicknameDone: () => void
  // 약관 동의 게이트: 정식 회원이 아직 동의하지 않았으면 true(전 경로에서 강제).
  //   만 14세 미만 아동의 개인정보는 법정대리인 동의 없이 처리할 수 없는데(개인정보보호법 §22-2)
  //   우리는 구글 로그인뿐이라 나이를 알 방법이 없다 → 가입 연령을 본인이 확인하는 체크 한 줄로 받는다.
  needsTerms: boolean
  // 동의 성공 직후 호출(markNicknameDone 과 같은 이유).
  markTermsDone: () => void
  // 탈퇴(soft delete) 게이트: 탈퇴 신청 시각. null 이면 정상 계정.
  //   ⛔ 재로그인만으로 자동 복구하지 않는다 — 복구 화면에서 사람이 눌러야 풀린다.
  //     (옛 코드는 SIGNED_IN 에서 조용히 UPDATE 했는데, 구글 복귀는 새 페이지 로드라 리스너가
  //      INITIAL_SESSION 을 먼저 받아 그 UPDATE 가 아예 안 나갔다 — 탈퇴 상태로 서비스를 계속 쓴
  //      계정이 실제로 나왔다. 조용한 복구는 성공해도 "탈퇴한 적 없는 것" 이라 어차피 틀렸다.)
  deactivatedAt: string | null
  // 복구 성공 직후 호출. 안 하면 게이트가 목적지에서 다시 복구 화면으로 튕긴다.
  markRestored: (nicknameReset?: boolean) => void
  // 내 국가·지역. 게이트 판정용으로 **이미 읽고 있던 값**을 화면들에 나눠주는 것뿐이다(추가 조회 없음).
  //   ⚠️ 여기에 자주 바뀌는 값(avatar_url·display_name)을 얹지 말 것 — 갱신 책임이 같이 따라온다.
  //     국가·지역은 계정당 1회만 바꿀 수 있어(region_changed_at 잠금) 사실상 불변이고,
  //     바뀌는 자리가 온보딩 확정과 마이페이지 1회 변경 딱 둘뿐이라 아래 applyRegion 으로 덮으면 끝난다.
  //   · 정식 회원이 아니거나 조회 실패면 null — 호출부는 '모른다'로 다루면 된다.
  //   · 로딩 여부는 onboardingLoading 을 본다(같은 조회다).
  profile: { countryCode: string | null; regionCode: string | null } | null
  // 국가·지역을 바꾼 직후 호출(온보딩 확정 · 마이페이지 1회 변경). 재조회 없이 낙관적으로 덮는다.
  applyRegion: (countryCode: string | null, regionCode: string | null) => void
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
  const [needsNickname, setNeedsNickname] = useState(false)
  const [needsTerms, setNeedsTerms] = useState(false)
  const [deactivatedAt, setDeactivatedAt] = useState<string | null>(null)
  const [profile, setProfile] = useState<{ countryCode: string | null; regionCode: string | null } | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }
    async function loadOnboarding(u: User | null) {
      // 익명/무세션은 게이트 대상 아님.
      if (!u || !computeIsFullUser(u)) {
        setNeedsOnboarding(false)
        setNeedsNickname(false)
        setNeedsTerms(false)
        setDeactivatedAt(null)
        setProfile(null)
        setOnboardingLoading(false)
        return
      }
      setOnboardingLoading(true)
      const { data, error } = await supabase
        .from('profiles')
        .select('region_locked_at,country_code,region_code,nickname_set_at,age_band,deactivated_at')
        .eq('id', u.id)
        .maybeSingle()
      // 조회 실패 → FAIL-OPEN: 유저를 가두지 않는다.
      if (error) {
        setNeedsOnboarding(false)
        setNeedsNickname(false)
        setNeedsTerms(false)
        setDeactivatedAt(null)
        setProfile(null)
        setOnboardingLoading(false)
        return
      }
      setDeactivatedAt(data?.deactivated_at ?? null)
      // 게이트 판정에 쓰는 김에 국가·지역도 담아 둔다 — 예전엔 랭킹·아레나·마이페이지가
      // 이 값을 얻으려고 같은 행을 각자 한 번씩 더 읽었다.
      setProfile({
        countryCode: (data?.country_code as string | null) ?? null,
        regionCode: (data?.region_code as string | null) ?? null,
      })
      // 프로필 행이 없으면(최초) 지역 미확정 → 온보딩 필요.
      // 연령대도 같은 화면에서 받으므로 둘 중 하나라도 비면 보낸다 — 지역만 확정한 기존 회원이
      // 아레나에 들어오면 그 화면이 연령대만 물어본다. '공개 안 함'(=age_band 'private')도
      // 답한 것이라 다시 묻지 않는다(null 일 때만 묻는다).
      setNeedsOnboarding(data == null ? true : data.region_locked_at == null || data.age_band == null)
      // 닉네임은 '확정 시각'으로만 판정한다 — display_name 에는 가입 트리거가 넣은 구글 실명이 들어 있다.
      setNeedsNickname(data == null ? true : data.nickname_set_at == null)
      // ⚠️ **위 select 에 끼워 넣지 말 것.** 컬럼이 아직 없는 배포본에서는 쿼리 하나가 통째로 실패해
      //    닉네임·지역 게이트까지 같이 fail-open 된다. 따로 읽으면 못 읽어도 이 게이트만 꺼진다.
      const { data: tData, error: tErr } = await supabase
        .from('profiles').select('terms_agreed_at, terms_version').eq('id', u.id).maybeSingle()
      const tRow = tData as { terms_agreed_at: string | null; terms_version: string | null } | null
      setNeedsTerms(tErr ? false : tRow == null ? true : needsConsent(tRow.terms_agreed_at, tRow.terms_version))
      setOnboardingLoading(false)
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
      loadOnboarding(data.session?.user ?? null)
    })
    // ⚠️ Supabase 는 **탭이 다시 보일 때마다** 세션을 재검증하고 `SIGNED_IN`/`TOKEN_REFRESHED` 를 쏜다.
    //    그때마다 `setSession(새 객체)` 를 하면 컨텍스트 값이 바뀌어 **화면 전체가 리렌더**되고,
    //    `SIGNED_IN` 부수효과(profiles UPDATE + 온보딩 재조회)까지 매번 돈다 —
    //    관리자 화면에서 다른 탭 갔다 오면 "새로고침된 것처럼" 보이던 원인이다.
    //    → 사람이 실제로 바뀌었을 때만 반영한다(토큰만 갱신된 건 무시).
    let lastUserId: string | null = null
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      const uid = s?.user?.id ?? null
      const changed = uid !== lastUserId
      lastUserId = uid
      // 토큰만 새로 발급된 경우엔 세션 객체를 갈아끼우지 않는다 — 값이 같으면 리렌더도 필요 없다.
      if (changed || event === 'SIGNED_OUT') setSession(s)
      // ⛔ 여기서 탈퇴 플래그를 조용히 풀지 않는다 — 복구는 `/account/restore` 에서 사람이 누른다.
      //    (옛 코드가 이 자리에서 UPDATE 를 쐈는데, 이 조건 자체가 구글 로그인 복귀에선 거짓이라
      //     한 번도 안 나갔다. 나갔더라도 "실수로 로그인했더니 되살아남" 이라 어차피 틀린 동작이다.)
      if (changed && event === 'SIGNED_IN' && s?.user && !s.user.is_anonymous) loadOnboarding(s.user)
      if (event === 'SIGNED_OUT') {
        setNeedsOnboarding(false)
        setNeedsNickname(false)
        setDeactivatedAt(null)
        setProfile(null)
        setOnboardingLoading(false)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const user = session?.user ?? null

  // ⚠️ **아래 함수 7개와 value 는 반드시 useCallback/useMemo 로 고정한다.**
  //    이 프로바이더는 최상위라 부팅 중에만 3번 넘게 리렌더하는데(getSession 반환 · profiles 조회 반환),
  //    함수를 렌더마다 새로 만들면 이 값들을 **이펙트 의존성에 넣은 화면이 그때마다 이펙트를 다시 돌린다.**
  //    실제 사고: /games/:id 가 `ensureAnonymous` 를 deps 에 두고 있어서 제출 티켓을 두 번 받았고,
  //    티켓이 새로 발급되면 서버의 '플레이시간 대비 점수 상한' 기준 시각이 리셋돼
  //    **레벨형 게임(닿아라·지어라·프로그램해라)의 정상 기록이 깎였다**(2026-08-25).
  //    deps 를 [] 로 둘 수 있는 이유 = 전부 모듈 스코프(supabase)와 setState 만 쓴다(setState 는 불변).

  // 세션이 전혀 없을 때만 익명 세션 생성. 이미 세션 있으면 no-op.
  const ensureAnonymous = useCallback(async () => {
    if (!isSupabaseConfigured) throw new Error('Supabase 미설정')
    const { data } = await supabase.auth.getSession()
    if (data.session) return
    const { error } = await supabase.auth.signInAnonymously()
    if (error) throw error
  }, [])

  // 항상 일반 구글 로그인으로 통일(익명 응시 없음).
  const loginWithGoogle = useCallback(async (redirectTo?: string) => {
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
  }, [])

  const loginWithKakao = useCallback(async (redirectTo?: string) => {
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
  }, [])

  const logout = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  // set-region 이 200/409(already_locked) 로 끝났다 = 서버 기준 확정. 재조회 없이 낙관적으로 해제.
  const markOnboardingDone = useCallback(() => {
    setNeedsOnboarding(false)
    setOnboardingLoading(false)
  }, [])

  // set-nickname 이 성공했다 = 서버 기준 확정. 재조회 없이 낙관적으로 해제.
  const markNicknameDone = useCallback(() => {
    setNeedsNickname(false)
  }, [])

  // 동의가 저장됐다 = 서버 기준 확정. 재조회 없이 낙관적으로 해제.
  const markTermsDone = useCallback(() => {
    setNeedsTerms(false)
  }, [])

  // restore_account RPC 가 성공했다 = 서버 기준 복구 완료.
  //   ⚠️ nicknameReset 이면 닉네임 게이트가 이어서 떠야 한다 — 탈퇴한 사이 남이 그 닉네임을
  //     가져가면 RPC 가 nickname_set_at 을 비우고 계정을 살리기 때문이다.
  const markRestored = useCallback((nicknameReset = false) => {
    setDeactivatedAt(null)
    if (nicknameReset) setNeedsNickname(true)
  }, [])

  // set-region 이 성공했다 = 서버 기준 확정. 재조회 없이 낙관적으로 덮는다(markOnboardingDone 과 같은 성격).
  //   ⚠️ 이걸 빼먹으면 랭킹 탭 라벨·아레나 '우리 순위'가 **옛 나라**를 계속 가리킨다(새로고침해야 풀린다).
  const applyRegion = useCallback((countryCode: string | null, regionCode: string | null) => {
    setProfile({ countryCode, regionCode })
  }, [])

  // ⚠️ value 도 같이 고정해야 의미가 있다 — 함수만 고정하고 객체를 매 렌더 새로 만들면
  //    컨텍스트를 구독하는 화면 전체가 그대로 다시 렌더된다(고친 이유의 절반이 이쪽이다).
  const value: AuthState = useMemo(
    () => ({
      session,
      user,
      loading,
      isFullUser: computeIsFullUser(user),
      needsOnboarding,
      onboardingLoading,
      markOnboardingDone,
      needsNickname,
      markNicknameDone,
      needsTerms,
      markTermsDone,
      deactivatedAt,
      markRestored,
      profile,
      applyRegion,
      ensureAnonymous,
      loginWithGoogle,
      loginWithKakao,
      logout,
    }),
    [
      session,
      user,
      loading,
      needsOnboarding,
      onboardingLoading,
      needsNickname,
      needsTerms,
      deactivatedAt,
      profile,
      markOnboardingDone,
      markNicknameDone,
      markTermsDone,
      markRestored,
      applyRegion,
      ensureAnonymous,
      loginWithGoogle,
      loginWithKakao,
      logout,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
