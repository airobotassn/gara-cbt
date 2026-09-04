// admin: 관리자 전용 백오피스 API (service role). CBT(자격검정) 응시 조회용.
//  - 인증: 루트(ROOT_ADMIN) 또는 admin_users 테이블 등록 이메일만 통과(기존 게이트 유지)
//  - ⚠️ 게이트에 **액션별 권한이 없다** — admin_users 에 이메일만 있으면 아래 액션 대부분이 열린다.
//    그래서 돈·응시 자격을 만드는 액션(manageAdmins · examTicketGrant · examTicketVoid)만
//    isRoot 를 인자로 넘겨 루트 전용으로 따로 막는다. 새 액션을 추가할 때 이 구분을 확인할 것.
//  - ⚠️ _shared 사용 → CLI 로만 배포할 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser, questionTranslated, SUPPORTED_LANGS } from '../_shared/lib.ts'
import { refreshRates } from '../_shared/fx.ts'
import { EXAM_ROUND_COLS, TIER_LABEL, attemptPassed, examWindowState, grantExamTicket, isTierLocked, ticketExpired, voidTicket } from '../_shared/exam-tickets.ts'
import { isExamMonth, monthOfExamDate, scheduleForMonth } from '../_shared/exam-schedule.ts'
import { logQuestionEvent, readQuestionHistory } from '../_shared/question-history.ts'
import { ROOT_ADMIN } from './constants.ts'
import { handleReform } from './reform.ts'

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
      const { data: au } = await admin.rpc('admin_user_emails')
      for (const x of au ?? []) emailMap[(x as any).id] = (x as any).email ?? ''
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
    .select('id, number, selected_index, answer_text, is_correct, review_status, graded_by, graded_at, time_spent, questions(subject, prompt, kind, choices, correct_index, answer_key)')
    .eq('attempt_id', aid)
    .order('number', { ascending: true })

  const answers = (rows ?? []).map((r: any) => ({
    answerId: r.id,
    number: r.number,
    subject: r.questions?.subject ?? null,
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
    .select('id, title_i18n, exam_date')
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
    .select('id, attempt_id, number, answer_text, is_correct, review_status, graded_by, graded_at, questions!inner(subject, prompt, kind, answer_key), exam_attempts!inner(user_id, status, submitted_at, exam_id, round_id)')
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
      const { data: au } = await admin.rpc('admin_user_emails')
      for (const x of au ?? []) emailMap[(x as any).id] = (x as any).email ?? ''
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

// ---------- Gemini 텍스트 번역 (공지·FAQ·게시판 분류·시험 회차) ----------
// 여기서 번역하는 것들은 한 건에 호출 1~2회뿐이지만, **지갑은 따로 써야 한다**(2026-08-20).
//
// ⚠️ 구글 무료 한도는 **API 키가 아니라 구글 프로젝트 단위**다. 그래서 키를 나누는 게 아니라
//    프로젝트를 나눠야 실제로 갈린다(우리는 프로젝트별로 키를 하나씩 발급해 시크릿에 꽂는다).
// ⚠️ 예전엔 문항 번역(translate-questions)과 `GEMINI_API_KEY_TRANSLATE` 를 같이 썼다. 문항은 한 번에
//    수백 건이라 그 프로젝트의 **하루치를 태울 수 있는데**, 그러면 호출 두 번짜리 공지 저장까지
//    그날 내내 같이 막혔다. 공지는 남에게 피해를 안 주면서 피해만 보는 쪽이라 떼어냈다.
// 폴백은 키를 아직 안 꽂았을 때 동작만 유지하기 위한 것이다 — 운영에서는 NOTICE 키를 둘 것.
const GEMINI_API_KEY =
  Deno.env.get('GEMINI_API_KEY_NOTICE') ??
  Deno.env.get('GEMINI_API_KEY_TRANSLATE') ??
  Deno.env.get('GEMINI_API_KEY')
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

// ⚠️ 재시도 방지용 상한(경고용이 아니다). 이만큼 큰 요청은 어차피 거절되는데, 아래 루프가
//    3번을 던져서 같은 페이로드를 세 번 실어 보낸다(7.4MB 짜리 공지에서 22MB 를 허공에 날렸다).
//    정상 본문은 여기 근처도 안 온다 — 기존 공지들이 162~286자다.
const GEMINI_MAX_CHARS = 200_000

async function geminiJson(sys: string, user: string, maxTokens: number): Promise<string> {
  if (user.length > GEMINI_MAX_CHARS) {
    throw new Error(`본문이 너무 커서(${user.length.toLocaleString()}자) 번역을 건너뛰었습니다.`)
  }
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

// ---------- 모델 응답 읽기 — 값 하나만 떼어낸다 ----------
// ⚠️ 응답 전체를 통째로 JSON.parse 하면 **뒤에 붙은 군더더기 하나가 멀쩡한 번역을 통째로 버린다.**
//    2026-08-25 실제로 겪었다: 31조각 × 5개국어가 온전히 다 온 167줄짜리 객체였는데, 닫는 `}` 다음
//    줄에 뭔가가 더 있어서 `position 5541 (line 168 column 1)` 로 거절됐다 → 공지가 한국어로만 저장.
//    모델이 뭘 덧붙일지는 우리 손 밖이라 프롬프트로 부탁해봐야 소용없다. 안 보면 그만이다.
// ⚠️ 정상 응답은 첫 줄 그대로 통과시킨다(fast path). 멀쩡히 돌던 게 이 변경으로 달라질 여지를 두지 않는다.
function firstJsonValue(src: string): string {
  const start = src.indexOf('{')
  if (start < 0) throw new Error('JSON 객체가 없다')
  let depth = 0
  let inStr = false
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (inStr) {
      if (c === '\\') i++ // 이스케이프된 따옴표에 속지 않는다
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') {
      if (--depth === 0) return src.slice(start, i + 1) // 여기까지가 우리가 원한 값. 뒤는 안 본다.
    }
  }
  throw new Error('JSON 이 닫히지 않았다')
}

function parseJsonLoose(txt: string): Record<string, unknown> {
  try {
    return JSON.parse(txt)
  } catch {
    // 코드펜스(```json)가 붙어도 여기서 같이 걷힌다 — firstJsonValue 가 첫 `{` 부터 읽으므로.
    try {
      return JSON.parse(firstJsonValue(txt))
    } catch (e) {
      // ⚠️ 원문을 남긴다. 안 남기면 원인을 줄 수로 역산해야 한다(조각이 많으면 그것도 못 한다).
      console.error('[translate] 응답 파싱 실패:', txt.slice(0, 300))
      throw e
    }
  }
}

// ---------- 번역 대상 = 눈에 보이는 글자만 ----------
// ⚠️ 옛 방식은 본문을 통째로 넘기고 "태그는 그대로 두고 5개국어로 돌려달라" 였다. 그러면 모델이
//    **같은 HTML 을 5벌 다시 써야** 해서, 6.9KB 짜리 HTML 공지 하나에 출력이 35KB 가 되고
//    출력 한도(maxOutputTokens)를 넘겨 잘린다 → 잘리면 실패로 접혀 **한국어로만 저장**됐다.
//    글자가 많아서가 아니라 태그·CSS 까지 베껴 쓰게 시켜서 생긴 문제다(그 파일의 실제 글자는 1KB 미만).
//    지금은 텍스트 조각만 뽑아 보낸다 — 분량이 줄고, 태그·CSS 가 모델을 아예 안 거치므로
//    **디자인이 망가질 수가 없다.**
// ⚠️ `<style>`·`<script>`·주석 속 내용은 통째로 고정 조각이다. 텍스트로 새어 나가면 CSS 가 번역된다.
const HTML_SPLIT = /<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<!--[\s\S]*?-->|<[^>]+>/gi
const HAS_LETTER = /\p{L}/u

type Piece = { raw: string } | { text: string; lead: string; tail: string }

// 조각 앞뒤 공백은 번역에서 떼어 둔다 — 모델이 공백을 흘리면 단어가 붙어버린다.
function pushText(pieces: Piece[], s: string) {
  if (!HAS_LETTER.test(s)) {
    pieces.push({ raw: s }) // 숫자·기호·공백뿐 → 보낼 이유가 없다
    return
  }
  const lead = /^\s*/.exec(s)![0]
  const tail = /\s*$/.exec(s)![0]
  pieces.push({ text: s.slice(lead.length, s.length - tail.length), lead, tail })
}

function splitPieces(src: string): Piece[] {
  const pieces: Piece[] = []
  let last = 0
  HTML_SPLIT.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = HTML_SPLIT.exec(src)) !== null) {
    if (m.index > last) pushText(pieces, src.slice(last, m.index))
    pieces.push({ raw: m[0] })
    last = m.index + m[0].length
  }
  if (last < src.length) pushText(pieces, src.slice(last))
  return pieces
}

function joinPieces(pieces: Piece[], translated: string[], from: number): string {
  let i = from
  return pieces
    .map((p) => ('raw' in p ? p.raw : `${p.lead}${translated[i++] ?? p.text}${p.tail}`))
    .join('')
}

// 한 번에 보낼 조각 묶음 크기. 출력이 5개국어 × 이 분량이라 여기서 출력 한도가 정해진다.
const BATCH_CHARS = 2500

async function translateSegments(segs: string[]): Promise<Record<string, string[]>> {
  const langList = TARGET_LANGS.map((c) => `"${c}" = ${LANG_NAMES[c]}`).join(', ')
  const sys =
    'You are a professional translator for a Korean AI-literacy certification website (CARIS). ' +
    'You receive a JSON array of Korean text fragments taken from a web page. ' +
    'RULES: (1) translate each item independently into each requested language; ' +
    '(2) return arrays with EXACTLY the same number of items, in the same order — never merge, split, drop or reorder items; ' +
    '(3) natural, idiomatic wording, preserving meaning and tone; ' +
    '(4) do NOT translate product names, acronyms (SEB, PC, AI, CARIS, OMR, PDF) or numbers; ' +
    '(5) keep HTML entities (e.g. &nbsp;) exactly as they appear; ' +
    '(6) output ONLY valid JSON, no markdown.'

  const outByLang: Record<string, string[]> = {}
  for (const c of TARGET_LANGS) outByLang[c] = []

  for (let i = 0; i < segs.length; ) {
    const batch: string[] = []
    let size = 0
    while (i < segs.length && (batch.length === 0 || size + segs[i].length <= BATCH_CHARS)) {
      size += segs[i].length
      batch.push(segs[i++])
    }
    const user =
      `Translate into: ${langList}.\n` +
      `Return JSON shaped exactly as { ${TARGET_LANGS.map((c) => `"${c}": [ ... ]`).join(', ')} }, ` +
      `each array containing exactly ${batch.length} strings.\n\n` +
      `SOURCE (Korean):\n${JSON.stringify(batch)}`
    const parsed = parseJsonLoose(await geminiJson(sys, user, 8192))
    for (const c of TARGET_LANGS) {
      const arr = parsed?.[c]
      // ⚠️ 개수가 어긋나면 그 언어는 통째로 버린다 — 하나만 밀려도 글이 엉뚱한 자리에 박힌다.
      const ok = Array.isArray(arr) && arr.length === batch.length && arr.every((v) => typeof v === 'string')
      outByLang[c].push(...(ok ? (arr as string[]) : batch))
    }
  }
  return outByLang
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

  // 필드를 조각으로 쪼개고, 번역할 텍스트만 한 줄로 모은다(필드 경계는 개수로 기억).
  const pieces: Record<string, Piece[]> = {}
  const starts: Record<string, number> = {}
  const segs: string[] = []
  for (const f of fields) {
    pieces[f] = splitPieces(koFields[f] ?? '')
    starts[f] = segs.length
    for (const p of pieces[f]) if ('text' in p) segs.push(p.text)
  }
  if (segs.length === 0) return out

  const byLang = await translateSegments(segs)
  for (const c of TARGET_LANGS) {
    for (const f of fields) out[f][c] = joinPieces(pieces[f], byLang[c], starts[f])
  }
  return out
}

// ---------- 본문에 박힌 base64 이미지 → Storage 로 옮기고 URL 로 치환 ----------
// ⚠️ 에디터(RichEditor)가 붙여넣기·드롭을 막아도 여기가 또 필요하다 — 옛 글, 다른 클라이언트,
//    API 직접 호출은 그 방어를 안 탄다. 안 펴고 저장하면 두 가지가 같이 깨진다:
//      (a) 번역 요청이 통째로 거절된다(7.4MB 본문 → Gemini 429. 실제로 겪음)
//      (b) 공지 목록이 select('*') 라 목록을 여는 사람마다 그 용량을 내려받는다.
// ⚠️ 업로드가 실패해도 저장은 막지 않는다 — 그림이 본문에 남을 뿐이고, 번역은 위 크기 가드가 접는다.
//    저장을 막으면 관리자는 자기가 뭘 잘못했는지 모른 채 공지를 못 올린다.
const DATA_URI_RE = /data:image\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)/g

async function inlineImagesToStorage(admin: any, html: string): Promise<{ html: string; moved: number }> {
  if (!html.includes('data:image/')) return { html, moved: 0 }
  let out = html
  let moved = 0
  for (const m of html.matchAll(DATA_URI_RE)) {
    const [whole, subtype, b64] = m
    try {
      const bin = atob(b64.replace(/\s/g, ''))
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const lower = subtype.toLowerCase()
      const ext = lower === 'jpeg' ? 'jpg' : lower.replace('+xml', '')
      const path = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`
      const { error } = await admin.storage
        .from('notice-images')
        .upload(path, bytes, { contentType: `image/${lower}`, upsert: false })
      if (error) throw error
      const { data } = admin.storage.from('notice-images').getPublicUrl(path)
      out = out.replace(whole, data.publicUrl)
      moved++
    } catch (e) {
      console.error('[notice] 본문 이미지 업로드 실패:', e instanceof Error ? e.message : e)
    }
  }
  return { html: out, moved }
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
  let koBody = String(n.bodyI18n?.ko ?? '').trim()
  if (!koTitle) return json({ error: '한국어 제목은 필수입니다.' }, 400)

  // ⚠️ 번역보다 **먼저** 편다. 순서가 바뀌면 번역이 거대 본문을 그대로 받아 거절당한다.
  koBody = (await inlineImagesToStorage(admin, koBody)).html

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
  if (!GEMINI_API_KEY) translateWarning = '번역 키(GEMINI_API_KEY_NOTICE) 미설정 — 한국어로만 저장됨'

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
    .order('exam_date', { ascending: true, nullsFirst: true })
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
  if (!GEMINI_API_KEY) translateWarning = '번역 키(GEMINI_API_KEY_NOTICE) 미설정 — 한국어로만 저장됨'

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
/**
 * 순서 재배치 공용 — ids 를 받은 순서대로 sort = 10,20,30… 재부여.
 *
 * ⚠️ 예전엔 항목마다 UPDATE 를 **줄 세워** 보냈다(FAQ 30개면 30왕복). 같은 코드가 네 군데에
 *    복사돼 있었고 reform.ts 에도 둘 더 있었다. 각 UPDATE 는 서로 다른 행 하나씩만 건드려
 *    의존이 없으므로 한 번에 내보낸다 — 왕복이 개수만큼이 아니라 한 파로 끝난다.
 * ⚠️ upsert 한 방으로 더 줄일 수도 있지만 그러면 NOT NULL 컬럼을 전부 실어야 한다.
 *    정렬값만 바꾸려다 다른 값을 덮어쓸 위험을 여기서 질 이유가 없다.
 * ⚠️ 실패는 **하나라도 있으면** 오류로 준다. 부분 성공이면 화면의 순서와 DB 가 어긋나는데,
 *    관리자가 그걸 알아챌 방법이 없다(다시 눌러 맞추면 되므로 되돌리기는 값싸다).
 */
async function reorderRows(
  admin: any,
  table: string,
  column: 'sort' | 'sort_order',
  ids: string[],
): Promise<{ message: string } | null> {
  const results = await Promise.all(
    ids.map((id, i) => admin.from(table).update({ [column]: (i + 1) * 10 }).eq('id', id)),
  )
  return (results as any[]).find((r) => r?.error)?.error ?? null
}

async function faqReorder(admin: any, body: any) {
  const ids = Array.isArray(body?.ids) ? (body.ids as string[]) : []
  if (!ids.length) return json({ error: 'ids 필요' }, 400)
  const err = await reorderRows(admin, 'faqs', 'sort', ids)
  if (err) return json({ error: err.message }, 400)
  return json({ ok: true })
}

async function faqDelete(admin: any, body: any) {
  const id = body?.id
  if (!id) return json({ error: 'id 필요' }, 400)
  const { error } = await admin.from('faqs').delete().eq('id', id)
  if (error) return json({ error: error.message }, 400)
  return json({ ok: true })
}

// ---------- 게시판 분류(board_categories) CRUD ----------
// 공지·FAQ 의 분류를 관리자가 직접 만든다(2026-08-19). kind 로 둘을 가른다.
//
// ⛔ **분류를 지워도 글은 안 건드린다.** 글의 category 값(고아 키)은 그대로 남고, 공개 화면이 "지금 있는
//    분류"만 보여주며 관리자 목록에서는 '미분류' 로 모인다 — 같은 key 로 다시 만들면 그대로 돌아온다.
//    그래서 삭제 전에 **몇 건이 딸려 내려가는지**를 먼저 알려준다(목록이 count 를 같이 준다).

const BOARD_KINDS = ['notice', 'faq'] as const
type BoardKind = (typeof BOARD_KINDS)[number]

function boardKindOf(body: any): BoardKind | null {
  const k = String(body?.kind ?? '')
  return (BOARD_KINDS as readonly string[]).includes(k) ? (k as BoardKind) : null
}
const boardTableOf = (kind: BoardKind) => (kind === 'notice' ? 'notices' : 'faqs')

function shapeBoardCat(c: any, count: number) {
  return {
    id: c.id,
    kind: c.kind,
    key: c.key,
    labelI18n: c.label_i18n ?? {},
    icon: c.icon ?? '',
    sort: c.sort,
    count, // 이 분류를 쓰는 글 수(미공개 포함)
  }
}

// 목록 + 글 수. 고아(orphans) = 분류가 지워졌거나 예전 값이 남아 있는 글들 → 관리자 화면의 '미분류'.
async function boardCatList(admin: any, body: any) {
  const kind = boardKindOf(body)
  if (!kind) return json({ error: 'kind 는 notice|faq' }, 400)

  const { data: cats, error } = await admin
    .from('board_categories')
    .select('*')
    .eq('kind', kind)
    .order('exam_date', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true })
  if (error) return json({ error: error.message }, 400)

  // 글 수는 category 컬럼만 받아 여기서 센다 — 공지·FAQ 는 많아야 수백 건이라 group by RPC 를 팔 이유가 없다.
  const { data: rows, error: e2 } = await admin.from(boardTableOf(kind)).select('category')
  if (e2) return json({ error: e2.message }, 400)
  const counts = new Map<string, number>()
  for (const r of rows ?? []) counts.set(r.category, (counts.get(r.category) ?? 0) + 1)

  const known = new Set((cats ?? []).map((c: any) => c.key))
  const orphans = [...counts.entries()]
    .filter(([k]) => !known.has(k))
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)

  return json({
    categories: (cats ?? []).map((c: any) => shapeBoardCat(c, counts.get(c.key) ?? 0)),
    orphans,
  })
}

// 생성/수정. 한국어 이름만 받아 나머지 5개국어를 자동 번역한다(공지·FAQ 본문과 같은 경로).
//   ⚠️ key 는 만들 때만 정한다 — 나중에 바꾸면 그 분류를 쓰던 글이 통째로 고아가 된다.
async function boardCatUpsert(admin: any, body: any) {
  const kind = boardKindOf(body)
  if (!kind) return json({ error: 'kind 는 notice|faq' }, 400)
  const c = body?.category ?? {}
  const koLabel = String(c.labelI18n?.ko ?? '').trim()
  if (!koLabel) return json({ error: '한국어 분류 이름은 필수입니다.' }, 400)

  let label_i18n: Record<string, string> = { ko: koLabel }
  let translateWarning: string | null = null
  try {
    const tr = await translateKoFields({ label: koLabel })
    label_i18n = tr.label
  } catch (e) {
    translateWarning = e instanceof Error ? e.message : '자동 번역 실패'
  }
  if (!GEMINI_API_KEY) translateWarning = '번역 키(GEMINI_API_KEY_NOTICE) 미설정 — 한국어로만 저장됨'

  const patch: Record<string, unknown> = {
    label_i18n,
    icon: String(c.icon ?? '').trim(),
    updated_at: new Date().toISOString(),
  }
  if (typeof c.sort === 'number') patch.sort = c.sort

  if (c.id) {
    // key 는 손대지 않는다(위 주석). 이름·아이콘·순서만 고친다.
    const { error } = await admin.from('board_categories').update(patch).eq('id', c.id)
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true, translateWarning })
  }

  const key = String(c.key ?? '').trim().toLowerCase()
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(key)) {
    return json({ error: '분류 키는 영문 소문자로 시작하고 영문·숫자·밑줄만 쓸 수 있습니다.' }, 400)
  }
  const { error } = await admin
    .from('board_categories')
    .insert({ kind, key, sort: typeof c.sort === 'number' ? c.sort : 999, ...patch })
  if (error) {
    // 23505 = 같은 kind 에 같은 key. 조용히 덮으면 남의 분류 이름을 갈아치우게 된다.
    if ((error as { code?: string }).code === '23505') return json({ error: '이미 있는 분류 키입니다.' }, 409)
    return json({ error: error.message }, 400)
  }
  return json({ ok: true, translateWarning })
}

// 삭제 — 글은 그대로 두고 분류 행만 지운다(위 ⛔ 주석). 몇 건이 미분류로 내려가는지는 화면이 미리 보여준다.
async function boardCatDelete(admin: any, body: any) {
  const id = body?.id
  if (!id) return json({ error: 'id 필요' }, 400)
  const { error } = await admin.from('board_categories').delete().eq('id', id)
  if (error) return json({ error: error.message }, 400)
  return json({ ok: true })
}

// 순서 재배치 — faqReorder 와 같은 방식(받은 순서대로 10,20,30…).
async function boardCatReorder(admin: any, body: any) {
  const ids = Array.isArray(body?.ids) ? (body.ids as string[]) : []
  if (!ids.length) return json({ error: 'ids 필요' }, 400)
  const err = await reorderRows(admin, 'board_categories', 'sort', ids)
  if (err) return json({ error: err.message }, 400)
  return json({ ok: true })
}

// 글의 분류를 옮긴다 — 미분류(고아)로 내려온 글을 다시 지정할 때 쓴다.
//   ⚠️ 옮길 대상 분류가 **실재하는지** 확인한다. 안 보면 오타 한 번에 글이 또 미분류가 된다.
async function boardCatMove(admin: any, body: any) {
  const kind = boardKindOf(body)
  if (!kind) return json({ error: 'kind 는 notice|faq' }, 400)
  const ids = Array.isArray(body?.ids) ? (body.ids as string[]) : []
  const to = String(body?.to ?? '').trim()
  if (!ids.length || !to) return json({ error: 'ids·to 필요' }, 400)

  const { data: cat } = await admin
    .from('board_categories')
    .select('key')
    .eq('kind', kind)
    .eq('key', to)
    .maybeSingle()
  if (!cat) return json({ error: '없는 분류입니다.' }, 400)

  const { error } = await admin
    .from(boardTableOf(kind))
    .update({ category: to, updated_at: new Date().toISOString() })
    .in('id', ids)
  if (error) return json({ error: error.message }, 400)
  return json({ ok: true, moved: ids.length })
}

// ---------- 시험 일정/회차(exam_rounds) CRUD ----------
// tiers = 이 회차가 연 급수(활성 exams.tier) 키 배열. 회차 등록 기능(exams=회차×급수)에서 채움.
function shapeExamRound(r: any, tiers: string[] = []) {
  return {
    id: r.id,
    titleI18n: r.title_i18n ?? {},
    examDate: r.exam_date, // 'YYYY-MM-DD' | null — 대표 표기일(카드·목록용)
    // 응시 창. 정기시험은 '시험일 하루'가 아니라 11~20일 10일 구간이라 대표일과 별도 컬럼이 필요하다.
    // 회차마다 다를 수 있어서 상수로 박지 않는다. null 이면 exam_date 의 KST 하루로 폴백한다.
    examStartAt: r.exam_start_at ?? null, // ISO | null
    examEndAt: r.exam_end_at ?? null, // ISO | null
    applyStartAt: r.apply_start_at, // ISO | null
    applyEndAt: r.apply_end_at, // ISO | null
    // 관리자 화면의 월 선택기를 되채우는 값. 대표일이 곧 그 달이라 따로 저장하지 않는다.
    month: monthOfExamDate(r.exam_date),
    published: !!r.published,
    tiers, // 이 회차가 연 급수 키(활성)
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

async function examRoundList(admin: any) {
  const { data, error } = await admin
    .from('exam_rounds')
    .select('*')
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

// 생성/수정. 한국어 회차명만 입력받아 저장 시 나머지 5개국어 자동 번역. 날짜는 월에서 계산해 저장.
//   ⚠️ 2026-09-04 에 회차 유형(kind)·설명(note_i18n)·수동 순서(sort)를 없앴다 — 상시 회차가 사라졌다.
async function examRoundUpsert(admin: any, body: any) {
  const r = body?.round ?? {}
  const koTitle = String(r.titleI18n?.ko ?? '').trim()
  if (!koTitle) return json({ error: '한국어 회차명은 필수입니다.' }, 400)

  let title_i18n: Record<string, string> = { ko: koTitle }
  let translateWarning: string | null = null
  try {
    const tr = await translateKoFields({ title: koTitle })
    title_i18n = tr.title
  } catch (e) {
    translateWarning = e instanceof Error ? e.message : '자동 번역 실패'
  }
  if (!GEMINI_API_KEY) translateWarning = '번역 키(GEMINI_API_KEY_NOTICE) 미설정 — 한국어로만 저장됨'

  // 시험 날짜는 **월 하나에서 전부 계산한다**(2026-08-20 정책). 화면이 보낸 날짜는 쓰지 않는다 —
  // 받으면 규칙 밖 회차(접수 3일짜리 등)를 만들 수 있고, 그때부터 /plan 의 안내문이 거짓말이 된다.
  if (!isExamMonth(r.month)) {
    return json({ error: '시험 월(YYYY-MM)을 선택하세요.' }, 400)
  }
  const sch = scheduleForMonth(String(r.month))

  const row: Record<string, unknown> = {
    title_i18n,
    // 대표일 = 응시 마지막 날(20일). '지난 시험' 판정이 이 값을 본다.
    exam_date: sch?.examDate ?? null,
    exam_start_at: sch?.examStartAt ?? null,
    exam_end_at: sch?.examEndAt ?? null,
    apply_start_at: sch?.applyStartAt ?? null,
    apply_end_at: sch?.applyEndAt ?? null,
    published: r.published !== false,
    updated_at: new Date().toISOString(),
  }

  let saved: any = null
  if (r.id) {
    const { data, error } = await admin.from('exam_rounds').update(row).eq('id', r.id).select().maybeSingle()
    if (error) return json({ error: error.message }, 400)
    saved = data
  } else {
    const { data, error } = await admin.from('exam_rounds').insert(row).select().maybeSingle()
    if (error) return json({ error: error.message }, 400)
    saved = data
  }

  // 회차가 연 급수(tiers) 동기화 → 급수마다 exams 행 생성/재활성/소프트클로즈.
  // r.tiers 가 배열일 때만 건드린다(구 호출이 실수로 급수를 비우지 않도록).
  let tierKeys: string[] = []
  let tierWarning: string | null = null
  if (saved?.id && Array.isArray(r.tiers)) {
    const tiersInput = (r.tiers as any[])
      .filter((t) => t && typeof t.key === 'string')
      .map((t) => ({ key: t.key as string, title: String(t.title ?? t.key), total: Number(t.total) || 0, durationMin: Number(t.durationMin) || 120 }))
    try {
      const sync = await syncRoundExams(admin, saved.id, tiersInput)
      tierKeys = sync.tiers
      tierWarning = sync.warning
    } catch (e) {
      // 급수 동기화 실패는 회차 저장을 무르지 않는다. 단 **번역 경고와 한 문자열로 섞지 않는다** —
      // 섞었더니 '접수가 있어 급수를 못 지웠다' 가 화면에서 '자동 번역을 건너뛰었습니다' 로 읽혔다.
      tierWarning = '급수 동기화 실패: ' + (e instanceof Error ? e.message : '오류')
      tierKeys = tiersInput.map((t) => t.key) // 실제 상태를 모르므로 요청값으로 되돌린다(화면은 새로고침이 정본)
    }
  }
  return json({ round: saved ? shapeExamRound(saved, tierKeys) : null, translateWarning, tierWarning })
}

/**
 * 이 (회차 × 급수)에 '접수'가 있는가 = 살아있는 응시권 + 아직 응시권이 안 된 진행 중 결제.
 *
 * 결제까지 세는 이유: pending/waiting_deposit 은 승인되면 그대로 응시권이 된다. 응시권만 보면
 * "결제창은 떠 있는데 아직 티켓이 없는" 몇 초~며칠 구간이 통째로 비어, 그 사이 급수를 해제하면
 * 존재하지 않는 시험의 응시권이 발급된다(돈은 받고 응시는 불가).
 * ⚠️ 실패하면 0 이 아니라 throw 다 — 돈을 막는 가드가 조용히 꺼지면 안 된다.
 */
async function roundTierSold(admin: any, roundId: string, tier: string): Promise<number> {
  const [t, p] = await Promise.all([
    admin.from('exam_tickets').select('id', { count: 'exact', head: true })
      .eq('round_id', roundId).eq('tier', tier).in('status', ['issued', 'consumed']),
    admin.from('payments').select('id', { count: 'exact', head: true })
      .eq('product_type', 'exam').eq('product_ref', `${roundId}:${tier}`)
      .in('status', ['pending', 'waiting_deposit', 'paid']),
  ])
  if (t.error) throw new Error(`응시권 조회 실패: ${t.error.message}`)
  if (p.error) throw new Error(`결제 조회 실패: ${p.error.message}`)
  return (t.count ?? 0) + (p.count ?? 0)
}

// 회차의 열린 급수 ↔ exams 동기화. tiers = [{key, title}].
//  · 요청에 있고 없던 급수 → exams insert(활성)
//  · 요청에 있고 이미 있던 급수 → title 갱신 + 재활성
//  · 요청에서 빠진 급수 → **접수 0건일 때만** 세트·응시 없으면 삭제(오등록 정리), 있으면 active=false(보존)
//  · 구성(total/durationMin)은 클라가 TIER_EXAM_SPEC 에서 실어 보냄(Deno는 caris.ts 못 읽음)
//
// ⚠️ 해제 가드가 여기 있는 이유: 응시권은 (round_id, tier) 로 귀속되는데 exams 행은 체크박스 한 번에
//    **실제로 DELETE 된다**. 그리고 응시권을 판 직후가 정확히 '문항 0 · 응시 0' 구간이라, 가드가 없으면
//    팔린 응시권이 존재하지 않는 시험을 가리키게 된다.
// ⚠️ 막힌 급수는 **해제하지 않고 그대로 둔다**(throw 로 중간에 끊지 않는다) — 루프 안에서 순차로
//    insert/update/delete 를 하므로 중간에 끊으면 앞쪽 급수만 반영된 부분 적용 상태가 남는다.
async function syncRoundExams(
  admin: any,
  roundId: string,
  tiers: { key: string; title: string; total?: number; durationMin?: number }[],
): Promise<{ tiers: string[]; blocked: string[]; warning: string | null }> {
  const { data: existing, error } = await admin.from('exams').select('id, tier, active').eq('round_id', roundId)
  if (error) throw new Error(error.message)
  const cur = (existing ?? []) as any[]
  const curByTier = new Map<string, any>(cur.map((e) => [e.tier, e]))

  // 잠긴 급수(CARIS-Ⅱ)는 **새로 열지 못한다**. 이미 그 회차에 살아 있는(active) 시험이면 그대로 통과시킨다 —
  // 운영 중인 회차의 급수를 코드 배포가 조용히 닫으면 안 되고, 관리자가 체크를 풀어 닫는 길도 남아야 한다.
  // 화면(Admin.tsx)도 같은 규칙으로 체크박스를 잠그지만, 요청을 직접 쏘면 그건 통과하므로 여기가 최종 게이트다.
  const locked: string[] = []
  const want = tiers.filter((t) => {
    if (!isTierLocked(t.key) || curByTier.get(t.key)?.active) return true
    locked.push(TIER_LABEL[t.key] ?? t.key)
    return false
  })
  const wantKeys = new Set(want.map((t) => t.key))

  for (const t of want) {
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

  const blocked: string[] = []
  for (const e of cur) {
    if (wantKeys.has(e.tier)) continue
    if (await roundTierSold(admin, roundId, e.tier) > 0) {
      blocked.push(e.tier) // 접수분이 있는 급수는 손대지 않는다 → 아래에서 사람이 읽을 문구로 알린다
      continue
    }
    const [q, a] = await Promise.all([
      admin.from('exam_questions').select('id', { count: 'exact', head: true }).eq('exam_id', e.id),
      admin.from('exam_attempts').select('id', { count: 'exact', head: true }).eq('exam_id', e.id),
    ])
    if ((q.count ?? 0) === 0 && (a.count ?? 0) === 0) {
      // 예전엔 delete 결과를 안 봤다 — 실패해도 화면에선 지워진 것처럼 보여 다음 편집 때 상태가 갈렸다.
      const { error: de } = await admin.from('exams').delete().eq('id', e.id) // 한 번도 안 쓴 오등록 → 정리
      if (de) throw new Error(de.message)
    } else if (e.active) {
      const { error: ue } = await admin.from('exams').update({ active: false }).eq('id', e.id) // 사용 이력 있으면 보존
      if (ue) throw new Error(ue.message)
    }
  }

  // 해제하지 못한 급수는 계속 열려 있는 상태라 '연 급수' 목록에 남아야 한다.
  const keys = [...want.map((t) => t.key), ...blocked]

  // exams 는 RLS 정책 0개라 프론트가 못 읽는다 → 공개화면(원서접수)이 볼 수 있게 회차에 비정규화해 둔다.
  // 판매 가능 판정의 정본은 계속 서버(resolveExamOffer)이고 이건 화면 표시용이라, 실패해도
  // 회차 저장을 무르지 않고 경고로만 올린다.
  const { error: oe } = await admin.from('exam_rounds').update({ open_tiers: keys }).eq('id', roundId)

  const parts: string[] = []
  if (oe) parts.push(`열린 급수 목록(open_tiers) 갱신 실패: ${oe.message}`)
  if (locked.length) {
    parts.push(
      `${locked.join(', ')} 급수는 아직 열지 않은 급수(CARIS-Ⅱ)라 회차에 추가하지 않았습니다. ` +
      `문제은행·출제 배분표가 준비되면 코드의 LOCKED_TIERS 에서 빼야 열립니다.`,
    )
  }
  if (blocked.length) {
    parts.push(
      `${blocked.join(', ')} 급수는 이미 접수(응시권 또는 진행 중인 결제)가 있어 해제하지 못했습니다. ` +
      `해당 응시권을 회수·환불한 뒤 다시 시도하세요. 접수를 그대로 두고 노출만 막으려면 회차 ‘공개’를 해제하세요.`,
    )
  }
  return { tiers: keys, blocked, warning: parts.length ? parts.join(' / ') : null }
}

// examRoundReorder 는 2026-09-04 에 삭제했다 — 수동 순서(sort)는 상시 회차 전용이었고,
// 정기 회차끼리는 시험일이 곧 순서라 손으로 매길 이유가 없다.

async function examRoundDelete(admin: any, body: any) {
  const id = body?.id
  if (!id) return json({ error: 'id 필요' }, 400)
  // 이 회차에 등록된 급수 시험(exams)이 있으면 삭제 차단(문항·응시 유실·FK 위반 방지).
  const { count } = await admin.from('exams').select('id', { count: 'exact', head: true }).eq('round_id', id)
  if ((count ?? 0) > 0) {
    return json({ error: '이 회차에 등록된 급수 시험이 있어 삭제할 수 없습니다. 먼저 회차 편집에서 급수를 모두 해제하세요.' }, 400)
  }
  // 응시권은 회차를 FK(ON DELETE 없음)로 잡고 있어 **무효·만료분까지** 삭제를 막는다.
  // 급수를 다 해제해도(=exams 0건) 여기서 걸리므로, 안내를 나누지 않으면
  // '급수를 모두 해제하세요'(이미 했다)만 반복돼 관리자가 지울 방법을 못 찾는다.
  const { count: tk } = await admin.from('exam_tickets').select('id', { count: 'exact', head: true }).eq('round_id', id)
  if ((tk ?? 0) > 0) {
    return json({
      error: `이 회차에는 응시권 ${tk}장이 발급된 이력이 있어 삭제할 수 없습니다(환불·분쟁 추적을 위해 보존합니다). ` +
        `목록에서 감추려면 회차 편집에서 ‘공개’를 해제하세요.`,
    }, 400)
  }
  const { error } = await admin.from('exam_rounds').delete().eq('id', id)
  if (error) {
    // 23503 을 그대로 노출하면 뜻을 알 수 없다 — 판정은 DB 가 하고, 코드는 문구로만 바꾼다.
    const msg = (error as { code?: string }).code === '23503'
      ? '이 회차를 참조하는 데이터(응시권·결제 등)가 남아 있어 삭제할 수 없습니다.'
      : error.message
    return json({ error: msg }, 400)
  }
  return json({ ok: true })
}

// ---------- 환율(exchange_rates) — 달러 정가를 원화로 청구할 때 쓰는 값 ----------
// 자동 수집이 기본이고, 관리자가 손으로 고정할 수 있다. 고정하면 자동 수집이 덮어쓰지 않는다
// (사람이 일부러 잡아둔 값이 조용히 되돌아가면 아무도 이유를 설명하지 못한다 — _shared/fx.ts 참고).
async function fxGet(admin: any) {
  const { data } = await admin.from('exchange_rates').select('currency, rate, source, fetched_at, updated_at').order('currency')
  return json({ rates: data ?? [] })
}

async function fxSave(admin: any, body: any) {
  const currency = String(body?.currency ?? 'KRW').toUpperCase()

  // '자동으로 되돌리기' — 지금 값을 즉시 다시 받아온다. 주기를 기다리게 하면 관리자가
  // 되돌려졌는지 화면으로 확인할 방법이 없다.
  if (String(body?.mode ?? '') === 'auto') {
    const out = await refreshRates(admin, { force: true })
    if (!out.updated) return json({ error: '환율을 받아오지 못했습니다. 잠시 후 다시 시도해주세요.' }, 502)
    return json({ ok: true, rate: out.rate, source: 'auto' })
  }

  const rate = Number(body?.rate)
  // 자릿수를 잘못 넣으면(1.4 / 141700) 정가가 통째로 무너진다. 상식 범위 밖은 저장 자체를 막는다.
  if (!Number.isFinite(rate) || rate <= 100 || rate >= 100000) {
    return json({ error: '환율 값이 올바르지 않습니다. (100 ~ 100,000)' }, 400)
  }
  const now = new Date().toISOString()
  const { error } = await admin
    .from('exchange_rates')
    .upsert({ currency, rate, source: 'manual', fetched_at: now, updated_at: now }, { onConflict: 'currency' })
  if (error) return json({ error: error.message }, 400)
  return json({ ok: true, rate, source: 'manual' })
}

// ---------- 응시료(exam_fees) — 금액만 편집 ----------
async function examFeeList(admin: any) {
  const { data, error } = await admin.from('exam_fees').select('key, amount_usd_cents').order('key', { ascending: true })
  if (error) return json({ error: error.message }, 400)
  return json({ fees: data ?? [] })
}

async function examFeeSave(admin: any, body: any) {
  const items = Array.isArray(body?.fees) ? body.fees : []
  if (!items.length) return json({ error: 'fees 필요' }, 400)
  // 잠긴 급수(CARIS-Ⅱ)는 금액을 받지 않는다 — 금액이 들어오는 순간 원서접수에서 결제 버튼이 열리는데
  // 그 시험은 문항이 0개다. 조용히 건너뛰면 관리자는 저장된 줄 알고 넘어가므로 **거절해서 알린다**.
  // 한 건이라도 걸리면 전부 저장하지 않는다 — 절반만 반영되면 화면과 DB 가 어긋난다.
  for (const it of items) {
    const tierKey = String(it?.key ?? '').trim().split('_').slice(1).join('_')
    if (tierKey && isTierLocked(tierKey)) {
      return json({ error: `${TIER_LABEL[tierKey] ?? tierKey}는 아직 열지 않은 급수라 응시료를 설정할 수 없습니다.` }, 400)
    }
  }
  const now = new Date().toISOString()
  // ⚠️ 급수마다 upsert 를 따로 쏘던 것을 한 번에 모아 보낸다(급수 6개면 6왕복 → 1왕복).
  //    행끼리 의존이 없고 충돌 키(key)도 같아서 배열 하나로 그대로 들어간다.
  const rows: { key: string; amount_usd_cents: number; updated_at: string }[] = []
  for (const it of items) {
    const key = String(it?.key ?? '').trim()
    const n = Number(it?.amount)
    if (!key || !Number.isFinite(n)) continue
    // 단위는 **달러 센트**다(100 = $1.00). 관리자 화면이 달러 입력을 센트로 바꿔 보낸다.
    // ⚠️ **0 은 정상 값이다** — "무료 급수"라는 뜻이고, 화면이 저장 전에 확인을 한 번 받는다(2026-08-25).
    //    '아직 안 정했다'는 0 이 아니라 **행을 안 만드는 것**으로 표현한다(화면이 빈칸을 아예 안 보낸다).
    //    그 구분이 판매 판정의 전부다 — resolveExamOffer 는 행 없음(null)만 막고 0 은 무료로 판다.
    rows.push({ key, amount_usd_cents: Math.max(0, Math.floor(n)), updated_at: now })
  }
  if (rows.length) {
    const { error } = await admin.from('exam_fees').upsert(rows, { onConflict: 'key' })
    if (error) return json({ error: error.message }, 400)
  }
  return json({ ok: true })
}

// ---------- 응시권(exam_tickets) · 결제(payments) 백오피스 ----------
// 돈과 응시 자격이 걸린 화면이라 규칙 셋을 지킨다.
//  ① **만료(expired)는 조회 시점 계산이다.** 여기서 DB status 를 눕히는 쓰기를 하지 않는다 —
//     구매자 화면(my-attempts)도 같은 규칙으로 접어 보여주는데, 관리자만 저장값을 기준으로 세면
//     같은 응시권이 관리자에겐 '미사용', 사용자에겐 '만료'로 보인다.
//  ② **회차 접수 수의 단일 집계원은 examTicketSummary 하나다.** 대시보드 퍼널도 여기서 가져간다 —
//     두 화면이 각자 세면 숫자가 어긋나고 어느 쪽도 못 믿게 된다.
//  ③ **발급·회수는 루트 전용이다.** admin_users 게이트에는 액션별 권한이 없어서, 등록된 이메일이면
//     전 액션이 열린다. '무료 응시권을 찍는 버튼'을 그 게이트에 그대로 얹으면 안 된다.

/**
 * 표시용 상태 — issued 인데 만료됐으면 expired 로 접는다. **저장값은 건드리지 않는다.**
 *
 * ⚠️ 만료 판정은 `_shared/exam-tickets.ts` 의 `ticketExpired` **하나만** 쓴다.
 *    구매자 화면(my-attempts)·응시 게이트(start-exam)가 같은 함수를 쓰므로, 여기서 규칙을 복제하면
 *    같은 응시권이 관리자에겐 '미사용', 사용자에겐 '만료'로 보이는 순간이 반드시 온다.
 *    (시간은 전부 KST — exam_date 는 bare date 라 오프셋 없이 파싱하면 9시간 어긋난다.)
 */
function effTicketStatus(t: any, round: any, at: number): string {
  if (t.status !== 'issued') return t.status
  return ticketExpired(t, round ?? null, at) ? 'expired' : 'issued'
}

const TICKET_COLS =
  'id, user_id, round_id, tier, status, source, payment_id, price_paid, granted_by, note, expires_at, issued_at, consumed_at, voided_at, void_reason'

/** 응시권 목록 — 회차·급수·상태·검색어 필터 + range 페이지네이션(하드캡은 넘치면 조용히 잘려서 안 쓴다). */
async function examTicketList(admin: any, body: any) {
  const limit = Math.min(Math.max(1, Math.floor(body?.limit ?? 50)), 500)
  const offset = Math.max(0, Math.floor(body?.offset ?? 0))
  const roundId = String(body?.roundId ?? '').trim()
  const tier = String(body?.tier ?? '').trim()
  const status = String(body?.status ?? '').trim()
  const q = String(body?.q ?? '').trim().toLowerCase()

  // 회차는 수십 건이라 통째로 읽는다(만료 판정과 회차명 표시에 둘 다 쓴다).
  const { data: roundRows } = await admin.from('exam_rounds').select(EXAM_ROUND_COLS)
  const rounds = (roundRows ?? []) as any[]
  const now = Date.now()
  const roundById = new Map<string, any>(rounds.map((r) => [r.id, r]))
  // 응시 창이 끝난 회차 = 그 회차의 issued 응시권이 '만료'로 보이는 회차.
  // ⚠️ 응시권별 expires_at override 는 이 집합에 반영되지 않는다 — 상태 **필터**만 살짝 어긋날 뿐,
  //    각 줄에 찍히는 상태는 아래 effTicketStatus 가 응시권 단위로 정확히 판정한다.
  //    (수기 발급이 override 를 안 쓰기 때문에 지금은 어긋날 행 자체가 없다.)
  const endedIds = rounds.filter((r) => examWindowState(r, now) === 'closed').map((r) => r.id)

  // 검색어는 이름·이메일이라 exam_tickets 안에 없다 → 먼저 user_id 집합으로 바꾼 뒤 .in() 으로 건다.
  let userFilter: string[] | null = null
  if (q) {
    const ids = new Set<string>()
    const { data: profs } = await admin.from('profiles').select('id').ilike('display_name', `%${q}%`).limit(500)
    for (const p of profs ?? []) ids.add((p as any).id)
    try {
      const { data: au } = await admin.rpc('admin_user_emails')
      for (const u of au ?? []) if (((u as any).email ?? '').toLowerCase().includes(q)) ids.add((u as any).id)
    } catch { /* 이메일 검색만 포기 */ }
    userFilter = [...ids].slice(0, 500) // .in() 이 무한정 길어지지 않게 자른다(관리자 검색이라 실용 우선)
    if (!userFilter.length) return json({ tickets: [], total: 0 })
  }

  let sel = admin.from('exam_tickets').select(TICKET_COLS, { count: 'exact' })
  if (roundId) sel = sel.eq('round_id', roundId)
  if (tier) sel = sel.eq('tier', tier)
  if (userFilter) sel = sel.in('user_id', userFilter)
  // 만료는 저장값이 아니라 계산이라, 필터도 '응시 창이 끝난 회차' 집합으로 DB 에 밀어 넣는다.
  // 메모리에서 거르면 total 과 페이지 경계가 어긋난다.
  const endedIn = `(${endedIds.join(',')})`
  if (status === 'issued') {
    sel = sel.eq('status', 'issued')
    if (endedIds.length) sel = sel.not('round_id', 'in', endedIn)
  } else if (status === 'expired') {
    sel = endedIds.length
      ? sel.or(`status.eq.expired,and(status.eq.issued,round_id.in.${endedIn})`)
      : sel.eq('status', 'expired')
  } else if (status) {
    sel = sel.eq('status', status)
  }

  const { data, count, error } = await sel
    .order('issued_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) return json({ error: error.message }, 400)
  const rows = (data ?? []) as any[]

  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))]
  const nameMap: Record<string, string> = {}
  const emailMap: Record<string, string> = {}
  if (userIds.length) {
    const { data: profs } = await admin.from('profiles').select('id, display_name').in('id', userIds)
    for (const p of profs ?? []) nameMap[(p as any).id] = (p as any).display_name
    try {
      const { data: au } = await admin.rpc('admin_user_emails')
      for (const x of au ?? []) emailMap[(x as any).id] = (x as any).email ?? ''
    } catch { /* 이메일만 빈칸 */ }
  }

  // 회수(void) 판단에 연결 결제 상태가 필요하다 — 환불 없이 회수하면 재구매가 영구히 막히기 때문.
  const payIds = [...new Set(rows.map((r) => r.payment_id).filter(Boolean))]
  const payMap: Record<string, any> = {}
  if (payIds.length) {
    const { data: pays } = await admin.from('payments').select('id, order_id, status, amount, method, fulfilled_at').in('id', payIds)
    for (const p of pays ?? []) payMap[(p as any).id] = p
  }

  // 한 응시권에 응시가 여러 개 달릴 수 있다(재시작으로 expired 된 것들). 살아있는 것을 우선 보여준다.
  const atMap: Record<string, any> = {}
  if (rows.length) {
    const { data: ats } = await admin
      .from('exam_attempts')
      .select('id, ticket_id, status, started_at, submitted_at')
      .in('ticket_id', rows.map((r) => r.id))
    const rank = (s: string) => (s === 'submitted' ? 0 : s === 'in_progress' ? 1 : 2)
    for (const a of (ats ?? []) as any[]) {
      if (!a.ticket_id) continue
      const prev = atMap[a.ticket_id]
      if (!prev || rank(a.status) < rank(prev.status)) atMap[a.ticket_id] = a
    }
  }

  const tickets = rows.map((t) => {
    const r = roundById.get(t.round_id)
    const pay = t.payment_id ? payMap[t.payment_id] ?? null : null
    const at = atMap[t.id] ?? null
    return {
      ticketId: t.id,
      userId: t.user_id,
      name: nameMap[t.user_id] ?? null,
      email: emailMap[t.user_id] ?? null,
      roundId: t.round_id,
      roundTitle: (r?.title_i18n?.ko as string) ?? '',
      examDate: r?.exam_date ?? null,
      examEndAt: r?.exam_end_at ?? null,
      tier: t.tier,
      status: t.status, // DB 저장값
      effStatus: effTicketStatus(t, r, now), // 화면 표시값(만료 접기 반영)
      source: t.source,
      pricePaid: t.price_paid ?? 0,
      grantedBy: t.granted_by ?? null,
      note: t.note ?? null,
      issuedAt: t.issued_at,
      consumedAt: t.consumed_at,
      voidedAt: t.voided_at,
      voidReason: t.void_reason ?? null,
      expiresAt: t.expires_at,
      paymentId: t.payment_id ?? null,
      paymentOrderId: pay?.order_id ?? null,
      paymentStatus: pay?.status ?? null,
      paymentFulfilled: pay ? !!pay.fulfilled_at : null,
      attemptId: at?.id ?? null,
      attemptStatus: at?.status ?? null,
    }
  })
  return json({ tickets, total: count ?? tickets.length })
}

/**
 * 회차 접수 현황 — (회차 × 급수) 발급/미사용/소진/무효/만료 + 매출.
 * **회차 지표의 단일 집계원**이라 대시보드 퍼널도 이걸 부른다.
 * roundId 를 주면 그 회차의 급수별 문항 준비 상태(N/M)까지 같이 준다 —
 * '판매 가능(exams 행 존재)'과 '응시 가능(문항 세트 존재)' 사이에 관리자 작업 한 단계가 비어 있어서,
 * 이걸 안 보여주면 시험 당일에 전원이 '아직 문항이 출제되지 않은 시험입니다'를 받는다.
 */
async function examTicketSummary(admin: any, body: any) {
  const roundId = String(body?.roundId ?? '').trim()
  const { data: roundRows } = await admin
    .from('exam_rounds')
    .select(EXAM_ROUND_COLS)
    .order('exam_date', { ascending: true, nullsFirst: true })
  const rounds = ((roundRows ?? []) as any[]).filter((r) => !roundId || r.id === roundId)
  const now = Date.now()
  const roundById = new Map<string, any>(rounds.map((r) => [r.id, r]))

  type Cell = { sold: number; unused: number; used: number; expired: number; voided: number; revenue: number; free: number }
  const cell = (): Cell => ({ sold: 0, unused: 0, used: 0, expired: 0, voided: 0, revenue: 0, free: 0 })
  const byTier = new Map<string, Cell>() // `${roundId}|${tier}`
  const byRound = new Map<string, Cell>()
  const at = (m: Map<string, Cell>, k: string): Cell => {
    let v = m.get(k)
    if (!v) { v = cell(); m.set(k, v) }
    return v
  }

  // 청크로 훑어 메모리에서 센다(부분 유니크·lazy 만료 때문에 DB group by 로는 같은 규칙을 못 만든다).
  const CHUNK = 1000
  const MAX_ROWS = 50000 // 관리자 화면이라 상한을 두고, 넘치면 truncated 로 알린다.
  let truncated = false
  for (let from = 0; ; from += CHUNK) {
    if (from >= MAX_ROWS) { truncated = true; break }
    let sel = admin.from('exam_tickets').select('round_id, tier, status, price_paid, expires_at, source')
    if (roundId) sel = sel.eq('round_id', roundId)
    const { data, error } = await sel.order('issued_at', { ascending: true }).range(from, from + CHUNK - 1)
    if (error) return json({ error: error.message }, 400)
    const rows = (data ?? []) as any[]
    for (const t of rows) {
      const eff = effTicketStatus(t, roundById.get(t.round_id) ?? null, now)
      for (const m of [at(byTier, `${t.round_id}|${t.tier}`), at(byRound, t.round_id)]) {
        if (eff === 'void') m.voided++
        else {
          m.sold++ // 접수 = 무효를 뺀 발급분(살아있음 + 사용함 + 만료). 무효까지 세면 판매 수가 부풀려진다.
          m.revenue += t.price_paid ?? 0
          if (eff === 'consumed') m.used++
          else if (eff === 'expired') m.expired++
          else m.unused++
          if (t.source !== 'pg') m.free++ // 수기·무료 발급분(매출과 구분해서 봐야 한다)
        }
      }
    }
    if (rows.length < CHUNK) break
  }

  // 문항 준비 상태는 회차를 특정했을 때만 센다(전체 회차면 받아올 문항 행이 통째로 커진다).
  //   ⚠️ 예전엔 급수마다 count 를 따로 물어(급수 6개면 6왕복) 여기가 회차 요약에서 제일 느렸다.
  //      지금은 한 번에 받아 메모리에서 센다 — 급수가 늘어도 2왕복 그대로다.
  const sets: Record<string, { total: number; loaded: number; active: boolean }> = {}
  if (roundId) {
    const { data: exs } = await admin.from('exams').select('id, tier, total_questions, active').eq('round_id', roundId)
    const rows = (exs ?? []) as any[]
    const loaded: Record<string, number> = {}
    if (rows.length) {
      const { data: qs } = await admin
        .from('exam_questions')
        .select('exam_id')
        .in('exam_id', rows.map((e) => e.id))
      for (const q of (qs ?? []) as { exam_id: string }[]) loaded[q.exam_id] = (loaded[q.exam_id] ?? 0) + 1
    }
    for (const e of rows) {
      sets[e.tier] = { total: e.total_questions ?? 0, loaded: loaded[e.id] ?? 0, active: !!e.active }
    }
  }

  return json({
    rounds: rounds.map((r) => ({
      roundId: r.id,
      title: (r.title_i18n?.ko as string) ?? '',
      kind: r.kind,
      examDate: r.exam_date,
      examStartAt: r.exam_start_at ?? null,
      examEndAt: r.exam_end_at ?? null,
      ...(byRound.get(r.id) ?? cell()),
    })),
    tiers: [...byTier.entries()].map(([k, v]) => {
      const i = k.indexOf('|')
      return { roundId: k.slice(0, i), tier: k.slice(i + 1), ...v }
    }),
    sets,
    truncated,
  })
}

/**
 * 수기 발급 — 단체 접수·시험 당일 장애 보상용. **루트 전용**(위 규칙 ③).
 * price_paid=0, source='admin', granted_by=처리자 이메일. 회차·응시료 변경엔 로그가 아예 없어서
 * 분쟁 때 추적할 게 granted_by/note 두 칸뿐이다 — 사유를 꼭 남기게 한다.
 * 만료 override(expires_at)는 일부러 안 받는다. 받으면 '회차 종료가 만료를 정한다'는 규칙이 화면마다 갈린다.
 */
async function examTicketGrant(admin: any, body: any, actorEmail: string, isRoot: boolean) {
  if (!isRoot) return json({ error: '루트 관리자만 응시권을 발급할 수 있습니다.' }, 403)
  const roundId = String(body?.roundId ?? '').trim()
  const tier = String(body?.tier ?? '').trim()
  const note = String(body?.note ?? '').trim()
  const emailIn = String(body?.email ?? '').trim().toLowerCase()
  let userId = String(body?.userId ?? '').trim()
  if (!roundId || !tier) return json({ error: '회차와 급수를 선택하세요.' }, 400)
  if (!userId && !emailIn) return json({ error: '발급 대상 이메일이 필요합니다.' }, 400)
  if (!note) return json({ error: '발급 사유를 적어주세요(무료 응시권이라 기록이 남아야 합니다).' }, 400)

  if (!userId) {
    try {
      // admin_user_emails 는 이메일이 있는 계정만 준다 = 익명 계정은 애초에 안 나온다.
      const { data: au } = await admin.rpc('admin_user_emails')
      const hit = (au ?? []).find((u: any) => (u.email ?? '').toLowerCase() === emailIn)
      if (hit) userId = (hit as any).id
    } catch { /* 아래에서 404 */ }
    if (!userId) return json({ error: `가입된 계정을 찾을 수 없습니다: ${emailIn}` }, 404)
  }

  const { data: round } = await admin.from('exam_rounds').select('id').eq('id', roundId).maybeSingle()
  if (!round) return json({ error: '회차를 찾을 수 없습니다.' }, 404)
  // exams 행이 없으면 응시권만 있고 응시할 시험이 없는 상태가 된다(start-exam 이 400 을 뱉는다).
  const { data: exam } = await admin.from('exams').select('id, active').eq('round_id', roundId).eq('tier', tier).maybeSingle()
  if (!exam || !exam.active) {
    return json({ error: '이 회차에 해당 급수 시험이 열려 있지 않습니다. 회차 편집에서 급수를 먼저 여세요.' }, 400)
  }

  // 발급도 상태 전이라 _shared 헬퍼로만 한다 — 중복·오타 판정은 전부 DB 제약이 하고,
  // 헬퍼가 23505 를 '같은 결제 재시도'와 '슬롯 선점'으로 갈라준다(여기서 다시 구현하면 규칙이 갈린다).
  const res = await grantExamTicket(admin, {
    userId, roundId, tier,
    source: 'admin',
    pricePaid: 0, // 무상 발급. 매출 집계에서 결제분과 섞이면 안 된다.
    grantedBy: actorEmail,
    note,
  })
  if (!res.ok) {
    return json({
      error: res.code === 'live_conflict'
        ? '이 사용자는 이미 이 회차·급수의 응시권을 갖고 있습니다(사용 완료 포함). 회수한 뒤 다시 발급하세요.'
        : res.error,
    }, res.code === 'live_conflict' ? 409 : 400)
  }
  return json({ ok: true, ticketId: res.ticket.id, userId })
}

/**
 * 회수(void) — 오등록·본인확인 실패·부정 응시. **루트 전용**(위 규칙 ③).
 *
 * ⚠️ 연결 결제를 어떻게 할지 반드시 같이 정하게 한다. 결제를 paid 로 그냥 두면
 *    payments_paid_product_uniq 가 계속 걸려 사용자는 같은 회차·급수를 **영구히 다시 살 수 없다**
 *    (화면 문구는 '이미 결제가 완료된 상품입니다' 라 상황과 정반대로 읽힌다).
 * ⚠️ 여기서 실제 환불이 일어나지는 않는다 — 토스 취소 API 는 의도적으로 안 붙였다.
 *    'refunded' 는 "PG 에서 환불을 끝냈으니 원장을 맞춘다" 는 뜻이다.
 */
async function examTicketVoid(admin: any, body: any, actorEmail: string, isRoot: boolean) {
  if (!isRoot) return json({ error: '루트 관리자만 응시권을 회수할 수 있습니다.' }, 403)
  const id = String(body?.id ?? '').trim()
  const reason = String(body?.reason ?? '').trim()
  const settle = body?.settlePayment === 'refunded' ? 'refunded' : 'keep'
  if (!id) return json({ error: 'id 필요' }, 400)
  if (!reason) return json({ error: '회수 사유를 적어주세요(분쟁 때 추적할 게 이것뿐입니다).' }, 400)

  const { data: t } = await admin.from('exam_tickets').select('id, status, payment_id').eq('id', id).maybeSingle()
  if (!t) return json({ error: '응시권을 찾을 수 없습니다.' }, 404)
  if (t.status === 'void') return json({ error: '이미 회수된 응시권입니다.' }, 409)

  // 상태 전이는 _shared/exam-tickets.ts 의 헬퍼로만 한다(voided_at·void_reason 을 빼먹지 않게).
  // 처리자를 담을 별도 컬럼이 없어(granted_by 는 발급자 자리) 사유 문자열에 붙여 추적한다.
  const { voided } = await voidTicket(admin, id, `${reason} · 처리자 ${actorEmail}`)
  if (!voided) return json({ error: '회수할 수 없는 상태입니다(이미 회수됐거나 만료 처리됨).' }, 409)

  const now = new Date().toISOString()
  let paymentNote: string | null = null
  if (t.payment_id) {
    if (settle === 'refunded') {
      const { error: pe } = await admin.from('payments')
        .update({ status: 'refunded', updated_at: now })
        .eq('id', t.payment_id)
        .eq('status', 'paid')
      paymentNote = pe
        ? `결제 원장 갱신 실패: ${pe.message}`
        : '연결 결제를 환불(refunded)로 표시했습니다. 실제 환불은 PG 관리자에서 별도로 처리하세요. 이 사용자는 같은 회차·급수를 다시 결제할 수 있습니다.'
    } else {
      paymentNote = '연결 결제는 손대지 않았습니다. 결제가 paid 로 남아 있으면 이 사용자는 같은 회차·급수를 다시 결제할 수 없으니, 응시가 필요하면 수기 발급으로 다시 주세요.'
    }
  }
  return json({ ok: true, paymentNote })
}

// ---------- 응시 중단 조회 · 복구 ----------
//
// 배경: 감독관 없는 자율응시라 "응시 화면을 벗어났다 돌아오면 무효"가 기본값이다(start-exam).
//   서버는 **PC 가 뻗은 것과 일부러 나간 것을 구분할 수 없다** — 그래서 자동으로 봐주지 않고,
//   문의가 오면 사람이 아래 자료를 보고 푼다. 자료가 없으면 감으로 결정하게 되므로 같이 만들었다.
//
// ⚠️ 여기 값들은 **증거가 아니라 정황**이다. 랜선을 뽑으면 종료 신호도 안 남는다.
//    그래도 "닫힘 신호가 남아 있다" = 사람이 창을 닫았다는 뜻이고, 공백 길이·진행률과 같이 보면
//    아무 자료 없이 판단하는 것과는 다르다. 상습적인 사람은 이력에 패턴이 남는다.

/** 무효된 응시 하나의 중단 정황 — 마지막 생존 시각, 공백, 종료 신호 유무, 진행률, 이력 전체. */
async function examInterruption(admin: any, body: any) {
  const attemptId = String(body?.attemptId ?? '').trim()
  if (!attemptId) return json({ error: 'attemptId 필요' }, 400)

  const { data: a } = await admin
    .from('exam_attempts')
    .select(
      'id, user_id, exam_id, status, void_reason, started_at, submitted_at, last_seen_at, answered_count, total_questions, entry_count, reinstated_at, reinstated_by, reinstate_note',
    )
    .eq('id', attemptId)
    .maybeSingle()
  if (!a) return json({ error: '응시를 찾을 수 없습니다.' }, 404)

  const { data: events } = await admin
    .from('exam_session_events')
    .select('kind, at, detail')
    .eq('attempt_id', attemptId)
    .order('at', { ascending: true })
    .limit(200)

  const rows = (events ?? []) as { kind: string; at: string; detail: Record<string, unknown> }[]
  // ⭐ 판단의 핵심 한 줄 — 닫힘 신호가 있었나.
  //    있으면 사람이 창을 닫은 것이고, 없이 끊겼으면 알릴 틈이 없었던 것(전원 차단·PC 정지)이다.
  const closed = rows.filter((r) => r.kind === 'closed')
  const reentries = rows.filter((r) => r.kind === 'reentry')

  return json({
    attempt: a,
    events: rows,
    summary: {
      // 마지막 생존 이후 재진입까지 비어 있던 시간(초). 사고는 대개 짧고, 찾아보고 온 건 길다.
      gapSec: (reentries.at(-1)?.detail?.gapSec as number | null) ?? null,
      // 끊긴 시점의 진행률. "하나도 안 풀고 훑기만 하다 나갔다" 가 여기서 드러난다.
      answered: (a.answered_count as number) ?? 0,
      totalQuestions: (a.total_questions as number) ?? 0,
      hadCloseSignal: closed.length > 0,
      closeVia: (closed.at(-1)?.detail?.via as string | undefined) ?? null,
      reentryCount: reentries.length,
    },
  })
}

/**
 * 중단된 응시를 다시 볼 수 있게 풀어준다.
 *
 * ⛔ **응시 기간(10일) 안에서만 의미가 있다(2026-08-13 결정).** 예전엔 별도 기한을 줘서 회차가
 *    닫혀도 들어갈 수 있게 했는데, 규칙을 "10일 안에만" 으로 정리하면서 걷어냈다. 마지막 날 저녁에
 *    끊겨 다음 날 처리되는 사람은 응시하지 못한다 — 열흘을 줬는데 마지막 날 밤에 시작한 쪽의 몫이다.
 *    ⚠️ 그래서 관리자 화면이 **기간이 이미 끝났는지 보여줘야 한다**. 안 그러면 복구를 눌러놓고
 *       "왜 안 들어가지냐" 가 된다(Admin.tsx 의 InterruptionPanel).
 *
 * ⛔ **남은 시간은 보존된다.** 끊긴 시각까지 쓴 만큼만 소비된 것으로 치고 나머지를 돌려준다.
 *    계산은 **응시자가 실제로 다시 들어오는 순간** start-exam 이 한다 — 복구를 눌러준 시점에 맞추면
 *    관리자가 승인해놓고 응시자가 몇 시간 뒤 들어올 때 그 사이가 다 흘러간다.
 *    ⚠️ 이게 성립하는 건 답안이 하트비트로 저장되기 때문이다(exam-session). 답이 안 남으면
 *       시간만 깎인 백지가 된다 — 둘은 한 쌍이다.
 *
 * ⚠️ 응시권을 새로 쓰지는 않는다 — 같은 응시권·같은 문항으로 이어서 볼 뿐이다.
 *    다른 문항으로 처음부터 보게 하려면 응시권을 새로 발급하는 게 맞다(examTicketGrant).
 * ⚠️ 사유를 반드시 받는다. "특정인만 살려줬다" 는 말이 나올 수 있는 자리라,
 *    누가·언제·왜가 남지 않으면 나중에 아무것도 해명할 수 없다.
 */
async function examReinstate(admin: any, body: any, actorEmail: string) {
  const attemptId = String(body?.attemptId ?? '').trim()
  const note = String(body?.note ?? '').trim()
  if (!attemptId) return json({ error: 'attemptId 필요' }, 400)
  if (!note) return json({ error: '복구 사유를 적어주세요(나중에 근거가 될 것이 이것뿐입니다).' }, 400)

  const { data: a } = await admin
    .from('exam_attempts')
    .select('id, status, void_reason, started_at, last_seen_at, submitted_at')
    .eq('id', attemptId)
    .maybeSingle()
  if (!a) return json({ error: '응시를 찾을 수 없습니다.' }, 404)
  // ⚠️ voided 만 받으면 안 된다. 응시 기간이 닫힌 뒤에는 재진입이 티켓 필터에서 먼저 막혀
  //    (start-exam 의 resume_blocked) 무효 판정에 닿지도 못한 채 in_progress 로 남는다.
  if (a.status === 'submitted') {
    return json({ error: '이미 제출된 응시입니다. 복구 대상이 아닙니다.' }, 409)
  }

  const now = new Date().toISOString()
  const { data: won } = await admin
    .from('exam_attempts')
    .update({
      status: 'in_progress',
      // 무효로 찍혔던 제출시각을 되돌린다 — 남겨두면 '제출한 응시'로 보여 목록·집계가 어긋난다.
      submitted_at: null,
      reinstated_at: now,
      reinstated_by: actorEmail,
      reinstate_note: note.slice(0, 500),
    })
    .eq('id', attemptId)
    .neq('status', 'submitted') // 그 사이 제출됐으면 덮어쓰지 않는다
    .select('id')
    .maybeSingle()
  if (!won) return json({ error: '복구할 수 없는 상태입니다(이미 제출됨).' }, 409)

  await admin.from('exam_session_events').insert({
    attempt_id: attemptId,
    kind: 'reinstate',
    detail: { by: actorEmail, note: note.slice(0, 500), prevVoidReason: a.void_reason ?? null },
  })
  return json({
    ok: true,
    note: '복구했습니다. 끊긴 시점의 답안과 남은 시간 그대로 이어서 응시할 수 있습니다. 다만 **응시 기간 안에서만** 들어갈 수 있습니다.',
  })
}

/**
 * 결제 원장 조회 + 30일 집계.
 * queue 는 '돈이 새는' 두 목록이다 — 목록이 사람 눈에 안 닿으면 방어 장치가 아니다.
 *   · unfulfilled = 승인은 났는데 지급이 안 된 건(돈은 받았는데 응시권이 0장)
 *   · revoked     = 환불·취소인데 지급이 살아있는 건(자동 회수를 안 하기로 한 방침의 뒷정리 큐)
 */
async function paymentList(admin: any, body: any) {
  const limit = Math.min(Math.max(1, Math.floor(body?.limit ?? 50)), 500)
  const offset = Math.max(0, Math.floor(body?.offset ?? 0))
  const productType = String(body?.productType ?? '').trim()
  const status = String(body?.status ?? '').trim()
  const queue = String(body?.queue ?? '').trim()
  // 회원 상세의 '결제·구매' 탭이 한 사람 것만 본다. 30일 집계(stats30d)는 이 필터와 무관하게 전체 기준이다 —
  // 그건 대시보드용 숫자라 사람별로 자르면 뜻이 달라진다.
  const userId = String(body?.userId ?? '').trim()

  let sel = admin.from('payments').select(
    'id, user_id, order_id, order_name, product_type, product_ref, amount, status, method, confirmed_at, fulfilled_at, fail_code, fail_message, addon_ebook_id, created_at',
    { count: 'exact' },
  )
  if (userId) sel = sel.eq('user_id', userId)
  if (productType) sel = sel.eq('product_type', productType)
  if (status) sel = sel.eq('status', status)
  if (queue === 'unfulfilled') sel = sel.eq('status', 'paid').is('fulfilled_at', null)
  else if (queue === 'revoked') sel = sel.in('status', ['refunded', 'canceled']).not('fulfilled_at', 'is', null)

  const { data, count, error } = await sel.order('created_at', { ascending: false }).range(offset, offset + limit - 1)
  if (error) return json({ error: error.message }, 400)
  const rows = (data ?? []) as any[]

  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))]
  const nameMap: Record<string, string> = {}
  const emailMap: Record<string, string> = {}
  if (userIds.length) {
    const { data: profs } = await admin.from('profiles').select('id, display_name').in('id', userIds)
    for (const p of profs ?? []) nameMap[(p as any).id] = (p as any).display_name
    try {
      const { data: au } = await admin.rpc('admin_user_emails')
      for (const x of au ?? []) emailMap[(x as any).id] = (x as any).email ?? ''
    } catch { /* 이메일만 빈칸 */ }
  }

  // ── 이북 열람 여부(환불 판단용) ─────────────────────────────────
  // "샀는데 읽었나" 는 환불을 받아줄지 가르는 사실이라 결제 목록에서 바로 보여야 한다.
  // 이북이 결제에 붙는 경로가 셋이라 셋 다 훑는다:
  //   ebook  = product_ref 가 곧 이북 id
  //   bundle = 줄 목록(payment_items)
  //   exam   = 곁다리 교재(addon_ebook_id)
  // ⚠️ ebook_reads 는 환불로 열람권이 지워져도 남는다 — **환불된 건에서도 값이 보이는 게 이 표를 따로 둔 이유**다.
  const readsOf: Record<string, { ebookId: string; title: string | null; firstAt: string | null; lastAt: string | null; count: number }[]> = {}
  {
    const bookOf: Record<string, string[]> = {} // payment_id → ebook ids
    const bundleIds: string[] = []
    for (const p of rows) {
      if (p.product_type === 'ebook' && p.product_ref) bookOf[p.id] = [String(p.product_ref)]
      else if (p.product_type === 'bundle') bundleIds.push(p.id)
      else if (p.product_type === 'exam' && p.addon_ebook_id) bookOf[p.id] = [String(p.addon_ebook_id)]
    }
    if (bundleIds.length) {
      const { data: items } = await admin
        .from('payment_items')
        .select('payment_id, product_ref')
        .in('payment_id', bundleIds)
        .eq('product_type', 'ebook')
      for (const it of items ?? []) {
        const pid = (it as any).payment_id as string
        ;(bookOf[pid] ??= []).push(String((it as any).product_ref))
      }
    }
    const allBooks = [...new Set(Object.values(bookOf).flat())]
    if (allBooks.length && userIds.length) {
      const titleMap: Record<string, string> = {}
      const { data: bs } = await admin.from('ebooks').select('id, title').in('id', allBooks)
      for (const b of bs ?? []) titleMap[(b as any).id] = (b as any).title
      // ⚠️ (사람 × 책) 쌍으로 다시 짚는다 — in × in 은 교차곱이라 **남의 열람이 섞여 들어온다**.
      const rmap: Record<string, { firstAt: string; lastAt: string; count: number }> = {}
      const { data: reads } = await admin
        .from('ebook_reads')
        .select('user_id, ebook_id, first_read_at, last_read_at, read_count')
        .in('ebook_id', allBooks)
        .in('user_id', userIds)
      for (const r of reads ?? []) {
        rmap[`${(r as any).user_id}|${(r as any).ebook_id}`] = {
          firstAt: (r as any).first_read_at,
          lastAt: (r as any).last_read_at,
          count: (r as any).read_count ?? 0,
        }
      }
      for (const p of rows) {
        const ids = bookOf[p.id]
        if (!ids?.length) continue
        readsOf[p.id] = ids.map((bid) => {
          const hit = rmap[`${p.user_id}|${bid}`]
          return {
            ebookId: bid,
            title: titleMap[bid] ?? null,
            firstAt: hit?.firstAt ?? null,
            lastAt: hit?.lastAt ?? null,
            count: hit?.count ?? 0,
          }
        })
      }
    }
  }

  // 30일 집계. 환불은 매출에서 빼지 않고 옆에 세운다 — 정산 기준일이 달라 단순 상계하면 값이 어긋난다.
  const since = new Date(Date.now() - 30 * 86400e3).toISOString()
  const stats = { paidN: 0, paidAmount: 0, refundN: 0, refundAmount: 0 }
  const CHUNK = 1000
  for (let from = 0; from < 50000; from += CHUNK) {
    const { data: chunk, error: ce } = await admin
      .from('payments')
      .select('amount, status')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .range(from, from + CHUNK - 1)
    if (ce) break
    const cr = (chunk ?? []) as any[]
    for (const p of cr) {
      if (p.status === 'paid') { stats.paidN++; stats.paidAmount += p.amount ?? 0 }
      else if (p.status === 'refunded') { stats.refundN++; stats.refundAmount += p.amount ?? 0 }
    }
    if (cr.length < CHUNK) break
  }

  const [unf, rev] = await Promise.all([
    admin.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'paid').is('fulfilled_at', null),
    admin.from('payments').select('id', { count: 'exact', head: true }).in('status', ['refunded', 'canceled']).not('fulfilled_at', 'is', null),
  ])

  return json({
    payments: rows.map((p) => ({
      id: p.id,
      userId: p.user_id,
      name: nameMap[p.user_id] ?? null,
      email: emailMap[p.user_id] ?? null,
      orderId: p.order_id,
      orderName: p.order_name,
      productType: p.product_type,
      productRef: p.product_ref,
      amount: p.amount ?? 0,
      status: p.status,
      method: p.method ?? null,
      confirmedAt: p.confirmed_at,
      fulfilledAt: p.fulfilled_at,
      failCode: p.fail_code ?? null,
      failMessage: p.fail_message ?? null,
      createdAt: p.created_at,
      reads: readsOf[p.id] ?? [],
    })),
    total: count ?? rows.length,
    stats30d: stats,
    queues: { unfulfilled: unf.count ?? 0, revoked: rev.count ?? 0 },
  })
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
    const { data: au } = await admin.rpc('admin_user_emails')
    for (const u of au ?? []) {
      const e = ((u as any).email ?? '').trim().toLowerCase()
      if (e) registered.add(e)
    }
  } catch { /* 조회 실패해도 목록은 반환 */ }

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
// 이력은 세 제도 공용 표(`question_history`)에 kind='caris' 로 쌓는다 — 옛 cbt_question_events.
//   number → label(text) · bank_id → scope. 읽고 쓰는 자리는 _shared/question-history.ts 하나다.
async function logCbtEvent(
  admin: any,
  e: { question_id: string | null; bank_id: string | null; number: number | null; action: string; actor: string; detail?: unknown },
) {
  await logQuestionEvent(admin, 'caris', {
    question_id: e.question_id,
    label: e.number,
    scope: e.bank_id,
    action: e.action,
    actor: e.actor,
    detail: e.detail,
  })
}

// 문제은행 목록(급수별) + 은행별 문항 수(비삭제/활성). 문항 관리 셀렉터용.
async function bankListForAdmin(admin: any) {
  const { data, error } = await admin.from('question_banks').select('id, tier, title, active').order('tier', { ascending: true })
  if (error) return json({ error: error.message }, 400)
  const banks = data ?? []
  // ⚠️ 예전엔 은행마다 count 2개를 물었다(급수 6개면 6파 = 12왕복). 은행끼리 의존이 없으므로
  //    한 번에 받아 메모리에서 센다 — 총 2왕복이고 은행 수가 늘어도 안 변한다.
  const total: Record<string, number> = {}
  const active: Record<string, number> = {}
  if (banks.length) {
    const { data: qs } = await admin
      .from('questions')
      .select('bank_id, active')
      .in('bank_id', banks.map((b: any) => b.id))
      .is('deleted_at', null)
    for (const q of (qs ?? []) as { bank_id: string; active: boolean }[]) {
      total[q.bank_id] = (total[q.bank_id] ?? 0) + 1
      if (q.active) active[q.bank_id] = (active[q.bank_id] ?? 0) + 1
    }
  }
  return json({
    banks: banks.map((b: any) => ({ ...b, questionCount: total[b.id] ?? 0, activeCount: active[b.id] ?? 0 })),
  })
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
  // ⚠️ 예전엔 시험마다 count 를 따로 물었다 — 회차가 쌓일수록 왕복이 그대로 늘어나(12회차 × 6급수 = 73회)
  //    시간이 갈수록 느려지는 구조였다. 지금은 한 번에 받아 메모리에서 센다(총 2왕복, 개수와 무관).
  //    ⚠️ 세는 걸 DB 로 내리면(group by) 오가는 행도 같이 줄지만, 이 프로젝트는 PostgREST 집계가
  //       꺼져 있어(PGRST123) RPC 를 새로 파야 한다. 관리자 화면이라 그 값어치가 아직 없다.
  const counts: Record<string, number> = {}
  if (exams.length) {
    const { data: qs } = await admin
      .from('exam_questions')
      .select('exam_id')
      .in('exam_id', exams.map((ex: any) => ex.id))
    for (const q of (qs ?? []) as { exam_id: string }[]) counts[q.exam_id] = (counts[q.exam_id] ?? 0) + 1
  }
  return json({ exams: exams.map((ex: any) => ({ ...ex, questionCount: counts[ex.id] ?? 0, activeCount: counts[ex.id] ?? 0 })) })
}

// 한 은행의 문항 목록(비삭제, 번호순). 관리자에겐 correct_index·해설 포함.
async function questionList(admin: any, body: any) {
  const bankId = body?.bankId
  if (!bankId) return json({ error: 'bankId 필요' }, 400)
  const { data, error } = await admin
    .from('questions')
    .select('id, bank_id, number, subject, difficulty, prompt, prompt_i18n, kind, choices, choices_i18n, correct_index, answer_key, answer_key_i18n, explanation, active')
    .eq('bank_id', bankId)
    .is('deleted_at', null)
    .order('number', { ascending: true })
    .limit(2000)
  if (error) return json({ error: error.message }, 400)
  // 문항마다 '아직 번역 안 된 언어' 를 같이 준다 — 관리자 목록의 '미번역' 칸·번역 완료율·
  // '미번역만 보기' 필터가 전부 이 값 하나를 본다(화면이 따로 세면 두 벌이 된다).
  // ⚠️ ko 는 원본 컬럼이라 언제나 있음 → 대상은 나머지 5개국어뿐(TRANSLATABLE_LANGS).
  const rows = (data ?? []).map((r: any) => ({
    ...r,
    missing: TRANSLATABLE_LANGS.filter((l) => !questionTranslated(r, l)),
  }))
  // 언어별 완료 문항 수 — 화면의 '번역 완료율' 패널이 그대로 그린다(화면이 다시 세지 않는다).
  // ⚠️ 분모는 **활성 문항**이다. 비활성은 세트에 뽑히지 않아 번역할 이유가 없는데,
  //    분모에 넣으면 영영 100% 가 안 돼서 "다 됐다" 를 아무도 판단하지 못한다.
  const live = rows.filter((r: any) => r.active)
  const coverage: Record<string, number> = {}
  for (const l of TRANSLATABLE_LANGS) {
    coverage[l] = live.filter((r: any) => !r.missing.includes(l)).length
  }
  return json({ rows, coverage, total: live.length, langs: TRANSLATABLE_LANGS })
}

// 번역 대상 언어 — 한국어는 원본 컬럼(prompt·choices)에 있으므로 뺀다.
// 이 배열이 '미번역' 판정·완료율·번역 요청의 langs 를 전부 정한다.
const TRANSLATABLE_LANGS = SUPPORTED_LANGS.filter((l) => l !== 'ko')

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

  // 화면이 방금 뽑은 번역을 같이 보내면 그대로 싣는다(편집 모달의 '자동 번역' → 저장 한 번).
  // 개수·빈값 검사는 sanitizeQuestionTrans 한 곳에서 한다 — 저장 경로가 둘(여기·questionTransSave)이라
  // 검사를 각자 쓰면 한쪽만 느슨해져서 정답 번호가 어긋난 보기가 들어온다.
  const sent = sanitizeQuestionTrans(
    q.promptI18n,
    q.choicesI18n,
    (row.choices as string[]) ?? [],
    q.answerKeyI18n,
    row.answer_key as string | null,
  )
  if (sent) {
    row.prompt_i18n = sent.prompt_i18n
    row.choices_i18n = sent.choices_i18n
    row.answer_key_i18n = sent.answer_key_i18n
  }

  const isNew = !q.id
  if (q.id) {
    // ⛔ **한국어 원문이 바뀌면 옛 번역을 그 자리에서 비운다.** 안 비우면 지문만 고쳐도
    //    번역본은 옛 문장 그대로라 외국어 응시자만 **다른 문제를 푼다**(화면에는 아무 표시도 없다).
    //    이북 번역이 본문 교체 때 옛 번역을 비우는 것과 같은 이유다.
    //    ⚠️ 번역을 같이 보냈으면(sent) 그게 새 원문에 맞춰 뽑은 것이므로 비우지 않는다.
    if (!sent) {
      const { data: before } = await admin
        .from('questions').select('prompt, choices, answer_key').eq('id', q.id).maybeSingle()
      // ⚠️ **지문·보기와 모범답안을 따로 본다.** 모범답안만 고쳤으면 지문 번역은 그대로 유효한데
      //    같이 비우면 멀쩡한 5개국어를 버리고 다시 번역하게 된다(반대도 마찬가지).
      const koChanged =
        !!before &&
        (String(before.prompt ?? '') !== prompt ||
          JSON.stringify(before.choices ?? []) !== JSON.stringify(row.choices ?? []))
      if (koChanged) {
        row.prompt_i18n = {}
        row.choices_i18n = {}
      }
      // 모범답안이 바뀌면 그 번역은 다른 답을 가리킨다 — 그대로 두면 **틀린 답이 정답으로 통과**한다.
      if (!!before && String(before.answer_key ?? '') !== String(row.answer_key ?? '')) {
        row.answer_key_i18n = {}
      }
    }
    const { error } = await admin.from('questions').update(row).eq('id', q.id)
    if (error) return json({ error: error.message }, 400)
  } else {
    const { error } = await admin.from('questions').upsert(row, { onConflict: 'bank_id,number' })
    if (error) return json({ error: error.message }, 400)
  }
  await logCbtEvent(admin, { question_id: q.id ?? null, bank_id: bankId, number, action: isNew ? 'import' : 'edit', actor, detail: { kind, single: true } })
  return json({ ok: true })
}

// 번역본 정리 — 저장 전 마지막 관문. 통과 못 한 언어는 **버린다**(원문으로 뜨는 게 맞다).
//  · 지문이 비었으면 그 언어 탈락
//  · 보기 개수가 원문과 다르거나 빈 보기가 있으면 그 언어 탈락
//    ⚠️ 개수가 어긋난 채로 저장되면 correct_index 가 다른 보기를 가리켜 **아무도 못 맞히는 문항**이 된다.
//  · 주관식 허용답안은 **있으면 담고 없어도 탈락시키지 않는다**(아래 참고).
//  · ko 는 절대 담지 않는다 — 한국어 단일 출처는 원본 컬럼이다(마이그레이션 20260825190000).
// 보낸 게 아무것도 없으면 null → 호출부가 "번역을 안 보냈다" 로 다룬다(빈 객체 저장과 구분).
function sanitizeQuestionTrans(
  promptI18n: unknown,
  choicesI18n: unknown,
  koChoices: string[],
  answerKeyI18n?: unknown,
  koAnswerKey?: string | null,
): {
  prompt_i18n: Record<string, string>
  choices_i18n: Record<string, string[]>
  answer_key_i18n: Record<string, string[]>
} | null {
  const pIn = (promptI18n ?? null) as Record<string, unknown> | null
  const cIn = (choicesI18n ?? null) as Record<string, unknown> | null
  const aIn = (answerKeyI18n ?? null) as Record<string, unknown> | null
  if (!pIn && !cIn && !aIn) return null
  const prompt_i18n: Record<string, string> = {}
  const choices_i18n: Record<string, string[]> = {}
  const answer_key_i18n: Record<string, string[]> = {}
  for (const lang of TRANSLATABLE_LANGS) {
    const p = pIn?.[lang]
    if (typeof p !== 'string' || !p.trim()) continue
    if (koChoices.length > 0) {
      const o = cIn?.[lang]
      if (!Array.isArray(o) || o.length !== koChoices.length) continue
      const opts = o.map((x) => String(x ?? '').trim())
      if (opts.some((x) => !x)) continue
      choices_i18n[lang] = opts
    } else if (koAnswerKey && String(koAnswerKey).trim()) {
      // 주관식 허용답안 — 개수는 안 본다(원문과 다른 게 정상이다. 표기 변형 가짓수가 언어마다 다르고,
      // 순서가 정답 번호를 가리키지도 않는다). 채점은 원문+번역 합집합 포함 여부만 본다.
      // ⚠️ **답 번역이 비어도 그 언어를 탈락시키지 않는다** — 탈락시키면 멀쩡히 번역된 지문까지
      //    같이 버려진다. 안 담고 넘어가면 questionTranslated 가 그 언어를 '미번역'으로 남겨서
      //    관리자가 「미번역 번역」을 다시 누를 때 그 문항만 재시도된다.
      const a = aIn?.[lang]
      if (Array.isArray(a)) {
        const list = [...new Set(a.map((x) => String(x ?? '').trim()).filter(Boolean))]
        if (list.length) answer_key_i18n[lang] = list
      }
    }
    prompt_i18n[lang] = p.trim()
  }
  return { prompt_i18n, choices_i18n, answer_key_i18n }
}

// 번역본만 저장 — 목록에서 여러 문항을 한 번에 번역할 때 쓴다(한국어 원문은 손대지 않는다).
//  요청: { rows: [{ id, promptI18n, choicesI18n, answerKeyI18n }] }
// ⚠️ **원문을 DB 에서 다시 읽어** 보기 개수를 대조한다. 화면이 보낸 개수를 믿으면, 번역을 뽑는 사이
//    다른 창에서 보기를 고친 문항에 옛 개수 기준 번역이 박힌다. 모범답안도 같은 이유로 다시 읽는다
//    (그 사이에 답이 바뀌었으면 지금 들고 온 번역은 다른 답의 것이다).
async function questionTransSave(admin: any, body: any, actor: string) {
  const rows = Array.isArray(body?.rows) ? body.rows : []
  if (!rows.length) return json({ error: '저장할 번역이 없습니다.' }, 400)
  const ids = rows.map((r: any) => r?.id).filter(Boolean)
  if (!ids.length) return json({ error: 'id 가 없는 행이 있습니다.' }, 400)

  const { data: cur, error: readErr } = await admin
    .from('questions').select('id, bank_id, number, choices, answer_key').in('id', ids)
  if (readErr) return json({ error: readErr.message }, 400)
  const byId: Record<string, any> = {}
  for (const c of cur ?? []) byId[c.id] = c

  let saved = 0
  let skipped = 0
  for (const r of rows) {
    const base = byId[r.id]
    if (!base) { skipped++; continue }
    const clean = sanitizeQuestionTrans(
      r.promptI18n, r.choicesI18n, base.choices ?? [], r.answerKeyI18n, base.answer_key,
    )
    if (!clean || Object.keys(clean.prompt_i18n).length === 0) { skipped++; continue }
    const { error } = await admin
      .from('questions')
      .update({
        prompt_i18n: clean.prompt_i18n,
        choices_i18n: clean.choices_i18n,
        answer_key_i18n: clean.answer_key_i18n,
      })
      .eq('id', r.id)
    if (error) return json({ error: error.message }, 400)
    saved++
  }
  // 문항마다 이벤트를 남기면 588건 번역에 588줄이 쌓여 이력 탭이 그것만 보인다 — 한 줄로 접는다.
  await logCbtEvent(admin, {
    question_id: null, bank_id: body?.bankId ?? null, number: null,
    action: 'edit', actor, detail: { translate: true, saved, skipped },
  })
  return json({ ok: true, saved, skipped })
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
// ⚠️ 문항 번호는 `label`(text)이다 — 옛 `number`(int)가 세 제도 공용 표로 접히면서 문자열이 됐다.
async function questionEvents(admin: any, body: any) {
  const { rows: events, error } = await readQuestionHistory(admin, 'caris', { scope: body?.bankId ?? null })
  if (error) return json({ error }, 400)
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
    const prompt = String(r?.prompt ?? '').trim()
    if (!subject || !prompt) return json({ error: `#${i + 1}행: 과목·지문은 필수` }, 400)
    const kind = r?.kind === 'short' ? 'short' : 'mc'
    // 해설 — 객관식/주관식 공통(선택). 클라 비노출.
    const explanation = String(r?.explanation ?? '').trim() || null
    next++ // 은행 뒤에 이어붙일 새 번호
    if (kind === 'short') {
      // 주관식 — 보기/정답번호 없음, 모범답안(answerKey)은 선택
      payload.push({ bank_id: bankId, number: next, subject, difficulty, prompt, kind, choices: [], correct_index: null, answer_key: String(r?.answerKey ?? '').trim() || null, explanation, active: true, deleted_at: null })
      continue
    }
    const choices = Array.isArray(r?.choices) ? r.choices.map((c: unknown) => String(c ?? '').trim()) : []
    if (choices.length !== 4 || choices.some((c: string) => !c)) return json({ error: `#${i + 1}행: 보기 4개가 모두 필요` }, 400)
    const ci = Math.floor(Number(r?.correctIndex))
    if (!Number.isFinite(ci) || ci < 0 || ci > 3) return json({ error: `#${i + 1}행: 정답(1~4) 오류` }, 400)
    payload.push({ bank_id: bankId, number: next, subject, difficulty, prompt, kind, choices, correct_index: ci, answer_key: null, explanation, active: true, deleted_at: null })
  }

  // ⚠️ **방금 넣은 행의 id·번호를 돌려준다** — 화면이 업로드 직후 이어서 번역을 돌리고
  //    그 결과를 questionTransSave 로 붙이는 데 쓴다(2026-08-26). 없으면 화면이 "방금 올린 게
  //    어느 문항인지" 를 알 길이 없어 목록 전체를 다시 읽어 추측해야 한다.
  //    번호(number)를 같이 주는 이유 = 화면이 보낸 순서와 돌아온 순서가 같은지 대조할 수 있게.
  const { data, error } = await admin.from('questions').insert(payload).select('id, number')
  if (error) return json({ error: error.message }, 400)
  await logCbtEvent(admin, { question_id: null, bank_id: bankId, number: null, action: 'import', actor, detail: { count: payload.length } })
  return json({
    ok: true,
    count: data?.length ?? payload.length,
    inserted: (data ?? []).map((r: any) => ({ id: r.id, number: r.number })),
  })
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

  // 뽑힌 세트에 미번역이 몇 개인지 — **막지 않고 알려만 준다.**
  // 미번역 문항을 후보에서 빼면 번역이 덜 된 동안 '보유 0/필요 N' 로 뽑기가 통째로 실패해
  // 한국어만 받는 회차까지 못 연다. 그 문항은 응시 화면에서 한국어로 뜬다(빈 화면이 아니다).
  const { data: drawn } = await admin
    .from('questions')
    // ⚠️ answer_key·answer_key_i18n 도 같이 읽는다 — questionTranslated 가 주관식은 모범답안
    //    번역까지 봐서, 안 읽으면 답이 다 번역돼 있어도 전부 미번역으로 세어 경고가 거짓말을 한다.
    .select('prompt_i18n, choices_i18n, choices, answer_key, answer_key_i18n')
    .in('id', picked)
  const untranslated: Record<string, number> = {}
  for (const l of TRANSLATABLE_LANGS) {
    const n = (drawn ?? []).filter((r: any) => !questionTranslated(r, l)).length
    if (n > 0) untranslated[l] = n
  }
  return json({ ok: true, count: rows.length, untranslated })
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
    admin.from('exam_rounds').select('id, title_i18n, exam_date, apply_start_at, apply_end_at').eq('published', true),
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
// 합격선은 **응시 시점 값**(exam_attempts.pass_ratio_snapshot)이다 — 판정은 _shared 의 attemptPassed 하나가 한다.
//   ⚠️ 여기 0.6 을 다시 박지 말 것. 급수별 합격선이 생긴 뒤로는(exam_tiers.pass_ratio) 그 값이
//      관리자 화면과 사용자 화면에서 다른 말을 하게 된다.
// 자격증은 별도 테이블이 없어 "합격 + 결과공개일 경과" 를 발급 가능으로 본다(응시 기록에서 계산).

async function cbtUsers(admin: any) {
  // CARIS는 익명 응시 불가(start-exam이 게스트 차단) → CARIS ARENA 게스트(is_anonymous)는 회원목록에서 제외.
  const { data: profiles } = await admin
    .from('profiles')
    // ⚠️ 탈퇴 계정도 **목록에 남긴다** — 여기서 빼면 관리자가 "탈퇴했다" 는 사실 자체를 볼 길이 없다.
    //    2026-08-24 에 탈퇴 상태로 서비스를 계속 쓴 계정이 나왔는데 화면으로는 알아낼 방법이 없었다.
    .select('id, display_name, is_anonymous, created_at, deactivated_at, purged_at')
    .eq('is_anonymous', false)
    .order('created_at', { ascending: false })
    .limit(5000)
  const { data: atts } = await admin
    .from('exam_attempts')
    .select('user_id, exam_id, submitted_at, total_correct, total_questions, pass_ratio_snapshot')
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
  const pass: Record<string, number> = {} // 합격 건수(응시 시점 합격선 이상)
  const passTitles: Record<string, string[]> = {} // 합격한 시험명(→ 프론트에서 급수 칩으로)
  const last: Record<string, string> = {}
  for (const a of atts ?? []) {
    const u = (a as any).user_id
    cnt[u] = (cnt[u] || 0) + 1
    if (attemptPassed(a.total_correct, a.total_questions, a.pass_ratio_snapshot)) {
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
    // ⚠️ 옛 코드는 auth 관리 API 를 페이지네이션으로 훑었는데, 실패가 조용히 삼켜져
    //    **회원 목록의 이메일이 통째로 빈칸**이 됐다(auth.users 엔 실제로 들어 있었다).
    const { data: au } = await admin.rpc('admin_user_emails')
    for (const x of (au ?? []) as any[]) emailMap[x.id] = x.email ?? ''
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
    // 탈퇴 신청 시각 · 파기 완료 시각. 화면은 이 둘로 '탈퇴' / '파기됨' 을 가른다
    // (파기된 계정은 복구할 것이 없다 — 구글 연결이 끊겨 본인도 못 들어온다).
    deactivated: p.deactivated_at ?? null,
    purged: p.purged_at ?? null,
  }))
  return json({ users })
}

// 회원 상세 — 응시 이력(시험명 포함).
async function cbtUserDetail(admin: any, body: any) {
  const uid = body?.userId
  if (!uid) return json({ error: 'userId 필요' }, 400)
  const { data: atts } = await admin
    .from('exam_attempts')
    .select('id, exam_id, status, total_correct, total_questions, pass_ratio_snapshot, submitted_at, created_at, result_release_at')
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
    // 합격 = 응시 시점 합격선 이상(my-attempts 와 같은 헬퍼). 미채점·미제출은 null.
    passed: a.status === 'submitted'
      ? attemptPassed(a.total_correct, a.total_questions, a.pass_ratio_snapshot)
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

// ---------- 어드민: 첫 진입 상태로 되돌리기 ----------
// 신규 가입 흐름(닉네임 → 국가·지역·연령대)을 실제 경로 그대로 다시 태운다. 온보딩 값만 비운다
// (코인·아바타·응시 이력·자격증은 그대로) — 마이그레이션 20260819170000 주석 참고.
//
// ⚠️ **루트 전용이다.** 이 조작은 '국가·지역 1회 변경' 잠금까지 풀어준다 — 등록 이메일 아무나 누를 수 있으면
//    잠금이 사실상 없는 것과 같다(examTicketGrant 를 루트로 막은 것과 같은 이유).
// ⚠️ 되돌릴 수 없으므로 admin_audit 에 남긴다 — 누가 남의 계정을 초기화했는지 답할 수 있어야 한다.
async function resetOnboarding(admin: any, body: any, email: string, isRoot: boolean) {
  if (!isRoot) return json({ error: '루트 관리자만 초기화할 수 있습니다.' }, 403)
  const uid = String(body?.uid ?? '').trim()
  if (!uid) return json({ error: 'uid 가 필요합니다.' }, 400)

  // 되돌리기 전 값을 로그에 남긴다 — 실수로 눌렀을 때 사람이 복구할 근거가 이것뿐이다.
  const { data: before } = await admin
    .from('profiles')
    .select('nickname_set_at, region_locked_at, region_changed_at, country_code, region_code, age_band')
    .eq('id', uid)
    .maybeSingle()
  if (!before) return json({ error: '회원을 찾을 수 없습니다.' }, 404)

  const { error } = await admin.rpc('admin_reset_onboarding', { p_uid: uid })
  if (error) return json({ error: error.message }, 400)

  // 로그 실패로 초기화를 되돌리지는 않는다(이미 끝난 조작이다). 조용히 삼킨다.
  await admin.from('admin_audit').insert({
    actor_email: email,
    action: 'resetOnboarding',
    target: uid,
    detail: { before },
  })
  return json({ ok: true, before })
}

// 탈퇴 계정 복구(회원 상세의 '복구' 버튼).
// ⚠️ 루트 전용으로 두지 않는다 — 되돌릴 수 있는 조작이고(다시 탈퇴하면 그만), 실수로 탈퇴한
//    사용자의 문의는 아무 관리자나 받는다. resetOnboarding 을 루트로 막은 이유(되돌릴 수 없음)와 다르다.
// ⚠️ 판정·닉네임 충돌 처리는 전부 RPC 안에 있다(admin_restore_account) — 본인 복구와 같은 규칙을 쓰려고
//    한 벌로 뒀다. 여기서 조건을 더 얹으면 두 경로가 다른 말을 한다.
async function restoreAccount(admin: any, body: any, email: string) {
  const uid = String(body?.uid ?? '').trim()
  if (!uid) return json({ error: 'uid 가 필요합니다.' }, 400)

  const { data, error } = await admin.rpc('admin_restore_account', { p_uid: uid })
  if (error) {
    const msg = String(error.message ?? '')
    if (/purged/.test(msg)) return json({ error: '이미 파기된 계정이라 복구할 수 없습니다.' }, 409)
    if (/not_found/.test(msg)) return json({ error: '회원을 찾을 수 없습니다.' }, 404)
    return json({ error: msg || '복구에 실패했습니다.' }, 400)
  }

  // 로그 실패로 복구를 되돌리지는 않는다(이미 끝난 조작이다).
  await admin.from('admin_audit').insert({
    actor_email: email,
    action: 'restoreAccount',
    target: uid,
    detail: data ?? {},
  })
  return json({ ok: true, ...(data ?? {}) })
}

// ---------- 어드민: 이북(전자책) ----------
// 본문 HTML·표지 파일은 클라가 스토리지에 직접 올리고(관리자 전용 정책), 여기선 메타데이터만 다룬다.
async function ebookList(admin: any) {
  const { data, error } = await admin
    .from('ebooks')
    .select('id, title, author, description, cover_url, price_usd_cents, catalog, target_level, target_tier, storage_path, published, sort_order, created_at, updated_at, translations')
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
    // 정가는 달러 센트(100 = $1.00). 옛 price(원화)는 읽지 않는다.
    price_usd_cents: b.price_usd_cents ?? 0,
    catalog: b.catalog ?? 'leveltest',
    targetLevel: b.target_level ?? null,
    targetTier: b.target_tier ?? null,
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
// 급수 키 — 값의 정당성은 여기서 안 본다. exam_tiers FK 가 오타를 23503 으로 튕기므로
// 목록을 여기 한 벌 더 두면 티어를 추가할 때 고칠 곳만 늘어난다(_shared/exam-tickets.ts · caris.ts 에 이미 있다).
function tierOrNull(v: any): string | null {
  return String(v ?? '').trim() || null
}

// 표지 공개 URL → ebook-covers 버킷 안 경로. 모르는 형식이면 null 을 준다(모르는 건 지우지 않는다).
function coverPath(url: any): string | null {
  const m = String(url ?? '').match(/\/storage\/v1\/object\/public\/ebook-covers\/(.+)$/)
  return m ? decodeURIComponent(m[1]) : null
}

/** 이북 한 권이 실제로 붙들고 있는 파일 경로 — 본문(원문+번역본)과 표지(원문+번역본)를 버킷별로 나눠 준다. */
function ebookFiles(row: any): { html: string[]; covers: string[] } {
  const tr = Object.values((row?.translations ?? {}) as Record<string, any>)
  return {
    html: [row?.storage_path, ...tr.map((t: any) => t?.path)].filter(Boolean) as string[],
    covers: [coverPath(row?.cover_url), ...tr.map((t: any) => coverPath(t?.coverUrl))].filter(Boolean) as string[],
  }
}

/**
 * 수정으로 **버려진** 파일을 지운다(새 값에 없는 옛 경로만).
 *
 * ⚠️ 반드시 DB 갱신 **뒤에** 부를 것 — 먼저 지웠다가 갱신이 실패하면 멀쩡한 책의 본문이 사라진다.
 * ⚠️ 실패는 삼킨다 — 파일이 남는 건 용량만 먹지 책은 정상이다. 여기서 던지면 저장이 실패한 것처럼 보인다.
 *
 * 이게 없어서 재업로드마다 옛 폴더가 그대로 쌓였다(2026-08-18: 이북 10권인데 폴더 55개, 고아 1.8GB).
 */
async function removeStaleEbookFiles(admin: any, oldRow: any, newRow: any) {
  const before = ebookFiles(oldRow)
  const after = ebookFiles(newRow)
  const html = before.html.filter((p) => !after.html.includes(p))
  const covers = before.covers.filter((p) => !after.covers.includes(p))
  if (html.length) {
    try { await admin.storage.from('ebooks').remove(html) } catch { /* 파일만 남아도 무해 */ }
  }
  if (covers.length) {
    try { await admin.storage.from('ebook-covers').remove(covers) } catch { /* 파일만 남아도 무해 */ }
  }
}

async function ebookUpsert(admin: any, body: any) {
  const e = body?.ebook ?? {}
  const title = String(e.title ?? '').trim()
  const storagePath = String(e.storagePath ?? '').trim()
  if (!title) return json({ error: '제목은 필수입니다.' }, 400)
  if (!storagePath) return json({ error: '이북 HTML 파일을 업로드해 주세요.' }, 400)
  const catalog = e.catalog === 'caris' ? 'caris' : 'leveltest'

  const row = {
    title,
    author: e.author ? String(e.author).trim() : null,
    description: e.description ? String(e.description).trim() : null,
    cover_url: e.coverUrl ? String(e.coverUrl).trim() : null,
    price_usd_cents: Math.max(0, Math.floor(Number(e.price_usd_cents ?? 0)) || 0),
    // 카탈로그 = 러닝 라이브러리의 어느 탭에 서는가(LEVELTEST / CARIS).
    //   반대쪽 분류값은 **여기서 비운다** — 레벨을 골라뒀다 CARIS 로 바꾼 책이 두 값을 다 들고 있으면
    //   DB CHECK(ebooks_catalog_target_chk)에 걸려 저장이 통째로 실패한다.
    catalog,
    // 추천 대상 레벨(1~7). 미지정 = null → 결과창 추천에서 뒤로 밀린다.
    target_level: catalog === 'leveltest' ? levelOrNull(e.targetLevel) : null,
    // 대상 급수(beginner..zenith). 미지정 = null(급수 무관).
    target_tier: catalog === 'caris' ? tierOrNull(e.targetTier) : null,
    storage_path: storagePath,
    published: !!e.published,
    sort_order: Math.floor(Number(e.sortOrder ?? 0)) || 0,
    updated_at: new Date().toISOString(),
    // 언어별 본문·표지·메타. 클라가 번역 파이프라인을 돌린 결과를 통째로 넘긴다(없으면 빈 객체 유지).
    translations: e.translations && typeof e.translations === 'object' ? e.translations : {},
  }

  if (e.id) {
    const { data: old } = await admin
      .from('ebooks')
      .select('storage_path, cover_url, translations')
      .eq('id', e.id)
      .maybeSingle()
    const { error } = await admin.from('ebooks').update(row).eq('id', e.id)
    if (error) return json({ error: error.message }, 400)
    if (old) await removeStaleEbookFiles(admin, old, row)
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
  const err = await reorderRows(admin, 'ebooks', 'sort_order', ids)
  if (err) return json({ error: err.message }, 400)
  return json({ ok: true })
}

// 삭제 = 메타데이터 + 본문 파일 + 표지(둘 다 번역본 포함). 구매 기록은 FK cascade 로 함께 사라진다(환불/회수와 동일 취급).
//   ⚠️ 표지를 빼먹으면 안 된다 — 번역할 때마다 언어별 표지를 새로 굽기 때문에 책 한 권이 표지를 6장씩 남긴다.
async function ebookDelete(admin: any, body: any) {
  const id = String(body?.id ?? '').trim()
  if (!id) return json({ error: 'id 가 필요합니다.' }, 400)
  const { data: b } = await admin
    .from('ebooks')
    .select('storage_path, cover_url, translations')
    .eq('id', id)
    .maybeSingle()
  const { error } = await admin.from('ebooks').delete().eq('id', id)
  if (error) return json({ error: error.message }, 400)
  // 원문 + 언어별 번역본을 함께 지운다(같은 uuid 폴더에 모여 있지만 경로를 직접 모아 지우는 게 확실하다).
  if (b) await removeStaleEbookFiles(admin, b, {})
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
      const { data: au } = await admin.rpc('admin_user_emails')
      for (const x of au ?? []) emailMap[(x as any).id] = (x as any).email ?? ''
    } catch { /* 이메일만 빈칸 */ }
  }
  // 열람 여부(환불 판단용). ebook_reads 는 **구매와 수명이 분리된 표**라 환불된 사람 것도 남아 있다 —
  // 그래서 여기 뜨는 행이 구매자 목록보다 많을 수 있다(사서 읽고 환불한 사람). 그게 이 표를 따로 둔 이유다.
  const readMap: Record<string, { firstAt: string; lastAt: string; count: number }> = {}
  {
    const { data: reads } = await admin
      .from('ebook_reads')
      .select('user_id, first_read_at, last_read_at, read_count')
      .eq('ebook_id', id)
    for (const r of reads ?? []) {
      readMap[(r as any).user_id] = {
        firstAt: (r as any).first_read_at,
        lastAt: (r as any).last_read_at,
        count: (r as any).read_count ?? 0,
      }
    }
  }

  return json({
    buyers: rows.map((r: any) => ({
      userId: r.user_id,
      name: nameMap[r.user_id] ?? null,
      email: emailMap[r.user_id] ?? null,
      pricePaid: r.price_paid ?? 0,
      source: r.source ?? 'demo',
      createdAt: r.created_at,
      read: readMap[r.user_id] ?? null,
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
      case 'boardCatList': return await boardCatList(admin, body)
      case 'boardCatUpsert': return await boardCatUpsert(admin, body)
      case 'boardCatDelete': return await boardCatDelete(admin, body)
      case 'boardCatReorder': return await boardCatReorder(admin, body)
      case 'boardCatMove': return await boardCatMove(admin, body)
      case 'examRoundList': return await examRoundList(admin)
      case 'examRoundUpsert': return await examRoundUpsert(admin, body)
      case 'examRoundDelete': return await examRoundDelete(admin, body)
      case 'fxGet': return await fxGet(admin)
      case 'fxSave': return await fxSave(admin, body)
      case 'examFeeList': return await examFeeList(admin)
      case 'examFeeSave': return await examFeeSave(admin, body)
      case 'examTicketList': return await examTicketList(admin, body)
      case 'examTicketSummary': return await examTicketSummary(admin, body)
      // ⚠️ 발급·회수는 isRoot 를 넘겨 루트 전용으로 막는다(manageAdmins 와 같은 방식).
      //    admin_users 게이트에는 액션별 권한이 없어서, 이 둘을 그냥 얹으면 등록 이메일 = 무료 응시권 발급기다.
      case 'examTicketGrant': return await examTicketGrant(admin, body, email, isRoot)
      case 'examTicketVoid': return await examTicketVoid(admin, body, email, isRoot)
      case 'examInterruption': return await examInterruption(admin, body)
      case 'examReinstate': return await examReinstate(admin, body, email)
      case 'paymentList': return await paymentList(admin, body)
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
      case 'questionTransSave': return await questionTransSave(admin, body, email)
      case 'cbtAnalytics': return await cbtAnalytics(admin)
      case 'cbtUsers': return await cbtUsers(admin)
      case 'cbtUserDetail': return await cbtUserDetail(admin, body)
      case 'setRegion': return await setRegion(admin, body)
      // ⚠️ isRoot 를 넘겨 루트 전용으로 막는다(위 주석 — 지역 1회 변경 잠금을 푸는 조작이다).
      case 'resetOnboarding': return await resetOnboarding(admin, body, email, isRoot)
      case 'restoreAccount': return await restoreAccount(admin, body, email)
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
      default: {
        // 관리자페이지 재편(2026-08-11)으로 생긴 액션들은 reform.ts 로 뺐다 — index.ts 가 이미 2.6k줄이다.
        //   번역기는 **여기 것을 넘겨준다**(강의 제목·소개 자동 번역). reform.ts 가 import 하면
        //   index.ts ↔ reform.ts 가 순환한다 — 자세한 이유는 그쪽 `ReformDeps` 주석에 있다.
        const r = await handleReform(admin, action, body, { email, isRoot, uid: user?.id ?? null }, {
          translateKoFields,
          hasTranslateKey: !!GEMINI_API_KEY,
        })
        if (r) return r
        return json({ error: '알 수 없는 action' }, 400)
      }
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
