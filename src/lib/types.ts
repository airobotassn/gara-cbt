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
