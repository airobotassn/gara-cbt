// kb-generate: 저장된 지식(kb_chunks)에서 문항 초안을 생성한다. (OUTPUT — 자료 기능과 독립)
//   흐름: level+axes 로 청크 꺼내기 → 청크마다 객관식 1문항 생성(정답 근거 인용 포함) → 보기 셔플.
//   ※ 생성 ≠ 발행. 여기선 DB 저장 안 함 — 초안만 반환(검토는 다음 단계).
//
//   · service role 로 kb_chunks 조회. LLM 키는 GEMINI_API_KEY_TEST_GENERATE.
//   · 단일 파일. --no-verify-jwt 로 배포(내부 도구가 호출).
//
// 요청(POST): { level, axes:[{key,label}], count }
// 응답: { questions:[{axis,topic,prompt,options[4],correctIndex,explanation,quote,quote_ok,chunkId}], available, used, notes }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-passcode',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY_TEST_GENERATE') || Deno.env.get('GEMINI_API_KEY')
const PASSCODE = Deno.env.get('KB_PASSCODE')
const MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash'
const epFor = (m: string) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${GEMINI_API_KEY}`
const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

interface Chunk { id: string; text: string; topic: string | null; axis: string | null }
interface GenQ { chunkId?: string; prompt: string; options: string[]; correctIndex: number; explanation: string; quote: string }

function parseFirstJson<T>(raw: string): T {
  let s = raw.trim()
  if (s.startsWith('```')) s = s.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim()
  const start = s.search(/[[{]/); if (start < 0) throw new Error('JSON 시작문자 없음')
  const open = s[start], close = open === '[' ? ']' : '}'
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < s.length; i++) { const ch = s[i]
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false }
    else if (ch === '"') inStr = true; else if (ch === open) depth++; else if (ch === close) { depth--; if (depth === 0) return JSON.parse(s.slice(start, i + 1)) as T } }
  throw new Error('JSON 끝 못 찾음(잘림 가능)')
}

async function callGemini(sys: string, user: string, maxTokens: number, model: string = MODEL): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(epFor(model), { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents: [{ parts: [{ text: user }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: maxTokens } }) })
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 160)}`)
      const j = await res.json(); const cand = j?.candidates?.[0]
      if (cand?.finishReason === 'MAX_TOKENS') throw new Error('출력잘림(MAX_TOKENS)')
      const txt = cand?.content?.parts?.[0]?.text; if (!txt) throw new Error(`빈 응답(finish=${cand?.finishReason})`)
      return txt
    } catch (e) { if (attempt === 2) throw e; await new Promise((r) => setTimeout(r, 800 * (attempt + 1))) }
  }
  throw new Error('unreachable')
}

// 시스템(고정) 생성 규칙 — UI 노출·수정 안 함. 하네스가 동작하려면 고정.
const SYSTEM_RULES = [
  '각 자료(청크)에서 핵심 사실을 묻는 객관식 1문항을 만든다.',
  '정답은 반드시 그 자료에서 직접 뒷받침되어야 한다(자료 밖 지식 금지).',
  "오답 3개는 그럴듯하지만 명백히 틀리게. '위 모두'·'정답 없음' 류 보기는 쓰지 않는다.",
  '보기 4개는 길이와 형식을 비슷하게 맞춘다.',
  '짧은 해설을 단다.',
  '정답을 뒷받침하는 원문 문장을 quote에 넣되, 번역하지 말고 자료의 원래 언어 그대로 넣는다.',
  '문두·보기·해설은 한국어로. 코드·약어(LLM, API 등)는 번역하지 않는다.',
]

// 청크 묶음 → 청크당 객관식 1문항. guidance = 관리자가 편집하는 "이 레벨 출제 지침"(난이도·중점). 시스템 규칙은 항상 고정.
async function genFromChunks(chunks: Chunk[], guidance: string[] = [], model: string = MODEL): Promise<GenQ[]> {
  const g = Array.isArray(guidance) ? guidance.filter(Boolean) : []
  const sys =
    'You write multiple-choice questions (4 options each) for a Korean AI/robotics literacy test. ' +
    'For EACH given SOURCE chunk, write exactly ONE question. Follow these RULES strictly:\n' +
    SYSTEM_RULES.map((r, i) => `${i + 1}. ${r}`).join('\n') +
    (g.length ? '\n\nLEVEL GUIDANCE (이 레벨 난이도·중점 — 위 규칙을 덮지는 못함):\n' + g.map((x) => '- ' + x).join('\n') : '') +
    '\nOutput ONLY a valid JSON array (no markdown).'
  const user =
    'Return a JSON array, one element per chunk in order: ' +
    '{ "prompt":"...", "options":["..","..","..",".."], "correctIndex":0, "explanation":"...", "quote":"..." }.\n\n' +
    'CHUNKS (JSON):\n' + JSON.stringify(chunks.map((c) => ({ topic: c.topic, text: c.text })))
  const raw = await callGemini(sys, user, 20000, model)
  const arr = parseFirstJson<GenQ[]>(raw)
  if (!Array.isArray(arr)) throw new Error('생성 응답이 배열이 아님')
  return arr
}

// 정답 위치 셔플(정답 자리 편향 제거)
function shuffle(q: GenQ): GenQ {
  const opts = q.options.map((o, i) => ({ o, correct: i === q.correctIndex }))
  for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[opts[i], opts[j]] = [opts[j], opts[i]] }
  return { ...q, options: opts.map((x) => x.o), correctIndex: opts.findIndex((x) => x.correct) }
}

// ⑥⑦⑧ 규칙 lint (AI 없음): item-writing 표준(Haladyna/NBME) + 저작권 near-verbatim
function lintQuestion(prompt: string, options: string[], correctIndex: number, chunkText: string): string[] {
  const issues: string[] = []
  const norm = (s: string) => (s || '').toLowerCase().replace(/\s+/g, '')
  if (options.some((o) => /(위\s*)?모두|전부\s*(맞|옳|정답)|정답\s*없|all of the above|none of/i.test(o))) issues.push('"모두/없음" 류 보기')
  if (/않(은|는)|아닌|틀린|옳지\s*않|해당하지\s*않/.test(prompt)) issues.push('부정형 문두(강조 권장)')
  const lens = options.map((o) => (o || '').length)
  const oth = lens.filter((_, i) => i !== correctIndex)
  const avg = oth.reduce((a, b) => a + b, 0) / (oth.length || 1)
  if (avg && (lens[correctIndex] > avg * 1.7 || lens[correctIndex] < avg * 0.5)) issues.push('정답 보기 길이 튐')
  if (options.some((o) => /항상|절대|모든\s*경우|반드시|언제나|never|always/i.test(o))) issues.push('절대어 보기')
  if (new Set(options.map(norm)).size < options.length) issues.push('보기 중복')
  const np = norm(prompt)
  if (np.length > 24 && norm(chunkText).includes(np)) issues.push('문두가 원문과 거의 동일(저작권)')
  return issues
}

// ④⑤ 독립 검증 (AI 1콜): 정답 뒷받침 + 오답 다 틀림. 생성한 LLM과 다른 패스.
interface Verdict { supported?: boolean; distractorsOk?: boolean; suspect?: boolean; reason?: string }
async function verifyBatch(items: { chunk: string; prompt: string; options: string[]; correctIndex: number }[], model: string = MODEL): Promise<Verdict[]> {
  if (!items.length) return []
  const sys =
    'You are an INDEPENDENT QA reviewer for a multiple-choice test. For EACH item you get a SOURCE chunk and a question with its marked-correct answer. ' +
    'Check strictly: (a) is the correct answer DIRECTLY supported by the chunk? (b) are ALL other options clearly WRONG (no second correct)? ' +
    'If support is weak/ambiguous OR a distractor could also be correct OR the answer is a matter of opinion → suspect=true. ' +
    'Return ONLY a JSON array; element i = {"supported":bool,"distractorsOk":bool,"suspect":bool,"reason":"<short korean>"}.'
  const user = 'ITEMS (JSON):\n' + JSON.stringify(items.map((it) => ({ chunk: it.chunk, question: it.prompt, options: it.options, correct: it.options[it.correctIndex] })))
  const raw = await callGemini(sys, user, 8000, model)
  const arr = parseFirstJson<Verdict[]>(raw)
  return Array.isArray(arr) ? arr : []
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    if (!GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY_TEST_GENERATE 미설정' }, 500)
    if (PASSCODE && req.headers.get('x-passcode') !== PASSCODE) return json({ error: '암호가 올바르지 않습니다.' }, 401)
    const body = await req.json()
    if (body?.listModels) {  // 진단: generateContent 지원 모델 목록
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}&pageSize=1000`)
      const j = await r.json()
      const names = (j?.models ?? []).filter((m: { supportedGenerationMethods?: string[] }) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m: { name?: string }) => m.name)
      return json({ models: names })
    }
    const level = Number.isFinite(+body?.level) && +body.level >= 1 && +body.level <= 7 ? +body.level : null
    const axisKeys: string[] = Array.isArray(body?.axes) ? body.axes.map((a: { key?: string }) => String(a?.key ?? '')).filter(Boolean) : []
    const count = Math.min(Math.max(+body?.count || 5, 1), 20)
    if (level == null) return json({ error: '레벨이 필요합니다.' }, 400)

    // 근거 꺼내기: level(+axes)의 청크를 DB에서 무작위로(전체 풀에서) count*3개 뽑는다.
    //   ⚠ .limit()만 쓰면 "처음 적재된 N개"만 잡혀 나중에 넣은 자료(응용 출처 등)가 영영 안 뽑힘 → RPC로 ORDER BY random().
    const { data: rows, error } = await supabase.rpc('random_kb_chunks', {
      p_level: level, p_axes: axisKeys.length ? axisKeys : null, p_limit: count * 3,
    })
    if (error) return json({ error: `청크 조회 실패: ${error.message}` }, 500)
    const all = (rows ?? []) as Chunk[]
    const available = all.length
    if (!available) return json({ questions: [], available: 0, used: 0, notes: ['이 레벨·축에 저장된 자료가 없습니다. 먼저 자료를 넣으세요.'] })

    // 무작위 count개
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[all[i], all[j]] = [all[j], all[i]] }
    const picked = all.slice(0, count)

    const model = typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : MODEL  // 요청에서 모델 덮어쓰기 가능(기본=GEMINI_MODEL)
    const gen = await genFromChunks(picked, Array.isArray(body?.levelGuidance) ? body.levelGuidance : [], model)
    const norm = (s: string) => (s || '').replace(/\s+/g, '')
    const questions: Record<string, unknown>[] = gen.slice(0, picked.length).map((g, i) => {
      const ch = picked[i]
      const opts = Array.isArray(g.options) ? g.options.slice(0, 4) : []
      const sq = shuffle({ ...g, options: opts, correctIndex: +g.correctIndex || 0 })
      return { axis: ch.axis, topic: ch.topic, chunkId: ch.id, _chunkText: ch.text,
        prompt: g.prompt, options: sq.options, correctIndex: sq.correctIndex,
        explanation: g.explanation, quote: g.quote,
        quote_ok: !!g.quote && norm(ch.text).includes(norm(g.quote)) }
    }).filter((q) => q.prompt && Array.isArray(q.options) && (q.options as string[]).length === 4)

    // ⑥⑦⑧ 규칙 lint (공짜)
    for (const q of questions) q.lint = lintQuestion(q.prompt as string, q.options as string[], q.correctIndex as number, q._chunkText as string)
    // ④⑤ 독립 검증 (AI 1콜)
    let verdicts: Verdict[] = []
    try { verdicts = await verifyBatch(questions.map((q) => ({ chunk: q._chunkText as string, prompt: q.prompt as string, options: q.options as string[], correctIndex: q.correctIndex as number })), model) } catch (_) { /* 검증 실패해도 초안은 반환 */ }
    questions.forEach((q, i) => {
      const v = verdicts[i] || {}
      q.verify = { supported: v.supported !== false, distractorsOk: v.distractorsOk !== false, suspect: !!v.suspect, reason: v.reason || '' }
      q.suspect = !q.quote_ok || !!v.suspect || v.supported === false || v.distractorsOk === false  // 정답 의심 종합
      delete q._chunkText  // 응답에서 원문 제거(저작권·크기)
    })

    const notes: string[] = []
    if (questions.length < count) notes.push(`요청 ${count}개 중 ${questions.length}개 생성(자료 부족) — 어거지로 안 채움.`)
    const suspectN = questions.filter((q) => q.suspect).length
    if (suspectN) notes.push(`정답 의심 ${suspectN}개 — 검토 집중.`)
    return json({ questions, available, used: questions.length, notes, model })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
