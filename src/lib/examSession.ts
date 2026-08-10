// 응시 중 생존 신호 — "언제 끊겼나 / 사람이 닫았나" 를 서버에 남긴다.
//
// 감독관이 없는 자율응시라, 응시 화면을 벗어났다 돌아오면 서버가 그 응시를 무효로 잡는다(start-exam).
// 그런데 서버 입장에서 **PC 가 뻗은 것과 일부러 나간 것은 똑같이 보인다.** 사람이 문의를 받고
// 풀어주려면 판단할 자료가 있어야 하고, 그 자료를 만드는 게 여기다.
//   · ping   : 살아있는 동안 주기적으로 → 마지막 생존 시각이 남는다(= 언제 끊겼는지)
//   · closed : 화면이 사라지는 순간 → **이 신호가 있으면 사람이 닫은 것**,
//              없이 끊겼으면 알릴 틈이 없었던 것(전원 차단·정지)이다.
// 서버 쪽 설명은 supabase/functions/exam-session/index.ts.
import { callFunction, fnUrl, supabaseAnonKey, isSupabaseConfigured } from './supabase'
import { getExamToken } from './examToken'
import { supabase } from './supabase'

/** 하트비트 간격. 짧을수록 끊긴 시각이 정확해지고 호출이 늘어난다. 30초면 공백 판단에 충분하다. */
export const HEARTBEAT_MS = 30_000

/**
 * 떠나는 순간 쓸 인증 헤더를 **미리** 만들어 둔다.
 *
 * ⚠️ 이게 이 파일의 핵심이다. `supabase.auth.getSession()` 은 비동기라, 창이 닫히는 순간에 부르면
 *    토큰을 받기 전에 문서가 사라져 요청이 아예 안 나간다(= 자진 종료가 '신호 없음'으로 기록돼
 *    사고와 구분이 안 된다). 그래서 응시 시작 때 한 번 만들어 들고 있다가 그대로 쓴다.
 */
let closingHeaders: Record<string, string> | null = null

export async function primeExamSession(): Promise<void> {
  if (!isSupabaseConfigured) return
  const { data } = await supabase.auth.getSession()
  const token = getExamToken()
  closingHeaders = {
    'Content-Type': 'application/json',
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${data.session?.access_token ?? supabaseAnonKey}`,
    ...(token ? { 'x-exam-token': token } : {}),
  }
}

function examHeaders(): Record<string, string> | undefined {
  const t = getExamToken()
  return t ? { 'x-exam-token': t } : undefined
}

/** 살아있다는 신호. 실패해도 조용히 넘긴다 — 하트비트가 응시를 방해하면 안 된다(다음 주기에 다시 보낸다). */
export function sendPing(attemptId: string, answered: number): void {
  void callFunction('exam-session', { action: 'ping', attemptId, answered }, examHeaders()).catch(() => {})
}

/**
 * 화면이 사라지는 순간 보내는 마지막 신호. **동기적으로** 요청을 띄운다.
 *
 * ⚠️ `keepalive` 가 필수다 — 없으면 문서가 사라질 때 요청이 취소된다.
 *    (`sendBeacon` 은 커스텀 헤더를 못 실어서 못 쓴다 — 우리는 Authorization·x-exam-token 이 필요하다.)
 * ⚠️ 그래도 **보장은 없다.** SEB 가 프로세스를 즉시 죽이거나 전원이 나가면 못 나간다.
 *    그게 정상이고, 오히려 그 '신호 없음' 이 사고를 가리키는 단서가 된다.
 */
export function sendClosed(attemptId: string, answered: number, via: string): void {
  if (!closingHeaders) return
  try {
    void fetch(fnUrl('exam-session'), {
      method: 'POST',
      headers: closingHeaders,
      body: JSON.stringify({ action: 'closed', attemptId, answered, via }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* 못 보내도 그만 — 신호 없음 자체가 정보다 */
  }
}
