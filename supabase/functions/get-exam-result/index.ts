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
      .select('id, user_id, status, submitted_at, result_release_at, total_correct, total_questions, exam_id')
      .eq('id', attemptId)
      .single()
    if (!attempt) return json({ error: '결과를 찾을 수 없습니다.' }, 404)
    if (attempt.user_id !== user.id) return json({ error: '권한이 없습니다.' }, 403)

    // 응시한 시험(=자격/티어) 제목 — 결과화면 자격 라벨·인증서 발급에 사용.
    let examTitle: string | null = null
    if (attempt.exam_id) {
      const { data: exam } = await admin.from('exams').select('title').eq('id', attempt.exam_id).maybeSingle()
      examTitle = (exam as { title?: string } | null)?.title ?? null
    }

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
        examTitle,
      })
    }

    // 공개 — 문항별 정오답(문항 조인). 주관식은 유형·응답 텍스트·검수상태 포함(보기/정답번호는 없음).
    // ⚠️ 해설(explanation)은 결과 화면에도 내리지 않는다 — 관리자 전용(요구사항: 어떤 경우에도 해설 미노출).
    const { data: rows } = await admin
      .from('attempt_answers')
      .select('number, selected_index, answer_text, is_correct, review_status, questions(subject, topic, prompt, kind, choices, correct_index)')
      .eq('attempt_id', attemptId)
      .order('number', { ascending: true })

    const answers = (rows ?? []).map((r: any) => ({
      number: r.number,
      subject: r.questions?.subject ?? null,
      topic: r.questions?.topic ?? null,
      prompt: r.questions?.prompt ?? '',
      kind: r.questions?.kind ?? 'mc',
      choices: r.questions?.choices ?? [],
      selectedIndex: r.selected_index,
      answerText: r.answer_text ?? null,
      correctIndex: r.questions?.correct_index ?? -1,
      isCorrect: r.is_correct,
      reviewStatus: r.review_status ?? 'auto',
    }))

    return json({
      released: true,
      submittedAt: attempt.submitted_at,
      totalCorrect: attempt.total_correct,
      totalQuestions: attempt.total_questions,
      answers,
      examTitle,
    })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
