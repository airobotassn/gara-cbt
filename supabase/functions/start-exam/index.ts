// start-exam: 비익명(본인 인증) 유저만 → 시험(slug) 조회 → 기존 in_progress 만료 →
//   active 문항 전부(number 순) 출제(정답 제외) → exam_attempt 생성 + attempt_answers 고정
//   ⚠️ _shared 사용 → CLI 로만 배포할 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'
import { sebCheckFailed } from '../_shared/seb.ts'
import { ROOT_ADMIN } from '../admin/constants.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const sebErr = await sebCheckFailed(req)
    if (sebErr) return json({ error: sebErr }, 403)
    const { examSlug, roundId: reqRoundId } = await req.json()
    if (!examSlug || typeof examSlug !== 'string') {
      return json({ error: '잘못된 요청입니다.' }, 400)
    }

    // [본인인증 개발중] 임시로 익명 세션 허용 — 본인인증 수단 도입 시 아래 익명 차단 라인 복원.
    const user = await getUser(req)
    if (!user) return json({ error: '인증이 필요합니다.' }, 401)
    // if (user.is_anonymous) return json({ error: '로그인이 필요합니다.' }, 403)

    const admin = adminClient()

    // 활성 시험 조회
    const { data: exam, error: examErr } = await admin
      .from('exams')
      .select('id, slug, title, total_questions, duration_minutes, active')
      .eq('slug', examSlug)
      .eq('active', true)
      .maybeSingle()
    if (examErr) return json({ error: examErr.message }, 500)
    if (!exam) return json({ error: '시험을 찾을 수 없습니다.' }, 400)

    // 재응시 허용: 관리자(루트/admin_users) 또는 RETAKE_ALLOW_EMAILS 목록 — 테스트/감독용
    const email = (user.email ?? '').toLowerCase()
    const isAdmin =
      (!!email && email === ROOT_ADMIN.toLowerCase()) ||
      (!!user.email &&
        (await admin.from('admin_users').select('email').eq('email', user.email).maybeSingle()).data != null)
    const allowList = (Deno.env.get('RETAKE_ALLOW_EMAILS') ?? '')
      .toLowerCase()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const canRetake = isAdmin || allowList.includes(email)

    // 이미 제출(또는 무효)한 응시가 있으면 재응시 불가 — 1인 1회 (예외 계정 제외)
    if (!canRetake) {
      const { data: done } = await admin
        .from('exam_attempts')
        .select('id')
        .eq('user_id', user.id)
        .eq('exam_id', exam.id)
        .in('status', ['submitted', 'voided'])
        .limit(1)
        .maybeSingle()
      if (done) {
        return json(
          { error: '이미 응시를 완료하셨습니다. 자격검정은 1회만 응시할 수 있습니다.', alreadyDone: true },
          409,
        )
      }
    }

    // 이 유저의 진행중 응시는 모두 만료(동시 1개 강제)
    await admin
      .from('exam_attempts')
      .update({ status: 'expired' })
      .eq('user_id', user.id)
      .eq('exam_id', exam.id)
      .eq('status', 'in_progress')

    // 활성 문항 전부(번호 순)
    const { data: questions, error: qErr } = await admin
      .from('questions')
      .select('id, number, subject, topic, prompt, kind, choices')
      .eq('exam_id', exam.id)
      .eq('active', true)
      .order('number', { ascending: true })
    if (qErr) return json({ error: qErr.message }, 500)
    if (!questions || questions.length === 0) {
      return json({ error: '해당 시험의 문제가 없습니다.' }, 400)
    }

    // (테스트용) 환경변수 EXAM_QUESTION_LIMIT 가 있으면 앞에서 그만큼만 출제
    const limit = Math.max(0, Math.floor(Number(Deno.env.get('EXAM_QUESTION_LIMIT') ?? 0)))
    const served = limit > 0 ? questions.slice(0, limit) : questions

    // 회차 배정 — 클라가 roundId 주면 그것(검증), 없으면 현재 활성 정기회차 자동 배정(데모/접수 UX 전 대응).
    //  · 활성 = 오늘 이후 시험일 중 가장 임박, 없으면 가장 최근 정기회차. 없으면 null(상시/미배정).
    let roundId: string | null = null
    if (reqRoundId) {
      const { data: r } = await admin.from('exam_rounds').select('id').eq('id', reqRoundId).eq('published', true).maybeSingle()
      roundId = r?.id ?? null
    }
    if (!roundId) {
      const today = new Date().toISOString().slice(0, 10)
      const { data: up } = await admin
        .from('exam_rounds').select('id')
        .eq('kind', 'regular').eq('published', true).gte('exam_date', today)
        .order('exam_date', { ascending: true }).limit(1).maybeSingle()
      if (up) roundId = up.id
      else {
        const { data: last } = await admin
          .from('exam_rounds').select('id')
          .eq('kind', 'regular').eq('published', true)
          .order('exam_date', { ascending: false }).limit(1).maybeSingle()
        roundId = last?.id ?? null
      }
    }

    // 응시 생성
    const { data: attempt, error: aErr } = await admin
      .from('exam_attempts')
      .insert({
        exam_id: exam.id,
        round_id: roundId,
        user_id: user.id,
        status: 'in_progress',
        total_questions: served.length,
      })
      .select('id, started_at')
      .single()
    if (aErr || !attempt) return json({ error: aErr?.message ?? '응시 생성 실패' }, 500)

    // 출제 문항 고정(부정 제출 방지) — 한 문항당 한 행. 주관식은 채점 보류(pending)로 시작.
    const answerRows = served.map((q) => ({
      attempt_id: attempt.id,
      question_id: q.id,
      number: q.number,
      selected_index: null,
      is_correct: null,
      review_status: q.kind === 'short' ? 'pending' : 'auto',
    }))
    const { error: insErr } = await admin.from('attempt_answers').insert(answerRows)
    if (insErr) return json({ error: insErr.message }, 500)

    // 정답(correct_index) 제외하고 반환
    return json({
      attemptId: attempt.id,
      exam: {
        slug: exam.slug,
        title: exam.title,
        durationMinutes: exam.duration_minutes,
        totalQuestions: served.length,
      },
      startedAt: attempt.started_at,
      questions: served.map((q) => ({
        id: q.id,
        number: q.number,
        subject: q.subject,
        topic: q.topic,
        prompt: q.prompt,
        kind: q.kind ?? 'mc',
        choices: q.choices,
      })),
    })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
