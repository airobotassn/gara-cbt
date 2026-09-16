import { PROG_LEVELS } from '../supabase/functions/_shared/program-levels.ts'
import { analyze, fmt } from './_prog-solver.mjs'
const t0 = Date.now()
for (const i of [8, 16, 18, 21, 23, 25, 29]) { const L = PROG_LEVELS[i]; const r = analyze(L); console.log(`L${i + 1} limit=${L.limit} min=${r.minLen} solutions=${r.count} tried=${r.tried} first=${r.first ? fmt(r.first) : '-'} (${((Date.now() - t0) / 1000).toFixed(1)}s)`) }
