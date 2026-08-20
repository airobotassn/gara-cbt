// 정기시험 월별 일정 규칙 — **화면 표시용 사본**(2026-08-20 정책).
//
//   1~10일   원서 접수 · 11~20일 응시 · 21~24일 채점 · 25일 10:00~ 합격자 조회
//
// ⚠️ **DB 에 들어가는 날짜는 여기서 만들지 않는다.** 서버(supabase/functions/_shared/exam-schedule.ts)가
//    월을 받아 계산해 저장하고, 이 파일은 관리자가 저장 전에 "며칠~며칠이 되는지" 눈으로 보는 용도다.
//    날짜(1·10·11·20·21·24·25·10시)를 바꾸면 **양쪽 다** 고칠 것 — 여기만 고치면 화면과 실제가 갈린다.

export const SCHEDULE_DAYS = {
  applyFrom: 1,
  applyTo: 10,
  examFrom: 11,
  examTo: 20,
  gradeFrom: 21,
  gradeTo: 24,
  releaseFrom: 25,
  releaseHour: 10,
} as const

/** 'YYYY-MM' 인가(월 01~12). */
export function isExamMonth(v: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(v)
}

/** 회차 대표일(응시 마지막 날) → 'YYYY-MM'. 편집 화면이 월 선택기를 되채울 때 쓴다. */
export function monthOfExamDate(examDate: string | null | undefined): string {
  return typeof examDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(examDate) ? examDate.slice(0, 7) : ''
}

/** 그 달의 말일(합격자 조회 끝). 28~31 이 달마다 달라 계산해야 한다. */
export function lastDayOfMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate() // m 은 1-based → 다음 달 0일 = 이 달 말일
}

/** 관리자 미리보기 줄. 예: { label:'원서 접수', range:'5. 1 ~ 5. 10' } */
export function schedulePreview(month: string): { key: string; label: string; range: string }[] {
  if (!isExamMonth(month)) return []
  const m = Number(month.slice(5, 7))
  const d = SCHEDULE_DAYS
  const r = (a: number, b: number) => `${m}. ${a} ~ ${m}. ${b}`
  return [
    { key: 'apply', label: '원서 접수', range: r(d.applyFrom, d.applyTo) },
    { key: 'exam', label: '응시 기간', range: r(d.examFrom, d.examTo) },
    { key: 'grade', label: '채점 기간', range: r(d.gradeFrom, d.gradeTo) },
    { key: 'release', label: '합격자 조회', range: `${m}. ${d.releaseFrom}. ${d.releaseHour}:00 ~ ${m}. ${lastDayOfMonth(month)}` },
  ]
}

/** ISO → KST 기준 {연, 월, 일}. 브라우저 시간대와 무관하게 읽는다. */
function kstParts(iso: string): { y: number; m: number; d: number } | null {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const k = new Date(t + 9 * 3600e3)
  return { y: k.getUTCFullYear(), m: k.getUTCMonth() + 1, d: k.getUTCDate() }
}

/**
 * 이 회차가 월 규칙(11~20일 응시)으로 만들어졌나 → 맞으면 그 달 'YYYY-MM'.
 * ⚠️ 서버(_shared/exam-schedule.ts)의 같은 이름 함수와 한 쌍이다 — 판정이 갈리면 화면과 실제 공개일이 어긋난다.
 */
export function monthOfWindow(examStartAt?: string | null, examEndAt?: string | null): string | null {
  if (!examStartAt || !examEndAt) return null
  const a = kstParts(examStartAt)
  const b = kstParts(examEndAt)
  if (!a || !b) return null
  if (a.y !== b.y || a.m !== b.m) return null
  if (a.d !== SCHEDULE_DAYS.examFrom || b.d !== SCHEDULE_DAYS.examTo) return null
  return `${a.y}-${String(a.m).padStart(2, '0')}`
}

/** 월 규칙 회차의 채점·합격자 조회 구간(ISO). 규칙 밖 회차면 null — 없는 날짜를 지어내지 않는다. */
export function gradeAndReleaseWindows(examStartAt?: string | null, examEndAt?: string | null) {
  const month = monthOfWindow(examStartAt, examEndAt)
  if (!month) return null
  const d = SCHEDULE_DAYS
  const day = (n: number) => `${month}-${String(n).padStart(2, '0')}T00:00:00+09:00`
  return {
    gradeStart: day(d.gradeFrom),
    gradeEnd: day(d.gradeTo),
    releaseStart: day(d.releaseFrom),
    releaseEnd: day(lastDayOfMonth(month)),
    releaseHour: d.releaseHour,
  }
}

/** 자동 회차명(한국어). 관리자가 고쳐 쓸 수 있다 — 저장 시 5개국어로 번역된다. */
export function autoRoundTitle(month: string): string {
  if (!isExamMonth(month)) return ''
  return `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월 정기시험`
}
