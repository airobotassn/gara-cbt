import type { StartExamResponse } from './types'

// 시험환경 테스트용 모의 1문제 — 실제 시험과 동일한 응시 화면을 체험(채점·서버 없음).
export function makePracticeExam(): StartExamResponse {
  return {
    attemptId: 'practice',
    exam: { slug: 'practice', title: '시험환경 테스트', durationMinutes: 5, totalQuestions: 1 },
    startedAt: new Date().toISOString(),
    questions: [
      {
        id: 'practice-1',
        number: 1,
        subject: '시험환경 테스트',
        topic: '연습',
        prompt:
          '이 화면은 실제 시험과 동일한 응시 환경입니다.\n보기를 클릭하거나, 오른쪽 「답안지」에서 번호를 눌러 답을 선택해 보세요. (채점되지 않습니다)',
        options: [
          '보기를 클릭해 답을 고른다',
          '오른쪽 답안지의 번호를 눌러 답을 고른다',
          '아래 이전/다음 버튼으로 문항을 이동한다',
          '위 내용이 모두 맞다',
        ],
      },
    ],
  }
}
