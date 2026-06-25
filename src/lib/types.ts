// Edge Function 이 클라이언트로 내려주는 CBT 타입.
// 보안: correct_index 는 응시 중 절대 내려가지 않음(채점은 서버, 결과는 1주일 후 get-exam-result).

// 응시 중 클라가 받는 문제 (정답 제외)
export interface CbtQuestion {
  id: string
  number: number // 1..N 표시 순서
  subject: string // 예: '전기자기학 · 정전계'
  topic: string // 예: '전위'
  prompt: string
  options: string[] // 보기 4개
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
  selectedIndex: number | null // 미응답 = null
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
  topic?: string
  prompt: string
  options: string[]
  selectedIndex: number | null
  correctIndex: number
  isCorrect: boolean
}

// get-exam-result 응답 — 공개 전/후 분기
export type ExamResultResponse =
  | { released: false; submittedAt: string; resultReleaseAt: string; totalQuestions: number }
  | {
      released: true
      submittedAt: string
      totalCorrect: number
      totalQuestions: number
      answers: GradedAnswer[]
    }

// 관리자: 제출 목록 항목
export interface AdminAttemptRow {
  attemptId: string
  examTitle: string
  userId: string
  userEmail: string | null
  userName: string | null
  status: string
  startedAt: string
  submittedAt: string | null
  resultReleaseAt: string | null
  totalCorrect: number | null
  totalQuestions: number | null
  violationCount: number
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
}

export interface AdminListResponse {
  attempts: AdminAttemptRow[]
  total: number
}

export interface AdminDetailResponse {
  attempt: AdminAttemptRow
  answers: Array<GradedAnswer & { timeSpent: number }>
}
