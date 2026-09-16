// 지어라 — 설계(_build-levels.mjs)를 게임 HTML · 서버 TS · 테스트 SOL 에 한 번에 반영한다.
//   node tmp/_build-apply.mjs            → public/games/build-cari.html (CSS 머리 + tail) · _shared/build-levels.ts 의 레벨 리터럴 · tests SOL 파일
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { LEVELS } from './_build-levels.mjs'

const HTML = 'public/games/build-cari.html'
const cur = readFileSync(HTML, 'utf8').replace(/\r\n/g, '\n')   // 옛 파일이 CRLF 였다 — LF 로 통일(다른 게임 파일과 같게)
const headEnd = cur.indexOf('\n</style>\n</head>\n<body>')
if (headEnd < 0) throw new Error('head boundary not found')
// 머리 = 기존 CSS(재설계 블록이 이미 붙어 있으면 그 앞까지)
let head = cur.slice(0, headEnd)
const mark = head.indexOf('\n/* ===== 2026-09-15 재설계')
if (mark >= 0) head = head.slice(0, mark)
const tail = readFileSync('tmp/_build-tail.html', 'utf8')

const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
const geoKeys = ['sources', 'bins', 'walls', 'fixed', 'pre', 'sensors', 'runs']
function geo(L) {
  const o = {}
  for (const k of geoKeys) if (L[k] !== undefined && !(Array.isArray(L[k]) && L[k].length === 0 && (k === 'walls' || k === 'fixed' || k === 'pre'))) o[k] = L[k]
  return o
}
const lit = (L, i) => {
  const g = geo(L)
  const txt = [`name:${q(L.name)}`, `goal:${q(L.goal)}`]
  if (L.take) txt.push(`take:${q(L.take)}`)
  const body = Object.entries(g).map(([k, v]) => `${k}:${JSON.stringify(v)}`).join(', ')
  return `  /* ${i + 1} */ {${txt.join(', ')},\n    ${body}}`
}
const levelsLiteral = '[\n' + LEVELS.map(lit).join(',\n') + '\n]'
const out = head + tail.replace('/*__LEVELS__*/[]', levelsLiteral)
writeFileSync(HTML, out)
console.log('html', out.length, 'bytes ·', LEVELS.length, 'levels')

// 서버 사본(기하만)
const TS = 'supabase/functions/_shared/build-levels.ts'
if (existsSync(TS)) {
  const ts = readFileSync(TS, 'utf8')
  const a = ts.indexOf('export const BUILD_LEVELS: BuildLevel[] = [')
  const b = ts.indexOf('\n]\n', a)
  if (a < 0 || b < 0) throw new Error('BUILD_LEVELS block not found')
  const rows = LEVELS.map((L, i) => `  /* ${i + 1} ${L.name} */ ${JSON.stringify(geo(L))},`).join('\n')
  writeFileSync(TS, ts.slice(0, a) + 'export const BUILD_LEVELS: BuildLevel[] = [\n' + rows + ts.slice(b))
  console.log('ts updated')
}
// 테스트용 SOL
writeFileSync('tests/fixtures/build-sol.json', JSON.stringify(LEVELS.map((L) => L.sol)))
console.log('sol fixture written')
