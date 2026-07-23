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
// 임베딩 전용 키: 대량 시드가 라이브 검색(GEMINI_API_KEY)의 임베딩 할당량을 안 갉아먹게 별 키 사용.
// 임베딩 벡터는 모델(001)만 같으면 키와 무관하게 동일 → 기존 시드와 호환.
const EMBED_KEY = Deno.env.get('GEMINI_API_KEY_TEST_GENERATE') ?? GEMINI_API_KEY
const SEED_KEY = Deno.env.get('ROUTE_SEED_KEY')
const EMBED_MODEL = 'gemini-embedding-001' // ⚠️ route-query 와 동일해야 벡터 호환. 바꾸면 전체 재시드 필수.
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
    dest: '/test/select', // WORLD ARENA(무료 레벨 진단/AI 실력 진단)
    phrases: [
      // 현재 제품명
      '월드 아레나', 'WORLD ARENA', '월드아레나', '월드 아레나 응시', '월드 아레나 하고싶어', 'world arena', 'world-arena',
      // 옛 이름(CARIS ARENA·SEMI-CARIS) — 예전 이름으로 검색해도 찾아지게 유지
      '카리스 아레나', 'CARIS ARENA', '카리스아레나', '카리스 아레나 응시', '카리스 아레나 하고싶어', 'caris arena', 'caris-arena',
      '레벨테스트 하고싶어', '무료로 내 실력 진단', '내 AI 실력 몇 점일까', '레벨 테스트', '실력 측정하고 싶어',
      'AI 활용 능력 진단', '무료 테스트 해볼래', '내가 몇 레벨인지 궁금해', '레벨 측정', 'AI 얼마나 잘하는지 확인',
      '간단하게 실력 체크', '레벨진단', '무료진단', '내 수준 알아보기', '레벨테스트 시작', 'AI 실력 테스트',
      'I want to take the level test', 'free AI skill assessment', 'check my AI level', 'how good am I at AI',
      'test my skills', 'level test', 'free diagnosis', 'what level am I',
      'レベルテストを受けたい', '無料でAI実力診断', '自分のAIレベルを知りたい', 'レベル診断', '無料テスト',
      '我想做等级测试', '免费AI能力测评', '测测我的AI水平', '等级诊断', '免费测试',
      'मैं लेवल टेस्ट देना चाहता हूँ', 'मुफ्त AI कौशल जाँच', 'मेरा AI स्तर जांचें',
      'tôi muốn làm bài kiểm tra trình độ', 'đánh giá kỹ năng AI miễn phí', 'kiểm tra trình độ AI của tôi',
    ],
  },
  {
    dest: '/guide', // 자격검정 안내: 시험 종류·급수·과목·응시자격·CARIS 소개 (정보성)
    phrases: [
      '어떤 시험이 있어', '무슨 자격증 있나요', '시험 종류', '자격검정 안내', '응시 자격이 뭐야',
      '급수가 어떻게 돼', 'CARIS가 뭐야', '자격증 어떻게 따', '시험 과목', '자격 종류 궁금해',
      'Pro랑 Master 차이', '시험 정보 보고싶어', '어떤 급수들이 있어', '합격 기준이 뭐야',
      'what exams are there', 'what certifications do you offer', 'certification guide', 'eligibility requirements',
      'how to get certified', 'exam subjects', 'CARIS levels', 'what is CARIS', 'types of exams',
      'どんな試験がありますか', '資格の種類', '受験資格', '認定ガイド', '試験科目',
      '有哪些考试', '有什么证书', '报考资格', '认证指南', '考试科目',
      'कौन सी परीक्षाएं हैं', 'कौन से प्रमाणपत्र हैं', 'पात्रता', 'प्रमाणन गाइड',
      'có những kỳ thi nào', 'có chứng chỉ gì', 'điều kiện dự thi', 'hướng dẫn chứng nhận',
    ],
  },
  {
    dest: '/guide', // (구)시험 일정 검색 → 자격검정 안내로 통합(일정 페이지 폐지)
    phrases: [
      '시험 일정 알려줘', '시험 언제야', '정기시험 일정', '다음 시험 날짜', '시험 회차',
      '언제 시험 봐', '시험 날짜 확인', '접수 기간 언제', '시험 스케줄', '몇 월에 시험 있어',
      'exam schedule', 'when is the exam', 'exam dates', 'next exam date', 'test schedule', 'registration period',
      '試験日程', '試験はいつ', '次の試験日', '受付期間',
      '考试日程', '考试什么时候', '下次考试时间', '报名时间',
      'परीक्षा कार्यक्रम', 'परीक्षा कब है', 'अगली परीक्षा तिथि',
      'lịch thi', 'khi nào thi', 'ngày thi tiếp theo', 'thời gian đăng ký',
    ],
  },
  {
    dest: '/guide', // (구)원서접수 검색 → 자격검정 안내 허브로(접수 버튼으로 결제 진입)
    phrases: [
      '원서접수 하고싶어', '시험 신청할래', '접수하고 싶어', '시험 등록', '응시료 얼마야',
      '결제하고 시험 신청', '시험 접수 방법', '원서 넣고싶어', '시험 신청서 작성', '접수하기',
      'register for the exam', 'apply for the exam', 'exam registration', 'how to sign up', 'exam fee',
      '願書を出したい', '試験に申し込む', '受験申込', '受験料はいくら',
      '我要报名', '报名考试', '考试报名', '报名费多少',
      'परीक्षा के लिए पंजीकरण', 'परीक्षा के लिए आवेदन', 'पंजीकरण शुल्क',
      'đăng ký thi', 'đăng ký dự thi', 'lệ phí thi', 'nộp hồ sơ thi',
    ],
  },
  {
    dest: '/exam', // 응시 게이트: 시험 보러/응시 시작/시험장 입장
    phrases: [
      '시험 보러 왔어', '응시하러 왔어', '지금 시험 볼래', '시험 시작할래', '응시하기',
      '시험장 입장', '시험 응시', '시험 치르러 왔어', 'CBT 응시하기', '바로 시험 시작',
      'I want to take the exam now', 'start the exam', 'take the test', 'enter the exam', 'sit the exam',
      '試験を受けに来た', '今すぐ受験', '試験を始める', '受験する',
      '我来考试', '现在开始考试', '参加考试', '进入考场',
      'tôi muốn thi ngay', 'bắt đầu thi', 'vào thi', 'dự thi',
    ],
  },
  {
    dest: '/exam/check', // 시험환경 점검·모의응시·SEB 설치
    phrases: [
      '시험 환경 점검', '모의응시 해보고 싶어', '모의고사 있어', '연습 시험', '시험 프로그램 설치',
      'SEB 설치', '환경 테스트', '시험 잘 되는지 확인', '사전 점검', '시험 전에 연습',
      'check exam environment', 'take a practice exam', 'mock test', 'install exam software', 'system check',
      '試験環境チェック', '模擬試験', '事前チェック', 'ソフトのインストール',
      '考试环境检测', '模拟考试', '系统检查', '安装考试软件',
      'परीक्षा वातावरण जाँच', 'मॉक टेस्ट', 'सिस्टम जाँच',
      'kiểm tra môi trường thi', 'thi thử', 'kiểm tra hệ thống',
    ],
  },
  {
    dest: '/mypage', // 내 점수·결과·응시이력·학습 대시보드
    phrases: [
      '내 점수 보고싶어', '내 시험 결과', '내 응시 이력', '마이페이지', '내가 딴 자격',
      '내 성적 확인', '내 정보 보기', '학습 대시보드', '지난 결과 보기', '내 기록',
      'my score', 'my exam results', 'my page', 'my attempts', 'my dashboard', 'view my results',
      '私のスコア', '試験結果を見る', 'マイページ', '受験履歴',
      '我的成绩', '我的考试结果', '个人中心', '我的记录',
      'मेरा स्कोर', 'मेरे परीक्षा परिणाम', 'माई पेज',
      'điểm của tôi', 'kết quả thi của tôi', 'trang cá nhân', 'lịch sử thi',
    ],
  },
  {
    dest: '/certificate', // 자격증 발급·확인·출력
    phrases: [
      '자격증 발급', '자격증 확인', '자격증 출력', '인증서 뽑기', '합격증 발급',
      '자격증 다운로드', '내 자격증 보기', '증명서 발급받기',
      'issue certificate', 'download my certificate', 'print certificate', 'view my certificate',
      '資格証発行', '証明書をダウンロード', '合格証',
      '证书发放', '下载证书', '打印证书', '我的证书',
      'प्रमाणपत्र जारी करें', 'प्रमाणपत्र डाउनलोड', 'मेरा प्रमाणपत्र',
      'cấp chứng chỉ', 'tải chứng chỉ', 'in chứng chỉ', 'chứng chỉ của tôi',
    ],
  },
  {
    dest: '/ranking', // 랭킹·순위·리더보드·명예의전당
    phrases: [
      '랭킹 보고싶어', '순위 확인', '리더보드', '누가 1등이야', '명예의 전당',
      '내 순위 어디', '상위권 보기', '순위표', '랭킹',
      'show me the ranking', 'leaderboard', 'who is number one', 'rankings', 'hall of fame', 'my rank',
      'ランキングを見たい', 'リーダーボード', '順位', '殿堂',
      '查看排名', '排行榜', '谁是第一', '名人堂',
      'रैंकिंग दिखाओ', 'लीडरबोर्ड', 'शीर्ष रैंक',
      'xem xếp hạng', 'bảng xếp hạng', 'ai đứng đầu', 'thứ hạng',
    ],
  },
  {
    dest: '/about', // 협회 소개·기관 정보
    phrases: [
      '협회 소개', '이 협회는 뭐지', '무슨 협회야', '기관 소개', '회사 소개',
      '여기 어디야', '협회 정보', 'GARA가 뭐야', '어떤 단체야', '무엇을 하는 곳이야',
      'about the association', 'what is this organization', 'about us', 'who are you', 'company info',
      '協会について', 'この団体は何', '会社概要', '私たちについて',
      '协会介绍', '这是什么机构', '关于我们', '公司简介',
      'संगठन के बारे में', 'यह कौन सा संगठन है', 'हमारे बारे में',
      'giới thiệu hiệp hội', 'đây là tổ chức gì', 'về chúng tôi',
    ],
  },
  {
    dest: '/notice', // 공지사항·소식
    phrases: [
      '공지사항', '공지 보고싶어', '새 소식', '안내사항', '점검 공지',
      '이벤트 소식', '업데이트 소식', '알림 확인',
      'notices', 'announcements', 'news', 'latest updates', 'maintenance notice',
      'お知らせ', '通知', '最新情報', 'メンテナンス案内',
      '公告', '通知', '最新消息', '维护公告',
      'सूचनाएं', 'घोषणाएं', 'ताज़ा खबर',
      'thông báo', 'tin tức', 'cập nhật mới',
    ],
  },
  {
    dest: '/faq', // 고객센터: 문의·환불·결제·시스템·채점·기업
    phrases: [
      '문의하고 싶어', '물어볼 게 있어', '고객센터', '환불 어떻게 해', '결제 문제',
      '도움이 필요해', '자주 묻는 질문', '시스템 오류', '채점 문의', '기업 단체 문의',
      '연락처 알려줘', '상담하고 싶어', '문의사항 있어', '문제가 생겼어',
      'I have a question', 'contact support', 'customer service', 'how to get a refund', 'payment issue',
      'I need help', 'faq', 'system error', 'corporate inquiry',
      '問い合わせたい', 'カスタマーサポート', '返金したい', '支払いの問題', '困っています',
      '我想咨询', '客服', '怎么退款', '支付问题', '需要帮助',
      'मुझे पूछताछ करनी है', 'ग्राहक सेवा', 'रिफंड कैसे लें', 'भुगतान समस्या', 'मदद चाहिए',
      'tôi muốn hỏi', 'chăm sóc khách hàng', 'hoàn tiền thế nào', 'vấn đề thanh toán', 'cần trợ giúp',
    ],
  },
  {
    dest: '/ebooks', // 이북(전자책): 구매·서재
    phrases: [
      '이북', '전자책', '이북 사고 싶어', '교재 사기', '책 구매', '전자 교재',
      '내 이북', '이북 서재', '구매한 책 어디서 봐', '교재 어디서 사',
      'ebook', 'e-book', 'buy an ebook', 'digital book', 'my ebook library', 'where can I read my book',
      '電子書籍', 'eBookを買いたい', '教材を買う', '購入した本はどこ',
      '电子书', '想买电子书', '教材购买', '我的电子书',
      'ईबुक', 'ईबुक खरीदना है', 'डिजिटल किताब', 'मेरी ईबुक',
      'sách điện tử', 'mua ebook', 'giáo trình điện tử', 'thư viện ebook của tôi',
    ],
  },
]

// 단건 임베딩(무료 티어 OK) + 429 백오프. recommend-level 과 동일 파라미터.
async function embedOne(text: string): Promise<number[]> {
  for (let attempt = 0; attempt < 4; attempt++) {
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
