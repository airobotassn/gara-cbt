// 유사채팅(pseudo-chat) 보드 공용 헬퍼 — chat-post/chat-list/chat-edit/chat-delete/chat-report 5개 함수가 공유.
//  · resolveIpHash: IP 레이트리밋용 해시(일자별 salt) — 헤더 없으면 랜덤 sentinel(바닥선 사실상 제외).
//  · moderateOpenAI: OpenAI Moderations API 호출 + 모듈 단위 circuit breaker(연속 실패 5회 → 60초 단락).
import { sha256Hex } from './seb.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

export const CHAT_REQUIRE_LOGIN = (Deno.env.get('CHAT_REQUIRE_LOGIN') ?? 'true') !== 'false'
export const CHAT_MOD_FAILCLOSED = (Deno.env.get('CHAT_MOD_FAILCLOSED') ?? 'true') !== 'false'

// 링크/스팸 차단 — 설계 3종 세트의 '링크 필터'. moderation 과 무관하게 항상 동작(로컬).
//  기본 차단; CHAT_ALLOW_LINKS=true 로 허용 전환 가능.
export const CHAT_ALLOW_LINKS = (Deno.env.get('CHAT_ALLOW_LINKS') ?? 'false') === 'true'

// URL 감지: http(s):// · www. · 흔한 TLD 의 맨도메인(스팸/피싱). 오탐 최소화 위해 TLD 화이트리스트로 제한.
const LINK_RE =
  /(?:https?:\/\/|www\.)\S+|\b[a-z0-9][a-z0-9-]*\.(?:com|net|org|kr|io|co|me|gg|xyz|top|link|shop|site|online|info|biz|tv|cc|ly|to|app|dev|ru|cn|jp)\b(?:[/?#]\S*)?/i

export function containsLink(text: string): boolean {
  return LINK_RE.test(text)
}

// IP 헤더에서 대표 IP 하나를 뽑는다: x-forwarded-for 첫 토큰 → cf-connecting-ip → x-real-ip.
// 셋 다 없으면(로컬/게이트웨이 미설정) 요청마다 새 랜덤 sentinel 을 만들어 바닥선 가드를 사실상 면제한다
//   — sentinel 은 매 요청 고유값이라 60초 창에 절대 30건까지 쌓이지 않으므로, 해시하지 않고 그대로
//     ip_hash 로 사용한다(해시해도 어차피 유일값이라 의미가 없고, 굳이 salt 계산을 또 태울 필요가 없음).
export async function resolveIpHash(req: Request): Promise<string> {
  const xff = req.headers.get('x-forwarded-for')
  const fromXff = xff ? xff.split(',')[0].trim() : ''
  const ip = fromXff || req.headers.get('cf-connecting-ip')?.trim() || req.headers.get('x-real-ip')?.trim() || ''
  if (!ip) return crypto.randomUUID()
  const dailySalt = (Deno.env.get('CHAT_IP_SALT') ?? '') + new Date().toISOString().slice(0, 10)
  return await sha256Hex(ip + dailySalt)
}

// display_name 조회 — profiles.display_name 없으면(익명/미설정) '익명#'+uid 앞 4자.
export async function resolveDisplayName(admin: SupabaseClient, userId: string): Promise<string> {
  const { data } = await admin.from('profiles').select('display_name').eq('id', userId).maybeSingle()
  const name = (data?.display_name ?? '').trim()
  return name || `익명#${userId.slice(0, 4)}`
}

type ModResult = { status: 'flagged' | 'ok' | 'unavailable' }

// 연속 타임아웃/5xx 카운터 — 5회 연속 실패 시 60초간 즉시 unavailable(circuit breaker, 모듈 전역 상태).
let consecutiveFailures = 0
let breakerOpenUntil = 0

export async function moderateOpenAI(text: string): Promise<ModResult> {
  if (Date.now() < breakerOpenUntil) return { status: 'unavailable' }

  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) return { status: 'unavailable' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1500)
  try {
    const res = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: 'omni-moderation-latest', input: text }),
      signal: controller.signal,
    })
    if (!res.ok) {
      if (res.status >= 500) recordFailure()
      else consecutiveFailures = 0
      return { status: 'unavailable' }
    }
    consecutiveFailures = 0
    const data = await res.json()
    const flagged = !!data?.results?.[0]?.flagged
    return { status: flagged ? 'flagged' : 'ok' }
  } catch {
    recordFailure()
    return { status: 'unavailable' }
  } finally {
    clearTimeout(timer)
  }
}

function recordFailure() {
  consecutiveFailures += 1
  if (consecutiveFailures >= 5) {
    breakerOpenUntil = Date.now() + 60_000
    consecutiveFailures = 0
  }
}
