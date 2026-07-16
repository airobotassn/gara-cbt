// 응시: 최근 기록 목록 · 상세(문항별 정오답, 응시 언어로 투영)
//  CARIS ARENA 이관: attempt_answers→test_answers, questions→test_questions (조인 개명).
import { json } from '../../_shared/cors.ts'
import { pickLang, projText, projOptionsForLevel } from '../../_shared/scoring.ts'

export async function listAttempts(admin: any) {
  const { data } = await admin
    .from('test_attempts')
    .select('id, user_id, level, lang, status, total_correct, total_questions, rank_before, rank_after, rank_dir, violation_count, submitted_at, created_at')
    .order('created_at', { ascending: false })
    .limit(200)
  const ids = [...new Set((data ?? []).map((a: any) => a.user_id))]
  const nameMap: Record<string, string> = {}
  const emailMap: Record<string, string> = {}
  if (ids.length) {
    const { data: profs } = await admin.from('profiles').select('id, display_name').in('id', ids)
    for (const p of profs ?? []) nameMap[(p as any).id] = (p as any).display_name
    try {
      const { data: au } = await admin.auth.admin.listUsers({ page: 1, perPage: 2000 })
      for (const x of au?.users ?? []) emailMap[x.id] = x.email ?? ''
    } catch { /* listUsers 실패해도 이메일만 빈칸 */ }
  }
  const attempts = (data ?? []).map((a: any) => ({
    ...a,
    name: nameMap[a.user_id] ?? a.user_id?.slice(0, 8),
    email: emailMap[a.user_id] || null,
  }))
  return json({ attempts })
}

export async function attemptDetail(admin: any, body: any) {
  const aid = body.attemptId
  if (!aid) return json({ error: 'attemptId 필요' }, 400)
  const { data: att } = await admin.from('test_attempts').select('lang, level').eq('id', aid).maybeSingle()
  const lang = pickLang((att as any)?.lang)
  const level = (att as any)?.level ?? 0
  const { data: rows } = await admin
    .from('test_answers')
    .select('category, selected_index, is_correct, test_questions(prompt_i18n, options_i18n, correct_index)')
    .eq('attempt_id', aid)
  const answers = (rows ?? []).map((r: any) => ({
    category: r.category,
    prompt: projText(r.test_questions?.prompt_i18n, lang),
    options: projOptionsForLevel(r.test_questions?.options_i18n, lang, level),
    selectedIndex: r.selected_index,
    correctIndex: r.test_questions?.correct_index ?? -1,
    isCorrect: r.is_correct,
  }))
  return json({ answers })
}
