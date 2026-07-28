// Edge Function 이 클라이언트로 내려주는 CBT 타입.
// 보안: correct_index 는 응시 중 절대 내려가지 않음(채점은 서버, 결과는 1주일 후 get-exam-result).

// 응시 중 클라가 받는 문제 (정답 제외)
export interface CbtQuestion {
  id: string
  number: number // 1..N 표시 순서
  subject: string // 예: 'AI 리터러시'
  prompt: string
  kind?: 'mc' | 'short' // 'mc'(객관식·기본) | 'short'(주관식)
  choices: string[] // 객관식 보기 4개(주관식은 [])
}

export interface ExamMeta {
  slug: string
  title: string
  durationMinutes: number
  totalQuestions: number
}

// start-exam 응답
export interface StartExamResponse {
  attemptId: string
  exam: ExamMeta
  startedAt: string
  questions: CbtQuestion[]
}

// 제출 시 보내는 답안
export interface SubmittedAnswer {
  questionId: string
  selectedIndex: number | null // 객관식 선택, 미응답 = null
  answerText?: string | null // 주관식 응답
  timeSpent: number // 초
}

// submit-exam 응답 (점수 비노출 — 1주일 후 공개)
export interface SubmitExamResponse {
  ok: true
  voided?: boolean
  submittedAt: string
  resultReleaseAt?: string
}

// 채점 공개 후 문항별 결과
export interface GradedAnswer {
  number: number
  subject: string
  prompt: string
  kind?: 'mc' | 'short'
  choices: string[]
  selectedIndex: number | null
  answerText?: string | null // 주관식 응답
  correctIndex: number
  isCorrect: boolean | null // 주관식 미검수 시 null
  reviewStatus?: 'auto' | 'pending' | 'graded'
}

// get-exam-result 응답 — 공개 전/후 분기. examTitle = 응시한 시험(=자격/티어) 제목(exams.title).
export type ExamResultResponse =
  | { released: false; submittedAt: string; resultReleaseAt: string; totalQuestions: number; examTitle?: string | null }
  | {
      released: true
      submittedAt: string
      totalCorrect: number
      totalQuestions: number
      answers: GradedAnswer[]
      examTitle?: string | null
    }

// 관리자: 제출 목록 항목
export interface AdminAttemptRow {
  attemptId: string
  examTitle: string
  examId?: string | null // 등록시험 id (회차·급수 필터용)
  roundId?: string | null // 응시 회차
  tier?: string | null // 급수 key
  userId: string
  userEmail: string | null
  userName: string | null
  status: string
  startedAt: string
  submittedAt: string | null
  resultReleaseAt: string | null
  totalCorrect: number | null
  totalQuestions: number | null
}

// 마이페이지: 내 응시 1건
export interface MyAttempt {
  attemptId: string
  examTitle: string | null
  status: string
  startedAt: string
  submittedAt: string | null
  resultReleaseAt: string | null
  released: boolean
  totalCorrect: number | null
  totalQuestions: number
  passed: boolean | null
  certIssuedAt: string | null // 자격증 발급 완료 시각(서버 기록) — null=미발급
  certNo?: string | null // 발급 시 확정된 자격번호(미발급이면 null → 프론트 임시 계산)
  verifyToken?: string | null // QR 진위확인 토큰(발급 후에만)
}

// my-attempts 응답 — 목록 + (issue 요청 시) 방금 발급된 자격증 토큰·번호
export interface IssuedCert {
  verifyToken: string
  certNo: string
}
export interface MyAttemptsResponse {
  attempts: MyAttempt[]
  issued?: IssuedCert | null
}

// verify-cert 응답 — QR 진위확인 결과(공개 안전 필드만)
export interface VerifyCertResponse {
  valid: boolean
  reason?: 'not_found' | 'error'
  status?: 'valid' | 'expired'
  name?: string // 마스킹된 소지자 이름
  grade?: string // 자격/급수명(exam title)
  certNo?: string
  issuedAt?: string
  expiresAt?: string | null // null = 무기한
}

export interface AdminListResponse {
  attempts: AdminAttemptRow[]
  total: number
}

// 관리자 상세: 문항별 답안(주관식 검수 필드 포함)
export interface AdminAnswerRow extends GradedAnswer {
  answerId: string
  answerKey: string | null // 주관식 모범답안/채점 기준
  gradedBy: string | null
  gradedAt: string | null
  timeSpent: number
}
export interface AdminDetailResponse {
  attempt: AdminAttemptRow
  answers: AdminAnswerRow[]
}

// 관리자 주관식 채점 큐 항목
export interface GradeQueueItem {
  answerId: string
  attemptId: string
  number: number
  subject: string | null
  prompt: string
  answerKey: string | null
  answerText: string | null
  isCorrect: boolean | null
  reviewStatus: 'pending' | 'graded'
  gradedBy: string | null
  gradedAt: string | null
  userName: string | null
  userEmail: string | null
  examTitle: string | null
  submittedAt: string | null
}
export interface GradeQueueResponse {
  items: GradeQueueItem[]
}

// 채점 대상 회차(정기) + 미검수 수
export interface GradeRound {
  roundId: string
  kind: 'regular' | 'rolling'
  title: string
  examDate: string | null
  pending: number
}
export interface GradeRoundsResponse {
  rounds: GradeRound[]
  unassigned: number // 회차 미배정(상시 등) 미검수 수
  totalPending: number
}

// ---------- 공지사항(notices) ----------
export type Lang6 = 'ko' | 'en' | 'ja' | 'zh' | 'hi' | 'vi'
export type I18nText = Partial<Record<Lang6, string>>

// 관리자 API 가 내려주는 공지 1건(camelCase 정규화)
export interface NoticeRow {
  id: string
  category: string // guide | schedule | maintenance | event
  required: boolean // 필독 여부(빨간 배지)
  titleI18n: I18nText
  bodyI18n: I18nText
  pinned: boolean
  published: boolean
  publishedAt: string
  createdAt?: string
  updatedAt?: string
}

export interface AdminNoticeListResponse {
  notices: NoticeRow[]
}

// ---------- FAQ ----------
export interface FaqRow {
  id: string
  category: string // schedule | system | payment | grading | corporate
  questionI18n: I18nText
  answerI18n: I18nText
  tagI18n: I18nText
  sort: number
  published: boolean
  createdAt?: string
  updatedAt?: string
}

export interface AdminFaqListResponse {
  faqs: FaqRow[]
}

// ---------- 시험 일정/회차 ----------
export interface ExamRoundRow {
  id: string
  kind: 'regular' | 'rolling'
  titleI18n: I18nText
  examDate: string | null // 'YYYY-MM-DD'
  applyStartAt: string | null // ISO
  applyEndAt: string | null // ISO
  noteI18n: I18nText
  published: boolean
  sort: number
  tiers?: string[] // 이 회차가 연 급수(getTracks 티어 key) — 회차 등록 기능
  createdAt?: string
  updatedAt?: string
}

export interface AdminExamRoundListResponse {
  rounds: ExamRoundRow[]
}

// ---------- 응시료 ----------
export interface ExamFee {
  key: string // 'pro' | 'master_g4' | 'master_g3' | 'master_g2' | 'master_g1'
  amount: number
}

export interface AdminExamFeeListResponse {
  fees: ExamFee[]
}

// ---------- CBT 문항 관리 (2층: 은행 ↔ 등록시험) ----------
// 문제은행(급수별) — 문항 관리 셀렉터. bankListForAdmin.
export interface QuestionBankItem {
  id: string
  tier: string // getTracks 티어 key
  title: string
  active: boolean
  questionCount: number
  activeCount: number
}
export interface AdminBankListResp {
  banks: QuestionBankItem[]
}

// 등록시험(회차×급수) — 시험문항 셀렉터. examListForAdmin(round_id NOT NULL).
export interface AdminExamItem {
  id: string
  slug: string
  title: string
  total_questions: number
  active: boolean
  round_id?: string | null
  tier?: string | null // getTracks 티어 key
  questionCount: number // 뽑힌 세트 크기
  activeCount: number
}
export interface AdminExamListResp {
  exams: AdminExamItem[]
}

// 등록시험의 뽑힌 세트 1행. examSetList.
export interface ExamSetRow {
  number: number // 출제 표시 순서
  questionId: string
  subject: string
  difficulty: '상' | '중' | '하' | null // 난이도(관리자 전용)
  kind: 'mc' | 'short'
  prompt: string
  bankNumber: number | null // 은행 내 원 번호
  active: boolean
}
export interface AdminExamSetResp {
  rows: ExamSetRow[]
}

export interface AdminQuestionRow {
  id: string
  bank_id: string
  number: number
  subject: string
  difficulty: '상' | '중' | '하' | null // 난이도(과목 하위분류·관리자 전용). 미지정 = null
  prompt: string
  kind: 'mc' | 'short'
  choices: string[]
  correct_index: number | null
  answer_key: string | null
  explanation: string | null // 정답 해설/풀이(관리자 전용 · 응시/결과 비노출)
  active: boolean
}
export interface AdminQuestionListResp {
  rows: AdminQuestionRow[]
}

export interface AdminQuestionEvent {
  id: string
  question_id: string | null
  bank_id: string | null
  number: number | null
  subject?: string | null // 문항 과목(급수/과목 필터용)
  action: string
  actor: string | null
  detail: unknown
  created_at: string
  restorable: boolean
}
export interface AdminQuestionEventsResp {
  events: AdminQuestionEvent[]
}

// 엑셀 임포트로 보낼 한 문항
export interface QuestionImportRow {
  number: number
  subject: string
  difficulty?: '상' | '중' | '하' // 난이도(선택 · 상/중/하 아니면 미지정)
  prompt: string
  kind: 'mc' | 'short'
  choices: string[]
  correctIndex: number
  answerKey?: string
  explanation?: string // 정답 해설/풀이(선택 · 관리자 전용)
}

export interface CbtQDiff {
  id: string
  number: number
  subject: string
  prompt: string
  exam: string
  active: boolean
  n: number
  rate: number
}
// 회차별 응시→합격→발급 퍼널(정기 회차). (admin 함수 재배포 후 제공 — optional)
export interface CbtRoundStat {
  id: string
  title: string
  examDate: string | null
  kind: string
  attempts: number
  pass: number
  cert: number
}
// 급수(tier)별 실집계 — 응시→시험(exam.tier)로 급수 귀속. 급수별 추적 응시가 없으면 attempts=0(빈 상태).
export interface CbtTierStat {
  tier: string // getTracks 티어 key
  attempts: number
  pass: number
  passRate: number
  scoreHist: number[] // [0-59,60-69,70-79,80-89,90-100]
  subjects: { subject: string; rate: number; n: number }[]
  difficulty: { level: string; rate: number; n: number }[] // 상/중/하 정답률
  hard: CbtQDiff[]
  easy: CbtQDiff[]
}
export interface CbtAnalytics {
  overview: {
    users: number
    guests: number
    attemptsAll: number
    attempts7d: number
    questions: number
    questionsActive: number
    exams: number
    // ↓ admin 함수 재배포 후 채워지는 신규 지표(구버전 함수 호환 위해 전부 optional)
    signups7d?: number
    certIssued?: number
    certPending?: number
    resultPending?: number
    inProgress?: number
    pendingGrading?: number
    openRounds?: number
    nextExamDate?: string | null
  }
  days: string[]
  signupByDay: Record<string, number>
  submitByDay: Record<string, number>
  certByDay?: Record<string, number>
  scoreBands: Record<string, number>
  passRate: number
  scoredN: number
  avgScore?: number
  avgDurationMin?: number
  byExam: { title: string; slug: string; count: number }[]
  rounds?: CbtRoundStat[]
  qHardest: CbtQDiff[]
  qEasiest: CbtQDiff[]
  subjectCorrect: { subject: string; n: number; rate: number }[]
  pool: { subject: string; total: number; active: number }[]
  tiers?: CbtTierStat[] // 급수별 실집계(admin 함수 재배포 후 제공)
}

export interface CbtUserRow {
  id: string
  name: string | null
  email: string | null
  anon: boolean
  created: string
  attempts: number
  lastActive: string | null
}
export interface CbtUsersResp {
  users: CbtUserRow[]
}
export interface CbtUserAttempt {
  id: string
  examTitle: string | null
  status: string
  totalCorrect: number | null
  totalQuestions: number | null
  submittedAt: string | null
  createdAt: string
}
export interface CbtUserDetailResp {
  attempts: CbtUserAttempt[]
}

// ---------- 이북(전자책) ----------
// 스토어(/ebooks) · 마이페이지 서재 · 뷰어가 공유. 본문 HTML 은 비공개 버킷 → 서명 URL 로만 열람.
export interface EbookRow {
  id: string
  title: string // 요청 언어의 번역본이 있으면 그 제목
  author: string | null
  description: string | null
  coverUrl: string | null // 그 언어의 표지(본문 1페이지를 구운 것)
  price: number // 원(KRW). 0 = 무료
  targetLevel: number | null // 추천 대상 레벨(1~7). null = 레벨 무관
  langs: string[] // 이 책이 가진 언어(항상 'ko' 포함)
  owned: boolean
  purchasedAt?: string // 서재(library) 응답에만
}
export interface EbookListResp {
  ebooks: EbookRow[]
}
/** 결과창 추천(picks) — 응시 레벨 기준으로 고른 목록. */
export interface EbookPicksResp {
  ebooks: EbookRow[]
  forLevel: number | null // 실제로 기준 삼은 레벨(승급 시 +1). 레벨 없이 부르면 null
}
export interface EbookReadResp {
  id: string
  title: string
  author: string | null
  url: string // 서명 URL (기본 1시간)
  expiresIn: number
  lang: string // 실제로 연 언어(요청 언어에 번역본이 없으면 'ko')
  langs: string[] // 이 책이 가진 언어
}

/** 이북 번역본 1건 — `ebooks.translations` jsonb 의 값. 원문(ko)은 여기 없다. */
export interface EbookTranslation {
  path: string
  coverUrl?: string
  title?: string
  author?: string
  description?: string
  failed?: number // 번역 실패해 한국어로 남은 조각 수
  fittedPages?: number[] // 글이 넘쳐 자동 축소해 맞춘 페이지 번호(1부터)
  overflowPages?: number[] // 축소 하한까지 줄여도 안 들어간 페이지 — 사람이 손봐야 함
  at?: string
}

// 관리자(admin 함수) — 이북 관리
export interface AdminEbookRow {
  id: string
  title: string
  author: string | null
  description: string | null
  coverUrl: string | null
  price: number
  targetLevel: number | null // 추천 대상 레벨(1~7). null = 미지정
  storagePath: string
  published: boolean
  sortOrder: number
  createdAt: string
  buyers: number
  translations: Record<string, EbookTranslation>
}
export interface AdminEbookListResp {
  ebooks: AdminEbookRow[]
}
export interface AdminEbookBuyer {
  userId: string
  name: string | null
  email: string | null
  pricePaid: number
  source: string
  createdAt: string
}
export interface AdminEbookBuyersResp {
  buyers: AdminEbookBuyer[]
}
