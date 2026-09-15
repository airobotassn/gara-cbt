// 시켜라(order-cari) 주문 20개 — 서버 재채점용. 2026-09-15.
//
// ⛔ 게임 `public/games/order-cari.html` 의 LEVELS 와 **sync pair** 다 — 문구(name·who·say·t)는 안 담고 **도면(goal)과
//    카드의 효과(set·bad)** 만 담는다. tests/minigame-replay.mjs 가 두 파일을 대조한다. 원본은 tmp/_order-levels.mjs 이고
//    tmp/_order-apply.mjs 가 양쪽을 같이 쓴다 — 한쪽만 손으로 고치지 말 것.
//
// 규칙(게임의 buildSpec() 그대로): 기본 스펙 위에 고른 정상 카드를 먼저, 함정(bad)을 그 위에 덮어쓴다. 팔이 0이면 손도 없다.
// 8칸(KEYS)이 전부 도면과 같으면 통과. 주문마다 MAX_TRIES 번 시킬 수 있고 다 쓰면 판 끝. 별 = 4 − 시도 횟수.

export interface OrderCard { set: Record<string, string | number>; bad?: 1 }
export interface OrderLevel { goal: Record<string, string | number>; cards: OrderCard[] }

export const ORDER_MAX_TRIES = 3
export const ORDER_KEYS = ["base","arms","hand","head","light","battery","size","color"] as const
export const ORDER_BASE: Record<string, string | number> = {"base":"none","arms":0,"hand":"none","head":"plain","light":"none","battery":"normal","size":"normal","color":"#93a0b8"}

export const ORDER_LEVELS: OrderLevel[] = [
  { goal: {"base":"wheel","arms":0,"hand":"none","head":"plain","light":"none","battery":"normal","size":"normal","color":"#93a0b8"},
    cards: [{ set: {"base":"wheel"} }, { set: {"base":"leg","arms":4,"hand":"grip","head":"many","light":"lamp","battery":"big","size":"huge","color":"#ff4fa3"}, bad: 1 }, { set: {"size":"huge"}, bad: 1 }, { set: {"arms":4,"hand":"grip"}, bad: 1 }] },
  { goal: {"base":"wheel","arms":1,"hand":"grip","head":"plain","light":"none","battery":"normal","size":"normal","color":"#93a0b8"},
    cards: [{ set: {"base":"wheel"} }, { set: {"arms":1,"hand":"grip"} }, { set: {"arms":4,"hand":"grip"}, bad: 1 }, { set: {"base":"leg","arms":4,"hand":"grip","head":"many","light":"lamp","battery":"big","size":"huge","color":"#ff4fa3"}, bad: 1 }, { set: {"size":"huge"}, bad: 1 }] },
  { goal: {"base":"wheel","arms":2,"hand":"grip","head":"cam","light":"none","battery":"normal","size":"normal","color":"#93a0b8"},
    cards: [{ set: {"base":"wheel"} }, { set: {"arms":2,"hand":"grip"} }, { set: {"head":"cam"} }, { set: {"head":"many"}, bad: 1 }, { set: {"size":"huge"}, bad: 1 }, { set: {"base":"leg","arms":4,"hand":"grip","head":"many","light":"lamp","battery":"big","size":"huge","color":"#ff4fa3"}, bad: 1 }] },
  { goal: {"base":"leg","arms":1,"hand":"grip","head":"cam","light":"none","battery":"normal","size":"normal","color":"#f5c518"},
    cards: [{ set: {"base":"leg"} }, { set: {"arms":1,"hand":"grip"} }, { set: {"head":"cam"} }, { set: {"color":"#f5c518"} }, { set: {"base":"wheel"}, bad: 1 }, { set: {"color":"#ff4fa3"}, bad: 1 }, { set: {"size":"huge"}, bad: 1 }] },
  { goal: {"base":"track","arms":2,"hand":"grip","head":"cam","light":"none","battery":"normal","size":"normal","color":"#4a86ff"},
    cards: [{ set: {"base":"track"} }, { set: {"arms":2,"hand":"grip"} }, { set: {"head":"cam"} }, { set: {"color":"#4a86ff"} }, { set: {"base":"wheel"}, bad: 1 }, { set: {"head":"many"}, bad: 1 }, { set: {"size":"huge"}, bad: 1 }] },
  { goal: {"base":"wheel","arms":0,"hand":"none","head":"cam","light":"lamp","battery":"normal","size":"normal","color":"#93a0b8"},
    cards: [{ set: {"base":"wheel"} }, { set: {"head":"cam"} }, { set: {"light":"lamp"} }, { set: {"arms":1,"hand":"grip"}, bad: 1 }, { set: {"battery":"big"}, bad: 1 }, { set: {"base":"leg","arms":4,"hand":"grip","head":"many","light":"lamp","battery":"big","size":"huge","color":"#ff4fa3"}, bad: 1 }] },
  { goal: {"base":"wheel","arms":2,"hand":"suction","head":"cam","light":"none","battery":"normal","size":"normal","color":"#93a0b8"},
    cards: [{ set: {"base":"wheel"} }, { set: {"arms":2,"hand":"grip"}, bad: 1 }, { set: {"arms":2,"hand":"suction"} }, { set: {"head":"cam"} }, { set: {"size":"huge"}, bad: 1 }, { set: {} }] },
  { goal: {"base":"track","arms":1,"hand":"grip","head":"cam","light":"lamp","battery":"big","size":"normal","color":"#93a0b8"},
    cards: [{ set: {"base":"track"} }, { set: {"base":"wheel"}, bad: 1 }, { set: {"arms":1,"hand":"grip"} }, { set: {"head":"cam"} }, { set: {"light":"lamp"} }, { set: {"battery":"big"} }, { set: {"size":"small"}, bad: 1 }, { set: {"base":"leg","arms":4,"hand":"grip","head":"many","light":"lamp","battery":"big","size":"huge","color":"#ff4fa3"}, bad: 1 }] },
  { goal: {"base":"leg","arms":1,"hand":"grip","head":"plain","light":"none","battery":"normal","size":"normal","color":"#e2483d"},
    cards: [{ set: {"base":"leg"} }, { set: {"arms":1,"hand":"grip"} }, { set: {"color":"#e2483d"} }, { set: {"color":"#f5c518"}, bad: 1 }, { set: {"head":"cam"}, bad: 1 }, { set: {"base":"leg","arms":4,"hand":"grip","head":"many","light":"lamp","battery":"big","size":"huge","color":"#ff4fa3"}, bad: 1 }, { set: {} }] },
  { goal: {"base":"wheel","arms":0,"hand":"none","head":"cam","light":"none","battery":"normal","size":"small","color":"#93a0b8"},
    cards: [{ set: {"base":"wheel"} }, { set: {"head":"cam"} }, { set: {"size":"small"} }, { set: {"size":"huge"}, bad: 1 }, { set: {"arms":1,"hand":"grip"}, bad: 1 }, { set: {"battery":"big"}, bad: 1 }, { set: {"base":"leg","arms":4,"hand":"grip","head":"many","light":"lamp","battery":"big","size":"huge","color":"#ff4fa3"}, bad: 1 }] },
  { goal: {"base":"leg","arms":2,"hand":"grip","head":"cam","light":"none","battery":"normal","size":"normal","color":"#4a86ff"},
    cards: [{ set: {"base":"track","arms":2,"hand":"grip","head":"cam","color":"#4a86ff"}, bad: 1 }, { set: {"base":"leg"} }, { set: {"arms":2,"hand":"grip"} }, { set: {"head":"cam"} }, { set: {"color":"#4a86ff"} }, { set: {"size":"huge"}, bad: 1 }, { set: {"head":"many"}, bad: 1 }] },
  { goal: {"base":"wheel","arms":1,"hand":"grip","head":"cam","light":"lamp","battery":"normal","size":"normal","color":"#f5c518"},
    cards: [{ set: {"base":"wheel"} }, { set: {"arms":1,"hand":"grip"} }, { set: {"arms":2,"hand":"grip"}, bad: 1 }, { set: {"head":"cam"} }, { set: {"light":"lamp"} }, { set: {"color":"#f5c518"} }, { set: {"color":"#4a86ff"}, bad: 1 }, { set: {"base":"leg"}, bad: 1 }, { set: {"base":"leg","arms":4,"hand":"grip","head":"many","light":"lamp","battery":"big","size":"huge","color":"#ff4fa3"}, bad: 1 }] },
  { goal: {"base":"wheel","arms":0,"hand":"none","head":"plain","light":"none","battery":"normal","size":"normal","color":"#93a0b8"},
    cards: [{ set: {"base":"wheel"} }, { set: {"head":"cam"}, bad: 1 }, { set: {"arms":1,"hand":"grip"}, bad: 1 }, { set: {"light":"lamp"}, bad: 1 }, { set: {"battery":"big"}, bad: 1 }, { set: {"size":"small"}, bad: 1 }, { set: {} }, { set: {"base":"leg","arms":4,"hand":"grip","head":"many","light":"lamp","battery":"big","size":"huge","color":"#ff4fa3"}, bad: 1 }] },
  { goal: {"base":"track","arms":0,"hand":"none","head":"many","light":"lamp","battery":"normal","size":"normal","color":"#4a86ff"},
    cards: [{ set: {"base":"track"} }, { set: {"head":"many"} }, { set: {"head":"cam"}, bad: 1 }, { set: {"light":"lamp"} }, { set: {"light":"lamp","arms":1,"hand":"grip"}, bad: 1 }, { set: {"color":"#4a86ff"} }, { set: {"arms":1,"hand":"grip"}, bad: 1 }, { set: {"size":"huge"}, bad: 1 }] },
  { goal: {"base":"wheel","arms":1,"hand":"grip","head":"cam","light":"none","battery":"normal","size":"normal","color":"#2bb673"},
    cards: [{ set: {"base":"wheel"} }, { set: {"arms":1,"hand":"grip"} }, { set: {"head":"cam"} }, { set: {"color":"#2bb673"} }, { set: {"arms":2,"hand":"grip"}, bad: 1 }, { set: {"color":"#f5c518"}, bad: 1 }, { set: {"base":"leg"}, bad: 1 }, { set: {"size":"huge"}, bad: 1 }, { set: {"battery":"big"}, bad: 1 }, { set: {"base":"leg","arms":4,"hand":"grip","head":"many","light":"lamp","battery":"big","size":"huge","color":"#ff4fa3"}, bad: 1 }] },
  { goal: {"base":"track","arms":1,"hand":"suction","head":"cam","light":"lamp","battery":"normal","size":"small","color":"#4a86ff"},
    cards: [{ set: {"base":"track"} }, { set: {"arms":1,"hand":"grip"}, bad: 1 }, { set: {"arms":1,"hand":"suction"} }, { set: {"arms":2,"hand":"suction"}, bad: 1 }, { set: {"head":"cam"} }, { set: {"light":"lamp"} }, { set: {"size":"small"} }, { set: {"color":"#4a86ff"} }, { set: {"color":"#2bb673"}, bad: 1 }, { set: {"battery":"big"}, bad: 1 }] },
  { goal: {"base":"track","arms":2,"hand":"grip","head":"cam","light":"none","battery":"normal","size":"normal","color":"#f5c518"},
    cards: [{ set: {"base":"leg","arms":2,"hand":"grip","head":"cam","color":"#f5c518"}, bad: 1 }, { set: {"base":"track"} }, { set: {"base":"leg"}, bad: 1 }, { set: {"arms":2,"hand":"grip"} }, { set: {"arms":2,"hand":"grip","light":"lamp"}, bad: 1 }, { set: {"head":"cam"} }, { set: {"color":"#f5c518"} }, { set: {"size":"huge"}, bad: 1 }, { set: {"head":"many"}, bad: 1 }] },
  { goal: {"base":"wheel","arms":2,"hand":"grip","head":"cam","light":"lamp","battery":"big","size":"normal","color":"#93a0b8"},
    cards: [{ set: {"base":"wheel"} }, { set: {"arms":2,"hand":"grip"} }, { set: {"arms":2,"hand":"suction"}, bad: 1 }, { set: {"head":"cam"} }, { set: {"head":"many"}, bad: 1 }, { set: {"light":"lamp"} }, { set: {"battery":"big"} }, { set: {"color":"#4a86ff"}, bad: 1 }, { set: {"size":"huge"}, bad: 1 }, { set: {"arms":4,"hand":"grip"}, bad: 1 }] },
  { goal: {"base":"leg","arms":1,"hand":"grip","head":"cam","light":"none","battery":"normal","size":"small","color":"#e2483d"},
    cards: [{ set: {"base":"leg"} }, { set: {"arms":1,"hand":"grip"} }, { set: {"arms":2,"hand":"suction"}, bad: 1 }, { set: {"head":"cam"} }, { set: {"color":"#e2483d"} }, { set: {"size":"small"} }, { set: {"size":"huge"}, bad: 1 }, { set: {"base":"wheel"}, bad: 1 }, { set: {"color":"#ff4fa3"}, bad: 1 }, { set: {"head":"many"}, bad: 1 }] },
  { goal: {"base":"track","arms":2,"hand":"suction","head":"many","light":"lamp","battery":"big","size":"normal","color":"#4a86ff"},
    cards: [{ set: {"base":"track"} }, { set: {"arms":2,"hand":"suction"} }, { set: {"arms":4,"hand":"suction"}, bad: 1 }, { set: {"head":"many"} }, { set: {"head":"cam"}, bad: 1 }, { set: {"light":"lamp"} }, { set: {"battery":"big"} }, { set: {"color":"#4a86ff"} }, { set: {"base":"track","arms":0,"hand":"none","head":"many","light":"lamp","color":"#4a86ff"}, bad: 1 }, { set: {"size":"huge"}, bad: 1 }] },
]

/** 카드 자리 목록 → 스펙. 게임의 buildSpec() 과 같은 갈래. */
export function buildOrderSpec(L: OrderLevel, pick: number[]): Record<string, string | number> {
  const spec = { ...ORDER_BASE }
  const ch = [...pick].sort((a, b) => a - b).map((i) => L.cards[i])
  ch.filter((c) => !c.bad).forEach((c) => Object.assign(spec, c.set))
  ch.filter((c) => c.bad).forEach((c) => Object.assign(spec, c.set))
  if (spec.arms === 0) spec.hand = 'none'
  return spec
}
export function orderMatches(L: OrderLevel, pick: number[]): boolean {
  const s = buildOrderSpec(L, pick)
  return ORDER_KEYS.every((k) => s[k] === L.goal[k])
}
