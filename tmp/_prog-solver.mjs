// 프로그램해라 레벨 난이도 잣대 — 명령 칸 안에 들어가는 프로그램을 전부 돌려 정답 수를 센다(적을수록 어렵다).
//   문법: 최상위 = 단순 | 반복(2·4·6·8, 몸통 = 단순|조건) | 조건(막힘?|별?, 몸통 = 단순). 레벨이 허용한 명령만.
import { runProgram, countOps } from '../supabase/functions/_shared/program-levels.ts'
const SIMPLE = ['MV', 'TL', 'TR', 'PK']
/** 크기 ≤ budget 인 모든 프로그램을 생성 — depth: 'top'|'lp'|'if' */
export function* gen(ops, budget, depth = 'top') {
  yield []
  if (budget <= 0) return
  const simple = SIMPLE.filter((o) => ops.includes(o))
  // 첫 원소를 하나 고르고 나머지를 재귀
  for (const op of simple) for (const rest of gen(ops, budget - 1, depth)) yield [{ op }, ...rest]
  if (depth !== 'if' && ops.includes('IF')) for (const cond of ['blocked', 'star']) for (const body of gen(ops, budget - 1, 'if')) { if (!body.length) continue
    for (const rest of gen(ops, budget - 1 - countOps(body), depth)) yield [{ op: 'IF', cond, body }, ...rest] }
  if (depth === 'top' && ops.includes('LP')) for (const count of [2, 4, 6, 8]) for (const body of gen(ops, budget - 1, 'lp')) { if (!body.length) continue
    for (const rest of gen(ops, budget - 1 - countOps(body), depth)) yield [{ op: 'LP', count, body }, ...rest] }
}
/** 레벨 하나: 최소 정답 길이와 (limit 이하) 정답 수 */
export function analyze(L, limit = L.limit, maxMs = Infinity) {
  let minLen = Infinity, count = 0, tried = 0, first = null, partial = false
  const t0 = Date.now()
  for (const p of gen(L.ops, limit)) { if (!p.length) continue; tried++
    if ((tried & 4095) === 0 && Date.now() - t0 > maxMs) { partial = true; break }
    const n = countOps(p)
    if (runProgram(L, p).win) { count++; if (n < minLen) { minLen = n; first = p } } }
  return { minLen, count, tried, first, partial }
}
export const fmt = (p) => p.map((i) => i.op === 'LP' ? `반복×${i.count}[${fmt(i.body)}]` : i.op === 'IF' ? `조건(${i.cond === 'blocked' ? '막힘' : '별'})[${fmt(i.body)}]` : { MV: '앞', TL: '왼', TR: '오', PK: '집' }[i.op]).join(' ')
