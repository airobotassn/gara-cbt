// my-attempts: 로그인 유저 본인의 응시 내역. 점수/합격은 결과 공개일 이후에만 노출.
//   - 조회 시점에 TTL(240분) 지나도록 미제출인 진행중 응시는 만료(expired) 처리.
//   - body { issue: attemptId } 로 자격증 발급 기록(공개 후 + 합격만, 재발급은 시각 갱신).
//   ⚠️ _shared 사용 → CLI 로만 배포할 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'

const PASS_RATIO = 0.6
// submit-exam 의 ATTEMPT_TTL_MINUTES 와 동일 기준 — 이 시간이 지나도록 미제출이면 만료
const ATTEMPT_TTL_MINUTES = 240

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const user = await getUser(req)
    if (!user) return json({ error: '인증이 필요합니다.' }, 401)

    const body = await req.json().catch(() => ({}))
    const admin = adminClient()
    const now = Date.now()

    // 방치된 진행중 응시 만료 — 제한시간을 훌쩍 넘긴 것(TTL)만
    const cutoff = new Date(now - ATTEMPT_TTL_MINUTES * 60000).toISOString()
    await admin
      .from('exam_attempts')
      .update({ status: 'expired' })
      .eq('user_id', user.id)
      .eq('status', 'in_progress')
      .lt('started_at', cutoff)

    // 자격증 발급 기록 — 결과 공개 후 + 합격만 가능. 발급 완료여도 재발급 허용(시각 갱신).
    if (body?.issue) {
      const { data: a } = await admin
        .from('exam_attempts')
        .select('id, user_id, status, result_release_at, total_correct, total_questions')
        .eq('id', body.issue)
        .maybeSingle()
      if (!a || a.user_id !== user.id) return json({ error: '권한이 없습니다.' }, 403)
      const released =
        a.status === 'submitted' &&
        !!a.result_release_at &&
        now >= new Date(a.result_release_at).getTime()
      const passed =
        released && a.total_correct != null && a.total_questions
          ? a.total_correct >= Math.ceil(a.total_questions * PASS_RATIO)
          : false
      if (!passed) return json({ error: '자격증은 결과 공개 후 합격한 응시만 발급할 수 있습니다.' }, 409)
      const { error: issueErr } = await admin
        .from('exam_attempts')
        .update({ cert_issued_at: new Date().toISOString() })
        .eq('id', a.id)
      if (issueErr) return json({ error: issueErr.message }, 400)
    }

    const { data } = await admin
      .from('exam_attempts')
      .select('id, exam_id, status, started_at, submitted_at, result_release_at, total_correct, total_questions, cert_issued_at')
      .eq('user_id', user.id)
      .order('submitted_at', { ascending: false, nullsFirst: false })
      .order('started_at', { ascending: false })
      .limit(50)

    const rows = data ?? []
    const examIds = [...new Set(rows.map((r) => r.exam_id).filter(Boolean))]
    const titleMap: Record<string, string> = {}
    if (examIds.length) {
      const { data: exams } = await admin.from('exams').select('id, title').in('id', examIds)
      for (const e of exams ?? []) titleMap[(e as { id: string }).id] = (e as { title: string }).title
    }

    const attempts = rows.map((r) => {
      const released =
        r.status === 'submitted' &&
        !!r.result_release_at &&
        now >= new Date(r.result_release_at).getTime()
      const total = r.total_questions ?? 0
      const correct = released ? r.total_correct : null
      const passed = released && correct != null ? correct >= Math.ceil(total * PASS_RATIO) : null
      return {
        attemptId: r.id,
        examTitle: r.exam_id ? titleMap[r.exam_id] ?? null : null,
        status: r.status,
        startedAt: r.started_at,
        submittedAt: r.submitted_at,
        resultReleaseAt: r.result_release_at,
        released,
        totalCorrect: correct,
        totalQuestions: total,
        passed,
        certIssuedAt: passed ? r.cert_issued_at : null,
      }
    })

    return json({ attempts })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
