// 회원탈퇴 보관기간의 단일 출처.
//
// ⚠️ **서버(마이그레이션)와 한 벌이다** — `anonymize_deactivated_accounts(retention_days default 90)`
//   의 기본값과 여기 RETENTION_DAYS 가 같아야 한다. 한쪽만 고치면 화면이 "30일 남았어요" 라고
//   말하는 동안 서버가 이미 파기하는(또는 그 반대) 상태가 된다. 크론은 인자 없이 부르므로
//   서버 쪽 값은 **함수 시그니처의 기본값**이 곧 실효값이다.
export const RETENTION_DAYS = 90

/** 탈퇴 시각 → 파기 예정일(로컬 Date). */
export function purgeDateOf(deactivatedAt: string): Date {
  return new Date(new Date(deactivatedAt).getTime() + RETENTION_DAYS * 86400_000)
}

/**
 * 파기까지 남은 일수. 0 이면 오늘내일이고 음수는 이미 지난 것이다.
 * ⚠️ 올림(ceil)이다 — 내림으로 두면 마지막 하루가 "0일 남음" 이 되어 이미 지난 것처럼 읽힌다.
 */
export function daysLeftOf(deactivatedAt: string): number {
  return Math.ceil((purgeDateOf(deactivatedAt).getTime() - Date.now()) / 86400_000)
}
