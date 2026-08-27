// 레이더 차트 축 = AI 활용능력 카테고리.
// ★ 레벨마다 6축 세트가 다르다(레벨별 독립). 문제(questions.category)는 그 레벨의 6축 코드 중 하나로 태깅된다.
// 라벨은 6개국어(ko·en·ja·zh·hi·vi). 응시/화면 언어로 현지화해서 사용한다.

export type LangKey = 'ko' | 'en' | 'ja' | 'zh' | 'hi' | 'vi'
type L6 = Record<LangKey, string>

interface AxisRaw {
  key: string // 전역 유일 코드 (예: l3_rag)
  label: L6 // 풀 라벨
  short: L6 // 레이더 축에 박히는 짧은 라벨
}

// 현지화된 축 정의(컴포넌트가 받는 형태)
export interface AxisDef {
  key: string
  label: string
  short: string
}

// helper: 라벨 6개국어 + 짧은 라벨 6개국어
function ax(
  key: string,
  l: [string, string, string, string, string, string],
  s: [string, string, string, string, string, string],
): AxisRaw {
  const m = (a: string[]): L6 => ({ ko: a[0], en: a[1], ja: a[2], zh: a[3], hi: a[4], vi: a[5] })
  return { key, label: m(l), short: m(s) }
}

// 2026-07: 사다리를 한 칸씩 밀었다(옛 L7 폐기 · 옛 1~6 → 2~7 · L1 신설).
//   축 코드도 같이 밀었다 — 옛 l1_principle = 지금 l2_principle. 옛 l7_* 는 폐기.
//
// 2026-08-27: **두 번째 밀기 — 옛 2~5 → 3~6.** L1 은 그대로, L7 도 그대로(축 용어만 다듬고 6개국어를 채웠다).
//   축 코드도 같이 밀었다 — 옛 l2_principle = 지금 l3_principle · 옛 l5_ros2 = 지금 l6_ros2.
//   ⚠️ **Lv.2 는 지금 비어 있다**(축 0개·문항 0개). 새 문항이 들어올 때까지 testConfigLevel.ts 의
//      COMING_SOON_LEVELS 가 '오픈 예정'으로 잠가둔다 — 문항을 넣을 때 여기 6축을 먼저 정의할 것.
//   ⚠️ 옛 L6 축(l6_reasoning·l6_edge·l6_iiot·l6_dtwin·l6_sysopt)은 여기서 사라졌다. 그 코드를 단
//      옛 문항 63개는 전부 삭제 상태로 DB 에 남아 있어(관리자 '문항 이력' 탭) 라벨 대신 코드가 그대로 뜬다.
//      옛 l6_ros2 는 새 l6_ros2(옛 l5_ros2)와 코드가 겹쳐 새 라벨('ROS2 시스템 통합')로 보인다.
//   ⚠️ 시험 규격 경계도 같이 밀렸다(scoring.ts) — 4지선다 Lv.1~4 · 5지선다 Lv.5~7,
//      문항 수 10/20/30 의 경계도 Lv.1 · Lv.2~4 · Lv.5~7. 옛 L3 문항은 보기가 4개뿐이라 경계를 안 밀면 깨진다.
const LEVEL_CATEGORIES_RAW: Record<number, AxisRaw[]> = {
  // ★ Lv.1(입문)만 3축이다(다른 레벨은 6축). 축 수가 다르면 아래 두 곳이 같이 반응한다:
  //    · 출제 = QUESTIONS_PER_TEST 를 축 수로 나눠 균등 배분(3축 → 6개씩 + 랜덤 2축 +1 = 20) — start-test/index.ts
  //    · 결과 레이더 = 3축 미만이면 막대 그래프로 대체 — components/RadarChartBox.tsx
  //      (2026-07-27 l1_problem 추가로 3축이 되어 Lv.1 도 이제 레이더(삼각형)로 그려진다)
  1: [
    ax('l1_prompt',
      ['AI 프롬프트 활용', 'Using AI prompts', 'AIプロンプト活用', 'AI提示词运用', 'AI प्रॉम्प्ट उपयोग', 'Sử dụng prompt AI'],
      ['프롬프트활용', 'Prompts', 'プロンプト', '提示词', 'प्रॉम्प्ट', 'Prompt']),
    ax('l1_tools',
      ['AI 도구 이해', 'Understanding AI tools', 'AIツールの理解', 'AI工具理解', 'AI उपकरण समझ', 'Hiểu công cụ AI'],
      ['도구이해', 'AI tools', 'AIツール', 'AI工具', 'AI उपकरण', 'Công cụ AI']),
    ax('l1_problem',
      ['AI를 활용한 문제해결', 'Problem solving with AI', 'AIを活用した問題解決', '运用AI解决问题', 'AI से समस्या समाधान', 'Giải quyết vấn đề bằng AI'],
      ['문제해결', 'Problem solving', '問題解決', '问题解决', 'समस्या समाधान', 'Giải quyết vấn đề']),
  ],
  // Lv.2 = 빈 레벨(2026-08-27 밀기로 비었다). 새 문항을 넣기 전에 여기 6축을 정의할 것 —
  //   축이 없으면 관리자 업로드가 category 를 전부 거절하고(admin-test/handlers/questions.ts),
  //   start-test 는 '해당 레벨의 문제가 없습니다.' 로 400 을 낸다.
  2: [],
  3: [
    ax('l3_principle',
      ['생성형 AI 기본 원리', 'Generative AI basics', '生成AIの基礎', '生成式AI原理', 'जनरेटिव AI मूल', 'Nguyên lý AI tạo sinh'],
      ['생성AI원리', 'GenAI basics', '生成AI基礎', '生成AI原理', 'जनरेटिव AI', 'AI tạo sinh']),
    ax('l3_security',
      ['AI 취약점·보안', 'AI vulnerabilities & security', 'AIの脆弱性・セキュリティ', 'AI漏洞·安全', 'AI सुरक्षा·जोखिम', 'Lỗ hổng & bảo mật AI'],
      ['취약점·보안', 'Security', '脆弱性・安全', '漏洞·安全', 'सुरक्षा', 'Bảo mật']),
    ax('l3_ethics',
      ['AI 윤리·편향', 'AI ethics & bias', 'AI倫理・バイアス', 'AI伦理·偏见', 'AI नैतिकता·पूर्वाग्रह', 'Đạo đức & thiên kiến AI'],
      ['윤리·편향', 'Ethics', '倫理・偏り', '伦理·偏见', 'नैतिकता', 'Đạo đức']),
    ax('l3_responsibility',
      ['AI 사회적 책임·규범', 'AI social responsibility', 'AIの社会的責任・規範', 'AI社会责任·规范', 'AI सामाजिक उत्तरदायित्व', 'Trách nhiệm xã hội AI'],
      ['책임·규범', 'Responsibility', '責任・規範', '责任·规范', 'उत्तरदायित्व', 'Trách nhiệm']),
    ax('l3_llm_eco',
      ['LLM 응용·생태계', 'LLM apps & ecosystem', 'LLM応用・エコシステム', 'LLM应用·生态', 'LLM अनुप्रयोग·पारितंत्र', 'Ứng dụng & hệ sinh thái LLM'],
      ['LLM생태계', 'LLM ecosystem', 'LLM生態系', 'LLM生态', 'LLM पारितंत्र', 'Hệ sinh thái LLM']),
    ax('l3_prompt',
      ['프롬프트 엔지니어링', 'Prompt engineering', 'プロンプトエンジニアリング', '提示词工程', 'प्रॉम्प्ट इंजीनियरिंग', 'Kỹ thuật prompt'],
      ['프롬프트', 'Prompt', 'プロンプト', '提示词', 'प्रॉम्प्ट', 'Prompt']),
  ],
  4: [
    ax('l4_genai',
      ['생성형 AI 중급', 'Generative AI (intermediate)', '生成AI中級', '生成式AI进阶', 'जनरेटिव AI मध्यम', 'AI tạo sinh trung cấp'],
      ['생성AI중급', 'GenAI mid', '生成AI中級', '生成AI进阶', 'जनरेटिव AI+', 'AI trung cấp']),
    ax('l4_api',
      ['생성형 AI API 호출', 'Generative AI API calls', '生成AI API呼び出し', '生成式AI API调用', 'जनरेटिव AI API कॉल', 'Gọi API AI tạo sinh'],
      ['API호출', 'API calls', 'API呼出', 'API调用', 'API कॉल', 'Gọi API']),
    ax('l4_algo',
      ['AI 알고리즘 기획', 'AI algorithm planning', 'AIアルゴリズム企画', 'AI算法规划', 'AI एल्गोरिद्म योजना', 'Thiết kế thuật toán AI'],
      ['알고리즘', 'Algorithm', 'アルゴリズム', '算法', 'एल्गोरिद्म', 'Thuật toán']),
    ax('l4_sensor',
      ['내장 센서 제어', 'Embedded sensor control', '内蔵センサー制御', '内置传感器控制', 'एम्बेडेड सेंसर नियंत्रण', 'Điều khiển cảm biến'],
      ['센서제어', 'Sensors', 'センサー制御', '传感器', 'सेंसर', 'Cảm biến']),
    ax('l4_block',
      ['블록코딩 논리', 'Block coding logic', 'ブロックコーディング論理', '积木编程逻辑', 'ब्लॉक कोडिंग तर्क', 'Logic lập trình khối'],
      ['블록코딩', 'Block coding', 'ブロック', '积木编程', 'ब्लॉक कोडिंग', 'Lập trình khối']),
    ax('l4_python',
      ['파이썬 기초', 'Python basics', 'Python基礎', 'Python基础', 'Python मूल बातें', 'Python cơ bản'],
      ['파이썬', 'Python', 'Python', 'Python', 'Python', 'Python']),
  ],
  5: [
    ax('l5_rag',
      ['RAG·검색 파이프라인', 'RAG & search pipeline', 'RAG・検索パイプライン', 'RAG·检索流水线', 'RAG·खोज पाइपलाइन', 'RAG & pipeline tìm kiếm'],
      ['RAG·검색', 'RAG·Search', 'RAG・検索', 'RAG·检索', 'RAG·खोज', 'RAG·Tìm kiếm']),
    ax('l5_llm_ctrl',
      ['LLM 활용·생성 제어', 'LLM usage & generation control', 'LLM活用・生成制御', 'LLM应用·生成控制', 'LLM उपयोग·जनन नियंत्रण', 'Dùng LLM & kiểm soát sinh'],
      ['생성제어', 'Gen control', '生成制御', '生成控制', 'जनन नियंत्रण', 'Kiểm soát sinh']),
    ax('l5_vision_eval',
      ['비전 인식·평가지표', 'Vision recognition & metrics', 'ビジョン認識・評価指標', '视觉识别·评估指标', 'विज़न पहचान·मेट्रिक्स', 'Nhận dạng thị giác & chỉ số'],
      ['비전평가', 'Vision eval', 'ビジョン評価', '视觉评估', 'विज़न मूल्यांकन', 'Đánh giá thị giác']),
    ax('l5_vision_data',
      ['비전 처리·데이터', 'Vision processing & data', 'ビジョン処理・データ', '视觉处理·数据', 'विज़न प्रोसेसिंग·डेटा', 'Xử lý thị giác & dữ liệu'],
      ['비전데이터', 'Vision data', 'ビジョンデータ', '视觉数据', 'विज़न डेटा', 'Dữ liệu thị giác']),
    ax('l5_c_basic',
      ['C 기초 문법·흐름', 'C basics & control flow', 'C基礎文法・制御', 'C基础语法·流程', 'C मूल वाक्य-विन्यास', 'Cú pháp C cơ bản'],
      ['C기초', 'C basics', 'C基礎', 'C基础', 'C मूल', 'C cơ bản']),
    ax('l5_c_adv',
      ['C 메모리·구조·고급', 'C memory & advanced', 'Cメモリ・構造・上級', 'C内存·结构·进阶', 'C मेमोरी·उन्नत', 'Bộ nhớ C & nâng cao'],
      ['C고급', 'C advanced', 'C上級', 'C进阶', 'C उन्नत', 'C nâng cao']),
  ],
  6: [
    ax('l6_preproc',
      ['물리적 AI 전처리', 'Physical AI preprocessing', 'フィジカルAI前処理', '物理AI预处理', 'भौतिक AI पूर्व-संसाधन', 'Tiền xử lý AI vật lý'],
      ['AI전처리', 'Preprocess', '前処理', '预处理', 'पूर्व-संसाधन', 'Tiền xử lý']),
    ax('l6_stm32',
      ['STM32 정밀제어', 'STM32 precision control', 'STM32精密制御', 'STM32精密控制', 'STM32 परिशुद्ध नियंत्रण', 'Điều khiển chính xác STM32'],
      ['STM32', 'STM32', 'STM32', 'STM32', 'STM32', 'STM32']),
    ax('l6_ros2',
      ['ROS2 시스템 통합', 'ROS2 system integration', 'ROS2システム統合', 'ROS2系统集成', 'ROS2 सिस्टम एकीकरण', 'Tích hợp hệ thống ROS2'],
      ['ROS2통합', 'ROS2', 'ROS2統合', 'ROS2集成', 'ROS2', 'ROS2']),
    ax('l6_plc',
      ['PLC 프로그래밍', 'PLC programming', 'PLCプログラミング', 'PLC编程', 'PLC प्रोग्रामिंग', 'Lập trình PLC'],
      ['PLC', 'PLC', 'PLC', 'PLC', 'PLC', 'PLC']),
    ax('l6_sim',
      ['공정 시뮬레이션', 'Process simulation', '工程シミュレーション', '工艺仿真', 'प्रक्रिया सिमुलेशन', 'Mô phỏng quy trình'],
      ['공정시뮬', 'Process sim', '工程シミュ', '工艺仿真', 'सिमुलेशन', 'Mô phỏng']),
    ax('l6_smartfactory',
      ['스마트공장', 'Smart factory', 'スマート工場', '智能工厂', 'स्मार्ट फैक्ट्री', 'Nhà máy thông minh'],
      ['스마트공장', 'Smart factory', 'スマート工場', '智能工厂', 'स्मार्ट फैक्ट्री', 'Nhà máy TM']),
  ],
  // L7 = 최종 단계. 2026-08-27 에 임시 축(ko·en 만 있고 나머지는 한국어 폴백)에서 6개국어로 채우고 용어를 다듬었다.
  //   ⚠️ 축 **코드(l7_*)는 그대로 둔다** — 문항 95개가 이 코드로 태깅돼 있다. 바꾸면 전부 미아가 된다.
  7: [
    ax('l7_swarm',
      ['군집 지능', 'Swarm intelligence', '群知能', '群体智能', 'स्वार्म इंटेलिजेंस', 'Trí tuệ bầy đàn'],
      ['군집지능', 'Swarm', '群知能', '群体智能', 'स्वार्म', 'Bầy đàn']),
    ax('l7_hrc',
      ['인간-로봇 협업', 'Human-robot collaboration', '人間-ロボット協働', '人机协作', 'मानव-रोबोट सहयोग', 'Cộng tác người-robot'],
      ['인간-로봇협업', 'HRC', '人・ロボット協働', '人机协作', 'मानव-रोबोट', 'Người-robot']),
    ax('l7_dtwin',
      ['디지털 트윈', 'Digital twin', 'デジタルツイン', '数字孪生', 'डिजिटल ट्विन', 'Bản sao số'],
      ['디지털트윈', 'Digital twin', 'デジタルツイン', '数字孪生', 'डिजिटल ट्विन', 'Bản sao số']),
    ax('l7_orchestration',
      ['AI 오케스트레이션', 'AI orchestration', 'AIオーケストレーション', 'AI 编排', 'AI ऑर्केस्ट्रेशन', 'Điều phối AI'],
      ['오케스트레이션', 'Orchestration', 'オーケストレーション', 'AI编排', 'ऑर्केस्ट्रेशन', 'Điều phối']),
    ax('l7_process_opt',
      ['지능형 공정 최적화', 'Intelligent process optimization', '知能型工程最適化', '智能工艺优化', 'बुद्धिमान प्रक्रिया अनुकूलन', 'Tối ưu quy trình thông minh'],
      ['공정최적화', 'Optimization', '工程最適化', '工艺优化', 'प्रक्रिया अनुकूलन', 'Tối ưu quy trình']),
    ax('l7_robosec',
      ['로보틱스 보안·사이버물리 시스템', 'Robotics security & cyber-physical systems', 'ロボティクスセキュリティ・CPS', '机器人安全·信息物理系统', 'रोबोटिक्स सुरक्षा·साइबर-भौतिक प्रणाली', 'Bảo mật robot & hệ thống thực-ảo'],
      ['로보틱스보안', 'Robot security', 'ロボットセキュリティ', '机器人安全', 'रोबोटिक्स सुरक्षा', 'Bảo mật robot']),
  ],
}

// 카테고리 코드는 레벨별 텍스트 코드. 타입은 string.
export type CategoryKey = string

function pick(m: L6, lang: string): string {
  return m[(lang as LangKey)] ?? m.ko
}
function resolve(a: AxisRaw, lang: string): AxisDef {
  return { key: a.key, label: pick(a.label, lang), short: pick(a.short, lang) }
}

// 그 레벨의 6축 정의(언어 현지화). 없는 레벨이면 빈 배열.
export function axesForLevel(level: number, lang: string = 'ko'): AxisDef[] {
  return (LEVEL_CATEGORIES_RAW[level] ?? []).map((a) => resolve(a, lang))
}

// 그 레벨의 6축 코드(언어 무관)
export function axisKeysForLevel(level: number): string[] {
  return (LEVEL_CATEGORIES_RAW[level] ?? []).map((a) => a.key)
}

const AXIS_BY_KEY: Record<string, AxisRaw> = Object.fromEntries(
  Object.values(LEVEL_CATEGORIES_RAW).flat().map((a) => [a.key, a]),
)

// 코드로 축 정의 찾기(언어 현지화). 못 찾으면 코드 자체를 라벨로.
export function axisDef(key: string, lang: string = 'ko'): AxisDef {
  const a = AXIS_BY_KEY[key]
  return a ? resolve(a, lang) : { key, label: key, short: key }
}

// 시험이 정의된(=문제은행이 있는) 레벨. L2 는 2026-08-27 밀기로 비었다(축·문항 모두 미정).
export const MIN_LEVEL = 1
export const MAX_LEVEL = 7
