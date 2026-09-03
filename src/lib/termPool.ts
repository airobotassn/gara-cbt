// 용어 문항 풀 — 미니게임 3종(버텨라·쏴라·골라라)과 DAILY QUIZ 가 같이 쓴다.
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
  /** 한국어 정답 원문. DAILY QUIZ 해설(TERM_THEORY)이 이 값을 키로 찾는다 — 번역된 정답으로는 못 찾는다. */
  answerKo?: string
}

/** 이 문항을 쓰는 곳 — 서버 term-pool 의 TARGETS, 관리자 화면의 TERM_TARGETS 와 같은 목록이다. */
export type TermTarget = 'beat-cari' | 'shoot-cari' | 'pick-cari' | 'daily'

/** 코드에 박힌 기본 문항(폴백). 한국어 고정. */
export function fallbackPool(): TermPoolItem[] {
  return TERMS.map((t: TermItem) => ({
    field: t.field, desc: t.desc, answer: t.answer, distractors: t.distractors.slice(0, 3), answerKo: t.answer,
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

// ── DAILY QUIZ 용 ────────────────────────────────────────────
// 날짜별로 하나씩 순환한다. 같은 날엔 항상 같은 문제·같은 보기 순서(새로고침해도 고정).
// ⚠️ 문항 수가 바뀌면 그날의 문제도 바뀐다 — 관리자가 문항을 넣고 빼면 오늘 문제가 갈릴 수 있다.
//    하루에 여러 번 들어와도 그 안에서는 고정이라(같은 목록을 받는다) 화면이 흔들리지는 않는다.
function epochDay(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000)
}

export function dailyPick(pool: TermPoolItem[], date = new Date()): TermPoolItem | null {
  if (!pool.length) return null
  const d = epochDay(date)
  return pool[((d % pool.length) + pool.length) % pool.length]
}

/** 보기 4개(정답+오답3)를 날짜 시드로 섞은 배열. */
export function dailyChoicesOf(item: TermPoolItem, date = new Date()): string[] {
  const arr = [item.answer, ...item.distractors]
  let seed = epochDay(date) * 2654435761
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}
