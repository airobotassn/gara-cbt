// DAILY QUIZ 해설의 다국어 — 해설 글(TERM_THEORY)과 **그림 속 라벨**을 같이 다룬다 (2026-09-08).
//
// 해설은 코드에 한국어로 쓰여 있다. 화면 언어가 한국어가 아니면
//   · 해설 글(한 줄 요약·보충·비교)  → 여기서 갈아 끼운다
//   · 그림 안의 글자(`Lab` 부품)      → 여기서 갈아 끼운다
// 둘을 한 파일에 담는 이유: 같은 화면에서 같이 보이는 글이라 따로 받으면 **글만 번역되고 그림은 한국어인 순간**이 생긴다.
//
// ⛔ **한국어는 여기에 없다.** 원본이 코드(terms.ts·dailyVisuals/*)에 있고, 이 표는 **덮어쓰기용**이다.
//    못 찾으면 한국어가 그대로 나온다 — 번역이 덜 된 언어도 화면이 비지 않는다.
// ⚠️ **사전은 언어별 파일이라 그 언어를 고른 사람만 받는다**(앱의 i18n 규칙과 같다). 127개 해설 + 라벨 450여 개를
//    6벌 통째로 싣으면 /daily 청크가 몇 배가 된다.
// ⚠️ 조회는 **동기**여야 한다 — `Lab` 은 SVG 를 그리는 중에 불리고 `termTheory` 도 렌더 중에 불린다.
//    그래서 모듈이 한 번 받아 들고 있고, 도착하면 구독자에게 알려 다시 그리게 한다(charArtSrc 와 같은 방식).
import { useEffect, useState } from 'react'
import type { TermTheory } from './theory/types'

/** 한 언어의 덮어쓰기 표. 키는 **한국어 원문**(해설은 정답 용어, 라벨은 그 글자 그대로). */
export interface DailyI18nPack {
  /** 정답 용어(한국어) → 번역된 해설. `visual` 은 안 담는다(그림 키는 언어와 무관). */
  theory: Record<string, Omit<TermTheory, 'visual'>>
  /** 그림 속 한국어 라벨 → 번역된 라벨. */
  labels: Record<string, string>
}

const EMPTY: DailyI18nPack = { theory: {}, labels: {} }

// lang → 받아둔 표. 'ko' 는 영원히 비어 있다(원본이 곧 한국어라 덮어쓸 게 없다).
const packs = new Map<string, DailyI18nPack>([['ko', EMPTY]])
const pending = new Map<string, Promise<void>>()
const subs = new Set<() => void>()
let current = 'ko'

function notify() { for (const f of subs) f() }

/** 그 언어 표를 받아 둔다. 이미 받았거나 받는 중이면 아무 일도 안 한다. */
function ensure(lang: string): void {
  if (packs.has(lang) || pending.has(lang)) return
  const p = import(`./theory/i18n/${lang}.ts`)
    .then((m: { PACK?: DailyI18nPack }) => { packs.set(lang, m.PACK ?? EMPTY) })
    // ⚠️ 번역 파일이 아직 없는 언어도 있다 — 그때는 빈 표로 못 박아 두고 다시 시도하지 않는다(매 렌더 재요청 방지).
    .catch(() => { packs.set(lang, EMPTY) })
    .finally(() => { pending.delete(lang); notify() })
  pending.set(lang, p)
}

/**
 * 지금 화면 언어의 표. **동기 조회 전용** — 아직 안 왔으면 빈 표(=한국어 그대로)를 준다.
 * 화면에서는 아래 `useDailyI18n()` 을 써서 도착 시 다시 그려지게 한다.
 */
export function dailyPack(): DailyI18nPack {
  return packs.get(current) ?? EMPTY
}

/** 그림 속 라벨 한 줄. 번역이 없으면 한국어 원문 그대로. */
export function tLab(ko: string): string {
  return dailyPack().labels[ko] ?? ko
}

/**
 * 해설 한 벌을 화면 언어로. 그림 키(`visual`)는 언어와 무관하므로 원본 것을 유지한다.
 * ⚠️ 번역이 부분만 있으면 **있는 칸만** 갈아 끼운다(요약만 번역된 언어에서 보충·비교가 사라지면 안 된다).
 */
export function tTheory(ko: string, base: TermTheory): TermTheory {
  const tr = dailyPack().theory[ko]
  if (!tr) return base
  return {
    visual: base.visual,
    point: tr.point || base.point,
    why: tr.why?.length ? tr.why : base.why,
    compare: tr.compare || base.compare,
  }
}

/**
 * 화면 언어를 이 모듈에 알리고, 표가 도착하면 다시 그리게 한다.
 * 해설 카드와 그림을 그리는 컴포넌트가 한 번씩 부르면 된다.
 */
export function useDailyI18n(lang: string): void {
  const [, bump] = useState(0)
  useEffect(() => {
    current = lang
    ensure(lang)
    const f = () => bump((n) => n + 1)
    subs.add(f)
    // 이미 받아둔 언어로 바꾼 경우에도 한 번 다시 그린다(current 가 바뀌었으므로).
    f()
    return () => { subs.delete(f) }
  }, [lang])
}
