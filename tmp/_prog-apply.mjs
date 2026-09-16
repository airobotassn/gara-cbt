// 17~30 을 어려운 후보로 교체 — 명령 칸 = 최소 정답 길이, 정답 수 내림차순(쉬운 것부터)으로 배치.
import { readFileSync, writeFileSync } from 'node:fs'
import { CAND } from './_prog-design.mjs'
import { analyze, fmt } from './_prog-solver.mjs'
import { runProgram, validProgram } from '../supabase/functions/_shared/program-levels.ts'
const ORDER = [
  ['A1', 3, '양방향 미로', '오른쪽도 왼쪽도 꺾인다', '조건 하나로는 안 돼요. "막히면 오른쪽, 그래도 막히면 왼쪽으로 두 번" 처럼 조건을 겹쳐요'],
  ['B7', 3, '별 열 칸', '별을 다 줍고 열 칸 끝까지', '반복 8번으로 모자라면 앞으로를 반복 밖에 둬요'],
  ['A2', 3, 'T자 갈림길', '오른쪽 가지는 막다른 길', '갈림길에서 어느 조건을 먼저 볼지가 갈라요'],
  ['B10', 3, 'T자 둘', '두 갈림길, 정답 방향이 다르다', null],
  ['B9', 3, '거꾸로 시작', '뒤를 보고 있다 — 돌아서고 미로로', null],
  ['A13', 3, '지그재그 뱀길', '좌우로 번갈아 꺾인다', null],
  ['B8', 3, '계단과 별', '층계참마다 별', '계단 한 칸 = 반복 한 번, 별은 어디서 집나'],
  ['B1', 3, '불규칙 양방향', '꺾이는 간격이 제각각', '반복으로 묶이는 규칙이 없어요 — 조건으로만'],
  ['B3', 3, 'T자와 막다른 길', '막다른 가지에 들어가면 끝', null],
  ['A5', 3, '거꾸로 + 오른손', '돌아서서 오른손 미로', null],
  ['B4', 3, '열두 칸 양방향', '반복 8번 × 조건 둘로는 8칸', null],
  ['A4', 2, '왼쪽이 없다', '왼쪽으로 꺾어야 하는데 왼쪽 명령이 없다', '오른쪽 세 번이 왼쪽이에요'],
  ['B5', 2, '왼쪽 없이 양방향', '오른쪽 명령만으로 양쪽 꺾기', null],
  ['B6', 2, '오른쪽 없이 양방향', '왼쪽 명령만으로 양쪽 꺾기', null],
]
const out = []
for (const [key, runs, name, goal, teach] of ORDER) {
  const C = CAND[key]; const L = { cols: C.cols, rows: C.rows, limit: C.lim, runs, ops: C.ops, start: C.start, goal: C.goal, stars: C.stars, tiles: C.tiles }
  const r = analyze(L, C.lim); if (!isFinite(r.minLen)) throw new Error(key + ' unsolvable')
  const rm = r.minLen < C.lim ? analyze(L, r.minLen) : r
  L.limit = r.minLen
  if (!validProgram(L, rm.first) || !runProgram(L, rm.first).win) throw new Error(key + ' first invalid')
  out.push({ key, L, name, goal, teach, sol: rm.first, solutions: rm.count })
  console.log(`${key} → limit ${L.limit} solutions ${rm.count} sol=${fmt(rm.first)}`)
}
// HTML LEVELS 17~30 교체
let h = readFileSync('public/games/program-cari.html', 'utf8')
const m = h.match(/const LEVELS=\[\n([\s\S]*?)\n\];/)
const entries = m[1].split('\n {').map((e, i) => (i ? ' {' + e : e))
if (entries.length !== 30) throw new Error('entries ' + entries.length)
const esc = (s) => s.replace(/'/g, "\\'")
const newEntries = out.map(({ L, name, goal, teach }) => ` {name:'${esc(name)}', goal:'${esc(goal)}'${teach ? `, teach:'${esc(teach)}'` : ''}, cols:${L.cols}, rows:${L.rows}, limit:${L.limit}, runs:${L.runs}, ops:${JSON.stringify(L.ops)},\n  start:${JSON.stringify(L.start)}, goalPos:${JSON.stringify(L.goal)}, stars:${JSON.stringify(L.stars)},\n  tiles:${JSON.stringify(L.tiles)}}`)
const all = [...entries.slice(0, 16), ...newEntries]
h = h.replace(m[0], 'const LEVELS=[\n' + all.join(',\n') + '\n];')
writeFileSync('public/games/program-cari.html', h)
// 서버 17~30 교체
let t = readFileSync('supabase/functions/_shared/program-levels.ts', 'utf8')
const i0 = t.indexOf('  // ── 17~23 조건 ──'), i1 = t.indexOf('\n]\n', i0)
const ts = out.map(({ L }) => `  { cols: ${L.cols}, rows: ${L.rows}, limit: ${L.limit}, runs: ${L.runs}, ops: ${JSON.stringify(L.ops)}, start: ${JSON.stringify(L.start)}, goal: ${JSON.stringify(L.goal)}, stars: ${JSON.stringify(L.stars)}, tiles: ${JSON.stringify(L.tiles)} },`)
t = t.slice(0, i0) + '  // ── 17~30 어려운 구간(2026-09-14 재설계) — 명령 칸 = 최소 정답 길이. 정답 수(적을수록 어렵다) 내림차순 배치. 기하는 아래 리터럴이 전부다(헬퍼 없음).\n' + ts.join('\n') + t.slice(i1)
writeFileSync('supabase/functions/_shared/program-levels.ts', t)
writeFileSync('tmp/_prog-new17.json', JSON.stringify(out.map((o) => ({ key: o.key, name: o.name, goal: o.goal, teach: o.teach, sol: o.sol, solText: fmt(o.sol), solutions: o.solutions, limit: o.L.limit, runs: o.L.runs })), null, 1))
console.log('applied')
