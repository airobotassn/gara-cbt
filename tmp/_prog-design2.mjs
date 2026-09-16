// 프로그램해라 30레벨 재설계(2026-09-14 · 두 번째) — 레벨 하나 = 발상 하나. 칸은 넉넉히(발상을 찾으면 어떤 모양으로 써도 통과),
// 대신 "그 발상 없이 푸는 프로그램(naive)" 이 칸 안에 못 들어오게 맵을 짠다. 검증 = 아래 verify().
import { runProgram, validProgram, countOps } from '../supabase/functions/_shared/program-levels.ts'
import { analyze, fmt } from './_prog-solver.mjs'
function line(x0, y0, x1, y1) { const out = []; const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0); let x = x0, y = y0; out.push([x, y]); while (x !== x1 || y !== y1) { x += dx; y += dy; out.push([x, y]) } return out }
export function path(...segs) { const seen = new Set(), out = []; for (const [x0, y0, x1, y1] of segs) for (const p of line(x0, y0, x1, y1)) { const k = p.join(','); if (!seen.has(k)) { seen.add(k); out.push(p) } } return out }
const MV = { op: 'MV' }, TL = { op: 'TL' }, TR = { op: 'TR' }, PK = { op: 'PK' }
const LP = (count, ...body) => ({ op: 'LP', count, body }), IFB = (...body) => ({ op: 'IF', cond: 'blocked', body }), IFS = (...body) => ({ op: 'IF', cond: 'star', body })
const BASIC = ['MV', 'TL', 'TR'], PICK = ['MV', 'TL', 'TR', 'PK'], LOOP = ['MV', 'TL', 'TR', 'LP'], LOOPK = ['MV', 'TL', 'TR', 'PK', 'LP']
const COND = ['MV', 'TL', 'TR', 'LP', 'IF'], ALL = ['MV', 'TL', 'TR', 'PK', 'LP', 'IF']
// dir 0=위 1=오른쪽 2=아래 3=왼쪽
// 각 항목: name/goal/teach(한국어 원본) · 기하 · sol(의도한 정답) · naive(이 명령 집합만으로는 못 풀어야 한다) · wrong(이 프로그램들은 실패해야 한다)
export const LEVELS = [
  // ── 배우는 구간 1~9 ──
  { name: '첫 걸음', goal: '앞으로 명령으로 목표까지 가라', cols: 5, rows: 3, limit: 6, runs: 3, ops: BASIC,
    start: { x: 0, y: 1, dir: 1 }, goalPos: [4, 1], stars: [], tiles: line(0, 1, 4, 1), sol: [MV, MV, MV, MV] },
  { name: '모퉁이', goal: '꺾어 돌아 위로 올라가라', cols: 5, rows: 5, limit: 8, runs: 3, ops: BASIC,
    start: { x: 0, y: 4, dir: 1 }, goalPos: [2, 0], stars: [], tiles: path([0, 4, 2, 4], [2, 4, 2, 0]), sol: [MV, MV, TL, MV, MV, MV, MV] },
  { name: '뒤돌아서기', goal: '뒤를 보고 있다! 두 번 돌아서 가라', teach: '왼쪽을 두 번 돌면 뒤를 봐요', cols: 5, rows: 3, limit: 7, runs: 3, ops: BASIC,
    start: { x: 4, y: 1, dir: 1 }, goalPos: [0, 1], stars: [], tiles: line(0, 1, 4, 1), sol: [TL, TL, MV, MV, MV, MV] },
  { name: '별 줍기', goal: '별 2개를 집고 목표로 가라', teach: '별은 그 칸에 서서 집기를 눌러야 주워져요', cols: 5, rows: 3, limit: 8, runs: 3, ops: PICK,
    start: { x: 0, y: 1, dir: 1 }, goalPos: [4, 1], stars: [[2, 1], [3, 1]], tiles: line(0, 1, 4, 1), sol: [MV, MV, PK, MV, PK, MV] },
  { name: '목표 칸의 별', goal: '목표에 서 있어도 별이 남았으면 끝이 아니다', teach: '목표 칸에 있는 별도 집어야 성공이에요', cols: 5, rows: 3, limit: 7, runs: 3, ops: PICK,
    start: { x: 0, y: 1, dir: 1 }, goalPos: [3, 1], stars: [[1, 1], [3, 1]], tiles: line(0, 1, 4, 1), sol: [MV, PK, MV, MV, PK],
    wrong: [[MV, PK, MV, MV]] },
  { name: '반복', goal: '칸이 부족하다! 반복으로 묶어라', teach: '똑같은 명령을 여러 번? 반복 안에 하나만 넣고 횟수를 올려요', cols: 7, rows: 3, limit: 4, runs: 3, ops: LOOP,
    start: { x: 0, y: 1, dir: 1 }, goalPos: [6, 1], stars: [], tiles: line(0, 1, 6, 1), sol: [LP(6, MV)], naive: [BASIC] },
  { name: '계단 반복', goal: '계단 한 칸이 반복 한 번', teach: '"앞으로·왼쪽·앞으로·오른쪽" 이 계단 한 칸이에요', cols: 5, rows: 5, limit: 7, runs: 3, ops: LOOP,
    start: { x: 0, y: 4, dir: 1 }, goalPos: [4, 1], stars: [], tiles: path([0, 4, 1, 4], [1, 4, 1, 3], [1, 3, 2, 3], [2, 3, 2, 2], [2, 2, 3, 2], [3, 2, 3, 1], [3, 1, 4, 1]),
    sol: [LP(4, MV, TL, MV, TR)], naive: [BASIC] },
  { name: '반복 두 개', goal: '반복으로 가고, 돌고, 또 반복', teach: '반복 옆 ×2 를 누르면 4·6·8 로 바뀌어요', cols: 6, rows: 6, limit: 6, runs: 3, ops: LOOP,
    start: { x: 0, y: 5, dir: 1 }, goalPos: [4, 1], stars: [], tiles: path([0, 5, 4, 5], [4, 5, 4, 1]), sol: [LP(4, MV), TL, LP(4, MV)], naive: [BASIC] },
  { name: '막히면 돌기', goal: '꺾이는 자리가 제각각! 조건으로 판단하라', teach: '조건은 "앞이 막혔나?" 를 보고 맞을 때만 안의 명령을 해요. 반복이 남아도 목표에 서면 그 즉시 끝나요', cols: 5, rows: 6, limit: 6, runs: 3, ops: COND,
    start: { x: 0, y: 5, dir: 0 }, goalPos: [2, 5], stars: [], tiles: path([0, 5, 0, 3], [0, 3, 3, 3], [3, 3, 3, 5], [3, 5, 2, 5]), sol: [LP(8, IFB(TR), MV)], naive: [LOOP] },
  // ── 발상 구간 10~21 ──
  { name: '숨은 주기', goal: '들쭉날쭉해 보여도 되풀이되는 한 덩이가 있다', teach: '한 덩이를 찾으면 반복 하나로 끝나요. 남는 반복은 신경 안 써도 돼요', cols: 7, rows: 3, limit: 8, runs: 3, ops: LOOP,
    start: { x: 0, y: 0, dir: 1 }, goalPos: [6, 2], stars: [], tiles: path([0, 0, 2, 0], [2, 0, 2, 1], [2, 1, 4, 1], [4, 1, 4, 2], [4, 2, 6, 2]),
    sol: [LP(4, MV, MV, TR, MV, TL)], naive: [BASIC] },
  { name: '빈 칸 집기', goal: '별이 띄엄띄엄 — 집기를 어디에 넣나', teach: '별 없는 칸에서 집기를 눌러도 아무 일도 없어요. 그래서 매번 집어도 돼요', cols: 7, rows: 3, limit: 5, runs: 3, ops: LOOPK,
    start: { x: 0, y: 1, dir: 1 }, goalPos: [6, 1], stars: [[1, 1], [3, 1], [4, 1]], tiles: line(0, 1, 6, 1), sol: [LP(6, MV, PK)], naive: [PICK] },
  { name: '벽을 보고 시작', goal: '첫 칸부터 막혀 있다 — 순서가 중요하다', teach: '반복 안에서 "돌기"와 "앞으로"의 순서를 바꾸면 결과가 달라요', cols: 5, rows: 6, limit: 6, runs: 3, ops: COND,
    start: { x: 0, y: 5, dir: 3 }, goalPos: [2, 5], stars: [], tiles: path([0, 5, 0, 3], [0, 3, 3, 3], [3, 3, 3, 5], [3, 5, 2, 5]),
    sol: [LP(8, IFB(TR), MV)], naive: [LOOP], wrong: [[LP(8, MV, IFB(TR))]] },
  { name: '네 변', goal: '사각형을 돌아 목표로', teach: '모퉁이에서 도는 것까지 반복 한 덩이에 넣으면 변이 몇 개든 반복 하나예요', cols: 5, rows: 5, limit: 7, runs: 3, ops: COND,
    start: { x: 0, y: 4, dir: 0 }, goalPos: [2, 4], stars: [], tiles: path([0, 4, 0, 0], [0, 0, 4, 0], [4, 0, 4, 4], [4, 4, 2, 4]),
    sol: [LP(4, MV, MV, MV, MV, TR)], naive: [BASIC] },
  { name: '비켜 가기', goal: '길이 한 칸씩 옆으로 밀린다', teach: '조건 안에 명령을 여러 개 넣을 수 있어요 — "돌고, 한 칸 가고, 다시 돌기" 한 묶음', cols: 6, rows: 6, limit: 8, runs: 3, ops: COND,
    start: { x: 0, y: 5, dir: 0 }, goalPos: [3, 0], stars: [], tiles: path([0, 5, 0, 4], [0, 4, 1, 4], [1, 4, 1, 2], [1, 2, 2, 2], [2, 2, 2, 1], [2, 1, 3, 1], [3, 1, 3, 0]),
    sol: [LP(8, IFB(TR, MV, TL), MV)], naive: [LOOP] },
  { name: '오른쪽도 왼쪽도', goal: '꺾이는 방향이 섞여 있다', teach: '"막히면 오른쪽" 다음에 "그래도 막히면 왼쪽으로 두 번" — 조건을 겹쳐요', cols: 5, rows: 6, limit: 7, runs: 3, ops: COND,
    start: { x: 0, y: 5, dir: 0 }, goalPos: [4, 1], stars: [], tiles: path([0, 5, 0, 2], [0, 2, 2, 2], [2, 2, 2, 1], [2, 1, 4, 1]),
    sol: [LP(8, IFB(TR), IFB(TL, TL), MV)], naive: [LOOP], wrong: [[LP(8, IFB(TR), MV)], [LP(8, IFB(TL), MV)]] },
  { name: '두 칸씩', goal: '반복 8번으로는 모자란 긴 길', teach: '반복 한 번에 "조건 + 앞으로" 를 두 벌 넣으면 두 배를 가요', cols: 5, rows: 6, limit: 8, runs: 3, ops: COND,
    start: { x: 0, y: 5, dir: 0 }, goalPos: [2, 4], stars: [], tiles: path([0, 5, 0, 1], [0, 1, 4, 1], [4, 1, 4, 4], [4, 4, 2, 4]),
    sol: [LP(8, IFB(TR), MV, IFB(TR), MV)], naive: [LOOP], wrong: [[LP(8, IFB(TR), MV)]] },
  { name: '나선', goal: '구간이 점점 짧아진다', teach: '횟수로는 못 맞춰요. 벽을 따라가면 길이가 달라도 돼요', cols: 5, rows: 5, limit: 9, runs: 3, ops: COND,
    start: { x: 0, y: 4, dir: 0 }, goalPos: [2, 2], stars: [], tiles: path([0, 4, 0, 0], [0, 0, 4, 0], [4, 0, 4, 4], [4, 4, 2, 4], [2, 4, 2, 2]),
    sol: [LP(8, IFB(TR), MV, IFB(TR), MV)], naive: [LOOP] },
  { name: '막다른 가지', goal: '갈림길의 오른쪽 가지는 막다른 길', teach: '"막히면 오른쪽" 은 막다른 길로 들어가요. 어느 쪽을 먼저 보느냐가 답을 가른다', cols: 5, rows: 6, limit: 6, runs: 3, ops: COND,
    start: { x: 4, y: 4, dir: 0 }, goalPos: [3, 5], stars: [], tiles: path([4, 4, 4, 3], [4, 3, 1, 3], [1, 3, 1, 5], [1, 5, 3, 5], [1, 5, 0, 5]),
    sol: [LP(8, IFB(TL), MV)], naive: [LOOP], wrong: [[LP(8, IFB(TR), IFB(TL, TL), MV)], [LP(8, IFB(TR), MV)]] },
  { name: '별이 표지판', goal: '별이 있는 갈림길은 왼쪽, 없으면 오른쪽', teach: '"별?" 조건 안에 집기와 돌기를 같이 넣어요 — 별이 방향을 알려줘요', cols: 6, rows: 5, limit: 7, runs: 3, ops: ALL,
    start: { x: 1, y: 4, dir: 0 }, goalPos: [2, 1], stars: [[4, 3], [4, 1]], tiles: path([1, 4, 1, 3], [1, 3, 0, 3], [1, 3, 4, 3], [4, 3, 4, 1], [4, 1, 2, 1], [4, 1, 5, 1]),
    sol: [LP(8, IFS(PK, TL), IFB(TR), MV)], naive: [LOOPK], wrong: [[LP(8, IFB(TR), IFS(PK, TL), MV)], [LP(8, IFB(TL), IFB(TR, TR), PK, MV)], [LP(8, IFB(TR), IFB(TL, TL), PK, MV)]] },
  { name: '목표를 지나쳐서', goal: '별이 목표 너머 막다른 길에 있다', teach: '막다른 길에서 오른쪽을 두 번 돌면 되돌아 나와요. 별을 다 못 모았으면 목표를 밟아도 안 끝나요', cols: 7, rows: 3, limit: 7, runs: 3, ops: ALL,
    start: { x: 0, y: 1, dir: 1 }, goalPos: [2, 1], stars: [[5, 1]], tiles: line(0, 1, 5, 1),
    sol: [LP(8, IFB(TR), IFB(TR), PK, MV)], naive: [LOOPK] },
  { name: '왕복', goal: '별이 양쪽 끝에 — 갔다가 돌아와라', teach: '막히면 뒤돌기(왼쪽 둘) 를 반복 안에 넣으면 복도를 왕복해요', cols: 6, rows: 3, limit: 6, runs: 3, ops: ALL,
    start: { x: 3, y: 1, dir: 1 }, goalPos: [0, 1], stars: [[5, 1], [0, 1]], tiles: line(0, 1, 5, 1),
    sol: [LP(8, PK, IFB(TL, TL), MV)], naive: [LOOPK] },
  // ── 겹치는 구간 22~30 ──
  { name: '별 홀짝', goal: '두 칸씩 가는데 별이 홀수·짝수 칸에 섞여 있다', teach: '두 칸씩 가면 집기도 두 번이어야 해요', cols: 5, rows: 6, limit: 10, runs: 3, ops: ALL,
    start: { x: 0, y: 5, dir: 0 }, goalPos: [2, 5], stars: [[0, 4], [1, 2], [2, 2], [4, 3], [4, 4]], tiles: path([0, 5, 0, 2], [0, 2, 4, 2], [4, 2, 4, 5], [4, 5, 2, 5]),
    sol: [LP(8, IFB(TR), PK, MV, IFB(TR), PK, MV)], naive: [LOOPK], wrong: [[LP(8, IFB(TR), PK, MV, IFB(TR), MV)], [LP(8, IFB(TR), MV, IFB(TR), PK, MV)]] },
  { name: '두 단계', goal: '앞 갈림길은 왼쪽이 정답, 뒤 갈림길은 오른쪽이 정답', teach: '한 규칙으로 안 되면 반복을 둘로 나눠요 — 앞 반복이 끝나는 자리를 맞추는 게 열쇠', cols: 5, rows: 6, limit: 14, runs: 3, ops: COND,
    start: { x: 1, y: 5, dir: 0 }, goalPos: [4, 3], stars: [], tiles: path([1, 5, 1, 3], [1, 3, 2, 3], [1, 3, 0, 3], [0, 3, 0, 1], [0, 1, 4, 1], [4, 1, 4, 0], [4, 1, 4, 3]),
    sol: [LP(4, IFB(TL), IFB(TR, TR), MV), LP(8, IFB(TR), IFB(TL, TL), MV)], naive: [LOOP],
    wrong: [[LP(8, IFB(TL), IFB(TR, TR), MV)], [LP(8, IFB(TR), IFB(TL, TL), MV)], [LP(2, IFB(TL), IFB(TR, TR), MV), LP(8, IFB(TR), IFB(TL, TL), MV)]] },
  { name: '빗살 복도', goal: '옆으로 난 짧은 길마다 별 — 들어갔다 나와라', teach: '별이 "여기서 왼쪽" 표지판. 막다른 끝에서는 "막히면 왼쪽" 을 두 번 — 돌아 나와요', cols: 6, rows: 4, limit: 11, runs: 3, ops: ALL,
    start: { x: 1, y: 3, dir: 1 }, goalPos: [5, 3], stars: [[2, 3], [2, 2], [4, 3], [4, 2]], tiles: path([1, 3, 5, 3], [2, 3, 2, 2], [4, 3, 4, 2]),
    sol: [LP(8, IFS(PK, TL), IFB(TL), IFB(TL), MV)], naive: [LOOPK], wrong: [[LP(8, IFS(PK, TL), IFB(TL, TL), MV)], [LP(8, IFS(PK, TL), IFB(TR), MV)]] },
  { name: '뚫린 모퉁이', goal: '모퉁이인데 앞이 뚫려 있다 — 벽 따라가기가 빠진다', teach: '앞이 안 막혔으니 "막힘?" 은 안 걸려요. 별이 "여기서 돌아" 표지판', cols: 5, rows: 6, limit: 7, runs: 3, ops: ALL,
    start: { x: 0, y: 5, dir: 0 }, goalPos: [2, 5], stars: [[0, 2]], tiles: path([0, 5, 0, 1], [0, 2, 2, 2], [2, 2, 2, 5]),
    sol: [LP(8, IFS(PK, TR), IFB(TR), MV)], naive: [LOOPK], wrong: [[LP(8, IFB(TR), MV)], [LP(8, IFB(TR), PK, MV)]] },
  { name: '갈림길 셋', goal: '갈림길마다 막다른 가지 — 별만 믿어라', cols: 6, rows: 5, limit: 9, runs: 2, ops: ALL,
    start: { x: 0, y: 4, dir: 0 }, goalPos: [5, 1], stars: [[0, 3], [2, 1]], tiles: path([0, 4, 0, 2], [0, 3, 2, 3], [2, 3, 2, 4], [2, 3, 2, 0], [1, 1, 5, 1], [4, 1, 4, 2]),
    sol: [LP(8, IFS(PK, TR), IFB(TL), MV)], naive: [LOOPK], wrong: [[LP(8, IFS(PK, TL), IFB(TR), MV)], [LP(8, IFB(TR), IFB(TL, TL), MV)], [LP(8, IFB(TL), IFB(TR, TR), MV)], [LP(8, IFB(TR), MV)]] },
  { name: '섞인 모퉁이와 별', goal: '방향이 섞인 길에 별까지 — 실행은 두 번', teach: '앞에서 배운 걸 겹쳐요: 막히면 오른쪽, 그래도 막히면 왼쪽 둘, 그리고 집기', cols: 5, rows: 6, limit: 10, runs: 2, ops: ALL,
    start: { x: 0, y: 5, dir: 0 }, goalPos: [4, 2], stars: [[0, 4], [1, 3], [2, 2], [3, 2]], tiles: path([0, 5, 0, 3], [0, 3, 2, 3], [2, 3, 2, 2], [2, 2, 4, 2]),
    sol: [LP(8, IFB(TR), IFB(TL, TL), PK, MV)], naive: [LOOPK], wrong: [[LP(8, IFB(TR), IFB(TL, TL), MV)]] },
  { name: '양쪽으로 비켜', goal: '오른쪽으로 밀린 길과 왼쪽으로 밀린 길', teach: '막히면 오른쪽으로 비키고, 별이 있으면 왼쪽으로 비켜요', cols: 4, rows: 6, limit: 12, runs: 2, ops: ALL,
    start: { x: 1, y: 5, dir: 0 }, goalPos: [1, 0], stars: [[2, 2]], tiles: path([1, 5, 1, 4], [1, 4, 2, 4], [2, 4, 2, 2], [2, 2, 1, 2], [1, 2, 1, 0]),
    sol: [LP(8, IFS(PK, TL, MV, TR), IFB(TR, MV, TL), MV)], naive: [LOOPK], wrong: [[LP(8, IFB(TR, MV, TL), MV)], [LP(8, IFB(TR, MV, TL), IFS(PK, TL, MV, TR), MV)]] },
  { name: '뒤를 보고 시작', goal: '막다른 길을 보고 서 있다 — 돌아서서 벽 따라가기', teach: '앞이 열려 있으니 "막힘?" 은 못 알아채요. 반복 앞에 먼저 돌아서는 명령을', cols: 4, rows: 5, limit: 6, runs: 2, ops: COND,
    start: { x: 0, y: 2, dir: 2 }, goalPos: [3, 2], stars: [], tiles: path([0, 4, 0, 0], [0, 0, 3, 0], [3, 0, 3, 2]),
    sol: [TL, TL, LP(8, IFB(TR), MV)], naive: [LOOP], wrong: [[LP(8, IFB(TR), MV)], [LP(8, IFB(TL), MV)]] },
  { name: '최종 시험', goal: '나선 · 뚫린 모퉁이 둘 · 별 — 실행 두 번 안에', cols: 6, rows: 5, limit: 14, runs: 2, ops: ALL,
    start: { x: 0, y: 4, dir: 0 }, goalPos: [2, 2], stars: [[0, 1], [5, 1]], tiles: path([0, 4, 0, 0], [0, 1, 5, 1], [5, 1, 5, 0], [5, 1, 5, 4], [5, 4, 2, 4], [4, 4, 4, 3], [2, 4, 2, 2]),
    sol: [LP(8, IFS(PK, TR), IFB(TR), MV, IFS(PK, TR), IFB(TR), MV)], naive: [LOOPK], wrong: [[LP(8, IFB(TR), MV, IFB(TR), MV)], [LP(8, IFS(PK, TR), IFB(TR), MV)]] },
]
export const toLevel = (L) => ({ cols: L.cols, rows: L.rows, limit: L.limit, runs: L.runs, ops: L.ops, start: L.start, goal: L.goalPos, stars: L.stars, tiles: L.tiles })

if (process.argv[1] && process.argv[1].endsWith('_prog-design2.mjs')) {
  const only = process.argv.slice(2).map(Number)
  let bad = 0
  LEVELS.forEach((D, i) => {
    if (only.length && !only.includes(i + 1)) return
    const L = toLevel(D); const n = countOps(D.sol); const errs = []
    // 기하 검사: 시작·목표·별이 길 위인가, 길 밖 격자 안인가
    const on = (p) => L.tiles.some((t) => t[0] === p[0] && t[1] === p[1])
    if (!on([L.start.x, L.start.y])) errs.push('start off path'); if (!on(L.goal)) errs.push('goal off path'); for (const s of L.stars) if (!on(s)) errs.push('star off path ' + s)
    for (const t of L.tiles) if (t[0] < 0 || t[1] < 0 || t[0] >= L.cols || t[1] >= L.rows) errs.push('tile out ' + t)
    // 정답이 통과하는가
    const v = validProgram(L, D.sol); const r = v ? runProgram(L, D.sol) : { win: false }
    if (!v || !r.win) errs.push(`SOL fails (valid=${v} win=${r.win} ops=${n}/${L.limit})`)
    // 틀린 발상은 실패하는가
    for (const w of D.wrong ?? []) { const vv = validProgram(L, w); if (vv && runProgram(L, w).win) errs.push('WRONG passes: ' + fmt(w)) }
    // 발상 없는 명령 집합으로는 못 푸는가(칸 안에서 전부 돌려본다)
    const t0 = Date.now(); let naiveNote = ''
    for (const ops of D.naive ?? []) { const a = analyze({ ...L, ops }, L.limit, 20000); if (a.count) errs.push(`NAIVE(${ops.join('')}) solves: ${fmt(a.first)}`); naiveNote += ` naive[${ops.length}]=${a.count}${a.partial ? '?' : ''}` }
    // 전체 정답 수(난이도 잣대) — 큰 칸은 오래 걸리니 상한
    let full = '?'
    { const a = analyze(L, L.limit, 25000); full = `${a.count}${a.partial ? '+' : ''} (min ${a.minLen})` }
    console.log(`L${i + 1} ${errs.length ? 'FAIL' : 'ok'} ${D.name} · ops ${n}/${L.limit} · tiles ${L.tiles.length} · 정답 ${full}${naiveNote} · ${((Date.now() - t0) / 1000).toFixed(1)}s${errs.length ? '\n   ' + errs.join('\n   ') : ''}`)
    if (errs.length) bad++
  })
  console.log(bad ? `${bad} FAIL` : 'all ok')
}
