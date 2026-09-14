// 프로그램해라(program-cari) 레벨 + 실행기(VM) — 서버 재채점용.
//
// ⛔ 레벨 기하는 게임 `public/games/program-cari.html` 의 LEVELS 와 **sync pair** 다(문구(name·goal·teach)는 안 담는다).
//    tests/minigame-replay.mjs 가 두 파일을 대조하고, 각 레벨의 정답 프로그램이 이 VM 으로 성공하는지도 본다.
//    레벨을 넣거나 고치면 양쪽 다 — 안 그러면 그 레벨을 깬 기록이 400 으로 튕겨 랭킹에 안 남는다.
//
// 서버는 게임이 보낸 "레벨별 프로그램(블록 트리)" 을 **같은 규칙으로 실행**해 정말 성공했는지 본다. 실행 규칙은 게임의
// compile()/runProgram() 그대로: 반복은 펼치고, 조건은 실행 시점에 판정해 몸통을 끼워 넣고, 길 밖으로 나가면 실패,
// 300스텝 넘으면 실패, 목표 칸에 별을 다 모은 채 서 있으면 그 즉시 성공(남은 명령은 안 본다).

export type Op = 'MV' | 'TL' | 'TR' | 'PK' | 'LP' | 'IF'
export type Cond = 'blocked' | 'star'
export interface Ins { op: Op; count?: number; cond?: Cond; body?: Ins[] }

export interface ProgLevel {
  cols: number
  rows: number
  /** 명령 칸 상한(중첩 포함 총 개수) */
  limit: number
  /** 레벨당 실행 횟수 — 다 쓰면 판이 끝난다 */
  runs: number
  /** 이 레벨에서 쓸 수 있는 명령 */
  ops: Op[]
  start: { x: number; y: number; dir: number } // dir 0=위 1=오른쪽 2=아래 3=왼쪽
  goal: [number, number]
  stars: [number, number][]
  tiles: [number, number][]
}

export const PROG_DEFAULT_RUNS = 3
export const PROG_STEP_GUARD = 300
export const PROG_LOOP_COUNTS = [2, 4, 6, 8] // 반복 횟수는 이 넷뿐(탭할 때마다 순환)

const T = (...p: [number, number][]) => p
/** 직선 구간 헬퍼: (x0,y0) 에서 (x1,y1) 까지 한 축으로 */
function line(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = []
  const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0)
  let x = x0, y = y0
  out.push([x, y])
  while (x !== x1 || y !== y1) { x += dx; y += dy; out.push([x, y]) }
  return out
}
/** 여러 직선을 이어 붙인다(중복 칸 제거) */
function path(...segs: [number, number, number, number][]): [number, number][] {
  const seen = new Set<string>(), out: [number, number][] = []
  for (const [x0, y0, x1, y1] of segs) for (const p of line(x0, y0, x1, y1)) { const k = p.join(','); if (!seen.has(k)) { seen.add(k); out.push(p) } }
  return out
}
const BASIC: Op[] = ['MV', 'TL', 'TR'], PICK: Op[] = ['MV', 'TL', 'TR', 'PK'], LOOP: Op[] = ['MV', 'TL', 'TR', 'LP'], LOOPK: Op[] = ['MV', 'TL', 'TR', 'PK', 'LP']
const ALL: Op[] = ['MV', 'TL', 'TR', 'PK', 'LP', 'IF'], COND: Op[] = ['MV', 'TL', 'TR', 'LP', 'IF']

export const PROG_LEVELS: ProgLevel[] = [
  // 30레벨(2026-09-14 재설계) — 레벨 하나 = 발상 하나. 기하는 아래 리터럴이 전부다(헬퍼 없음). 설계·검증 스크립트 = tmp/_prog-design2.mjs(naive 명령 집합으로는 못 풀고, 의도한 정답은 통과하는지).
  /* 1 첫 걸음 */ { cols: 5, rows: 3, limit: 6, runs: 3, ops: ["MV","TL","TR"], start: {"x":0,"y":1,"dir":1}, goal: [4,1], stars: [], tiles: [[0,1],[1,1],[2,1],[3,1],[4,1]] },
  /* 2 모퉁이 */ { cols: 5, rows: 5, limit: 8, runs: 3, ops: ["MV","TL","TR"], start: {"x":0,"y":4,"dir":1}, goal: [2,0], stars: [], tiles: [[0,4],[1,4],[2,4],[2,3],[2,2],[2,1],[2,0]] },
  /* 3 뒤돌아서기 */ { cols: 5, rows: 3, limit: 7, runs: 3, ops: ["MV","TL","TR"], start: {"x":4,"y":1,"dir":1}, goal: [0,1], stars: [], tiles: [[0,1],[1,1],[2,1],[3,1],[4,1]] },
  /* 4 별 줍기 */ { cols: 5, rows: 3, limit: 8, runs: 3, ops: ["MV","TL","TR","PK"], start: {"x":0,"y":1,"dir":1}, goal: [4,1], stars: [[2,1],[3,1]], tiles: [[0,1],[1,1],[2,1],[3,1],[4,1]] },
  /* 5 목표 칸의 별 */ { cols: 5, rows: 3, limit: 7, runs: 3, ops: ["MV","TL","TR","PK"], start: {"x":0,"y":1,"dir":1}, goal: [3,1], stars: [[1,1],[3,1]], tiles: [[0,1],[1,1],[2,1],[3,1],[4,1]] },
  /* 6 반복 */ { cols: 7, rows: 3, limit: 4, runs: 3, ops: ["MV","TL","TR","LP"], start: {"x":0,"y":1,"dir":1}, goal: [6,1], stars: [], tiles: [[0,1],[1,1],[2,1],[3,1],[4,1],[5,1],[6,1]] },
  /* 7 계단 반복 */ { cols: 5, rows: 5, limit: 7, runs: 3, ops: ["MV","TL","TR","LP"], start: {"x":0,"y":4,"dir":1}, goal: [4,1], stars: [], tiles: [[0,4],[1,4],[1,3],[2,3],[2,2],[3,2],[3,1],[4,1]] },
  /* 8 반복 두 개 */ { cols: 6, rows: 6, limit: 6, runs: 3, ops: ["MV","TL","TR","LP"], start: {"x":0,"y":5,"dir":1}, goal: [4,1], stars: [], tiles: [[0,5],[1,5],[2,5],[3,5],[4,5],[4,4],[4,3],[4,2],[4,1]] },
  /* 9 막히면 돌기 */ { cols: 5, rows: 6, limit: 6, runs: 3, ops: ["MV","TL","TR","LP","IF"], start: {"x":0,"y":5,"dir":0}, goal: [2,5], stars: [], tiles: [[0,5],[0,4],[0,3],[1,3],[2,3],[3,3],[3,4],[3,5],[2,5]] },
  /* 10 숨은 주기 */ { cols: 7, rows: 3, limit: 8, runs: 3, ops: ["MV","TL","TR","LP"], start: {"x":0,"y":0,"dir":1}, goal: [6,2], stars: [], tiles: [[0,0],[1,0],[2,0],[2,1],[3,1],[4,1],[4,2],[5,2],[6,2]] },
  /* 11 빈 칸 집기 */ { cols: 7, rows: 3, limit: 5, runs: 3, ops: ["MV","TL","TR","PK","LP"], start: {"x":0,"y":1,"dir":1}, goal: [6,1], stars: [[1,1],[3,1],[4,1]], tiles: [[0,1],[1,1],[2,1],[3,1],[4,1],[5,1],[6,1]] },
  /* 12 벽을 보고 시작 */ { cols: 5, rows: 6, limit: 6, runs: 3, ops: ["MV","TL","TR","LP","IF"], start: {"x":0,"y":5,"dir":3}, goal: [2,5], stars: [], tiles: [[0,5],[0,4],[0,3],[1,3],[2,3],[3,3],[3,4],[3,5],[2,5]] },
  /* 13 네 변 */ { cols: 5, rows: 5, limit: 7, runs: 3, ops: ["MV","TL","TR","LP","IF"], start: {"x":0,"y":4,"dir":0}, goal: [2,4], stars: [], tiles: [[0,4],[0,3],[0,2],[0,1],[0,0],[1,0],[2,0],[3,0],[4,0],[4,1],[4,2],[4,3],[4,4],[3,4],[2,4]] },
  /* 14 비켜 가기 */ { cols: 6, rows: 6, limit: 8, runs: 3, ops: ["MV","TL","TR","LP","IF"], start: {"x":0,"y":5,"dir":0}, goal: [3,0], stars: [], tiles: [[0,5],[0,4],[1,4],[1,3],[1,2],[2,2],[2,1],[3,1],[3,0]] },
  /* 15 오른쪽도 왼쪽도 */ { cols: 5, rows: 6, limit: 7, runs: 3, ops: ["MV","TL","TR","LP","IF"], start: {"x":0,"y":5,"dir":0}, goal: [4,1], stars: [], tiles: [[0,5],[0,4],[0,3],[0,2],[1,2],[2,2],[2,1],[3,1],[4,1]] },
  /* 16 두 칸씩 */ { cols: 5, rows: 6, limit: 8, runs: 3, ops: ["MV","TL","TR","LP","IF"], start: {"x":0,"y":5,"dir":0}, goal: [2,4], stars: [], tiles: [[0,5],[0,4],[0,3],[0,2],[0,1],[1,1],[2,1],[3,1],[4,1],[4,2],[4,3],[4,4],[3,4],[2,4]] },
  /* 17 나선 */ { cols: 5, rows: 5, limit: 9, runs: 3, ops: ["MV","TL","TR","LP","IF"], start: {"x":0,"y":4,"dir":0}, goal: [2,2], stars: [], tiles: [[0,4],[0,3],[0,2],[0,1],[0,0],[1,0],[2,0],[3,0],[4,0],[4,1],[4,2],[4,3],[4,4],[3,4],[2,4],[2,3],[2,2]] },
  /* 18 막다른 가지 */ { cols: 5, rows: 6, limit: 6, runs: 3, ops: ["MV","TL","TR","LP","IF"], start: {"x":4,"y":4,"dir":0}, goal: [3,5], stars: [], tiles: [[4,4],[4,3],[3,3],[2,3],[1,3],[1,4],[1,5],[2,5],[3,5],[0,5]] },
  /* 19 별이 표지판 */ { cols: 6, rows: 5, limit: 7, runs: 3, ops: ["MV","TL","TR","PK","LP","IF"], start: {"x":1,"y":4,"dir":0}, goal: [2,1], stars: [[4,3],[4,1]], tiles: [[1,4],[1,3],[0,3],[2,3],[3,3],[4,3],[4,2],[4,1],[3,1],[2,1],[5,1]] },
  /* 20 목표를 지나쳐서 */ { cols: 7, rows: 3, limit: 7, runs: 3, ops: ["MV","TL","TR","PK","LP","IF"], start: {"x":0,"y":1,"dir":1}, goal: [2,1], stars: [[5,1]], tiles: [[0,1],[1,1],[2,1],[3,1],[4,1],[5,1]] },
  /* 21 왕복 */ { cols: 6, rows: 3, limit: 6, runs: 3, ops: ["MV","TL","TR","PK","LP","IF"], start: {"x":3,"y":1,"dir":1}, goal: [0,1], stars: [[5,1],[0,1]], tiles: [[0,1],[1,1],[2,1],[3,1],[4,1],[5,1]] },
  /* 22 별 홀짝 */ { cols: 5, rows: 6, limit: 10, runs: 3, ops: ["MV","TL","TR","PK","LP","IF"], start: {"x":0,"y":5,"dir":0}, goal: [2,5], stars: [[0,4],[1,2],[2,2],[4,3],[4,4]], tiles: [[0,5],[0,4],[0,3],[0,2],[1,2],[2,2],[3,2],[4,2],[4,3],[4,4],[4,5],[3,5],[2,5]] },
  /* 23 두 단계 */ { cols: 5, rows: 6, limit: 14, runs: 3, ops: ["MV","TL","TR","LP","IF"], start: {"x":1,"y":5,"dir":0}, goal: [4,3], stars: [], tiles: [[1,5],[1,4],[1,3],[2,3],[0,3],[0,2],[0,1],[1,1],[2,1],[3,1],[4,1],[4,0],[4,2],[4,3]] },
  /* 24 빗살 복도 */ { cols: 6, rows: 4, limit: 11, runs: 3, ops: ["MV","TL","TR","PK","LP","IF"], start: {"x":1,"y":3,"dir":1}, goal: [5,3], stars: [[2,3],[2,2],[4,3],[4,2]], tiles: [[1,3],[2,3],[3,3],[4,3],[5,3],[2,2],[4,2]] },
  /* 25 뚫린 모퉁이 */ { cols: 5, rows: 6, limit: 7, runs: 3, ops: ["MV","TL","TR","PK","LP","IF"], start: {"x":0,"y":5,"dir":0}, goal: [2,5], stars: [[0,2]], tiles: [[0,5],[0,4],[0,3],[0,2],[0,1],[1,2],[2,2],[2,3],[2,4],[2,5]] },
  /* 26 갈림길 셋 */ { cols: 6, rows: 5, limit: 9, runs: 2, ops: ["MV","TL","TR","PK","LP","IF"], start: {"x":0,"y":4,"dir":0}, goal: [5,1], stars: [[0,3],[2,1]], tiles: [[0,4],[0,3],[0,2],[1,3],[2,3],[2,4],[2,2],[2,1],[2,0],[1,1],[3,1],[4,1],[5,1],[4,2]] },
  /* 27 섞인 모퉁이와 별 */ { cols: 5, rows: 6, limit: 10, runs: 2, ops: ["MV","TL","TR","PK","LP","IF"], start: {"x":0,"y":5,"dir":0}, goal: [4,2], stars: [[0,4],[1,3],[2,2],[3,2]], tiles: [[0,5],[0,4],[0,3],[1,3],[2,3],[2,2],[3,2],[4,2]] },
  /* 28 양쪽으로 비켜 */ { cols: 4, rows: 6, limit: 12, runs: 2, ops: ["MV","TL","TR","PK","LP","IF"], start: {"x":1,"y":5,"dir":0}, goal: [1,0], stars: [[2,2]], tiles: [[1,5],[1,4],[2,4],[2,3],[2,2],[1,2],[1,1],[1,0]] },
  /* 29 뒤를 보고 시작 */ { cols: 4, rows: 5, limit: 6, runs: 2, ops: ["MV","TL","TR","LP","IF"], start: {"x":0,"y":2,"dir":2}, goal: [3,2], stars: [], tiles: [[0,4],[0,3],[0,2],[0,1],[0,0],[1,0],[2,0],[3,0],[3,1],[3,2]] },
  /* 30 최종 시험 */ { cols: 6, rows: 5, limit: 14, runs: 2, ops: ["MV","TL","TR","PK","LP","IF"], start: {"x":0,"y":4,"dir":0}, goal: [2,2], stars: [[0,1],[5,1]], tiles: [[0,4],[0,3],[0,2],[0,1],[0,0],[1,1],[2,1],[3,1],[4,1],[5,1],[5,0],[5,2],[5,3],[5,4],[4,4],[3,4],[2,4],[4,3],[2,3],[2,2]] },
]

// ── VM — 게임 HTML 의 compile()/runProgram() 과 같은 규칙 ──
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0]

/** 명령 개수(중첩 포함) — 게임의 countOps() */
export function countOps(list: Ins[]): number { let n = 0; for (const ins of list) { n++; if (ins.body) n += countOps(ins.body) } return n }

/** 프로그램 형식 검사 — 게임이 만들 수 있는 모양인가(허용 명령·중첩 규칙·반복 횟수·칸 상한). */
export function validProgram(L: ProgLevel, prog: unknown): prog is Ins[] {
  if (!Array.isArray(prog)) return false
  const ok = (list: unknown, depth: 'top' | 'lp' | 'if'): boolean => {
    if (!Array.isArray(list)) return false
    for (const ins of list as Ins[]) {
      if (!ins || typeof ins !== 'object' || typeof ins.op !== 'string' || !L.ops.includes(ins.op)) return false
      if (ins.op === 'LP') { if (depth !== 'top' || !PROG_LOOP_COUNTS.includes(ins.count as number) || !ok(ins.body, 'lp')) return false }
      else if (ins.op === 'IF') { if (depth === 'if' || (ins.cond !== 'blocked' && ins.cond !== 'star') || !ok(ins.body, 'if')) return false }
      else if (ins.body !== undefined) return false
    }
    return true
  }
  return ok(prog, 'top') && countOps(prog) <= L.limit && countOps(prog) > 0
}

interface Step { op: Op; cond?: Cond; body?: Step[] }
function compile(list: Ins[], out: Step[]) {
  for (const ins of list) {
    if (ins.op === 'LP') { for (let r = 0; r < (ins.count ?? 0); r++) compile(ins.body ?? [], out) }
    else if (ins.op === 'IF') { const body: Step[] = []; compile(ins.body ?? [], body); out.push({ op: 'IF', cond: ins.cond, body }) }
    else out.push({ op: ins.op })
  }
}

/** 프로그램을 실행해 성공 여부를 돌려준다. */
export function runProgram(L: ProgLevel, prog: Ins[]): { win: boolean; steps: number } {
  const isTile = (x: number, y: number) => L.tiles.some((t) => t[0] === x && t[1] === y)
  const st = { x: L.start.x, y: L.start.y, dir: L.start.dir, got: new Set<string>() }
  const steps: Step[] = []; compile(prog, steps)
  const aheadBlocked = () => !isTile(st.x + DX[st.dir], st.y + DY[st.dir])
  const starHere = () => L.stars.some((s) => s[0] === st.x && s[1] === st.y) && !st.got.has(st.x + '_' + st.y)
  const done = () => st.x === L.goal[0] && st.y === L.goal[1] && L.stars.every((s) => st.got.has(s[0] + '_' + s[1]))
  let pc = 0, guard = 0
  while (true) {
    if (++guard > PROG_STEP_GUARD) return { win: false, steps: guard }
    if (pc >= steps.length) return { win: done(), steps: guard }
    const step = steps[pc]
    if (step.op === 'IF') { const t = step.cond === 'blocked' ? aheadBlocked() : starHere(); if (t) steps.splice(pc + 1, 0, ...(step.body ?? [])); pc++; continue }
    if (step.op === 'MV') { const nx = st.x + DX[st.dir], ny = st.y + DY[st.dir]; if (!isTile(nx, ny)) return { win: false, steps: guard }; st.x = nx; st.y = ny }
    else if (step.op === 'TL') st.dir = (st.dir + 3) % 4
    else if (step.op === 'TR') st.dir = (st.dir + 1) % 4
    else if (step.op === 'PK') { if (starHere()) st.got.add(st.x + '_' + st.y) }
    if (done()) return { win: true, steps: guard }
    pc++
  }
}
