// 약관·연령 동의 — 화면 쪽 단일 출처.
//
// ⚠️ **`supabase/functions/agree-terms` 의 `TERMS_VERSION` 과 글자까지 같아야 한다.**
//    한쪽만 올리면 둘 중 하나가 된다:
//      · 화면만 올림 → 저장된 값이 영영 안 맞아 **전원이 매번 다시 동의**한다.
//      · 서버만 올림 → 화면이 옛 값과 비교해 **아무한테도 안 물어본다**(개정 동의를 못 받는다).
//    약관을 고칠 때 두 곳을 같이 올릴 것.
export const TERMS_VERSION = '2026-08-31'

/**
 * 지금 동의를 받아야 하는가.
 * ⚠️ 한 번도 동의 안 함(null)과 **옛 판에 동의함**을 같이 본다 — 뒤쪽을 빼면 약관을 개정해도
 *    아무도 다시 동의하지 않는다(버전 컬럼을 둔 이유가 그것이다).
 */
export function needsConsent(agreedAt: string | null, version: string | null): boolean {
  if (!agreedAt) return true
  return version !== TERMS_VERSION
}
