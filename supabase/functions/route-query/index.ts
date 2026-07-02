// route-query: 홈 검색창 자유 입력 → 임베딩 유사도로 목적지 페이지 라우팅.
//   설계(합의):
//     1) 대량 다양 시드(route-seed) 를 미리 깔아 대부분 쿼리는 임베딩 HIT → LLM 거의 안 부름.
//     2) MISS 면 Flash Lite 가 인텐트 분류 → dest. "LLM 답 == 최근접 dest" 일 때만 write-back
//        (틀린 '섬'을 못 만들게 예방 → 오염 자가발생 X, 삭제/모니터링 불필요).
//     3) 폴백: LLM 429 → 임베딩 최고점 dest / 임베딩도 한계 → 키워드 규칙 → 그래도 없으면 null.
//   · GEMINI_API_KEY 는 서버 시크릿(reco 와 공용). 단일 파일(_shared 미사용, URL import 만).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const MODEL = 'gemini-2.5-flash-lite'
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`
const EMBED_MODEL = 'gemini-embedding-001'
const EMBED_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`

const HIT_THRESHOLD = 0.85 // 이 이상이면 캐시 HIT(LLM 안 부름). 시드가 촘촘해 대부분 여기서 끝. 튜닝 포인트.

// 인텐트 → 실제 라우트. 'unknown' 은 라우팅 안 함(null).
const DEST: Record<string, string> = {
  level_test: '/test/select',
  guide: '/guide',
  faq: '/faq',
  ranking: '/ranking',
}
const VALID = new Set(Object.values(DEST))

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

// 입력 문장 → 임베딩 벡터(768). 실패(한도 등) 시 throw.
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

// 새 벡터와 가장 가까운 1개 {dest, similarity, source}
async function nearest(vec: number[]): Promise<{ dest: string; similarity: number; source: string } | null> {
  const { data, error } = await supabase.rpc('match_route', { query_embedding: vec, match_count: 1 })
  if (error || !data || !data.length) return null
  return { dest: data[0].dest, similarity: data[0].similarity, source: data[0].source }
}

async function cacheInsert(vec: number[], dest: string, sample: string): Promise<void> {
  await supabase.from('route_cache').insert({ embedding: vec, dest, sample, source: 'llm' })
}

const SYSTEM = `사용자가 자격검정 사이트(GARA·CARIS) 홈의 검색창에 무언가를 입력했다. 그 의도를 아래 5개 중 하나로 분류해라.

- level_test : 무료 AI 실력 진단/레벨테스트를 하고 싶다. ("레벨테스트", "내 실력 몇점", "무료 진단", "몇 레벨인지")
- guide      : 어떤 시험/자격증이 있는지, 시험 일정·응시자격·급수·과목 등 자격검정 안내가 궁금하다. ("어떤 시험 있어", "자격증 종류", "시험 일정", "응시 자격")
- faq        : 문의·고객센터·환불·연락처·도움 등 도움이 필요하다. ("문의하고 싶어", "환불", "고객센터", "도움 필요")
- ranking    : 순위/랭킹/리더보드가 보고 싶다. ("랭킹", "순위", "1등이 누구")
- unknown    : 위 어디에도 안 맞거나(잡담·질문·욕설·무의미) 애매하다.

다국어 가능(한/영/일/중/힌/베). 반드시 JSON 으로만 답한다.`

// 명백한 헛입력 컷(비용 절약). recommend-level 과 동일 로직.
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

// 최후 폴백(임베딩·LLM 다 죽었을 때): 키워드 규칙 → dest 또는 null.
function keywordRoute(q: string): string | null {
  const s = q.toLowerCase()
  const has = (re: RegExp) => re.test(s)
  // 우선순위: ranking · faq 를 먼저(더 구체적) → guide → level_test
  if (has(/랭킹|순위|리더보드|rank|leaderboard|ランキング|順位|排名|排行|xếp hạng|thứ hạng/)) return '/ranking'
  if (has(/문의|질문|고객|환불|연락|상담|도움|help|contact|support|refund|問い合わせ|質問|咨询|退款|客服|hỏi|liên hệ|hoàn tiền|hỗ trợ/)) return '/faq'
  if (has(/시험|자격|급수|일정|응시|과목|정기|certif|exam|schedule|eligib|試験|資格|考试|资格|证书|chứng chỉ|kỳ thi|lịch thi/)) return '/guide'
  if (has(/레벨|진단|실력|테스트|수준|측정|level|test|assess|diagnos|レベル|診断|测评|等级|水平|trình độ|kiểm tra|đánh giá/)) return '/test/select'
  return null
}

// Flash Lite 분류 → intent 문자열. 비200(429 등)은 throw.
async function classify(q: string): Promise<string> {
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
            intent: { type: 'STRING', enum: ['level_test', 'guide', 'faq', 'ranking', 'unknown'] },
            reason: { type: 'STRING' },
          },
          required: ['intent'],
        },
      },
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.error(`[route classify] Gemini ${res.status}: ${detail.slice(0, 200)}`)
    throw new Error(`분류 실패 (${res.status})`)
  }
  const j = await res.json()
  const text: string = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  let parsed: { intent?: string } = {}
  try {
    parsed = JSON.parse(text)
  } catch {
    /* 형식 오류 → unknown */
  }
  return typeof parsed?.intent === 'string' ? parsed.intent : 'unknown'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    if (!GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY 미설정' }, 500)
    const body = await req.json()
    const query = body?.query
    if (typeof query !== 'string' || query.trim().length === 0) {
      return json({ error: '검색어를 입력하세요.' }, 400)
    }
    const q = query.trim().slice(0, 300)

    // 헛입력은 바로 unknown
    if (looksGibberish(q)) return json({ dest: null })

    // --- 1) 임베딩 ---
    let vec: number[]
    try {
      vec = await embed(q)
    } catch (e) {
      // 폴백 A: 임베딩 한도/장애 → 키워드 규칙
      console.warn('[route] embed 실패 → 키워드 폴백:', e instanceof Error ? e.message : e)
      return json({ dest: keywordRoute(q), fallback: 'keyword' })
    }

    // --- 2) 최근접 앵커 ---
    const near = await nearest(vec)

    // --- 3) HIT: 임계 이상이면 즉시 라우팅(LLM 안 부름) ---
    if (near && near.similarity >= HIT_THRESHOLD && VALID.has(near.dest)) {
      console.log(`[route] "${q}" → HIT ${near.dest} sim=${near.similarity.toFixed(3)}`)
      return json({ dest: near.dest, hit: true })
    }

    // --- 4) MISS: LLM 분류 ---
    let intent: string
    try {
      intent = await classify(q)
    } catch (e) {
      // 폴백 B: LLM 429/장애 → 임베딩 최고점 dest(임계 무시), 그것도 없으면 키워드
      console.warn('[route] classify 실패 → 임베딩최고점/키워드 폴백:', e instanceof Error ? e.message : e)
      const dest = (near && VALID.has(near.dest)) ? near.dest : keywordRoute(q)
      return json({ dest, fallback: near ? 'embedding_top' : 'keyword' })
    }

    const dest = DEST[intent] ?? null
    console.log(`[route] "${q}" → MISS intent=${intent} dest=${dest ?? 'null'} (near=${near?.dest ?? '-'} ${near?.similarity?.toFixed(3) ?? '-'})`)

    // --- 5) 오염 예방형 write-back: LLM 답 == 최근접 dest 일 때만 저장 ---
    if (dest && near && near.dest === dest) {
      cacheInsert(vec, dest, q).catch(() => {})
    }

    return json({ dest })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
