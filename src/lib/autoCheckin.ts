/**
 * 자동 출석 — 사이트에 들어오면(로그인 상태가 확정되면) 출석이 스스로 찍힌다.
 *
 * 옛 방식은 `/hub` 오른쪽 레일의 '출석' 버튼을 사람이 누르는 것이었다. 그 버튼은 제거됐다(2026-08-24).
 * 부르는 자리는 `App.tsx` 의 `SiteBoot` 하나 — **어느 페이지로 들어와도** 찍히게 하려고 전역에 뒀다
 * (랜딩만 걸면 북마크로 `/hub`·`/arena` 로 직행한 날은 출석이 통째로 빠진다).
 *
 * ⚠️ **하루 1회 판정은 여기가 아니라 서버가 한다** — `daily_activity.did_attendance` 플래그 +
 *    `complete_daily_kind` 가 한 트랜잭션에서 막는다. 그래서 이 모듈이 몇 번을 부르든 이중 적립이 없고,
 *    아래 localStorage 가드는 **불필요한 호출을 줄이는 것**일 뿐 판정이 아니다. 값이 비어 있거나
 *    지워져도 서버를 한 번 더 부르는 게 전부라 손해가 없다(캐릭터·튜토리얼 플래그를 localStorage 로
 *    판정하면 안 되는 것과는 성질이 다르다 — 그건 틀리면 화면이 거짓말을 한다).
 * ⚠️ **아무것도 띄우지 않는다(2026-08-24 결정).** 매일 뜨는 토스트는 금방 잡음이 된다 — 결과는
 *    `/hub` 스탬프판에서 본다. 그래서 이 모듈은 UI 를 모르고, 실패도 조용히 넘긴다.
 * ⚠️ **가드 키에 uid 를 같이 담는다.** 날짜만 담으면 한 브라우저에서 계정을 바꿔 쓸 때 앞사람이
 *    찍은 날짜 때문에 뒷사람의 그날 출석이 통째로 건너뛰어진다(`gara_seen_day` 는 통계라 그래도
 *    되지만 이건 보상이다).
 */
import { callFunction } from './supabase'

const KEY = 'gara_checkin_day'

/** KST 기준 오늘(YYYY-MM-DD). 서버 `kstDay()` 와 같은 경계를 봐야 가드가 하루 일찍/늦게 풀리지 않는다. */
const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)

// 세션당 1회로 접는다 — 전역 훅과 허브가 같이 불러도 요청은 하나다.
let inflight: { uid: string; p: Promise<boolean> } | null = null

/**
 * 오늘 출석을 확정한다.
 * @returns 서버를 실제로 불러 성공했는가 = **화면을 다시 받아야 하는가**.
 *          (오늘 이미 찍어서 건너뛴 경우와 실패한 경우는 false — 다시 받을 이유가 없다.)
 */
export function ensureCheckedIn(uid: string): Promise<boolean> {
  if (inflight && inflight.uid === uid) return inflight.p
  const p = run(uid)
  inflight = { uid, p }
  return p
}

async function run(uid: string): Promise<boolean> {
  const stamp = `${uid}|${kstDay()}`
  try {
    if (localStorage.getItem(KEY) === stamp) return false
  } catch { /* 사이트 데이터가 막힌 브라우저 — 가드 없이 그냥 부른다 */ }
  try {
    // kind 를 명시한다 — 서버 기본값에 기대지 않는다(DAILY QUIZ 와 종류가 갈린다).
    await callFunction('complete-daily', { kind: 'attendance' })
    try { localStorage.setItem(KEY, stamp) } catch { /* 못 적어도 다음 진입에서 한 번 더 부를 뿐 */ }
    return true
  } catch {
    // 실패는 삼킨다. 대신 기억을 지워 **다음 진입에서 다시 시도**하게 둔다.
    inflight = null
    return false
  }
}
