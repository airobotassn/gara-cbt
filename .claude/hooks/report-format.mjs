#!/usr/bin/env node
/**
 * Stop 훅 — 파일을 고친 턴인데 보고 틀을 안 쓰면 걷어찬다.
 *
 * 왜 훅인가: 같은 규칙을 CLAUDE.md 에 적어뒀더니 대화가 길어질수록 무시됐다.
 * 규칙은 부탁이고 훅은 강제다.
 *
 * 발동 조건 3개 (하나라도 아니면 조용히 통과):
 *   1. 이번 턴에 Edit/Write/NotebookEdit 이 실제로 있었나
 *   2. 마지막 답변에 머리표(HEADER)가 없나
 *   3. 이미 한 번 걷어찬 턴이 아닌가 (stop_hook_active — 무한루프 방지)
 *
 * 못 하는 것: 틀 '안'의 내용이 좋은지는 못 본다(머리표만 보고 통과시킨다).
 * 틀을 통째로 빼먹는 것만 막는 장치다.
 */
import fs from 'node:fs'

const HEADER = '■ 뭐가 달라졌나'
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

const REASON = `작업으로 파일을 고쳤는데 보고 틀을 안 썼다. 아래 3칸으로 다시 쓰고 끝내라.
(설명을 덧붙이지 말고 이 틀만 출력할 것. 칸 밖의 말은 붙이지 않는다.)

■ 뭐가 달라졌나
  · <사용자가 겪는 단위> — <전 → 후>
■ 직접 확인
  <사용자가 손으로 해볼 수 있는 것 1~2개>
■ 못 한 것
  <없으면 "없음">

규칙:
- 기준은 코드가 아니라 사용자가 겪는 것. 파일명·함수명·줄번호를 이 틀 안에 쓰지 마라.
  · 화면 작업 → "결과 화면 — 로그인하면 6축 레이더가 이제 나옴 (전엔 빈칸)"
  · 화면 안 변하는 백엔드 → "이제 뭐가 되고 뭐가 안 되나" 로 쓴다.
    "코인 선물 — 동시에 눌러도 한 번만 나감. 화면은 그대로."
  · 화면도 동작도 안 변하면(리팩터링·주석) 그렇게 쓴다: "겉으로 달라지는 건 없음."
- "직접 확인" 은 사용자가 실제로 할 수 있는 것만. 화면이면 URL, 백엔드면 명령어.
  확인할 방법이 없으면 내가 뭘 확인했는지를 쓴다: "테스트로 확인함 (48건 통과)".
- 전체 10줄을 넘기지 마라. 넘으면 항목을 빼지 말고 문장을 줄여라.
- 코드를 어디서 어떻게 고쳤는지는 물어보면 설명한다. 먼저 풀지 마라.`

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8'))
  } catch {
    return null
  }
}

/** 이번 턴 = 직전 턴 종료 표시(turn_duration) 이후. 없으면 마지막 진짜 사용자 발화 이후. */
function currentTurn(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e.type === 'system' && e.subtype === 'turn_duration') return entries.slice(i + 1)
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e.type !== 'user' || e.isMeta) continue
    const c = e.message?.content
    // tool_result 는 user 타입으로 들어오지만 사용자 발화가 아니다
    if (Array.isArray(c) && c.some((b) => b.type === 'tool_result')) continue
    return entries.slice(i + 1)
  }
  return entries
}

function blocks(entry) {
  const c = entry.message?.content
  return Array.isArray(c) ? c : []
}

const input = readInput()
const pass = () => process.exit(0)

// (3) 이미 걷어찬 턴이면 또 막지 않는다
if (!input || input.stop_hook_active) pass()

let entries
try {
  entries = fs
    .readFileSync(input.transcript_path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l)
      } catch {
        return null
      }
    })
    .filter(Boolean)
} catch {
  pass() // 트랜스크립트를 못 읽으면 방해하지 않는다
}

const turn = currentTurn(entries)

// (1) 파일을 실제로 고쳤나
const edited = turn.some(
  (e) => e.type === 'assistant' && blocks(e).some((b) => b.type === 'tool_use' && EDIT_TOOLS.has(b.name)),
)
if (!edited) pass()

// (2) 마지막 답변에 머리표가 있나
const lastText = [...turn]
  .reverse()
  .filter((e) => e.type === 'assistant' && !e.isSidechain)
  .flatMap(blocks)
  .filter((b) => b.type === 'text')
  .map((b) => b.text)
  .join('\n')
if (lastText.includes(HEADER)) pass()

process.stdout.write(JSON.stringify({ decision: 'block', reason: REASON }))
process.exit(0)
