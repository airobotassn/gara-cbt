// exam-session: 응시 중 "살아있다" 와 "닫혔다" 를 받는다. **채점·자격과 무관한 기록 전용** 함수다.
//
//   ping   — 응시 화면이 주기적으로 보낸다. last_seen_at·answered_count 를 덮어쓴다.
//   closed — 응시 화면이 닫히는 순간 보낸다(창 닫기·SEB 종료). 이벤트로 남긴다.
//
// 왜 필요한가: 우리 시험은 감독관이 없는 자율응시라, 재진입을 무효로 잡되(start-exam)
//   "PC 가 뻗은 사고"는 사람이 풀어줘야 한다. 그 판단 자료가 여기서 쌓인다.
//   ⚠️ `closed` 가 **오지 않은 채** 끊긴 것이 사고의 신호다 — 전원이 나가면 알릴 틈이 없다.
//      반대로 `closed` 가 있으면 사람이 창을 닫은 것이다. (랜선을 뽑으면 위장 가능 — 증거가 아니라 정황이다.)
//   설계 배경은 migrations/20260810140000_exam_session_trace.sql 머리말.
//
// ⚠️ _shared 사용 → CLI 로만 배포할 것. verify_jwt 는 켠 채로.
import { corsHeaders, json } from '../_shared/cors.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { adminClient } from '../_shared/lib.ts'
import { getExamActor } from '../_shared/exam-token.ts'

/** 답한 문항 수는 클라가 보내는 값이라 범위만 자른다. 채점에 쓰이지 않으니 이 정도면 충분하다. */
function clampCount(v: unknown, max: number): number {
  const n = Math.floor(Number(v ?? 0))
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(n, max > 0 ? max : n)
}

/** 하트비트가 실어 보낸 답안을 그 응시의 답안 행에 덮어쓴다. 채점하지 않는다(제출 때만 한다). */
async function saveDraft(admin: SupabaseClient, attemptId: string, answers: unknown): Promise<void> {
  if (!Array.isArray(answers) || answers.length === 0) return
  // 한 번에 최대 200문항 — 그 이상은 클라가 이상한 값을 보낸 것이라 자른다.
  for (const a of answers.slice(0, 200)) {
    const num = Math.floor(Number((a as { number?: unknown })?.number ?? NaN))
    if (!Number.isFinite(num) || num < 1) continue
    const rawSel = (a as { selectedIndex?: unknown })?.selectedIndex
    const selected = rawSel === null || rawSel === undefined ? null : Math.floor(Number(rawSel))
    const text = typeof (a as { answerText?: unknown })?.answerText === 'string'
      ? ((a as { answerText: string }).answerText).slice(0, 2000)
      : null
    await admin
      .from('attempt_answers')
      .update({
        selected_index: Number.isFinite(selected as number) ? selected : null,
        answer_text: text,
      })
      .eq('attempt_id', attemptId)
      .eq('number', num)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const body = await req.json().catch(() => ({}))
    const action = String(body?.action ?? '')
    const attemptId = String(body?.attemptId ?? '').trim()
    if (!attemptId) return json({ error: '잘못된 요청입니다.' }, 400)

    // SEB 안에서는 세션이 없으므로 시험 전용 토큰도 받는다(응시 계열 함수라 허용된다).
    const actor = await getExamActor(req)
    if (!actor) return json({ error: '인증이 필요합니다.' }, 401)

    const admin = adminClient()
    const { data: attempt } = await admin
      .from('exam_attempts')
      .select('id, user_id, status, total_questions')
      .eq('id', attemptId)
      .maybeSingle()
    if (!attempt) return json({ error: '시험을 찾을 수 없습니다.' }, 404)
    // 남의 응시에 기록을 남기지 못하게 — 이 자료가 나중에 복구 판단의 근거가 되므로 오염되면 안 된다.
    if (attempt.user_id !== actor.user.id) return json({ error: '권한이 없습니다.' }, 403)
    // 이미 끝난 응시(제출·무효·만료)에는 아무것도 쌓지 않는다. 늦게 도착한 신호가 기록을 흐리면 안 된다.
    if (attempt.status !== 'in_progress') return json({ ok: true, ignored: attempt.status })

    const answered = clampCount(body?.answered, (attempt.total_questions as number) ?? 0)
    const now = new Date().toISOString()

    if (action === 'ping') {
      // 갱신만 한다(이력 없음). 50분 응시에 하트비트를 행으로 쌓으면 응시당 100행이 된다.
      await admin
        .from('exam_attempts')
        .update({ last_seen_at: now, answered_count: answered })
        .eq('id', attemptId)
        .eq('status', 'in_progress')

      // ⛔ **답안 중간 저장.** 이게 있어야 끊겼다 복구했을 때 풀던 자리에서 이어갈 수 있다
      //    (그리고 그래야 '남은 시간만 복원' 이 말이 된다 — start-exam 의 재개 주석과 한 쌍이다).
      //    행은 응시를 만들 때 문항 수만큼 이미 깔려 있으므로 값만 덮어쓴다.
      // ⚠️ **채점은 하지 않는다.** is_correct 는 건드리지 않고 제출 때만 매긴다 —
      //    중간 저장은 복구용 사본이지 제출이 아니다.
      // ⚠️ 클라가 보낸 값이라 문항 번호는 **이 응시에 실제로 있는 번호만** 반영된다(number 로 매칭).
      await saveDraft(admin, attemptId, body?.answers)
      return json({ ok: true })
    }

    if (action === 'closed') {
      // ⚠️ 여기서 응시를 무효로 만들지 않는다. 창이 닫혔다는 것만으로는 끝난 게 아니다 —
      //    무효 판정은 **다시 들어왔을 때** start-exam 이 한다. 그래야 "닫고 그만둔 사람"과
      //    "닫았다가 돌아와서 마저 푸는 사람"이 구분되고, 잘못 닫은 사람이 바로 죽지 않는다.
      await admin
        .from('exam_attempts')
        .update({ last_seen_at: now, answered_count: answered })
        .eq('id', attemptId)
        .eq('status', 'in_progress')
      await admin.from('exam_session_events').insert({
        attempt_id: attemptId,
        kind: 'closed',
        detail: {
          answered,
          // 무엇이 닫았는지 클라가 알려준 힌트. 'quit'(우리 종료 버튼) · 'unload'(창이 사라짐) 등.
          // ⚠️ 클라가 보내는 값이라 참고용이다. 판단의 축은 "closed 가 있었나 없었나" 다.
          via: String(body?.via ?? 'unload').slice(0, 32),
        },
      })
      return json({ ok: true })
    }

    return json({ error: '알 수 없는 action' }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
