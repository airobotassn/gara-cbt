// WORLD ARENA — 글로벌 응시 현황 지도(자체 완결 HTML)를 앱 내부 라우트로 임베드.
//   iframe 이지만 SPA 라우트(/arena) 안이라 CARIS FAB 가 그대로 뜨고 전체 새로고침 없이 전환된다.
//   ?embed=1 로 지도 HTML 의 dev 배지/푸터를 숨겨 앱 화면처럼 보이게 한다.
//
// 백엔드/개인화 연동:
//   · lang → iframe ?lang= 쿼리(첫 페인트부터 해당 언어). 언어 바뀌면 src 변경 → 지도 리로드.
//   · leaderboard 함수(scope=country|region) 결과 + 로그인 계정 국가(home) 를 postMessage 로 지도에 주입.
//     지도는 실데이터가 있는 지역을 평균 레벨/참여 인원으로 칠하고, home 국가를 지구본 중앙에 정렬한다.
//   · 정적 iframe 에 secret 을 두지 않으려고, env·세션·프로필을 가진 부모가 fetch → 전달하는 구조.
import { useEffect, useRef, useState } from 'react'
import { callFunction, supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'

// 앱 테마는 Context 가 아니라 Layout 의 토글이 <html> 에 .dark 를 붙였다 떼는 방식이라,
// 여기서는 그 클래스를 직접 관찰한다. (ThemeProvider 가 생기면 이 훅은 그걸로 교체할 것)
function useHtmlTheme(): 'dark' | 'light' {
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  )
  useEffect(() => {
    const el = document.documentElement
    const obs = new MutationObserver(() =>
      setTheme(el.classList.contains('dark') ? 'dark' : 'light'),
    )
    obs.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return theme
}

type ServerBucket = { code: string; avg_level: number; member_count: number }
type ArenaBucket = { code: string; level: number; members: number }
type ArenaPayload = { home: string; country: ArenaBucket[]; region: ArenaBucket[] }

const toArena = (b: ServerBucket): ArenaBucket => ({
  code: b.code,
  level: b.avg_level,
  members: b.member_count,
})

export default function WorldArena() {
  const { lang } = useT()
  const { user } = useAuth()
  const userId = user?.id ?? null

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const payloadRef = useRef<ArenaPayload | null>(null)
  const readyRef = useRef(false)

  const theme = useHtmlTheme()
  // src 에는 '마운트 시점' 테마만 넣는다. theme 을 그대로 끼우면 토글할 때마다 src 가 바뀌어
  // 지도가 통째로 리로드되고 회전·드릴다운 상태가 날아간다. 이후 변경은 postMessage 로만.
  const [bootTheme] = useState(theme)

  // 테마 토글 → 아이프레임에 즉시 통보(리로드 없음).
  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'arena:theme', theme },
      window.location.origin,
    )
  }, [theme])

  useEffect(() => {
    let cancelled = false
    const origin = window.location.origin

    // 지도가 준비됐고 데이터가 있으면 주입. 양쪽 이벤트(iframe ready / fetch 완료)가 순서 무관하게 수렴.
    const flush = () => {
      const win = iframeRef.current?.contentWindow
      if (!win || !readyRef.current || !payloadRef.current) return
      win.postMessage({ type: 'arena:data', payload: payloadRef.current }, origin)
    }

    // 로그인 계정의 국가(country_code, alpha-2). 미로그인/미확정이면 KR 기본.
    const fetchHome = async (): Promise<string> => {
      if (!userId) return 'KR'
      try {
        const { data } = await supabase.from('profiles').select('country_code').eq('id', userId).maybeSingle()
        return (data?.country_code || 'KR').toUpperCase()
      } catch {
        return 'KR'
      }
    }

    const load = async () => {
      try {
        const [country, region, home] = await Promise.all([
          callFunction<{ buckets: ServerBucket[] }>('leaderboard', { scope: 'country', window: 'season' }),
          callFunction<{ buckets: ServerBucket[] }>('leaderboard', { scope: 'region', country: 'KR', window: 'season' }),
          fetchHome(),
        ])
        if (cancelled) return
        payloadRef.current = {
          home,
          country: (country.buckets ?? []).map(toArena),
          region: (region.buckets ?? []).map(toArena),
        }
        flush()
      } catch {
        // 실데이터 실패 시에도 home 만이라도 전달(지구본 중앙 정렬).
        if (cancelled) return
        payloadRef.current = { home: await fetchHome(), country: [], region: [] }
        flush()
      }
    }

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin) return
      if ((e.data as { type?: string } | null)?.type === 'arena:ready') {
        readyRef.current = true
        flush()
      }
    }

    window.addEventListener('message', onMessage)
    void load()
    return () => {
      cancelled = true
      window.removeEventListener('message', onMessage)
    }
  }, [userId])

  return (
    <div style={{ width: '100%', height: '100dvh', background: 'var(--bg)' }}>
      <iframe
        ref={iframeRef}
        // lang·theme 을 src 에 실어 첫 페인트부터 맞춘다(흰 화면 번쩍임 방지).
        // 언어 변경 시에만 src 가 바뀌며 지도 리로드 — 테마 변경은 postMessage 라 리로드 없음.
        src={`/world-arena.html?embed=1&lang=${lang}&theme=${bootTheme}`}
        title="WORLD ARENA"
        onLoad={() => {
          const win = iframeRef.current?.contentWindow
          if (!win) return
          // ready 신호를 놓친 드문 경우 대비 백업 주입.
          if (payloadRef.current) {
            win.postMessage({ type: 'arena:data', payload: payloadRef.current }, window.location.origin)
          }
          // lang 변경으로 리로드된 경우 src 의 bootTheme 은 낡았을 수 있으므로 현재 테마를 다시 보낸다.
          win.postMessage({ type: 'arena:theme', theme }, window.location.origin)
        }}
        style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
      />
    </div>
  )
}
