// 정기시험 월별 일정 규칙 — **관리자는 월만 고르고, 나머지 날짜는 전부 여기서 나온다**(2026-08-20 정책).
//
//   1~10일   원서 접수      (결제 게이트)
//   11~20일  응시 기간      (응시 게이트)
//   21~24일  채점 기간      (응시 불가 · 게이트 아님, 표시용)
//   25일~말일 합격자 조회    (25일 10:00 KST 부터 성적·자격증 발급)
//
// ⚠️ **이 파일이 날짜의 단일 출처다.** 화면(관리자 미리보기)은 src/lib/examSchedule.ts 가 같은 날짜(1·10·11·
//    20·21·24·25)를 갖고 있지만 그건 "며칠~며칠"을 글로 보여주기 위한 것이고, DB 에 들어가는 값은 언제나
//    서버가 여기서 만든다. 관리자 화면이 보낸 날짜는 받지 않는다 — 받으면 규칙 밖 회차가 생긴다.
// ⚠️ 오프셋(+09:00)을 반드시 붙인다. 빼면 timestamptz 가 UTC 로 해석돼 접수·응시가 9시간씩 어긋난다.

export const KST_OFFSET = '+09:00'

const two = (n: number) => String(n).padStart(2, '0')

/** 규칙의 날짜들. 화면 사본(src/lib/examSchedule.ts)의 SCHEDULE_DAYS 와 같은 값이어야 한다. */
export const SCHEDULE_DAYS = {
  applyFrom: 1,
  applyTo: 10,
  examFrom: 11,
  examTo: 20,
  gradeFrom: 21,
  gradeTo: 24,
  releaseFrom: 25,
  releaseHour: 10, // KST
} as const

/** ISO → KST 기준 {연, 월, 일}. 저장값에 +09:00 이 붙어 있어도 브라우저·서버 시간대와 무관하게 읽는다. */
function kstParts(iso: string): { y: number; m: number; d: number } | null {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const k = new Date(t + 9 * 3600e3)
  return { y: k.getUTCFullYear(), m: k.getUTCMonth() + 1, d: k.getUTCDate() }
}

/**
 * 이 회차가 월 규칙(11~20일 응시)으로 만들어졌나 → 맞으면 그 달 'YYYY-MM'.
 * ⚠️ **이게 월 규칙 회차와 옛 회차를 가르는 유일한 표식이다.** 합격자 조회 시각을 컬럼으로 저장하지
 *    않기 때문(달이 정해지면 언제나 그 달 25일 10시라 계산으로 나온다 — 2026-08-20 결정).
 */
export function monthOfWindow(examStartAt?: string | null, examEndAt?: string | null): string | null {
  if (!examStartAt || !examEndAt) return null
  const a = kstParts(examStartAt)
  const b = kstParts(examEndAt)
  if (!a || !b) return null
  if (a.y !== b.y || a.m !== b.m) return null
  if (a.d !== SCHEDULE_DAYS.examFrom || b.d !== SCHEDULE_DAYS.examTo) return null
  return `${a.y}-${two(a.m)}`
}

export interface RoundSchedule {
  /** 대표 표기일 = 응시 마지막 날. '지난 시험' 판정이 이 값을 본다(첫날을 넣으면 기간 도중 사라진다). */
  examDate: string
  applyStartAt: string
  applyEndAt: string
  examStartAt: string
  examEndAt: string
  resultReleaseAt: string
}

/** 'YYYY-MM' 인가. 월이 01~12 인지까지 본다(2026-13 을 통과시키면 Date 가 다음 해로 넘어간다). */
export function isExamMonth(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)
}

/** 회차의 대표일에서 월을 되짚는다(편집 화면이 'YYYY-MM' 으로 되돌릴 때 쓴다). */
export function monthOfExamDate(examDate: string | null | undefined): string {
  return typeof examDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(examDate) ? examDate.slice(0, 7) : ''
}

/** 'YYYY-MM' → 그 달의 모든 일정. */
export function scheduleForMonth(month: string): RoundSchedule {
  if (!isExamMonth(month)) throw new Error('시험 월 형식이 잘못됐습니다(YYYY-MM).')
  const d = SCHEDULE_DAYS
  const at = (day: number, time: string) => `${month}-${two(day)}T${time}${KST_OFFSET}`
  return {
    examDate: `${month}-${two(d.examTo)}`,
    applyStartAt: at(d.applyFrom, '00:00:00'),
    applyEndAt: at(d.applyTo, '23:59:59'),
    examStartAt: at(d.examFrom, '00:00:00'),
    examEndAt: at(d.examTo, '23:59:59'),
    resultReleaseAt: at(d.releaseFrom, `${two(d.releaseHour)}:00:00`),
  }
}
