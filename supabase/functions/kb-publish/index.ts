// kb-publish: 사람이 승인한 문항(한국어 초안)을 번역 → 실제 문제은행(questions)에 발행한다.
//   생성(kb-generate) ≠ 발행. 사람이 검토·승인한 것만 이 함수로 넘어와 진짜 시험 문제가 된다.
//   · 한국어 → en/ja/zh/hi/vi 번역(인라인, 한 콜) → prompt_i18n 등 구성 → service role 로 insert.
//   · 번역 실패한 항목은 ko 만 넣어도 됨(start-test 가 ko 폴백).
//   · 단일 파일. --no-verify-jwt 로 배포(내부 도구가 호출).
//
// 요청(POST): { questions:[{level, axis, prompt, options[4], correctIndex, explanation}] }
// 응답: { published:int, failed:int, notes:[...] }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-passcode',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY_TRANSLATE') || Deno.env.get('GEMINI_API_KEY_TEST_GENERATE') || Deno.env.get('GEMINI_API_KEY')
const PASSCODE = Deno.env.get('KB_PASSCODE')
const MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash'
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`
const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

const LANGS = ['en', 'ja', 'zh', 'hi', 'vi']
const LANG_NAMES: Record<string, string> = { en: 'English', ja: 'Japanese', zh: 'Simplified Chinese', hi: 'Hindi', vi: 'Vietnamese' }

interface InQ { level: number; axis: string; prompt: string; options: string[]; correctIndex: number; explanation: string }
interface Tr { prompt: string; options: string[]; explanation: string }

function parseFirstJson<T>(raw: string): T {
  let s = raw.trim()
  if (s.startsWith('```')) s = s.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim()
  const start = s.search(/[[{]/); if (start < 0) throw new Error('JSON 시작문자 없음')
  const open = s[start], close = open === '[' ? ']' : '}'
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < s.length; i++) { const ch = s[i]
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false }
    else if (ch === '"') inStr = true; else if (ch === open) depth++; else if (ch === close) { depth--; if (depth === 0) return JSON.parse(s.slice(start, i + 1)) as T } }
  throw new Error('JSON 끝 못 찾음')
}

// 한국어 문항들 → 언어별 번역(한 콜). 실패 시 throw(호출부가 ko-only 폴백).
async function translateAll(items: InQ[]): Promise<Record<string, Tr>[]> {
  const sys =
    'You are a professional translator for an AI/robotics literacy certification test. Translate each Korean multiple-choice question into the requested languages. ' +
    'STRICT: keep each "options" array the EXACT same order and count; do NOT translate code, product names, math, or acronyms (LLM, API, GPU); ' +
    'translate naturally as a native speaker, preserving exact meaning and difficulty; keep all numbers; output ONLY a valid JSON array.'
  const langList = LANGS.map((c) => `"${c}"=${LANG_NAMES[c]}`).join(', ')
  const user =
    `Translate these ${items.length} questions into: ${langList}.\n` +
    `Return a JSON ARRAY length ${items.length}; element i = { ${LANGS.map((c) => `"${c}":{"prompt":"...","options":[...],"explanation":"..."}`).join(', ')} }.\n\n` +
    'SOURCE (Korean):\n' + JSON.stringify(items.map((it) => ({ prompt: it.prompt, options: it.options, explanation: it.explanation })))
  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents: [{ parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 40000 } }) })
  if (!res.ok) throw new Error(`번역 실패 ${res.status}`)
  const j = await res.json()
  const txt = j?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!txt) throw new Error('번역 빈 응답')
  return parseFirstJson<Record<string, Tr>[]>(txt)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    if (!GEMINI_API_KEY) return json({ error: '번역용 GEMINI 키 미설정' }, 500)
    if (PASSCODE && req.headers.get('x-passcode') !== PASSCODE) return json({ error: '암호가 올바르지 않습니다.' }, 401)
    const body = await req.json()
    const items: InQ[] = Array.isArray(body?.questions)
      ? body.questions.filter((q: InQ) => q && q.prompt && Array.isArray(q.options) && q.options.length === 4 && q.level)
      : []
    if (!items.length) return json({ error: '발행할 문항이 없습니다.' }, 400)
    if (items.length > 50) return json({ error: '한 번에 최대 50개.' }, 400)

    // 번역(실패해도 ko-only로 발행)
    const notes: string[] = []
    let tr: Record<string, Tr>[] = []
    try { tr = await translateAll(items) } catch (e) { notes.push(`번역 실패 → 한국어만 발행: ${e instanceof Error ? e.message : ''}`) }

    const rows = items.map((q, i) => {
      const prompt_i18n: Record<string, string> = { ko: q.prompt }
      const options_i18n: Record<string, string[]> = { ko: q.options }
      const explanation_i18n: Record<string, string> = { ko: q.explanation || '' }
      const t = tr[i]
      if (t) for (const c of LANGS) {
        const o = t[c]
        if (o && o.prompt && Array.isArray(o.options) && o.options.length === q.options.length) {
          prompt_i18n[c] = o.prompt; options_i18n[c] = o.options; explanation_i18n[c] = o.explanation || ''
        }
      }
      return {
        code: `AUTO-${q.axis || 'x'}-${Math.random().toString(36).slice(2, 6)}`,
        level: q.level, category: q.axis, correct_index: q.correctIndex,
        prompt_i18n, options_i18n, explanation_i18n, active: true,
      }
    })

    const { error } = await supabase.from('questions').insert(rows)
    if (error) return json({ error: `발행(insert) 실패: ${error.message}` }, 500)
    return json({ published: rows.length, failed: items.length - rows.length, notes })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
