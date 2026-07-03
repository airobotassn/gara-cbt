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
      default: return json({ error: '알 수 없는 action' }, 400)
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
