// get-exam-result: 본인 응시 결과 재조회.
//   - 미제출: 409
//   - 공개일(result_release_at) 전: { released:false, ... } (점수/오답 비노출)
//   - 공개일 이후: { released:true, totalCorrect, ..., answers:[...] }
//   ⚠️ _shared 사용 → CLI 로만 배포할 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { attemptId } = await req.json()
    if (!attemptId) return json({ error: '잘못된 요청입니다.' }, 400)

    const user = await getUser(req)
    if (!user) return json({ error: '인증이 필요합니다.' }, 401)

    const admin = adminClient()

    const { data: attempt } = await admin
      .from('exam_attempts')
      .select('id, user_id, status, submitted_at, result_release_at, total_correct, total_questions')
      .eq('id', attemptId)
      .single()
    if (!attempt) return json({ error: '결과를 찾을 수 없습니다.' }, 404)
    if (attempt.user_id !== user.id) return json({ error: '권한이 없습니다.' }, 403)

    if (attempt.status !== 'submitted') {
      return json({ error: '아직 제출되지 않은 시험입니다.' }, 409)
    }

    // 공개일 전 — 점수/오답 비노출
    const releaseAt = attempt.result_release_at
      ? new Date(attempt.result_release_at).getTime()
      : 0
    if (Date.now() < releaseAt) {
      return json({
        released: false,
        submittedAt: attempt.submitted_at,
        resultReleaseAt: attempt.result_release_at,
        totalQuestions: attempt.total_questions,
      })
    }

    // 공개 — 문항별 정오답(문항 조인)
    const { data: rows } = await admin
      .from('attempt_answers')
      .select('number, selected_index, is_correct, questions(subject, topic, prompt, options, correct_index)')
      .eq('attempt_id', attemptId)
      .order('number', { ascending: true })

    const answers = (rows ?? []).map((r: any) => ({
      number: r.number,
      subject: r.questions?.subject ?? null,
      topic: r.questions?.topic ?? null,
      prompt: r.questions?.prompt ?? '',
      options: r.questions?.options ?? [],
      selectedIndex: r.selected_index,
      correctIndex: r.questions?.correct_index ?? -1,
      isCorrect: r.is_correct,
    }))

    return json({
      released: true,
      submittedAt: attempt.submitted_at,
      totalCorrect: attempt.total_correct,
      totalQuestions: attempt.total_questions,
      answers,
    })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
