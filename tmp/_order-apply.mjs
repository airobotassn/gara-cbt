// 시켜라 — tmp/_order-levels.mjs(원본) → 게임 HTML LEVELS 리터럴 + 서버 _shared/order-levels.ts. 정답 검증까지.
import { readFileSync, writeFileSync } from 'node:fs'
import { LEVELS } from './_order-levels.mjs'

const KEYS = ['base', 'arms', 'hand', 'head', 'light', 'battery', 'size', 'color']
const BASE = { base: 'none', arms: 0, hand: 'none', head: 'plain', light: 'none', battery: 'normal', size: 'normal', color: '#93a0b8' }
function build(cards, pick) {
  const spec = { ...BASE }
  const ch = [...pick].sort((a, b) => a - b).map((i) => cards[i])
  ch.filter((c) => !c.bad).forEach((c) => Object.assign(spec, c.set))
  ch.filter((c) => c.bad).forEach((c) => Object.assign(spec, c.set))
  if (spec.arms === 0) spec.hand = 'none'
  return spec
}
const same = (a, b) => KEYS.every((k) => a[k] === b[k])

// ── 검증: 정상 카드 전부 = 정답 · 함정 하나만 더해도 실패 · 정상 카드 하나를 빼면 실패(효과 없는 카드는 예외) ──
let bad = 0
export const SOL = LEVELS.map((L, li) => {
  const normals = L.cards.map((c, i) => (c.bad ? -1 : i)).filter((i) => i >= 0)
  const needed = normals.filter((i) => Object.keys(L.cards[i].set).length > 0)
  if (!same(build(L.cards, normals), L.goal)) { console.error(`L${li + 1} 정상 카드 전부가 정답이 아님`, build(L.cards, normals), L.goal); bad++ }
  L.cards.forEach((c, i) => { if (c.bad && same(build(L.cards, [...needed, i]), L.goal)) { console.error(`L${li + 1} 함정 ${i + 1} 이 결과를 안 바꿈`); bad++ } })
  needed.forEach((i) => { if (same(build(L.cards, needed.filter((j) => j !== i)), L.goal)) { console.error(`L${li + 1} 정상 카드 ${i + 1} 이 없어도 정답`); bad++ } })
  L.cards.forEach((c, i) => { if (c.t.length > 26) { console.error(`L${li + 1} 카드 ${i + 1} 문구 ${c.t.length}자 (26 초과)`); bad++ } })
  if (!L.cards.some((c) => !c.bad)) { console.error(`L${li + 1} 정상 카드 없음`); bad++ }
  return needed
})
if (bad) { console.error(bad, 'problems'); process.exit(1) }

// ── HTML LEVELS 리터럴 ──
const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
const setLit = (o) => '{' + Object.entries(o).map(([k, v]) => `${k}:${typeof v === 'number' ? v : q(v)}`).join(',') + '}'
const lvLit = LEVELS.map((L) => {
  const cards = L.cards.map((c) => `    {p:${q(c.p)}, t:${q(c.t)},${c.bad ? ' bad:1,' : ''} set:${setLit(c.set)}},`).join('\n')
  return `{ name:${q(L.name)}, who:${q(L.who)},${L.paint ? ` paint:${q(L.paint)},` : ''}${L.nochip ? ' nochip:1,' : ''}\n  say:${q(L.say)},\n  goal:${setLit(L.goal)},\n  cards:[\n${cards}\n  ] },`
}).join('\n')
const levelsBlock = `/* ===================== 주문 20개 =====================
   ⛔ 원본은 tmp/_order-levels.mjs — 여기 리터럴과 서버 _shared/order-levels.ts 를 tmp/_order-apply.mjs 가 같이 쓴다.
      손으로 한쪽만 고치지 말 것(tests/minigame-replay.mjs 가 대조한다).
   카드: 정상(set) · 함정(bad:1 — 정상 카드 위를 덮어쓴다) · set:{} 는 아무 효과 없음(골라도 손해 없음).
   4장 × 5주문: 1장 함정이 티가 남 → 2장 새 부품(손·조명·배터리·크기) + 말에만 있는 조건 → 3장 그럴듯한 함정
   ("지난번처럼"·색 충돌·여태 함정이던 게 정답) → 4장 전부 섞임(카드 10장).
==================================================== */
const LEVELS=[
${lvLit}
];`

let html = readFileSync('public/games/order-cari.html', 'utf8')
const tail = readFileSync('tmp/_order-tail.js', 'utf8').replace('/*LEVELS*/', levelsBlock)
const a = html.indexOf('<script>\n/* ================= CARI mascot'), a2 = html.indexOf('<script>\n/* 문구는 전부 사전')
const start = a >= 0 ? a : a2
const end = html.indexOf('</script>', start)
if (start < 0 || end < 0) { console.error('스크립트 블록을 못 찾음'); process.exit(1) }
html = html.slice(0, start) + '<script src="i18n.js"></script>\n<script>\n' + tail + '</script>' + html.slice(end + '</script>'.length)
// i18n.js 태그가 두 번 들어가지 않게
html = html.replace(/(<script src="i18n.js"><\/script>\n)+/g, '<script src="i18n.js"></script>\n')
writeFileSync('public/games/order-cari.html', html)

// ── 서버 리터럴 ──
const ts = `// 시켜라(order-cari) 주문 20개 — 서버 재채점용. 2026-09-15.
//
// ⛔ 게임 \`public/games/order-cari.html\` 의 LEVELS 와 **sync pair** 다 — 문구(name·who·say·t)는 안 담고 **도면(goal)과
//    카드의 효과(set·bad)** 만 담는다. tests/minigame-replay.mjs 가 두 파일을 대조한다. 원본은 tmp/_order-levels.mjs 이고
//    tmp/_order-apply.mjs 가 양쪽을 같이 쓴다 — 한쪽만 손으로 고치지 말 것.
//
// 규칙(게임의 buildSpec() 그대로): 기본 스펙 위에 고른 정상 카드를 먼저, 함정(bad)을 그 위에 덮어쓴다. 팔이 0이면 손도 없다.
// 8칸(KEYS)이 전부 도면과 같으면 통과. 주문마다 MAX_TRIES 번 시킬 수 있고 다 쓰면 판 끝. 별 = 4 − 시도 횟수.

export interface OrderCard { set: Record<string, string | number>; bad?: 1 }
export interface OrderLevel { goal: Record<string, string | number>; cards: OrderCard[] }

export const ORDER_MAX_TRIES = 3
export const ORDER_KEYS = ${JSON.stringify(KEYS)} as const
export const ORDER_BASE: Record<string, string | number> = ${JSON.stringify(BASE)}

export const ORDER_LEVELS: OrderLevel[] = [
${LEVELS.map((L) => `  { goal: ${JSON.stringify(L.goal)},\n    cards: [${L.cards.map((c) => `{ set: ${JSON.stringify(c.set)}${c.bad ? ', bad: 1' : ''} }`).join(', ')}] },`).join('\n')}
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
`
writeFileSync('supabase/functions/_shared/order-levels.ts', ts)
writeFileSync('tests/fixtures/order-sol.json', JSON.stringify(SOL))
console.log('levels', LEVELS.length, 'cards', LEVELS.reduce((n, L) => n + L.cards.length, 0), 'written')
