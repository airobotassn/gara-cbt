import { PROG_LEVELS, runProgram, countOps, validProgram } from '../supabase/functions/_shared/program-levels.ts'
const MV = { op: 'MV' }, TL = { op: 'TL' }, TR = { op: 'TR' }, PK = { op: 'PK' }
const LP = (count, ...body) => ({ op: 'LP', count, body })
const IFB = (...body) => ({ op: 'IF', cond: 'blocked', body }), IFS = (...body) => ({ op: 'IF', cond: 'star', body })
// 의도한 정답 (레벨 순)
export const SOL = [
  [MV, MV, MV, MV],
  [MV, MV, TL, MV, MV, MV, MV],
  [TL, TL, MV, MV, MV, MV],
  [MV, MV, PK, MV, PK, MV],
  [MV, PK, MV, MV, PK],
  [LP(6, MV)],
  [LP(4, MV, TL, MV, TR)],
  [LP(4, MV), TL, LP(4, MV)],
  [LP(8, IFB(TR), MV)],
  [LP(4, MV, MV, TR, MV, TL)],
  [LP(6, MV, PK)],
  [LP(8, IFB(TR), MV)],
  [LP(4, MV, MV, MV, MV, TR)],
  [LP(8, IFB(TR, MV, TL), MV)],
  [LP(8, IFB(TR), IFB(TL, TL), MV)],
  [LP(8, IFB(TR), MV, IFB(TR), MV)],
  [LP(8, IFB(TR), MV, IFB(TR), MV)],
  [LP(8, IFB(TL), MV)],
  [LP(8, IFS(PK, TL), IFB(TR), MV)],
  [LP(8, IFB(TR), IFB(TR), PK, MV)],
  [LP(8, PK, IFB(TL, TL), MV)],
  [LP(8, IFB(TR), PK, MV, IFB(TR), PK, MV)],
  [LP(4, IFB(TL), IFB(TR, TR), MV), LP(8, IFB(TR), IFB(TL, TL), MV)],
  [LP(8, IFS(PK, TL), IFB(TL), IFB(TL), MV)],
  [LP(8, IFS(PK, TR), IFB(TR), MV)],
  [LP(8, IFS(PK, TR), IFB(TL), MV)],
  [LP(8, IFB(TR), IFB(TL, TL), PK, MV)],
  [LP(8, IFS(PK, TL, MV, TR), IFB(TR, MV, TL), MV)],
  [TL, TL, LP(8, IFB(TR), MV)],
  [LP(8, IFS(PK, TR), IFB(TR), MV, IFS(PK, TR), IFB(TR), MV)],
]
let bad = 0
PROG_LEVELS.forEach((L, i) => {
  const sol = SOL[i]; const n = countOps(sol); const v = validProgram(L, sol); const r = v ? runProgram(L, sol) : { win: false, steps: 0 }
  const flag = v && r.win ? 'OK' : 'FAIL'; if (flag === 'FAIL') bad++
  console.log(`L${i + 1} ${flag} ops=${n}/${L.limit} valid=${v} win=${r.win} steps=${r.steps} tiles=${L.tiles.length}`)
})
console.log(bad ? `${bad} FAIL` : 'all levels solvable')
