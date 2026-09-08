// 용어 문제은행(term_questions)의 **은행** — 게임 3종과 DAILY QUIZ 가 같은 표를 은행만 갈라 쓴다(2026-09-08).
//
// 화면·요청은 **키**(game·daily)로 말하고, 표는 uuid(term_banks.id)로 가른다. 매핑은 여기 하나다 —
// admin(관리 CRUD)과 term-pool(서빙)이 같이 import 한다. 두 벌이 되면 관리자가 넣은 문항이 다른 은행으로 나간다.
//
// ⚠️ 문항 번호 접두사도 은행마다 다르다(T-001 / D-001). 번호 유일 인덱스(term_questions_code_uniq)가 **전역**이라
//    같은 접두사를 쓰면 두 은행이 번호를 나눠 갖게 되고, 이력 검색에서 남의 은행 문항이 걸린다.

export type TermBankKey = 'game' | 'daily'

export const TERM_BANKS: Record<TermBankKey, { id: string; codePrefix: string }> = {
  game: { id: '00000000-0000-0000-0000-0000000000a1', codePrefix: 'T' },
  daily: { id: '00000000-0000-0000-0000-0000000000a2', codePrefix: 'D' },
}

/** 요청의 bank 를 키로 접는다. 없거나 모르는 값이면 **게임**이다 — 이 컬럼이 생기기 전 화면(bank 를 안 보내는)과의 호환. */
export function termBankKey(v: unknown): TermBankKey {
  return v === 'daily' ? 'daily' : 'game'
}
