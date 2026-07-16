// CBT 시험 공통 설정 (CARIS 자격검정)
// 서버 exams 행이 실제 권위값. 아래는 화면 기본 표기/타이머 폴백값.

// 기본 시험 식별자(서버 seed 의 exams.slug 와 일치)
export const DEFAULT_EXAM_SLUG = 'gara-default'

// CARIS ARENA(별도 서비스) — 메인/FAB 'CARIS ARENA 응시하기' 이동 대상
export const LEVELTEST_URL = 'https://gara-leveltest.airobotassn.workers.dev/'

// 화면 표기/타이머 폴백 (서버 응답값으로 덮어씀)
export const TOTAL_QUESTIONS = 100
export const TEST_DURATION_MINUTES = 120

// 채점 결과 공개까지 대기일 (서버 result_release_at = 제출 + N일 과 일치시킬 것)
export const RESULT_RELEASE_DAYS = 7

// 합격 기준 비율(맞힌 비율). 이 이상이면 합격(자격증 발급). 문항 수가 바뀌어도 비율로 판정.
export const PASS_RATIO = 0.6

// in_progress attempt 만료(서버측 안전장치, 화면 타이머 아님)
export const ATTEMPT_TTL_MINUTES = 240
