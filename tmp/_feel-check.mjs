import { LEVELS } from './_feel-levels.mjs'
const SOLID = '#GBMC'
const SEES = { ultra:{'#':1,G:1,B:1,M:1,C:0}, lidar:{'#':1,G:0,B:0,M:1,C:1}, cam:{'#':1,G:0,B:1,M:1,C:1}, ir:{'#':1,G:0,B:0,M:1,C:0}, radar:{'#':1,G:0,B:1,M:1,C:1} }
const ENVFAIL = { ultra:[], lidar:['smoke'], cam:['dark','smoke'], ir:['bright'], radar:[] }
const ENVL = { d:'dark', b:'bright', k:'smoke', s:'slip' }
let bad = 0
LEVELS.forEach((L, i) => {
  const g = L.grid, n = i + 1
  if (g.length !== 17) { console.log(`Z${n} rows ${g.length}`); bad++ }
  g.forEach((r, y) => { if (r.length !== 13) { console.log(`Z${n} row ${y} len ${r.length}: ${r}`); bad++ } })
  g.forEach((r, y) => { if (y === 0 || y === 16) { if (!/^#+$/.test(r)) { console.log(`Z${n} border row ${y}`); bad++ } } else if (r[0] !== '#' || r[12] !== '#') { console.log(`Z${n} border col row ${y}: ${r}`); bad++ } })
  const all = g.join(''); const S = (all.match(/S/g) || []).length, E = (all.match(/E/g) || []).length
  if (S !== 1 || E !== 1) { console.log(`Z${n} S=${S} E=${E}`); bad++ }
  const bads = [...new Set(all.replace(/[#GBMCSE.dbks\n]/g, ''))]; if (bads.length) { console.log(`Z${n} unknown chars ${bads}`); bad++ }
  // BFS
  let sx, sy, ex, ey; g.forEach((r, y) => { for (let x = 0; x < 13; x++) { if (r[x] === 'S') { sx = x; sy = y } if (r[x] === 'E') { ex = x; ey = y } } })
  const seen = new Set([sy * 13 + sx]); const q = [[sx, sy]]; let found = false
  while (q.length) { const [x, y] = q.shift(); if (x === ex && y === ey) { found = true; break }
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= 13 || ny >= 17) continue; const c = g[ny][nx]; if (SOLID.includes(c) || seen.has(ny * 13 + nx)) continue; seen.add(ny * 13 + nx); q.push([nx, ny]) } }
  if (!found) { console.log(`Z${n} no path`); bad++ }
  // 재질·환경 → 어떤 센서가 살아있나
  const mats = [...new Set(all.replace(/[^GBMC]/g, ''))]; const envs = new Set(L.envs); for (const ch of all) if (ENVL[ch]) envs.add(ENVL[ch])
  const ok = Object.keys(SEES).filter((k) => !ENVFAIL[k].some((e) => envs.has(e)) && mats.every((m) => SEES[k][m]))
  const perMat = Object.fromEntries(mats.map((m) => [m, Object.keys(SEES).filter((k) => SEES[k][m] && !ENVFAIL[k].some((e) => envs.has(e)))]))
  console.log(`Z${n} ${L.name.padEnd(8)} mats=${mats.join('') || '-'} envs=${[...envs].join(',') || '-'} all-in-one=[${ok.join(',')}] perMat=${JSON.stringify(perMat)}`)
})
console.log(bad ? `${bad} problems` : 'all ok')
