// translate-questions: 문항(한국어) → 여러 언어 번역 + 자동 검수.  내부 도구(NAS HTML)에서 호출.
//   · GEMINI_API_KEY 는 서버에만 둔다(클라 노출 금지).
//   · 의존성 없는 단일 파일 → Supabase 대시보드 웹에디터로도 배포 가능.
//   · (선택) TRANSLATE_PASSCODE 환경변수를 설정하면 x-passcode 헤더로 간단 보호.
//
// 요청(POST): { items: [{prompt, options:[...], explanation}], langs?: ["en","ja",...], use?: "leveltest"|"caris" }
// 응답:       { results: [ { tr: {en:{...},ja:{...},...}, issues: {en:[...],...} } | null ] }
//   - tr     : 언어별 번역
//   - issues : 언어별 "검토 필요" 사유 목록(빈 배열이면 통과). 룰검사 + AI검수 결과.
//   - 항목 단위 실패는 해당 인덱스 null (클라가 원문 유지)

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

// 이 함수 전용 키만 사용(공용 GEMINI_API_KEY 와 분리).
//
// ⛔ **지갑이 둘이다 — 요청의 `use` 가 고른다.**
//   · use:'leveltest'(기본) → GEMINI_API_KEY_TRANSLATE  — 무료 레벨테스트 문항
//   · use:'caris'           → GEMINI_API_KEY_TEST_GENERATE — CARIS 자격검정 문항
//   구글 무료 한도는 API 키가 아니라 **프로젝트 단위**라 키만 더 만들어봐야 지갑이 안 나뉜다
//   (CLAUDE.md 의 용도별 프로젝트 분리 규칙). CARIS 문항은 588개 × 5개국어라 한 번 돌리면
//   그 프로젝트의 하루 한도를 크게 먹는데, 같은 지갑에 두면 그날 레벨테스트 번역까지 같이 막힌다.
//   TEST_GENERATE 는 문항 생성(KB 파이프라인)용인데 지금 생성을 안 돌려서 비어 있다.
// ⚠️ 키 이름을 **클라가 보내지 않는다.** 보내는 건 용도 문자열뿐이고 매핑은 여기 고정이다 —
//    아니면 남의 키를 지정해 태울 수 있는 입력이 된다.
const KEY_BY_USE: Record<string, string | undefined> = {
  leveltest: Deno.env.get('GEMINI_API_KEY_TRANSLATE'),
  caris: Deno.env.get('GEMINI_API_KEY_TEST_GENERATE') || Deno.env.get('GEMINI_API_KEY_TRANSLATE'),
}
const PASSCODE = Deno.env.get('TRANSLATE_PASSCODE') // 미설정 시 보호 없음
const MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-3.1-flash-lite'
const endpointFor = (key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`

const LANG_NAMES: Record<string, string> = {
  en: 'English',
  ja: 'Japanese (日本語)',
  zh: 'Simplified Chinese (简体中文)',
  hi: 'Hindi (हिन्दी)',
  vi: 'Vietnamese (Tiếng Việt)',
}
const DEFAULT_LANGS = ['en', 'ja', 'zh', 'hi', 'vi']
const MAX_ITEMS = 60 // 한 HTTP 요청당 상한. 클라가 나눠 보냄.
const GROUP_SIZE = 10 // 번역 1회 호출에 묶는 문항 수(품질 위해 10)
const REVIEW_GROUP = 10 // 검수 1회 호출에 묶는 문항 수
const CONCURRENCY = 3 // 동시 Gemini 호출 수(분당 한도 고려)

interface Item {
  prompt: string
  options: string[]
  explanation: string
  // 주관식 허용답안(선택). 객관식·레벨테스트 호출자는 안 보낸다 — 그때는 빈 배열로 다룬다.
  // ⚠️ options 와 달리 **개수를 맞추지 않는다.** 표기 변형('엣지 컴퓨팅'/'엣지컴퓨팅')은 언어마다
  //    가짓수가 다르고, 순서가 정답 번호를 가리키지도 않아서(채점은 합집합 포함 여부만 본다)
  //    개수를 강제하면 멀쩡한 번역을 버리게 된다.
  answers?: string[]
}
type Tr = Record<string, Item> // { en:{...}, ja:{...}, ... }

class DailyQuotaError extends Error {} // 일일 한도(RPD) 소진 — 오늘은 재시도 무의미

// 모델이 JSON 뒤에 군더더기(여분의 ] 등)를 붙이거나 마크다운으로 감싸는 경우가 있어,
// "첫 번째 완전한 JSON 값"만 괄호 균형으로 잘라 안전하게 파싱한다.
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
      if (depth === 0) return JSON.parse(s.slice(start, i + 1)) as T // 첫 완전 값만
    }
  }
  throw new Error('JSON 끝 못 찾음(잘림 가능)')
}

async function callGemini(sys: string, user: string, maxTokens: number, endpoint: string): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sys }] },
          contents: [{ parts: [{ text: user }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
            maxOutputTokens: maxTokens,
          },
        }),
      })
      if (!res.ok) {
        const body = (await res.text()).slice(0, 300)
        // 일일 한도 소진이면 재시도하지 말고 즉시 위로 알림
        if (res.status === 429 && /per.?day|requestsperday|daily|quota.*day/i.test(body)) {
          throw new DailyQuotaError(`일일 한도 소진: ${body.slice(0, 120)}`)
        }
        throw new Error(`Gemini ${res.status}: ${body.slice(0, 160)}`)
      }
      const j = await res.json()
      const cand = j?.candidates?.[0]
      const finish = cand?.finishReason // STOP=정상, MAX_TOKENS=출력잘림, SAFETY 등
      const u = j?.usageMetadata
      console.log(
        `[gemini] finish=${finish} 출력토큰=${u?.candidatesTokenCount}` +
          ` 사고토큰=${u?.thoughtsTokenCount ?? 0} 입력=${u?.promptTokenCount} 한도=${maxTokens}`,
      )
      // 출력 토큰 한도 도달 = 진짜 잘림(추측 아님)
      if (finish === 'MAX_TOKENS') {
        throw new Error(`출력잘림(MAX_TOKENS): 출력 ${u?.candidatesTokenCount}/${maxTokens}토큰`)
      }
      const txt = cand?.content?.parts?.[0]?.text
      if (!txt) throw new Error(`빈 응답(finish=${finish})`)
      return txt
    } catch (e) {
      if (e instanceof DailyQuotaError) throw e // 일일 한도는 재시도 안 함
      if (attempt === 2) throw e
      // 분당한도(429)면 길게 대기(분당 창이 지나가도록), 그 외는 짧게
      const is429 = e instanceof Error && /429|quota/i.test(e.message)
      await new Promise((r) => setTimeout(r, is429 ? 9000 : 700 * (attempt + 1)))
    }
  }
  throw new Error('unreachable')
}

// 여러 문항을 한 번의 호출로 묶어 번역. 결과는 입력 순서대로 배열 반환.
async function translateGroup(items: Item[], langs: string[], endpoint: string): Promise<Tr[]> {
  const sys =
    'You are a professional translator for an AI/robotics literacy certification test. ' +
    'Translate each Korean multiple-choice question into the requested languages. ' +
    'STRICT RULES: (1) keep every "options" array in the EXACT same order and EXACT same count as its source; ' +
    '(2) do NOT translate code, product names, math, or acronyms like "LLM", "API", "GPU"; ' +
    '(3) write it so it reads naturally and idiomatically — as a native speaker would phrase it, NOT word-for-word — ' +
    'while preserving the exact meaning and difficulty; no added or removed content; ' +
    '(4) keep all numbers exactly as in the source; ' +
    // "answers" = 주관식 허용답안. 이것만 규칙이 반대다(개수 자유·변형 장려) — 채점이 이 목록과의
    // 정규화 정확일치라, 그 언어권에서 실제로 통용되는 표기를 다 받아야 맞는 답이 틀리지 않는다.
    '(5) "answers" is the accepted-answer list of a short-answer question, used for EXACT-MATCH grading. ' +
    'Translate each entry into the term practitioners ACTUALLY use in that language, not a literal gloss. ' +
    'Unlike "options", the count is FREE: add the common spelling variants of that language ' +
    '(spaced/unspaced, native script and the widely-used English or acronym form) and drop duplicates. ' +
    'Always keep the English/acronym form when it is what people actually write (e.g. "NPU", "MQTT"). ' +
    'If the source "answers" is empty or missing, return an empty array; ' +
    '(6) output ONLY a valid JSON array, no markdown.'
  const langList = langs.map((c) => `"${c}" = ${LANG_NAMES[c] ?? c}`).join(', ')
  const user =
    `Translate the following ${items.length} questions into: ${langList}.\n` +
    `Return a JSON ARRAY of length ${items.length}. Element i = translations of SOURCE[i], ` +
    `shaped as { ${langs.map((c) => `"${c}": {"prompt":"...","options":[...],"explanation":"...","answers":[...]}`).join(', ')} }.\n\n` +
    `SOURCE (Korean, JSON array):\n` +
    JSON.stringify(
      items.map((it) => ({
        prompt: it.prompt,
        options: it.options,
        explanation: it.explanation,
        answers: it.answers ?? [],
      })),
    )

  const txt = await callGemini(sys, user, 60000, endpoint) // 모델 한도 65,536 내. 출력 잘림 방지
  let out: Tr[]
  try {
    out = parseFirstJson<Tr[]>(txt) // 뒤 군더더기·마크다운 무시하고 첫 JSON만
  } catch (pe) {
    // 모델이 뭘 뱉었는지 그대로 남김(마크다운 감쌈/엉뚱한 텍스트/중간잘림 판별용)
    console.error(
      `[parse실패] ${pe instanceof Error ? pe.message : pe} | 길이=${txt.length}` +
        ` | 앞:${JSON.stringify(txt.slice(0, 180))} | 뒤:${JSON.stringify(txt.slice(-120))}`,
    )
    throw new Error(`JSON형식오류: ${pe instanceof Error ? pe.message : pe}`)
  }
  if (!Array.isArray(out) || out.length !== items.length) {
    throw new Error(`문항 수 불일치 (${out?.length}/${items.length})`)
  }
  out.forEach((tr, i) => {
    const want = items[i].options.length
    for (const c of langs) {
      const o = tr?.[c]
      if (!o) throw new Error(`보기 개수 불일치 (#${i + 1} ${c})`)
      // 허용답안 — 개수는 안 보고 모양만 정리한다(빈 항목·중복 제거).
      // ⚠️ **원본에 답이 있는데 번역이 비어도 실패로 만들지 않는다.** 묶음 하나가 통째로 죽으면
      //    같이 묶인 멀쩡한 문항까지 다시 돌려야 한다(주관식이 계속 실패하던 옛 증상이 그것이다).
      //    빈 채로 내보내면 저장 단계가 그 언어를 '미번역'으로 남기고, 다음에 그 문항만 재시도한다.
      o.answers = Array.isArray(o.answers)
        ? [...new Set(o.answers.map((x) => String(x ?? '').trim()).filter(Boolean))]
        : []
      // ⚠️ **보기가 없는 문항(주관식)은 options 키가 없어도 통과시킨다.**
      //    보내는 원본이 `options: []` 라 모델이 그 키를 아예 빼고 돌려주는 일이 잦은데,
      //    예전 검사는 그걸 개수 불일치로 보고 **그 묶음 전체를 실패**시켰다. 레벨테스트는
      //    전 문항이 객관식이라 안 드러났고, 주관식이 있는 CARIS Elite 에서만 터졌다
      //    (실측: elite 주관식 10문항이 몇 번을 돌려도 계속 실패).
      //    보기가 1개 이상인 문항의 검사는 그대로다 — 개수가 어긋나면 정답 번호가 다른 보기를
      //    가리켜 아무도 못 맞히는 문항이 되므로 거기서는 절대 느슨해지면 안 된다.
      if (want === 0) {
        // ⚠️ 모델이 **없는 보기를 지어내서** 돌려주는 일이 잦다 — "…프로토콜은?" 같은 주관식에
        //    정답을 options 에 채워 넣는다(실측: elite 주관식 5문항이 이것 때문에 계속 실패).
        //    원본에 보기가 없으면 지어낸 값은 쓸 데가 없으므로 **버린다**(실패로 만들지 않는다).
        //    주관식 채점은 answer_key 로 하지 보기로 하지 않아서 버려도 잃는 것이 없다.
        o.options = []
        continue
      }
      if (!Array.isArray(o.options) || o.options.length !== want) {
        throw new Error(`보기 개수 불일치 (#${i + 1} ${c})`)
      }
    }
  })
  return out
}

// 룰 검사(로컬, API 불필요): 한글 잔존만. 숫자 보존은 오탐이 많아 AI 검수로 넘김.
function ruleIssues(tr: Item, src: Item): string[] {
  const out: string[] = []
  // ⚠️ **허용답안(answers)은 한글 검사에서 뺀다** — 한국어 표기가 섞여 있어도 정상이다.
  //    채점이 원문+번역 합집합이라 한국어 표기는 어차피 들어가고, 그걸 잔존으로 잡으면 오탐만 는다.
  const text = [tr.prompt, ...tr.options, tr.explanation].join(' ')
  // 한글 잔존(번역 누락) — 대상 언어엔 한글이 있을 수 없음
  if (/[가-힣]/.test(text)) out.push('한글 잔존')
  // 원본에 답이 있는데 번역이 통째로 비면 그 언어는 자동채점에 쓸 것이 없다(→ 그 언어만 재시도).
  if ((src.answers?.length ?? 0) > 0 && !(tr.answers?.length ?? 0)) out.push('허용답안 번역 없음')
  return out
}

// AI 검수: 원문 + 번역을 함께 주고 언어별 문제점(의미·자연스러움)을 받음.
async function reviewGroup(
  pairs: { src: Item; tr: Tr }[],
  langs: string[],
  endpoint: string,
): Promise<Record<string, string[]>[]> {
  const sys =
    'You are a bilingual QA reviewer for a certification test. ' +
    'For each item you get the Korean source and its translations. For EACH language check: ' +
    '(a) the meaning matches the source, (b) it reads naturally to a native speaker, ' +
    '(c) the options stay distinct and the correct answer is not made ambiguous, ' +
    '(d) every number, quantity, unit, date and year carries the SAME value/meaning as the source ' +
    '(numbers may be written as words or local numerals — that is fine; only flag a real value mismatch, e.g. 2024 became 2042), ' +
    '(e) "answers" (accepted answers, used for exact-match grading) name the SAME concept as the source and use the term ' +
    'practitioners actually write in that language — flag a wrong or invented term, but NOT a differing entry count ' +
    'and NOT an English/acronym entry left as-is (both are intended). ' +
    'Return ONLY a JSON array; element i = an object mapping each language code to an array of SHORT issue strings in Korean ' +
    '(empty array [] when the translation is fine). Do not nitpick style; flag only real problems.'
  const langList = langs.join(', ')
  const payload = pairs.map((p) => ({
    ko: {
      prompt: p.src.prompt,
      options: p.src.options,
      explanation: p.src.explanation,
      answers: p.src.answers ?? [],
    },
    translations: Object.fromEntries(langs.map((c) => [c, p.tr[c]])),
  }))
  const user =
    `Languages to review: ${langList}.\n` +
    `Return a JSON ARRAY of length ${pairs.length}; element i = { ${langs
      .map((c) => `"${c}": []`)
      .join(', ')} } with issues for ITEM[i].\n\n` +
    `ITEMS (JSON array):\n` +
    JSON.stringify(payload)

  const txt = await callGemini(sys, user, 8192, endpoint)
  const out = parseFirstJson<Record<string, string[]>[]>(txt) // 군더더기 무시
  if (!Array.isArray(out) || out.length !== pairs.length) {
    throw new Error(`검수 응답 수 불일치 (${out?.length}/${pairs.length})`)
  }
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    if (PASSCODE && req.headers.get('x-passcode') !== PASSCODE) {
      return json({ error: '암호가 올바르지 않습니다.' }, 401)
    }
    const body = await req.json()
    // 어느 지갑으로 부를지 — 모르는 값은 레벨테스트로 떨어뜨린다(옛 호출자는 use 를 안 보낸다).
    const use = body?.use === 'caris' ? 'caris' : 'leveltest'
    const apiKey = KEY_BY_USE[use]
    if (!apiKey) {
      return json(
        { error: use === 'caris' ? 'GEMINI_API_KEY_TEST_GENERATE 미설정' : 'GEMINI_API_KEY_TRANSLATE 미설정' },
        500,
      )
    }
    const endpoint = endpointFor(apiKey)
    const items: Item[] = Array.isArray(body?.items) ? body.items : []
    const langs: string[] =
      Array.isArray(body?.langs) && body.langs.length ? body.langs : DEFAULT_LANGS
    if (!items.length) return json({ error: 'items 가 비어 있습니다.' }, 400)
    if (items.length > MAX_ITEMS) {
      return json({ error: `한 번에 최대 ${MAX_ITEMS}문항까지 가능합니다.` }, 400)
    }
    const n = items.length
    let dailyHit = false
    const isDaily = (e: unknown) => e instanceof DailyQuotaError
    const reqId = Math.random().toString(36).slice(2, 7) // 이 요청 식별용(로그 추적)
    const failReason: (string | null)[] = new Array(n).fill(null)
    // 에러 → 짧은 사유 라벨(엑셀·로그 표시용)
    const shortReason = (e: unknown): string => {
      const m = e instanceof Error ? e.message : String(e)
      if (e instanceof DailyQuotaError) return '일일한도'
      if (/MAX_TOKENS|출력잘림/.test(m)) return '출력잘림(토큰초과·확정)'
      if (/문항 수 불일치/.test(m)) return '모델항목누락(정상종료인데 개수부족)'
      if (/보기 개수/.test(m)) return '보기개수불일치'
      if (/JSON|Unexpected|parse/i.test(m)) return 'JSON형식오류'
      if (/Gemini 429|quota/i.test(m)) return '분당한도(429)'
      if (/Gemini 5\d\d/.test(m)) return 'Gemini서버오류'
      if (/빈 응답/.test(m)) return '빈응답'
      return m.slice(0, 80)
    }

    console.log(`[${reqId}] 번역 시작: ${n}문항, langs=${langs.join(',')}`)

    // ── 1) 번역 (GROUP_SIZE 묶음, 묶음 실패 시 단건 폴백) ──
    const translations: (Tr | null)[] = new Array(n).fill(null)
    const tGroups: { start: number; items: Item[] }[] = []
    for (let i = 0; i < n; i += GROUP_SIZE) {
      tGroups.push({ start: i, items: items.slice(i, i + GROUP_SIZE) })
    }
    await mapLimit(tGroups, CONCURRENCY, async (g) => {
      if (dailyHit) return
      try {
        const out = await translateGroup(g.items, langs, endpoint)
        out.forEach((tr, k) => { translations[g.start + k] = tr })
      } catch (e) {
        // 폭주 방지: 묶음이 실패해도 여기서 동시 단건 재시도를 하지 않는다.
        // 실패 표시만 하고, 재시도는 클라이언트가 "마지막에 하나씩(대기열)" 처리.
        if (isDaily(e)) dailyHit = true
        const reason = isDaily(e) ? '일일한도' : shortReason(e)
        const detail = e instanceof Error ? e.message : String(e)
        console.error(
          `[${reqId}] 묶음 실패(${g.start}~${g.start + g.items.length - 1}): ${reason} | 상세: ${detail}`,
        )
        for (let k = 0; k < g.items.length; k++) {
          translations[g.start + k] = null
          failReason[g.start + k] = reason
        }
      }
    })

    // ── 2) 룰 검사 (로컬) ──
    const issues: Record<string, string[]>[] = new Array(n)
    for (let i = 0; i < n; i++) {
      issues[i] = {}
      const tr = translations[i]
      if (!tr) continue
      for (const c of langs) issues[i][c] = ruleIssues(tr[c], items[i])
    }

    // ── 3) AI 검수 (번역된 문항만, REVIEW_GROUP 묶음) ──
    // 번역 단계에서 일일 한도에 걸렸으면 검수는 건너뜀(어차피 호출 불가).
    if (!dailyHit) {
      const okIdx = Array.from({ length: n }, (_, i) => i).filter((i) => translations[i])
      const rGroups: number[][] = []
      for (let i = 0; i < okIdx.length; i += REVIEW_GROUP) {
        rGroups.push(okIdx.slice(i, i + REVIEW_GROUP))
      }
      await mapLimit(rGroups, CONCURRENCY, async (idxs) => {
        if (dailyHit) return
        try {
          const rv = await reviewGroup(
            idxs.map((i) => ({ src: items[i], tr: translations[i]! })),
            langs,
            endpoint,
          )
          idxs.forEach((i, k) => {
            const r = rv[k]
            for (const c of langs) {
              const more = Array.isArray(r?.[c]) ? r[c] : []
              if (more.length) issues[i][c] = [...(issues[i][c] || []), ...more]
            }
          })
        } catch (e) {
          if (isDaily(e)) dailyHit = true // 검수 중 한도 소진(번역은 유지)
          // 그 외 검수 실패는 무시(번역 결과는 유지)
        }
      })
    }

    // 결과: 성공 → {tr, issues}, 실패 → {error: 사유}(엑셀/HTML에서 사유 표시)
    const results = translations.map((tr, i) =>
      tr ? { tr, issues: issues[i] } : { error: failReason[i] || '미상' },
    )
    const failCount = results.filter((r) => 'error' in r).length
    console.log(`[${reqId}] 완료: 성공 ${n - failCount}/${n}` + (failCount ? `, 실패 ${failCount}` : ''))

    // 일일 한도 소진: 부분 결과를 함께 돌려주고 429로 알림 → 클라가 중단·저장·재개
    if (dailyHit) return json({ error: 'quota_daily', results }, 429)
    return json({ results })
  } catch (e) {
    console.error(`서버 오류: ${e instanceof Error ? e.message : e}`)
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
