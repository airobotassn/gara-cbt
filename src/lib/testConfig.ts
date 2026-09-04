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

// 합격 기준 비율(맞힌 비율)의 **기본값**. 급수별로 다르게 정할 수 있고(관리자 › 인증서 관리 ›
// 급수별 발급 조건 → exam_tiers.pass_ratio), 실제 판정은 응시 시작 시점에 그 응시에 박힌 값으로 한다
// (exam_attempts.pass_ratio_snapshot). 서버가 결과와 함께 내려주므로 화면은 그 값을 쓰고,
// 안 오면(옛 배포본·옛 응시) 이 값으로 떨어진다.
// ⚠️ 서버 짝 = supabase/functions/_shared/exam-tickets.ts 의 DEFAULT_PASS_RATIO.
export const PASS_RATIO = 0.6

/**
 * 합격 최소 정답 수.
 *
 * ⛔ `Math.ceil(total * ratio)` 를 직접 쓰지 말 것 — 이진 부동소수 오차로 한 문제가 더 붙는다.
 *    실측: `Math.ceil(100 * 0.55)` = **56**(정답은 55). 서버 SQL 은 numeric 이라 55 라고 말한다
 *    → 같은 응시를 두고 화면과 서버가 다른 판정을 내놓는다. 0.55 는 관리자 화면이 예시로 적어 둔 값이다.
 * ⚠️ 서버 짝 = _shared/exam-tickets.ts 의 passMark. 둘은 같은 식이어야 한다.
 */
export function passMark(totalQuestions: number, ratio: number = PASS_RATIO): number {
  return Math.ceil(Math.round(totalQuestions * ratio * 1e6) / 1e6)
}

// in_progress attempt 만료(서버측 안전장치, 화면 타이머 아님)
export const ATTEMPT_TTL_MINUTES = 240
