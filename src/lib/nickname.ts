// 닉네임 규칙 — 서버(supabase/functions/set-nickname/index.ts)와 **같은 규칙**을 유지해야 한다.
// 여기는 입력 중 즉시 피드백용일 뿐이고, 실제 강제는 서버 + DB 유니크 인덱스가 한다.
export const NICK_MIN = 2
export const NICK_MAX = 12

// 6개국어 서비스라 한글/영문 화이트리스트로는 못 막는다 → 유니코드 글자·숫자·밑줄만 허용.
// (공백·특수문자·이모지 차단 = 사칭·표시 깨짐 방지)
const SHAPE = /^[\p{L}\p{N}_]+$/u

export type NickError = 'length' | 'shape' | null

// 길이는 코드포인트 기준(CJK 1자 = 1자).
export function nickLength(s: string): number {
  return [...s.trim()].length
}

export function nicknameError(raw: string): NickError {
  const s = raw.trim()
  const n = nickLength(s)
  if (n < NICK_MIN || n > NICK_MAX) return 'length'
  if (!SHAPE.test(s)) return 'shape'
  return null
}
