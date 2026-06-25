// seed-demo: (테스트용) 특정 이메일 계정에 실제 응시기록(합격/불합격)을 DB에 INSERT.
//   secret(SEED_SECRET) 일치해야 동작. 운영 종료 시 함수/시크릿 제거.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient } from '../_shared/lib.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { email, secret } = await req.json()
    if (!secret || secret !== Deno.env.get('SEED_SECRET')) return json({ error: 'forbidden' }, 403)
    if (!email) return json({ error: 'email 필요' }, 400)

    const admin = adminClient()

    // 이메일로 user_id 찾기(최소 1회 로그인 필요)
    const { data: ulist } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const u = ulist?.users?.find((x) => (x.email ?? '').toLowerCase() === String(email).toLowerCase())
    if (!u) return json({ error: '해당 이메일 사용자가 없습니다(한 번 로그인 후 시도).' }, 404)

    const { data: exam } = await admin
      .from('exams')
      .select('id')
      .eq('slug', 'gara-default')
      .maybeSingle()
    if (!exam) return json({ error: 'exam 없음' }, 404)

    const now = Date.now()
    const sub = new Date(now - 3 * 86400000).toISOString()
    const rel = new Date(now - 1 * 86400000).toISOString() // 이미 발표됨

    // 기존 시드(데모) 응시 정리 후 재삽입(중복 방지) — 이 유저의 제출 기록 중 5문항짜리만
    await admin
      .from('exam_attempts')
      .delete()
      .eq('user_id', u.id)
      .eq('exam_id', exam.id)
      .eq('total_questions', 5)

    const { data: inserted, error } = await admin
      .from('exam_attempts')
      .insert([
        { exam_id: exam.id, user_id: u.id, status: 'submitted', started_at: sub, submitted_at: sub, result_release_at: rel, total_questions: 5, total_correct: 4 },
        { exam_id: exam.id, user_id: u.id, status: 'submitted', started_at: sub, submitted_at: sub, result_release_at: rel, total_questions: 5, total_correct: 1 },
      ])
      .select('id, total_correct')
    if (error) return json({ error: error.message }, 500)

    return json({ ok: true, userId: u.id, inserted })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
