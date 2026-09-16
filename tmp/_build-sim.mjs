// 지어라(build-cari) 시뮬레이터 + 솔버 — 설계 검증용(게임·서버와 같은 규칙).
// 규칙: 6×8 칸. 생산기(하나 이상)가 두 틱마다 상자를 하나씩 자기 방향으로 내보낸다. 매 틱 모든 상자가 한 칸 이동.
//   컨베이어 = 그 방향으로. 센서 = 자기 색이면 왼쪽(진행 기준 = (dir+3)%4)으로, 아니면 dir 로 직진(진입 방향 무관).
//   빈 칸·벽·판 밖 = 놓침, 함 = 색이 맞으면(또는 아무 색 함) 출고, 틀리면 오류. 상자를 다 내보내고 살아 있는 상자가 없으면 끝.
//   승리 = 출고 수 == 총 상자 수.
export const COLS = 6, ROWS = 8, SPAWN_EVERY = 2, TICK_GUARD = 200
export const DIRS = [[-1, 0], [0, 1], [1, 0], [0, -1]]
export const branchOf = (d) => (d + 3) % 4

/** 판 만들기 — 레벨 고정물(생산기·함·벽·고정 타일·미리 깔린 타일) 위에 플레이어 타일을 얹는다. */
export function makeGrid(L, tiles) {
  const g = []
  for (let r = 0; r < ROWS; r++) { g.push([]); for (let c = 0; c < COLS; c++) g[r].push({ type: 'empty' }) }
  for (const s of L.sources) g[s.r][s.c] = { type: 'source', dir: s.dir }
  for (const b of L.bins) g[b.r][b.c] = { type: 'bin', want: b.want }
  for (const [r, c] of L.walls || []) g[r][c] = { type: 'wall' }
  for (const [r, c, t, d, col] of L.fixed || []) g[r][c] = { type: t, dir: d, color: col, fixed: true }
  for (const [r, c, t, d, col] of L.pre || []) g[r][c] = { type: t, dir: d, color: col }
  for (const [r, c, t, d, col] of tiles || []) g[r][c] = { type: t, dir: d, color: col }
  return g
}
export const need = (L) => L.sources.reduce((n, s) => n + s.pattern.length, 0)

function exitDir(g, it) {
  const t = g[it.r][it.c]
  if (t.type === 'conv' || t.type === 'source') return t.dir
  if (t.type === 'sensor') return it.feat === t.color ? branchOf(t.dir) : t.dir
  return null
}

/** 시뮬레이션. onEmpty(it, r, c) 를 주면 상자가 빈 칸에 들어가려 할 때 호출한다(솔버용) — true 를 돌려주면 계속. */
export function simulate(L, tiles, onEmpty) {
  const g = makeGrid(L, tiles)
  const N = need(L)
  const items = []
  let tick = 0, spawned = 0, good = 0, bad = 0, miss = 0, stuckAt = null, lost = 0 // lost = 빈 칸이 아닌 이유(판 밖·벽·고리)로 죽은 상자
  const spawnIdx = L.sources.map(() => 0)
  const total = N
  const kill = (it, fate) => { it.dead = true; if (fate === 'good') good++; else if (fate === 'bad') bad++; else miss++ }
  while (tick < TICK_GUARD) {
    tick++
    for (const it of items) {
      if (it.dead) continue
      const dir = exitDir(g, it)
      if (dir === null) { kill(it, 'miss'); lost++; continue }
      const nr = it.r + DIRS[dir][0], nc = it.c + DIRS[dir][1]
      it.r = nr; it.c = nc; it.steps++
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) { kill(it, 'miss'); lost++; continue }
      const t = g[nr][nc]
      if (t.type === 'bin') { kill(it, t.want == null || t.want === it.feat ? 'good' : 'bad'); continue }
      if (t.type === 'wall') { kill(it, 'miss'); lost++; continue }
      if (t.type === 'empty') { if (onEmpty && stuckAt === null) stuckAt = { r: nr, c: nc, feat: it.feat }; kill(it, 'miss'); continue }
      if (it.steps > ROWS * COLS + 4) { kill(it, 'miss'); lost++; continue }
    }
    if (spawned < total && tick % SPAWN_EVERY === 1) {
      L.sources.forEach((s, si) => {
        if (spawnIdx[si] < s.pattern.length) { items.push({ r: s.r, c: s.c, feat: s.pattern[spawnIdx[si]], dead: false, steps: 0 }); spawnIdx[si]++; spawned++ }
      })
    }
    if (stuckAt) break
    if (spawned >= total && !items.some((it) => !it.dead)) break
  }
  return { good, bad, miss, lost, need: N, win: good === N, stuckAt, tick }
}

/** 플레이어 타일 검사(서버와 같은 규칙): 고정물 위에 못 놓고, 센서 색은 레벨이 허용한 것만. */
export function validTiles(L, tiles) {
  if (!Array.isArray(tiles) || tiles.length > ROWS * COLS) return false
  const base = makeGrid(L, [])
  const seen = new Set()
  for (const t of tiles) {
    if (!Array.isArray(t)) return false
    const [r, c, type, d, col] = t
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= ROWS || c < 0 || c >= COLS) return false
    const k = r * COLS + c
    if (seen.has(k)) return false
    seen.add(k)
    const b = base[r][c]
    if (b.type === 'source' || b.type === 'bin' || b.type === 'wall' || b.fixed) return false
    if (type === 'conv') { if (![0, 1, 2, 3].includes(d)) return false }
    else if (type === 'sensor') { if (![0, 1, 2, 3].includes(d) || !(L.sensors || []).includes(col)) return false }
    else return false
  }
  return true
}

/** 솔버 — 상자가 처음 빈 칸에 닿는 자리에 타일을 하나씩 놓아 보는 깊이우선(반복 심화). 최소 타일 수 풀이를 찾는다.
 *  timeMs 안에 못 끝내면 { cap: true } — 그때까지의 하한만 안다. */
export function solve(L, maxDepth, timeMs = 4000) {
  const t0 = Date.now()
  const sensors = L.sensors || []
  const opts = []
  for (let d = 0; d < 4; d++) opts.push(['conv', d, undefined])
  for (const col of sensors) for (let d = 0; d < 4; d++) opts.push(['sensor', d, col])
  let capped = false
  const failMemo = new Set()
  function dfs(tiles, depth) {
    if (Date.now() - t0 > timeMs) { capped = true; return null }
    const res = simulate(L, tiles, true)
    if (res.win) return tiles
    if (res.bad > 0 || res.lost > 0) return null
    if (!res.stuckAt) return null // 빈 칸 없이 실패(판 밖·벽·고리) — 앞선 타일이 틀렸다
    if (depth === 0) return null
    const key = tiles.map((t) => t.join('')).sort().join('|') + '#' + depth
    if (failMemo.has(key)) return null
    const { r, c } = res.stuckAt
    for (const [type, d, col] of opts) {
      const t = [r, c, type, d, col]
      const out = dfs([...tiles, t], depth - 1)
      if (out) return out
      if (capped) return null
    }
    failMemo.add(key)
    return null
  }
  for (let depth = 1; depth <= maxDepth; depth++) {
    const out = dfs([], depth)
    if (out) return { tiles: out, depth, cap: false }
    if (capped) return { tiles: null, depth, cap: true }
  }
  return { tiles: null, depth: maxDepth, cap: false }
}

/** 판을 글자로 — 시트 전에 빠르게 눈으로 볼 때 */
export function ascii(L, tiles) {
  const g = makeGrid(L, tiles)
  const AR = ['^', '>', 'v', '<']
  const rows = []
  for (let r = 0; r < ROWS; r++) {
    let s = ''
    for (let c = 0; c < COLS; c++) {
      const t = g[r][c]
      if (t.type === 'empty') s += ' . '
      else if (t.type === 'wall') s += '###'
      else if (t.type === 'source') s += 'S' + AR[t.dir] + ' '
      else if (t.type === 'bin') s += '[' + (t.want || '*') + ']'
      else if (t.type === 'conv') s += (t.fixed ? '=' : ' ') + AR[t.dir] + ' '
      else if (t.type === 'sensor') s += (t.fixed ? '=' : ' ') + t.color.toLowerCase() + AR[t.dir]
    }
    rows.push(s)
  }
  return rows.join('\n')
}
