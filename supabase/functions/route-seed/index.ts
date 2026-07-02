// route-seed: route_cache 에 손으로 고른 앵커(source='seed')를 1회 대량 적재한다.
//   · 임베딩은 서버 시크릿(GEMINI_API_KEY)로만 가능 → 시드 적재도 서버에서.
//   · 멱등: 기본(reset=true)이면 기존 seed 행을 지우고 새로 넣는다(중복 방지). 'llm' 학습분은 안 건드림.
//   · 가벼운 가드: 헤더 x-seed-key == ROUTE_SEED_KEY. 미설정이면 거부(외부 무단 호출 차단).
//   · 배치 임베딩(batchEmbedContents, 100개씩)으로 한도/시간 절약. 단일 파일(대시보드 배포 가능).
//   · --no-verify-jwt 로 배포(내부 도구가 curl 로 1회 호출).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-seed-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const SEED_KEY = Deno.env.get('ROUTE_SEED_KEY')
const EMBED_MODEL = 'gemini-embedding-001'
const EMBED_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

// ---- 앵커 시드: 목적지별 대표 질의(6개국어 ko/en/ja/zh/hi/vi) ----
// 표현 다양성(직접요청·구어체·질문·키워드·동의어)을 넓게 깔아 대부분 쿼리가 임베딩 HIT 되게.
const SEED: { dest: string; phrases: string[] }[] = [
  {
    dest: '/test/select',
    phrases: [
      // ko
      '레벨테스트 하고싶어', '무료로 내 실력 진단', '내 AI 실력 몇 점일까', '레벨 테스트', '실력 측정하고 싶어',
      'AI 활용 능력 진단', '무료 테스트 해볼래', '내가 몇 레벨인지 궁금해', '레벨 측정', 'AI 얼마나 잘하는지 확인',
      '간단하게 실력 체크', '레벨진단', '무료진단', '내 수준 알아보기', '테스트 받고싶어', 'AI 실력 테스트',
      // en
      'I want to take the level test', 'free AI skill assessment', 'check my AI level', 'how good am I at AI',
      'test my skills', 'level test', 'free diagnosis', 'measure my ability', 'what level am I',
      // ja
      'レベルテストを受けたい', '無料でAI実力診断', '自分のAIレベルを知りたい', 'スキル測定', 'レベル診断', '無料テスト',
      // zh
      '我想做等级测试', '免费AI能力测评', '测测我的AI水平', '技能测试', '等级诊断', '免费测试',
      // hi
      'मैं लेवल टेस्ट देना चाहता हूँ', 'मुफ्त AI कौशल जाँच', 'मेरा AI स्तर जांचें', 'स्किल टेस्ट',
      // vi
      'tôi muốn làm bài kiểm tra trình độ', 'đánh giá kỹ năng AI miễn phí', 'kiểm tra trình độ AI của tôi', 'test kỹ năng',
    ],
  },
  {
    dest: '/guide',
    phrases: [
      // ko
      '어떤 시험이 있어', '무슨 자격증 있나요', '시험 종류', '자격검정 안내', '시험 일정 알려줘', '응시 자격이 뭐야',
      '급수가 어떻게 돼', 'CARIS 시험 정보', '자격증 어떻게 따', '시험 언제야', '정기시험 일정', '시험 안내 보고싶어',
      '자격 종류 궁금해', 'Pro Master 차이', '시험 과목', '자격증 시험 정보',
      // en
      'what exams are there', 'what certifications do you offer', 'exam schedule', 'certification guide',
      'eligibility requirements', 'how to get certified', 'exam dates', 'CARIS levels', 'types of exams', 'exam subjects',
      // ja
      'どんな試験がありますか', '資格の種類', '試験日程', '受験資格', '認定ガイド', '試験について',
      // zh
      '有哪些考试', '有什么证书', '考试日程', '报考资格', '认证指南', '考试科目',
      // hi
      'कौन सी परीक्षाएं हैं', 'कौन से प्रमाणपत्र हैं', 'परीक्षा कार्यक्रम', 'पात्रता', 'प्रमाणन गाइड',
      // vi
      'có những kỳ thi nào', 'có chứng chỉ gì', 'lịch thi', 'điều kiện dự thi', 'hướng dẫn chứng nhận',
    ],
  },
  {
    dest: '/faq',
    phrases: [
      // ko
      '문의하고 싶어', '물어볼 게 있어', '고객센터 어디야', '궁금한 게 있어요', '환불 어떻게 해', '연락처 알려줘',
      '도움이 필요해', '문제가 생겼어', '문의사항', '자주 묻는 질문', '결제 문제', '취소하고 싶어', '질문 있어요',
      '상담하고 싶어', '고객지원', '도와주세요',
      // en
      'I have a question', 'contact support', 'customer service', 'I need help', 'how to get a refund',
      'contact info', 'I have an issue', 'cancel my application', 'faq', 'frequently asked questions',
      // ja
      '問い合わせたい', '質問があります', 'カスタマーサポート', '返金したい', '連絡先', '困っています',
      // zh
      '我想咨询', '有问题想问', '客服在哪', '怎么退款', '联系方式', '需要帮助',
      // hi
      'मुझे पूछताछ करनी है', 'मेरा एक सवाल है', 'ग्राहक सेवा', 'रिफंड कैसे लें', 'संपर्क', 'मदद चाहिए',
      // vi
      'tôi muốn hỏi', 'tôi có câu hỏi', 'chăm sóc khách hàng', 'hoàn tiền thế nào', 'liên hệ', 'cần trợ giúp',
    ],
  },
  {
    dest: '/ranking',
    phrases: [
      // ko
      '랭킹 보고싶어', '순위 확인', '리더보드', '누가 1등이야', '전체 순위', '랭킹 페이지', '내 순위 어디',
      '상위권 보기', '순위표', '랭킹',
      // en
      'show me the ranking', 'leaderboard', 'who is number one', 'rankings', 'top players', 'my rank',
      // ja
      'ランキングを見たい', 'リーダーボード', '順位', 'トップは誰',
      // zh
      '查看排名', '排行榜', '谁是第一', '排名',
      // hi
      'रैंकिंग दिखाओ', 'लीडरबोर्ड', 'शीर्ष रैंक',
      // vi
      'xem xếp hạng', 'bảng xếp hạng', 'ai đứng đầu', 'thứ hạng',
    ],
  },
]

// 단건 임베딩(무료 티어 OK) + 429 백오프. recommend-level 과 동일 파라미터.
async function embedOne(text: string): Promise<number[]> {
  for (let attempt = 0; attempt < 4; attempt++) {
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
    if (res.ok) {
      const j = await res.json()
      return (j?.embedding?.values as number[]) ?? []
    }
    if (res.status === 429 && attempt < 3) {
      await sleep(15000) // 분당 한도 → 15s 쉬고 재시도
      continue
    }
    const detail = await res.text().catch(() => '')
    throw new Error(`임베딩 실패 (${res.status}): ${detail.slice(0, 150)}`)
  }
  throw new Error('임베딩 실패 (재시도 초과)')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    if (!GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY 미설정' }, 500)
    if (!SEED_KEY || req.headers.get('x-seed-key') !== SEED_KEY) {
      return json({ error: 'unauthorized' }, 401)
    }
    const body = await req.json().catch(() => ({}))
    const reset = body?.reset === true // 명시적일 때만 seed 초기화(보통 첫 슬라이스에서)
    const offset = Number.isFinite(body?.offset) ? Math.max(0, Math.floor(body.offset)) : 0
    const limit = Number.isFinite(body?.limit) ? Math.max(1, Math.floor(body.limit)) : 60

    // (dest, phrase) 평탄화 — 결정적 순서(슬라이스 안정)
    const all: { dest: string; text: string }[] = []
    for (const s of SEED) for (const p of s.phrases) all.push({ dest: s.dest, text: p })
    const total = all.length
    const slice = all.slice(offset, offset + limit)

    if (reset) {
      await supabase.from('route_cache').delete().eq('source', 'seed')
    }

    // 단건 임베딩 + 페이싱(≈600ms 간격, 분당 한도 회피). 실패는 throw → 그 슬라이스만 재호출.
    const payload: { embedding: number[]; dest: string; sample: string; source: string }[] = []
    for (const r of slice) {
      const vec = await embedOne(r.text)
      payload.push({ embedding: vec, dest: r.dest, sample: r.text, source: 'seed' })
      await sleep(600)
    }
    if (payload.length) {
      const { error } = await supabase.from('route_cache').insert(payload)
      if (error) return json({ error: `insert 실패: ${error.message}` }, 500)
    }

    const nextOffset = offset + slice.length
    return json({ seeded: payload.length, offset, nextOffset, total, done: nextOffset >= total, reset })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
