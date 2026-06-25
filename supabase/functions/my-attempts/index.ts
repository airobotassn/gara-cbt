// my-attempts: 로그인 유저 본인의 응시 내역. 점수/합격은 결과 공개일 이후에만 노출.
//   ⚠️ _shared 사용 → CLI 로만 배포할 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'

const PASS_RATIO = 0.6

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const user = await getUser(req)
    if (!user) return json({ error: '인증이 필요합니다.' }, 401)

    const admin = adminClient()

    // 테스트 계정(시크릿 DEMO_MYPAGE_EMAILS)에는 더미 응시내역(합격/불합격) 반환
    const demoEmails = (Deno.env.get('DEMO_MYPAGE_EMAILS') ?? '')
      .toLowerCase()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (demoEmails.includes((user.email ?? '').toLowerCase())) {
      const iso = (d: number) => new Date(Date.now() - d * 86400000).toISOString()
      return json({
        attempts: [
          { attemptId: 'demo-pass', examTitle: 'GARA 자격검정', status: 'submitted', startedAt: iso(8), submittedAt: iso(8), resultReleaseAt: iso(1), released: true, totalCorrect: 4, totalQuestions: 5, passed: true },
          { attemptId: 'demo-fail', examTitle: 'GARA 자격검정', status: 'submitted', startedAt: iso(8), submittedAt: iso(8), resultReleaseAt: iso(1), released: true, totalCorrect: 1, totalQuestions: 5, passed: false },
        ],
      })
    }

    const { data } = await admin
      .from('exam_attempts')
      .select('id, exam_id, status, started_at, submitted_at, result_release_at, total_correct, total_questions')
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

    const now = Date.now()
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
      }
    })

    return json({ attempts })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
