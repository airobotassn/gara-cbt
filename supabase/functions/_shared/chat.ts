// 유사채팅(pseudo-chat) 보드 공용 헬퍼 — chat-post/chat-list/chat-report/chat-translate 가 공유.
//  ⚠️ chat-edit·chat-delete 는 2026-08-13 제거됐다(수정이 신고 증거를 지울 수 있었다).
//  · resolveIpHash: IP 레이트리밋용 해시(일자별 salt) — 헤더 없으면 랜덤 sentinel(바닥선 사실상 제외).
//  · moderateOpenAI: OpenAI Moderations API 호출 + 모듈 단위 circuit breaker(연속 실패 5회 → 60초 단락).
import { sha256Hex } from './seb.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

export const CHAT_REQUIRE_LOGIN = (Deno.env.get('CHAT_REQUIRE_LOGIN') ?? 'true') !== 'false'
export const CHAT_MOD_FAILCLOSED = (Deno.env.get('CHAT_MOD_FAILCLOSED') ?? 'true') !== 'false'

// AI 모더레이션 사용 여부. `CHAT_MOD_ENABLED=false` 면 OpenAI 를 **아예 호출하지 않고** 통과시킨다.
//  · 로컬 배드워드 · 링크 차단 · 레이트리밋 · 신고는 그대로 살아 있다(끄는 건 AI 검사 하나뿐).
//  · 끄면 CHAT_MOD_FAILCLOSED 는 의미가 없어진다(막을 일 자체가 없으므로).
//  · ⚠️ fail-open(CHAT_MOD_FAILCLOSED=false)과 다르다 — fail-open 은 글이 pending 으로 들어가
//    작성자 본인에게만 보이지만(chat-list 의 노출 필터), 이 토글은 ok 로 들어가 모두에게 보인다.
//    "모더레이션 없이 채팅을 열어두고 싶다"면 fail-open 이 아니라 이쪽이다.
export const CHAT_MOD_ENABLED = (Deno.env.get('CHAT_MOD_ENABLED') ?? 'true') !== 'false'

// 링크/스팸 차단 — 설계 3종 세트의 '링크 필터'. moderation 과 무관하게 항상 동작(로컬).
//  기본 차단; CHAT_ALLOW_LINKS=true 로 허용 전환 가능.
export const CHAT_ALLOW_LINKS = (Deno.env.get('CHAT_ALLOW_LINKS') ?? 'false') === 'true'

// 자동 가림 임계치 — 서로 다른 사람 N명이 신고하면 관리자 손을 안 거치고 즉시 채팅창에서 내린다.
//  · 예전엔 임계치가 없어서 100명이 신고해도 관리자가 화면을 열 때까지 글이 그대로 보였다.
//  · 1인 1신고(unique(message_id, reporter_id))라 신고 행 수 = 서로 다른 신고자 수다.
//  · 무효(dismissed) 처리된 신고는 세지 않는다 — 오신고가 쌓여 자동 가림을 밀어올리면 안 된다.
export const CHAT_AUTO_HIDE_REPORTS = Number(Deno.env.get('CHAT_AUTO_HIDE_REPORTS') ?? '3')

// mod_status 값. 'ok' 만 남에게 보인다(chat-list 의 노출 필터) — 나머지는 작성자 본인에게만 보인다.
//  · 'pending'     = OpenAI 모더레이션 장애로 검사 못 하고 올라간 글(fail-open)
//  · 'auto_hidden' = 신고 누적으로 자동 가림. pending 과 이유가 달라서 관리자 화면 배지를 가르려고 분리했다.
export const MOD_AUTO_HIDDEN = 'auto_hidden'

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

// ── 방(room) ──
// 방은 전세계('global') 하나 + 나라별 하나(ISO2 대문자)뿐이다. 클라가 보낸 값을 그대로 쓰면
// 오타·장난 문자열이 그때마다 새 방을 만들어내므로, 모양이 안 맞으면 전부 전세계로 접는다.
export const GLOBAL_ROOM = 'global'

export function normalizeRoom(v: unknown): string {
  const s = String(v ?? '').trim()
  if (!s || s.toLowerCase() === GLOBAL_ROOM) return GLOBAL_ROOM
  const up = s.toUpperCase()
  return /^[A-Z]{2}$/.test(up) ? up : GLOBAL_ROOM
}

// 작성자 프로필 — 표시 이름.
//   display_name 이 없으면(익명/미설정) '익명#'+uid 앞 4자.
//   ⚠️ 예전엔 country_code 도 같이 읽어 "내 나라 방에만 쓰기" 판정에 썼는데, 그 제한이 풀리면서 빠졌다.
export async function resolvePoster(
  admin: SupabaseClient,
  userId: string,
): Promise<{ name: string }> {
  const { data } = await admin.from('profiles').select('display_name').eq('id', userId).maybeSingle()
  const name = (data?.display_name ?? '').trim()
  return { name: name || `익명#${userId.slice(0, 4)}` }
}

type ModResult = { status: 'flagged' | 'ok' | 'unavailable' }

// 연속 타임아웃/5xx 카운터 — 5회 연속 실패 시 60초간 즉시 unavailable(circuit breaker, 모듈 전역 상태).
let consecutiveFailures = 0
let breakerOpenUntil = 0

export async function moderateOpenAI(text: string): Promise<ModResult> {
  // 토글이 꺼져 있으면 검사 없이 통과(ok). 호출부(chat-post)는 손댈 게 없다.
  if (!CHAT_MOD_ENABLED) return { status: 'ok' }
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
