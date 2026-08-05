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
  examTierMap: Record<string, string> = {},
) {
  return {
    attemptId: a.id,
    examTitle: a.exam_id ? examTitleMap[a.exam_id] ?? null : null,
    examId: a.exam_id ?? null,
    roundId: a.round_id ?? null,
    tier: a.exam_id ? examTierMap[a.exam_id] ?? null : null,
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
      'id, exam_id, round_id, user_id, status, started_at, submitted_at, result_release_at, total_correct, total_questions',
      { count: 'exact' },
    )
    .order('submitted_at', { ascending: false, nullsFirst: false })
    .order('started_at', { ascending: false })
    .range(offset, offset + limit - 1)

  const rows = data ?? []
  const examIds = [...new Set(rows.map((a: any) => a.exam_id).filter(Boolean))]
  const userIds = [...new Set(rows.map((a: any) => a.user_id).filter(Boolean))]

  const examTitleMap: Record<string, string> = {}
  const examTierMap: Record<string, string> = {}
  if (examIds.length) {
    const { data: exams } = await admin.from('exams').select('id, title, tier').in('id', examIds)
    for (const e of exams ?? []) { examTitleMap[(e as any).id] = (e as any).title; if ((e as any).tier) examTierMap[(e as any).id] = (e as any).tier }
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

  const attempts = rows.map((a: any) => shapeAttempt(a, examTitleMap, nameMap, emailMap, examTierMap))
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
    '(3) preserve line breaks; ' +
    '(4) if a field contains HTML, translate ONLY the human-visible text and keep every HTML tag, attribute, and URL (href/src) exactly unchanged; ' +
    '(5) output ONLY valid JSON, no markdown.'
  const user =
    `Translate these Korean fields into: ${langList}.\n` +
    `Return JSON shaped exactly as ${shape}.\n` +
    `If a source field is empty, return "" for it in every language.\n\n` +
    `SOURCE (Korean):\n${JSON.stringify(koFields)}`

  const raw = await geminiJson(sys, user, 8192)
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
    required: !!n.required,
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
    required: !!n.required,
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
// tiers = 이 회차가 연 급수(활성 exams.tier) 키 배열. 회차 등록 기능(exams=회차×급수)에서 채움.
function shapeExamRound(r: any, tiers: string[] = []) {
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
    tiers, // 이 회차가 연 급수 키(활성)
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
  // 각 회차가 연 급수(활성 exams) 를 한 번에 조회해 roundId별로 묶는다.
  const { data: exs } = await admin.from('exams').select('round_id, tier').eq('active', true).not('round_id', 'is', null)
  const byRound: Record<string, string[]> = {}
  for (const e of (exs ?? []) as any[]) {
    if (!e.tier) continue
    ;(byRound[e.round_id] ??= []).push(e.tier)
  }
  return json({ rounds: (data ?? []).map((r: any) => shapeExamRound(r, byRound[r.id] ?? [])) })
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

  let saved: any = null
  if (r.id) {
    if (hasSort) row.sort = Math.floor(sortNum)
    const { data, error } = await admin.from('exam_rounds').update(row).eq('id', r.id).select().maybeSingle()
    if (error) return json({ error: error.message }, 400)
    saved = data
  } else {
    row.sort = hasSort ? Math.floor(sortNum) : 9999 // 새 항목은 맨 끝
    const { data, error } = await admin.from('exam_rounds').insert(row).select().maybeSingle()
    if (error) return json({ error: error.message }, 400)
    saved = data
  }

  // 회차가 연 급수(tiers) 동기화 → 급수마다 exams 행 생성/재활성/소프트클로즈.
  // r.tiers 가 배열일 때만 건드린다(구 호출이 실수로 급수를 비우지 않도록).
  let tierKeys: string[] = []
  if (saved?.id && Array.isArray(r.tiers)) {
    const tiersInput = (r.tiers as any[])
      .filter((t) => t && typeof t.key === 'string')
      .map((t) => ({ key: t.key as string, title: String(t.title ?? t.key), total: Number(t.total) || 0, durationMin: Number(t.durationMin) || 120 }))
    try {
      tierKeys = await syncRoundExams(admin, saved.id, tiersInput)
    } catch (e) {
      // 급수 동기화 실패는 회차 저장을 무르지 않고 경고만.
      translateWarning = (translateWarning ? translateWarning + ' / ' : '') + '급수 동기화 실패: ' + (e instanceof Error ? e.message : '오류')
    }
  }
  return json({ round: saved ? shapeExamRound(saved, tierKeys) : null, translateWarning })
}

// 회차의 열린 급수 ↔ exams 동기화. tiers = [{key, title}].
//  · 요청에 있고 없던 급수 → exams insert(활성)
//  · 요청에 있고 이미 있던 급수 → title 갱신 + 재활성
//  · 요청에서 빠진 급수 → 세트·응시 없으면 삭제(오등록 정리), 있으면 active=false(보존)
//  · 구성(total/durationMin)은 클라가 TIER_EXAM_SPEC 에서 실어 보냄(Deno는 caris.ts 못 읽음)
async function syncRoundExams(admin: any, roundId: string, tiers: { key: string; title: string; total?: number; durationMin?: number }[]): Promise<string[]> {
  const { data: existing, error } = await admin.from('exams').select('id, tier, active').eq('round_id', roundId)
  if (error) throw new Error(error.message)
  const cur = (existing ?? []) as any[]
  const curByTier = new Map<string, any>(cur.map((e) => [e.tier, e]))
  const wantKeys = new Set(tiers.map((t) => t.key))

  for (const t of tiers) {
    const total = Number.isFinite(t.total) ? Math.floor(t.total as number) : 0
    const dur = Number.isFinite(t.durationMin) ? Math.floor(t.durationMin as number) : 120
    const ex = curByTier.get(t.key)
    if (ex) {
      const { error: e } = await admin.from('exams').update({ title: t.title, active: true, total_questions: total, duration_minutes: dur }).eq('id', ex.id)
      if (e) throw new Error(e.message)
    } else {
      const slug = `r-${roundId}-${t.key}` // (round_id,tier) 유일 → slug 전역 유일
      const { error: e } = await admin.from('exams').insert({ round_id: roundId, tier: t.key, slug, title: t.title, active: true, total_questions: total, duration_minutes: dur })
      if (e) throw new Error(e.message)
    }
  }

  for (const e of cur) {
    if (wantKeys.has(e.tier)) continue
    const [q, a] = await Promise.all([
      admin.from('exam_questions').select('id', { count: 'exact', head: true }).eq('exam_id', e.id),
      admin.from('exam_attempts').select('id', { count: 'exact', head: true }).eq('exam_id', e.id),
    ])
    if ((q.count ?? 0) === 0 && (a.count ?? 0) === 0) {
      await admin.from('exams').delete().eq('id', e.id) // 한 번도 안 쓴 오등록 → 정리
    } else if (e.active) {
      await admin.from('exams').update({ active: false }).eq('id', e.id) // 사용 이력 있으면 보존
    }
  }
  return tiers.map((t) => t.key)
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
  // 이 회차에 등록된 급수 시험(exams)이 있으면 삭제 차단(문항·응시 유실·FK 위반 방지).
  const { count } = await admin.from('exams').select('id', { count: 'exact', head: true }).eq('round_id', id)
  if ((count ?? 0) > 0) {
    return json({ error: '이 회차에 등록된 급수 시험이 있어 삭제할 수 없습니다. 먼저 회차 편집에서 급수를 모두 해제하세요.' }, 400)
  }
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
// admin_users 는 CBT·CARIS ARENA 공용 게이트 테이블 → 여기서 추가/삭제하면 양쪽 권한이 함께 반영됨.
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
  e: { question_id: string | null; bank_id: string | null; number: number | null; action: string; actor: string; detail?: unknown },
) {
  try {
    await admin.from('cbt_question_events').insert({
      question_id: e.question_id,
      bank_id: e.bank_id,
      number: e.number,
      action: e.action,
      actor: e.actor || null,
      detail: e.detail ?? null,
    })
  } catch { /* 로그 실패는 무시 */ }
}

// 문제은행 목록(급수별) + 은행별 문항 수(비삭제/활성). 문항 관리 셀렉터용.
async function bankListForAdmin(admin: any) {
  const { data, error } = await admin.from('question_banks').select('id, tier, title, active').order('tier', { ascending: true })
  if (error) return json({ error: error.message }, 400)
  const banks = data ?? []
  const out: any[] = []
  for (const b of banks) {
    const [t, a] = await Promise.all([
      admin.from('questions').select('id', { count: 'exact', head: true }).eq('bank_id', b.id).is('deleted_at', null),
      admin.from('questions').select('id', { count: 'exact', head: true }).eq('bank_id', b.id).eq('active', true).is('deleted_at', null),
    ])
    out.push({ ...b, questionCount: t.count ?? 0, activeCount: a.count ?? 0 })
  }
  return json({ banks: out })
}

// 등록시험 목록(회차×급수, round_id NOT NULL) + 각 시험의 뽑힌 세트 수. 시험문항 셀렉터용.
async function examListForAdmin(admin: any) {
  const { data, error } = await admin
    .from('exams')
    .select('id, slug, title, total_questions, active, round_id, tier, created_at')
    .not('round_id', 'is', null)
    .order('created_at', { ascending: true })
  if (error) return json({ error: error.message }, 400)
  const exams = data ?? []
  const counts: Record<string, number> = {}
  for (const ex of exams) {
    const { count } = await admin.from('exam_questions').select('id', { count: 'exact', head: true }).eq('exam_id', ex.id)
    counts[ex.id] = count ?? 0
  }
  return json({ exams: exams.map((ex: any) => ({ ...ex, questionCount: counts[ex.id], activeCount: counts[ex.id] })) })
}

// 한 은행의 문항 목록(비삭제, 번호순). 관리자에겐 correct_index·해설 포함.
async function questionList(admin: any, body: any) {
  const bankId = body?.bankId
  if (!bankId) return json({ error: 'bankId 필요' }, 400)
  const { data, error } = await admin
    .from('questions')
    .select('id, bank_id, number, subject, difficulty, topic, prompt, kind, choices, correct_index, answer_key, explanation, active')
    .eq('bank_id', bankId)
    .is('deleted_at', null)
    .order('number', { ascending: true })
    .limit(2000)
  if (error) return json({ error: error.message }, 400)
  return json({ rows: data ?? [] })
}

// 난이도(과목 하위분류) — 상/중/하 중 하나만 유효, 그 외/빈값은 null(미지정).
const DIFFICULTIES = ['상', '중', '하']
function normDifficulty(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return DIFFICULTIES.includes(s) ? s : null
}

// 개별 문항 추가/수정 — id 있으면 수정, 없으면 신규(같은 exam_id+number 있으면 덮어쓰기).
//  · 객관식(mc): 보기 4개 + 정답(0..3). 주관식(short): 보기/정답 없이 모범답안(answer_key).
async function questionUpsert(admin: any, body: any, actor: string) {
  const q = body?.question ?? {}
  const bankId = q.bankId
  if (!bankId) return json({ error: 'bankId 필요' }, 400)
  const number = Math.floor(Number(q.number))
  if (!Number.isFinite(number) || number < 1) return json({ error: '번호(1 이상)를 입력하세요.' }, 400)
  const subject = String(q.subject ?? '').trim()
  const prompt = String(q.prompt ?? '').trim()
  if (!subject || !prompt) return json({ error: '과목·지문은 필수입니다.' }, 400)
  const kind = q.kind === 'short' ? 'short' : 'mc'

  const row: Record<string, unknown> = {
    bank_id: bankId,
    number,
    subject,
    difficulty: normDifficulty(q.difficulty),
    topic: String(q.topic ?? '').trim(),
    prompt,
    kind,
    // 해설 — 객관식/주관식 공통(선택). 클라 비노출(출제/결과/채점 서빙에서 제외).
    explanation: String(q.explanation ?? '').trim() || null,
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
    const { error } = await admin.from('questions').upsert(row, { onConflict: 'bank_id,number' })
    if (error) return json({ error: error.message }, 400)
  }
  await logCbtEvent(admin, { question_id: q.id ?? null, bank_id: bankId, number, action: isNew ? 'import' : 'edit', actor, detail: { kind, single: true } })
  return json({ ok: true })
}

async function questionSetActive(admin: any, body: any, actor: string) {
  if (!body?.id) return json({ error: 'id 필요' }, 400)
  const active = !!body.active
  const { data: before } = await admin.from('questions').select('bank_id, number').eq('id', body.id).maybeSingle()
  const { error } = await admin.from('questions').update({ active }).eq('id', body.id)
  if (error) return json({ error: error.message }, 400)
  await logCbtEvent(admin, { question_id: body.id, bank_id: before?.bank_id ?? null, number: before?.number ?? null, action: active ? 'activate' : 'deactivate', actor })
  return json({ ok: true })
}

async function questionDelete(admin: any, body: any, actor: string) {
  if (!body?.id) return json({ error: 'id 필요' }, 400)
  const { data: before } = await admin.from('questions').select('bank_id, number').eq('id', body.id).maybeSingle()
  const { error } = await admin.from('questions').update({ deleted_at: new Date().toISOString(), active: false }).eq('id', body.id)
  if (error) return json({ error: error.message }, 400)
  await logCbtEvent(admin, { question_id: body.id, bank_id: before?.bank_id ?? null, number: before?.number ?? null, action: 'delete', actor })
  return json({ ok: true })
}

async function questionRestore(admin: any, body: any, actor: string) {
  if (!body?.id) return json({ error: 'id 필요' }, 400)
  const { data: before } = await admin.from('questions').select('bank_id, number').eq('id', body.id).maybeSingle()
  const { error } = await admin.from('questions').update({ active: true, deleted_at: null }).eq('id', body.id)
  if (error) return json({ error: error.message }, 400)
  await logCbtEvent(admin, { question_id: body.id, bank_id: before?.bank_id ?? null, number: before?.number ?? null, action: 'restore', actor })
  return json({ ok: true })
}

// 변경 이력(최신순). bankId 필터 + 각 이벤트에 현재 복구가능 여부.
async function questionEvents(admin: any, body: any) {
  let q = admin
    .from('cbt_question_events')
    .select('id, question_id, bank_id, number, action, actor, detail, created_at')
    .order('created_at', { ascending: false })
    .limit(1000)
  if (body?.bankId) q = q.eq('bank_id', body.bankId)
  const { data, error } = await q
  if (error) return json({ error: error.message }, 400)
  const events = data ?? []
  const ids = [...new Set(events.map((e: any) => e.question_id).filter(Boolean))]
  const statusById: Record<string, { active: boolean; deleted: boolean }> = {}
  const subjectById: Record<string, string> = {}
  if (ids.length) {
    // id 조회라 삭제된 문항의 과목도 나옴(급수/과목 필터용)
    const { data: qs } = await admin.from('questions').select('id, active, deleted_at, subject').in('id', ids)
    for (const r of qs ?? []) {
      statusById[r.id] = { active: !!r.active, deleted: r.deleted_at != null }
      subjectById[r.id] = r.subject ?? ''
    }
  }
  const withStatus = events.map((e: any) => {
    const st = e.question_id ? statusById[e.question_id] : undefined
    return { ...e, subject: e.question_id ? subjectById[e.question_id] ?? null : null, restorable: !!st && (!st.active || st.deleted) }
  })
  return json({ events: withStatus })
}

// 엑셀 임포트 — 항상 은행 뒤에 새 문항으로 이어붙인다(append). 엑셀의 '번호'는 파일 내 순번일 뿐,
// 은행 문항 번호와 무관 → 기존 문항을 덮어쓰지 않는다. 은행 현재 최대 번호 다음부터 순차 채번.
async function questionsImport(admin: any, body: any, actor: string) {
  const bankId = body?.bankId
  if (!bankId) return json({ error: 'bankId 필요' }, 400)
  const rows = Array.isArray(body?.rows) ? body.rows : []
  if (!rows.length) return json({ error: '가져올 문항이 없습니다.' }, 400)

  // 은행 내 최대 번호(삭제분 포함 — unique(bank_id,number)가 소프트삭제 행도 잡으므로) 다음부터 채번.
  const { data: maxRow } = await admin
    .from('questions')
    .select('number')
    .eq('bank_id', bankId)
    .order('number', { ascending: false })
    .limit(1)
    .maybeSingle()
  let next = Math.floor(Number(maxRow?.number ?? 0)) || 0

  const payload: any[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const subject = String(r?.subject ?? '').trim()
    const difficulty = normDifficulty(r?.difficulty)
    const topic = String(r?.topic ?? '').trim()
    const prompt = String(r?.prompt ?? '').trim()
    if (!subject || !prompt) return json({ error: `#${i + 1}행: 과목·지문은 필수` }, 400)
    const kind = r?.kind === 'short' ? 'short' : 'mc'
    // 해설 — 객관식/주관식 공통(선택). 클라 비노출.
    const explanation = String(r?.explanation ?? '').trim() || null
    next++ // 은행 뒤에 이어붙일 새 번호
    if (kind === 'short') {
      // 주관식 — 보기/정답번호 없음, 모범답안(answerKey)은 선택
      payload.push({ bank_id: bankId, number: next, subject, difficulty, topic, prompt, kind, choices: [], correct_index: null, answer_key: String(r?.answerKey ?? '').trim() || null, explanation, active: true, deleted_at: null })
      continue
    }
    const choices = Array.isArray(r?.choices) ? r.choices.map((c: unknown) => String(c ?? '').trim()) : []
    if (choices.length !== 4 || choices.some((c: string) => !c)) return json({ error: `#${i + 1}행: 보기 4개가 모두 필요` }, 400)
    const ci = Math.floor(Number(r?.correctIndex))
    if (!Number.isFinite(ci) || ci < 0 || ci > 3) return json({ error: `#${i + 1}행: 정답(1~4) 오류` }, 400)
    payload.push({ bank_id: bankId, number: next, subject, difficulty, topic, prompt, kind, choices, correct_index: ci, answer_key: null, explanation, active: true, deleted_at: null })
  }

  const { data, error } = await admin.from('questions').insert(payload).select('id')
  if (error) return json({ error: error.message }, 400)
  await logCbtEvent(admin, { question_id: null, bank_id: bankId, number: null, action: 'import', actor, detail: { count: payload.length } })
  return json({ ok: true, count: data?.length ?? payload.length })
}

// ---------- 등록시험 뽑기(문제은행 → exam_questions 세트) ----------
function shuffleIds(arr: string[]): string[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 등록시험에 그 급수 은행에서 추출 → exam_questions 교체 저장.
//  · cells(과목×난이도 배분표, 클라 buildDrawCells)가 오면: (과목·난이도·유형) 버킷별로 그 수만큼 뽑아 3:4:3 마진 충족.
//  · cells 없으면(구버전 호출): mc N + short M 랜덤(하위호환).
async function examDraw(admin: any, body: any, actor: string) {
  const examId = body?.examId
  if (!examId) return json({ error: 'examId 필요' }, 400)
  const { data: ex } = await admin.from('exams').select('id, tier').eq('id', examId).not('round_id', 'is', null).maybeSingle()
  if (!ex?.tier) return json({ error: '등록시험이 아닙니다.' }, 400)
  const { count: att } = await admin.from('exam_attempts').select('id', { count: 'exact', head: true }).eq('exam_id', examId)
  if ((att ?? 0) > 0 && !body?.replace) return json({ error: '이미 응시 기록이 있습니다. 재추출하려면 확인이 필요합니다.', needReplace: true }, 409)
  const { data: bank } = await admin.from('question_banks').select('id').eq('tier', ex.tier).maybeSingle()
  if (!bank?.id) return json({ error: `'${ex.tier}' 문제은행이 없습니다.` }, 400)

  const cells = body?.cells
  let picked: string[] = []

  if (cells && Array.isArray(cells.subjects) && Array.isArray(cells.diffs)) {
    // 과목×난이도×유형 버킷(활성만) → 배분표대로 뽑기
    const { data: qs } = await admin.from('questions').select('id, subject, difficulty, kind').eq('bank_id', bank.id).eq('active', true).is('deleted_at', null)
    const bucket: Record<string, string[]> = {}
    for (const q of qs ?? []) {
      ;(bucket[`${q.kind}|${q.subject}|${q.difficulty ?? ''}`] ??= []).push(q.id)
    }
    const subjects: string[] = cells.subjects
    const diffs: string[] = cells.diffs
    const shortfalls: string[] = []
    const drawKind = (kind: string, matrix: number[][] | null | undefined) => {
      if (!Array.isArray(matrix)) return
      for (let i = 0; i < subjects.length; i++) {
        for (let d = 0; d < diffs.length; d++) {
          const need = Math.max(0, Math.floor(Number(matrix[i]?.[d]) || 0))
          if (!need) continue
          const pool = shuffleIds(bucket[`${kind}|${subjects[i]}|${diffs[d]}`] ?? [])
          if (pool.length < need) shortfalls.push(`${subjects[i]} · ${diffs[d]} · ${kind === 'mc' ? '객관식' : '주관식'} 부족(보유 ${pool.length}/필요 ${need})`)
          picked.push(...pool.slice(0, need))
        }
      }
    }
    drawKind('mc', cells.mc)
    drawKind('short', cells.short)
    if (shortfalls.length) return json({ error: '문항 부족 — 채운 뒤 다시 추출하세요:\n' + shortfalls.join('\n') }, 400)
    if (picked.length === 0) return json({ error: '배분표가 비어 있습니다.' }, 400)
  } else {
    // 하위호환: mc/short 랜덤
    const mc = Math.max(0, Math.floor(Number(body?.mc) || 0))
    const short = Math.max(0, Math.floor(Number(body?.short) || 0))
    if (mc + short === 0) return json({ error: '뽑을 문항 수가 0입니다.' }, 400)
    const pick = async (kind: string, n: number): Promise<string[]> => {
      if (n === 0) return []
      const { data } = await admin.from('questions').select('id').eq('bank_id', bank.id).eq('kind', kind).eq('active', true).is('deleted_at', null)
      const ids = (data ?? []).map((r: any) => r.id)
      if (ids.length < n) throw new Error(`${kind === 'mc' ? '객관식' : '주관식'} 은행 문항 부족 (보유 ${ids.length} / 필요 ${n})`)
      return shuffleIds(ids).slice(0, n)
    }
    try {
      const [mcIds, shIds] = await Promise.all([pick('mc', mc), pick('short', short)])
      picked = [...mcIds, ...shIds]
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : '추출 실패' }, 400)
    }
  }

  await admin.from('exam_questions').delete().eq('exam_id', examId)
  const rows = picked.map((qid, i) => ({ exam_id: examId, question_id: qid, number: i + 1 }))
  const { error } = await admin.from('exam_questions').insert(rows)
  if (error) return json({ error: error.message }, 400)
  await admin.from('exams').update({ total_questions: rows.length }).eq('id', examId)
  await logCbtEvent(admin, { question_id: null, bank_id: bank.id, number: null, action: 'import', actor, detail: { draw: examId, count: rows.length } })
  return json({ ok: true, count: rows.length })
}

// 등록시험의 뽑힌 세트(번호순) + 문항 메타.
async function examSetList(admin: any, body: any) {
  const examId = body?.examId
  if (!examId) return json({ error: 'examId 필요' }, 400)
  const { data, error } = await admin
    .from('exam_questions')
    .select('number, question_id, questions(number, subject, difficulty, kind, prompt, active)')
    .eq('exam_id', examId)
    .order('number', { ascending: true })
  if (error) return json({ error: error.message }, 400)
  const rows = (data ?? []).map((r: any) => ({
    number: r.number,
    questionId: r.question_id,
    subject: r.questions?.subject ?? '',
    difficulty: r.questions?.difficulty ?? null,
    kind: r.questions?.kind ?? 'mc',
    prompt: r.questions?.prompt ?? '',
    bankNumber: r.questions?.number ?? null,
    active: r.questions?.active ?? true,
  }))
  return json({ rows })
}

// 등록시험 세트를 실제 응시 화면(CbtRunner)에서 눈으로 검수하기 위한 미리보기 페이로드.
// start-exam 과 동일한 StartExamResponse 형태지만 응시 기록(exam_attempt)을 만들지 않는다(attemptId='preview').
// ⚠️ 실제 응시와 동일 조건으로 검수 — correct_index·answer_key·explanation 은 절대 내보내지 않음.
async function examPreview(admin: any, body: any) {
  const examId = body?.examId
  if (!examId) return json({ error: 'examId 필요' }, 400)
  const { data: exam, error: exErr } = await admin
    .from('exams')
    .select('id, slug, title, duration_minutes')
    .eq('id', examId)
    .maybeSingle()
  if (exErr) return json({ error: exErr.message }, 400)
  if (!exam) return json({ error: '시험을 찾을 수 없습니다.' }, 404)
  const { data, error } = await admin
    .from('exam_questions')
    .select('number, questions(id, subject, prompt, kind, choices, active)')
    .eq('exam_id', examId)
    .order('number', { ascending: true })
  if (error) return json({ error: error.message }, 400)
  const questions = (data ?? [])
    .filter((r: any) => r.questions)
    .map((r: any) => ({
      id: r.questions.id,
      number: r.number,
      subject: r.questions.subject ?? '',
      prompt: r.questions.prompt ?? '',
      kind: r.questions.kind ?? 'mc',
      choices: r.questions.choices ?? [],
    }))
  if (questions.length === 0) {
    return json({ error: '아직 추출된 문항이 없습니다. 먼저 “문항 추출”을 하세요.' }, 400)
  }
  return json({
    attemptId: 'preview',
    exam: {
      slug: exam.slug,
      title: exam.title,
      durationMinutes: exam.duration_minutes,
      totalQuestions: questions.length,
    },
    startedAt: new Date().toISOString(),
    questions,
  })
}

// 대시보드 분석 — 추이·점수분포·합격률·급수·인증서·회차 퍼널·소요시간·문항 난이도·과목·풀.
async function cbtAnalytics(admin: any) {
  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const today = new Date(now).toISOString().slice(0, 10)
  const since7 = new Date(now - 7 * 864e5).toISOString()
  const since90 = new Date(now - 90 * 864e5).toISOString()
  const days: string[] = []
  for (let i = 89; i >= 0; i--) days.push(new Date(now - i * 864e5).toISOString().slice(0, 10))

  const [profRes, attRes, ansRes, qRes, examRes, roundRes, usersCnt, guestsCnt, attsCnt, atts7dCnt, signups7dCnt, qTot, qAct, pendGradeCnt] = await Promise.all([
    admin.from('profiles').select('created_at, is_anonymous').limit(10000),
    admin.from('exam_attempts').select('id, exam_id, round_id, status, started_at, submitted_at, created_at, total_correct, total_questions, cert_issued_at, result_release_at').limit(10000),
    admin.from('attempt_answers').select('attempt_id, question_id, is_correct').limit(50000),
    admin.from('questions').select('id, bank_id, number, subject, prompt, active, difficulty').is('deleted_at', null).limit(5000),
    admin.from('exams').select('id, title, slug, active, tier').order('created_at', { ascending: true }),
    admin.from('exam_rounds').select('id, kind, title_i18n, exam_date, apply_start_at, apply_end_at').eq('published', true),
    // CARIS는 게스트 응시 불가 → '회원'은 가입(비익명) 프로필만(CARIS ARENA 익명 세션 제외)
    admin.from('profiles').select('id', { count: 'exact', head: true }).eq('is_anonymous', false),
    admin.from('profiles').select('id', { count: 'exact', head: true }).eq('is_anonymous', true),
    admin.from('exam_attempts').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
    admin.from('exam_attempts').select('id', { count: 'exact', head: true }).eq('status', 'submitted').gte('submitted_at', since7),
    admin.from('profiles').select('id', { count: 'exact', head: true }).eq('is_anonymous', false).gte('created_at', since7),
    admin.from('questions').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    admin.from('questions').select('id', { count: 'exact', head: true }).eq('active', true).is('deleted_at', null),
    admin.from('attempt_answers').select('id, questions!inner(kind), exam_attempts!inner(status)', { count: 'exact', head: true }).eq('questions.kind', 'short').eq('review_status', 'pending').eq('exam_attempts.status', 'submitted'),
  ])

  const profs = profRes.data ?? []
  const allAtts = attRes.data ?? []
  const atts = allAtts.filter((a: any) => a.status === 'submitted')
  const ans = ansRes.data ?? []
  const qs = qRes.data ?? []
  const exams = examRes.data ?? []
  const rounds = roundRes.data ?? []
  const examTitle: Record<string, string> = {}
  for (const e of exams) examTitle[e.id] = e.title

  // 채점 완료 판정(합격컷 60) 헬퍼
  const pctOf = (a: any) => (a.total_questions && a.total_correct != null ? Math.round((a.total_correct / a.total_questions) * 100) : null)

  // 추이(90일): 가입 · 제출 · 인증서 발급
  const signupByDay: Record<string, number> = {}
  const submitByDay: Record<string, number> = {}
  const certByDay: Record<string, number> = {}
  days.forEach((d) => { signupByDay[d] = 0; submitByDay[d] = 0; certByDay[d] = 0 })
  for (const p of profs as any[]) {
    if (p.is_anonymous) continue // 가입 추이 = 가입 회원(비익명)만 — 게스트·CARIS ARENA 익명 세션 제외(누적 회원 KPI와 동일 기준)
    const k = (p.created_at ?? '').slice(0, 10)
    if (k in signupByDay && p.created_at >= since90) signupByDay[k]++
  }
  for (const a of atts as any[]) {
    const k = (a.submitted_at ?? a.created_at ?? '').slice(0, 10)
    if (k in submitByDay) submitByDay[k]++
    const ck = (a.cert_issued_at ?? '').slice(0, 10)
    if (ck && ck in certByDay) certByDay[ck]++
  }

  // 점수 분포 + 합격률(합격컷 60) + 평균점수 + 평균 소요시간 + 시험별 응시
  const scoreBands: Record<string, number> = { '0-59': 0, '60-69': 0, '70-79': 0, '80-89': 0, '90-100': 0 }
  let passN = 0
  let scoredN = 0
  let pctSum = 0
  let durSum = 0
  let durN = 0
  const byExam: Record<string, number> = {}
  for (const a of atts as any[]) {
    byExam[a.exam_id] = (byExam[a.exam_id] || 0) + 1
    if (a.started_at && a.submitted_at) {
      const mins = (new Date(a.submitted_at).getTime() - new Date(a.started_at).getTime()) / 60000
      if (mins > 0 && mins < 600) { durSum += mins; durN++ }
    }
    const pct = pctOf(a)
    if (pct != null) {
      scoredN++
      pctSum += pct
      if (pct >= 90) scoreBands['90-100']++
      else if (pct >= 80) scoreBands['80-89']++
      else if (pct >= 70) scoreBands['70-79']++
      else if (pct >= 60) scoreBands['60-69']++
      else scoreBands['0-59']++
      if (pct >= 60) passN++
    }
  }
  const byExamArr = exams.map((e: any) => ({ title: e.title, slug: e.slug, count: byExam[e.id] || 0 }))

  // 인증서 발급 · 미발급(합격했으나 미발급) · 결과 미공개 · 진행중 응시
  let certIssued = 0
  let certPending = 0
  let resultPending = 0
  let inProgress = 0
  for (const a of allAtts as any[]) {
    if (a.status === 'in_progress') inProgress++
    if (a.status !== 'submitted') continue
    if (a.cert_issued_at) certIssued++
    const pct = pctOf(a)
    if (pct != null && pct >= 60 && !a.cert_issued_at) certPending++
    if (!a.result_release_at || a.result_release_at > nowIso) resultPending++
  }

  // 회차별 현황(정기) — 응시→합격→발급 (exam_date 최신순, 응시 있는 회차 위주 최대 8개)
  const roundMeta: Record<string, any> = {}
  for (const r of rounds as any[]) roundMeta[r.id] = r
  const roundAgg: Record<string, { attempts: number; pass: number; cert: number }> = {}
  for (const a of atts as any[]) {
    if (!a.round_id) continue
    roundAgg[a.round_id] ??= { attempts: 0, pass: 0, cert: 0 }
    roundAgg[a.round_id].attempts++
    const pct = pctOf(a)
    if (pct != null && pct >= 60) roundAgg[a.round_id].pass++
    if (a.cert_issued_at) roundAgg[a.round_id].cert++
  }
  const roundStats = Object.entries(roundAgg)
    .map(([id, v]) => ({
      id,
      title: roundMeta[id]?.title_i18n?.ko ?? '(회차)',
      examDate: roundMeta[id]?.exam_date ?? null,
      kind: roundMeta[id]?.kind ?? 'regular',
      attempts: v.attempts,
      pass: v.pass,
      cert: v.cert,
    }))
    .sort((a, b) => (b.examDate || '').localeCompare(a.examDate || ''))
    .slice(0, 8)

  // 접수중 회차 수 + 다음 시험일(오늘 이후 가장 가까운 정기)
  let openRounds = 0
  let nextExamDate: string | null = null
  for (const r of rounds as any[]) {
    if (r.kind === 'rolling') continue
    if (r.apply_start_at && r.apply_end_at && r.apply_start_at <= nowIso && nowIso <= r.apply_end_at) openRounds++
    if (r.exam_date && r.exam_date >= today && (!nextExamDate || r.exam_date < nextExamDate)) nextExamDate = r.exam_date
  }

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
      exam: '', // 문항은 이제 은행 소속(등록시험 아님) — 난이도 목록의 시험 라벨은 미사용
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

  // 급수(tier)별 실집계 — 응시→시험(exam.tier)로 급수 귀속, 답안은 응시가 속한 급수로 귀속.
  const examTier: Record<string, string | null> = {}
  for (const e of exams as any[]) examTier[e.id] = e.tier ?? null
  const attemptTier: Record<string, string | null> = {}
  for (const a of allAtts as any[]) attemptTier[a.id] = examTier[a.exam_id] ?? null
  type TAgg = { attempts: number; pass: number; hist: number[]; subj: Record<string, { n: number; c: number }>; diff: Record<string, { n: number; c: number }>; q: Record<string, { n: number; c: number }> }
  const tierAgg: Record<string, TAgg> = {}
  const ensureTier = (t: string): TAgg => (tierAgg[t] ??= { attempts: 0, pass: 0, hist: [0, 0, 0, 0, 0], subj: {}, diff: {}, q: {} })
  for (const a of atts as any[]) {
    const t = examTier[a.exam_id]
    if (!t) continue
    const T = ensureTier(t)
    T.attempts++
    const pct = pctOf(a)
    if (pct != null) {
      if (pct >= 90) T.hist[4]++
      else if (pct >= 80) T.hist[3]++
      else if (pct >= 70) T.hist[2]++
      else if (pct >= 60) T.hist[1]++
      else T.hist[0]++
      if (pct >= 60) T.pass++
    }
  }
  for (const r of ans as any[]) {
    const t = attemptTier[r.attempt_id]
    if (!t) continue
    const T = ensureTier(t)
    const q = qMap[r.question_id]
    const sk = q?.subject ?? '(기타)'
    T.subj[sk] ??= { n: 0, c: 0 }; T.subj[sk].n++; if (r.is_correct) T.subj[sk].c++
    const dk = q?.difficulty
    if (dk) { T.diff[dk] ??= { n: 0, c: 0 }; T.diff[dk].n++; if (r.is_correct) T.diff[dk].c++ }
    T.q[r.question_id] ??= { n: 0, c: 0 }; T.q[r.question_id].n++; if (r.is_correct) T.q[r.question_id].c++
  }
  const DIFF_ORDER = ['상', '중', '하']
  const tiers = Object.entries(tierAgg).map(([tier, T]) => {
    const qd = Object.entries(T.q)
      .filter(([, v]) => v.n >= 3)
      .map(([id, v]) => ({
        id,
        number: qMap[id]?.number ?? 0,
        subject: qMap[id]?.subject ?? '',
        prompt: qMap[id]?.prompt ?? '',
        exam: '',
        active: qMap[id]?.active ?? true,
        n: v.n,
        rate: Math.round((v.c / v.n) * 100),
      }))
      .sort((a, b) => a.rate - b.rate)
    return {
      tier,
      attempts: T.attempts,
      pass: T.pass,
      passRate: T.attempts ? Math.round((T.pass / T.attempts) * 100) : 0,
      scoreHist: T.hist,
      subjects: Object.entries(T.subj).map(([subject, v]) => ({ subject, n: v.n, rate: Math.round((v.c / v.n) * 100) })).sort((a, b) => a.rate - b.rate),
      difficulty: DIFF_ORDER.filter((d) => T.diff[d]).map((d) => ({ level: d, n: T.diff[d].n, rate: Math.round((T.diff[d].c / T.diff[d].n) * 100) })),
      hard: qd.slice(0, 4),
      easy: qd.slice(-4).reverse(),
    }
  })

  return json({
    overview: {
      users: usersCnt.count ?? profs.length,
      guests: guestsCnt.count ?? 0,
      attemptsAll: attsCnt.count ?? atts.length,
      attempts7d: atts7dCnt.count ?? 0,
      questions: qTot.count ?? qs.length,
      questionsActive: qAct.count ?? 0,
      exams: exams.length,
      signups7d: signups7dCnt.count ?? 0,
      certIssued,
      certPending,
      resultPending,
      inProgress,
      pendingGrading: pendGradeCnt.count ?? 0,
      openRounds,
      nextExamDate,
    },
    days,
    signupByDay,
    submitByDay,
    certByDay,
    scoreBands,
    passRate: scoredN ? Math.round((passN / scoredN) * 100) : 0,
    scoredN,
    avgScore: scoredN ? Math.round(pctSum / scoredN) : 0,
    avgDurationMin: durN ? Math.round(durSum / durN) : 0,
    byExam: byExamArr,
    rounds: roundStats,
    qHardest: qDiff.slice(0, 6),
    qEasiest: qDiff.slice(-6).reverse(),
    subjectCorrect,
    pool,
    tiers,
  })
}

// 회원 목록 — 프로필 + 이메일 + 응시수 + 마지막 활동.
// 합격선 — my-attempts/index.ts 의 PASS_RATIO 와 같은 값(0.6)을 유지할 것.
// 자격증은 별도 테이블이 없어 "합격 + 결과공개일 경과" 를 발급 가능으로 본다(응시 기록에서 계산).
const CBT_PASS_RATIO = 0.6

async function cbtUsers(admin: any) {
  // CARIS는 익명 응시 불가(start-exam이 게스트 차단) → CARIS ARENA 게스트(is_anonymous)는 회원목록에서 제외.
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, display_name, is_anonymous, created_at')
    .eq('is_anonymous', false)
    .order('created_at', { ascending: false })
    .limit(5000)
  const { data: atts } = await admin
    .from('exam_attempts')
    .select('user_id, exam_id, submitted_at, total_correct, total_questions')
    .eq('status', 'submitted')
    .limit(20000)
  // 합격 시험의 급수를 알려면 시험명이 필요하다(exam_attempts 엔 exam_id 만 있다).
  const examTitle: Record<string, string> = {}
  {
    const ids = [...new Set((atts ?? []).map((a: any) => a.exam_id).filter(Boolean))]
    if (ids.length) {
      const { data: ex } = await admin.from('exams').select('id, title').in('id', ids)
      for (const e of ex ?? []) examTitle[(e as any).id] = (e as any).title
    }
  }
  const cnt: Record<string, number> = {}
  const pass: Record<string, number> = {} // 합격 건수(60% 이상)
  const passTitles: Record<string, string[]> = {} // 합격한 시험명(→ 프론트에서 급수 칩으로)
  const last: Record<string, string> = {}
  for (const a of atts ?? []) {
    const u = (a as any).user_id
    cnt[u] = (cnt[u] || 0) + 1
    const tq = (a as any).total_questions, tc = (a as any).total_correct
    if (tq && tc != null && tc >= Math.ceil(tq * CBT_PASS_RATIO)) {
      pass[u] = (pass[u] || 0) + 1
      // 급수는 시험명에서 파싱한다 — 규칙은 프론트 certNo.ts(gradeOfTitle) 한 곳에만 둔다.
      const t = (a as any).exam_id ? examTitle[(a as any).exam_id] : null
      if (t) (passTitles[u] ??= []).push(t)
    }
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
    passed: pass[p.id] ?? 0,
    passedTitles: passTitles[p.id] ?? [],
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
    .select('id, exam_id, status, total_correct, total_questions, submitted_at, created_at, result_release_at')
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
    // 합격 = 전체의 60% 이상(my-attempts 의 PASS_RATIO 와 같은 규칙). 미채점·미제출은 null.
    passed: a.status === 'submitted' && a.total_questions
      ? a.total_correct >= Math.ceil(a.total_questions * CBT_PASS_RATIO)
      : null,
    // 자격증은 테이블이 없고 응시 기록에서 계산한다 — 합격 + 결과 공개일 경과.
    released: !a.result_release_at || new Date(a.result_release_at) <= new Date(),
  }))
  return json({ attempts })
}

// ---------- 어드민: 지역 오배정 정정 (T9) ----------
// 락된 회원의 국가/지역을 강제 정정(admin_set_region RPC = 함수-내부 GUC 로 트리거 우회).
// country 는 region 접두(예: KR-26 → KR)와 일치해야 함. region_code 는 regions FK 로 검증됨.
async function setRegion(admin: any, body: any) {
  const uid = String(body?.uid ?? '').trim()
  const region = String(body?.region ?? '').trim()
  const country = String(body?.country ?? '').trim()
  if (!uid) return json({ error: 'uid 가 필요합니다.' }, 400)
  if (!region) return json({ error: 'region 이 필요합니다.' }, 400)
  if (country !== region.slice(0, 2)) return json({ error: '국가·지역 접두가 일치하지 않습니다.' }, 400)
  const { error } = await admin.rpc('admin_set_region', { p_uid: uid, p_country: country, p_region: region })
  if (error) return json({ error: error.message }, 400)
  return json({ ok: true })
}

// ---------- 어드민: 이북(전자책) ----------
// 본문 HTML·표지 파일은 클라가 스토리지에 직접 올리고(관리자 전용 정책), 여기선 메타데이터만 다룬다.
async function ebookList(admin: any) {
  const { data, error } = await admin
    .from('ebooks')
    .select('id, title, author, description, cover_url, price, target_level, storage_path, published, sort_order, created_at, updated_at, translations')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
  if (error) return json({ error: error.message }, 400)

  // 책별 구매 수 — 권수가 많지 않으므로 전량 조회 후 집계.
  const counts: Record<string, number> = {}
  const { data: purchases } = await admin.from('ebook_purchases').select('ebook_id')
  for (const p of purchases ?? []) counts[(p as any).ebook_id] = (counts[(p as any).ebook_id] ?? 0) + 1

  const ebooks = (data ?? []).map((b: any) => ({
    id: b.id,
    title: b.title,
    author: b.author ?? null,
    description: b.description ?? null,
    coverUrl: b.cover_url ?? null,
    price: b.price ?? 0,
    targetLevel: b.target_level ?? null,
    storagePath: b.storage_path,
    published: !!b.published,
    sortOrder: b.sort_order ?? 0,
    createdAt: b.created_at,
    buyers: counts[b.id] ?? 0,
    translations: b.translations ?? {},
  }))
  return json({ ebooks })
}

// 추천 대상 레벨 파싱 — 1~7 밖이거나 빈 값이면 null(레벨 무관).
function levelOrNull(v: any): number | null {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n >= 1 && n <= 7 ? n : null
}

async function ebookUpsert(admin: any, body: any) {
  const e = body?.ebook ?? {}
  const title = String(e.title ?? '').trim()
  const storagePath = String(e.storagePath ?? '').trim()
  if (!title) return json({ error: '제목은 필수입니다.' }, 400)
  if (!storagePath) return json({ error: '이북 HTML 파일을 업로드해 주세요.' }, 400)

  const row = {
    title,
    author: e.author ? String(e.author).trim() : null,
    description: e.description ? String(e.description).trim() : null,
    cover_url: e.coverUrl ? String(e.coverUrl).trim() : null,
    price: Math.max(0, Math.floor(Number(e.price ?? 0)) || 0),
    // 추천 대상 레벨(1~7). 미지정 = null → 결과창 추천에서 뒤로 밀린다.
    target_level: levelOrNull(e.targetLevel),
    storage_path: storagePath,
    published: !!e.published,
    sort_order: Math.floor(Number(e.sortOrder ?? 0)) || 0,
    updated_at: new Date().toISOString(),
    // 언어별 본문·표지·메타. 클라가 번역 파이프라인을 돌린 결과를 통째로 넘긴다(없으면 빈 객체 유지).
    translations: e.translations && typeof e.translations === 'object' ? e.translations : {},
  }

  if (e.id) {
    const { error } = await admin.from('ebooks').update(row).eq('id', e.id)
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true, id: e.id })
  }
  const { data, error } = await admin.from('ebooks').insert(row).select('id').maybeSingle()
  if (error) return json({ error: error.message }, 400)
  return json({ ok: true, id: data?.id ?? null })
}

// 순서 재부여 — 목록에서 ↑↓ 로 바꾼 전체 순서(ids)를 받아 sort_order 를 10 단위로 다시 매긴다.
// (FAQ 의 faqReorder 와 동일 패턴. ebooks 는 분류가 없어 단일 평면 목록.)
async function ebookReorder(admin: any, body: any) {
  const ids = Array.isArray(body?.ids) ? (body.ids as string[]) : []
  if (!ids.length) return json({ error: 'ids 필요' }, 400)
  for (let i = 0; i < ids.length; i++) {
    const { error } = await admin.from('ebooks').update({ sort_order: (i + 1) * 10 }).eq('id', ids[i])
    if (error) return json({ error: error.message }, 400)
  }
  return json({ ok: true })
}

// 삭제 = 메타데이터 + 본문 파일(번역본 포함). 구매 기록은 FK cascade 로 함께 사라진다(환불/회수와 동일 취급).
async function ebookDelete(admin: any, body: any) {
  const id = String(body?.id ?? '').trim()
  if (!id) return json({ error: 'id 가 필요합니다.' }, 400)
  const { data: b } = await admin.from('ebooks').select('storage_path, translations').eq('id', id).maybeSingle()
  const { error } = await admin.from('ebooks').delete().eq('id', id)
  if (error) return json({ error: error.message }, 400)
  // 원문 + 언어별 번역본을 함께 지운다(같은 uuid 폴더에 모여 있지만 경로를 직접 모아 지우는 게 확실하다).
  const paths = [
    b?.storage_path,
    ...Object.values((b?.translations ?? {}) as Record<string, { path?: string }>).map((t) => t?.path),
  ].filter(Boolean) as string[]
  if (paths.length) {
    try { await admin.storage.from('ebooks').remove(paths) } catch { /* 파일만 남아도 무해 */ }
  }
  return json({ ok: true })
}

// 구매자 목록(책 1권) — 이름/이메일/구매일.
async function ebookBuyers(admin: any, body: any) {
  const id = String(body?.id ?? '').trim()
  if (!id) return json({ error: 'id 가 필요합니다.' }, 400)
  const { data } = await admin
    .from('ebook_purchases')
    .select('user_id, price_paid, source, created_at')
    .eq('ebook_id', id)
    .order('created_at', { ascending: false })
    .limit(500)
  const rows = data ?? []
  const userIds = [...new Set(rows.map((r: any) => r.user_id))]
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
  return json({
    buyers: rows.map((r: any) => ({
      userId: r.user_id,
      name: nameMap[r.user_id] ?? null,
      email: emailMap[r.user_id] ?? null,
      pricePaid: r.price_paid ?? 0,
      source: r.source ?? 'demo',
      createdAt: r.created_at,
    })),
  })
}
// ---------- 유사채팅(pseudo-chat) 보드 관리 ----------
// 2026-08-05 개편. 옛 구조(신고 건별 목록 + 보류 목록 두 표)의 문제:
//   · 같은 메시지에 신고 3건이면 똑같은 줄이 3개 생겼다(버튼도 3벌 → 하나 누르면 셋이 같이 바뀜).
//   · 처리한 것과 안 한 것이 한 표에 섞여 있어 할 일이 몇 개인지 셀 수 없었다.
// 지금은 **메시지 1건 = 1줄**, 그리고 `처리 대기 / 처리 완료` 두 큐로 나눈다.
//
// 큐 판정(단일 출처):
//   대기 = 삭제 안 됨 AND (열린 신고가 있음 OR mod_status <> 'ok')   ← 관리자 결정이 남은 것
//   완료 = 대기가 아니면서, 관리자가 손댄 흔적이 있는 것
//          (hidden_by='admin' 이거나, resolved/dismissed 신고가 달려 있음)
// ⚠️ 평범한 메시지(신고 0건·ok)는 어느 큐에도 안 뜬다 — 여긴 채팅 로그 뷰어가 아니다.
const CHAT_SCAN_CAP = 1000 // 후보 id 스캔 상한. 초과분은 잘린다(관리자 화면이라 실용 우선).

// 후보 메시지 id 를 모아 한 벌의 화면 행으로 만든다. 메시지·신고·신고자 이름을 각각 한 번씩만 조회한다.
async function chatBuildRows(admin: any, ids: number[], room: string | null) {
  if (!ids.length) return []
  let q = admin
    .from('chat_messages')
    .select('id, user_id, display_name, is_anon, body, room, mod_status, deleted_at, hidden_by, created_at')
    .in('id', ids)
  if (room) q = q.eq('room', room)
  const { data: msgs } = await q
  const rows = msgs ?? []
  if (!rows.length) return []

  const msgIds = rows.map((m: any) => m.id)
  const { data: reps } = await admin
    .from('chat_reports')
    .select('id, message_id, reporter_id, reason, status, created_at')
    .in('message_id', msgIds)
    .order('created_at', { ascending: false })
  const repRows = reps ?? []

  // 신고자 이름 — chat_reports 엔 uuid 만 있다. uuid 를 모아 profiles 를 한 번에 읽는다(N+1 방지).
  const reporterIds = [...new Set(repRows.map((r: any) => r.reporter_id).filter((v: unknown) => v != null))]
  const nameMap: Record<string, string> = {}
  if (reporterIds.length) {
    const { data: profs } = await admin.from('profiles').select('id, display_name').in('id', reporterIds)
    for (const p of profs ?? []) {
      const nm = String((p as any).display_name ?? '').trim()
      if (nm) nameMap[(p as any).id] = nm
    }
  }

  const byMsg: Record<string, any[]> = {}
  for (const r of repRows) {
    ;(byMsg[r.message_id] ??= []).push({
      id: r.id,
      reporterId: r.reporter_id,
      // 프로필이 없거나 이름이 비어 있으면 null → 화면이 uuid 앞 8자로 폴백한다(탈퇴 계정 등).
      reporterName: r.reporter_id != null ? nameMap[r.reporter_id] ?? null : null,
      reason: r.reason,
      status: r.status,
      createdAt: r.created_at,
    })
  }

  return rows
    .map((m: any) => {
      const reports = byMsg[m.id] ?? []
      const openCount = reports.filter((r: any) => r.status === 'open').length
      return {
        id: m.id,
        userId: m.user_id,
        displayName: m.display_name,
        isAnon: m.is_anon,
        body: m.body,
        room: m.room,
        modStatus: m.mod_status,
        deletedAt: m.deleted_at,
        hiddenBy: m.hidden_by,
        createdAt: m.created_at,
        reportCount: reports.length,
        openCount,
        reports,
      }
    })
    .sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

// 큐별 후보 id 집합. 두 축(열린 신고 / 공개 안 된 메시지)을 각각 훑어 합집합을 만든다.
async function chatQueueIds(admin: any): Promise<number[]> {
  const { data: openReps } = await admin
    .from('chat_reports')
    .select('message_id')
    .eq('status', 'open')
    .not('message_id', 'is', null)
    .limit(CHAT_SCAN_CAP)
  const { data: notOk } = await admin
    .from('chat_messages')
    .select('id')
    .neq('mod_status', 'ok')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(CHAT_SCAN_CAP)
  const ids = new Set<number>()
  for (const r of openReps ?? []) ids.add(Number((r as any).message_id))
  for (const m of notOk ?? []) ids.add(Number((m as any).id))
  return [...ids]
}

async function chatDoneIds(admin: any, queue: Set<number>): Promise<number[]> {
  const { data: adminHidden } = await admin
    .from('chat_messages')
    .select('id')
    .eq('hidden_by', 'admin')
    .order('created_at', { ascending: false })
    .limit(CHAT_SCAN_CAP)
  const { data: closedReps } = await admin
    .from('chat_reports')
    .select('message_id')
    .in('status', ['resolved', 'dismissed'])
    .not('message_id', 'is', null)
    .limit(CHAT_SCAN_CAP)
  const ids = new Set<number>()
  for (const m of adminHidden ?? []) ids.add(Number((m as any).id))
  for (const r of closedReps ?? []) ids.add(Number((r as any).message_id))
  // 대기에 있는 건 완료에 넣지 않는다 — 한 메시지가 두 탭에 동시에 뜨면 옛 구조의 중복 문제가 되살아난다.
  return [...ids].filter((id) => !queue.has(id))
}

// 검수 목록 — tab='queue'(기본) | 'done'. 방 필터는 두 탭 공통.
// 합집합 + 방 필터 때문에 총건수를 SQL count 로 못 낸다 → 후보를 모아 메모리에서 자르고 센다(상한 CHAT_SCAN_CAP).
//
// ⚠️ 방별 건수(rooms)는 **방 필터를 적용하기 전 값**이다. 화면이 이걸 칩 줄로 깔아
//    "안 열어봐도 어느 방에 몇 건인지" 를 보여주기 때문 — 필터 후 값으로 세면
//    한 방을 고르는 순간 나머지 방 칩이 사라져서 새 신고를 놓친다.
//    나라가 170개여도 칩은 **큐에 실제로 뜬 방만** 생기므로 평소엔 한 줄이다.
async function chatModList(admin: any, body: any) {
  const tab = body?.tab === 'done' ? 'done' : 'queue'
  const limit = Math.min(Math.max(1, Math.floor(body?.limit ?? 50)), 200)
  const offset = Math.max(0, Math.floor(body?.offset ?? 0))
  const roomRaw = String(body?.room ?? '').trim()
  const room = !roomRaw || roomRaw === 'all' ? null : roomRaw

  const queueIds = await chatQueueIds(admin)
  const queueSet = new Set(queueIds)
  const doneIds = await chatDoneIds(admin, queueSet)

  // 방 무관 전체를 한 번씩만 만들고, 방 필터는 메모리에서 건다(같은 조회를 두 번 하지 않기 위해).
  const queueAll = await chatBuildRows(admin, queueIds, null)
  const doneAll = await chatBuildRows(admin, doneIds, null)
  const all = tab === 'queue' ? queueAll : doneAll

  const inRoom = room ? all.filter((r: any) => (r.room || 'global') === room) : all
  const rows = inRoom.slice(offset, offset + limit)

  // 방별 건수 — 현재 탭 기준. 건수 많은 순(동수면 방 이름 순)으로 정렬해 터진 방이 항상 앞에 온다.
  const perRoom: Record<string, number> = {}
  for (const r of all) {
    const k = (r as any).room || 'global'
    perRoom[k] = (perRoom[k] ?? 0) + 1
  }
  const rooms = Object.entries(perRoom)
    .map(([k, n]) => ({ room: k, count: n }))
    .sort((a, b) => b.count - a.count || a.room.localeCompare(b.room))

  return json({
    tab,
    rows,
    total: inRoom.length,
    counts: { queue: queueAll.length, done: doneAll.length },
    rooms,
    truncated: queueIds.length >= CHAT_SCAN_CAP,
  })
}

// 메시지 강제 숨김 — 소프트 삭제 + 관련 열린 신고를 resolved 로 정리.
//  hidden_by='admin' 을 남긴다: 이게 있어야 '숨김 해제'가 본인 삭제 글을 되살리지 않는다.
async function chatHide(admin: any, body: any) {
  const messageId = Number(body?.message_id)
  if (!Number.isFinite(messageId)) return json({ error: 'message_id 가 필요합니다.' }, 400)
  const nowIso = new Date().toISOString()
  const { error } = await admin
    .from('chat_messages')
    .update({ deleted_at: nowIso, updated_at: nowIso, hidden_by: 'admin' })
    .eq('id', messageId)
  if (error) return json({ error: error.message }, 500)
  await admin.from('chat_reports').update({ status: 'resolved' }).eq('message_id', messageId).eq('status', 'open')
  return json({ ok: true })
}

// 숨김 해제 — 관리자가 숨긴 것만. 작성자가 스스로 지운 글(hidden_by='self')은 되살리지 않는다.
//  hidden_by 가 null 인 옛 기록은 허용한다(개편 전엔 구분이 없었다 — 기존 동작 유지).
async function chatUnhide(admin: any, body: any) {
  const messageId = Number(body?.message_id)
  if (!Number.isFinite(messageId)) return json({ error: 'message_id 가 필요합니다.' }, 400)
  const { data: row } = await admin
    .from('chat_messages')
    .select('id, hidden_by')
    .eq('id', messageId)
    .maybeSingle()
  if (!row) return json({ error: '메시지를 찾을 수 없습니다.' }, 404)
  if (row.hidden_by === 'self') {
    return json({ error: '작성자가 스스로 지운 글이라 되살릴 수 없습니다.' }, 409)
  }
  const { error } = await admin
    .from('chat_messages')
    .update({ deleted_at: null, hidden_by: null, updated_at: new Date().toISOString() })
    .eq('id', messageId)
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true })
}

// 문제없음 — 공개 상태로 되돌리고(mod_status='ok') 열린 신고를 전부 무효 처리한다.
//  옛 '승인'(보류 해제)과 '무효'(오신고)를 하나로 합쳤다. 관리자가 내리는 결정은 어차피
//  "이 글 그냥 둬도 된다" 하나이고, 둘을 갈라두면 신고가 남아 큐에서 안 빠졌다.
async function chatApprove(admin: any, body: any) {
  const messageId = Number(body?.message_id)
  if (!Number.isFinite(messageId)) return json({ error: 'message_id 가 필요합니다.' }, 400)
  const { error } = await admin
    .from('chat_messages')
    .update({ mod_status: 'ok', updated_at: new Date().toISOString() })
    .eq('id', messageId)
  if (error) return json({ error: error.message }, 500)
  await admin.from('chat_reports').update({ status: 'dismissed' }).eq('message_id', messageId).eq('status', 'open')
  return json({ ok: true })
}

// 완전 삭제 — 행 자체를 지운다. **되돌릴 수 없다.**
//  숨김(소프트 삭제)과 나눠둔 이유: 숨김은 오판정 복구·반복 위반자 추적·처리 기록이 남아야 해서 행을 남기는데,
//  개인정보·불법물이 본문에 담긴 경우엔 그 행이 남아 있는 것 자체가 문제라 물리 삭제가 필요하다.
//  ⚠️ chat_reports.message_id 는 on delete set null 이라, 메시지만 지우면 신고가 고아로 남아
//     '처리 완료' 큐에 message 없는 유령 줄이 생긴다 → 신고를 먼저 지운다.
async function chatPurge(admin: any, body: any) {
  const messageId = Number(body?.message_id)
  if (!Number.isFinite(messageId)) return json({ error: 'message_id 가 필요합니다.' }, 400)
  const { error: repErr } = await admin.from('chat_reports').delete().eq('message_id', messageId)
  if (repErr) return json({ error: repErr.message }, 500)
  const { error } = await admin.from('chat_messages').delete().eq('id', messageId)
  if (error) return json({ error: error.message }, 500)
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
      case 'bankListForAdmin': return await bankListForAdmin(admin)
      case 'examDraw': return await examDraw(admin, body, email)
      case 'examSetList': return await examSetList(admin, body)
      case 'examPreview': return await examPreview(admin, body)
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
      case 'setRegion': return await setRegion(admin, body)
      case 'ebookList': return await ebookList(admin)
      case 'ebookUpsert': return await ebookUpsert(admin, body)
      case 'ebookReorder': return await ebookReorder(admin, body)
      case 'ebookDelete': return await ebookDelete(admin, body)
      case 'ebookBuyers': return await ebookBuyers(admin, body)
      case 'chatModList': return await chatModList(admin, body)
      case 'chatHide': return await chatHide(admin, body)
      case 'chatUnhide': return await chatUnhide(admin, body)
      case 'chatApprove': return await chatApprove(admin, body)
      case 'chatPurge': return await chatPurge(admin, body)
      default: return json({ error: '알 수 없는 action' }, 400)
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
