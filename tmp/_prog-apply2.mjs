// _prog-design2 의 30레벨을 게임 HTML · 서버 · 테스트 SOL 에 쓴다.
import { readFileSync, writeFileSync } from 'node:fs'
import { LEVELS, toLevel } from './_prog-design2.mjs'
import { runProgram, validProgram } from '../supabase/functions/_shared/program-levels.ts'
if (LEVELS.length !== 30) throw new Error('30 아님')
for (const [i, D] of LEVELS.entries()) { const L = toLevel(D); if (!validProgram(L, D.sol) || !runProgram(L, D.sol).win) throw new Error(`L${i + 1} sol`) }
const esc = (s) => s.replace(/'/g, "\\'")
// HTML
let h = readFileSync('public/games/program-cari.html', 'utf8')
const m = h.match(/const LEVELS=\[\n[\s\S]*?\n\];/)
const entries = LEVELS.map((D) => { const L = toLevel(D); return ` {name:'${esc(D.name)}', goal:'${esc(D.goal)}'${D.teach ? `, teach:'${esc(D.teach)}'` : ''}, cols:${L.cols}, rows:${L.rows}, limit:${L.limit}, runs:${L.runs}, ops:${JSON.stringify(L.ops)},\n  start:${JSON.stringify(L.start)}, goalPos:${JSON.stringify(L.goal)}, stars:${JSON.stringify(L.stars)},\n  tiles:${JSON.stringify(L.tiles)}}` })
h = h.replace(m[0], 'const LEVELS=[\n' + entries.join(',\n') + '\n];')
writeFileSync('public/games/program-cari.html', h)
// 서버
let t = readFileSync('supabase/functions/_shared/program-levels.ts', 'utf8')
const i0 = t.indexOf('export const PROG_LEVELS: ProgLevel[] = [\n') + 'export const PROG_LEVELS: ProgLevel[] = [\n'.length, i1 = t.indexOf('\n]\n', i0)
const ts = LEVELS.map((D, i) => { const L = toLevel(D); return `  /* ${i + 1} ${D.name} */ { cols: ${L.cols}, rows: ${L.rows}, limit: ${L.limit}, runs: ${L.runs}, ops: ${JSON.stringify(L.ops)}, start: ${JSON.stringify(L.start)}, goal: ${JSON.stringify(L.goal)}, stars: ${JSON.stringify(L.stars)}, tiles: ${JSON.stringify(L.tiles)} },` })
t = t.slice(0, i0) + '  // 30레벨(2026-09-14 재설계) — 레벨 하나 = 발상 하나. 기하는 아래 리터럴이 전부다(헬퍼 없음). 설계·검증 스크립트 = tmp/_prog-design2.mjs(naive 명령 집합으로는 못 풀고, 의도한 정답은 통과하는지).\n' + ts.join('\n') + t.slice(i1)
writeFileSync('supabase/functions/_shared/program-levels.ts', t)
// 테스트 SOL
const f = (p) => p.map((i) => i.op === 'LP' ? `LP(${i.count}, ${f(i.body)})` : i.op === 'IF' ? `${i.cond === 'blocked' ? 'IFB' : 'IFS'}(${f(i.body)})` : i.op).join(', ')
let x = readFileSync('tests/minigame-replay.mjs', 'utf8')
const a = x.indexOf('  const SOL = [\n') + '  const SOL = [\n'.length, b = x.indexOf('  ]\n  eq(SOL.length')
x = x.slice(0, a) + LEVELS.map((D, i) => `    [${f(D.sol)}], // ${i + 1} ${D.name}`).join('\n') + '\n' + x.slice(b)
writeFileSync('tests/minigame-replay.mjs', x)
writeFileSync('tmp/_prog-new30.json', JSON.stringify(LEVELS.map((D, i) => ({ n: i + 1, name: D.name, goal: D.goal, teach: D.teach ?? null, sol: D.sol, limit: D.limit, runs: D.runs })), null, 1))
console.log('applied')
