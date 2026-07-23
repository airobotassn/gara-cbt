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
// 임베딩 전용 키(분류기와 할당량 분리). 임베딩 벡터는 모델만 같으면 키 무관하게 동일.
const EMBED_KEY = Deno.env.get('GEMINI_API_KEY_TEST_GENERATE') ?? GEMINI_API_KEY
const MODEL = 'gemini-3.1-flash-lite'
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`
const EMBED_MODEL = 'gemini-embedding-001' // ⚠️ route-seed 와 동일해야 벡터 호환. 바꾸면 전체 재시드 필수.
const EMBED_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`

const HIT_THRESHOLD = 0.85 // 이 이상이면 캐시 HIT(LLM 안 부름). 시드가 촘촘해 대부분 여기서 끝. 튜닝 포인트.

// 인텐트 → 실제 라우트. 'unknown' 은 라우팅 안 함(null).
// ⚠️ 여기 바꾸면 route-seed 의 SEED dest, Landing.tsx 의 VALID_DESTS/clientKeywordRoute 도 같이 갱신.
const DEST: Record<string, string> = {
  level_test: '/test/select',   // WORLD ARENA(무료 레벨 진단/실력 진단)
  guide: '/guide',              // 자격검정 안내(종류·급수·과목·응시자격)
  schedule: '/guide',           // 일정 페이지 폐지 → 자격검정 안내로 통합(안내에 일정·상시시험 노출)
  apply: '/guide',              // 원서접수·응시료 검색 → 안내 허브(안내의 접수 버튼으로 결제 진입)
  take_exam: '/exam',           // 응시 시작(시험 보러)
  exam_check: '/exam/check',    // 시험환경 점검·모의응시
  mypage: '/mypage',            // 내 점수·결과·이력
  certificate: '/certificate',  // 자격증 발급·확인
  ranking: '/ranking',          // 랭킹·순위
  about: '/about',              // 협회 소개
  notice: '/notice',            // 공지사항
  faq: '/faq',                  // 고객센터·문의
  ebook: '/ebooks',             // 이북(전자책) 스토어 — 구매한 책 읽기는 마이페이지 서재
}
const VALID = new Set(Object.values(DEST))

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

// 입력 문장 → 임베딩 벡터(768). 실패(한도 등) 시 throw.
async function embed(text: string): Promise<number[]> {
  const res = await fetch(`${EMBED_ENDPOINT}?key=${EMBED_KEY}`, {
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

const SYSTEM = `사용자가 자격검정 사이트(GARA·CARIS) 홈의 검색창에 무언가를 입력했다. 그 의도를 아래 카테고리 중 하나로 분류해라.

- level_test : 무료 AI 실력 진단/WORLD ARENA(옛 CARIS ARENA·레벨테스트)를 하고 싶다. ("월드 아레나", "WORLD ARENA", "카리스 아레나", "레벨테스트", "내 실력 몇점", "무료 진단", "몇 레벨인지")
- guide      : 어떤 시험/자격증이 있는지, 급수·과목·응시자격 등 자격검정 "정보"가 궁금하다. ("어떤 시험 있어", "자격증 종류", "응시 자격", "CARIS가 뭐야")
- schedule   : 시험 "일정/날짜/회차"가 궁금하다. ("시험 언제야", "정기시험 일정", "다음 시험 날짜", "접수 기간")
- apply      : 원서접수/시험 신청/등록/응시료 결제를 하고 싶다. ("원서접수", "시험 신청", "접수하기", "응시료")
- take_exam  : 지금 시험을 응시/시작하러 왔다. ("시험 보러 왔어", "응시하기", "시험 시작", "시험장 입장")
- exam_check : 시험 환경 점검/모의응시/시험 프로그램(SEB) 설치. ("모의고사", "환경 점검", "연습 시험", "SEB 설치")
- mypage     : 내 점수/결과/응시이력/내 정보/학습 대시보드. ("내 점수", "내 결과", "마이페이지", "응시 이력")
- certificate: 자격증/합격증/증명서 발급·확인·출력. ("자격증 발급", "증명서 출력", "내 자격증")
- ranking    : 순위/랭킹/리더보드/명예의전당. ("랭킹", "순위", "1등이 누구")
- about      : 협회/기관 소개, 이 사이트가 뭔지. ("협회 소개", "무슨 협회야", "GARA가 뭐야")
- notice     : 공지사항/소식/안내/점검 공지. ("공지사항", "새 소식", "점검 공지")
- faq        : 문의·고객센터·환불·결제문제·시스템오류·도움. ("문의", "환불", "고객센터", "결제 문제", "도움 필요")
- ebook      : 이북/전자책/교재를 사거나 읽고 싶다. ("이북", "전자책", "교재 사기", "책 구매", "내 이북", "eBook")
- unknown    : 입력이 이 사이트(시험·자격·학습·내 정보 등)와 **정말로 무관**할 때만. (인사·잡담·욕설·무의미·사이트와 상관없는 질문 "오늘 점심 뭐먹지" 등)

원칙: 입력이 조금이라도 관련 있으면 애매하더라도 **13개 중 가장 가까운 하나**를 골라라. unknown 은 최후의 수단이다.
구분 팁: 시험 "정보"=guide, "일정"=schedule, "접수/신청"=apply, "지금 응시"=take_exam. 내 데이터(점수·자격증)=mypage/certificate.
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
// 구체적인 것부터(순서 중요). Landing.tsx 의 clientKeywordRoute 와 동기화.
function keywordRoute(q: string): string | null {
  const s = q.toLowerCase()
  const h = (re: RegExp) => re.test(s)
  if (h(/랭킹|순위|리더보드|명예의?\s?전당|rank|leaderboard|ランキング|順位|排名|排行|名人堂|xếp hạng|thứ hạng/)) return '/ranking'
  if (h(/마이\s?페이지|내 점수|내 결과|내 성적|응시\s?이력|내 기록|my score|my result|my page|mypage|マイページ|受験履歴|个人中心|我的成绩|trang cá nhân/)) return '/mypage'
  if (h(/자격증|합격증|증명서|인증서|certificate|証明書|合格証|证书|chứng chỉ của/)) return '/certificate'
  if (h(/협회\s?소개|무슨 협회|어떤 단체|기관\s?소개|회사\s?소개|about us|協会について|关于我们|协会介绍|giới thiệu hiệp hội|về chúng tôi/)) return '/about'
  if (h(/공지|소식|안내사항|announcement|notice|お知らせ|公告|thông báo/)) return '/notice'
  if (h(/문의|고객센터|환불|결제|상담|도와|도움|help|contact|support|refund|payment|問い合わせ|カスタマー|返金|客服|退款|hỏi|liên hệ|hoàn tiền|hỗ trợ/)) return '/faq'
  if (h(/이북|e-?book|전자책|전자\s?교재|교재|電子書籍|电子书|sách điện tử/)) return '/ebooks'
  if (h(/모의|환경\s?점검|연습\s?시험|사전\s?점검|seb|mock|practice|模擬|模拟|事前チェック|thi thử/)) return '/exam/check'
  if (h(/일정|날짜|언제|회차|스케줄|schedule|日程|いつ|时间|khi nào|lịch/)) return '/guide'
  if (h(/원서|접수|신청|등록|응시료|register|apply|sign\s?up|願書|申込|受験料|报名|đăng ký|lệ phí/)) return '/guide'
  if (h(/응시|시험 ?보|시험 ?볼|시험 ?시작|시험장|치르|take (the )?exam|sit (the )?exam|受験|参加考试|dự thi|vào thi/)) return '/exam'
  if (h(/자격|급수|과목|자격검정|certif|eligib|資格|资格|試験|kỳ thi|chứng nhận|시험/)) return '/guide'
  if (h(/카리스\s?아레나|caris[\s-]?arena|레벨|진단|실력|무료|수준|측정|level|test|assess|diagnos|レベル|診断|等级|水平|测评|trình độ|kiểm tra|đánh giá/)) return '/test/select'
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
            intent: {
              type: 'STRING',
              enum: ['level_test', 'guide', 'schedule', 'apply', 'take_exam', 'exam_check', 'mypage', 'certificate', 'ranking', 'about', 'notice', 'faq', 'ebook', 'unknown'],
            },
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
