// 유사채팅(pseudo-chat) 보드 공용 헬퍼 — chat-post/chat-list/chat-report/chat-translate 가 공유.
//  ⚠️ chat-edit·chat-delete 는 2026-08-13 제거됐다(수정이 신고 증거를 지울 수 있었다).
//  · resolveIpHash: IP 레이트리밋용 해시(일자별 salt) — 헤더 없으면 랜덤 sentinel(바닥선 사실상 제외).
//  · moderateOpenAI: OpenAI Moderations API 호출 + 모듈 단위 circuit breaker(연속 실패 5회 → 60초 단락).
import { sha256Hex } from './seb.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

// ⛔ 익명(게스트) 세션은 채팅을 못 쓴다 — 토글이 아니라 고정 규칙이다(2026-09-07).
//    옛 `CHAT_REQUIRE_LOGIN`(기본 true)은 끌 수 있는 스위치였고, 끄면 익명 글이 들어오므로
//    "익명 글을 익명으로 지켜주는" 분기 6개(이름 치환·uuid 은닉·아바타/국기 생략·카드 차단·
//    말풍선 색 고정·도배 간격 5초)가 딸려 있어야 했다. 익명 채팅을 안 하기로 해서 그 여섯과
//    `chat_messages.is_anon` 칸을 같이 걷어냈다.
//    ⛔ 스위치를 되살리지 말 것 — 되살리면 그 여섯도 같이 되살려야 하고, 하나라도 빠지면
//       '익명'이라고 적힌 배지만 남고 실제로는 누군지 드러난다(화면에 표시가 안 나는 종류).
// 모더레이션이 죽었을 때 글을 막을 것인가. **기본은 fail-open(막지 않는다) — 2026-09-10 지시.**
//  · 옛 기본값은 fail-closed(503 거부)였다. 그래서 OpenAI 가 30분 죽으면 **채팅도 30분 죽었고**,
//    그 사실이 아무 데도 안 남았다(장애 기록 insert 가 fail-open 갈래 안에만 있었다).
//  · OpenAI 하나가 빠질 뿐 나머지 관문 다섯은 그대로 돈다 — 금칙어(코드+관리자 등록) · 링크 차단 ·
//    도배 제한 · 신고 3명 자동 가림 · 관리자 제재. 그것 때문에 채팅을 통째로 멈추는 게 손해가 크다.
//  · 장애 중 글은 `pending` 으로 들어가고 **모두에게 보인다**(chat-list 의 노출 필터가 ok/pending 둘 다
//    통과시킨다). 복구되면 `recheckPending` 이 곁다리로 다시 검사한다.
//    ⛔ 노출 필터에서 pending 을 빼면 "글은 써지는데 아무도 못 보는" 상태로 되돌아간다 — 그건
//       사용자에게는 채팅이 죽은 것과 구별되지 않는다(옛 fail-open 의 실제 동작이 그랬다).
export const CHAT_MOD_FAILCLOSED = (Deno.env.get('CHAT_MOD_FAILCLOSED') ?? 'false') !== 'false'

// AI 모더레이션 사용 여부. `CHAT_MOD_ENABLED=false` 면 OpenAI 를 **아예 호출하지 않고** 통과시킨다.
//  · 로컬 배드워드 · 링크 차단 · 레이트리밋 · 신고는 그대로 살아 있다(끄는 건 AI 검사 하나뿐).
//  · 끄면 CHAT_MOD_FAILCLOSED 는 의미가 없어진다(막을 일 자체가 없으므로).
//  · ⚠️ fail-open 과의 차이는 **상시냐 장애 때만이냐** 하나로 좁혀졌다(2026-09-10) — 이 토글은 글이
//    `ok` 로 들어가 재검사 대상이 아니고, fail-open 은 `pending` 으로 들어가 복구되면 다시 검사받는다.
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

// 작성자 프로필 — 표시 이름 + 채팅 정지 여부.
//   display_name 이 없으면(익명/미설정) '익명#'+uid 앞 4자.
//   ⚠️ 예전엔 country_code 도 같이 읽어 "내 나라 방에만 쓰기" 판정에 썼는데, 그 제한이 풀리면서 빠졌다.
//   ⚠️ **정지 검사를 위해 쿼리를 하나 더 늘리지 않는다** — 어차피 글 쓸 때마다 읽는 행이라 칸만 얹었다.
//      상세(차수·사유·다음 단계)는 실제로 정지된 사람에게만 필요하므로 그때 RPC 로 한 번 더 읽는다.
export async function resolvePoster(
  admin: SupabaseClient,
  userId: string,
): Promise<{ name: string; suspendedUntil: string | null }> {
  const { data } = await admin
    .from('profiles')
    .select('display_name, suspended_until')
    .eq('id', userId)
    .maybeSingle()
  const name = (data?.display_name ?? '').trim()
  return {
    name: name || `익명#${userId.slice(0, 4)}`,
    suspendedUntil: (data?.suspended_until as string | null) ?? null,
  }
}

// ── 모더레이션 장애 알림 ────────────────────────────────────
// 옛 상태: 장애를 `chat_incidents` 에 쌓기만 하고 **읽는 코드가 0곳**이었다. 게다가 그 insert 가
//   fail-open 갈래 안에만 있어서, 기본값(fail-closed)에서는 채팅이 통째로 멈추는데도 기록조차 없었다.
// ⛔ `chat_incidents` 에 새로 쌓지 않는다 — 표가 둘이면 또 한쪽을 안 보게 된다(옛 행은 그대로 둔다).
//   관리자 홈 대시보드가 이미 `system_alerts` 를 그리고 있으므로 거기로 보낸다.
// ⚠️ `dedupe_key` 에 부분 유니크 인덱스가 걸려 있다(status <> 'resolved'). 그래서 **중복 insert 가
//    23505 로 튕기는 것이 곧 중복 제거**다 — 100번 터져도 알림은 한 줄이다. 삼켜야 한다.
const MOD_ALERT_KEY = 'chat-mod-down'

export async function reportModOutage(admin: SupabaseClient): Promise<void> {
  await admin.from('system_alerts').insert({
    severity: 'error',
    source: 'chat',
    message: '채팅 모더레이션(OpenAI) 응답 없음 — 검사 없이 글이 올라가고 있습니다.',
    link: '/admin?top=arena&tab=chat',
    dedupe_key: MOD_ALERT_KEY,
  })
  // 이미 열린 알림이 있으면 23505 — 그게 정상 경로다. 다른 오류도 채팅을 막을 이유는 없다.
}

// 복구되면 열린 알림을 닫는다. 안 닫으면 한 번 뜬 알림이 영구히 남아 아무도 안 보게 된다
// (`system_alerts` 에 status 를 둔 이유가 그거다).
export async function clearModOutage(admin: SupabaseClient): Promise<void> {
  await admin
    .from('system_alerts')
    .update({ status: 'resolved' })
    .eq('dedupe_key', MOD_ALERT_KEY)
    .neq('status', 'resolved')
}

// ── 장애 중 올라간 글 재검사 ────────────────────────────────
// 모더레이션이 죽은 동안 글은 `pending` 으로 들어간다(검사를 못 했다는 표시). 복구되면 다시 검사한다.
//   ⛔ **크론을 새로 만들지 않았다.** pg_cron 은 SQL 만 돌려서 OpenAI 를 못 부르고, 부르려면 확장
//      (pg_net)을 새로 깔아야 한다. 대신 **다음 사람이 글을 쓸 때 곁다리로** 돌린다 —
//      "방금 OpenAI 가 정상 응답했다" 가 복구를 아는 가장 확실한 신호이기 때문이다.
//      채팅이 조용하면 재검사도 안 돌지만, 조용하면 pending 도 안 쌓이므로 어긋나지 않는다.
//   ⚠️ 한 번에 조금씩만 본다 — 응답 뒤에서 도는 일이라 오래 붙잡고 있을 이유가 없다.
//   ⚠️ 검사 결과가 또 unavailable 이면 **그 자리에서 멈춘다**. 아직 복구가 아니므로 남은 글을
//      괜히 훑어봐야 전부 같은 답이고, pending 은 그대로 있어야 다음 기회에 다시 잡힌다.
export async function recheckPending(admin: SupabaseClient, limit = 3): Promise<void> {
  const { data } = await admin
    .from('chat_messages')
    .select('id, body')
    .eq('mod_status', 'pending')
    .is('deleted_at', null)
    .order('id', { ascending: true })
    .limit(limit)

  for (const m of (data ?? []) as { id: number; body: string | null }[]) {
    const r = await moderateOpenAI(m.body ?? '')
    if (r.status === 'unavailable') return
    const now = new Date().toISOString()
    if (r.status === 'flagged') {
      // 원래대로였으면 422 로 거부됐을 글이다 → 내리는 게 원상복구다.
      // ⚠️ 물리 삭제하지 않는다. `hidden_by='admin'` 이라 관리자가 '숨김 해제'로 되살릴 수 있다.
      await admin
        .from('chat_messages')
        .update({ deleted_at: now, hidden_by: 'admin', mod_status: MOD_AUTO_HIDDEN, updated_at: now })
        .eq('id', m.id)
    } else {
      await admin.from('chat_messages').update({ mod_status: 'ok', updated_at: now }).eq('id', m.id)
    }
  }
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
