// translate-ebook: 이북 본문의 텍스트 조각(한국어) → 여러 언어 번역.
//   · translate-questions 와 같은 뼈대(그룹 묶음·부분 실패 허용·일일 한도 처리)를 쓰되,
//     호출 주체가 내부 도구가 아니라 **관리자 화면**이라 패스코드가 아닌 관리자 인증으로 막는다.
//   · 마크업은 서버로 보내지 않는다. 클라(관리자 브라우저)가 HTML 을 파싱해 **텍스트 노드만** 뽑아
//     순서 있는 배열로 보내고, 받은 번역을 같은 노드에 도로 꽂는다 → 태그·CSS·폰트가 원본 그대로 보존된다.
//   ⚠️ _shared 사용 → CLI 로만 배포할 것.
//
// 요청(POST): { texts: string[], langs?: string[], context?: string }
// 응답:       { results: ({ tr: { en: "...", ja: "..." } } | { error: "사유" })[] }
//   - 조각 단위 실패는 해당 인덱스가 { error } (클라가 원문 유지)
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'
import { ROOT_ADMIN } from '../admin/constants.ts'

// 번역 전용 키를 우선 쓰고(문항 번역과 같은 지갑), 없으면 공용 키로 폴백.
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY_TRANSLATE') || Deno.env.get('GEMINI_API_KEY')
const MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-3.1-flash-lite'
const ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`

const LANG_NAMES: Record<string, string> = {
  en: 'English',
  ja: 'Japanese (日本語)',
  zh: 'Simplified Chinese (简体中文)',
  hi: 'Hindi (हिन्दी)',
  vi: 'Vietnamese (Tiếng Việt)',
}
const DEFAULT_LANGS = ['en', 'ja', 'zh', 'hi', 'vi']
// 조각은 대부분 한 문장 이하로 짧다(샘플 평균 28자). 한 요청·한 호출에 넉넉히 담는다.
const MAX_TEXTS = 120 // HTTP 요청당 상한 — 클라가 나눠 보냄(함수 실행시간 여유 확보)
const GROUP_SIZE = 25 // 번역 1회 호출에 묶는 조각 수
const CONCURRENCY = 3 // 동시 Gemini 호출 수(분당 한도 고려)

class DailyQuotaError extends Error {} // 일일 한도(RPD) 소진 — 오늘은 재시도 무의미

/** 모델이 JSON 뒤에 군더더기를 붙이거나 마크다운으로 감싸는 경우가 있어 첫 완전한 JSON 값만 잘라 쓴다. */
function parseFirstJson<T>(raw: string): T {
  let s = raw.trim()
  if (s.startsWith('```')) s = s.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim()
  const start = s.search(/[[{]/)
  if (start < 0) throw new Error('JSON 시작문자 없음')
  const open = s[start]
  const close = open === '[' ? ']' : '}'
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
    } else if (ch === '"') inStr = true
    else if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return JSON.parse(s.slice(start, i + 1)) as T
    }
  }
  throw new Error('JSON 끝 못 찾음(잘림 가능)')
}

async function callGemini(sys: string, user: string, maxTokens: number): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sys }] },
          contents: [{ parts: [{ text: user }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: maxTokens },
        }),
      })
      if (!res.ok) {
        const body = (await res.text()).slice(0, 300)
        if (res.status === 429 && /per.?day|requestsperday|daily|quota.*day/i.test(body)) {
          throw new DailyQuotaError(`일일 한도 소진: ${body.slice(0, 120)}`)
        }
        throw new Error(`Gemini ${res.status}: ${body.slice(0, 160)}`)
      }
      const j = await res.json()
      const cand = j?.candidates?.[0]
      const finish = cand?.finishReason
      const u = j?.usageMetadata
      console.log(`[gemini] finish=${finish} 출력=${u?.candidatesTokenCount} 입력=${u?.promptTokenCount} 한도=${maxTokens}`)
      if (finish === 'MAX_TOKENS') {
        throw new Error(`출력잘림(MAX_TOKENS): 출력 ${u?.candidatesTokenCount}/${maxTokens}토큰`)
      }
      const txt = cand?.content?.parts?.[0]?.text
      if (!txt) throw new Error(`빈 응답(finish=${finish})`)
      return txt
    } catch (e) {
      if (e instanceof DailyQuotaError) throw e
      if (attempt === 2) throw e
      const is429 = e instanceof Error && /429|quota/i.test(e.message)
      await new Promise((r) => setTimeout(r, is429 ? 9000 : 700 * (attempt + 1)))
    }
  }
  throw new Error('unreachable')
}

type Tr = Record<string, string>

// 조각 여러 개를 한 번의 호출로 묶어 번역. 결과는 입력 순서대로.
async function translateGroup(texts: string[], langs: string[], context: string): Promise<Tr[]> {
  const sys =
    'You are a professional book translator localizing an AI-literacy workbook. ' +
    'You receive an ORDERED array of short text fragments taken from the book\'s HTML text nodes — ' +
    'headings, list items, sentence fragments, labels. ' +
    'STRICT RULES: (1) translate EVERY element and return the SAME number of elements in the SAME order; ' +
    '(2) a fragment may be a sentence piece that continues in the next fragment — translate it as a fragment, ' +
    'do NOT merge, split, reorder or add explanatory text; ' +
    '(3) do NOT translate code, product names, URLs, or acronyms like "LLM", "API", "GPU", "RAG"; ' +
    '(4) keep all numbers exactly as in the source; ' +
    '(5) keep it CONCISE — the book has fixed-size pages, so a translation much longer than the source will be clipped; ' +
    'prefer the shorter natural phrasing when there is a choice; ' +
    '(6) write idiomatically, as a native speaker would, not word-for-word; ' +
    '(7) output ONLY a valid JSON array, no markdown.'
  const langList = langs.map((c) => `"${c}" = ${LANG_NAMES[c] ?? c}`).join(', ')
  const user =
    (context ? `Book: ${context}\n` : '') +
    `Translate the following ${texts.length} fragments into: ${langList}.\n` +
    `Return a JSON ARRAY of length ${texts.length}. Element i = translations of SOURCE[i], ` +
    `shaped as { ${langs.map((c) => `"${c}": "..."`).join(', ')} }.\n\n` +
    `SOURCE (Korean, JSON array):\n${JSON.stringify(texts)}`

  const txt = await callGemini(sys, user, 40000)
  const out = parseFirstJson<Tr[]>(txt)
  if (!Array.isArray(out) || out.length !== texts.length) {
    throw new Error(`조각 수 불일치 (${out?.length}/${texts.length})`)
  }
  out.forEach((tr, i) => {
    for (const c of langs) {
      if (typeof tr?.[c] !== 'string' || !tr[c].trim()) throw new Error(`빈 번역 (#${i + 1} ${c})`)
    }
  })
  return out
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

const shortReason = (e: unknown): string => {
  const m = e instanceof Error ? e.message : String(e)
  if (e instanceof DailyQuotaError) return '일일한도'
  if (/MAX_TOKENS|출력잘림/.test(m)) return '출력잘림(토큰초과)'
  if (/조각 수 불일치/.test(m)) return '모델항목누락'
  if (/빈 번역/.test(m)) return '빈번역'
  if (/JSON|Unexpected|parse/i.test(m)) return 'JSON형식오류'
  if (/Gemini 429|quota/i.test(m)) return '분당한도(429)'
  if (/Gemini 5\d\d/.test(m)) return 'Gemini서버오류'
  if (/빈 응답/.test(m)) return '빈응답'
  return m.slice(0, 80)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    if (!GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY_TRANSLATE 미설정' }, 500)

    // 관리자 게이트 — admin 함수와 동일 판정(루트 또는 admin_users 등록 이메일).
    const user = await getUser(req)
    const email = (user?.email ?? '').toLowerCase()
    const admin = adminClient()
    let isAdmin = !!email && email === ROOT_ADMIN
    if (user && !isAdmin) {
      const { data } = await admin.from('admin_users').select('email').eq('email', email).maybeSingle()
      isAdmin = !!data
    }
    if (!isAdmin) return json({ error: '관리자 전용입니다.' }, 403)

    const body = await req.json()
    const texts: string[] = Array.isArray(body?.texts) ? body.texts.map((t: unknown) => String(t ?? '')) : []
    const langs: string[] = Array.isArray(body?.langs) && body.langs.length ? body.langs : DEFAULT_LANGS
    const context = String(body?.context ?? '').slice(0, 200)
    if (!texts.length) return json({ error: 'texts 가 비어 있습니다.' }, 400)
    if (texts.length > MAX_TEXTS) return json({ error: `한 번에 최대 ${MAX_TEXTS}조각까지 가능합니다.` }, 400)

    const n = texts.length
    let dailyHit = false
    const out: (Tr | null)[] = new Array(n).fill(null)
    const failReason: (string | null)[] = new Array(n).fill(null)

    const groups: { start: number; texts: string[] }[] = []
    for (let i = 0; i < n; i += GROUP_SIZE) groups.push({ start: i, texts: texts.slice(i, i + GROUP_SIZE) })

    await mapLimit(groups, CONCURRENCY, async (g) => {
      if (dailyHit) return
      try {
        const tr = await translateGroup(g.texts, langs, context)
        tr.forEach((t, k) => { out[g.start + k] = t })
      } catch (e) {
        // 묶음이 실패해도 여기서 단건 재시도하지 않는다(폭주 방지) — 실패 표시만 하고 클라가 재시도.
        if (e instanceof DailyQuotaError) dailyHit = true
        const reason = shortReason(e)
        console.error(`묶음 실패(${g.start}~${g.start + g.texts.length - 1}): ${reason}`)
        for (let k = 0; k < g.texts.length; k++) failReason[g.start + k] = reason
      }
    })

    const results = out.map((tr, i) => (tr ? { tr } : { error: failReason[i] || '미상' }))
    const failCount = results.filter((r) => 'error' in r).length
    console.log(`번역 완료: 성공 ${n - failCount}/${n}` + (failCount ? `, 실패 ${failCount}` : ''))
    if (dailyHit) return json({ error: 'quota_daily', results }, 429)
    return json({ results })
  } catch (e) {
    console.error(`서버 오류: ${e instanceof Error ? e.message : e}`)
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
