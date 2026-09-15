// 지어라(build-cari) 레벨 + 시뮬레이터 — 서버 재채점용.
//
// ⛔ 레벨 기하는 게임 `public/games/build-cari.html` 의 LEVELS 와 **sync pair** 다(문구(name·goal·teach·take)는 안 담는다).
//    tests/minigame-replay.mjs 가 두 파일을 대조하고, 각 레벨의 정답 배치(tests/fixtures/build-sol.json)가 이 시뮬레이터로 성공하는지도 본다.
//    레벨을 넣거나 고치면 양쪽 다 — 안 그러면 그 레벨을 깬 기록이 400 으로 튕겨 랭킹에 안 남는다.
//    설계·검증 스크립트 = tmp/_build-levels.mjs(원본) · _build-apply.mjs(여기 리터럴을 다시 쓴다) · _build-verify.mjs(솔버).
//
// 서버는 게임이 보낸 "레벨별 타일 배치" 를 **같은 규칙으로 돌려** 정말 다 출고됐는지 본다. 규칙은 게임의 tick() 그대로:
//   6×8 칸. 생산기마다 두 틱에 하나씩 자기 방향으로 상자를 내보낸다(각자 pattern 을 한 번). 매 틱 모든 상자가 한 칸 이동.
//   컨베이어 = 그 방향으로. 센서 = 자기 색이면 진행 기준 왼쪽((dir+3)%4)으로, 아니면 dir 로 직진 — **진입 방향과 무관**.
//   빈 칸·벽·판 밖·고리(52스텝) = 놓침, 함 = 색이 맞으면(또는 아무 색 함) 출고, 틀리면 오류. 200틱이 지나면 끝.
//   승리 = 출고 수 == 상자 총수.

export type Color = 'R' | 'B' | 'G'
export type Dir = 0 | 1 | 2 | 3 // 0=위 1=오른쪽 2=아래 3=왼쪽
/** [r, c, 'conv'|'sensor', dir, color?] — 게임이 기록에 싣는 타일 모양 그대로 */
export type Tile = [number, number, 'conv' | 'sensor', number, Color?]

export interface BuildLevel {
  sources: { r: number; c: number; dir: number; pattern: Color[] }[]
  bins: { r: number; c: number; want: Color | null }[]
  walls?: [number, number][]
  /** 못 지우는 타일 */
  fixed?: Tile[]
  /** 미리 깔린(지울 수 있는) 타일 — 기록에는 이걸 바꾼 것만 실린다 */
  pre?: Tile[]
  /** 이 레벨에서 고를 수 있는 센서 색 */
  sensors: Color[]
  /** 가동 횟수 — 다 쓰면 판이 끝난다 */
  runs: number
}

export const BUILD_COLS = 6, BUILD_ROWS = 8
export const BUILD_SPAWN_EVERY = 2
export const BUILD_TICK_GUARD = 200
export const BUILD_DEFAULT_RUNS = 3
const DIRS = [[-1, 0], [0, 1], [1, 0], [0, -1]]
const branchOf = (d: number) => (d + 3) % 4

interface Cell { type: 'empty' | 'wall' | 'source' | 'bin' | 'conv' | 'sensor'; dir?: number; color?: Color; want?: Color | null; fixed?: boolean }

/** 판 만들기 — 레벨 고정물 위에 플레이어 타일을 얹는다(게임의 baseGrid + 타일). */
export function makeGrid(L: BuildLevel, tiles: Tile[]): Cell[][] {
  const g: Cell[][] = []
  for (let r = 0; r < BUILD_ROWS; r++) { g.push([]); for (let c = 0; c < BUILD_COLS; c++) g[r].push({ type: 'empty' }) }
  for (const s of L.sources) g[s.r][s.c] = { type: 'source', dir: s.dir }
  for (const b of L.bins) g[b.r][b.c] = { type: 'bin', want: b.want }
  for (const [r, c] of L.walls ?? []) g[r][c] = { type: 'wall' }
  for (const [r, c, t, d, col] of L.fixed ?? []) g[r][c] = { type: t, dir: d, color: col, fixed: true }
  for (const [r, c, t, d, col] of L.pre ?? []) g[r][c] = { type: t, dir: d, color: col }
  for (const [r, c, t, d, col] of tiles) g[r][c] = { type: t, dir: d, color: col }
  return g
}
export const boxCount = (L: BuildLevel) => L.sources.reduce((n, s) => n + s.pattern.length, 0)

/** 플레이어 타일 검사 — 고정물(생산기·함·벽·고정 타일) 위엔 못 놓고, 센서 색은 레벨이 허용한 것만, 한 칸에 하나. */
export function validTiles(L: BuildLevel, tiles: unknown): tiles is Tile[] {
  if (!Array.isArray(tiles) || tiles.length > BUILD_ROWS * BUILD_COLS) return false
  const base = makeGrid(L, [])
  const seen = new Set<number>()
  for (const t of tiles) {
    if (!Array.isArray(t) || t.length < 4 || t.length > 5) return false
    const [r, c, type, d, col] = t as unknown[]
    if (!Number.isInteger(r) || !Number.isInteger(c) || (r as number) < 0 || (r as number) >= BUILD_ROWS || (c as number) < 0 || (c as number) >= BUILD_COLS) return false
    const k = (r as number) * BUILD_COLS + (c as number)
    if (seen.has(k)) return false
    seen.add(k)
    const b = base[r as number][c as number]
    if (b.type === 'source' || b.type === 'bin' || b.type === 'wall' || b.fixed) return false
    if (![0, 1, 2, 3].includes(d as number)) return false
    if (type === 'conv') { if (col !== undefined && col !== null) return false }
    else if (type === 'sensor') { if (!L.sensors.includes(col as Color)) return false }
    else return false
  }
  return true
}

export interface SimResult { good: number; bad: number; miss: number; need: number; win: boolean }
/** 게임 tick() 과 같은 순서로 돌린다 — 상자 이동 → 생산 → 종료 판정. 상자끼리는 부딪히지 않는다. */
export function simulate(L: BuildLevel, tiles: Tile[]): SimResult {
  const g = makeGrid(L, tiles)
  const need = boxCount(L)
  const items: { r: number; c: number; feat: Color; dead: boolean; steps: number }[] = []
  const spawnIdx = L.sources.map(() => 0)
  let tick = 0, spawned = 0, good = 0, bad = 0, miss = 0
  while (tick < BUILD_TICK_GUARD) {
    tick++
    for (const it of items) {
      if (it.dead) continue
      const t = g[it.r][it.c]
      const dir = t.type === 'conv' || t.type === 'source' ? t.dir! : t.type === 'sensor' ? (it.feat === t.color ? branchOf(t.dir!) : t.dir!) : null
      if (dir === null) { it.dead = true; miss++; continue }
      it.r += DIRS[dir][0]; it.c += DIRS[dir][1]; it.steps++
      if (it.r < 0 || it.r >= BUILD_ROWS || it.c < 0 || it.c >= BUILD_COLS) { it.dead = true; miss++; continue }
      const n = g[it.r][it.c]
      if (n.type === 'bin') { it.dead = true; if (n.want == null || n.want === it.feat) good++; else bad++; continue }
      if (n.type === 'empty' || n.type === 'wall') { it.dead = true; miss++; continue }
      if (it.steps > BUILD_ROWS * BUILD_COLS + 4) { it.dead = true; miss++; continue }
    }
    if (spawned < need && tick % BUILD_SPAWN_EVERY === 1) {
      L.sources.forEach((s, si) => {
        if (spawnIdx[si] < s.pattern.length) { items.push({ r: s.r, c: s.c, feat: s.pattern[spawnIdx[si]], dead: false, steps: 0 }); spawnIdx[si]++; spawned++ }
      })
    }
    if (spawned >= need && !items.some((it) => !it.dead)) break
  }
  return { good, bad, miss, need, win: good === need }
}

export const BUILD_LEVELS: BuildLevel[] = [
  /* 1 직선 라인 */ {"sources":[{"r":0,"c":2,"dir":2,"pattern":["B","B","B","B","B"]}],"bins":[{"r":7,"c":2,"want":null}],"sensors":[],"runs":3},
  /* 2 모퉁이 */ {"sources":[{"r":0,"c":0,"dir":2,"pattern":["B","B","B","B","B"]}],"bins":[{"r":5,"c":4,"want":null}],"sensors":[],"runs":3},
  /* 3 벽 돌아가기 */ {"sources":[{"r":0,"c":2,"dir":2,"pattern":["B","B","B","B","B"]}],"bins":[{"r":7,"c":2,"want":null}],"walls":[[3,1],[3,2],[3,3]],"sensors":[],"runs":3},
  /* 4 두 색 분류 */ {"sources":[{"r":0,"c":1,"dir":2,"pattern":["R","B","R","B","R","B"]}],"bins":[{"r":3,"c":3,"want":"R"},{"r":7,"c":1,"want":"B"}],"sensors":["R"],"runs":3},
  /* 5 꺾이는 쪽이 정해져 있다 */ {"sources":[{"r":0,"c":4,"dir":2,"pattern":["R","B","R","B","R","B"]}],"bins":[{"r":4,"c":3,"want":"R"},{"r":7,"c":1,"want":"B"}],"walls":[[1,5],[2,5],[3,5],[4,5],[5,5],[6,5]],"sensors":["R"],"runs":3},
  /* 6 고장 난 라인 */ {"sources":[{"r":0,"c":2,"dir":2,"pattern":["B","B","B","B","B"]}],"bins":[{"r":7,"c":2,"want":null}],"pre":[[1,2,"conv",2],[2,2,"conv",2],[3,2,"conv",1],[4,2,"conv",2],[5,2,"conv",2],[6,2,"conv",2]],"sensors":[],"runs":3},
  /* 7 세 색 */ {"sources":[{"r":0,"c":2,"dir":2,"pattern":["R","G","B","R","G","B","R","G","B"]}],"bins":[{"r":2,"c":5,"want":"R"},{"r":4,"c":5,"want":"G"},{"r":7,"c":2,"want":"B"}],"sensors":["R","G","B"],"runs":3},
  /* 8 빨강 센서가 없다 */ {"sources":[{"r":0,"c":4,"dir":2,"pattern":["R","B","R","B","R","B"]}],"bins":[{"r":4,"c":0,"want":"R"},{"r":7,"c":3,"want":"B"}],"sensors":["B"],"runs":3},
  /* 9 두 생산기 */ {"sources":[{"r":0,"c":0,"dir":2,"pattern":["B","B","B"]},{"r":0,"c":5,"dir":2,"pattern":["B","B","B"]}],"bins":[{"r":7,"c":2,"want":null}],"sensors":[],"runs":3},
  /* 10 문은 하나 */ {"sources":[{"r":0,"c":0,"dir":2,"pattern":["R","B","R"]},{"r":0,"c":5,"dir":2,"pattern":["B","R","B"]}],"bins":[{"r":7,"c":2,"want":"B"},{"r":5,"c":4,"want":"R"}],"walls":[[4,0],[4,1],[4,3],[4,4],[4,5]],"sensors":["R"],"runs":3},
  /* 11 함도 길을 막는다 */ {"sources":[{"r":0,"c":2,"dir":2,"pattern":["B","B","B","B","B"]}],"bins":[{"r":7,"c":2,"want":"B"},{"r":4,"c":2,"want":"R"}],"walls":[[4,0],[4,1],[4,4],[4,5]],"sensors":[],"runs":3},
  /* 12 갇힌 함 */ {"sources":[{"r":0,"c":1,"dir":2,"pattern":["R","B","R","B","R","B"]}],"bins":[{"r":5,"c":3,"want":"R"},{"r":2,"c":4,"want":"B"}],"walls":[[4,3],[6,3],[5,2]],"sensors":["R"],"runs":3},
  /* 13 뱀길 */ {"sources":[{"r":0,"c":0,"dir":2,"pattern":["B","B","B","B","B"]}],"bins":[{"r":7,"c":5,"want":null}],"walls":[[2,0],[2,1],[2,2],[2,3],[2,4],[5,1],[5,2],[5,3],[5,4],[5,5]],"sensors":[],"runs":3},
  /* 14 문이 둘 */ {"sources":[{"r":0,"c":3,"dir":2,"pattern":["R","B","R","B","R","B"]}],"bins":[{"r":7,"c":4,"want":"R"},{"r":7,"c":1,"want":"B"}],"walls":[[4,0],[4,2],[4,3],[4,5]],"sensors":["R"],"runs":3},
  /* 15 고집 센 센서 */ {"sources":[{"r":0,"c":2,"dir":2,"pattern":["R","B","R","B","R","B"]}],"bins":[{"r":7,"c":4,"want":"R"},{"r":7,"c":0,"want":"B"}],"walls":[[3,0],[3,1],[3,4],[3,5]],"fixed":[[3,2,"sensor",2,"B"]],"sensors":["R"],"runs":3},
  /* 16 셋 중 둘만 */ {"sources":[{"r":0,"c":2,"dir":2,"pattern":["R","G","B","R","G","B","R","G","B"]}],"bins":[{"r":7,"c":2,"want":"R"},{"r":3,"c":5,"want":"G"},{"r":5,"c":5,"want":"B"}],"sensors":["G","B"],"runs":3},
  /* 17 아래에서 올려 넣기 */ {"sources":[{"r":0,"c":2,"dir":2,"pattern":["R","B","R","B","R","B"]}],"bins":[{"r":4,"c":3,"want":"R"},{"r":4,"c":1,"want":"B"}],"walls":[[3,1],[3,3],[4,0],[4,4],[4,2]],"sensors":["B"],"runs":3},
  /* 18 되돌아 올라가기 */ {"sources":[{"r":0,"c":2,"dir":2,"pattern":["R","B","R","B","R","B"]}],"bins":[{"r":0,"c":5,"want":"R"},{"r":7,"c":0,"want":"B"}],"walls":[[0,4],[1,4],[2,4],[3,4]],"sensors":["R"],"runs":3},
  /* 19 두 줄이 한 색을 나눈다 */ {"sources":[{"r":0,"c":0,"dir":2,"pattern":["R","B","R"]},{"r":0,"c":5,"dir":2,"pattern":["G","B","G"]}],"bins":[{"r":7,"c":0,"want":"R"},{"r":7,"c":2,"want":"B"},{"r":2,"c":3,"want":"G"}],"sensors":["B"],"runs":3},
  /* 20 틀린 센서 */ {"sources":[{"r":0,"c":2,"dir":2,"pattern":["R","B","R","B","R","B"]}],"bins":[{"r":3,"c":4,"want":"R"},{"r":7,"c":2,"want":"B"}],"pre":[[1,2,"conv",2],[2,2,"conv",2],[3,2,"sensor",2,"G"],[3,3,"conv",1],[4,2,"conv",2],[5,2,"conv",2],[6,2,"conv",2]],"sensors":["R","G"],"runs":3},
  /* 21 문 하나에 세 색 */ {"sources":[{"r":0,"c":0,"dir":2,"pattern":["R","G","B"]},{"r":0,"c":5,"dir":2,"pattern":["B","R","G"]}],"bins":[{"r":7,"c":2,"want":"B"},{"r":5,"c":5,"want":"R"},{"r":6,"c":5,"want":"G"}],"walls":[[4,0],[4,1],[4,3],[4,4],[4,5]],"sensors":["R","G"],"runs":3},
  /* 22 고집 센 센서 둘 */ {"sources":[{"r":0,"c":2,"dir":2,"pattern":["R","B","R","B","R","B"]}],"bins":[{"r":7,"c":5,"want":"R"},{"r":7,"c":0,"want":"B"}],"walls":[[2,0],[2,1],[2,4],[2,5],[5,0],[5,1],[5,4],[5,5]],"fixed":[[2,2,"sensor",2,"B"],[5,2,"sensor",2,"R"]],"sensors":["R"],"runs":3},
  /* 23 틀린 라인 두 군데 */ {"sources":[{"r":0,"c":1,"dir":2,"pattern":["R","B","R","B","R","B"]}],"bins":[{"r":3,"c":4,"want":"R"},{"r":7,"c":1,"want":"B"}],"pre":[[1,1,"conv",2],[2,1,"conv",2],[3,1,"sensor",2,"B"],[3,2,"conv",1],[3,3,"conv",0],[4,1,"conv",2],[5,1,"conv",2],[6,1,"conv",2]],"sensors":["R","B"],"runs":3},
  /* 24 뱀길에 두 색 */ {"sources":[{"r":0,"c":5,"dir":2,"pattern":["R","B","R","B","R","B"]}],"bins":[{"r":7,"c":0,"want":"B"},{"r":7,"c":5,"want":"R"}],"walls":[[2,1],[2,2],[2,3],[2,4],[2,5],[5,0],[5,1],[5,2],[5,3],[5,4]],"sensors":["R"],"runs":3},
  /* 25 갇힌 함 둘 */ {"sources":[{"r":0,"c":1,"dir":2,"pattern":["R","B","R","B","R","B"]}],"bins":[{"r":2,"c":4,"want":"R"},{"r":6,"c":4,"want":"B"}],"walls":[[1,4],[2,3],[2,5],[5,4],[7,4],[6,3]],"sensors":["R"],"runs":3},
  /* 26 마주 보는 생산기 */ {"sources":[{"r":3,"c":0,"dir":1,"pattern":["R","B","R"]},{"r":3,"c":5,"dir":3,"pattern":["B","R","B"]}],"bins":[{"r":7,"c":2,"want":"R"},{"r":0,"c":3,"want":"B"}],"sensors":["R","B"],"runs":3},
  /* 27 위로 가는 함 */ {"sources":[{"r":0,"c":2,"dir":2,"pattern":["R","G","B","R","G","B","R","G","B"]}],"bins":[{"r":2,"c":0,"want":"R"},{"r":2,"c":1,"want":"B"},{"r":2,"c":4,"want":"G"}],"walls":[[1,0],[1,1],[1,3],[1,4],[1,5]],"sensors":["R","G"],"runs":3},
  /* 28 문 둘에 세 색 */ {"sources":[{"r":0,"c":1,"dir":2,"pattern":["R","G","B","R","G","B","R","G","B"]}],"bins":[{"r":7,"c":1,"want":"R"},{"r":7,"c":4,"want":"G"},{"r":7,"c":5,"want":"B"}],"walls":[[4,0],[4,2],[4,3],[4,5]],"sensors":["G","B"],"runs":3},
  /* 29 긴 뱀길에 세 색 */ {"sources":[{"r":0,"c":4,"dir":2,"pattern":["R","G","B","R","G","B","R","G","B"]}],"bins":[{"r":7,"c":5,"want":"G"},{"r":7,"c":4,"want":"R"},{"r":7,"c":0,"want":"B"}],"walls":[[0,3],[1,3],[2,3],[3,3],[4,3],[5,3],[2,1],[3,1],[4,1],[5,1],[6,1],[7,1]],"sensors":["G","R"],"runs":3},
  /* 30 최종 라인 */ {"sources":[{"r":0,"c":0,"dir":2,"pattern":["R","G","B"]},{"r":0,"c":5,"dir":2,"pattern":["B","G","R"]}],"bins":[{"r":7,"c":1,"want":"R"},{"r":6,"c":4,"want":"B"},{"r":7,"c":2,"want":"G"}],"walls":[[3,0],[3,1],[3,4],[3,5],[5,4],[7,4],[6,5]],"fixed":[[3,2,"sensor",2,"B"]],"sensors":["B","G"],"runs":3},
]
