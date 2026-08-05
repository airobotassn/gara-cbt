import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// 환경변수가 없어도 앱이 죽지 않게(랜딩은 보이게) 가드.
export const isSupabaseConfigured = Boolean(url && anonKey)

if (!isSupabaseConfigured) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 설정되지 않았습니다. .env.local 을 확인하세요. (테스트 기능은 비활성)',
  )
}

// 미설정 시 placeholder로 생성 — 실제 호출 시점에 isSupabaseConfigured로 막는다.
export const supabase = createClient(
  url ?? 'https://placeholder.supabase.co',
  anonKey ?? 'placeholder-anon-key',
)

const fnBase = url ? `${url}/functions/v1` : ''

// Edge Function 호출 헬퍼 — 현재 세션 토큰을 실어보낸다.
//   extraHeaders: KB/번역 파이프라인처럼 x-passcode 같은 추가 헤더가 필요한 함수용(옵션).
export async function callFunction<T>(
  name: string,
  body: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase가 설정되지 않았습니다. .env.local을 채워주세요.')
  }
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const res = await fetch(`${fnBase}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey as string,
      Authorization: `Bearer ${session?.access_token ?? anonKey}`,
      ...(extraHeaders ?? {}),
    },
    body: JSON.stringify(body),
  })

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(json?.error ?? `${name} 호출 실패 (${res.status})`)
  }
  return json as T
}

/**
 * 페이지를 떠나면서 보내는 fire-and-forget 호출(keepalive).
 * 일반 fetch 는 navigate/unload 시 브라우저가 취소해버려서, 응시 '나가기' 같은
 * "떠나기 직전 한 줄"이 유실된다 → 자진 종료가 무단 이탈로 기록되는 문제.
 * sendBeacon 은 Authorization 헤더를 못 붙여서 쓸 수 없다(함수가 401).
 * 응답은 보지 않는다 — 실패해도 사용자 흐름을 막지 않는다.
 */
export function callFunctionBeacon(name: string, body: unknown): void {
  if (!isSupabaseConfigured) return
  void supabase.auth.getSession().then(({ data: { session } }) => {
    void fetch(`${fnBase}/${name}`, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey as string,
        Authorization: `Bearer ${session?.access_token ?? anonKey}`,
      },
      body: JSON.stringify(body),
    }).catch(() => {})
  })
}
