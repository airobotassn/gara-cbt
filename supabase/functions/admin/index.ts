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
    .select('id, number, selected_index, answer_text, is_correct, review_status, graded_by, graded_at, time_spent, questions(subject, topic, prompt, kind, choices, correct_index, answer_key)')
    .eq('attempt_id', aid)
    .order('number', { ascending: true })

  const answers = (rows ?? []).map((r: any) => ({
    answerId: r.id,
    number: r.number,
    subject: r.questions?.subject ?? null,
    topic: r.questions?.topic ?? null,
    prompt: r.questions?.prompt ?? '',
    kind: r.questions?.kind ?? 'mc',
    choices: r.questions?.choices ?? [],
    selectedIndex: r.selected_index,
    answerText: r.answer_text ?? null,
    correctIndex: r.questions?.correct_index ?? -1,
    answerKey: r.questions?.answer_key ?? null,
    isCorrect: r.is_correct,
    reviewStatus: r.review_status ?? 'auto',
    gradedBy: r.graded_by ?? null,
    gradedAt: r.graded_at ?? null,
    timeSpent: r.time_spent,
  }))

  return json({
    attempt: shapeAttempt(a, examTitleMap, nameMap, emailMap),
    answers,
  })
}

// attempt 의 total_correct 재계산 — is_correct=true 인 답안 수(주관식 검수 반영). 채점 후 호출.
async function recomputeTotalCorrect(admin: any, attemptId: string) {
  const { count } = await admin
    .from('attempt_answers')
    .select('id', { count: 'exact', head: true })
    .eq('attempt_id', attemptId)
    .eq('is_correct', true)
  await admin.from('exam_attempts').update({ total_correct: count ?? 0 }).eq('id', attemptId)
}

// 채점 대상 회차 목록 — 정기 회차별 미검수(pending) 주관식 수 + 상시/미배정 집계.
async function gradeRounds(admin: any) {
  // 미검수 주관식 답안 + 그 응시의 회차
  const { data, error } = await admin
    .from('attempt_answers')
    .select('id, exam_attempts!inner(round_id, status), questions!inner(kind)')
    .eq('questions.kind', 'short')
    .eq('review_status', 'pending')
    .eq('exam_attempts.status', 'submitted')
    .limit(5000)
  if (error) return json({ error: error.message }, 400)
  const rows = data ?? []
  const pendingByRound: Record<string, number> = {}
  let unassigned = 0
  for (const r of rows) {
    const rid = (r as any).exam_attempts?.round_id
    if (rid) pendingByRound[rid] = (pendingByRound[rid] || 0) + 1
    else unassigned++
  }
  // 정기 회차 메타
  const { data: rounds } = await admin
    .from('exam_rounds')
    .select('id, kind, title_i18n, exam_date')
    .eq('published', true)
    .order('exam_date', { ascending: false })
  const list = (rounds ?? []).map((r: any) => ({
    roundId: r.id,
    kind: r.kind,
    title: r.title_i18n?.ko ?? '',
    examDate: r.exam_date,
    pending: pendingByRound[r.id] || 0,
  }))
  return json({ rounds: list, unassigned, totalPending: rows.length })
}

// 주관식 검수 대기열 — review_status=pending 답안(응시자·문항·답안·모범답안).
// scope='all' 이면 이미 검수한 것(graded)도 포함(수정용). 기본은 대기(pending)만.
// roundId 주면 그 회차 응시만, roundId='none' 이면 회차 미배정(상시 등)만.
async function gradeQueue(admin: any, body: any) {
  const includeGraded = body?.scope === 'all'
  let q = admin
    .from('attempt_answers')
    .select('id, attempt_id, number, answer_text, is_correct, review_status, graded_by, graded_at, questions!inner(subject, topic, prompt, kind, answer_key), exam_attempts!inner(user_id, status, submitted_at, exam_id, round_id)')
    .eq('questions.kind', 'short')
    .eq('exam_attempts.status', 'submitted')
    .order('graded_at', { ascending: true, nullsFirst: true })
    .limit(500)
  q = includeGraded ? q.in('review_status', ['pending', 'graded']) : q.eq('review_status', 'pending')
  if (body?.roundId === 'none') q = q.is('exam_attempts.round_id', null)
  else if (body?.roundId) q = q.eq('exam_attempts.round_id', body.roundId)
  const { data, error } = await q
  if (error) return json({ error: error.message }, 400)
  const rows = data ?? []

  // 응시자 이름/이메일 · 시험 제목
  const userIds = [...new Set(rows.map((r: any) => r.exam_attempts?.user_id).filter(Boolean))]
  const examIds = [...new Set(rows.map((r: any) => r.exam_attempts?.exam_id).filter(Boolean))]
  const nameMap: Record<string, string> = {}
  const emailMap: Record<string, string> = {}
  if (userIds.length) {
    const { data: profs } = await admin.from('profiles').select('id, display_name').in('id', userIds)
    for (const p of profs ?? []) nameMap[(p as any).id] = (p as any).display_name
    try {
      const { data: au } = await admin.auth.admin.listUsers({ page: 1, perPage: 2000 })
      for (const x of au?.users ?? []) emailMap[x.id] = x.email ?? ''
    } catch { /* 이메일만 빈칸 */ }
  }
  const examTitleMap: Record<string, string> = {}
  if (examIds.length) {
    const { data: exams } = await admin.from('exams').select('id, title').in('id', examIds)
    for (const e of exams ?? []) examTitleMap[(e as any).id] = (e as any).title
  }

  const items = rows.map((r: any) => ({
    answerId: r.id,
    attemptId: r.attempt_id,
    number: r.number,
    subject: r.questions?.subject ?? null,
    topic: r.questions?.topic ?? null,
    prompt: r.questions?.prompt ?? '',
    answerKey: r.questions?.answer_key ?? null,
    answerText: r.answer_text ?? null,
    isCorrect: r.is_correct,
    reviewStatus: r.review_status,
    gradedBy: r.graded_by ?? null,
    gradedAt: r.graded_at ?? null,
    userName: nameMap[r.exam_attempts?.user_id] ?? null,
    userEmail: emailMap[r.exam_attempts?.user_id] ?? null,
    examTitle: examTitleMap[r.exam_attempts?.exam_id] ?? null,
    submittedAt: r.exam_attempts?.submitted_at ?? null,
  }))
  return json({ items })
}

// 주관식 채점(신규/수정 공용) — answerId 를 정답/오답으로. total_correct 재계산.
async function gradeAnswer(admin: any, body: any, actor: string) {
  const answerId = body?.answerId
  if (!answerId || typeof body?.correct !== 'boolean') return json({ error: 'answerId·correct(bool) 필요' }, 400)
  const { data: ans } = await admin
    .from('attempt_answers')
    .select('id, attempt_id, questions(kind)')
    .eq('id', answerId)
    .maybeSingle()
  if (!ans) return json({ error: '답안을 찾을 수 없습니다.' }, 404)
  if (ans.questions?.kind !== 'short') return json({ error: '주관식 답안만 검수할 수 있습니다.' }, 400)

  const { error } = await admin
    .from('attempt_answers')
    .update({ is_correct: body.correct, review_status: 'graded', graded_by: actor, graded_at: new Date().toISOString() })
    .eq('id', answerId)
  if (error) return json({ error: error.message }, 400)
  await recomputeTotalCorrect(admin, ans.attempt_id)
  return json({ ok: true })
}

// ---------- Gemini 텍스트 번역 (공지/콘텐츠용 — 기존 GEMINI_API_KEY 재사용) ----------
// 번역은 전용 키(GEMINI_API_KEY_TRANSLATE) 우선 — 라이브 검색(route-query)/추천이 쓰는 공용 키 quota 를 안 먹도록.
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY_TRANSLATE') ?? Deno.env.get('GEMINI_API_KEY')
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-3.1-flash-lite'
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
const TARGET_LANGS = ['en', 'ja', 'zh', 'hi', 'vi'] as const
const LANG_NAMES: Record<string, string> = {
  en: 'English',
  ja: 'Japanese',
  zh: 'Chinese (Simplified)',
  hi: 'Hindi',
  vi: 'Vietnamese',
}

async function geminiJson(sys: string, user: string, maxTokens: number): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sys }] },
          contents: [{ parts: [{ text: user }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: maxTokens },
        }),
      })
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 160)}`)
      const j = await res.json()
      const cand = j?.candidates?.[0]
      if (cand?.finishReason === 'MAX_TOKENS') throw new Error('출력 잘림(MAX_TOKENS)')
      const txt = cand?.content?.parts?.[0]?.text
      if (!txt) throw new Error(`빈 응답(finish=${cand?.finishReason})`)
      return txt
    } catch (e) {
      if (attempt === 2) throw e
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)))
    }
  }
  throw new Error('unreachable')
}

// 여러 한국어 필드 → 나머지 5개국어. 반환: { <field>: { ko, en, ja, zh, hi, vi } }.
//   키 없거나 내용 없으면 ko만 반환(throw X). API/파싱 실패 시 throw(호출측 best-effort). 공지·FAQ·일정 공용.
async function translateKoFields(
  koFields: Record<string, string>,
): Promise<Record<string, Record<string, string>>> {
  const fields = Object.keys(koFields)
  const out: Record<string, Record<string, string>> = {}
  for (const f of fields) out[f] = { ko: koFields[f] ?? '' }

  const hasContent = fields.some((f) => (koFields[f] ?? '').trim())
  if (!GEMINI_API_KEY || !hasContent) return out

  const langList = TARGET_LANGS.map((c) => `"${c}" = ${LANG_NAMES[c]}`).join(', ')
  const shape = `{ ${TARGET_LANGS.map(
    (c) => `"${c}": { ${fields.map((f) => `"${f}":"..."`).join(', ')} }`,
  ).join(', ')} }`
  const sys =
    'You are a professional translator for a Korean AI-literacy certification website (CARIS). ' +
    'Translate the given Korean fields into the requested languages. ' +
    'RULES: (1) natural, idiomatic wording as a native speaker would write, preserving meaning and tone; ' +
    '(2) do NOT translate product names, acronyms (SEB, PC, AI, CARIS, OMR, PDF) or numbers; ' +
    '(3) preserve line breaks; (4) output ONLY valid JSON, no markdown.'
  const user =
    `Translate these Korean fields into: ${langList}.\n` +
    `Return JSON shaped exactly as ${shape}.\n` +
    `If a source field is empty, return "" for it in every language.\n\n` +
    `SOURCE (Korean):\n${JSON.stringify(koFields)}`

  const raw = await geminiJson(sys, user, 4096)
  const parsed = JSON.parse(raw)
  for (const c of TARGET_LANGS) {
    const langObj = parsed?.[c]
    if (langObj && typeof langObj === 'object') {
      for (const f of fields) {
        const v = (langObj as Record<string, unknown>)[f]
        if (typeof v === 'string' && v.trim()) out[f][c] = v
      }
    }
  }
  return out
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

// 생성/수정(id 있으면 update). 한국어만 입력받아, 저장 시 나머지 5개국어를 자동 번역해 저장.
async function noticeUpsert(admin: any, body: any) {
  const n = body?.notice ?? {}
  const koTitle = String(n.titleI18n?.ko ?? '').trim()
  const koBody = String(n.bodyI18n?.ko ?? '').trim()
  if (!koTitle) return json({ error: '한국어 제목은 필수입니다.' }, 400)

  // 한국어 → 나머지 5개국어 자동 번역. 실패해도 한국어로 저장은 진행(발행 막지 않음).
  let title_i18n: Record<string, string> = { ko: koTitle }
  let body_i18n: Record<string, string> = { ko: koBody }
  let translateWarning: string | null = null
  try {
    const tr = await translateKoFields({ title: koTitle, body: koBody })
    title_i18n = tr.title
    body_i18n = tr.body
  } catch (e) {
    translateWarning = e instanceof Error ? e.message : '자동 번역 실패'
  }
  if (!GEMINI_API_KEY) translateWarning = '번역 키(GEMINI_API_KEY_TRANSLATE) 미설정 — 한국어로만 저장됨'

  const row: Record<string, unknown> = {
    category: n.category ?? 'guide',
    tag: n.tag ?? 'notice',
    title_i18n,
    body_i18n,
    pinned: !!n.pinned,
    published: n.published !== false,
    published_at: n.publishedAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  if (n.id) {
    const { data, error } = await admin.from('notices').update(row).eq('id', n.id).select().maybeSingle()
    if (error) return json({ error: error.message }, 400)
    return json({ notice: data ? shapeNotice(data) : null, translateWarning })
  }
  const { data, error } = await admin.from('notices').insert(row).select().maybeSingle()
  if (error) return json({ error: error.message }, 400)
  return json({ notice: data ? shapeNotice(data) : null, translateWarning })
}

async function noticeDelete(admin: any, body: any) {
  const id = body?.id
  if (!id) return json({ error: 'id 필요' }, 400)
  const { error } = await admin.from('notices').delete().eq('id', id)
  if (error) return json({ error: error.message }, 400)
  return json({ ok: true })
}

// ---------- FAQ CRUD ----------
function shapeFaq(f: any) {
  return {
    id: f.id,
    category: f.category,
    questionI18n: f.question_i18n ?? {},
    answerI18n: f.answer_i18n ?? {},
    tagI18n: f.tag_i18n ?? {},
    sort: f.sort,
    published: !!f.published,
    createdAt: f.created_at,
    updatedAt: f.updated_at,
  }
}

async function faqList(admin: any) {
  const { data, error } = await admin
    .from('faqs')
    .select('*')
    .order('category', { ascending: true })
    .order('sort', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) return json({ error: error.message }, 400)
  return json({ faqs: (data ?? []).map(shapeFaq) })
}

// 생성/수정. 한국어(질문·답변·태그)만 입력받아 저장 시 나머지 5개국어 자동 번역.
async function faqUpsert(admin: any, body: any) {
  const f = body?.faq ?? {}
  const koQ = String(f.questionI18n?.ko ?? '').trim()
  const koA = String(f.answerI18n?.ko ?? '').trim()
  const koTag = String(f.tagI18n?.ko ?? '').trim()
  if (!koQ) return json({ error: '한국어 질문은 필수입니다.' }, 400)

  let question_i18n: Record<string, string> = { ko: koQ }
  let answer_i18n: Record<string, string> = { ko: koA }
  let tag_i18n: Record<string, string> = { ko: koTag }
  let translateWarning: string | null = null
  try {
    const tr = await translateKoFields({ question: koQ, answer: koA, tag: koTag })
    question_i18n = tr.question
    answer_i18n = tr.answer
    tag_i18n = tr.tag
  } catch (e) {
    translateWarning = e instanceof Error ? e.message : '자동 번역 실패'
  }
  if (!GEMINI_API_KEY) translateWarning = '번역 키(GEMINI_API_KEY_TRANSLATE) 미설정 — 한국어로만 저장됨'

  const sortNum = Number(f.sort)
  const hasSort = Number.isFinite(sortNum)
  const row: Record<string, unknown> = {
    category: f.category ?? 'schedule',
    question_i18n,
    answer_i18n,
    tag_i18n,
    published: f.published !== false,
    updated_at: new Date().toISOString(),
  }

  if (f.id) {
    if (hasSort) row.sort = Math.floor(sortNum) // 편집 시 순서는 보통 미포함(기존 유지). 순서변경은 faqReorder.
    const { data, error } = await admin.from('faqs').update(row).eq('id', f.id).select().maybeSingle()
    if (error) return json({ error: error.message }, 400)
    return json({ faq: data ? shapeFaq(data) : null, translateWarning })
  }
  row.sort = hasSort ? Math.floor(sortNum) : 9999 // 새 항목은 해당 분류 맨 끝
  const { data, error } = await admin.from('faqs').insert(row).select().maybeSingle()
  if (error) return json({ error: error.message }, 400)
  return json({ faq: data ? shapeFaq(data) : null, translateWarning })
}

// 순서 재배치 — ids 를 받은 순서대로 sort = 10,20,30… 재부여(관리자 ↑↓ 이동용).
async function faqReorder(admin: any, body: any) {
  const ids = Array.isArray(body?.ids) ? (body.ids as string[]) : []
  if (!ids.length) return json({ error: 'ids 필요' }, 400)
  for (let i = 0; i < ids.length; i++) {
    const { error } = await admin.from('faqs').update({ sort: (i + 1) * 10 }).eq('id', ids[i])
    if (error) return json({ error: error.message }, 400)
  }
  return json({ ok: true })
}

async function faqDelete(admin: any, body: any) {
  const id = body?.id
  if (!id) return json({ error: 'id 필요' }, 400)
  const { error } = await admin.from('faqs').delete().eq('id', id)
  if (error) return json({ error: error.message }, 400)
  return json({ ok: true })
}

// ---------- 시험 일정/회차(exam_rounds) CRUD ----------
function shapeExamRound(r: any) {
  return {
    id: r.id,
    kind: r.kind,
    titleI18n: r.title_i18n ?? {},
    examDate: r.exam_date, // 'YYYY-MM-DD' | null
    applyStartAt: r.apply_start_at, // ISO | null
    applyEndAt: r.apply_end_at, // ISO | null
    noteI18n: r.note_i18n ?? {},
    published: !!r.published,
    sort: r.sort,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

async function examRoundList(admin: any) {
  const { data, error } = await admin
    .from('exam_rounds')
    .select('*')
    .order('kind', { ascending: true })
    .order('sort', { ascending: true })
    .order('exam_date', { ascending: true, nullsFirst: true })
  if (error) return json({ error: error.message }, 400)
  return json({ rounds: (data ?? []).map(shapeExamRound) })
}

// 생성/수정. 한국어(회차명·부가설명)만 입력받아 저장 시 나머지 5개국어 자동 번역. 날짜는 그대로 저장.
async function examRoundUpsert(admin: any, body: any) {
  const r = body?.round ?? {}
  const koTitle = String(r.titleI18n?.ko ?? '').trim()
  const koNote = String(r.noteI18n?.ko ?? '').trim()
  if (!koTitle) return json({ error: '한국어 회차명은 필수입니다.' }, 400)

  let title_i18n: Record<string, string> = { ko: koTitle }
  let note_i18n: Record<string, string> = koNote ? { ko: koNote } : {}
  let translateWarning: string | null = null
  try {
    const koFields: Record<string, string> = { title: koTitle }
    if (koNote) koFields.note = koNote
    const tr = await translateKoFields(koFields)
    title_i18n = tr.title
    note_i18n = koNote ? tr.note : {}
  } catch (e) {
    translateWarning = e instanceof Error ? e.message : '자동 번역 실패'
  }
  if (!GEMINI_API_KEY) translateWarning = '번역 키(GEMINI_API_KEY_TRANSLATE) 미설정 — 한국어로만 저장됨'

  const kind = r.kind === 'rolling' ? 'rolling' : 'regular'
  const sortNum = Number(r.sort)
  const hasSort = Number.isFinite(sortNum)
  const row: Record<string, unknown> = {
    kind,
    title_i18n,
    note_i18n,
    exam_date: r.examDate || null,
    apply_start_at: r.applyStartAt || null,
    apply_end_at: r.applyEndAt || null,
    published: r.published !== false,
    updated_at: new Date().toISOString(),
  }

  if (r.id) {
    if (hasSort) row.sort = Math.floor(sortNum)
    const { data, error } = await admin.from('exam_rounds').update(row).eq('id', r.id).select().maybeSingle()
    if (error) return json({ error: error.message }, 400)
    return json({ round: data ? shapeExamRound(data) : null, translateWarning })
  }
  row.sort = hasSort ? Math.floor(sortNum) : 9999 // 새 항목은 맨 끝
  const { data, error } = await admin.from('exam_rounds').insert(row).select().maybeSingle()
  if (error) return json({ error: error.message }, 400)
  return json({ round: data ? shapeExamRound(data) : null, translateWarning })
}

async function examRoundReorder(admin: any, body: any) {
  const ids = Array.isArray(body?.ids) ? (body.ids as string[]) : []
  if (!ids.length) return json({ error: 'ids 필요' }, 400)
  for (let i = 0; i < ids.length; i++) {
    const { error } = await admin.from('exam_rounds').update({ sort: (i + 1) * 10 }).eq('id', ids[i])
    if (error) return json({ error: error.message }, 400)
  }
  return json({ ok: true })
}

async function examRoundDelete(admin: any, body: any) {
  const id = body?.id
  if (!id) return json({ error: 'id 필요' }, 400)
  const { error } = await admin.from('exam_rounds').delete().eq('id', id)
  if (error) return json({ error: error.message }, 400)
  return json({ ok: true })
}

// ---------- 응시료(exam_fees) — 금액만 편집 ----------
async function examFeeList(admin: any) {
  const { data, error } = await admin.from('exam_fees').select('key, amount').order('key', { ascending: true })
  if (error) return json({ error: error.message }, 400)
  return json({ fees: data ?? [] })
}

async function examFeeSave(admin: any, body: any) {
  const items = Array.isArray(body?.fees) ? body.fees : []
  if (!items.length) return json({ error: 'fees 필요' }, 400)
  const now = new Date().toISOString()
  for (const it of items) {
    const key = String(it?.key ?? '').trim()
    const n = Number(it?.amount)
    if (!key || !Number.isFinite(n)) continue
    const amount = Math.max(0, Math.floor(n))
    const { error } = await admin.from('exam_fees').upsert({ key, amount, updated_at: now }, { onConflict: 'key' })
    if (error) return json({ error: error.message }, 400)
  }
  return json({ ok: true })
}

// ---------- 관리자 계정 관리 (루트 전용) ----------
// admin_users 는 CBT·레벨테스트 공용 게이트 테이블 → 여기서 추가/삭제하면 양쪽 권한이 함께 반영됨.
async function manageAdmins(
  admin: any,
  body: any,
  action: 'admins' | 'addAdmin' | 'removeAdmin',
  currentEmail: string,
  isRoot: boolean,
) {
  if (!isRoot) return json({ error: '루트 관리자만 관리자 계정을 관리할 수 있습니다.' }, 403)

  // 가입(이메일 보유·비익명) 유저 집합 — 관리자 지정 후보 검증용
  const registered = new Set<string>()
  try {
    const { data: au } = await admin.auth.admin.listUsers({ page: 1, perPage: 2000 })
    for (const u of au?.users ?? []) {
      const e = (u.email ?? '').trim().toLowerCase()
      if (e && !u.is_anonymous) registered.add(e)
    }
  } catch { /* listUsers 실패해도 목록은 반환 */ }

  if (action === 'addAdmin') {
    const target = String(body?.email ?? '').trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target)) return json({ error: '올바른 이메일이 아닙니다.' }, 400)
    if (target === ROOT_ADMIN) return json({ error: '루트 관리자는 이미 최고 권한입니다.' }, 400)
    if (!registered.has(target)) {
      return json({ error: '가입한 사용자만 관리자로 지정할 수 있습니다. (해당 이메일로 로그인한 적이 있어야 함)' }, 400)
    }
    const { error } = await admin.from('admin_users').upsert(
      { email: target, added_by: currentEmail, created_at: new Date().toISOString() },
      { onConflict: 'email' },
    )
    if (error) return json({ error: error.message }, 500)
  }
  if (action === 'removeAdmin') {
    const target = String(body?.email ?? '').trim().toLowerCase()
    if (target === ROOT_ADMIN) return json({ error: '루트 관리자는 삭제할 수 없습니다.' }, 400)
    const { error } = await admin.from('admin_users').delete().eq('email', target)
    if (error) return json({ error: error.message }, 500)
  }

  const { data, error } = await admin
    .from('admin_users')
    .select('email, added_by, created_at')
    .order('created_at', { ascending: true })
  if (error) return json({ error: error.message }, 500)
  const adminSet = new Set([ROOT_ADMIN, ...(data ?? []).map((r: any) => r.email)])
  const admins = [
    { email: ROOT_ADMIN, role: 'root', added_by: null, created_at: null },
    ...(data ?? []).map((r: any) => ({ email: r.email, role: 'admin', added_by: r.added_by, created_at: r.created_at })),
  ]
  const candidates = [...registered].filter((e) => !adminSet.has(e)).sort()
  return json({ admins, candidates })
}

// ---------- CBT 문항 관리 (목록·이력·엑셀 임포트) ----------
async function logCbtEvent(
  admin: any,
  e: { question_id: string | null; exam_id: string | null; number: number | null; action: string; actor: string; detail?: unknown },
) {
  try {
    await admin.from('cbt_question_events').insert({
      question_id: e.question_id,
      exam_id: e.exam_id,
      number: e.number,
      action: e.action,
      actor: e.actor || null,
      detail: e.detail ?? null,
    })
  } catch { /* 로그 실패는 무시 */ }
}

// 시험 목록 + 각 시험의 문항 수(비삭제)
async function examListForAdmin(admin: any) {
  const { data, error } = await admin
    .from('exams')
    .select('id, slug, title, total_questions, active, created_at')
    .order('created_at', { ascending: true })
  if (error) return json({ error: error.message }, 400)
  const exams = data ?? []
  const counts: Record<string, { total: number; active: number }> = {}
  for (const ex of exams) {
    const [t, a] = await Promise.all([
      admin.from('questions').select('id', { count: 'exact', head: true }).eq('exam_id', ex.id).is('deleted_at', null),
      admin.from('questions').select('id', { count: 'exact', head: true }).eq('exam_id', ex.id).eq('active', true).is('deleted_at', null),
    ])
    counts[ex.id] = { total: t.count ?? 0, active: a.count ?? 0 }
  }
  return json({ exams: exams.map((ex: any) => ({ ...ex, questionCount: counts[ex.id].total, activeCount: counts[ex.id].active })) })
}

// 한 시험의 문항 목록(비삭제, 번호순). 관리자에겐 correct_index 포함.
async function questionList(admin: any, body: any) {
  const examId = body?.examId
  if (!examId) return json({ error: 'examId 필요' }, 400)
  const { data, error } = await admin
    .from('questions')
    .select('id, exam_id, number, subject, topic, prompt, kind, choices, correct_index, answer_key, active')
    .eq('exam_id', examId)
    .is('deleted_at', null)
    .order('number', { ascending: true })
    .limit(2000)
  if (error) return json({ error: error.message }, 400)
  return json({ rows: data ?? [] })
}

// 개별 문항 추가/수정 — id 있으면 수정, 없으면 신규(같은 exam_id+number 있으면 덮어쓰기).
//  · 객관식(mc): 보기 4개 + 정답(0..3). 주관식(short): 보기/정답 없이 모범답안(answer_key).
async function questionUpsert(admin: any, body: any, actor: string) {
  const q = body?.question ?? {}
  const examId = q.examId
  if (!examId) return json({ error: 'examId 필요' }, 400)
  const number = Math.floor(Number(q.number))
  if (!Number.isFinite(number) || number < 1) return json({ error: '번호(1 이상)를 입력하세요.' }, 400)
  const subject = String(q.subject ?? '').trim()
  const prompt = String(q.prompt ?? '').trim()
  if (!subject || !prompt) return json({ error: '과목·지문은 필수입니다.' }, 400)
  const kind = q.kind === 'short' ? 'short' : 'mc'

  const row: Record<string, unknown> = {
    exam_id: examId,
    number,
    subject,
    topic: String(q.topic ?? '').trim(),
    prompt,
    kind,
    active: q.active !== false,
    deleted_at: null,
  }
  if (kind === 'short') {
    row.choices = []
    row.correct_index = null
    row.answer_key = String(q.answerKey ?? '').trim() || null
  } else {
    const choices = Array.isArray(q.choices) ? q.choices.map((c: unknown) => String(c ?? '').trim()) : []
    if (choices.length !== 4 || choices.some((c: string) => !c)) return json({ error: '객관식은 보기 4개가 모두 필요합니다.' }, 400)
    const ci = Math.floor(Number(q.correctIndex))
    if (!Number.isFinite(ci) || ci < 0 || ci > 3) return json({ error: '정답(1~4)을 선택하세요.' }, 400)
    row.choices = choices
    row.correct_index = ci
    row.answer_key = null
  }

  const isNew = !q.id
  if (q.id) {
    const { error } = await admin.from('questions').update(row).eq('id', q.id)
    if (error) return json({ error: error.message }, 400)
  } else {
    const { error } = await admin.from('questions').upsert(row, { onConflict: 'exam_id,number' })
    if (error) return json({ error: error.message }, 400)
  }
  await logCbtEvent(admin, { question_id: q.id ?? null, exam_id: examId, number, action: isNew ? 'import' : 'edit', actor, detail: { kind, single: true } })
  return json({ ok: true })
}

async function questionSetActive(admin: any, body: any, actor: string) {
  if (!body?.id) return json({ error: 'id 필요' }, 400)
  const active = !!body.active
  const { data: before } = await admin.from('questions').select('exam_id, number').eq('id', body.id).maybeSingle()
  const { error } = await admin.from('questions').update({ active }).eq('id', body.id)
  if (error) return json({ error: error.message }, 400)
  await logCbtEvent(admin, { question_id: body.id, exam_id: before?.exam_id ?? null, number: before?.number ?? null, action: active ? 'activate' : 'deactivate', actor })
  return json({ ok: true })
}

async function questionDelete(admin: any, body: any, actor: string) {
  if (!body?.id) return json({ error: 'id 필요' }, 400)
  const { data: before } = await admin.from('questions').select('exam_id, number').eq('id', body.id).maybeSingle()
  const { error } = await admin.from('questions').update({ deleted_at: new Date().toISOString(), active: false }).eq('id', body.id)
  if (error) return json({ error: error.message }, 400)
  await logCbtEvent(admin, { question_id: body.id, exam_id: before?.exam_id ?? null, number: before?.number ?? null, action: 'delete', actor })
  return json({ ok: true })
}

async function questionRestore(admin: any, body: any, actor: string) {
  if (!body?.id) return json({ error: 'id 필요' }, 400)
  const { data: before } = await admin.from('questions').select('exam_id, number').eq('id', body.id).maybeSingle()
  const { error } = await admin.from('questions').update({ active: true, deleted_at: null }).eq('id', body.id)
  if (error) return json({ error: error.message }, 400)
  await logCbtEvent(admin, { question_id: body.id, exam_id: before?.exam_id ?? null, number: before?.number ?? null, action: 'restore', actor })
  return json({ ok: true })
}

// 변경 이력(최신순). examId 필터 + 각 이벤트에 현재 복구가능 여부.
async function questionEvents(admin: any, body: any) {
  let q = admin
    .from('cbt_question_events')
    .select('id, question_id, exam_id, number, action, actor, detail, created_at')
    .order('created_at', { ascending: false })
    .limit(1000)
  if (body?.examId) q = q.eq('exam_id', body.examId)
  const { data, error } = await q
  if (error) return json({ error: error.message }, 400)
  const events = data ?? []
  const ids = [...new Set(events.map((e: any) => e.question_id).filter(Boolean))]
  const statusById: Record<string, { active: boolean; deleted: boolean }> = {}
  if (ids.length) {
    const { data: qs } = await admin.from('questions').select('id, active, deleted_at').in('id', ids)
    for (const r of qs ?? []) statusById[r.id] = { active: !!r.active, deleted: r.deleted_at != null }
  }
  const withStatus = events.map((e: any) => {
    const st = e.question_id ? statusById[e.question_id] : undefined
    return { ...e, restorable: !!st && (!st.active || st.deleted) }
  })
  return json({ events: withStatus })
}

// 엑셀 임포트 — rows[] 를 (exam_id, number) 기준 upsert. 재임포트 시 갱신.
async function questionsImport(admin: any, body: any, actor: string) {
  const examId = body?.examId
  if (!examId) return json({ error: 'examId 필요' }, 400)
  const rows = Array.isArray(body?.rows) ? body.rows : []
  if (!rows.length) return json({ error: '가져올 문항이 없습니다.' }, 400)

  const payload: any[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const number = Math.floor(Number(r?.number))
    if (!Number.isFinite(number) || number < 1) return json({ error: `#${i + 1}행: 번호 오류` }, 400)
    const subject = String(r?.subject ?? '').trim()
    const topic = String(r?.topic ?? '').trim()
    const prompt = String(r?.prompt ?? '').trim()
    if (!subject || !prompt) return json({ error: `#${i + 1}행(번호 ${number}): 과목·지문은 필수` }, 400)
    const kind = r?.kind === 'short' ? 'short' : 'mc'
    if (kind === 'short') {
      // 주관식 — 보기/정답번호 없음, 모범답안(answerKey)은 선택
      payload.push({ exam_id: examId, number, subject, topic, prompt, kind, choices: [], correct_index: null, answer_key: String(r?.answerKey ?? '').trim() || null, active: true, deleted_at: null })
      continue
    }
    const choices = Array.isArray(r?.choices) ? r.choices.map((c: unknown) => String(c ?? '').trim()) : []
    if (choices.length !== 4 || choices.some((c: string) => !c)) return json({ error: `#${i + 1}행(번호 ${number}): 보기 4개가 모두 필요` }, 400)
    const ci = Math.floor(Number(r?.correctIndex))
    if (!Number.isFinite(ci) || ci < 0 || ci > 3) return json({ error: `#${i + 1}행(번호 ${number}): 정답(1~4) 오류` }, 400)
    payload.push({ exam_id: examId, number, subject, topic, prompt, kind, choices, correct_index: ci, answer_key: null, active: true, deleted_at: null })
  }
  // 행 내 번호 중복 검사
  const nums = payload.map((p) => p.number)
  const dup = nums.find((n, i) => nums.indexOf(n) !== i)
  if (dup != null) return json({ error: `번호 ${dup} 가 파일 안에서 중복됩니다.` }, 400)

  const { data, error } = await admin.from('questions').upsert(payload, { onConflict: 'exam_id,number' }).select('id')
  if (error) return json({ error: error.message }, 400)
  await logCbtEvent(admin, { question_id: null, exam_id: examId, number: null, action: 'import', actor, detail: { count: payload.length } })
  return json({ ok: true, count: data?.length ?? payload.length })
}

// 대시보드 분석 — 추이·점수분포·합격률·시험별 응시·문항 난이도·과목 정답률·문항 풀.
async function cbtAnalytics(admin: any) {
  const now = Date.now()
  const since7 = new Date(now - 7 * 864e5).toISOString()
  const since90 = new Date(now - 90 * 864e5).toISOString()
  const days: string[] = []
  for (let i = 89; i >= 0; i--) days.push(new Date(now - i * 864e5).toISOString().slice(0, 10))

  const [profRes, attRes, ansRes, qRes, examRes, usersCnt, guestsCnt, attsCnt, atts7dCnt, qTot, qAct] = await Promise.all([
    admin.from('profiles').select('created_at, is_anonymous').limit(10000),
    admin.from('exam_attempts').select('exam_id, status, submitted_at, created_at, total_correct, total_questions').limit(10000),
    admin.from('attempt_answers').select('question_id, is_correct').limit(50000),
    admin.from('questions').select('id, exam_id, number, subject, prompt, active').is('deleted_at', null).limit(5000),
    admin.from('exams').select('id, title, slug, active').order('created_at', { ascending: true }),
    admin.from('profiles').select('id', { count: 'exact', head: true }),
    admin.from('profiles').select('id', { count: 'exact', head: true }).eq('is_anonymous', true),
    admin.from('exam_attempts').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
    admin.from('exam_attempts').select('id', { count: 'exact', head: true }).eq('status', 'submitted').gte('submitted_at', since7),
    admin.from('questions').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    admin.from('questions').select('id', { count: 'exact', head: true }).eq('active', true).is('deleted_at', null),
  ])

  const profs = profRes.data ?? []
  const atts = (attRes.data ?? []).filter((a: any) => a.status === 'submitted')
  const ans = ansRes.data ?? []
  const qs = qRes.data ?? []
  const exams = examRes.data ?? []
  const examTitle: Record<string, string> = {}
  for (const e of exams) examTitle[e.id] = e.title

  // 추이(90일)
  const signupByDay: Record<string, number> = {}
  const submitByDay: Record<string, number> = {}
  days.forEach((d) => { signupByDay[d] = 0; submitByDay[d] = 0 })
  for (const p of profs as any[]) {
    const k = (p.created_at ?? '').slice(0, 10)
    if (k in signupByDay && p.created_at >= since90) signupByDay[k]++
  }
  for (const a of atts as any[]) {
    const k = (a.submitted_at ?? a.created_at ?? '').slice(0, 10)
    if (k in submitByDay) submitByDay[k]++
  }

  // 점수 분포 + 합격률(합격컷 60) + 시험별 응시
  const scoreBands: Record<string, number> = { '0-59': 0, '60-69': 0, '70-79': 0, '80-89': 0, '90-100': 0 }
  let passN = 0
  let scoredN = 0
  const byExam: Record<string, number> = {}
  for (const a of atts as any[]) {
    byExam[a.exam_id] = (byExam[a.exam_id] || 0) + 1
    if (a.total_questions && a.total_correct != null) {
      const pct = Math.round((a.total_correct / a.total_questions) * 100)
      scoredN++
      if (pct >= 90) scoreBands['90-100']++
      else if (pct >= 80) scoreBands['80-89']++
      else if (pct >= 70) scoreBands['70-79']++
      else if (pct >= 60) scoreBands['60-69']++
      else scoreBands['0-59']++
      if (pct >= 60) passN++
    }
  }
  const byExamArr = exams.map((e: any) => ({ title: e.title, slug: e.slug, count: byExam[e.id] || 0 }))

  // 문항 난이도(정답률, 응시 3회 이상) + 과목 정답률
  const qMap: Record<string, any> = {}
  for (const q of qs as any[]) qMap[q.id] = q
  const qAgg: Record<string, { n: number; c: number }> = {}
  const subjAgg: Record<string, { n: number; c: number }> = {}
  for (const r of ans as any[]) {
    qAgg[r.question_id] ??= { n: 0, c: 0 }
    qAgg[r.question_id].n++
    if (r.is_correct) qAgg[r.question_id].c++
    const q = qMap[r.question_id]
    const sk = q?.subject ?? '(기타)'
    subjAgg[sk] ??= { n: 0, c: 0 }
    subjAgg[sk].n++
    if (r.is_correct) subjAgg[sk].c++
  }
  const qDiff = Object.entries(qAgg)
    .filter(([, v]) => v.n >= 3)
    .map(([id, v]) => ({
      id,
      number: qMap[id]?.number ?? 0,
      subject: qMap[id]?.subject ?? '',
      prompt: qMap[id]?.prompt ?? '',
      exam: examTitle[qMap[id]?.exam_id] ?? '',
      active: qMap[id]?.active ?? true,
      n: v.n,
      rate: Math.round((v.c / v.n) * 100),
    }))
    .sort((a, b) => a.rate - b.rate)
  const subjectCorrect = Object.entries(subjAgg)
    .map(([subject, v]) => ({ subject, n: v.n, rate: Math.round((v.c / v.n) * 100) }))
    .sort((a, b) => a.rate - b.rate)

  // 과목별 문항 풀(활성/전체)
  const poolBy: Record<string, { total: number; active: number }> = {}
  for (const q of qs as any[]) {
    poolBy[q.subject] ??= { total: 0, active: 0 }
    poolBy[q.subject].total++
    if (q.active) poolBy[q.subject].active++
  }
  const pool = Object.entries(poolBy)
    .map(([subject, v]) => ({ subject, total: v.total, active: v.active }))
    .sort((a, b) => a.subject.localeCompare(b.subject))

  return json({
    overview: {
      users: usersCnt.count ?? profs.length,
      guests: guestsCnt.count ?? 0,
      attemptsAll: attsCnt.count ?? atts.length,
      attempts7d: atts7dCnt.count ?? 0,
      questions: qTot.count ?? qs.length,
      questionsActive: qAct.count ?? 0,
      exams: exams.length,
    },
    days,
    signupByDay,
    submitByDay,
    scoreBands,
    passRate: scoredN ? Math.round((passN / scoredN) * 100) : 0,
    scoredN,
    byExam: byExamArr,
    qHardest: qDiff.slice(0, 6),
    qEasiest: qDiff.slice(-6).reverse(),
    subjectCorrect,
    pool,
  })
}

// 회원 목록 — 프로필 + 이메일 + 응시수 + 마지막 활동.
async function cbtUsers(admin: any) {
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, display_name, is_anonymous, created_at')
    .order('created_at', { ascending: false })
    .limit(5000)
  const { data: atts } = await admin
    .from('exam_attempts')
    .select('user_id, submitted_at')
    .eq('status', 'submitted')
    .limit(20000)
  const cnt: Record<string, number> = {}
  const last: Record<string, string> = {}
  for (const a of atts ?? []) {
    const u = (a as any).user_id
    cnt[u] = (cnt[u] || 0) + 1
    const s = (a as any).submitted_at
    if (s && (!last[u] || s > last[u])) last[u] = s
  }
  const emailMap: Record<string, string> = {}
  try {
    for (let page = 1; ; page++) {
      const { data: au } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
      const list = au?.users ?? []
      for (const x of list) emailMap[x.id] = x.email ?? ''
      if (list.length < 1000) break
    }
  } catch { /* 이메일만 빈칸 */ }
  const users = (profiles ?? []).map((p: any) => ({
    id: p.id,
    name: p.display_name,
    email: emailMap[p.id] ?? null,
    anon: p.is_anonymous,
    created: p.created_at,
    attempts: cnt[p.id] ?? 0,
    lastActive: last[p.id] ?? null,
  }))
  return json({ users })
}

// 회원 상세 — 응시 이력(시험명 포함).
async function cbtUserDetail(admin: any, body: any) {
  const uid = body?.userId
  if (!uid) return json({ error: 'userId 필요' }, 400)
  const { data: atts } = await admin
    .from('exam_attempts')
    .select('id, exam_id, status, total_correct, total_questions, submitted_at, created_at')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(50)
  const examIds = [...new Set((atts ?? []).map((a: any) => a.exam_id).filter(Boolean))]
  const titleMap: Record<string, string> = {}
  if (examIds.length) {
    const { data: ex } = await admin.from('exams').select('id, title').in('id', examIds)
    for (const e of ex ?? []) titleMap[(e as any).id] = (e as any).title
  }
  const attempts = (atts ?? []).map((a: any) => ({
    id: a.id,
    examTitle: a.exam_id ? titleMap[a.exam_id] ?? null : null,
    status: a.status,
    totalCorrect: a.total_correct,
    totalQuestions: a.total_questions,
    submittedAt: a.submitted_at,
    createdAt: a.created_at,
  }))
  return json({ attempts })
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
      case 'me': return json({ ok: true, isRoot })
      case 'admins':
      case 'addAdmin':
      case 'removeAdmin': return await manageAdmins(admin, body, action, email, isRoot)
      case 'list': return await listAttempts(admin, body)
      case 'detail': return await attemptDetail(admin, body)
      case 'gradeRounds': return await gradeRounds(admin)
      case 'gradeQueue': return await gradeQueue(admin, body)
      case 'gradeAnswer': return await gradeAnswer(admin, body, email)
      case 'noticeList': return await noticeList(admin)
      case 'noticeUpsert': return await noticeUpsert(admin, body)
      case 'noticeDelete': return await noticeDelete(admin, body)
      case 'faqList': return await faqList(admin)
      case 'faqUpsert': return await faqUpsert(admin, body)
      case 'faqDelete': return await faqDelete(admin, body)
      case 'faqReorder': return await faqReorder(admin, body)
      case 'examRoundList': return await examRoundList(admin)
      case 'examRoundUpsert': return await examRoundUpsert(admin, body)
      case 'examRoundReorder': return await examRoundReorder(admin, body)
      case 'examRoundDelete': return await examRoundDelete(admin, body)
      case 'examFeeList': return await examFeeList(admin)
      case 'examFeeSave': return await examFeeSave(admin, body)
      case 'examListForAdmin': return await examListForAdmin(admin)
      case 'questionList': return await questionList(admin, body)
      case 'questionUpsert': return await questionUpsert(admin, body, email)
      case 'questionSetActive': return await questionSetActive(admin, body, email)
      case 'questionDelete': return await questionDelete(admin, body, email)
      case 'questionRestore': return await questionRestore(admin, body, email)
      case 'questionEvents': return await questionEvents(admin, body)
      case 'questionsImport': return await questionsImport(admin, body, email)
      case 'cbtAnalytics': return await cbtAnalytics(admin)
      case 'cbtUsers': return await cbtUsers(admin)
      case 'cbtUserDetail': return await cbtUserDetail(admin, body)
      default: return json({ error: '알 수 없는 action' }, 400)
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
