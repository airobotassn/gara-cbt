// 용어 문항 풀 — 미니게임 용어 퀴즈 3종(버텨라·쏴라·골라라) + DAILY QUIZ.
//
// **은행이 둘이다(2026-09-08).** 게임 3종은 게임 은행, DAILY QUIZ 는 DAILY 은행 — 같은 표를 은행으로 가른다.
//   서버(term-pool)가 대상(gameId)으로 은행을 고르므로 여기서는 대상 이름만 정확히 보내면 된다.
//   ⛔ 'daily' 를 게임 은행에 물리지 말 것 — 관리자가 게임 문항을 고칠 때 DAILY 가 따라 바뀐다(2026-09-03 에 그래서 뗐다).
//
// ⛔ **단일 출처는 DB(term_questions)다.** 예전엔 같은 50문항이 네 벌(게임 HTML 3벌의 `POOL` +
//    `src/lib/terms.ts`)로 복제돼 있어서, 문항 하나를 고치려면 개발자가 파일 넷을 고치고 배포해야 했다.
//    지금은 관리자 화면에서 고치면 바로 반영된다(레벨테스트·CARIS 문항관리와 같은 방식).
//
// ⚠️ 코드 쪽 50문항(`terms.ts` 의 TERMS)은 **폴백으로만** 남는다 — 서버가 죽거나 비로그인 네트워크가
//    막혀도 게임·DAILY 가 빈 화면으로 뜨면 안 된다. 폴백은 한국어다(번역은 DB 에만 있다).
import { callFunction } from './supabase'
import { TERMS, termTheory, type TermItem } from './terms'

/** 서버(term-pool)가 내려주는 한 문항. 이미 화면 언어로 투영돼 있다. */
export interface TermPoolItem {
  id?: string
  code?: string | null
  field: string
  desc: string
  /** 화면에 보이는 정답 — 화면 언어로 투영돼 있다. */
  answer: string
  /**
   * 한국어 원본 정답. **해설(글·그림)을 찾는 열쇠**다 — 해설은 코드에 한국어 표기로 저장돼 있어서
   * 투영된 `answer` 로 찾으면 외국어에선 해설 카드가 통째로 안 뜬다.
   * ⚠️ 옛 배포본 서버는 이 칸을 안 준다 → 그때는 `answer` 로 떨어진다(한국어면 그대로 맞다).
   */
  answerKo?: string
  distractors: string[] // 3개
}

/** 이 문항을 쓰는 대상 — 서버 term-pool 의 TARGETS 와 같은 목록이다. */
export type TermTarget = 'beat-cari' | 'shoot-cari' | 'pick-cari' | 'daily'

/**
 * 코드에 박힌 기본 문항(폴백). 한국어 고정.
 * ⚠️ DAILY QUIZ 는 **해설 그림이 있는 것만** 남긴다(2026-09-08 지시 · DB 은행도 그 8개만 살아 있다).
 *    안 거르면 서버가 잠깐 안 열린 날에만 해설 없는 문항이 튀어나온다 — 규칙이 그날만 달라진다.
 */
export function fallbackPool(target: TermTarget = 'beat-cari'): TermPoolItem[] {
  const src = target === 'daily' ? TERMS.filter((t) => !!termTheory(t)) : TERMS
  return src.map((t: TermItem) => ({
    field: t.field, desc: t.desc, answer: t.answer, answerKo: t.answer, distractors: t.distractors.slice(0, 3),
  }))
}

/**
 * 그 대상에 담긴 문항을 화면 언어로 받아온다. 실패하면 폴백(코드에 박힌 한국어 50문항).
 * ⚠️ 실패를 예외로 던지지 않는다 — 문항을 못 받았다고 게임을 못 하게 만들 이유가 없다.
 * ⚠️ 순서는 서버가 정한 그대로 둔다(sort_order → code). DAILY QUIZ 가 "오늘 = N번째" 로 고르므로 여기서 섞으면 안 된다.
 */
export async function fetchTermPool(gameId: TermTarget, lang: string): Promise<TermPoolItem[]> {
  try {
    const r = await callFunction<{ items?: TermPoolItem[] }>('term-pool', { gameId, lang })
    const items = (r.items ?? []).filter(
      (it) => it && it.desc && it.answer && Array.isArray(it.distractors) && it.distractors.length === 3,
    )
    return items.length ? items : fallbackPool(gameId)
  } catch {
    return fallbackPool(gameId)
  }
}
