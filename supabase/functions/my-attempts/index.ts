// my-attempts: 로그인 유저 본인의 응시 내역. 점수/합격은 결과 공개일 이후에만 노출.
//   - 조회 시점에 TTL(240분) 지나도록 미제출인 진행중 응시는 만료(expired) 처리.
//   - body { issue: attemptId, nameRoman } 로 인증서 발급 기록(공개 후 + 합격만, 재발급은 시각 갱신).
//     nameRoman = 인증서에 각인할 영문 성명(발급 신청 화면에서 입력). 발급 시점 스냅샷이라 응시 기록에 저장한다.
//   ⚠️ _shared 사용 → CLI 로만 배포할 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'
import { makeCertNo, subjectOf, gradeOfTitle } from '../_shared/cert.ts'

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

    // 인증서 발급 기록 — 결과 공개 후 + 합격만 가능. 발급 완료여도 재발급 허용(시각 갱신).
    // 최초 발급 시 진위확인용 토큰·자격번호를 확정 저장(재발급은 기존 값 유지 → QR 불변).
    let issued: { verifyToken: string; certNo: string; nameRoman: string | null } | null = null
    if (body?.issue) {
      const { data: a } = await admin
        .from('exam_attempts')
        .select('id, user_id, exam_id, status, result_release_at, submitted_at, total_correct, total_questions, verify_token, cert_no, cert_name_roman')
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
      if (!passed) return json({ error: '인증서는 결과 공개 후 합격한 응시만 발급할 수 있습니다.' }, 409)

      let verifyToken = (a.verify_token as string | null) ?? null
      let certNo = (a.cert_no as string | null) ?? null
      if (!verifyToken || !certNo) {
        // 시험명으로 트랙 추정 → 자격번호. 연도는 취득(제출) 연도.
        let title: string | null = null
        if (a.exam_id) {
          const { data: ex } = await admin.from('exams').select('title').eq('id', a.exam_id).maybeSingle()
          title = (ex as { title?: string } | null)?.title ?? null
        }
        const year = a.submitted_at ? new Date(a.submitted_at).getFullYear() : new Date().getFullYear()
        verifyToken = verifyToken ?? crypto.randomUUID()
        if (!certNo) {
          // 일련번호는 DB 가 채번한다(종목·등급·연도별 원자 증가). 여기서 만들어내면 중복이 나간다.
          const grade = gradeOfTitle(title)
          const { data: seq, error: seqErr } = await admin.rpc('next_cert_seq', {
            p_subject: subjectOf(grade),
            p_grade: grade,
            p_year: year,
          })
          // 채번 실패 시 임시 번호로 때우지 않는다 — 자격번호는 한번 나가면 회수가 안 된다.
          if (seqErr || typeof seq !== 'number') return json({ error: 'cert_seq_failed' }, 500)
          certNo = makeCertNo(grade, year, seq)
        }
      }
      // 영문 성명 — 인증서에 각인되는 유일한 이름이라 발급 시 필수. 재발급은 저장된 값을 그대로 쓴다.
      // 규칙: 라틴 문자·공백·하이픈·아포스트로피·마침표만(여권 표기 관행), 2~40자.
      const stored = (a.cert_name_roman as string | null) ?? null
      const input = typeof body.nameRoman === 'string' ? body.nameRoman.trim().replace(/\s+/g, ' ') : ''
      let nameRoman = stored
      if (input) {
        if (input.length < 2 || input.length > 40 || !/^[A-Za-z][A-Za-z .'-]*$/.test(input)) {
          return json({ error: 'invalid_name_roman' }, 400)
        }
        nameRoman = input
      }
      if (!nameRoman) return json({ error: 'name_roman_required' }, 400)

      const { error: issueErr } = await admin
        .from('exam_attempts')
        .update({ cert_issued_at: new Date().toISOString(), verify_token: verifyToken, cert_no: certNo, cert_name_roman: nameRoman })
        .eq('id', a.id)
      if (issueErr) return json({ error: issueErr.message }, 400)
      issued = { verifyToken, certNo, nameRoman }
    }

    const { data } = await admin
      .from('exam_attempts')
      .select('id, exam_id, status, started_at, submitted_at, result_release_at, total_correct, total_questions, cert_issued_at, verify_token, cert_no, cert_name_roman')
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
        certNo: passed ? r.cert_no ?? null : null,
        verifyToken: passed ? r.verify_token ?? null : null,
        certNameRoman: passed ? r.cert_name_roman ?? null : null,
      }
    })

    return json({ attempts, issued })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
