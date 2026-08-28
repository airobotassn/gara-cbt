import type { CategoryKey } from './categories'
import type { AxisMap, RankDir } from './scoring'

// Edge Function이 클라이언트로 내려주는 문제 (정답·해설 제외! 응시 언어로 투영됨)
export interface QuizQuestion {
  id: string
  category: CategoryKey // 그 레벨의 6축 코드 중 하나
  prompt: string
  options: string[]
}

// start-test 응답
export interface StartTestResponse {
  attemptId: string
  level: number
  lang: string
  startedAt: string
  questions: QuizQuestion[]
}

// 제출 시 보내는 답안
export interface SubmittedAnswer {
  questionId: string
  selectedIndex: number | null // 미응답 = null
  timeSpent: number // 초
}

// ⛔ 옛 GradedAnswer(문항별 정답·해설)는 제거됐다 — 결과창의 오답노트가 없어지면서 쓰는 곳이
//    사라졌는데 서버는 계속 만들어 보내고 있었다(2026-08-25). 되살릴 땐 화면부터 만들 것.
//    ⚠️ 같은 이름이 lib/types.ts 에도 있는데 그건 **CBT 자격검정 결과창**용이라 살아 있다.

// submit-test / get-result 응답
// locked=true(익명)면 서버가 점수 외 상세를 비워서 내려준다.
// 영구유저면 그 레벨 누적 6축 레이팅(rating) + 이번 변동(deltas) + 등급변동까지.
export interface ResultResponse {
  attemptId: string
  level: number // 응시한 레벨
  totalCorrect: number
  totalQuestions: number
  locked: boolean

  // --- 영구유저 전용 (locked면 null/빈값) ---
  rating: AxisMap | null // 그 레벨 누적 6축 레이팅 (0~100)
  perf?: AxisMap | null // 이번 시험만의 6축 성적 (결과창 레이더 실선, 0~100)
  prevPerf?: AxisMap | null // 직전 동레벨 시험의 6축 성적 (레이더 음영). 없으면 null
  deltas: AxisMap | null // 이번 테스트로 인한 축별 변동
  placed: boolean | null // 그 레벨 배치 완료 여부(첫 응시면 false→true)
  rankBefore: number | null // 시험 전 내 등급(레벨)
  rankAfter: number | null // 시험 후 내 등급(레벨)
  rankDir: RankDir | null // 승급/유지 (강등 없음)

  // 익명 소유자에게만 발급되는 일회성 이관 토큰
  claimToken?: string | null
  // 이관이 쿨다운으로 거부된 경우
  cooldownBlocked?: boolean
}

// list-attempts 응답(로그인 전용)
export interface AttemptSummary {
  attemptId: string
  level: number
  totalCorrect: number
  totalQuestions: number
  rankAfter: number | null // 그 시험 직후 등급 스냅샷
  rankDir: RankDir | null
  deltas: AxisMap | null
  submittedAt: string
}

// 레벨별 누적 레이더(대시보드 전환용)
export interface LevelSkill {
  level: number
  ratings: AxisMap // 그 레벨 6축 누적 (0~100)
  attemptsCount: number
}

export interface ListAttemptsResponse {
  attempts: AttemptSummary[]
  currentRank: number | null // 현재 등급(레벨). 아직 응시 전이면 null
  currentPoints: number // 랭킹 점수(0~10000)
  levelSkills: LevelSkill[] // 응시한 레벨들의 누적 레이더
  dailyLeft?: number | null // 오늘 남은 응시 횟수(게스트/구버전 함수면 null·undefined)
  certificate?: LevelCertData | null // 레벨테스트 인증서 데이터(응시 기록 없으면 null)
}

// 레벨테스트 인증서 — 값은 전부 서버 계산분이다(클라 파라미터로 레벨·날짜를 못 바꾼다).
export interface LevelCertData {
  displayName: string // 닉네임(profiles.display_name)
  // 취득한(깬) 최고 레벨 = 인증서에 각인되는 숫자. ⚠️ currentRank 와 다르다 — rank 는 '지금 서 있는 칸'이라
  // Lv.1 을 깨면 2가 된다(취득 = rank − 1, 천장에서 Lv.7 을 통과하면 7). 하나도 못 깼으면 인증서가 null.
  level: number
  milestones: Record<string, string> // 레벨 → 최초 취득일(ISO)
  // 진위확인 토큰 — /verify/<token>. list-attempts 가 만들어 내려준다(클라가 만들지 않는다).
  // ⚠️ 지금은 **user_id 를 인코딩한 임시 토큰**이다(`lv-…`) — 레벨테스트에는 난수를 담을
  //    verify_token 컬럼이 없어서다. 형식·한계·바꿀 자리는 functions/_shared/cert.ts 주석 참고.
  // 없으면 인증서 QR 이 잠금 슬롯으로 뜬다 — 죽은 링크를 QR 로 찍지 않기 위해서다.
  verifyToken?: string | null
}
