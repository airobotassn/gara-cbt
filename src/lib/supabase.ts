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

/** 함수 URL — 페이지가 사라지는 순간처럼 callFunction 을 못 쓰는 자리에서 직접 fetch 하려고 연다. */
export function fnUrl(name: string): string {
  return `${fnBase}/${name}`
}

/** 브라우저에 노출되는 공개 키. 위 anonKey 와 같은 값이고, 직접 fetch 하는 곳에서 쓴다. */
export const supabaseAnonKey = anonKey ?? ''

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
    // ⚠️ 본문을 같이 싣는다 — 오류 응답에도 **쓸 수 있는 결과가 섞여 있는 경우**가 있다.
    //    (이북 번역은 하루 한도로 429 를 주면서 그때까지 번역된 조각을 함께 돌려준다. 예전엔 사유만
    //     챙기고 본문을 버려서 그 성공분이 통째로 사라졌다.)
    throw new FunctionError(json?.error ?? `${name} 호출 실패 (${res.status})`, res.status, json?.code, json)
  }
  return json as T
}

/**
 * 함수 호출 실패. `Error` 를 상속하므로 기존 `e instanceof Error` 처리는 그대로 동작한다.
 *
 * ⚠️ `code` 를 따로 들고 다니는 이유 — 예전엔 메시지만 던져서, 호출부가 분기하려면 **한국어 문구를
 *    정규식으로 검사**해야 했다. 문구를 다듬거나 번역하는 순간 조용히 깨지는 방식이다
 *    (허브 토스트에서 같은 실수를 한 적이 있다 — CLAUDE.md 참고). 서버가 기계 코드를 주면 그걸 쓴다.
 */
export class FunctionError extends Error {
  // ⚠️ 생성자 파라미터 프로퍼티(`readonly status: number`)를 쓰지 말 것 —
  //    이 저장소는 tsconfig 의 erasableSyntaxOnly 가 켜져 있어 컴파일이 막힌다. 필드로 따로 선언한다.
  status: number
  code?: string
  /** 오류 응답의 본문(파싱된 JSON). 오류인데도 쓸 수 있는 결과가 섞여 오는 경우가 있다 — 위 주석 참고. */
  body?: unknown

  constructor(message: string, status: number, code?: string, body?: unknown) {
    super(message)
    this.name = 'FunctionError'
    this.status = status
    this.code = code
    this.body = body
  }
}

/** 이 에러가 서버의 특정 코드인가. 문구 대신 이걸로 분기할 것. */
export function isFunctionCode(e: unknown, code: string): boolean {
  return e instanceof FunctionError && e.code === code
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
