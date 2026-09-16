// 지어라 설계 검증 — sol 이 통과하는가 · 솔버 최소 타일 수(시간 상한) · 판 ascii
import { LEVELS } from './_build-levels.mjs'
import { simulate, validTiles, solve, ascii, need } from './_build-sim.mjs'
const only = process.argv[2] ? Number(process.argv[2]) : null
const doSolve = !process.argv.includes('--nosolve')
let bad = 0
LEVELS.forEach((L, i) => {
  if (only && only !== i + 1) return
  const r = simulate(L, L.sol)
  const ok = r.win && validTiles(L, L.sol)
  if (!ok) bad++
  let sv = ''
  if (doSolve) {
    const s = solve(L, L.sol.length, Number(process.env.CAP || 6000))
    sv = s.tiles ? `min=${s.depth}${s.depth < L.sol.length ? ' ⚠️ sol 보다 짧음' : ''}` : s.cap ? `solver cap(≥${s.depth})` : 'no shorter'
    if (s.tiles && s.depth < L.sol.length) sv += '\n' + ascii(L, s.tiles)
  }
  console.log(`L${i + 1} ${L.name} — sol ${L.sol.length}타일 ${ok ? 'OK' : 'FAIL ' + JSON.stringify(r)} · need ${need(L)} · ${sv}`)
  if (!ok || only) console.log(ascii(L, L.sol))
})
console.log(bad ? `FAIL ${bad}` : 'all sol OK')
