// admin: 관리자 전용 백오피스 API (service role). CBT(자격검정) 응시 조회용.
//  - 인증: 루트(ROOT_ADMIN) 또는 admin_users 테이블 등록 이메일만 통과(기존 게이트 유지)
//  - 액션: me · list · detail
//  - ⚠️ _shared 사용 → CLI 로만 배포할 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'
import { ROOT_ADMIN } from './constants.ts'

// 응시 행 → 프론트 표시용 형태(공통). attempts 배열에 exams/profiles/email 을 합쳐 매핑.
function shapeAttempt(
  a: any,
  examTitleMap: Record<string, string>,
  nameMap: Record<string, string>,
  emailMap: Record<string, string>,
) {
  return {
    attemptId: a.id,
    examTitle: a.exam_id ? examTitleMap[a.exam_id] ?? null : null,
    userId: a.user_id,
    userEmail: emailMap[a.user_id] || null,
    userName: nameMap[a.user_id] ?? null,
    status: a.status,
    startedAt: a.started_at,
    submittedAt: a.submitted_at,
    resultReleaseAt: a.result_release_at,
    totalCorrect: a.total_correct,
    totalQuestions: a.total_questions,
  }
}

// 응시 목록(페이지네이션) — exams.title + profiles.display_name + auth 이메일 합성.
async function listAttempts(admin: any, body: any) {
  const limit = Math.min(Math.max(1, Math.floor(body?.limit ?? 50)), 500)
  const offset = Math.max(0, Math.floor(body?.offset ?? 0))

  const { data, count } = await admin
    .from('exam_attempts')
    .select(
      'id, exam_id, user_id, status, started_at, submitted_at, result_release_at, total_correct, total_questions',
      { count: 'exact' },
    )
    .order('submitted_at', { ascending: false, nullsFirst: false })
    .order('started_at', { ascending: false })
    .range(offset, offset + limit - 1)

  const rows = data ?? []
  const examIds = [...new Set(rows.map((a: any) => a.exam_id).filter(Boolean))]
  const userIds = [...new Set(rows.map((a: any) => a.user_id).filter(Boolean))]

  const examTitleMap: Record<string, string> = {}
  if (examIds.length) {
    const { data: exams } = await admin.from('exams').select('id, title').in('id', examIds)
    for (const e of exams ?? []) examTitleMap[(e as any).id] = (e as any).title
  }

  const nameMap: Record<string, string> = {}
  const emailMap: Record<string, string> = {}
  if (userIds.length) {
    const { data: profs } = await admin.from('profiles').select('id, display_name').in('id', userIds)
    for (const p of profs ?? []) nameMap[(p as any).id] = (p as any).display_name
    try {
      const { data: au } = await admin.auth.admin.listUsers({ page: 1, perPage: 2000 })
      for (const x of au?.users ?? []) emailMap[x.id] = x.email ?? ''
    } catch { /* listUsers 실패해도 이메일만 빈칸 */ }
  }

  const attempts = rows.map((a: any) => shapeAttempt(a, examTitleMap, nameMap, emailMap))
  return json({ attempts, total: count ?? attempts.length })
}

// 응시 상세 — 같은 헤더 필드 + 문항별 정오답(문항 조인).
async function attemptDetail(admin: any, body: any) {
  const aid = body?.attemptId
  if (!aid) return json({ error: 'attemptId 필요' }, 400)

  const { data: a } = await admin
    .from('exam_attempts')
    .select(
      'id, exam_id, user_id, status, started_at, submitted_at, result_release_at, total_correct, total_questions',
    )
    .eq('id', aid)
    .maybeSingle()
  if (!a) return json({ error: '응시를 찾을 수 없습니다.' }, 404)

  const examTitleMap: Record<string, string> = {}
  if (a.exam_id) {
    const { data: exam } = await admin.from('exams').select('id, title').eq('id', a.exam_id).maybeSingle()
    if (exam) examTitleMap[(exam as any).id] = (exam as any).title
  }
  const nameMap: Record<string, string> = {}
  const emailMap: Record<string, string> = {}
  {
    const { data: prof } = await admin.from('profiles').select('id, display_name').eq('id', a.user_id).maybeSingle()
    if (prof) nameMap[(prof as any).id] = (prof as any).display_name
    try {
      const { data: au } = await admin.auth.admin.getUserById(a.user_id)
      if (au?.user) emailMap[a.user_id] = au.user.email ?? ''
    } catch { /* 이메일만 빈칸 */ }
  }

  const { data: rows } = await admin
    .from('attempt_answers')
    .select('number, selected_index, is_correct, time_spent, questions(subject, topic, prompt, choices, correct_index)')
    .eq('attempt_id', aid)
    .order('number', { ascending: true })

  const answers = (rows ?? []).map((r: any) => ({
    number: r.number,
    subject: r.questions?.subject ?? null,
    topic: r.questions?.topic ?? null,
    prompt: r.questions?.prompt ?? '',
    choices: r.questions?.choices ?? [],
    selectedIndex: r.selected_index,
    correctIndex: r.questions?.correct_index ?? -1,
    isCorrect: r.is_correct,
    timeSpent: r.time_spent,
  }))

  return json({
    attempt: shapeAttempt(a, examTitleMap, nameMap, emailMap),
    answers,
  })
}

// ---------- 공지사항(notices) CRUD ----------
function shapeNotice(n: any) {
  return {
    id: n.id,
    category: n.category,
    tag: n.tag,
    titleI18n: n.title_i18n ?? {},
    bodyI18n: n.body_i18n ?? {},
    pinned: !!n.pinned,
    published: !!n.published,
    publishedAt: n.published_at,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
  }
}

// 관리자 목록 — 미공개 포함 전체(고정 우선 → 최신순)
async function noticeList(admin: any) {
  const { data, error } = await admin
    .from('notices')
    .select('*')
    .order('pinned', { ascending: false })
    .order('published_at', { ascending: false })
  if (error) return json({ error: error.message }, 400)
  return json({ notices: (data ?? []).map(shapeNotice) })
}

// 생성/수정(id 있으면 update). 한국어 제목 필수.
async function noticeUpsert(admin: any, body: any) {
  const n = body?.notice ?? {}
  const title = (n.titleI18n ?? {}) as Record<string, unknown>
  if (!title.ko || !String(title.ko).trim()) return json({ error: '한국어 제목은 필수입니다.' }, 400)

  const row: Record<string, unknown> = {
    category: n.category ?? 'guide',
    tag: n.tag ?? 'notice',
    title_i18n: title,
    body_i18n: n.bodyI18n ?? {},
    pinned: !!n.pinned,
    published: n.published !== false,
    published_at: n.publishedAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  if (n.id) {
    const { data, error } = await admin.from('notices').update(row).eq('id', n.id).select().maybeSingle()
    if (error) return json({ error: error.message }, 400)
    return json({ notice: data ? shapeNotice(data) : null })
  }
  const { data, error } = await admin.from('notices').insert(row).select().maybeSingle()
  if (error) return json({ error: error.message }, 400)
  return json({ notice: data ? shapeNotice(data) : null })
}

async function noticeDelete(admin: any, body: any) {
  const id = body?.id
  if (!id) return json({ error: 'id 필요' }, 400)
  const { error } = await admin.from('notices').delete().eq('id', id)
  if (error) return json({ error: error.message }, 400)
  return json({ ok: true })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const user = await getUser(req)
    const email = (user?.email ?? '').toLowerCase()
    const admin = adminClient()
    const isRoot = !!email && email === ROOT_ADMIN
    let isAdmin = isRoot
    if (user && !isAdmin) {
      // admin_users 테이블에 등록된 이메일이면 관리자 (테이블 없으면 무시 → 루트만 통과)
      const { data } = await admin.from('admin_users').select('email').eq('email', email).maybeSingle()
      isAdmin = !!data
    }
    if (!isAdmin) return json({ error: '관리자 전용입니다.' }, 403)

    const body = await req.json()
    const action = body?.action

    switch (action) {
      case 'me': return json({ ok: true })
      case 'list': return await listAttempts(admin, body)
      case 'detail': return await attemptDetail(admin, body)
      case 'noticeList': return await noticeList(admin)
      case 'noticeUpsert': return await noticeUpsert(admin, body)
      case 'noticeDelete': return await noticeDelete(admin, body)
      default: return json({ error: '알 수 없는 action' }, 400)
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
