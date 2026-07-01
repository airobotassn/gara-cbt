// CARIS 자격 체계 데이터 — Guide(안내)와 ExamApply(원서접수)가 공유.
// 1차: 한국어 단일 · 응시료는 임시 예시값 — 디자인/정책 확정 후 i18n·실가격 반영.
//
// 결제 단위 차이(중요):
//   · Pro    = 시험 1개(단일 응시료). 취득 점수에 따라 4급~1급 차등 부여 → 급수별 결제 아님(examFee).
//   · Master = 급수별 별도 시험(순차). 급수마다 응시료 다름 → Level.fee.

export type Level = {
  grade: string
  tag?: string // Pro: 대상
  prereq?: string // Master: 응시 자격(선행 급수)
  method?: string // Master: 검정 방법(필기/실기)
  subjects: string[]
  practical?: string // Master: 실기 내용
  pass: string
  fee?: number // Master: 급수별 응시료(원) — 임시 예시값
}

export type Track = {
  key: string
  name: string
  tagline: string
  eligibility: string
  icon: string
  caption: string
  format?: string // Pro: 공통 시험 구성
  formatSub?: string
  examFee?: number // Pro: 단일 시험 응시료(급수는 점수로 판정) — 임시 예시값
  levels: Level[]
}

export const TRACKS: Track[] = [
  {
    key: 'pro',
    name: 'CARIS Pro',
    tagline: '전국민 AI·Robot 리터러시',
    eligibility: '응시 자격 제한 없음',
    icon: 'school',
    caption: '한 번의 필기시험으로, 취득 점수에 따라 4급~1급을 차등 부여합니다.',
    format: '총 80문항 · 60분',
    formatSub: '객관식 70 · 단답형 8 · 서술형 2',
    examFee: 30000,
    levels: [
      { grade: '4급', tag: '전 국민 입문 · 기초 소양', subjects: ['생성형 AI의 일상 활용', '인공지능 윤리 및 안전한 디지털 도구 활용'], pass: '60점 이상' },
      { grade: '3급', tag: '중·고등학생 및 직장인 기초', subjects: ['스마트 도구 활용 및 프롬프트', '일상 속 로봇 및 자동화 기술'], pass: '70점 이상' },
      { grade: '2급', tag: '대학생 및 직장인 중급', subjects: ['피지컬 AI 블록코딩 및 논리 제어', '에지 디바이스와 데이터 수집·처리 기초'], pass: '80점 이상' },
      { grade: '1급', tag: '관리자·강사 및 전문가 과정 진입', subjects: ['AI·Robot 기술 트렌드 및 산업 적용 기획', 'AI·Robot 융합 서비스 시나리오 설계'], pass: '90점 이상' },
    ],
  },
  {
    key: 'master',
    name: 'CARIS Master',
    tagline: '피지컬 AI 전문가 과정',
    eligibility: '하위급 순차 취득 원칙',
    icon: 'workspace_premium',
    caption: 'CARIS Pro 1급 취득 후, Master 4급부터 하위급 순차 응시 원칙입니다.',
    levels: [
      { grade: '4급', prereq: 'CARIS Pro 1급 취득자', method: '필기 객50+주10 / 60분 · 실기 PC작업형 / 120분', subjects: ['AI 서비스 개발을 위한 SW 스택 이해', 'AI 통합을 위한 로봇·임베디드 HW 이해'], practical: '기초 AI API + 단일 로봇 제어 코딩', pass: '필기 60점↑ (과목별 40↑) · 실기 70점↑', fee: 80000 },
      { grade: '3급', prereq: 'CARIS Master 4급 취득자', method: '필기 객50+주10 / 60분 · 실기 PC작업형 / 120분', subjects: ['온디바이스 AI 모델 경량화 및 에지 배포 실무', 'AI 기반 멀티모달 센서 융합 및 지능형 제어 적용'], practical: 'Python/C++ 코드 및 LLM 연동', pass: '필기 60점↑ (과목별 40↑) · 실기 70점↑', fee: 100000 },
      { grade: '2급', prereq: 'CARIS Master 3급 취득자', method: '필기 객30+주10 / 60분 · 실기 복합작업형 / 120분', subjects: ['AI 연동 디지털 트윈 설계 및 시뮬레이션 검증', 'AI·Robot 융합 시스템 아키텍처 설계'], practical: 'Isaac Sim·Gazebo 기반 자율주행·AI 비전 파이프라인 구축·최적화', pass: '필기 60점↑ (과목별 40↑) · 실기 70점↑', fee: 120000 },
      { grade: '1급', prereq: 'CARIS Master 2급 취득자', method: '실기 포트폴리오 제출 + 심층 면접 / 30분', subjects: ['AI·Robot 솔루션 시스템 통합 및 프로젝트 관리', '국제표준(ISO 10218·IEC 62443·ISO/IEC 42001) 및 기능안전 적용'], pass: '루브릭 심사 · 심사위원 평균 80점 이상', fee: 150000 },
    ],
  },
]

export type Round = { id: string; roundKey: string; dateKey: string; open: boolean }

export const SCHEDULE: Round[] = [
  { id: 'r4', roundKey: 'guide.sched_r4_round', dateKey: 'guide.sched_r4_date', open: true },
  { id: 'r5', roundKey: 'guide.sched_r5_round', dateKey: 'guide.sched_r5_date', open: false },
  { id: 'r1_2027', roundKey: 'guide.sched_r1_round', dateKey: 'guide.sched_r1_date', open: false },
]

// 상시시험 — 회차와 무관하게 연중 접수(예약 응시). 1차 한국어 단일.
export type Rolling = { id: string; name: string; badge: string; date: string; desc: string }

export const ROLLING: Rolling[] = [
  { id: 'pro-cbt', name: 'CARIS Pro 상시 검정 (CBT)', badge: '상시 접수', date: '연중 상시 · 예약일 응시', desc: '원하는 날짜를 예약해 온라인(CBT)으로 응시하는 상시 검정입니다.' },
]
