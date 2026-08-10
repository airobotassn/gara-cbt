// 시험 전용 토큰 — SEB(잠금 브라우저) 안에서 쓰는 **좁은 인증수단**.
//
// SEB 는 세션이 없고 그 안에서 로그인도 못 한다(migrations/20260810120000_seb_handoff.sql 머리말 참고).
// 그래서 밖에서 만든 자격을 안으로 넘겨야 하는데, **정식 Supabase 세션을 넘기면 안 된다** —
// 그 세션은 결제·코인 선물·마이페이지까지 그 사람이 할 수 있는 전부를 할 수 있고 우리가 회수할 수단이 없다.
// 이 토큰은 그 반대다:
//   · 받아주는 곳이 start-exam · submit-exam **둘뿐**이다(다른 함수는 이 헤더를 아예 안 본다)
//   · 어느 응시권인지가 토큰에 박혀 있어 **다른 응시권을 태울 수 없다**
//   · 유효기간이 지나면 죽는다
//
// ⚠️ 유효기간을 응시 제한시간보다 짧게 잡지 말 것. 시험 도중 토큰이 죽으면 **제출이 실패한다** —
//    응시 TTL(240분)에 여유를 더한 값이라야 한다.
//
// 형식은 submit-minigame 의 제출 티켓과 같은 관례를 따른다: `<도메인>.<uid>.<ticketId>.<만료초>.<서명>`.
// 맨 앞 도메인 문자열은 다른 곳에서 만든 서명이 여기로 흘러들지 않게 하는 구분자다(그 반대도 마찬가지).
import type { SupabaseClient, User } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { adminClient, getUser } from './lib.ts'

/** 토큰 수명 — 응시 TTL(submit-exam 의 240분) + 여유. 시험 도중 만료되면 제출이 실패하므로 넉넉히 잡는다. */
const TTL_SEC = 6 * 60 * 60

/** 서명 도메인 구분자. 다른 HMAC(미니게임 티켓 등)과 페이로드 모양이 겹쳐도 서로 통과하지 못하게 한다. */
const DOMAIN = 'seb1'

function secret(): string {
  // 함수 런타임에 항상 있는 값을 HMAC 키로 쓴다(별도 시크릿 등록 없이 서명 — _shared/minigames.ts 와 같은 방식).
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? 'dev-only-insecure'
}

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, '')
}

/** 길이·내용이 달라도 걸리는 시간이 같게 비교한다(서명 비교에서 시간차로 한 글자씩 맞춰가는 걸 막는다). */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  const n = Math.max(x.length, y.length)
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

export async function issueExamToken(userId: string, ticketId: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + TTL_SEC
  const payload = `${DOMAIN}.${userId}.${ticketId}.${exp}`
  return `${payload}.${await hmac(payload)}`
}

export interface ExamTokenClaims {
  userId: string
  ticketId: string
}

/** 서명·도메인·만료만 본다. "그 응시권이 아직 쓸 만한가"는 start-exam 이 판정한다(여기서 겹쳐 보지 않는다). */
export async function verifyExamToken(raw: unknown): Promise<ExamTokenClaims | null> {
  if (typeof raw !== 'string' || !raw) return null
  const parts = raw.split('.')
  if (parts.length !== 5) return null
  const [dom, userId, ticketId, expStr, sig] = parts
  if (dom !== DOMAIN) return null
  const payload = `${dom}.${userId}.${ticketId}.${expStr}`
  if (!timingSafeEqual(await hmac(payload), sig)) return null
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || Math.floor(Date.now() / 1000) > exp) return null
  if (!userId || !ticketId) return null
  return { userId, ticketId }
}

/** 요청을 보낸 사람. `ticketId` 는 **토큰으로 들어온 경우에만** 값이 있고, 그때는 그 응시권만 쓸 수 있다. */
export interface ExamActor {
  user: User
  /** null = 평소처럼 로그인 세션으로 들어옴. 값이 있으면 SEB 토큰이고 이 응시권에 묶여 있다. */
  ticketId: string | null
}

/**
 * 응시 계열 함수의 인증 — **세션이 먼저**, 없으면 `x-exam-token` 헤더.
 *
 * 토큰으로 들어온 경우에도 **실제 사용자 행을 다시 읽어** 돌려준다. 그래야 호출부(start-exam)가
 * 이메일·익명여부 같은 걸 그대로 쓰던 코드를 안 바꿔도 되고, 탈퇴한 계정의 토큰이 살아남지 않는다.
 *
 * ⚠️ 이 함수를 응시 계열(start-exam·submit-exam) 밖에서 쓰지 말 것. 다른 함수가 이 헤더를 받기 시작하면
 *    "시험만 볼 수 있는 표"라는 이 토큰의 유일한 존재 이유가 사라진다.
 */
export async function getExamActor(req: Request, admin?: SupabaseClient): Promise<ExamActor | null> {
  const user = await getUser(req)
  if (user) return { user, ticketId: null }

  const claims = await verifyExamToken(req.headers.get('x-exam-token'))
  if (!claims) return null

  const db = admin ?? adminClient()
  const { data, error } = await db.auth.admin.getUserById(claims.userId)
  if (error || !data?.user) return null
  return { user: data.user as User, ticketId: claims.ticketId }
}
