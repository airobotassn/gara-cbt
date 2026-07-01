// recommend-level: 자유 검색어 → Gemini Flash Lite 분류기 → 레벨 1~7 추천
//   · 임베딩(유사도)으로는 "강도/의도"를 못 잡아서(초보→Lv.3, "어쩌라고"도 추천) 분류기로 전환.
//   · Flash Lite 가 문장을 읽고 1~7 로 판정 + 관련 없는 입력(무의미·질문 등)은 거른다.
//   · 제미나이 API 키는 서버(Edge Function 시크릿)에만. 단일 파일(_shared 미사용, URL import 만).
//   · 시맨틱 캐시: 같은 뜻의 입력은 임베딩 유사도로 잡아 AI 호출을 줄인다(MODE 참고).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const MODEL = 'gemini-2.5-flash-lite' // 다른 모델로 바꾸려면 이 문자열만 수정
const ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

// ---- 시맨틱 캐시 ----
// MODE: 'off'   = 캐시 미사용(분류 AI만, 현재 배포본과 동일)
//       'shadow'= 캐시를 돌리되 응답엔 안 씀. 뒤에서 "캐시였으면 뭐라 했을지"만 로깅 + 캐시 적재(위험 0, 데이터 수집)
//       'live'  = 캐시 HIT 면 AI 건너뛰고 캐시 레벨 반환(절약)
const MODE: 'off' | 'shadow' | 'live' = 'live'
const HIT_THRESHOLD = 0.92 // 검증(16샘플): 유사도 ≥0.92 캐시-분류기 100% 일치, ≤0.89 전부 불일치 → 0.92 채택.
const EMBED_MODEL = 'gemini-embedding-001'
const EMBED_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

// 입력 문장 → 임베딩 벡터(768) = 캐시 key
async function embed(text: string): Promise<number[]> {
  const res = await fetch(`${EMBED_ENDPOINT}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text }] },
      taskType: 'SEMANTIC_SIMILARITY',
      outputDimensionality: 768,
    }),
  })
  if (!res.ok) throw new Error(`임베딩 실패 (${res.status})`)
  const j = await res.json()
  return (j?.embedding?.values as number[]) ?? []
}

// 캐시에서 새 벡터와 가장 가까운 1개 + 유사도(0~1)
async function cacheNearest(
  vec: number[],
): Promise<{ level: number; similarity: number } | null> {
  const { data, error } = await supabase.rpc('match_reco_cache', {
    query_embedding: vec,
    match_count: 1,
  })
  if (error || !data || !data.length) return null
  return { level: data[0].level, similarity: data[0].similarity }
}

// (벡터=key, 레벨=value) 한 줄 저장
async function cacheInsert(
  vec: number[],
  level: number,
  sample: string,
): Promise<void> {
  await supabase.from('reco_cache').insert({ embedding: vec, level, sample })
}

const SYSTEM = `사용자는 "당신의 AI·로봇 활용 수준은 어느 정도인가요?" 라는 질문에 한 문장으로 답했다.
그 답을 읽고 자기평가 수준을 1~7 로 분류해라. **답에 'AI'나 '로봇'이란 단어가 없어도 무조건 'AI·로봇 실력'에 대한 답으로 간주한다.** "초보", "잘함" 같은 건 곧 "AI를 초보 수준으로 쓴다/잘 쓴다"는 뜻이다.

레벨 기준:
1 입문 — 완전 초보 / 아무것도 모름 / 막 시작 / 거의 안 써봄
2 기초 — 기본만 / 가끔 / 아직 서툼
3 초중급 — 그냥저냥 / 보통 / 평범 / 일상에 좀 씀
4 중급 — 익숙 / 업무에 접목
5 중상급 — 도구 조합 / 자동화 / 능숙
6 상급 — 한계까지 이해 / 결과 검증 / 매우 잘함
7 전문가 — 복합 문제 해결 / 최고 수준

예시:
"나 완전 초보 아무것도 몰라" → 1
"그냥저냥 씀" → 3
"꽤 써" → 4
"자동화도 잘하고 도구 여러개 씀" → 5
"복합 문제도 AI로 다 해결하는 전문가" → 7
"I'm a total beginner" → 1
"오늘 점심 뭐 먹지" → 0
"어쩌라고" → 0
"ㄱㄱㄱ" → 0

level=0 은 답이 자기 실력과 **전혀 무관**하거나(질문·잡담·욕설) 무의미할 때만. 다국어 가능. 반드시 JSON 으로만 답한다.`

// 명백한 헛입력(자모 떡칠 ㄱㄱㄱ, 무작위 자음 rrasdf, 반복 등)은 모델 호출 전에 컷(비용 절약).
function looksGibberish(raw: string): boolean {
  const s = raw.replace(/\s+/g, '')
  if (s.length < 2) return true
  if (/^(.)\1+$/u.test(s)) return true
  const hasSyllable = /[가-힣]/.test(s)
  const hasJamo = /[ㄱ-ㅎㅏ-ㅣ]/.test(s)
  if (hasJamo && !hasSyllable) return true
  if (!hasSyllable && /^[a-zA-Z]+$/.test(s)) {
    const vowels = (s.match(/[aeiou]/gi) || []).length
    if (vowels / s.length < 0.25) return true
  }
  return false
}

// Flash Lite 분류 → 레벨(1~7) 또는 0(관련 없음). 비200(429 등)은 throw.
async function classify(q: string): Promise<number> {
  const res = await fetch(`${ENDPOINT}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: `사용자 입력: "${q}"` }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            level: { type: 'INTEGER' },
            reason: { type: 'STRING' },
          },
          required: ['level'],
        },
      },
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.error(`[classify] Gemini ${res.status}: ${detail.slice(0, 200)}`)
    // 429(한도초과) 등은 에러로 던져 → 핸들러가 500 → 프론트 "잠시 후 다시" 안내.
    // (level 0 으로 처리하면 사용자 입력 탓("다시 입력")으로 잘못 보임)
    throw new Error(`Gemini 분류 실패 (${res.status}): ${detail.slice(0, 150)}`)
  }
  const j = await res.json()
  const text: string = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  let parsed: { level?: number } = {}
  try {
    parsed = JSON.parse(text)
  } catch {
    /* 형식 오류 → 0 처리 */
  }
  const lvl = Number(parsed?.level)
  return Number.isFinite(lvl) ? lvl : 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  try {
    if (!GEMINI_API_KEY) {
      return json({ error: 'GEMINI_API_KEY 가 설정되지 않았습니다.' }, 500)
    }
    const { query } = await req.json()
    if (typeof query !== 'string' || query.trim().length === 0) {
      return json({ error: '검색어를 입력하세요.' }, 400)
    }
    const q = query.trim().slice(0, 500)

    // 명백한 헛입력은 모델 호출 없이 바로 컷
    if (looksGibberish(q)) {
      return json({ level: null, lowConfidence: true })
    }

    // 1~7 이면 레벨+도전후보, 아니면 다시입력 응답
    const toResp = (lvl: number) =>
      lvl >= 1 && lvl <= 7
        ? { level: lvl, alt: lvl < 7 ? lvl + 1 : null, lowConfidence: false }
        : { level: null, lowConfidence: true }

    // ---- LIVE: 캐시 먼저, HIT 면 AI 건너뜀 ----
    if (MODE === 'live') {
      const vec = await embed(q)
      const near = await cacheNearest(vec)
      if (near && near.similarity >= HIT_THRESHOLD && near.level >= 1 && near.level <= 7) {
        console.log(`[reco] "${q}" → HIT lv=${near.level} sim=${near.similarity.toFixed(3)}`)
        return json(toResp(near.level)) // 캐시 HIT — AI 안 부름
      }
      console.log(`[reco] "${q}" → MISS (best=${near?.similarity?.toFixed(3) ?? '-'}) → 분류기`)
      const level = await classify(q) // MISS — AI 판정
      if (level >= 1 && level <= 7) cacheInsert(vec, level, q).catch(() => {})
      return json(toResp(level))
    }

    // ---- OFF / SHADOW: 분류 AI 가 답을 결정(현재 배포본과 동일) ----
    const level = await classify(q)
    const resp = toResp(level)
    console.log(`[reco] "${q}" → level=${level} (mode=${MODE})`)

    if (MODE === 'shadow') {
      // 사용자 응답엔 영향 0. 뒤에서 임베딩·캐시비교·로깅·적재.
      const shadow = (async () => {
        try {
          const vec = await embed(q)
          const near = await cacheNearest(vec)
          console.log(
            `[shadow] "${q}" llm=${level} cache=${near?.level ?? '-'} sim=${near?.similarity?.toFixed(3) ?? '-'}`,
          )
          await supabase.from('reco_shadow_log').insert({
            sample: q,
            level_llm: level,
            level_cache: near?.level ?? null,
            similarity: near?.similarity ?? null,
          })
          if (level >= 1 && level <= 7) await cacheInsert(vec, level, q)
        } catch (e) {
          console.error('[shadow] 실패:', e instanceof Error ? e.message : e)
        }
      })()
      // 응답을 막지 않게 백그라운드로 (없으면 그냥 await)
      const er = (globalThis as {
        EdgeRuntime?: { waitUntil(p: Promise<unknown>): void }
      }).EdgeRuntime
      if (er) er.waitUntil(shadow)
      else await shadow
    }

    return json(resp)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
