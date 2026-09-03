// 용어 문항 풀 — 미니게임 용어 퀴즈 3종(버텨라·쏴라·골라라) 전용.
//
// ⛔ **DAILY QUIZ 는 여기 없다(2026-09-03 지시).** `/daily` 는 `terms.ts` 의 문항을 그대로 쓴다 —
//    게임 문제은행과 별개다.
//
// ⛔ **단일 출처는 DB(term_questions)다.** 예전엔 같은 50문항이 네 벌(게임 HTML 3벌의 `POOL` +
//    `src/lib/terms.ts`)로 복제돼 있어서, 문항 하나를 고치려면 개발자가 파일 넷을 고치고 배포해야 했다.
//    지금은 관리자 화면에서 고치면 바로 반영된다(레벨테스트·CARIS 문항관리와 같은 방식).
//
// ⚠️ 코드 쪽 50문항(`terms.ts` 의 TERMS)은 **폴백으로만** 남는다 — 서버가 죽거나 비로그인 네트워크가
//    막혀도 게임이 빈 화면으로 뜨면 안 된다. 폴백은 한국어다(번역은 DB 에만 있다).
import { callFunction } from './supabase'
import { TERMS, type TermItem } from './terms'

/** 서버(term-pool)가 내려주는 한 문항. 이미 화면 언어로 투영돼 있다. */
export interface TermPoolItem {
  id?: string
  code?: string | null
  field: string
  desc: string
  answer: string
  distractors: string[] // 3개
}

/** 이 문항을 쓰는 게임 — 서버 term-pool 의 TARGETS 와 같은 목록이다. */
export type TermTarget = 'beat-cari' | 'shoot-cari' | 'pick-cari'

/** 코드에 박힌 기본 문항(폴백). 한국어 고정. */
export function fallbackPool(): TermPoolItem[] {
  return TERMS.map((t: TermItem) => ({
    field: t.field, desc: t.desc, answer: t.answer, distractors: t.distractors.slice(0, 3),
  }))
}

/**
 * 그 게임에 담긴 문항을 화면 언어로 받아온다. 실패하면 폴백(코드에 박힌 한국어 50문항).
 * ⚠️ 실패를 예외로 던지지 않는다 — 문항을 못 받았다고 게임을 못 하게 만들 이유가 없다.
 */
export async function fetchTermPool(gameId: TermTarget, lang: string): Promise<TermPoolItem[]> {
  try {
    const r = await callFunction<{ items?: TermPoolItem[] }>('term-pool', { gameId, lang })
    const items = (r.items ?? []).filter(
      (it) => it && it.desc && it.answer && Array.isArray(it.distractors) && it.distractors.length === 3,
    )
    return items.length ? items : fallbackPool()
  } catch {
    return fallbackPool()
  }
}
