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

// helper(임시 영역용): ko·en만 주고 나머지 언어는 ko 로 폴백. L7 콘텐츠 확정 시 ax() 로 교체.
function axd(key: string, ko: string, en: string, koS: string, enS: string): AxisRaw {
  return {
    key,
    label: { ko, en, ja: ko, zh: ko, hi: ko, vi: ko },
    short: { ko: koS, en: enS, ja: koS, zh: koS, hi: koS, vi: koS },
  }
}

// 2026-07: 사다리를 한 칸씩 밀었다(옛 L7 폐기 · 옛 1~6 → 2~7 · L1 신설).
//   축 코드도 같이 밀었다 — 옛 l1_principle = 지금 l2_principle. 옛 l7_* 는 폐기.
//   L1(신설)은 6축 미정이라 비워뒀다. L7(옛 L6)은 임시 축(ko·en 폴백).
const LEVEL_CATEGORIES_RAW: Record<number, AxisRaw[]> = {
  // 1: 신설 레벨 — 6축 미정(비워둠). 커리큘럼 확정되면 여기에 ax() 6개를 넣고
  //    _shared/scoring.ts 의 LEVEL_AXES[1] 과 testConfigLevel.ts 의 COMING_SOON_LEVELS 를 같이 갱신할 것.
  2: [
    ax('l2_principle',
      ['생성형 AI 기본 원리', 'Generative AI basics', '生成AIの基礎', '生成式AI原理', 'जनरेटिव AI मूल', 'Nguyên lý AI tạo sinh'],
      ['생성AI원리', 'GenAI basics', '生成AI基礎', '生成AI原理', 'जनरेटिव AI', 'AI tạo sinh']),
    ax('l2_security',
      ['AI 취약점·보안', 'AI vulnerabilities & security', 'AIの脆弱性・セキュリティ', 'AI漏洞·安全', 'AI सुरक्षा·जोखिम', 'Lỗ hổng & bảo mật AI'],
      ['취약점·보안', 'Security', '脆弱性・安全', '漏洞·安全', 'सुरक्षा', 'Bảo mật']),
    ax('l2_ethics',
      ['AI 윤리·편향', 'AI ethics & bias', 'AI倫理・バイアス', 'AI伦理·偏见', 'AI नैतिकता·पूर्वाग्रह', 'Đạo đức & thiên kiến AI'],
      ['윤리·편향', 'Ethics', '倫理・偏り', '伦理·偏见', 'नैतिकता', 'Đạo đức']),
    ax('l2_responsibility',
      ['AI 사회적 책임·규범', 'AI social responsibility', 'AIの社会的責任・規範', 'AI社会责任·规范', 'AI सामाजिक उत्तरदायित्व', 'Trách nhiệm xã hội AI'],
      ['책임·규범', 'Responsibility', '責任・規範', '责任·规范', 'उत्तरदायित्व', 'Trách nhiệm']),
    ax('l2_llm_eco',
      ['LLM 응용·생태계', 'LLM apps & ecosystem', 'LLM応用・エコシステム', 'LLM应用·生态', 'LLM अनुप्रयोग·पारितंत्र', 'Ứng dụng & hệ sinh thái LLM'],
      ['LLM생태계', 'LLM ecosystem', 'LLM生態系', 'LLM生态', 'LLM पारितंत्र', 'Hệ sinh thái LLM']),
    ax('l2_prompt',
      ['프롬프트 엔지니어링', 'Prompt engineering', 'プロンプトエンジニアリング', '提示词工程', 'प्रॉम्प्ट इंजीनियरिंग', 'Kỹ thuật prompt'],
      ['프롬프트', 'Prompt', 'プロンプト', '提示词', 'प्रॉम्प्ट', 'Prompt']),
  ],
  3: [
    ax('l3_genai',
      ['생성형 AI 중급', 'Generative AI (intermediate)', '生成AI中級', '生成式AI进阶', 'जनरेटिव AI मध्यम', 'AI tạo sinh trung cấp'],
      ['생성AI중급', 'GenAI mid', '生成AI中級', '生成AI进阶', 'जनरेटिव AI+', 'AI trung cấp']),
    ax('l3_api',
      ['생성형 AI API 호출', 'Generative AI API calls', '生成AI API呼び出し', '生成式AI API调用', 'जनरेटिव AI API कॉल', 'Gọi API AI tạo sinh'],
      ['API호출', 'API calls', 'API呼出', 'API调用', 'API कॉल', 'Gọi API']),
    ax('l3_algo',
      ['AI 알고리즘 기획', 'AI algorithm planning', 'AIアルゴリズム企画', 'AI算法规划', 'AI एल्गोरिद्म योजना', 'Thiết kế thuật toán AI'],
      ['알고리즘', 'Algorithm', 'アルゴリズム', '算法', 'एल्गोरिद्म', 'Thuật toán']),
    ax('l3_sensor',
      ['내장 센서 제어', 'Embedded sensor control', '内蔵センサー制御', '内置传感器控制', 'एम्बेडेड सेंसर नियंत्रण', 'Điều khiển cảm biến'],
      ['센서제어', 'Sensors', 'センサー制御', '传感器', 'सेंसर', 'Cảm biến']),
    ax('l3_block',
      ['블록코딩 논리', 'Block coding logic', 'ブロックコーディング論理', '积木编程逻辑', 'ब्लॉक कोडिंग तर्क', 'Logic lập trình khối'],
      ['블록코딩', 'Block coding', 'ブロック', '积木编程', 'ब्लॉक कोडिंग', 'Lập trình khối']),
    ax('l3_python',
      ['파이썬 기초', 'Python basics', 'Python基礎', 'Python基础', 'Python मूल बातें', 'Python cơ bản'],
      ['파이썬', 'Python', 'Python', 'Python', 'Python', 'Python']),
  ],
  4: [
    ax('l4_rag',
      ['RAG·검색 파이프라인', 'RAG & search pipeline', 'RAG・検索パイプライン', 'RAG·检索流水线', 'RAG·खोज पाइपलाइन', 'RAG & pipeline tìm kiếm'],
      ['RAG·검색', 'RAG·Search', 'RAG・検索', 'RAG·检索', 'RAG·खोज', 'RAG·Tìm kiếm']),
    ax('l4_llm_ctrl',
      ['LLM 활용·생성 제어', 'LLM usage & generation control', 'LLM活用・生成制御', 'LLM应用·生成控制', 'LLM उपयोग·जनन नियंत्रण', 'Dùng LLM & kiểm soát sinh'],
      ['생성제어', 'Gen control', '生成制御', '生成控制', 'जनन नियंत्रण', 'Kiểm soát sinh']),
    ax('l4_vision_eval',
      ['비전 인식·평가지표', 'Vision recognition & metrics', 'ビジョン認識・評価指標', '视觉识别·评估指标', 'विज़न पहचान·मेट्रिक्स', 'Nhận dạng thị giác & chỉ số'],
      ['비전평가', 'Vision eval', 'ビジョン評価', '视觉评估', 'विज़न मूल्यांकन', 'Đánh giá thị giác']),
    ax('l4_vision_data',
      ['비전 처리·데이터', 'Vision processing & data', 'ビジョン処理・データ', '视觉处理·数据', 'विज़न प्रोसेसिंग·डेटा', 'Xử lý thị giác & dữ liệu'],
      ['비전데이터', 'Vision data', 'ビジョンデータ', '视觉数据', 'विज़न डेटा', 'Dữ liệu thị giác']),
    ax('l4_c_basic',
      ['C 기초 문법·흐름', 'C basics & control flow', 'C基礎文法・制御', 'C基础语法·流程', 'C मूल वाक्य-विन्यास', 'Cú pháp C cơ bản'],
      ['C기초', 'C basics', 'C基礎', 'C基础', 'C मूल', 'C cơ bản']),
    ax('l4_c_adv',
      ['C 메모리·구조·고급', 'C memory & advanced', 'Cメモリ・構造・上級', 'C内存·结构·进阶', 'C मेमोरी·उन्नत', 'Bộ nhớ C & nâng cao'],
      ['C고급', 'C advanced', 'C上級', 'C进阶', 'C उन्नत', 'C nâng cao']),
  ],
  5: [
    ax('l5_preproc',
      ['물리적 AI 전처리', 'Physical AI preprocessing', 'フィジカルAI前処理', '物理AI预处理', 'भौतिक AI पूर्व-संसाधन', 'Tiền xử lý AI vật lý'],
      ['AI전처리', 'Preprocess', '前処理', '预处理', 'पूर्व-संसाधन', 'Tiền xử lý']),
    ax('l5_stm32',
      ['STM32 정밀제어', 'STM32 precision control', 'STM32精密制御', 'STM32精密控制', 'STM32 परिशुद्ध नियंत्रण', 'Điều khiển chính xác STM32'],
      ['STM32', 'STM32', 'STM32', 'STM32', 'STM32', 'STM32']),
    ax('l5_ros2',
      ['ROS2 시스템 통합', 'ROS2 system integration', 'ROS2システム統合', 'ROS2系统集成', 'ROS2 सिस्टम एकीकरण', 'Tích hợp hệ thống ROS2'],
      ['ROS2통합', 'ROS2', 'ROS2統合', 'ROS2集成', 'ROS2', 'ROS2']),
    ax('l5_plc',
      ['PLC 프로그래밍', 'PLC programming', 'PLCプログラミング', 'PLC编程', 'PLC प्रोग्रामिंग', 'Lập trình PLC'],
      ['PLC', 'PLC', 'PLC', 'PLC', 'PLC', 'PLC']),
    ax('l5_sim',
      ['공정 시뮬레이션', 'Process simulation', '工程シミュレーション', '工艺仿真', 'प्रक्रिया सिमुलेशन', 'Mô phỏng quy trình'],
      ['공정시뮬', 'Process sim', '工程シミュ', '工艺仿真', 'सिमुलेशन', 'Mô phỏng']),
    ax('l5_smartfactory',
      ['스마트공장', 'Smart factory', 'スマート工場', '智能工厂', 'स्मार्ट फैक्ट्री', 'Nhà máy thông minh'],
      ['스마트공장', 'Smart factory', 'スマート工場', '智能工厂', 'स्मार्ट फैक्ट्री', 'Nhà máy TM']),
  ],
  6: [
    ax('l6_reasoning',
      ['AI 지능·추론', 'AI intelligence & reasoning', 'AI知能・推論', 'AI智能·推理', 'AI बुद्धि·तर्क', 'Trí tuệ & suy luận AI'],
      ['지능·추론', 'Reasoning', '知能・推論', '智能·推理', 'तर्क', 'Suy luận']),
    ax('l6_edge',
      ['엣지 AI 컴퓨팅', 'Edge AI computing', 'エッジAIコンピューティング', '边缘AI计算', 'एज AI कंप्यूटिंग', 'Điện toán Edge AI'],
      ['엣지AI', 'Edge AI', 'エッジAI', '边缘AI', 'एज AI', 'Edge AI']),
    ax('l6_iiot',
      ['산업 IoT·데이터 연계', 'Industrial IoT & data', '産業IoT・データ連携', '工业物联网·数据', 'औद्योगिक IoT·डेटा', 'IoT công nghiệp & dữ liệu'],
      ['산업IoT', 'Industrial IoT', '産業IoT', '工业IoT', 'औद्योगिक IoT', 'IIoT']),
    ax('l6_dtwin',
      ['디지털 트윈·시뮬레이션', 'Digital twin & simulation', 'デジタルツイン・シミュ', '数字孪生·仿真', 'डिजिटल ट्विन·सिमुलेशन', 'Bản sao số & mô phỏng'],
      ['디지털트윈', 'Digital twin', 'デジタルツイン', '数字孪生', 'डिजिटल ट्विन', 'Digital twin']),
    ax('l6_sysopt',
      ['시스템 통합·제조 최적화', 'System integration & optimization', 'システム統合・製造最適化', '系统集成·制造优化', 'सिस्टम एकीकरण·अनुकूलन', 'Tích hợp & tối ưu sản xuất'],
      ['제조최적화', 'Optimization', '製造最適化', '制造优化', 'अनुकूलन', 'Tối ưu']),
    ax('l6_ros2',
      ['로봇 OS·제어(ROS2)', 'Robot OS & control (ROS2)', 'ロボットOS・制御(ROS2)', '机器人OS·控制(ROS2)', 'रोबोट OS·नियंत्रण (ROS2)', 'HĐH & điều khiển robot (ROS2)'],
      ['로봇제어', 'Robot control', 'ロボット制御', '机器人控制', 'रोबोट नियंत्रण', 'Điều khiển robot']),
  ],
  // L7 = 옛 L6(임시 영역). 다국어는 ko 폴백(콘텐츠 확정 시 ax()로 교체).
  7: [
    axd('l7_swarm', '군집 지능', 'Swarm intelligence', '군집지능', 'Swarm'),
    axd('l7_hrc', '인간-로봇 협업(HRC)', 'Human-robot collaboration', 'HRC', 'HRC'),
    axd('l7_dtwin', '디지털 트윈', 'Digital twin', '디지털트윈', 'Digital twin'),
    axd('l7_orchestration', 'AI 오케스트레이션', 'AI orchestration', '오케스트레이션', 'Orchestration'),
    axd('l7_process_opt', '지능형 공정 최적화', 'Intelligent process optimization', '공정최적화', 'Optimization'),
    axd('l7_robosec', '로보틱스 보안 및 사이버-물리 시스템', 'Robotics security & cyber-physical systems', '로보틱스 보안', 'Robot security'),
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

// 시험이 정의된(=문제은행이 있는) 레벨. L1(신설)·L7 은 임시 영역으로 존재(콘텐츠 추후).
export const MIN_LEVEL = 1
export const MAX_LEVEL = 7
