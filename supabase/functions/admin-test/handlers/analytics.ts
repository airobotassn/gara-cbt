// 대시보드: 개요 카드 · 분석(추이·분포·문항난이도·풀·커버리지)
//  CARIS ARENA 이관: attempt_answers→test_answers, questions→test_questions.
import { json } from '../../_shared/cors.ts'
import { SUPPORTED_LANGS } from '../../_shared/scoring.ts'

export async function overview(admin: any) {
  const [u, a7, aAll, qt, qa] = await Promise.all([
    admin.from('profiles').select('id', { count: 'exact', head: true }),
    admin
      .from('test_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'submitted')
      .gte('submitted_at', new Date(Date.now() - 7 * 864e5).toISOString()),
    admin.from('test_attempts').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
    admin.from('test_questions').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    admin.from('test_questions').select('id', { count: 'exact', head: true }).eq('active', true).is('deleted_at', null),
  ])
  return json({
    users: u.count ?? 0,
    attempts7d: a7.count ?? 0,
    attemptsAll: aAll.count ?? 0,
    questions: qt.count ?? 0,
    questionsActive: qa.count ?? 0,
  })
}

export async function analytics(admin: any) {
  const now = Date.now()
  const since90 = new Date(now - 90 * 864e5).toISOString()
  const days: string[] = []
  for (let i = 89; i >= 0; i--) days.push(new Date(now - i * 864e5).toISOString().slice(0, 10))

  const since7 = new Date(now - 7 * 864e5).toISOString()
  const [profRes, attRes, ansRes, qRes, progRes, usersCntRes, guestsCntRes, attsCntRes, atts7dCntRes] = await Promise.all([
    admin.from('profiles').select('created_at, is_anonymous').limit(10000),
    admin.from('test_attempts').select('level, lang, rank_dir, total_correct, total_questions, status, submitted_at, started_at').limit(10000),
    admin.from('test_answers').select('question_id, category, is_correct').limit(50000),
    admin.from('test_questions').select('id, level, category, correct_index, prompt_i18n, options_i18n, active').is('deleted_at', null).limit(5000),
    admin.from('user_progress').select('rank').limit(20000),
    // 헤드라인 합계 = 정확카운트(행 패치는 PostgREST max-rows=1000 에 잘림 → .length 금지)
    admin.from('profiles').select('id', { count: 'exact', head: true }),
    admin.from('profiles').select('id', { count: 'exact', head: true }).eq('is_anonymous', true),
    admin.from('test_attempts').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
    admin.from('test_attempts').select('id', { count: 'exact', head: true }).eq('status', 'submitted').gte('submitted_at', since7),
  ])
  const userByLevel: Record<number, number> = {}
  for (const p of progRes.data ?? []) userByLevel[(p as any).rank] = (userByLevel[(p as any).rank] || 0) + 1
  const profs = profRes.data ?? []
  const atts = (attRes.data ?? []).filter((a: any) => a.status === 'submitted')
  const ans = ansRes.data ?? []
  const qs = qRes.data ?? []

  // 추이(90일)
  const signupByDay: Record<string, number> = {}
  const attemptByDay: Record<string, number> = {}
  days.forEach((d) => { signupByDay[d] = 0; attemptByDay[d] = 0 })
  for (const p of profs) {
    const k = ((p as any).created_at ?? '').slice(0, 10)
    if (k in signupByDay && (p as any).created_at >= since90) signupByDay[k]++
  }
  const byLevel: Record<number, number> = {}
  const byLang: Record<string, number> = {}
  const rankDir = { up: 0, down: 0, stay: 0 }
  for (const a of atts as any[]) {
    const k = (a.submitted_at ?? a.started_at ?? '').slice(0, 10)
    if (k in attemptByDay) attemptByDay[k]++
    byLevel[a.level] = (byLevel[a.level] || 0) + 1
    byLang[a.lang] = (byLang[a.lang] || 0) + 1
    if (a.rank_dir === 'up') rankDir.up++
    else if (a.rank_dir === 'down') rankDir.down++
    else rankDir.stay++
  }

  // 문항 난이도(정답률) + 카테고리 평균
  const qMap: Record<string, any> = {}
  for (const q of qs as any[]) qMap[q.id] = q
  const qAgg: Record<string, { n: number; c: number }> = {}
  const catAgg: Record<string, { n: number; c: number }> = {}
  for (const r of ans as any[]) {
    qAgg[r.question_id] ??= { n: 0, c: 0 }
    qAgg[r.question_id].n++
    if (r.is_correct) qAgg[r.question_id].c++
    const q = qMap[r.question_id]
    const ck = q ? `${q.level}/${q.category}` : r.category
    catAgg[ck] ??= { n: 0, c: 0 }
    catAgg[ck].n++
    if (r.is_correct) catAgg[ck].c++
  }
  const qDiff = Object.entries(qAgg)
    .filter(([, v]) => v.n >= 3)
    .map(([id, v]) => ({
      id,
      level: qMap[id]?.level ?? 0,
      category: qMap[id]?.category ?? '',
      prompt: qMap[id]?.prompt_i18n?.ko ?? '',
      options: qMap[id]?.options_i18n?.ko ?? [],
      correctIndex: qMap[id]?.correct_index ?? 0,
      active: qMap[id]?.active ?? true,
      n: v.n,
      rate: Math.round((v.c / v.n) * 100),
    }))
    .sort((a, b) => a.rate - b.rate)
  const catCorrect = Object.entries(catAgg)
    .map(([key, v]) => ({ key, n: v.n, rate: Math.round((v.c / v.n) * 100) }))
    .sort((a, b) => a.key.localeCompare(b.key))

  // 출제풀 + 번역 커버리지
  const pool: Record<string, { total: number; active: number }> = {}
  const coverage: Record<string, number> = {}
  let qActive = 0
  for (const q of qs as any[]) {
    const key = `${q.level}/${q.category}`
    pool[key] ??= { total: 0, active: 0 }
    pool[key].total++
    if (q.active) { pool[key].active++; qActive++ }
    for (const lang of SUPPORTED_LANGS) if (q.prompt_i18n?.[lang]) coverage[lang] = (coverage[lang] ?? 0) + 1
  }

  return json({
    overview: {
      users: usersCntRes.count ?? profs.length,
      guests: guestsCntRes.count ?? 0,
      attemptsAll: attsCntRes.count ?? atts.length,
      attempts7d: atts7dCntRes.count ?? 0,
      questions: qs.length,
      questionsActive: qActive,
    },
    days, signupByDay, attemptByDay, byLevel, byLang, userByLevel, rankDir,
    qHardest: qDiff.slice(0, 6),
    qEasiest: qDiff.slice(-6).reverse(),
    catCorrect, pool, coverage,
  })
}
