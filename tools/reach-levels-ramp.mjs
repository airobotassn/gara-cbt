// 닿아라(reach-cari) 레벨 난이도 사다리 정리 도구 — `node tools/reach-levels-ramp.mjs` (프로젝트 루트에서).
//   게임 HTML 의 LEVELS 를 읽어 (1) 구간 목표보다 쉬운 레벨은 장애물을 키워 조이고 (2) 정답 자세를 다시 찾고
//   (3) 구간 안에서 어려운 순으로 번호를 다시 매긴 뒤, 게임 HTML 과 서버 사본(_shared/reach-levels.ts)에 같이 쓴다.
//   ⚠️ 돌릴 때마다 정답 자세가 조금씩 바뀐다(무작위). 레벨을 새로 넣었을 때 한 번 돌리는 용도지 습관적으로 돌리지 말 것.
//   ⚠️ 통로형 레벨은 아래 PATHS 에 중심선이 있어야 정답을 찾는다 — 새 통로형 레벨을 넣으면 여기도 한 줄 추가.
//   검증은 tests/minigame-replay.mjs(30개 solve 가 닿고 start 가 안 닿는지) + 실제 플레이 스모크로.
// 난이도 사다리 정리 — 25~30 을 기준으로 아래 구간을 맞춘다.
//   잣대 = 정답 자세에서 관절을 ±12° 흔들었을 때 그래도 닿는 비율(tol). 낮을수록 어렵다.
//   구간 목표: 1~5 그대로(정렬만) · 6~15 [15%,45%] · 16~22 [8%,16%] · 23~24 그대로 · 25~30 그대로.
//   조이는 방법 = 장애물 사각형을 사방으로 δ 만큼 키운다(통로가 2δ 좁아진다). δ 를 올려가며 목표 구간에 들어오면 멈춘다.
//   정답 자세는 통로형이면 깊이우선 탐색(3° 후보), 아니면 현재 정답 근방 흔들기 + 무작위로 다시 찾는다.
//   끝으로 구간 안에서 tol 내림차순으로 정렬해 번호를 다시 매긴다(같은 구간 안에서 뒤로 갈수록 어렵게).
import { fkPoints, reachedWith, gripPoint } from '../supabase/functions/_shared/reach-levels.ts'
// 판정점은 손끝이 아니라 집게 중심(gripPoint) — 게임·서버와 같다.
const tipOf = (pts) => gripPoint(pts)
// `--resolve`: 조이기·정렬 없이 30개 정답 자세만 다시 찾는다(판정 규칙이 바뀌었을 때).
const RESOLVE = process.argv.includes('--resolve')
import { readFileSync, writeFileSync } from 'node:fs'
const rand = (a, b) => a + Math.random() * (b - a), R2D = 180 / Math.PI
function segAABB(x1,y1,x2,y2,xmin,ymin,xmax,ymax){ const inside=(x,y)=>x>=xmin&&x<=xmax&&y>=ymin&&y<=ymax; if(inside(x1,y1)||inside(x2,y2))return true
  const ss=(a,b,c,d,p,q,r,s)=>{const d1=(r-p)*(b-q)-(s-q)*(a-p),d2=(r-p)*(d-q)-(s-q)*(c-p),d3=(c-a)*(q-b)-(d-b)*(p-a),d4=(c-a)*(s-b)-(d-b)*(r-a);return((d1>0&&d2<0)||(d1<0&&d2>0))&&((d3>0&&d4<0)||(d3<0&&d4>0))}
  return ss(x1,y1,x2,y2,xmin,ymin,xmax,ymin)||ss(x1,y1,x2,y2,xmax,ymin,xmax,ymax)||ss(x1,y1,x2,y2,xmax,ymax,xmin,ymax)||ss(x1,y1,x2,y2,xmin,ymax,xmin,ymin)}
function hitStrict(L, pts, pad=7){ for(const r of L.obstacles){ const x0=r.x-r.w/2-pad,y0=r.y-r.h/2-pad,x1=r.x+r.w/2+pad,y1=r.y+r.h/2+pad
    for(let i=0;i<pts.length-1;i++) if(segAABB(pts[i].x,pts[i].y,pts[i+1].x,pts[i+1].y,x0,y0,x1,y1)) return true }
  for(let i=1;i<pts.length;i++) if(pts[i].x<5||pts[i].x>395||pts[i].y<5||pts[i].y>515) return true; return false }
const html = readFileSync('public/games/reach-cari.html', 'utf8')
const HL = new Function('return ' + html.match(/const LEVELS=(\[[\s\S]*?\n\]);/)[1])()
const geo = (L) => ({ base: L.base, segs: L.segs, limits: L.limits, target: { x: L.target.x, y: L.target.y, r: L.target.r }, obstacles: L.obstacles, time: 60 })
const mPath = (p) => p.map(([x, y]) => [400 - x, y])
// 통로형 중심선(sub 로 찾는다)
const PATHS = {
  '관절 5개 · ㄷ자 고리': [[200, 460], [200, 330], [300, 330], [300, 410]],
  '관절 5개 · ㄷ자 고리(반대)': mPath([[200, 460], [200, 330], [300, 330], [300, 410]]),
  '관절 5개 · S자 통로': [[210, 460], [210, 435], [130, 435], [130, 350], [250, 350], [250, 265]],
  '관절 5개 · L자 통로': [[200, 460], [200, 300], [320, 300]],
  '관절 5개 · 상자의 문': [[200, 460], [330, 430], [330, 360], [255, 360]],
  '관절 5개 · 상자의 문(반대)': mPath([[200, 460], [330, 430], [330, 360], [255, 360]]),
  '관절 5개 · 꺾인 굴뚝': [[200, 460], [200, 365], [110, 365], [110, 270]],
}
function tol(L, solve, N = 40000) { let ok = 0; for (let k = 0; k < N; k++) { const a = solve.map((v, j) => Math.max(L.limits[j][0], Math.min(L.limits[j][1], v + rand(-12, 12)))); if (reachedWith(L, a)) ok++ } return ok / N }
function distToPoly(path, p) { let bd = 1e9, bs = 0, acc = 0
  for (let i = 0; i < path.length - 1; i++) { const [ax, ay] = path[i], [bx, by] = path[i + 1], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy)
    const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / (len * len))), qx = ax + dx * t, qy = ay + dy * t, d = Math.hypot(p.x - qx, p.y - qy)
    if (d < bd) { bd = d; bs = acc + len * t } acc += len } return { d: bd, s: bs } }
function polyAt(path, s) { let acc = 0; for (let i = 0; i < path.length - 1; i++) { const [ax, ay] = path[i], [bx, by] = path[i + 1], len = Math.hypot(bx - ax, by - ay)
    if (acc + len >= s) { const t = (s - acc) / len; return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t } } acc += len } const [ex, ey] = path.at(-1); return { x: ex, y: ey } }
function follow(L, path) { const a = []; let p = { x: L.base.x, y: L.base.y }, s = 0, acc = 0
  for (const len of L.segs) { s += len; const q = polyAt(path, s); const abs = Math.atan2(q.y - p.y, q.x - p.x) * R2D
    let rel = abs - acc; while (rel > 180) rel -= 360; while (rel < -180) rel += 360; a.push(rel); acc += rel
    p = { x: p.x + len * Math.cos(acc / R2D), y: p.y + len * Math.sin(acc / R2D) } } return a }
function dfsSolve(L, path, TOL = 26) { const n = L.segs.length, a = new Array(n); let found = null, nodes = 0; const seed = follow(L, path)
  function rec(i, pts, acc, s) { if (found || nodes++ > 6e6) return
    if (i === n) { const tip = tipOf(pts); if (Math.hypot(tip.x - L.target.x, tip.y - L.target.y) < L.target.r + 5) found = a.slice(); return }
    const [lo, hi] = L.limits[i], p = pts[i]; const cands = []; for (let v = lo; v <= hi; v += 3) cands.push(v); cands.sort((u, v) => Math.abs(u - seed[i]) - Math.abs(v - seed[i]))
    for (const rel of cands) { const abs = acc + rel, q = { x: p.x + L.segs[i] * Math.cos(abs / R2D), y: p.y + L.segs[i] * Math.sin(abs / R2D) }
      if (q.x < 5 || q.x > 395 || q.y < 5 || q.y > 515 || hitStrict(L, [p, q])) continue
      const { d, s: s2 } = distToPoly(path, q); if (d > TOL || s2 < s + L.segs[i] * 0.4) continue
      a[i] = rel; rec(i + 1, [...pts, q], abs, s2); if (found) return } }
  rec(0, [{ x: L.base.x, y: L.base.y }], 0, 0); return found && refine(L, found) }
/** 찾은 자세를 목표 중심 쪽으로 다듬는다(±6° 흔들어 충돌 없이 집게가 가장 가까운 것) — 힌트가 가장자리를 가리키지 않게 */
function refine(L, a0) { let best = a0, bd = Math.hypot(tipOf(fkPoints(L, a0)).x - L.target.x, tipOf(fkPoints(L, a0)).y - L.target.y)
  for (let k = 0; k < 80000; k++) { const a = a0.map((v, j) => Math.round(Math.max(L.limits[j][0], Math.min(L.limits[j][1], v + rand(-6, 6)))))
    const pts = fkPoints(L, a); if (hitStrict(L, pts)) continue; const t = tipOf(pts), d = Math.hypot(t.x - L.target.x, t.y - L.target.y); if (d < bd) { bd = d; best = a } }
  return best }
/** 통로형이 아닌 것: 현재 정답 근방 + 무작위로 다시 찾는다(빡빡한 판정, 목표 중심 가까이) */
function reSolve(L, prev) { let best = null, bd = 1e9
  for (let k = 0; k < 250000; k++) { const a = k < 150000 ? prev.map((v, j) => Math.round(Math.max(L.limits[j][0], Math.min(L.limits[j][1], v + rand(-30, 30))))) : L.limits.map(([lo, hi]) => Math.round(rand(lo, hi)))
    const pts = fkPoints(L, a); if (hitStrict(L, pts)) continue; const tip = tipOf(pts), d = Math.hypot(tip.x - L.target.x, tip.y - L.target.y); if (d < bd) { bd = d; best = a } }
  return bd < L.target.r + 6 ? best : null }
function findStart(L, solve) { let start = null, su = 1e9
  for (let k = 0; k < 120000; k++) { const a = L.limits.map(([lo, hi]) => Math.round(rand(lo, hi))); const pts = fkPoints(L, a); if (hitStrict(L, pts)) continue
    const tip = tipOf(pts); if (Math.hypot(tip.x - L.target.x, tip.y - L.target.y) < 140) continue
    const up = Math.abs(a[0] + 90) + a.slice(1).reduce((s, v) => s + Math.abs(v), 0); if (up < su) { su = up; start = a } }
  for (const far of [90, 60, 45]) if (!start) for (let k = 0; k < 200000 && !start; k++) {
    const a = solve.map((v, j) => Math.round(Math.max(L.limits[j][0], Math.min(L.limits[j][1], v + rand(-80, 80))))); const pts = fkPoints(L, a); if (hitStrict(L, pts)) continue
    if (Math.hypot(tipOf(pts).x - L.target.x, tipOf(pts).y - L.target.y) > far) start = a }
  return start }
const grow = (obs, d) => obs.map((o) => ({ ...o, w: o.w + 2 * d, h: o.h + 2 * d }))
const tierOf = (i) => (i < 5 ? 1 : i < 15 ? 2 : i < 22 ? 3 : i < 24 ? 4 : 5)
const RANGE = { 2: [0.15, 0.45], 3: [0.08, 0.16] }
const out = []
for (let i = 0; i < HL.length; i++) {
  const L0 = HL[i], t = tierOf(i), base = geo(L0)
  let cur = { L: base, solve: L0.solve, start: L0.start, tol: tol(base, L0.solve), delta: 0 }
  const range = RANGE[t]
  if (RESOLVE) {
    const path = PATHS[L0.sub]
    const solve = path ? (dfsSolve(base, path) || dfsSolve(base, path, 34)) : reSolve(base, L0.solve)
    if (!solve) { console.log(`L${i + 1} ${L0.sub}: 정답 못 찾음 — 옛 정답 유지, 목표만 집게 자리로`)
      const g = tipOf(fkPoints(base, L0.solve)); if (Math.hypot(g.x - base.target.x, g.y - base.target.y) > 8) base.target = { ...base.target, x: Math.round(g.x), y: Math.round(g.y) }
      cur = { L: base, solve: L0.solve, start: L0.start, tol: tol(base, L0.solve), delta: 0 } }
    else {
      // 힌트 자세의 집게가 목표 중심에서 8px 넘게 벗어나면 목표를 집게 자리로 옮긴다(별은 힌트가 가리키는 그 자리에 있어야 한다)
      const g = tipOf(fkPoints(base, solve)); if (Math.hypot(g.x - base.target.x, g.y - base.target.y) > 8) base.target = { ...base.target, x: Math.round(g.x), y: Math.round(g.y) }
      const start = findStart(base, solve) || L0.start; cur = { L: base, solve, start, tol: tol(base, solve), delta: 0 } }
  } else if (range && cur.tol > range[1]) {
    const path = PATHS[L0.sub]
    for (const d of [3, 6, 9, 12, 15, 18, 22]) {
      const L = { ...base, obstacles: grow(base.obstacles, d) }
      const solve = path ? (dfsSolve(L, path) || dfsSolve(L, path, 34)) : reSolve(L, cur.solve)
      if (!solve) break
      const start = findStart(L, solve); if (!start) break
      // 통로형은 목표를 정답 손끝에 맞춘다
      if (path) { const tip = tipOf(fkPoints(L, solve)); L.target = { ...L.target, x: Math.round(tip.x), y: Math.round(tip.y) } }
      const tv = tol(L, solve)
      cur = { L, solve, start, tol: tv, delta: d }
      if (tv <= range[1]) break
    }
  }
  console.log(`L${i + 1} tier${t} ${L0.sub} tol ${(tol(base, L0.solve) * 100).toFixed(1)}% → ${(cur.tol * 100).toFixed(1)}% (δ=${cur.delta})`)
  out.push({ ...L0, base: cur.L.base, obstacles: cur.L.obstacles, target: { ...L0.target, x: cur.L.target.x, y: cur.L.target.y }, solve: cur.solve, start: cur.start, tol: cur.tol, tier: t, delta: cur.delta })
}
// 정렬: 구간별 tol 내림차순(25~30 은 설계 순서 유지)
const sorted = []
if (RESOLVE) sorted.push(...out)
else { for (const t of [1, 2, 3, 4]) sorted.push(...out.filter((o) => o.tier === t).sort((a, b) => b.tol - a.tol)); sorted.push(...out.filter((o) => o.tier === 5)) }
// 거울 참조 번호 갱신
const REF = { '관절 4개 · 지그재그(반대)': '관절 4개 · 두 단 지그재그', '관절 5개 · ㄷ자 고리(반대)': '관절 5개 · ㄷ자 고리', '관절 6개 · 뱀길(반대)': '관절 6개 · 뱀길',
  '관절 4개 · 벽 + 흔들림(반대)': '관절 4개 · 벽 + 흔들림', '관절 7개 · 굴뚝 위 갈고리(반대) + 흔들림': '관절 7개 · 굴뚝 위 갈고리' }
const numOf = (sub) => sorted.findIndex((o) => o.sub === sub) + 1
const htmlOut = sorted.map((L, i) => { const n = i + 1, take = REF[L.sub] ? L.take.replace(/\d+번/, numOf(REF[L.sub]) + '번') : L.take
  const obs = L.obstacles.map((o) => `{x:${o.x},y:${o.y},w:${o.w},h:${o.h}}`).join(', ')
  return `  { name:"레벨 ${n}", sub:"${L.sub}", goal:"${L.goal}",
    base:{x:${L.base.x},y:${L.base.y}}, segs:${JSON.stringify(L.segs)}, limits:${JSON.stringify(L.limits)},
    start:${JSON.stringify(L.start)}, solve:${JSON.stringify(L.solve)}, target:{x:${L.target.x},y:${L.target.y},r:${L.target.r},kind:"${L.target.kind}"}, obstacles:[${obs}]${L.noise ? `, noise:${L.noise}` : ''},
    take:"${take}" },` })
let h = html; const i0 = h.indexOf('  { name:"레벨 1"'), i1 = h.indexOf('\n];', i0)
h = h.slice(0, i0) + htmlOut.join('\n') + h.slice(i1); writeFileSync('public/games/reach-cari.html', h)
const tsOut = sorted.map((L) => { const obs = L.obstacles.map((o) => `{ x: ${o.x}, y: ${o.y}, w: ${o.w}, h: ${o.h} }`).join(', ')
  return `  { base: { x: ${L.base.x}, y: ${L.base.y} }, segs: ${JSON.stringify(L.segs)}, limits: ${JSON.stringify(L.limits)},
    target: { x: ${L.target.x}, y: ${L.target.y}, r: ${L.target.r} }, obstacles: [${obs}], time: REACH_DEFAULT_TIME },` })
let ts = readFileSync('supabase/functions/_shared/reach-levels.ts', 'utf8')
const a0 = ts.indexOf('export const REACH_LEVELS: ReachLevel[] = [\n') + 'export const REACH_LEVELS: ReachLevel[] = [\n'.length, a1 = ts.indexOf('\n]\n', a0)
ts = ts.slice(0, a0) + tsOut.join('\n') + ts.slice(a1); writeFileSync('supabase/functions/_shared/reach-levels.ts', ts)
console.log('\n최종 순서:'); sorted.forEach((L, i) => console.log(`  ${i + 1}. ${L.sub} ${(L.tol * 100).toFixed(1)}%${L.delta ? ` (δ${L.delta})` : ''}`))
