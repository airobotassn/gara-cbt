// Phase-1 active_today 스왑과 공유하는 KST-일 단일지점(submit-exam:116 모델).
// UTC+9 로 이동 후 날짜만 잘라 KST 기준 YYYY-MM-DD 를 반환한다.
export function kstDay(d: Date = new Date()): string {
  const k = new Date(d.getTime() + 9 * 3600e3)
  return k.toISOString().slice(0, 10)
}
