// 서버측 미니게임 레지스트리 + 제출 티켓(sanity 게이트).
//  ⚠️ id 는 src/lib/minigames.ts 와 수동 동기 — 없는 id 는 400 거부라 신규 게임 추가 시 여기도 넣어야 한다.
//
// metric:
//   'score' — 누적 점수형(버텨라·쏴라·골라라). 클수록 위, 동률은 먼저 도달한 사람.
//   'level' — 레벨제 퍼즐(닿아라·프로그램해라·지어라). 도달 레벨이 1차 키, **동률은 소요시간(tieMs) 짧은 순**.
//     레벨이 5·3·6개뿐이라 도달 레벨만으로는 전원 만점이 되어 보드가 무의미해진다 → 시간으로 가른다.
//
// max: 서버 clamp 상한(위조 방어의 하드 실링). 'level' 은 게임의 실제 LEVELS.length 와 같아야 한다 —
//   넉넉히 잡으면 존재하지 않는 레벨을 신고해 1위를 차지할 수 있다(런타임 실측: reach 5 · build 3 · program 6).
// perSec: 초당 획득 가능한 상한(플레이 시간 대비 점수 sanity). 실측 텔레메트리가 없어 잠정값이며,
//   분포를 보고 조여야 한다. 여유를 크게 준 값이라 1차 방어선(무플레이 만점 제출) 역할만 한다.
export type Metric = 'score' | 'level'

export interface GameSpec {
  max: number
  metric: Metric
  perSec: number
}

export const GAMES: Record<string, GameSpec> = {
  'beat-cari': { max: 5000, metric: 'score', perSec: 80 }, // score += level*10 누적
  'shoot-cari': { max: 5000, metric: 'score', perSec: 100 }, // score += gain 누적
  // 골라라는 점수가 아니라 생존 라운드(round)다 — TOTAL_STAGES=15 가 상한이고 전원 클리어가 나오므로 시간으로 가른다.
  'pick-cari': { max: 15, metric: 'level', perSec: 0.2 },
  'reach-cari': { max: 5, metric: 'level', perSec: 0.35 },
  'build-cari': { max: 3, metric: 'level', perSec: 0.25 },
  'program-cari': { max: 6, metric: 'level', perSec: 0.3 },
  // 막아라 = 서류를 읽고 규정 위반을 가리는 점수형. 문서 102장 × 최대 150점(100 + 완벽 보너스 50)이 이론상 천장.
  //   perSec 는 "한 장을 2초에 처리" 를 상한으로 본 값 — 읽고 판단하는 게임이라 실제로는 훨씬 느리다.
  'block-cari': { max: 16000, metric: 'score', perSec: 75 },
  // 시켜라 = 지시를 골라 도면대로 만드는 레벨제(5레벨). 전원 만점이 나오므로 동률은 소요시간으로 가른다.
  'order-cari': { max: 5, metric: 'level', perSec: 0.3 },
  // 더듬어라 = 센서를 켜고 끄며 어두운 구역을 통과하는 레벨제(6구역).
  //   한 구역이 1분 안팎이라 6구역이면 5분 넘게 걸린다 — perSec 0.25 는 20초면 6까지 인정하는 넉넉한 상한이라
  //   정상 플레이를 깎지 않으면서 무플레이 만점 제출만 막는다(다른 레벨형과 같은 기준).
  'feel-cari': { max: 6, metric: 'level', perSec: 0.25 },
}

export function gameSpec(id: unknown): GameSpec | undefined {
  return typeof id === 'string' ? GAMES[id] : undefined
}

// ── 제출 티켓 ────────────────────────────────────────────────
// 부모(앱)가 게임을 띄울 때 start 로 티켓을 받고, 점수 제출 시 같이 보낸다.
// 서버는 서명·소유자·게임·나이를 검증해서 (a) 티켓 없는 생 제출, (b) 남의 티켓 재사용,
// (c) 플레이 시간이 말이 안 되는 점수를 막는다.
//   ⚠️ 한계: 게임 HTML 자체는 여전히 신뢰경계 밖이라 "오래 켜두고 큰 점수 신고"는 막지 못한다.
//     완전한 방어는 게임 내 텔레메트리 서명이 필요하고 그건 후속 과제(submit-minigame 헤더 참조).
const TICKET_TTL_SEC = 6 * 60 * 60 // 6시간 — 게임 켜두고 오래 플레이하는 경우까지 허용
const TICKET_MIN_SEC = 3 // 발급 직후 즉시 제출은 무플레이로 본다

function secret(): string {
  // 함수 런타임에 항상 있는 값을 HMAC 키로 쓴다(별도 시크릿 등록 없이 서명 가능).
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

/** 티켓 발급 — `<uid>.<gameId>.<발급초>.<서명>` */
export async function issueTicket(userId: string, gameId: string): Promise<string> {
  const iat = Math.floor(Date.now() / 1000)
  const payload = `${userId}.${gameId}.${iat}`
  return `${payload}.${await hmac(payload)}`
}

export interface TicketCheck {
  ok: boolean
  reason?: string
  ageSec: number
}

/** 티켓 검증 — 서명·소유자·게임 일치 + 나이 범위. ageSec 은 점수 sanity 계산에 쓴다. */
export async function verifyTicket(ticket: unknown, userId: string, gameId: string): Promise<TicketCheck> {
  if (typeof ticket !== 'string' || !ticket) return { ok: false, reason: 'ticket_missing', ageSec: 0 }
  const parts = ticket.split('.')
  if (parts.length !== 4) return { ok: false, reason: 'ticket_malformed', ageSec: 0 }
  const [uid, gid, iatStr, sig] = parts
  const payload = `${uid}.${gid}.${iatStr}`
  if ((await hmac(payload)) !== sig) return { ok: false, reason: 'ticket_bad_signature', ageSec: 0 }
  if (uid !== userId) return { ok: false, reason: 'ticket_owner_mismatch', ageSec: 0 }
  if (gid !== gameId) return { ok: false, reason: 'ticket_game_mismatch', ageSec: 0 }
  const iat = Number(iatStr)
  if (!isFinite(iat)) return { ok: false, reason: 'ticket_malformed', ageSec: 0 }
  const ageSec = Math.floor(Date.now() / 1000) - iat
  if (ageSec < TICKET_MIN_SEC) return { ok: false, reason: 'too_fast', ageSec }
  if (ageSec > TICKET_TTL_SEC) return { ok: false, reason: 'ticket_expired', ageSec }
  return { ok: true, ageSec }
}

/** 플레이 시간 대비 점수 상한 — 이걸 넘으면 clamp 한다(거부하지 않고 깎는다: 정상 플레이 오차를 죽이지 않기 위해). */
export function plausibleCap(spec: GameSpec, ageSec: number): number {
  // 레벨형은 1레벨은 언제나 인정(첫 클리어가 최소 시간 안에 나올 수 있음) → 바닥 1.
  const floor = spec.metric === 'level' ? 1 : 0
  return Math.max(floor, Math.min(spec.max, Math.ceil(spec.perSec * ageSec)))
}
