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
// 시드 임베딩 키 = 검색창(route-query)이 쓰는 GEMINI_API_KEY. 시드와 라이브 검색은 같은 route_cache 를
// 채우는 한 몸이라 같은 키로 통일. 임베딩 벡터는 모델(001)만 같으면 키와 무관하게 동일 → 기존 시드와 호환.
// (이전엔 TEST_GENERATE 로 분리했으나 그 키는 KB 파이프라인과 공유라 재시드 시 소진됨 → 검색창 본키로 회귀.)
const EMBED_KEY = GEMINI_API_KEY
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
    // ⚠️ 제품 브랜드명(WORLD ARENA·CARIS ARENA)은 아레나 허브 '/arena' 가 가져간다.
    //    여기(/test/select)는 "지금 응시하겠다" 의도만.
    dest: '/arena', // WORLD ARENA 허브: 세계지도·세계리그·지역랭킹·채팅
    phrases: [
      // 현재 제품명
      '월드 아레나', 'WORLD ARENA', '월드아레나', '아레나', '아레나 보고싶어', '아레나 가고싶어', 'world arena', 'world-arena',
      // 옛 이름(CARIS ARENA·SEMI-CARIS) — 예전 이름으로 검색해도 찾아지게 유지
      '카리스 아레나', 'CARIS ARENA', '카리스아레나', 'caris arena', 'caris-arena',
      // 지도·리그·지역 경쟁
      '세계 리그', '세계리그 보고싶어', '지역 랭킹', '우리 지역 순위', '우리 나라 순위', '국가별 순위', '지역 대항전',
      '세계 지도', '지도 보고싶어', '지도에서 순위 보기', '어느 나라가 제일 잘해', '아레나 채팅', '다른 지역이랑 비교',
      'world league', 'regional ranking', 'country ranking', 'ranking by region', 'world map', 'see the map',
      'which country is the best', 'arena chat', 'how does my region rank',
      'ワールドアリーナ', 'アリーナ', '世界リーグ', '地域ランキング', '国別ランキング', '世界地図', '地図を見たい', 'アリーナチャット',
      '世界竞技场', '竞技场', '世界联赛', '地区排名', '国家排名', '世界地图', '想看地图',
      'वर्ल्ड एरिना', 'एरिना', 'वर्ल्ड लीग', 'क्षेत्रीय रैंकिंग', 'विश्व मानचित्र',
      'đấu trường thế giới', 'đấu trường', 'giải thế giới', 'xếp hạng khu vực', 'bản đồ thế giới', 'xem bản đồ',
    ],
  },
  {
    dest: '/hub', // 캐릭터 허브: 캐릭터·아바타·코인·가챠·상점·출석
    phrases: [
      '캐릭터 허브', '허브', '로비', '내 캐릭터', '캐릭터 보기', '캐릭터 꾸미기', '아바타 바꾸기', '아바타 변경',
      '프로필 사진 바꾸기', '젬 색 바꾸기', '가챠', '뽑기', '가챠 뽑기', '뽑기 하고싶어',
      '코인', '내 코인', '코인 얼마 있지', '상점', '코인 상점', '아이템 사기', '출석체크', '출석', '오늘 출석했나',
      'character hub', 'my character', 'change my avatar', 'avatar', 'customize character',
      'gacha', 'draw a gacha', 'coins', 'my coins', 'shop', 'buy items', 'attendance', 'daily check-in', 'lobby',
      'キャラクターハブ', 'マイキャラ', 'アバター変更', 'ガチャ', 'ガチャを引く', 'コイン', 'ショップ', 'アイテム購入', '出席チェック', 'ロビー',
      '角色中心', '我的角色', '更换头像', '抽卡', '金币', '我的金币', '商店', '购买道具', '签到', '大厅',
      'कैरेक्टर हब', 'मेरा कैरेक्टर', 'अवतार बदलें', 'गाचा', 'सिक्के', 'दुकान', 'उपस्थिति',
      'trung tâm nhân vật', 'nhân vật của tôi', 'đổi ảnh đại diện', 'quay gacha', 'xu của tôi', 'cửa hàng', 'điểm danh',
    ],
  },
  {
    dest: '/games', // 미니게임 목록 (개별 게임은 /games/:id)
    phrases: [
      // ⚠️ '놀거리'·'재밌는 거 없나'·'fun stuff' 같은 포괄어는 앵커 금지 — 무관한 잡담까지 빨아들인다
      //    (/daily 의 열린 질문 프레임 사고와 같은 부류. 위 /daily 주석 참고).
      '미니게임', '미니게임 하고싶어', '게임', '게임하고싶어', '게임 목록', '무슨 게임 있어', '게임 종류',
      '버텨라 카리', '쏴라 카리', '골라라 카리', '닿아라 카리', '프로그램해라 카리', '지어라 카리',
      'AI 용어 게임', '로봇 용어 게임', '게임으로 공부', '로봇팔 게임', '코딩 게임', '블록 코딩', '스마트팩토리 게임',
      'mini games', 'minigame', 'play a game', 'games', 'game list', 'what games are there', 'AI terms game', 'game menu',
      'ミニゲーム', 'ゲームしたい', 'ゲーム一覧', '遊びたい', 'ゲームで学ぶ',
      '小游戏', '想玩游戏', '游戏列表', '玩游戏', '有什么游戏',
      'मिनी गेम', 'गेम खेलना है', 'गेम्स', 'कौन से गेम हैं',
      'trò chơi nhỏ', 'muốn chơi game', 'danh sách trò chơi', 'có trò chơi gì',
    ],
  },
  {
    dest: '/daily', // 오늘의 학습·오늘의 문제
    // ⚠️ **열린 질문 프레임 금지**(2026-07-24 실측): "오늘 뭐 배워"·"what should I learn today"·
    //    "今天学什么"·"hôm nay học gì" 류를 앵커로 깔았더니 임베딩이 **언어를 넘어** 매칭해서
    //    "오늘 점심 뭐먹지" 같은 완전 무관한 입력까지 sim≥0.85 로 /daily 에 빨려들어갔다.
    //    (한국어 앵커를 전부 지워도 재현됨 = 교차언어 매칭이 원인.) 명사구 위주로만 깔 것.
    //    이 표현들은 LLM 분류기 프롬프트가 이미 커버하므로 앵커 없이도 라우팅된다.
    phrases: [
      '오늘의 학습', '오늘의 문제', '데일리', '데일리 미션', '데일리 콘텐츠', '오늘의 콘텐츠',
      '매일 학습', '하루 한 문제', '오늘의 퀴즈',
      "today's lesson", 'daily learning', "today's problem", 'daily content', 'daily mission', 'daily quiz',
      '今日の学習', '今日の問題', 'デイリー', '毎日の学習', '今日のクイズ',
      '今日学习', '今日一题', '每日内容', '每日任务',
      'आज की पढ़ाई', 'आज की समस्या', 'दैनिक सामग्री',
      'bài học hôm nay', 'bài toán hôm nay', 'nội dung hằng ngày',
    ],
  },
  {
    dest: '/test/select', // 지금 무료 레벨 진단을 응시(레벨 선택 화면)
    phrases: [
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
    dest: '/exam/apply', // 원서접수(회차 미지정이면 접수중 회차로 폴백) — 예전엔 /guide 로 우회시켰다
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
      '公告', '最新消息', '维护公告', '查看公告',
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
    dest: '/ebooks', // 이북(전자책) 스토어 = 사러 가기. 이미 산 책 읽기는 아래 /mypage/ebooks.
    phrases: [
      '이북', '전자책', '이북 사고 싶어', '교재 사기', '책 구매', '전자 교재', '교재 어디서 사', '이북 스토어',
      'ebook', 'e-book', 'buy an ebook', 'digital book', 'ebook store', 'where to buy textbooks',
      '電子書籍', 'eBookを買いたい', '教材を買う', '電子書籍ストア',
      '电子书', '想买电子书', '教材购买', '电子书商店',
      'ईबुक', 'ईबुक खरीदना है', 'डिजिटल किताब', 'ईबुक स्टोर',
      'sách điện tử', 'mua ebook', 'giáo trình điện tử', 'cửa hàng ebook',
    ],
  },
  {
    dest: '/mypage/ebooks', // 이미 구매한 이북을 읽는 곳(마이페이지 '이북 서재' 탭)
    phrases: [
      '내 이북', '이북 서재', '내 서재', '구매한 책 어디서 봐', '산 책 읽기', '구매한 이북 읽기', '내가 산 교재',
      '결제한 책 어디 있어', '구매한 교재 보기',
      'my ebook library', 'where can I read my book', 'my purchased ebooks', 'read my ebook', 'my bookshelf',
      '私の電子書籍', '購入した本はどこ', '本棚', '買った本を読む',
      '我的电子书', '购买的书在哪看', '书架', '阅读已购图书',
      'मेरी ईबुक', 'मेरी खरीदी किताबें', 'मेरी किताबें कहाँ पढ़ें',
      'thư viện ebook của tôi', 'sách đã mua ở đâu', 'đọc sách đã mua',
    ],
  },
  {
    dest: '/login', // 로그인
    phrases: [
      '로그인', '로그인하기', '구글 로그인', '로그아웃', '계정 접속', '가입하고 싶어', '회원가입',
      'log in', 'login', 'sign in', 'google login', 'sign up', 'create an account',
      'ログイン', 'グーグルログイン', 'ログアウト', 'アカウント',
      '登录', '谷歌登录', '退出登录', '注册',
      'लॉग इन', 'गूगल लॉगिन', 'खाता बनाएं',
      'đăng nhập', 'đăng nhập google', 'đăng xuất', 'tạo tài khoản',
    ],
  },
  {
    dest: '/terms', // 이용약관
    phrases: [
      '이용약관', '약관', '서비스 약관', '약관 보고싶어', '이용 규정', '회원 약관', '약관 어디 있어',
      'terms of service', 'terms', 'terms and conditions', 'user agreement', 'where are the terms',
      '利用規約', '規約', '会員規約', '規約はどこ',
      '服务条款', '使用条款', '用户协议', '条款在哪',
      'सेवा की शर्तें', 'नियम और शर्तें', 'उपयोगकर्ता समझौता',
      'điều khoản dịch vụ', 'điều khoản sử dụng', 'thỏa thuận người dùng',
    ],
  },
  {
    dest: '/privacy', // 개인정보처리방침
    phrases: [
      '개인정보처리방침', '개인정보', '프라이버시', '개인정보 보호', '내 정보 어떻게 쓰여', '정보 수집 범위',
      'privacy policy', 'privacy', 'personal data', 'how is my data used',
      'プライバシーポリシー', '個人情報', '個人情報の取り扱い',
      '隐私政策', '个人信息', '个人信息保护',
      'गोपनीयता नीति', 'व्यक्तिगत जानकारी',
      'chính sách bảo mật', 'thông tin cá nhân',
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
    // 429 때 어느 한도인지(quotaId: …PerDay… vs …PerMinute…)와 retryDelay 를 봐야 판단이 되므로
    // 넉넉히 남긴다. 내부 도구(x-seed-key 가드)라 상세 노출 부담 없음.
    throw new Error(`임베딩 실패 (${res.status}): ${detail.slice(0, 900)}`)
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
