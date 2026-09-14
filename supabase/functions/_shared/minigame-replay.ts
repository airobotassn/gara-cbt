// 미니게임 답안 기록 재채점 — 버텨라·쏴라·골라라·닿아라·프로그램해라. 2026-09-11 / 09-14.
//
// 이 게임들은 점수를 믿지 않는다. 게임은 "어느 문항에 뭘 골랐고 시작 후 몇 ms 였나" 기록을 보내고, 서버가
// 게임과 **같은 공식**으로 점수를 다시 센다. 그래서 콘솔에서 점수 변수를 바꾸거나 submit(9999) 를 부르는
// 조작은 무효이고, 옛 5,000·초당 상한 같은 임의 숫자도 없다("상한 막 두지 말자" 지시). 최대치는
// "실제로 맞힌 개수 × 공식" 으로 저절로 정해진다.
//
// 못 막는 것: 소스를 읽고 정답만 골라 넣은 가짜 기록. 정답이 클라에 있어서(term-pool 이 그대로 내려준다)
//   기록의 '맞았다' 는 클라 주장이다. 그것까지 막으려면 정답을 안 내려보내야 하는데 그러면 틀렸을 때
//   정답을 보여주는 연출이 없어진다 — 안 한다. 죽는 규칙(천장·하트)도 서버가 안 본다.
//
// ⛔ 아래 숫자는 게임 HTML 의 "공용 규칙" 블록과 **sync pair** 다 — tests/minigame-replay.mjs 가 네 파일에서
//    긁어 대조한다. 게임의 점수 공식을 바꾸면 여기도 같이 바꿔야 한다. 안 바꾸면 게임이 보여준 점수와 랭킹이 갈린다.
//    버텨라·쏴라의 레벨·속도는 점수와 무관하라 여기 없다(레벨은 난이도만 정한다). 골라라만 레벨이 **답할 시간**을
//    정하므로 라운드 간격 검사에 레벨 사다리가 필요하다(아래 PICK).

import { REACH_LEVELS, reachedWith } from './reach-levels.ts'
import { PROG_LEVELS, validProgram, runProgram, countOps as progCountOps, type Ins } from './program-levels.ts'

export type ReplayKind = 'beat' | 'shoot' | 'pick' | 'reach' | 'program'

/** 공용 점수 규칙 — 정답 1개 = SCORE_BASE × 연속 배수. 틀리면 0점, 연속 끊김. */
export const SCORE_BASE = 10
export const STREAK_MULT: ReadonlyArray<readonly [number, number]> = [[20, 3], [10, 2], [5, 1.5]] // [n연속부터, 배수] — 큰 것부터
/** 쏴라만: 한 번 틀리고 다시 맞히면 이 점수(배수 없음, 연속에도 안 넣는다). */
export const RETRY_POINT = 5
/** 쏴라: 기체당 허용 오답 — 초과하면 기체가 터지고 그 기체는 더 못 맞힌다. */
export const MAX_WRONG = 2

/** 답과 답 사이 최소 간격(ms) — 게임이 다음 답을 받기까지 걸리는 시간. 이보다 촘촘한 기록은 사람이 아니다. */
export const BEAT_REVEAL_MS = 230   // beat-cari REVEAL_MS
export const SHOOT_ANSWER_LOCK_MS = 340 // shoot-cari ANSWER_LOCK_MS

export function streakMult(n: number): number {
  for (const [k, m] of STREAK_MULT) if (n >= k) return m
  return 1
}

/** 골라라 — 점수는 없고 도달 라운드가 기록이다. 라운드마다 답할 시간 = T0 ÷ 배수(레벨 사다리는 세 게임 공용). */
export const PICK = {
  T0: 10,          // L1 답할 시간(초)
  LEVEL_STEP: 10,  // 정답 10개마다 레벨업
  LEVEL_MAX: 7,
  SPEED_STEP: 0.3, // 레벨당 +0.3배
}
export function pickLevelFor(correct: number): number { return Math.min(PICK.LEVEL_MAX, 1 + Math.floor(correct / PICK.LEVEL_STEP)) }
export function pickRoundMs(level: number): number { return (PICK.T0 / (1 + (level - 1) * PICK.SPEED_STEP)) * 1000 }

/** 버텨라 한 답. k = 고른 보기의 **원본 자리**(0 = 정답, 1~3 = 오답). t = 판 시작 후 ms. */
export interface BeatEntry { q: string; k: number; t: number }
/** 쏴라 한 사건. m = 기체 순번. 답이면 q·k, 방어선 돌파면 x:1(연속 끊김). */
export interface ShootEntry { m: number; q?: string; k?: number; x?: 1; t: number }
/** 골라라 한 라운드. k = 보여준 용어의 원본 자리(0 = 정답 용어 → 답은 O, 1~3 = 오답 용어 → 답은 X). c = 내가 고른 것('' = 안 고름). */
export interface PickEntry { q: string; k: number; c: 'O' | 'X' | ''; t: number }
/** 닿아라 한 레벨 클리어. lv = 레벨 번호(0부터), a = 최종 관절 각도, s/t = 레벨 시작·클리어 시각(판 시작 후 ms). */
export interface ReachEntry { lv: number; a: number[]; s: number; t: number }
/** 프로그램해라 한 레벨 클리어. lv = 레벨 번호(0부터), prog = 성공한 프로그램(블록 트리), runs = 그 레벨에서 쓴 실행 횟수. */
export interface ProgEntry { lv: number; prog: Ins[]; runs: number }

/** setTimeout 은 일찍 안 울리지만 performance.now() 반올림 여유로 30ms 는 봐준다. */
const GAP_TOLERANCE_MS = 30
/** 기록의 마지막 시각이 티켓 나이를 이만큼 넘으면 거부(네트워크·시계 오차 여유). */
const AGE_SLACK_MS = 5_000

/** tie = 레벨형 동률 해소값(작을수록 위). 없으면 durationMs 를 쓴다. 프로그램해라는 명령수합×1000 + 실행횟수합. */
export interface ReplayResult { ok: true; score: number; answers: number; durationMs: number; tie?: number }
export interface ReplayFail { ok: false; reason: string }

function num(v: unknown): v is number { return typeof v === 'number' && isFinite(v) }

/** 공통 형식 검사 — t 단조증가 · 답 사이 간격 ≥ 게임 최소 간격 · 티켓 시간 안 · 문항이 은행에 있는가. */
function checkTiming(
  log: Array<{ q?: unknown; k?: unknown; t?: unknown }>, minGapMs: number, ageSec: number, knownIds: Set<string>,
): ReplayFail | null {
  let prevT = -Infinity, prevAnswerT = -Infinity
  for (const e of log) {
    if (!e || typeof e !== 'object' || !num(e.t) || e.t < 0) return { ok: false, reason: 'log_malformed' }
    if (e.t < prevT) return { ok: false, reason: 'log_not_monotonic' }
    prevT = e.t
    if (e.k !== undefined) {
      if (!num(e.k) || e.k < 0 || e.k > 3 || typeof e.q !== 'string') return { ok: false, reason: 'log_malformed' }
      if (!knownIds.has(e.q)) return { ok: false, reason: 'log_unknown_question' }
      if (e.t - prevAnswerT < minGapMs - GAP_TOLERANCE_MS) return { ok: false, reason: 'log_too_fast' }
      prevAnswerT = e.t
    }
  }
  if (prevT > ageSec * 1000 + AGE_SLACK_MS) return { ok: false, reason: 'log_exceeds_ticket' }
  return null
}

/** 기록에 나온 문항 id 전부 — 호출부가 이걸로 은행을 조회해 knownIds 를 만든다. */
export function logQuestionIds(log: unknown): string[] {
  if (!Array.isArray(log)) return []
  const ids = new Set<string>()
  for (const e of log) if (e && typeof e === 'object' && typeof e.q === 'string') ids.add(e.q)
  return [...ids]
}

/** 버텨라 — `answer()` 의 점수 갈래 그대로. */
export function replayBeat(log: unknown, ageSec: number, knownIds: Set<string>): ReplayResult | ReplayFail {
  if (!Array.isArray(log)) return { ok: false, reason: 'log_missing' }
  const bad = checkTiming(log, BEAT_REVEAL_MS, ageSec, knownIds)
  if (bad) return bad
  let score = 0, streak = 0, answers = 0, last = 0
  for (const e of log as BeatEntry[]) {
    answers++; last = e.t
    if (e.k === 0) { streak++; score += SCORE_BASE * streakMult(streak) }
    else streak = 0
  }
  return { ok: true, score, answers, durationMs: last }
}

/** 쏴라 — `destroy(byPlayer)`·`miss()`·`land()` 의 점수 갈래 그대로. */
export function replayShoot(log: unknown, ageSec: number, knownIds: Set<string>): ReplayResult | ReplayFail {
  if (!Array.isArray(log)) return { ok: false, reason: 'log_missing' }
  for (const e of log) if (!e || typeof e !== 'object' || !num(e.m)) return { ok: false, reason: 'log_malformed' }
  const bad = checkTiming(log, SHOOT_ANSWER_LOCK_MS, ageSec, knownIds)
  if (bad) return bad
  let score = 0, combo = 0, answers = 0, last = 0
  const misses = new Map<number, number>()
  const gone = new Set<number>() // 격추됐거나 터졌거나 방어선을 넘은 기체 — 그 뒤 답은 게임이 받지 않으니 여기서도 무시
  for (const e of log as ShootEntry[]) {
    last = e.t
    if (e.x) { combo = 0; gone.add(e.m); continue } // 방어선 돌파: 연속 끊김(하트는 서버가 안 본다)
    if (e.k === undefined || gone.has(e.m)) continue
    answers++
    const w = misses.get(e.m) ?? 0
    if (e.k === 0) {
      if (w === 0) { combo++; score += SCORE_BASE * streakMult(combo) }
      else score += RETRY_POINT
      gone.add(e.m)
    } else {
      misses.set(e.m, w + 1)
      combo = 0
      if (w + 1 >= MAX_WRONG) gone.add(e.m) // 시도 초과 → 기체가 터진다(점수 없음)
    }
  }
  return { ok: true, score, answers, durationMs: last }
}

/** 골라라 — 라운드 수를 센다. 첫 오답(안 고름 포함)에서 끝나고 그 라운드까지가 기록이다.
 *  라운드 간격은 **그 라운드의 답할 시간** 이상이어야 한다(타이머가 다 돌아야 판정이 나므로 더 짧을 수 없다). */
export function replayPick(log: unknown, ageSec: number, knownIds: Set<string>): ReplayResult | ReplayFail {
  if (!Array.isArray(log)) return { ok: false, reason: 'log_missing' }
  let prevT = -Infinity, correct = 0, rounds = 0, last = 0, ended = false
  for (const e of log as PickEntry[]) {
    if (!e || typeof e !== 'object' || !num(e.t) || e.t < 0 || !num(e.k) || e.k < 0 || e.k > 3 || typeof e.q !== 'string')
      return { ok: false, reason: 'log_malformed' }
    if (e.c !== 'O' && e.c !== 'X' && e.c !== '') return { ok: false, reason: 'log_malformed' }
    if (!knownIds.has(e.q)) return { ok: false, reason: 'log_unknown_question' }
    if (e.t < prevT) return { ok: false, reason: 'log_not_monotonic' }
    if (prevT > -Infinity && e.t - prevT < pickRoundMs(pickLevelFor(correct)) - GAP_TOLERANCE_MS) return { ok: false, reason: 'log_too_fast' }
    prevT = e.t; last = e.t
    if (ended) continue // 끝난 뒤의 라운드는 게임이 만들 수 없다 — 세지 않는다
    rounds++
    const right = (e.k === 0) === (e.c === 'O')
    if (right) correct++
    else ended = true
  }
  if (last > ageSec * 1000 + AGE_SLACK_MS) return { ok: false, reason: 'log_exceeds_ticket' }
  return { ok: true, score: rounds, answers: rounds, durationMs: last }
}

/** 닿아라 — 깬 레벨 수를 센다. 레벨은 1부터 순서대로여야 하고, 각 레벨은 (a) 그 각도로 정말 닿았고 (b) 제한시간 안이어야 한다.
 *  문항 은행이 없으니 knownIds 는 안 쓴다. 최소 시간은 없다(빨리 맞추는 게 실력이다) — 위조는 각도 검증이 막는다. */
export function replayReach(log: unknown, ageSec: number): ReplayResult | ReplayFail {
  if (!Array.isArray(log)) return { ok: false, reason: 'log_missing' }
  if (log.length > REACH_LEVELS.length) return { ok: false, reason: 'log_malformed' }
  let prevT = 0, last = 0
  for (let i = 0; i < log.length; i++) {
    const e = log[i] as ReachEntry
    if (!e || typeof e !== 'object' || e.lv !== i || !Array.isArray(e.a) || !e.a.every(num) || !num(e.s) || !num(e.t))
      return { ok: false, reason: 'log_malformed' }
    const L = REACH_LEVELS[i]
    if (e.s < prevT - GAP_TOLERANCE_MS || e.t < e.s) return { ok: false, reason: 'log_not_monotonic' }
    if (e.t - e.s > L.time * 1000 + 1500) return { ok: false, reason: 'log_over_time' } // 타이머(0.1초 틱)+연출 여유
    if (!reachedWith(L, e.a)) return { ok: false, reason: 'log_not_reached' }
    prevT = e.t; last = e.t
  }
  if (last > ageSec * 1000 + AGE_SLACK_MS) return { ok: false, reason: 'log_exceeds_ticket' }
  return { ok: true, score: log.length, answers: log.length, durationMs: last }
}

/** 프로그램해라 — 깬 레벨 수를 센다. 레벨은 1부터 순서대로, 각 레벨의 프로그램은 (a) 그 레벨이 허용하는 모양이고 (b) 서버 VM 으로 실행해 성공해야 한다.
 *  동률 해소 = 명령 수 합(적을수록) → 실행 횟수 합(적을수록) — 한 숫자로 접는다(명령수합×1000 + 실행횟수합). 시간은 안 본다(생각하는 게임). */
export function replayProgram(log: unknown, ageSec: number): ReplayResult | ReplayFail {
  if (!Array.isArray(log)) return { ok: false, reason: 'log_missing' }
  if (log.length > PROG_LEVELS.length) return { ok: false, reason: 'log_malformed' }
  let cmds = 0, runs = 0
  for (let i = 0; i < log.length; i++) {
    const e = log[i] as ProgEntry
    if (!e || typeof e !== 'object' || e.lv !== i || !num(e.runs) || e.runs < 1 || !Number.isInteger(e.runs)) return { ok: false, reason: 'log_malformed' }
    const L = PROG_LEVELS[i]
    if (e.runs > L.runs) return { ok: false, reason: 'log_too_many_runs' }
    if (!validProgram(L, e.prog)) return { ok: false, reason: 'log_bad_program' }
    if (!runProgram(L, e.prog).win) return { ok: false, reason: 'log_not_solved' }
    cmds += progCountOps(e.prog); runs += e.runs
  }
  void ageSec
  return { ok: true, score: log.length, answers: log.length, durationMs: 0, tie: cmds * 1000 + Math.min(runs, 999) }
}

export function replay(kind: ReplayKind, log: unknown, ageSec: number, knownIds: Set<string>): ReplayResult | ReplayFail {
  if (kind === 'beat') return replayBeat(log, ageSec, knownIds)
  if (kind === 'shoot') return replayShoot(log, ageSec, knownIds)
  if (kind === 'pick') return replayPick(log, ageSec, knownIds)
  if (kind === 'reach') return replayReach(log, ageSec)
  return replayProgram(log, ageSec)
}
