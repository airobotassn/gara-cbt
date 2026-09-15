// minigame-replay — 버텨라·쏴라·골라라·닿아라·프로그램해라·지어라·막아라 점수 규칙의 sync pair 검증 + 서버 재채점 동작.
//
//  0) 닿아라 레벨 기하(reach-cari.html 의 LEVELS ↔ _shared/reach-levels.ts)가 같은가 — 서버가 이걸로 "정말 닿았나" 를 다시 계산한다.
//  1) 네 파일(beat-cari.html · shoot-cari.html · pick-cari.html · _shared/minigame-replay.ts)의 공용 규칙 숫자가 같은가
//     (SCORE_BASE · STREAK_MULT · RETRY_POINT · MAX_WRONG · 최소 간격). 게임 하나만 고치면 여기서 걸린다 —
//     안 걸리면 게임이 보여준 점수와 랭킹 점수가 조용히 갈린다.
//  2) 서버 재채점이 손으로 센 값과 같은가(연속 배수 경계 · 재정답 · 기체 폭발 · 방어선 돌파).
//  3) 형식 검사 — 너무 촘촘한 기록 · 은행에 없는 문항 · 티켓 시간 초과 · 시각 역행을 거부하는가.
//
// 실행: bun tests/minigame-replay.mjs  (test:db 체인에 포함)
import { readFileSync } from 'node:fs'
import * as R from '../supabase/functions/_shared/minigame-replay.ts'
import { REACH_LEVELS, REACH_DEFAULT_TIME, REACH_GRIP, reachedWith } from '../supabase/functions/_shared/reach-levels.ts'
import { PROG_LEVELS, runProgram, validProgram, countOps as progCountOps } from '../supabase/functions/_shared/program-levels.ts'
import { BUILD_LEVELS, simulate as simulateBuild, validTiles as validBuildTiles } from '../supabase/functions/_shared/build-levels.ts'
import { BLOCK_DAYS, BLOCK_MAX_STRIKE, BLOCK_DOC_POINT, BLOCK_PERFECT_BONUS, judgeBlockDoc } from '../supabase/functions/_shared/block-days.ts'
import { ORDER_LEVELS, ORDER_MAX_TRIES, ORDER_KEYS, ORDER_BASE, buildOrderSpec, orderMatches } from '../supabase/functions/_shared/order-levels.ts'
import * as FE from '../src/lib/minigames.ts'

let failed = 0
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a !== e) { failed++; console.error(`FAIL ${label}: got ${a}, expected ${e}`) }
  else console.log(`ok ${label}`)
}

const beat = readFileSync(new URL('../public/games/beat-cari.html', import.meta.url), 'utf8')
const shoot = readFileSync(new URL('../public/games/shoot-cari.html', import.meta.url), 'utf8')
const pick = readFileSync(new URL('../public/games/pick-cari.html', import.meta.url), 'utf8')
const reach = readFileSync(new URL('../public/games/reach-cari.html', import.meta.url), 'utf8')
const prog = readFileSync(new URL('../public/games/program-cari.html', import.meta.url), 'utf8')
const build = readFileSync(new URL('../public/games/build-cari.html', import.meta.url), 'utf8')
const block = readFileSync(new URL('../public/games/block-cari.html', import.meta.url), 'utf8')
const order = readFileSync(new URL('../public/games/order-cari.html', import.meta.url), 'utf8')

// ---------- 0b) 프로그램해라 레벨 대조 + 정답 프로그램이 서버 VM 으로 성공하는가 ----------
{
  const m = prog.match(/const LEVELS=(\[[\s\S]*?\n\]);/)
  const HL = m ? new Function('return ' + m[1])() : null
  eq(HL?.length, PROG_LEVELS.length, 'program 레벨 수 = 서버')
  const geo = (L) => ({ cols: L.cols, rows: L.rows, limit: L.limit, runs: L.runs, ops: L.ops, start: L.start, goal: L.goalPos ?? L.goal, stars: L.stars, tiles: L.tiles })
  ;(HL ?? []).forEach((L, i) => eq(geo(L), PROG_LEVELS[i] && geo(PROG_LEVELS[i]), `program 레벨 ${i + 1} 기하 = 서버`))
  // 의도한 정답 — 레벨을 고치면 여기도 같이(한 레벨이라도 풀이가 없으면 아무도 못 깬다)
  const MV = { op: 'MV' }, TL = { op: 'TL' }, TR = { op: 'TR' }, PK = { op: 'PK' }
  const LP = (count, ...body) => ({ op: 'LP', count, body }), IFB = (...body) => ({ op: 'IF', cond: 'blocked', body }), IFS = (...body) => ({ op: 'IF', cond: 'star', body })
  const SOL = [
    [MV, MV, MV, MV], // 1 첫 걸음
    [MV, MV, TL, MV, MV, MV, MV], // 2 모퉁이
    [TL, TL, MV, MV, MV, MV], // 3 뒤돌아서기
    [MV, MV, PK, MV, PK, MV], // 4 별 줍기
    [MV, PK, MV, MV, PK], // 5 목표 칸의 별
    [LP(6, MV)], // 6 반복
    [LP(4, MV, TL, MV, TR)], // 7 계단 반복
    [LP(4, MV), TL, LP(4, MV)], // 8 반복 두 개
    [LP(8, IFB(TR), MV)], // 9 막히면 돌기
    [LP(4, MV, MV, TR, MV, TL)], // 10 숨은 주기
    [LP(6, MV, PK)], // 11 빈 칸 집기
    [LP(8, IFB(TR), MV)], // 12 벽을 보고 시작
    [LP(4, MV, MV, MV, MV, TR)], // 13 네 변
    [LP(8, IFB(TR, MV, TL), MV)], // 14 비켜 가기
    [LP(8, IFB(TR), IFB(TL, TL), MV)], // 15 오른쪽도 왼쪽도
    [LP(8, IFB(TR), MV, IFB(TR), MV)], // 16 두 칸씩
    [LP(8, IFB(TR), MV, IFB(TR), MV)], // 17 나선
    [LP(8, IFB(TL), MV)], // 18 막다른 가지
    [LP(8, IFS(PK, TL), IFB(TR), MV)], // 19 별이 표지판
    [LP(8, IFB(TR), IFB(TR), PK, MV)], // 20 목표를 지나쳐서
    [LP(8, PK, IFB(TL, TL), MV)], // 21 왕복
    [LP(8, IFB(TR), PK, MV, IFB(TR), PK, MV)], // 22 별 홀짝
    [LP(4, IFB(TL), IFB(TR, TR), MV), LP(8, IFB(TR), IFB(TL, TL), MV)], // 23 두 단계
    [LP(8, IFS(PK, TL), IFB(TL), IFB(TL), MV)], // 24 빗살 복도
    [LP(8, IFS(PK, TR), IFB(TR), MV)], // 25 뚫린 모퉁이
    [LP(8, IFS(PK, TR), IFB(TL), MV)], // 26 갈림길 셋
    [LP(8, IFB(TR), IFB(TL, TL), PK, MV)], // 27 섞인 모퉁이와 별
    [LP(8, IFS(PK, TL, MV, TR), IFB(TR, MV, TL), MV)], // 28 양쪽으로 비켜
    [TL, TL, LP(8, IFB(TR), MV)], // 29 뒤를 보고 시작
    [LP(8, IFS(PK, TR), IFB(TR), MV, IFS(PK, TR), IFB(TR), MV)], // 30 최종 시험
  ]
  eq(SOL.length, PROG_LEVELS.length, 'program 정답 수 = 레벨 수')
  PROG_LEVELS.forEach((L, i) => eq(validProgram(L, SOL[i]) && runProgram(L, SOL[i]).win, true, `program 레벨 ${i + 1} 정답이 서버 VM 으로 성공(${progCountOps(SOL[i])}/${L.limit})`))
  // 재채점
  const log = (n, runs = 1) => SOL.slice(0, n).map((p, i) => ({ lv: i, prog: p, runs }))
  eq(R.replayProgram(log(3), 600), { ok: true, score: 3, answers: 3, durationMs: 0, tie: (4 + 7 + 6) * 1000 + 3 }, 'program 3레벨 = 3 · tie = 명령17×1000 + 실행3')
  eq(R.replayProgram(log(30), 600).score, 30, 'program 30레벨 전부 = 30')
  eq(R.replayProgram(log(2, 3), 600).tie, 11 * 1000 + 6, 'program 실행 3번씩 → tie 끝자리 6')
  eq(R.replayProgram(log(1, 4), 600), { ok: false, reason: 'log_too_many_runs' }, 'program 레벨 실행 상한(3) 초과 거부')
  eq(R.replayProgram([{ lv: 0, prog: [MV, MV, MV], runs: 1 }], 600), { ok: false, reason: 'log_not_solved' }, 'program 목표에 못 간 프로그램 거부')
  eq(R.replayProgram([{ lv: 0, prog: [LP(6, MV)], runs: 1 }], 600), { ok: false, reason: 'log_bad_program' }, 'program 그 레벨에 없는 명령(반복) 거부')
  eq(R.replayProgram([{ lv: 8, prog: [LP(6, MV)], runs: 1 }], 600), { ok: false, reason: 'log_malformed' }, 'program 순서 건너뛰기 거부')
  eq(R.replayProgram([{ lv: 0, prog: [LP(3, MV)], runs: 1 }], 600), { ok: false, reason: 'log_bad_program' }, 'program 반복 횟수 3(없는 값) 거부')
  eq(R.replayProgram([{ lv: 0, prog: [MV, MV, MV, MV, MV, MV, MV], runs: 1 }], 600), { ok: false, reason: 'log_bad_program' }, 'program 명령 칸 초과 거부')
  eq(R.replayProgram([], 600).score, 0, 'program 빈 기록 = 0')
}

// ---------- 0c) 지어라 레벨 대조 + 정답 배치가 서버 시뮬레이터로 전부 출고되는가 ----------
{
  const m = build.match(/const LEVELS=(\[[\s\S]*?\n\]);/)
  const HL = m ? new Function('return ' + m[1])() : null
  eq(HL?.length, BUILD_LEVELS.length, 'build 레벨 수 = 서버')
  const geo = (L) => ({ sources: L.sources, bins: L.bins, walls: L.walls ?? [], fixed: L.fixed ?? [], pre: L.pre ?? [], sensors: L.sensors, runs: L.runs })
  ;(HL ?? []).forEach((L, i) => eq(geo(L), BUILD_LEVELS[i] && geo(BUILD_LEVELS[i]), `build 레벨 ${i + 1} 기하 = 서버`))
  // 의도한 정답 배치(tests/fixtures/build-sol.json — tmp/_build-apply.mjs 가 쓴다). 한 레벨이라도 풀이가 없으면 아무도 못 깬다.
  const SOL = JSON.parse(readFileSync(new URL('./fixtures/build-sol.json', import.meta.url), 'utf8'))
  eq(SOL.length, BUILD_LEVELS.length, 'build 정답 수 = 레벨 수')
  BUILD_LEVELS.forEach((L, i) => eq(validBuildTiles(L, SOL[i]) && simulateBuild(L, SOL[i]).win, true, `build 레벨 ${i + 1} 정답이 서버 시뮬레이터로 전부 출고(${SOL[i].length}타일)`))
  // 재채점 — 순서·횟수·배치 검사
  const log = (n, runs = 1) => SOL.slice(0, n).map((tiles, lv) => ({ lv, tiles, runs }))
  const tsum = (n) => SOL.slice(0, n).reduce((a, t) => a + t.length, 0)
  eq(R.replayBuild(log(3), 600), { ok: true, score: 3, answers: 3, durationMs: 0, tie: tsum(3) * 1000 + 3 }, `build 3레벨 = 3 · tie = 타일${tsum(3)}×1000 + 가동3`)
  eq(R.replayBuild(log(30), 600).score, 30, 'build 30레벨 전부 = 30')
  eq(R.replayBuild(log(2, 3), 600).tie, tsum(2) * 1000 + 6, 'build 가동 3번씩 → tie 끝자리 6')
  eq(R.replayBuild(log(1, 4), 600), { ok: false, reason: 'log_too_many_runs' }, 'build 레벨 가동 상한(3) 초과 거부')
  eq(R.replayBuild([{ lv: 0, tiles: SOL[0].slice(0, 3), runs: 1 }], 600), { ok: false, reason: 'log_not_solved' }, 'build 함까지 못 간 배치 거부')
  eq(R.replayBuild([{ lv: 0, tiles: [[0, 2, 'conv', 2]], runs: 1 }], 600), { ok: false, reason: 'log_bad_tiles' }, 'build 생산기 칸 위 타일 거부')
  eq(R.replayBuild([{ lv: 2, tiles: [[3, 1, 'conv', 2]], runs: 1 }], 600), { ok: false, reason: 'log_malformed' }, 'build 순서 건너뛰기 거부')
  eq(R.replayBuild([{ lv: 0, tiles: [[1, 2, 'sensor', 2, 'R']], runs: 1 }], 600), { ok: false, reason: 'log_bad_tiles' }, 'build 그 레벨에 없는 센서 색 거부')
  eq(R.replayBuild([{ lv: 0, tiles: [[1, 2, 'conv', 2], [1, 2, 'conv', 2]], runs: 1 }], 600), { ok: false, reason: 'log_bad_tiles' }, 'build 한 칸 두 타일 거부')
  // 고정 타일 위 · 벽 위
  eq(R.replayBuild(log(14).concat([{ lv: 14, tiles: [[3, 2, 'conv', 2]], runs: 1 }]), 600), { ok: false, reason: 'log_bad_tiles' }, 'build 고정 센서 칸 위 타일 거부')
  eq(R.replayBuild(log(2).concat([{ lv: 2, tiles: [[3, 2, 'conv', 2]], runs: 1 }]), 600), { ok: false, reason: 'log_bad_tiles' }, 'build 벽 위 타일 거부')
  eq(R.replayBuild([], 600).score, 0, 'build 빈 기록 = 0')
}

// ---------- 0) 닿아라 레벨 기하 대조 ----------
{
  // HTML 의 `const LEVELS=[ … ];` 리터럴을 그대로 평가한다(데이터뿐이라 안전).
  const m = reach.match(/const LEVELS=(\[[\s\S]*?\n\]);/)
  const htmlLevels = m ? new Function('return ' + m[1])() : null
  const htmlDefault = lit(reach, 'DEFAULT_TIME', 'reach')
  eq(htmlDefault, REACH_DEFAULT_TIME, 'reach DEFAULT_TIME = 서버')
  eq(lit(reach, 'GRIP', 'reach'), REACH_GRIP, 'reach GRIP(집게 중심 거리) = 서버')
  eq(htmlLevels?.length, REACH_LEVELS.length, 'reach 레벨 수 = 서버')
  const geo = (L, dflt) => ({ base: L.base, segs: L.segs, limits: L.limits,
    target: { x: L.target.x, y: L.target.y, r: L.target.r }, obstacles: L.obstacles, time: L.time || dflt })
  ;(htmlLevels ?? []).forEach((L, i) => eq(geo(L, htmlDefault), REACH_LEVELS[i] && geo(REACH_LEVELS[i], REACH_DEFAULT_TIME), `reach 레벨 ${i + 1} 기하 = 서버`))
  // 게임이 적어 둔 정답 자세(solve)는 서버 판정으로도 닿아야 한다 — 서버 기하학이 게임과 같다는 증거.
  ;(htmlLevels ?? []).forEach((L, i) => eq(reachedWith(REACH_LEVELS[i], L.solve), true, `reach 레벨 ${i + 1} solve 자세가 서버에서도 닿는다`))
  ;(htmlLevels ?? []).forEach((L, i) => eq(reachedWith(REACH_LEVELS[i], L.start), false, `reach 레벨 ${i + 1} 시작 자세는 안 닿는다`))
  eq(/mIK|tipDrag|ccdSolve\(ang, goal\)/.test(reach), false, 'reach 손끝(IK) 모드가 없다')
}

/** `const NAME = <literal>;` 를 긁어 JSON 으로 읽는다(배열은 그대로 JSON 이다). */
function lit(src, name, file) {
  const m = src.match(new RegExp(`const\\s+${name}\\s*=\\s*([^;]+);`))
  if (!m) { failed++; console.error(`FAIL ${file}: ${name} 없음`); return undefined }
  return JSON.parse(m[1].trim())
}

// ---------- 1) 규칙 숫자 대조 ----------
for (const [file, src] of [['beat-cari.html', beat], ['shoot-cari.html', shoot]]) {
  eq(lit(src, 'SCORE_BASE', file), R.SCORE_BASE, `${file} SCORE_BASE = 서버`)
  eq(lit(src, 'STREAK_MULT', file), R.STREAK_MULT, `${file} STREAK_MULT = 서버`)
}
eq(lit(shoot, 'RETRY_POINT', 'shoot'), R.RETRY_POINT, 'shoot RETRY_POINT = 서버')
eq(lit(shoot, 'MAX_WRONG', 'shoot'), R.MAX_WRONG, 'shoot MAX_WRONG = 서버')
eq(lit(beat, 'REVEAL_MS', 'beat'), R.BEAT_REVEAL_MS, 'beat REVEAL_MS = 서버 최소 간격')
eq(lit(shoot, 'ANSWER_LOCK_MS', 'shoot'), R.SHOOT_ANSWER_LOCK_MS, 'shoot ANSWER_LOCK_MS = 서버 최소 간격')
// 세 게임의 레벨 사다리는 한 벌이어야 한다("통일" 이 깨지면 여기서 잡는다). 골라라는 서버가 라운드 간격 검사에 쓴다.
for (const name of ['LEVEL_STEP', 'LEVEL_MAX', 'SPEED_STEP']) {
  eq(lit(beat, name, 'beat'), lit(shoot, name, 'shoot'), `${name} 버텨라 = 쏴라`)
  eq(lit(pick, name, 'pick'), R.PICK[name], `${name} 골라라 = 서버`)
}
eq(lit(pick, 'T0', 'pick'), R.PICK.T0, 'pick T0 = 서버')
eq(/TOTAL_STAGES|planSurvivors/.test(pick), false, 'pick 옛 15라운드 상한·생존자 주사위가 없다')
// 쏴라 answerLock 이 상수를 진짜 쓰는지(숫자 리터럴로 되돌아가면 상수만 맞고 실제 잠금이 다르다).
eq(/answerLock=false[^}]*\},\s*ANSWER_LOCK_MS\)/.test(shoot), true, 'shoot answerLock 이 ANSWER_LOCK_MS 를 쓴다')

// ---------- 2) 재채점 ----------
const ids = new Set(['q1', 'q2', 'q3'])
const AGE = 600 // 티켓 나이 10분

// 배수 경계: 4개까지 10, 5~9 는 15, 10~19 는 20, 20부터 30.
eq(R.streakMult(4), 1, 'streakMult 4 → 1')
eq(R.streakMult(5), 1.5, 'streakMult 5 → 1.5')
eq(R.streakMult(10), 2, 'streakMult 10 → 2')
eq(R.streakMult(20), 3, 'streakMult 20 → 3')

/** n 개 답을 gap ms 간격으로. k 는 함수(i)→원본 자리. */
const beatLog = (n, kOf, gap = 500) => Array.from({ length: n }, (_, i) => ({ q: 'q1', k: kOf(i), t: (i + 1) * gap }))

eq(R.replayBeat(beatLog(4, () => 0), AGE, ids), { ok: true, score: 40, answers: 4, durationMs: 2000 }, 'beat 4연속 = 40')
eq(R.replayBeat(beatLog(5, () => 0), AGE, ids).score, 55, 'beat 5연속 = 40 + 15')
eq(R.replayBeat(beatLog(10, () => 0), AGE, ids).score, 40 + 15 * 5 + 20, 'beat 10연속 = 135')
eq(R.replayBeat(beatLog(20, () => 0), AGE, ids).score, 40 + 75 + 20 * 10 + 30, 'beat 20연속 = 345')
// 6번째에서 틀리면 연속이 끊겨 7번째는 다시 10점.
eq(R.replayBeat(beatLog(7, (i) => (i === 5 ? 2 : 0)), AGE, ids).score, 40 + 15 + 0 + 10, 'beat 오답이 연속을 끊는다')
eq(R.replayBeat([], AGE, ids), { ok: true, score: 0, answers: 0, durationMs: 0 }, 'beat 빈 기록 = 0')

// 쏴라: 기체 m 마다 사건. 무오답 격추 / 한 번 틀리고 격추 / 두 번 틀림 / 방어선 돌파.
let t = 0
const S = (e) => ({ ...e, t: (t += 500) })
eq(R.replayShoot([S({ m: 1, q: 'q1', k: 0 })], AGE, ids).score, 10, 'shoot 격추 = 10')
t = 0
eq(R.replayShoot([S({ m: 1, q: 'q1', k: 2 }), S({ m: 1, q: 'q1', k: 0 })], AGE, ids).score, 5, 'shoot 한 번 틀리고 격추 = 5')
t = 0
eq(R.replayShoot([S({ m: 1, q: 'q1', k: 2 }), S({ m: 1, q: 'q1', k: 3 }), S({ m: 1, q: 'q1', k: 0 })], AGE, ids).score, 0,
  'shoot 두 번 틀리면 기체가 터져 그 뒤 정답은 무시')
t = 0
// 4연속 → 방어선 돌파 → 다음 격추는 연속 1 부터.
eq(R.replayShoot([
  S({ m: 1, q: 'q1', k: 0 }), S({ m: 2, q: 'q2', k: 0 }), S({ m: 3, q: 'q3', k: 0 }), S({ m: 4, q: 'q1', k: 0 }),
  S({ m: 5, x: 1 }), S({ m: 6, q: 'q2', k: 0 }),
], AGE, ids).score, 50, 'shoot 방어선 돌파가 연속을 끊는다')
t = 0
// 재정답은 연속에 안 들어간다: 4연속 → (틀림, 재정답 5) → 다음 무오답 격추는 연속 1 = 10.
eq(R.replayShoot([
  S({ m: 1, q: 'q1', k: 0 }), S({ m: 2, q: 'q2', k: 0 }), S({ m: 3, q: 'q3', k: 0 }), S({ m: 4, q: 'q1', k: 0 }),
  S({ m: 5, q: 'q2', k: 1 }), S({ m: 5, q: 'q2', k: 0 }), S({ m: 6, q: 'q3', k: 0 }),
], AGE, ids).score, 40 + 5 + 10, 'shoot 재정답은 연속에 안 넣는다')
t = 0
// 5연속 격추 = 10×4 + 15.
eq(R.replayShoot([1, 2, 3, 4, 5].map((m) => S({ m, q: 'q1', k: 0 })), AGE, ids).score, 55, 'shoot 5연속 = 55')

// 골라라: 라운드 간격 = 그 라운드의 답할 시간 이상. L1 10초, 정답 10개 뒤 L2 7.7초.
eq(R.pickRoundMs(1), 10000, 'pick L1 = 10초')
eq(Math.round(R.pickRoundMs(4)), 5263, 'pick L4 = 5.3초')
eq(Math.round(R.pickRoundMs(7)), 3571, 'pick L7 = 3.6초')
/** n 라운드, 전부 정답, 마지막만 오답. 간격은 레벨별 시간 + 3초(연출). */
function pickLog(n, lastWrong = true) {
  const out = []; let t = 500, correct = 0
  for (let i = 0; i < n; i++) {
    t += R.pickRoundMs(R.pickLevelFor(correct)) + 3000
    const k = i % 2, right = !(lastWrong && i === n - 1)
    const c = right ? (k === 0 ? 'O' : 'X') : (k === 0 ? 'X' : 'O')
    out.push({ q: 'q1', k, c, t: Math.round(t) })
    if (right) correct++
  }
  return out
}
eq(R.replayPick(pickLog(7), AGE, ids).score, 7, 'pick 6정답 + 7번째 오답 = 7라운드')
eq(R.replayPick(pickLog(25), 900, ids).score, 25, 'pick 25라운드(레벨 3까지 시간이 줄어든 간격) 통과')
eq(R.replayPick([{ q: 'q1', k: 0, c: '', t: 11000 }], AGE, ids).score, 1, 'pick 안 고르면 오답 = 1라운드')
{ // 첫 오답 뒤의 라운드는 세지 않는다(게임이 만들 수 없는 기록)
  const l = pickLog(3); l.push({ q: 'q1', k: 0, c: 'O', t: l[2].t + 20000 })
  eq(R.replayPick(l, AGE, ids).score, 3, 'pick 끝난 뒤 라운드는 무시')
}
{ // 정답 10개 뒤(L2 = 7.7초)에 6초 간격은 거부, 10개 전(L1 = 10초)에 8초 간격도 거부
  const l = pickLog(12, false); l[11].t = l[10].t + 6000
  eq(R.replayPick(l, AGE, ids), { ok: false, reason: 'log_too_fast' }, 'pick L2 에서 6초 간격 거부')
  const m = pickLog(3, false); m[2].t = m[1].t + 8000
  eq(R.replayPick(m, AGE, ids), { ok: false, reason: 'log_too_fast' }, 'pick L1 에서 8초 간격 거부')
}
eq(R.replayPick([{ q: 'q1', k: 0, c: 'Z', t: 11000 }], AGE, ids), { ok: false, reason: 'log_malformed' }, 'pick c 값 범위 밖 거부')
eq(R.replayPick([{ q: 'nope', k: 0, c: 'O', t: 11000 }], AGE, ids), { ok: false, reason: 'log_unknown_question' }, 'pick 은행에 없는 문항 거부')

// 닿아라: 레벨별 최종 각도 기록. solve 자세로 순서대로 깬 기록은 통과, 순서·시간·각도가 어긋나면 거부.
{
  const m = reach.match(/const LEVELS=(\[[\s\S]*?\n\]);/)
  const HL = new Function('return ' + m[1])()
  const run = (n, gapMs = 8000) => HL.slice(0, n).map((L, i) => ({ lv: i, a: L.solve, s: 1000 + i * (gapMs + 3000), t: 1000 + i * (gapMs + 3000) + gapMs }))
  eq(R.replayReach(run(5), AGE), { ok: true, score: 5, answers: 5, durationMs: 1000 + 4 * 11000 + 8000 }, 'reach 5레벨 전부 = 5')
  eq(R.replayReach(run(2), AGE).score, 2, 'reach 2레벨 = 2')
  eq(R.replayReach([], AGE).score, 0, 'reach 빈 기록 = 0')
  { const l = run(HL.length); l.push({ lv: HL.length, a: HL[0].solve, s: l[l.length - 1].t + 1000, t: l[l.length - 1].t + 5000 }); eq(R.replayReach(l, 3000), { ok: false, reason: 'log_malformed' }, 'reach 없는 레벨 거부') }
  eq(R.replayReach(run(HL.length), 3000).score, HL.length, `reach ${HL.length}레벨 전부 클리어 = ${HL.length}`)
  { const l = run(2); l[1].lv = 0; eq(R.replayReach(l, AGE), { ok: false, reason: 'log_malformed' }, 'reach 순서 어긋남 거부') }
  { const l = run(1, REACH_DEFAULT_TIME * 1000 + 2000); eq(R.replayReach(l, AGE), { ok: false, reason: 'log_over_time' }, `reach 제한시간 ${REACH_DEFAULT_TIME}초(+1.5초 여유) 초과 거부`) }
  { const l = run(1, REACH_DEFAULT_TIME * 1000 - 1000); eq(R.replayReach(l, AGE).ok, true, `reach ${REACH_DEFAULT_TIME - 1}초는 통과`) }
  { const l = run(1); l[0].a = HL[0].start; eq(R.replayReach(l, AGE), { ok: false, reason: 'log_not_reached' }, 'reach 안 닿은 각도 거부') }
  { const l = run(1); l[0].a = [999, 0]; eq(R.replayReach(l, AGE), { ok: false, reason: 'log_not_reached' }, 'reach 관절 한계 밖 거부') }
  { const l = run(2); l[1].s = l[0].t - 5000; eq(R.replayReach(l, AGE), { ok: false, reason: 'log_not_monotonic' }, 'reach 이전 클리어보다 먼저 시작 거부') }
  { const l = run(1); l[0].t = AGE * 1000 + 9000; l[0].s = l[0].t - 1000; eq(R.replayReach(l, AGE), { ok: false, reason: 'log_exceeds_ticket' }, 'reach 티켓 시간 초과 거부') }
}

// ---------- 3) 형식 검사 ----------
eq(R.replayBeat(beatLog(3, () => 0, 100), AGE, ids), { ok: false, reason: 'log_too_fast' }, 'beat 230ms 보다 촘촘하면 거부')
eq(R.replayBeat(beatLog(3, () => 0, 205), AGE, ids).ok, true, 'beat 30ms 여유는 봐준다')
t = 0
eq(R.replayShoot([S({ m: 1, q: 'q1', k: 0 }), { m: 2, q: 'q1', k: 0, t: 700 }], AGE, ids), { ok: false, reason: 'log_too_fast' },
  'shoot 340ms 보다 촘촘하면 거부')
t = 0
eq(R.replayShoot([S({ m: 1, q: 'q1', k: 0 }), { m: 2, x: 1, t: 510 }], AGE, ids).ok, true, 'shoot 돌파 사건은 간격 검사 대상이 아니다')
eq(R.replayBeat([{ q: 'nope', k: 0, t: 500 }], AGE, ids), { ok: false, reason: 'log_unknown_question' }, '은행에 없는 문항 거부')
eq(R.replayBeat([{ q: 'q1', k: 0, t: AGE * 1000 + 6000 }], AGE, ids), { ok: false, reason: 'log_exceeds_ticket' }, '티켓 시간 초과 거부')
eq(R.replayBeat([{ q: 'q1', k: 0, t: 900 }, { q: 'q1', k: 0, t: 500 }], AGE, ids), { ok: false, reason: 'log_not_monotonic' }, '시각 역행 거부')
eq(R.replayBeat(undefined, AGE, ids), { ok: false, reason: 'log_missing' }, '기록 없음 거부')
eq(R.replayBeat([{ q: 'q1', k: 7, t: 500 }], AGE, ids), { ok: false, reason: 'log_malformed' }, 'k 범위 밖 거부')
eq(R.replayBeat([{ q: null, k: 0, t: 500 }], AGE, ids), { ok: false, reason: 'log_malformed' }, '폴백 문항(id 없음) 기록은 거부')
eq(R.replayShoot([{ q: 'q1', k: 0, t: 500 }], AGE, ids), { ok: false, reason: 'log_malformed' }, 'shoot 기체 순번 없으면 거부')
eq(R.logQuestionIds([{ q: 'a' }, { q: 'b' }, { q: 'a' }, { x: 1 }]), ['a', 'b'], 'logQuestionIds 중복 제거')

// ---------- 0d) 막아라 서류·규칙 대조 + 재채점 ----------
{
  // HTML 의 DAYS 리터럴을 평가해 조각 종류 순서만 뽑는다 — 서버 표(block-days.ts)는 문구 없이 이 순서만 들고 있다.
  const m = block.match(/const DAYS=(\[[\s\S]*?\n\]);/)
  const HD = m ? new Function('return ' + m[1])() : null
  eq(HD?.length, BLOCK_DAYS.length, 'block 일수 = 서버')
  const kindsOf = (text) => [...text.matchAll(/\{([a-z]+)\|/g)].map((x) => x[1])
  ;(HD ?? []).forEach((D, di) => {
    const S = BLOCK_DAYS[di]
    eq({ mask: D.newMask, block: D.newBlock }, S && { mask: S.mask, block: S.block }, `block ${di + 1}일차 새 규정 = 서버`)
    eq(D.docs.map((d) => ({ block: d.block, kinds: kindsOf(d.text) })), S && S.docs.map((d) => ({ block: d.block, kinds: d.kinds })), `block ${di + 1}일차 서류 ${D.docs.length}장 조각 = 서버`)
  })
  eq(lit(block, 'MAX_STRIKE', 'block'), BLOCK_MAX_STRIKE, 'block MAX_STRIKE = 서버')
  eq(lit(block, 'DOC_POINT', 'block'), BLOCK_DOC_POINT, 'block DOC_POINT = 서버')
  eq(lit(block, 'PERFECT_BONUS', 'block'), BLOCK_PERFECT_BONUS, 'block PERFECT_BONUS = 서버')
  eq(/log:\(opts&&Array\.isArray\(opts\.log\)\)\?opts\.log:undefined/.test(block), true, 'block 브리지가 log 를 실어 보낸다')
  eq(/MGBridge\.submit\(score,\{log:LOG\}\)/.test(block), true, 'block 게임오버가 log 를 넘긴다')
  // 설계 규칙 — 날마다 위반 0 인 서류가 한 장은 있고, 전송형 서류는 핵심(k) 조각이 둘 이상이다(다 칠하기 방지).
  const am = new Set(), ab = new Set()
  BLOCK_DAYS.forEach((D, di) => {
    D.mask.forEach((k) => am.add(k)); D.block.forEach((k) => ab.add(k))
    const send = D.docs.filter((d) => !(d.block && ab.has(d.block)))
    eq(send.some((d) => !d.kinds.some((k) => am.has(k))), true, `block ${di + 1}일차 위반 0 서류 있음`)
    eq(send.every((d) => d.kinds.filter((k) => k === 'k').length >= 2), true, `block ${di + 1}일차 전송형 서류 k≥2`)
    eq(D.docs.every((d) => d.kinds.every((k) => k === 'k' || k === 'd' || am.has(k))), true, `block ${di + 1}일차 아직 규정에 없는 종류의 조각 없음`)
  })
  // 정답 기록(전부 맞게 처리) → 만점. 손으로 센 값: 전송형 150 × N + 반려형 100 × M.
  const perfect = () => {
    const out = []; const amk = new Set(), abk = new Set(); let t = 0
    BLOCK_DAYS.forEach((D, d) => { D.mask.forEach((k) => amk.add(k)); D.block.forEach((k) => abk.add(k))
      D.docs.forEach((doc, i) => { const isB = doc.block && abk.has(doc.block); t += 3000
        out.push({ d, i, m: isB ? [] : doc.kinds.map((k, j) => amk.has(k) ? j : -1).filter((j) => j >= 0), s: isB ? 0 : 1, t }) }) })
    return out
  }
  const P = perfect()
  const nRej = P.filter((e) => e.s === 0).length, nSend = P.length - nRej
  const MAX = nSend * (BLOCK_DOC_POINT + BLOCK_PERFECT_BONUS) + nRej * BLOCK_DOC_POINT
  eq(R.replayBlock(P, 600), { ok: true, score: MAX, answers: 50, durationMs: 150000 }, `block 정답 50장 = ${MAX} (전송 ${nSend} · 반려 ${nRej})`)
  eq(R.replayBlock(P.slice(0, 12), 600).score, 12 * (BLOCK_DOC_POINT + BLOCK_PERFECT_BONUS), 'block 12장까지 = 1,800')
  // 개별 판정 — 게임 judge() 의 갈래 그대로
  const j = (mask, blk, doc, m, sent) => judgeBlockDoc(new Set(mask), new Set(blk), doc, new Set(m), sent)
  eq(j(['name'], [], { kinds: ['d', 'name', 'k', 'k'] }, [1], true), { ok: true, gain: 150 }, 'block 위반만 가림 = 150')
  eq(j(['name'], [], { kinds: ['d', 'name', 'k', 'k'] }, [0, 1], true), { ok: true, gain: 100 }, 'block 무해까지 가림 = 100(보너스 없음)')
  eq(j(['name'], [], { kinds: ['d', 'name', 'k', 'k'] }, [], true), { ok: false, gain: 0 }, 'block 안 가리고 전송 = 유출')
  eq(j(['name'], [], { kinds: ['d', 'name', 'k', 'k'] }, [1, 2], true), { ok: false, gain: 0 }, 'block 핵심 가림 = 실패')
  eq(j(['name'], [], { kinds: ['d', 'name', 'k', 'k'] }, [], false), { ok: false, gain: 0 }, 'block 멀쩡한 서류 반려 = 실패')
  eq(j(['name'], ['hr'], { block: 'hr', kinds: ['d', 'k'] }, [], false), { ok: true, gain: 100 }, 'block 금지 서류 반려 = 100')
  eq(j(['name'], ['hr'], { block: 'hr', kinds: ['name', 'k'] }, [0], true), { ok: false, gain: 0 }, 'block 금지 서류는 가려도 전송 = 실패')
  eq(j(['name'], [], { block: 'src', kinds: ['k', 'k'] }, [], true), { ok: true, gain: 150 }, 'block 아직 규정에 없는 코드 서류 = 전송이 정답(7일차 4번)')
  eq(j(['name'], [], { kinds: ['price', 'k', 'k'] }, [0], true), { ok: true, gain: 100 }, 'block 아직 규정에 없는 종류를 가림 = 통과(보너스만 없음)')
  // 형식 — 순서·해고 뒤·시각
  eq(R.replayBlock([{ d: 0, i: 1, m: [], s: 1, t: 10 }], 600), { ok: false, reason: 'log_malformed' }, 'block 1번 건너뛰기 거부')
  eq(R.replayBlock([{ d: 0, i: 0, m: [9], s: 1, t: 10 }], 600), { ok: false, reason: 'log_malformed' }, 'block 없는 조각 자리 거부')
  const three = [{ d: 0, i: 0, m: [], s: 0, t: 10 }, { d: 0, i: 1, m: [], s: 0, t: 20 }, { d: 0, i: 2, m: [], s: 0, t: 30 }]
  eq(R.replayBlock(three, 600), { ok: true, score: 0, answers: 3, durationMs: 30 }, 'block 반려 실수 3번 = 0점 해고')
  eq(R.replayBlock(three.concat([{ d: 0, i: 3, m: [], s: 1, t: 40 }]), 600), { ok: false, reason: 'log_after_gameover' }, 'block 해고 뒤 기록 거부')
  eq(R.replayBlock([P[0], { ...P[1], t: 1 }], 600), { ok: false, reason: 'log_not_monotonic' }, 'block 시각 역행 거부')
  eq(R.replayBlock([{ ...P[0], t: 600 * 1000 + 6000 }], 600), { ok: false, reason: 'log_exceeds_ticket' }, 'block 티켓 시간 초과 거부')
  eq(R.replayBlock([], 600).score, 0, 'block 빈 기록 = 0')
  eq(R.replayBlock(P.concat([P[0]]), 600), { ok: false, reason: 'log_malformed' }, 'block 50장 넘는 기록 거부')
}

// ---------- 0e) 막아라 사전 — 번역된 서류의 조각 순서가 한국어와 같은가 ----------
//   기록(LOG)은 화면에 보인 조각의 **자리**로 서버에 가고 서버는 한국어 표로 판정한다. 번역에서 조각 순서가 바뀌면
//   그 언어에서만 정답을 틀렸다고 판정한다 — 화면에는 아무 오류도 안 뜬다.
{
  const src = readFileSync(new URL('../public/games/i18n.js', import.meta.url), 'utf8')
  const m = src.match(/var D = (\{[\s\S]*?\n  \})\r?\n\r?\n  function t\(/)
  const DICT = m ? new Function('return ' + m[1])() : null
  eq(!!DICT, true, 'i18n.js 사전을 읽었다')
  const LANGS = ['ko', 'en', 'ja', 'zh', 'hi', 'vi']
  const kindsOf = (text) => [...text.matchAll(/\{([a-z]+)\|/g)].map((x) => x[1]).join(',')
  const keys = Object.keys(DICT ?? {}).filter((k) => k.startsWith('block.'))
  eq(keys.length > 200, true, `block.* 키 ${keys.length}개`)
  eq(keys.every((k) => LANGS.every((l) => typeof DICT[k][l] === 'string' && DICT[k][l].length > 0)), true, 'block.* 전부 6개국어')
  const m2 = block.match(/const DAYS=(\[[\s\S]*?\n\]);/)
  const HD = new Function('return ' + m2[1])()
  let docs = 0, badOrder = []
  HD.forEach((D, di) => D.docs.forEach((d, i) => {
    docs++
    const key = `block.d${di + 1}.${i + 1}`
    for (const f of ['from', 'ask', 'text']) if (!DICT[`${key}.${f}`]) badOrder.push(`${key}.${f} 없음`)
    const e = DICT[`${key}.text`]; if (!e) return
    if (e.ko !== d.text) badOrder.push(`${key}.text ko ≠ HTML`)
    for (const l of LANGS) if (kindsOf(e[l]) !== kindsOf(d.text)) badOrder.push(`${key}.text ${l} 조각 순서`)
    if (d.stamp && !DICT[`${key}.stamp`]) badOrder.push(`${key}.stamp 없음`)
  }))
  eq(docs, 50, 'block 서류 50장')
  eq(badOrder, [], 'block 서류 번역 — 조각 순서·개수가 한국어와 같다')
  for (const k of ['name', 'pii', 'acct', 'perf', 'cred', 'price', 'health', 'hr', 'src', 'legal']) eq(!!DICT[`block.rule.${k}`] && !!DICT[`block.rule.${k}.desc`], true, `block 규정 ${k} 라벨·설명`)
}

// ---------- 0f) 시켜라 주문·카드 대조 + 재채점 ----------
{
  const m = order.match(/const LEVELS=(\[[\s\S]*?\n\]);/)
  const HL = m ? new Function('return ' + m[1])() : null
  eq(HL?.length, ORDER_LEVELS.length, 'order 주문 수 = 서버')
  ;(HL ?? []).forEach((L, i) => {
    const S = ORDER_LEVELS[i]
    eq(L.goal, S && S.goal, `order 주문 ${i + 1} 도면 = 서버`)
    eq(L.cards.map((c) => ({ set: c.set, bad: c.bad })), S && S.cards.map((c) => ({ set: c.set, bad: c.bad })), `order 주문 ${i + 1} 카드 ${L.cards.length}장 효과 = 서버`)
  })
  eq(lit(order, 'MAX_TRIES', 'order'), ORDER_MAX_TRIES, 'order MAX_TRIES = 서버')
  // KEYS·BASE_SPEC 은 JS 리터럴(작은따옴표·색 상수)이라 JSON 으로 못 읽는다 — 평가해서 본다
  const jsLit = (name) => { const mm = order.match(new RegExp(`const ${name}=([^;]+);`)); return mm ? new Function("const GRAY='#93a0b8';return " + mm[1])() : undefined }
  eq(jsLit('KEYS'), [...ORDER_KEYS], 'order KEYS = 서버')
  eq(jsLit('BASE_SPEC'), ORDER_BASE, 'order BASE_SPEC = 서버')
  eq(/log:\(opts&&Array\.isArray\(opts\.log\)\)\?opts\.log:undefined/.test(order), true, 'order 브리지가 log 를 실어 보낸다')
  eq(/MGBridge\.submit\(cleared,\{timed:true,log:LOG\}\)/.test(order), true, 'order 제출이 log 를 넘긴다')
  // 정답 배치(tests/fixtures/order-sol.json) — 정상 카드만 고르면 통과, 함정 하나만 더해도 실패, 정상 카드 하나를 빼도 실패
  const SOL = JSON.parse(readFileSync(new URL('./fixtures/order-sol.json', import.meta.url), 'utf8'))
  eq(SOL.length, ORDER_LEVELS.length, 'order 정답 수 = 주문 수')
  ORDER_LEVELS.forEach((L, i) => {
    eq(orderMatches(L, SOL[i]), true, `order 주문 ${i + 1} 정답 카드 ${SOL[i].length}장이 서버에서 통과`)
    eq(L.cards.every((c, j) => !c.bad || !orderMatches(L, [...SOL[i], j])), true, `order 주문 ${i + 1} 함정을 더하면 전부 실패`)
    eq(SOL[i].every((j) => !orderMatches(L, SOL[i].filter((x) => x !== j))), true, `order 주문 ${i + 1} 정답 카드를 하나 빼면 실패`)
  })
  eq(buildOrderSpec(ORDER_LEVELS[0], [3]).hand, 'grip', 'order 팔 카드가 손도 정한다')
  eq(buildOrderSpec(ORDER_LEVELS[0], []).hand, 'none', 'order 팔 0 이면 손 none')
  // 재채점 — 전부 1번에 = 20 · 별 60 · tie 0×1e7+시간
  const P = SOL.map((c, o) => ({ o, c, t: (o + 1) * 5000 }))
  eq(R.replayOrder(P, 600), { ok: true, score: 20, answers: 20, durationMs: 100000, tie: 100000 }, 'order 20주문 전부 1번에 = 20 · 별 60')
  const P2 = [{ o: 0, c: [1], t: 1000 }, { o: 0, c: SOL[0], t: 2000 }, { o: 1, c: [3], t: 3000 }, { o: 1, c: [3], t: 4000 }, { o: 1, c: SOL[1], t: 5000 }]
  eq(R.replayOrder(P2, 600), { ok: true, score: 2, answers: 5, durationMs: 5000, tie: (60 - 3) * 1e7 + 5000 }, 'order 2번째·3번째에 맞힘 = 별 2+1')
  const P3 = [{ o: 0, c: [1], t: 1000 }, { o: 0, c: [1], t: 2000 }, { o: 0, c: [1], t: 3000 }]
  eq(R.replayOrder(P3, 600), { ok: true, score: 0, answers: 3, durationMs: 3000, tie: 60 * 1e7 + 3000 }, 'order 3번 실패 = 0')
  eq(R.replayOrder(P3.concat([{ o: 1, c: SOL[1], t: 4000 }]), 600), { ok: false, reason: 'log_after_gameover' }, 'order 판 끝난 뒤 기록 거부')
  eq(R.replayOrder([{ o: 1, c: SOL[1], t: 10 }], 600), { ok: false, reason: 'log_malformed' }, 'order 주문 건너뛰기 거부')
  eq(R.replayOrder([{ o: 0, c: [0, 0], t: 10 }], 600), { ok: false, reason: 'log_malformed' }, 'order 같은 카드 두 번 거부')
  eq(R.replayOrder([{ o: 0, c: [9], t: 10 }], 600), { ok: false, reason: 'log_malformed' }, 'order 없는 카드 자리 거부')
  eq(R.replayOrder([{ o: 0, c: SOL[0], t: 600 * 1000 + 6000 }], 600), { ok: false, reason: 'log_exceeds_ticket' }, 'order 티켓 시간 초과 거부')
  eq(R.replayOrder([], 600).score, 0, 'order 빈 기록 = 0')
  eq([FE.ORDER_MAX_STARS, FE.ORDER_TIE_UNIT], [R.ORDER_MAX_STARS, R.ORDER_TIE_UNIT], 'order 동률값 해석(프론트 minigames.ts) = 서버')
  // 사전 — order.* 6개국어 · 주문 문구 키가 전부 있고 ko 가 HTML 과 같다
  const src = readFileSync(new URL('../public/games/i18n.js', import.meta.url), 'utf8')
  const dm = src.match(/var D = (\{[\s\S]*?\n  \})\r?\n\r?\n  function t\(/)
  const DICT = dm ? new Function('return ' + dm[1])() : {}
  const LANGS = ['ko', 'en', 'ja', 'zh', 'hi', 'vi']
  const okeys = Object.keys(DICT).filter((k) => k.startsWith('order.'))
  eq(okeys.every((k) => LANGS.every((l) => typeof DICT[k][l] === 'string' && DICT[k][l].length > 0)), true, `order.* ${okeys.length}키 전부 6개국어`)
  const missing = []
  ;(HL ?? []).forEach((L, i) => {
    const key = `order.lv${i + 1}`
    for (const f of ['name', 'who', 'say']) if (!DICT[`${key}.${f}`] || DICT[`${key}.${f}`].ko !== L[f]) missing.push(`${key}.${f}`)
    if (L.paint && (!DICT[`${key}.paint`] || DICT[`${key}.paint`].ko !== L.paint)) missing.push(`${key}.paint`)
    L.cards.forEach((c, j) => { if (!DICT[`${key}.c${j + 1}`] || DICT[`${key}.c${j + 1}`].ko !== c.t) missing.push(`${key}.c${j + 1}`) })
  })
  eq(missing, [], 'order 주문 문구 키가 전부 있고 ko = HTML')
}

if (failed) { console.error(`\n${failed} failed`); process.exit(1) }
console.log('\nall ok')
