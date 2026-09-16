// 더듬어라 — tmp/_feel-levels.mjs(원본) → 게임 HTML LEVELS 리터럴 + 서버 _shared/feel-levels.ts. 격자 검증(모양·경로) 포함.
import { readFileSync, writeFileSync } from 'node:fs'
import { LEVELS } from './_feel-levels.mjs'
const SOLID = '#GBMC'
let bad = 0
LEVELS.forEach((L, i) => {
  const g = L.grid, n = i + 1
  if (g.length !== 17 || g.some((r) => r.length !== 13)) { console.error(`Z${n} 격자 크기`); bad++ }
  const all = g.join(''); if ((all.match(/S/g) || []).length !== 1 || (all.match(/E/g) || []).length !== 1) { console.error(`Z${n} S/E`); bad++ }
  let sx, sy, ex, ey; g.forEach((r, y) => { for (let x = 0; x < 13; x++) { if (r[x] === 'S') { sx = x; sy = y } if (r[x] === 'E') { ex = x; ey = y } } })
  const seen = new Set([sy * 13 + sx]); const q = [[sx, sy]]; let found = false
  while (q.length) { const [x, y] = q.shift(); if (x === ex && y === ey) { found = true; break }
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= 13 || ny >= 17) continue; if (SOLID.includes(g[ny][nx]) || seen.has(ny * 13 + nx)) continue; seen.add(ny * 13 + nx); q.push([nx, ny]) } }
  if (!found) { console.error(`Z${n} 길 없음`); bad++ }
})
if (bad) process.exit(1)

const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
const lit = LEVELS.map((L) => `{ name:${q(L.name)}, envs:${JSON.stringify(L.envs)},${L.hint ? ' hint:1,' : ''} grid:[\n${L.grid.map((r) => '  ' + q(r) + ',').join('\n')}\n] },`).join('\n')
const block = `/* ===================== 구역 20개 =====================
   ⛔ 원본은 tmp/_feel-levels.mjs — 여기 리터럴과 서버 _shared/feel-levels.ts 를 tmp/_feel-apply.mjs 가 같이 쓴다(tests/minigame-replay.mjs 가 대조).
   벽: # 콘크리트 · G 유리 · B 검은 고무 · M 금속 · C 천. 바닥: . 보통 · d 깜깜함 · b 햇빛 · k 연기 · s 미끄러움(그 칸에서만).
   hint:1 = 브리핑에 "먹통 센서" 칩(1~10구역). 11구역부터는 재질·환경 칩만 주고 어떤 센서가 먹통인지는 센서 표에서 직접 찾는다.
   ⚠️ 문구(설명·교훈)는 없다 — 이름뿐(2026-09-15 규칙).
==================================================== */
const LEVELS=[
${lit}
];`
let html = readFileSync('public/games/feel-cari.html', 'utf8')
if (html.includes('/*LEVELS*/')) html = html.replace('/*LEVELS*/', block)
else html = html.replace(/\/\* ===================== 구역 20개 =====================[\s\S]*?\nconst LEVELS=\[[\s\S]*?\n\];/, block)
writeFileSync('public/games/feel-cari.html', html)

const ts = `// 더듬어라(feel-cari) 구역 20개 — 서버 재채점(순서·횟수 검사)용. 2026-09-16.
//
// ⛔ 게임 \`public/games/feel-cari.html\` 의 LEVELS 와 **sync pair** 다(격자·환경 그대로). tests/minigame-replay.mjs 가 대조한다.
//    원본은 tmp/_feel-levels.mjs 이고 tmp/_feel-apply.mjs 가 양쪽을 같이 쓴다.
// 서버는 조이스틱 궤적을 되돌리지 않는다(프레임 단위 물리라 무리). 기록 = 시도마다 {z, ok, h(부딪힘), b(남은 배터리), t} 이고
// 구역 순서·구역당 MAX_TRIES·부딪힘 0~3·배터리 0~100·시각 단조증가만 검사해 깬 구역 수를 센다.

export interface FeelLevel { name: string; envs: string[]; hint?: 1; grid: string[] }
export const FEEL_MAX_TRIES = 3
export const FEEL_MAX_HIT = 3
export const FEEL_LEVELS: FeelLevel[] = ${JSON.stringify(LEVELS.map((L) => ({ name: L.name, envs: L.envs, ...(L.hint ? { hint: 1 } : {}), grid: L.grid })), null, 1).replace(/\n\s*"([^"]+)"(?=,|\n)/g, (m) => m)}
`
writeFileSync('supabase/functions/_shared/feel-levels.ts', ts)
console.log('zones', LEVELS.length, 'written')
