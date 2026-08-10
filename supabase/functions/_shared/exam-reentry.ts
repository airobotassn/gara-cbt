// 재진입 판정 — "시작해놓고 나갔다가 다시 오면 그 응시는 무효" 를 정하는 **단 한 곳**.
//
// 왜 공용인가: 이 판정을 두 곳이 한다.
//   ① seb-handoff(issue)  — 응시 준비 화면에서 SEB 를 **켜기 직전**. 사용자가 실제로 만나는 자리다.
//   ② start-exam          — 시험을 시작하는 자리. 준비 화면을 건너뛰고 옛 링크로 바로 들어온 경우의 최후 방어선.
// 두 벌로 두면 한쪽만 고쳐져서 "준비 화면은 통과했는데 시험 시작에서 무효" 같은 어긋남이 생긴다.
//
// ⚠️ ①이 먼저인 이유 — ②에서만 잡으면 SEB 가 켜지고, 잠긴 화면 안에서 "무효입니다" 를 본 뒤,
//    다시 SEB 를 빠져나와야 한다. 헛걸음인 데다 잠금 브라우저를 왕복시킨다.
//
// 설계 배경(왜 자동으로 봐주지 않는지)은 migrations/20260810140000_exam_session_trace.sql 머리말.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

export interface ReentryBlock {
  error: string
  code: 'reentry_voided'
  attemptId: string
}

/** 응시자에게 그대로 보여지는 문구. 사유와 다음 행동(문의)까지 말해야 한다 — 옆에서 설명해 줄 사람이 없다. */
const MESSAGE =
  '응시 중 시험 화면을 벗어나 응시가 무효 처리되었습니다. 기기·네트워크 문제로 중단된 경우 문의해 주시면 확인 후 재응시를 도와드립니다.'

/**
 * 이 응시권으로 이미 시작해놓고 안 끝낸 응시가 있으면 **무효로 만들고** 막을 내용을 돌려준다.
 * 막을 게 없으면 null (= 그대로 진행).
 *
 * ⚠️ 관리자가 복구해 준 응시(reinstated_at)는 통과시킨다 — 안 그러면 풀어주자마자 다시 무효가 된다.
 *    통과 처리(reinstated_at 비우기)는 실제로 시험에 들어가는 start-exam 이 한다. 여기서 지우면
 *    준비 화면만 열어보고 SEB 를 안 켠 사람의 복구분이 그냥 날아간다.
 * ⚠️ 복구분을 쓴 뒤 **또** 끊기면 다시 무효다(2026-08-10 결정). 코드가 횟수를 세는 게 아니라,
 *    사고가 날 때마다 사람이 다시 판단한다는 뜻이다.
 */
export async function blockOnReentry(
  admin: SupabaseClient,
  userId: string,
  ticketId: string,
  now: number = Date.now(),
): Promise<ReentryBlock | null> {
  const { data: live } = await admin
    .from('exam_attempts')
    .select('id, status, last_seen_at, answered_count, entry_count, reinstated_at')
    .eq('ticket_id', ticketId)
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // 아직 시작한 적 없거나(첫 응시), 이미 끝난 응시(제출·무효)면 여기서 볼 게 없다.
  // ⚠️ 끝난 응시의 '1인 1회' 거절은 start-exam 이 한다 — 그건 재진입이 아니라 다른 규칙이다.
  if (!live || live.status === 'submitted' || live.status === 'voided') return null
  if (live.reinstated_at) return null // 관리자가 풀어준 건 — 들어가게 둔다

  const lastSeen = live.last_seen_at ? new Date(live.last_seen_at as string).getTime() : null
  const entries = (live.entry_count as number) ?? 1

  await admin
    .from('exam_attempts')
    .update({
      status: 'voided',
      void_reason: 'reentry',
      submitted_at: new Date(now).toISOString(),
      entry_count: entries + 1,
    })
    .eq('id', live.id)
    .eq('status', live.status) // 동시 요청이 이미 상태를 바꿨으면 덮어쓰지 않는다

  // 복구 판단에 필요한 정황을 남긴다. 사람이 이걸 보고 풀어줄지 정한다.
  await admin.from('exam_session_events').insert({
    attempt_id: live.id,
    kind: 'reentry',
    detail: {
      // 마지막으로 살아있던 시각과 지금 사이의 공백(초). 사고는 대개 짧고, 찾아보고 온 건 길다.
      gapSec: lastSeen ? Math.max(0, Math.round((now - lastSeen) / 1000)) : null,
      lastSeenAt: live.last_seen_at ?? null,
      // 끊긴 시점의 진행률. "하나도 안 풀고 훑기만 하다 나갔다" 가 여기서 드러난다.
      answered: (live.answered_count as number) ?? 0,
      prevStatus: live.status,
      entryCount: entries + 1,
    },
  })

  return { error: MESSAGE, code: 'reentry_voided', attemptId: live.id as string }
}
