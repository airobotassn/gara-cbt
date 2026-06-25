// submit-report: 응시자가 특정 문항에 대해 오류 제보. 본인 응시의 문항에 한해 1건 저장.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { attemptId, questionId, message } = await req.json()
    const msg = String(message ?? '').trim()
    if (!attemptId || !questionId) return json({ error: '잘못된 요청입니다.' }, 400)
    if (!msg) return json({ error: '내용을 입력해주세요.' }, 400)
    if (msg.length > 1000) return json({ error: '내용이 너무 깁니다(최대 1000자).' }, 400)

    const user = await getUser(req)
    if (!user) return json({ error: '인증이 필요합니다.' }, 401)

    const admin = adminClient()

    // 본인 응시인지 확인
    const { data: attempt } = await admin
      .from('test_attempts')
      .select('id, user_id, lang')
      .eq('id', attemptId)
      .maybeSingle()
    if (!attempt || attempt.user_id !== user.id) return json({ error: '권한이 없습니다.' }, 403)

    // 그 응시에 실제 출제된 문항인지 확인
    const { data: ans } = await admin
      .from('attempt_answers')
      .select('question_id')
      .eq('attempt_id', attemptId)
      .eq('question_id', questionId)
      .maybeSingle()
    if (!ans) return json({ error: '해당 응시의 문항이 아닙니다.' }, 400)

    // 문항 코드(L3-045) 첨부
    const { data: q } = await admin.from('questions').select('code').eq('id', questionId).maybeSingle()

    const { error } = await admin.from('question_reports').insert({
      question_id: questionId,
      code: q?.code ?? null,
      attempt_id: attemptId,
      user_id: user.id,
      lang: attempt.lang ?? null,
      message: msg,
      status: 'open',
    })
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
