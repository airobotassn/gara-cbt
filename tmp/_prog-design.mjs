import { analyze, fmt } from './_prog-solver.mjs'
function line(x0, y0, x1, y1) { const out = []; const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0); let x = x0, y = y0; out.push([x, y]); while (x !== x1 || y !== y1) { x += dx; y += dy; out.push([x, y]) } return out }
function path(...segs) { const seen = new Set(), out = []; for (const [x0, y0, x1, y1] of segs) for (const p of line(x0, y0, x1, y1)) { const k = p.join(','); if (!seen.has(k)) { seen.add(k); out.push(p) } } return out }
const COND = ['MV', 'TL', 'TR', 'LP', 'IF'], ALL = ['MV', 'TL', 'TR', 'PK', 'LP', 'IF'], NOTL = ['MV', 'TR', 'PK', 'LP', 'IF'], NOTR = ['MV', 'TL', 'PK', 'LP', 'IF']
export const CAND = {
  // A 계열(첫 후보 묶음) — ORDER 가 쓰는 것만 되살림
  A1: { cols: 5, rows: 6, ops: COND, start: { x: 0, y: 5, dir: 0 }, goal: [4, 1], stars: [], tiles: path([0, 5, 0, 3], [0, 3, 2, 3], [2, 3, 2, 1], [2, 1, 4, 1]), lim: 8 },
  A2: { cols: 5, rows: 6, ops: COND, start: { x: 0, y: 5, dir: 0 }, goal: [0, 1], stars: [], tiles: path([0, 5, 0, 3], [0, 3, 2, 3], [2, 3, 2, 1], [2, 1, 0, 1], [2, 1, 4, 1]), lim: 8 },
  A4: { cols: 5, rows: 6, ops: NOTL, start: { x: 3, y: 5, dir: 0 }, goal: [1, 5], stars: [], tiles: path([3, 5, 3, 3], [3, 3, 0, 3], [0, 3, 0, 5], [0, 5, 1, 5]), lim: 7 },
  A5: { cols: 6, rows: 6, ops: COND, start: { x: 0, y: 3, dir: 2 }, goal: [3, 5], stars: [], tiles: path([0, 3, 0, 1], [0, 1, 3, 1], [3, 1, 3, 5]), lim: 7 },
  A13: { cols: 5, rows: 6, ops: COND, start: { x: 0, y: 5, dir: 0 }, goal: [2, 1], stars: [], tiles: path([0, 5, 0, 4], [0, 4, 2, 4], [2, 4, 2, 3], [2, 3, 0, 3], [0, 3, 0, 2], [0, 2, 2, 2], [2, 2, 2, 1]), lim: 8 },
  // 불규칙 양방향 미로(8칸): 1↑ 3→ 2↑ 2← — 고정 프로그램은 11칸, 반복 패턴 없음 → 조건 둘(막히면 오른쪽, 그래도 막히면 왼쪽 둘)
  B1: { cols: 5, rows: 6, ops: COND, start: { x: 0, y: 5, dir: 0 }, goal: [1, 2], stars: [], tiles: path([0, 5, 0, 4], [0, 4, 3, 4], [3, 4, 3, 2], [3, 2, 1, 2]), lim: 8 },
  // 같은 구조 + 별(목표 포함)
  B2: { cols: 5, rows: 6, ops: ALL, start: { x: 0, y: 5, dir: 0 }, goal: [1, 2], stars: [[2, 4], [3, 3], [1, 2]], tiles: path([0, 5, 0, 4], [0, 4, 3, 4], [3, 4, 3, 2], [3, 2, 1, 2]), lim: 9 },
  // T자: 오른쪽 가지가 막다른 길(2칸) — "막히면 왼쪽 먼저" 순서만 통과
  B3: { cols: 6, rows: 6, ops: COND, start: { x: 0, y: 5, dir: 0 }, goal: [0, 1], stars: [], tiles: path([0, 5, 0, 4], [0, 4, 2, 4], [2, 4, 2, 1], [2, 1, 0, 1], [2, 1, 4, 1]), lim: 8 },
  // 12칸 불규칙 양방향: 반복 8 × (조건둘+앞) = 8칸 → 앞·앞 을 반복 앞에
  B4: { cols: 7, rows: 6, ops: COND, start: { x: 0, y: 5, dir: 0 }, goal: [5, 4], stars: [], tiles: path([0, 5, 0, 2], [0, 2, 3, 2], [3, 2, 3, 0], [3, 0, 5, 0], [5, 0, 5, 4]), lim: 9 },
  // 왼쪽 명령 없음 + 양방향: 왼쪽 = 오른쪽 셋 → 조건(막힘)[오] 조건(막힘)[오 오]
  B5: { cols: 6, rows: 6, ops: NOTL, start: { x: 0, y: 5, dir: 0 }, goal: [4, 3], stars: [], tiles: path([0, 5, 0, 4], [0, 4, 2, 4], [2, 4, 2, 1], [2, 1, 4, 1], [4, 1, 4, 3]), lim: 8 },
  // 오른쪽 명령 없음 + 양방향
  B6: { cols: 6, rows: 6, ops: NOTR, start: { x: 4, y: 5, dir: 0 }, goal: [0, 3], stars: [], tiles: path([4, 5, 4, 4], [4, 4, 2, 4], [2, 4, 2, 1], [2, 1, 0, 1], [0, 1, 0, 3]), lim: 8 },
  // 별 홀짝 섞임 + 10칸(오른쪽만): 앞·앞 밖 + 반복 8[별 집, 막힘 오, 앞]
  B7: { cols: 6, rows: 6, ops: ALL, start: { x: 0, y: 5, dir: 0 }, goal: [4, 3], stars: [[0, 2], [0, 1], [2, 1], [4, 2]], tiles: path([0, 5, 0, 1], [0, 1, 4, 1], [4, 1, 4, 3]), lim: 8 },
  // 계단 + 층계참 별(불규칙: 첫 칸은 별 없음)
  B8: { cols: 6, rows: 6, ops: ALL, start: { x: 0, y: 5, dir: 1 }, goal: [4, 1], stars: [[1, 4], [2, 3], [3, 2]], tiles: path([0, 5, 1, 5], [1, 5, 1, 4], [1, 4, 2, 4], [2, 4, 2, 3], [2, 3, 3, 3], [3, 3, 3, 2], [3, 2, 4, 2], [4, 2, 4, 1]), lim: 8 },
  // 거꾸로 시작 + 불규칙 양방향(6칸)
  B9: { cols: 5, rows: 6, ops: COND, start: { x: 0, y: 3, dir: 2 }, goal: [3, 2], stars: [], tiles: path([0, 3, 0, 1], [0, 1, 2, 1], [2, 1, 2, 2], [2, 2, 3, 2]), lim: 9 },
  // T자 둘(정답 방향 왼·오 섞임) — 오른쪽 가지 1칸·왼쪽 가지 1칸 막다른 길
  B10: { cols: 7, rows: 6, ops: COND, start: { x: 3, y: 5, dir: 0 }, goal: [6, 1], stars: [], tiles: path([3, 5, 3, 3], [3, 3, 1, 3], [3, 3, 5, 3], [5, 3, 5, 1], [5, 1, 6, 1], [5, 1, 4, 1]), lim: 8 },
  // 지그재그 뱀길(좌우 번갈아, 불규칙 길이) + 별
  B11: { cols: 5, rows: 6, ops: ALL, start: { x: 0, y: 5, dir: 0 }, goal: [2, 1], stars: [[1, 4], [1, 3], [2, 2]], tiles: path([0, 5, 0, 4], [0, 4, 2, 4], [2, 4, 2, 3], [2, 3, 0, 3], [0, 3, 0, 2], [0, 2, 2, 2], [2, 2, 2, 1]), lim: 9 },
  // 회전만: 명령이 앞·왼 뿐, 길이 오른쪽으로도 꺾임(왼 셋)
  B12: { cols: 5, rows: 5, ops: ['MV', 'TL'], start: { x: 0, y: 4, dir: 1 }, goal: [3, 0], stars: [], tiles: path([0, 4, 2, 4], [2, 4, 2, 2], [2, 2, 3, 2], [3, 2, 3, 0]), lim: 12 },
}
const only = process.argv.slice(2)
if (process.argv[1] && process.argv[1].endsWith('_prog-design.mjs')) for (const [k, L] of Object.entries(CAND)) { if (only.length && !only.includes(k)) continue
  const t0 = Date.now(); const r = analyze(L, L.lim)
  const r2 = isFinite(r.minLen) && r.minLen < L.lim ? analyze(L, r.minLen) : null
  console.log(`${k} lim=${L.lim} min=${r.minLen} sol@lim=${r.count}${r2 ? ` sol@min=${r2.count}` : ''} first=${r.first ? fmt(r.first) : '-'} (${((Date.now() - t0) / 1000).toFixed(0)}s)`) }
