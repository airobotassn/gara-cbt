// submit-exam: 소유/상태/TTL 검증 → (voided 면 무효 기록) → 서버 채점 → 제출 확정
//   결과 공개 시각 = 제출 +7일. ⚠️ 점수는 반환하지 않는다(공개일 이후 get-exam-result 로만).
//   ⚠️ _shared 사용 → CLI 로만 배포할 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'
import { sebCheckFailed } from '../_shared/seb.ts'

// 응시 TTL(분) — submit-test(120분)보다 여유. 만료 시 제출 거부.
const ATTEMPT_TTL_MINUTES = 240
// 결과(점수/오답) 공개까지 대기(일) — 시크릿 RESULT_RELEASE_DAYS 로 조정(테스트 0=즉시 공개)
const RESULT_RELEASE_DAYS = Number(Deno.env.get('RESULT_RELEASE_DAYS') ?? 7)

interface InAnswer {
  questionId: string
  selectedIndex: number | null
  answerText?: string | null
  timeSpent?: number
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const sebErr = await sebCheckFailed(req)
    if (sebErr) return json({ error: sebErr }, 403)
    const { attemptId, answers, voided } = await req.json()
    if (!attemptId || (!voided && !Array.isArray(answers))) {
      return json({ error: '잘못된 요청입니다.' }, 400)
    }

    const user = await getUser(req)
    if (!user) return json({ error: '인증이 필요합니다.' }, 401)

    const admin = adminClient()

    const { data: attempt } = await admin
      .from('exam_attempts')
      .select('*')
      .eq('id', attemptId)
      .single()
    if (!attempt) return json({ error: '시험을 찾을 수 없습니다.' }, 404)
    if (attempt.user_id !== user.id) return json({ error: '권한이 없습니다.' }, 403)
    if (attempt.status !== 'in_progress') {
      return json({ error: '이미 종료된 시험입니다.' }, 409)
    }
    const ageMin = (Date.now() - new Date(attempt.started_at).getTime()) / 60000
    if (ageMin > ATTEMPT_TTL_MINUTES) {
      await admin.from('exam_attempts').update({ status: 'expired' }).eq('id', attemptId)
      return json({ error: '시험 제한시간이 만료되었습니다.' }, 410)
    }

    const submittedAt = new Date().toISOString()

    // 부정행위 등으로 무효 처리 — 채점 없이 voided 기록
    if (voided) {
      await admin
        .from('exam_attempts')
        .update({
          status: 'voided',
          submitted_at: submittedAt,
        })
        .eq('id', attemptId)
      return json({ ok: true, voided: true, submittedAt })
    }

    // 출제된(고정된) 문항 + 정답/유형
    const { data: assigned } = await admin
      .from('attempt_answers')
      .select('id, question_id, questions(kind, correct_index)')
      .eq('attempt_id', attemptId)
    if (!assigned || assigned.length === 0) {
      return json({ error: '채점할 문항이 없습니다.' }, 400)
    }

    const submittedMap = new Map<string, InAnswer>()
    for (const a of answers as InAnswer[]) submittedMap.set(a.questionId, a)

    // 서버 채점: 출제된 각 문항만(클라가 보낸 임의 문항은 무시)
    //  · 객관식: 정답 비교 자동채점(review_status=auto)
    //  · 주관식: 답안 텍스트만 저장, 채점 보류(is_correct=null, review_status=pending) → 관리자 검수
    let totalCorrect = 0
    for (const row of assigned as any[]) {
      const sub = submittedMap.get(row.question_id)
      const kind = row.questions?.kind ?? 'mc'
      const timeSpent = Math.max(0, Math.floor(sub?.timeSpent ?? 0))
      if (kind === 'short') {
        await admin
          .from('attempt_answers')
          .update({
            answer_text: sub?.answerText ?? null,
            selected_index: null,
            is_correct: null,
            review_status: 'pending',
            time_spent: timeSpent,
          })
          .eq('id', row.id)
        continue
      }
      const selected = sub?.selectedIndex ?? null
      const correctIndex = row.questions?.correct_index ?? -1
      const isCorrect = selected !== null && selected === correctIndex
      if (isCorrect) totalCorrect += 1
      await admin
        .from('attempt_answers')
        .update({
          selected_index: selected,
          is_correct: isCorrect,
          review_status: 'auto',
          time_spent: timeSpent,
        })
        .eq('id', row.id)
    }

    // 결과 공개 = 제출 +N일 되는 날의 오전 10시(KST) 정각. N<=0 이면 즉시(테스트 스위치 유지).
    const resultReleaseAt = (() => {
      if (RESULT_RELEASE_DAYS <= 0) return new Date().toISOString()
      const kst = new Date(Date.now() + RESULT_RELEASE_DAYS * 864e5 + 9 * 3600e3)
      // 01:00 UTC = 10:00 KST
      return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), 1, 0, 0)).toISOString()
    })()

    await admin
      .from('exam_attempts')
      .update({
        status: 'submitted',
        submitted_at: submittedAt,
        result_release_at: resultReleaseAt,
        total_correct: totalCorrect,
      })
      .eq('id', attemptId)

    // ⚠️ 점수 비노출 — 공개 시각만 안내
    return json({ ok: true, submittedAt, resultReleaseAt })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
