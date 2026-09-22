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

// 표를 끝까지 받는다. PostgREST 가 한 요청을 max-rows=1000 에서 자르므로 `.limit(10000)` 은 1000 이다 —
// 그걸 모른 채 8,460건 답안 중 1,000건으로 문항 난이도를 매기고 있었다(2026-09-22 실측).
// ⚠️ 쪽마다 같은 정렬(기본키)로 받는다 — 정렬 없이 range 를 자르면 쪽 사이에서 행이 겹치거나 빠진다.
async function allRows<T>(build: () => any, key: string, page = 1000): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += page) {
    const { data, error } = await build().order(key).range(from, from + page - 1)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if ((data ?? []).length < page) return out
  }
}

export async function analytics(admin: any) {
  const now = Date.now()
  const since90 = new Date(now - 90 * 864e5).toISOString()
  const days: string[] = []
  for (let i = 89; i >= 0; i--) days.push(new Date(now - i * 864e5).toISOString().slice(0, 10))

  const since7 = new Date(now - 7 * 864e5).toISOString()
  const [profs, attsAll, ansAll, qs, prog] = await Promise.all([
    allRows<any>(() => admin.from('profiles').select('id, created_at, is_anonymous'), 'id'),
    allRows<any>(() => admin.from('test_attempts').select('id, user_id, level, lang, rank_dir, total_correct, total_questions, status, submitted_at, started_at'), 'id'),
    allRows<any>(() => admin.from('test_answers').select('attempt_id, question_id, category, is_correct'), 'id'),
    allRows<any>(() => admin.from('test_questions').select('id, level, category, correct_index, prompt_i18n, options_i18n, active').is('deleted_at', null), 'id'),
    allRows<any>(() => admin.from('user_progress').select('rank'), 'user_id'),
  ])
  // ⛔ 게스트(익명 세션)는 전부 뺀다(2026-09-22 지시). 게스트 응시는 등급을 안 매기므로(rank_dir 이 비어 있다)
  //    섞으면 '유지' 로 세어져 등급 변동이 부풀고, 응시 언어·정답률·문항 난이도에도 소음으로 들어간다.
  //    프로필 수 189 중 165 가 게스트라(실측) 가입 추이도 게스트를 빼야 회원 통계와 같은 숫자가 된다.
  const guestIds = new Set<string>(profs.filter((p) => p.is_anonymous).map((p) => p.id))
  const members = profs.filter((p) => !p.is_anonymous)
  const atts = attsAll.filter((a) => a.status === 'submitted' && !guestIds.has(a.user_id))
  const memberAttemptIds = new Set<string>(atts.map((a) => a.id))
  const ans = ansAll.filter((r) => memberAttemptIds.has(r.attempt_id))
  const userByLevel: Record<number, number> = {}
  for (const p of prog) userByLevel[p.rank] = (userByLevel[p.rank] || 0) + 1

  // 추이(90일)
  const signupByDay: Record<string, number> = {}
  const attemptByDay: Record<string, number> = {}
  days.forEach((d) => { signupByDay[d] = 0; attemptByDay[d] = 0 })
  for (const p of members) {
    const k = (p.created_at ?? '').slice(0, 10)
    if (k in signupByDay && p.created_at >= since90) signupByDay[k]++
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
    // 전부 게스트를 뺀 숫자다 — '게스트' 칸만 게스트 수.
    overview: {
      users: members.length,
      guests: guestIds.size,
      attemptsAll: atts.length,
      attempts7d: atts.filter((a) => (a.submitted_at ?? '') >= since7).length,
      questions: qs.length,
      questionsActive: qActive,
    },
    days, signupByDay, attemptByDay, byLevel, byLang, userByLevel, rankDir,
    qHardest: qDiff.slice(0, 6),
    qEasiest: qDiff.slice(-6).reverse(),
    catCorrect, pool, coverage,
  })
}
