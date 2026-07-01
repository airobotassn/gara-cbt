// kb-extract: 지식 저장소 적재(INPUT)용 — 출처 확보 + 추출. (cold start 핵심 조각)
//   INPUT 은 사람만 하는 게 아니다. 세 모드:
//     mode='recommend' : AI 가 그 레벨·축으로 웹 검색 → 출처 후보 목록(검색 그라운딩)
//     mode='fetch'     : URL 을 서버가 가져와 본문 텍스트로
//     mode='extract'   : 원문 텍스트 → 청크 분할 + 토픽 발견 (DB/임베딩은 아직 안 함)
//
//   · GEMINI_API_KEY_TEST_GENERATE 우선(없으면 GEMINI_API_KEY). 클라/HTML 노출 금지.
//   · 의존성 없는 단일 파일 → Supabase 대시보드 웹에디터로도 배포 가능.
//   · (선택) KB_PASSCODE 환경변수 → x-passcode 헤더로 간단 보호.
//
// 응답:
//   recommend → { sources:[{title,url,why}] }
//   fetch     → { text, url, chars }
//   extract   → { topics:[{name,count}], chunks:[{text,topic,quote_ok}], notes:[...] }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-passcode',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY_TEST_GENERATE') || Deno.env.get('GEMINI_API_KEY')
const PASSCODE = Deno.env.get('KB_PASSCODE')
const MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash'
const ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`

const MAX_CHARS = 60000

interface Chunk { text: string; topic: string }

function parseFirstJson<T>(raw: string): T {
  let s = raw.trim()
  if (s.startsWith('```')) s = s.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim()
  const start = s.search(/[[{]/)
  if (start < 0) throw new Error('JSON 시작문자 없음')
  const open = s[start]
  const close = open === '[' ? ']' : '}'
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
    } else if (ch === '"') inStr = true
    else if (ch === open) depth++
    else if (ch === close) { depth--; if (depth === 0) return JSON.parse(s.slice(start, i + 1)) as T }
  }
  throw new Error('JSON 끝 못 찾음(잘림 가능)')
}

// generateContent 공통 호출. tools 옵션이면 검색 그라운딩, json=true 면 JSON 강제(둘은 같이 못 씀).
async function callGemini(
  sys: string, user: string, maxTokens: number,
  opts: { json?: boolean; search?: boolean } = {},
): Promise<string> {
  const gen: Record<string, unknown> = { temperature: 0.2, maxOutputTokens: maxTokens }
  if (opts.json && !opts.search) gen.responseMimeType = 'application/json'
  const payload: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: sys }] },
    contents: [{ parts: [{ text: user }] }],
    generationConfig: gen,
  }
  if (opts.search) payload.tools = [{ google_search: {} }]

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = (await res.text()).slice(0, 300)
        throw new Error(`Gemini ${res.status}: ${body.slice(0, 160)}`)
      }
      const j = await res.json()
      const cand = j?.candidates?.[0]
      if (cand?.finishReason === 'MAX_TOKENS') throw new Error('출력잘림(MAX_TOKENS)')
      const txt = cand?.content?.parts?.map((p: { text?: string }) => p?.text ?? '').join('') ?? ''
      if (!txt) throw new Error(`빈 응답(finish=${cand?.finishReason})`)
      return txt
    } catch (e) {
      if (attempt === 2) throw e
      const is429 = e instanceof Error && /429|quota/i.test(e.message)
      await new Promise((r) => setTimeout(r, is429 ? 9000 : 700 * (attempt + 1)))
    }
  }
  throw new Error('unreachable')
}

interface Axis { key: string; label: string }

// ── mode='recommend': AI 가 출처 후보를 검색해 온다(웹 검색 그라운딩) ──
async function recommend(level: number | null, axes: Axis[]): Promise<{ title: string; url: string; why: string }[]> {
  const topic = axes.length ? axes.map((a) => a.label).join(', ') : 'this topic'
  const sys =
    'You find AUTHORITATIVE, freely-citable reference sources for building an AI/robotics literacy test. ' +
    'Prefer standards bodies (NIST, OWASP, ISO), official product/docs, peer-reviewed or established encyclopedias (Wikipedia). ' +
    'Avoid SEO blogs, content farms, marketing pages. Use web search.'
  const user =
    `Find 5-8 authoritative sources covering: "${topic}"` + (level ? ` (difficulty level ${level})` : '') + '.\n' +
    'Return ONLY JSON: {"sources":[{"title":"...","url":"...","why":"<one short Korean reason it is trustworthy>"}]}.'
  const raw = await callGemini(sys, user, 4000, { search: true })
  const parsed = parseFirstJson<{ sources?: { title: string; url: string; why: string }[] }>(raw)
  return Array.isArray(parsed?.sources) ? parsed.sources.filter((s) => s?.url) : []
}

// ── mode='fetch': URL → 본문 텍스트 ──
async function fetchUrl(url: string): Promise<string> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Referer': 'https://www.google.com/',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  return text.slice(0, MAX_CHARS)
}

// ── mode='extract': 원문 → 청크 (청크마다 축 + 토픽) ──
// 한 출처가 여러 축에 걸칠 수 있으므로, 후보 축 목록을 주고 청크마다 가장 맞는 축 1개를 고르게 한다.
async function extract(text: string, level: number | null, axes: Axis[]) {
  const axisList = axes.length ? axes.map((a) => `${a.key} = ${a.label}`).join(' ; ') : ''
  const keySet = new Set(axes.map((a) => a.key))
  const sys =
    'You build a knowledge index for an AI/robotics literacy test question bank. ' +
    'Given a SOURCE document, return ONLY JSON.\n' +
    '(1) CHUNK: split into self-contained meaningful units (one idea/definition/method/example each). ' +
    'Each chunk MUST be VERBATIM text copied from the source — do NOT summarize, paraphrase, translate, or invent. ' +
    'Keep chunks reasonably small; skip boilerplate (nav, ads, footers).\n' +
    '(2) AXIS: assign each chunk to the SINGLE best-fitting axis CODE from the provided list. If none fits, use "".\n' +
    '(3) TOPIC: assign each chunk a short Korean topic label (sub-category), reusing the same label for related chunks.'
  const user =
    (level ? `Difficulty level: ${level}.\n` : '') +
    (axisList ? `Candidate axes (code = name): ${axisList}.\n` : '') +
    'Return JSON: { "chunks": [ { "text":"<verbatim excerpt>", "axis":"<one axis code from the list, or empty>", "topic":"<korean short label>" } ] }.\n\nSOURCE:\n' + text
  const raw = await callGemini(sys, user, 40000, { json: true })
  const parsed = parseFirstJson<{ chunks?: (Chunk & { axis?: string })[] }>(raw)
  const chunks = Array.isArray(parsed?.chunks) ? parsed.chunks : []

  // 할루시네이션 컷 + 축 검증(목록 밖 축이면 비움)
  //   모델이 띄어쓰기·문장부호·특수문자를 살짝 다듬는 걸 허용하려고 "글자(영문·한글·CJK·숫자)만" 남겨 비교.
  //   완전 substring 이면 통과, 아니면 20글자 조각의 80%↑가 원문에 있으면 통과(형식 차이 허용, 진짜 생성은 컷).
  const norm = (s: string) => (s || '').toLowerCase().replace(/[^0-9a-z가-힣一-鿿぀-ヿ]/g, '')
  const src = norm(text)
  const contained = (t: string): boolean => {
    const c = norm(t)
    if (c.length < 4) return false
    if (src.includes(c)) return true
    const parts = c.match(/.{1,20}/g) || []
    return parts.length > 0 && parts.filter((p) => src.includes(p)).length / parts.length >= 0.8
  }
  const outChunks = chunks.map((c) => ({
    text: c.text,
    topic: (c.topic ?? '').trim() || '(미분류)',
    axis: keySet.size && keySet.has(c.axis ?? '') ? c.axis : (keySet.size ? '' : (c.axis ?? '')),
    quote_ok: contained(c.text || ''),
  }))

  // 축별 분포(요약용)
  const axisCounts = new Map<string, number>()
  for (const c of outChunks) axisCounts.set(c.axis || '', (axisCounts.get(c.axis || '') ?? 0) + 1)
  const byAxis = [...axisCounts.entries()].map(([axis, count]) => ({ axis, count }))

  const bad = outChunks.filter((c) => !c.quote_ok).length
  const noAxis = outChunks.filter((c) => keySet.size && !c.axis).length
  const notes: string[] = []
  if (bad) notes.push(`원문에 없는 청크 ${bad}개(모델이 변형·생성 — 버려야 함).`)
  if (noAxis) notes.push(`축 미배정 청크 ${noAxis}개(선택한 축에 안 맞음).`)
  if (!outChunks.length) notes.push('청크가 0개 — 원문이 너무 짧거나 형식 문제.')
  return { chunks: outChunks, byAxis, notes }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    if (!GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY_TEST_GENERATE 미설정' }, 500)
    if (PASSCODE && req.headers.get('x-passcode') !== PASSCODE) return json({ error: '암호가 올바르지 않습니다.' }, 401)

    const body = await req.json()
    const mode: string = body?.mode || 'extract'
    const level = Number.isFinite(+body?.level) && +body.level >= 1 && +body.level <= 7 ? +body.level : null
    // 축은 복수 선택 가능: axes:[{key,label}]. (구버전 호환: axis 문자열 단일)
    const axes: Axis[] = Array.isArray(body?.axes)
      ? body.axes.filter((a: { label?: string }) => a && a.label).map((a: { key?: string; label: string }) => ({ key: String(a.key ?? ''), label: String(a.label) }))
      : (typeof body?.axis === 'string' && body.axis.trim() ? [{ key: String(body?.axisKey ?? ''), label: body.axis.trim() }] : [])

    if (mode === 'recommend') {
      const sources = await recommend(level, axes)
      return json({ sources, model: MODEL })
    }
    if (mode === 'fetch') {
      const url = typeof body?.url === 'string' ? body.url.trim() : ''
      if (!/^https?:\/\//i.test(url)) return json({ error: '올바른 URL이 아닙니다.' }, 400)
      const text = await fetchUrl(url)
      return json({ text, url, chars: text.length })
    }
    // extract
    const text: string = typeof body?.text === 'string' ? body.text.trim() : ''
    if (!text) return json({ error: 'text 가 비어 있습니다.' }, 400)
    if (text.length > MAX_CHARS) return json({ error: `원문이 너무 깁니다(최대 ${MAX_CHARS}자).` }, 400)
    const out = await extract(text, level, axes)
    return json({ ...out, model: MODEL })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
