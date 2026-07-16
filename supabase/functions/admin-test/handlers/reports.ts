// 문항 오류 제보: 목록 · 상태 변경(open/resolved/dismissed)
//  CARIS ARENA 이관: questions→test_questions (조인 개명), question_reports 는 유지.
import { json } from '../../_shared/cors.ts'

export async function listReports(admin: any, body: any) {
  let q = admin
    .from('question_reports')
    .select('id, code, question_id, message, status, lang, created_at, test_questions(level, category, prompt_i18n)')
    .order('created_at', { ascending: false })
    .limit(500)
  if (body.status && body.status !== 'all') q = q.eq('status', body.status)
  const { data, error } = await q
  if (error) return json({ error: error.message }, 500)
  const reports = (data ?? []).map((r: any) => ({
    id: r.id,
    code: r.code,
    questionId: r.question_id,
    message: r.message,
    status: r.status,
    lang: r.lang,
    created_at: r.created_at,
    level: r.test_questions?.level ?? null,
    category: r.test_questions?.category ?? null,
    prompt: r.test_questions?.prompt_i18n?.ko ?? '(문항 삭제됨)',
  }))
  // 미처리 건수도 같이
  const { count } = await admin
    .from('question_reports')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open')
  return json({ reports, openCount: count ?? 0 })
}

export async function setReportStatus(admin: any, body: any) {
  const id = body.id
  const status = body.status
  if (!id || !['open', 'resolved', 'dismissed'].includes(status)) return json({ error: '인자 오류' }, 400)
  const { error } = await admin.from('question_reports').update({ status }).eq('id', id)
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true })
}
