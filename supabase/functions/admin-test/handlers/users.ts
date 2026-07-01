// 유저: 목록 · 상세(응시이력+레이팅) · 등급 수동조정
//  레벨테스트 이관: 참조 테이블(profiles·user_progress·test_attempts·user_level_skill)은 유지.
import { json } from '../../_shared/cors.ts'
import { MAX_LEVEL } from '../../_shared/scoring.ts'

// PostgREST 는 한 응답에 최대 1000행(max-rows)만 준다 → .range 로 전부 끌어온다.
async function fetchAllRows(makeQuery: (from: number, to: number) => any): Promise<any[]> {
  const PAGE = 1000
  const out: any[] = []
  for (let from = 0; ; from += PAGE) {
    const { data } = await makeQuery(from, from + PAGE - 1)
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < PAGE) break
  }
  return out
}

export async function listUsers(admin: any) {
  const profiles = await fetchAllRows((f, t) =>
    admin
      .from('profiles')
      .select('id, display_name, is_anonymous, created_at')
      .order('created_at', { ascending: false })
      .range(f, t),
  )
  const prog = await fetchAllRows((f, t) =>
    admin.from('user_progress').select('user_id, rank').range(f, t),
  )
  const rankMap: Record<string, number> = {}
  for (const p of prog) rankMap[(p as any).user_id] = (p as any).rank
  // 응시수 / 마지막 활동
  const atts = await fetchAllRows((f, t) =>
    admin.from('test_attempts').select('user_id, submitted_at').eq('status', 'submitted').range(f, t),
  )
  const cnt: Record<string, number> = {}
  const last: Record<string, string> = {}
  for (const a of atts) {
    const u = (a as any).user_id
    cnt[u] = (cnt[u] || 0) + 1
    const s = (a as any).submitted_at
    if (s && (!last[u] || s > last[u])) last[u] = s
  }
  // auth 이메일도 페이지 단위로 전부
  const emailMap: Record<string, string> = {}
  try {
    for (let page = 1; ; page++) {
      const { data: au } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
      const list = au?.users ?? []
      for (const x of list) emailMap[x.id] = x.email ?? ''
      if (list.length < 1000) break
    }
  } catch { /* listUsers 실패해도 이메일만 빈칸 */ }
  const users = (profiles ?? []).map((p: any) => ({
    id: p.id,
    name: p.display_name,
    email: emailMap[p.id] ?? null,
    anon: p.is_anonymous,
    created: p.created_at,
    rank: rankMap[p.id] ?? 1,
    attempts: cnt[p.id] ?? 0,
    lastActive: last[p.id] ?? null,
  }))
  return json({ users })
}

export async function userDetail(admin: any, body: any) {
  const uid = body.userId
  if (!uid) return json({ error: 'userId 필요' }, 400)
  const [attRes, skillRes, progRes] = await Promise.all([
    admin.from('test_attempts')
      .select('id, level, lang, status, total_correct, total_questions, rank_before, rank_after, rank_dir, submitted_at, created_at')
      .eq('user_id', uid).order('created_at', { ascending: false }).limit(50),
    admin.from('user_level_skill').select('level, ratings, attempts_count, placed').eq('user_id', uid),
    admin.from('user_progress').select('rank').eq('user_id', uid).maybeSingle(),
  ])
  return json({ attempts: attRes.data ?? [], skills: skillRes.data ?? [], rank: (progRes.data as any)?.rank ?? 1 })
}

export async function setRank(admin: any, body: any) {
  const uid = body.userId
  const rank = body.rank
  if (!uid || typeof rank !== 'number' || rank < 1 || rank > MAX_LEVEL) return json({ error: '인자 오류' }, 400)
  const { error } = await admin.from('user_progress').upsert(
    { user_id: uid, rank, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  )
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true })
}
