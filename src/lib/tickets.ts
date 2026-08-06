// 응시권(exam_tickets) 프론트 표현 — my-attempts 응답 모양 + 표시용 헬퍼.
//
// 응시권 = "결제했다"와 "응시했다" 사이를 담는 유일한 행이다. 마이페이지·응시 게이트·결제 결과가
// 같은 물건을 읽으므로, 타입과 '왜 지금은 못 쓰는지' 코드→문구 매핑을 화면마다 다시 쓰면
// 세 화면이 서로 다른 말을 하게 된다. 그래서 여기 한 곳에 둔다.
//
// ⚠️ **판정은 전부 서버가 한다**(`usable` / `usableReason`). 프론트에서 시험일·상태를 다시 계산하지 말 것 —
//    접수·응시 창 판정이 KST 기준인데 브라우저 타임존으로 다시 재면 최대 9시간 어긋난다.
// ⚠️ 문구는 i18n `D` 사전(`ticket.*`)에 있다. 여기서는 **키만** 고른다(6개국어를 코드가 들고 있으면 안 된다).
import { getTracks } from './caris'
import type { Lang, TFunc } from './i18n'

export type ExamTicketStatus = 'issued' | 'consumed' | 'void' | 'expired'
export type ExamTicketSource = 'pg' | 'admin' | 'free'

/** 지금 응시할 수 없는 이유(서버 코드값). 문구가 아니라 코드로 내려온다 — 번역은 프론트 소관. */
export type TicketUnusableReason =
  | 'before_exam_day' // 응시 창(회차 11~20일)이 아직 안 열렸다
  | 'window_closed' // 응시 창이 지났다
  | 'already_taken' // 이 회차·급수로 이미 제출한 응시가 있다
  | 'expired' // 회차가 끝나도록 안 썼다
  | 'in_progress' // 응시가 진행 중(다른 창/기기)

/** my-attempts 응답의 `tickets[]` 한 건. 서버(T4)가 만드는 모양 그대로. */
export interface ExamTicketView {
  ticketId: string
  roundId: string
  roundTitle: string
  roundKind: 'regular' | 'rolling'
  examDate: string | null // 'YYYY-MM-DD'(대표일). 실제 응시 가능 판정은 서버의 usable 이 한다
  tier: string // exam_tiers.tier — beginner|pro|elite|master|grandmaster|zenith
  status: ExamTicketStatus
  source: ExamTicketSource
  issuedAt: string
  consumedAt: string | null
  expiresAt: string | null
  pricePaid: number // 발급 시점 원화 스냅샷(표시는 money.ts 의 usd())
  attemptId: string | null // 이 응시권으로 만들어진 응시(있으면)
  usable: boolean
  usableReason?: TicketUnusableReason | null
}

const STATUS_KEY: Record<ExamTicketStatus, string> = {
  issued: 'ticket.status_issued',
  consumed: 'ticket.status_consumed',
  void: 'ticket.status_void',
  expired: 'ticket.status_expired',
}

const REASON_KEY: Record<TicketUnusableReason, string> = {
  before_exam_day: 'ticket.reason_before_exam_day',
  window_closed: 'ticket.reason_window_closed',
  already_taken: 'ticket.reason_already_taken',
  in_progress: 'ticket.reason_in_progress',
  expired: 'ticket.reason_expired',
}

/** 상태 배지 문구 키. 서버가 모르는 값을 보내면 빈 문자열(호출부가 원문을 그대로 찍는다). */
export function ticketStatusKey(status: string): string {
  return STATUS_KEY[status as ExamTicketStatus] ?? ''
}

/** 관리자 수기 발급·무료 발급만 따로 배지를 단다. 일반 결제(pg)는 굳이 알릴 게 없다. */
export function ticketSourceKey(source: string): string {
  return source === 'admin' ? 'ticket.source_admin' : source === 'free' ? 'ticket.source_free' : ''
}

/**
 * 'YYYY-MM-DD' 를 사람이 읽는 날짜로.
 * ⚠️ `new Date('2026-08-11')` 은 **UTC 자정**으로 파싱된다 — 브라우저가 KST 서쪽(미국 등)이면
 *    하루 전으로 찍힌다. 연·월·일을 떼어 로컬 Date 로 조립해 날짜가 밀리지 않게 한다.
 */
export function examDateText(iso: string | null | undefined, lang: string): string {
  if (!iso) return '-'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  try {
    return new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', day: 'numeric' }).format(d)
  } catch {
    return `${m[1]}-${m[2]}-${m[3]}`
  }
}

/**
 * 응시권 한 줄에 붙일 안내 문구 — 쓸 수 있으면 '지금 응시 가능', 아니면 그 이유.
 * `before_exam_day` 만 시험일을 끼워 넣는다(언제부터 되는지가 그 문장의 전부라서).
 */
export function ticketReasonText(tk: ExamTicketView, t: TFunc, lang: string): string {
  if (tk.usable) return t('ticket.usable')
  const key = tk.usableReason ? REASON_KEY[tk.usableReason] : ''
  if (!key) return ''
  return t(key, { date: examDateText(tk.examDate, lang) })
}

/**
 * 급수 key → 화면 이름. `caris.ts` 의 트랙/티어 이름을 그대로 재사용한다 —
 * 티어 이름표를 여기 복사하면 /guide·/plan 과 갈린다(브랜드 고유명이라 언어는 무관하지만 트랙명은 번역된다).
 * 모르는 key(옛 데이터·오타)는 원문을 그대로 돌려준다 — 빈칸보다 낫다.
 */
export function tierDisplay(tierKey: string, lang: Lang): string {
  for (const track of getTracks(lang)) {
    const tier = track.tiers.find((x) => x.key === tierKey)
    if (tier) return `${track.name} ${tier.name}`
  }
  return tierKey
}
