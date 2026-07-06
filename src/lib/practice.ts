import type { StartExamResponse } from './types'

// 시험환경 테스트용 모의 6문제(객관식 5 + 주관식 1) — 실제 시험과 동일한 응시 화면을 체험(채점·서버 없음).
export function makePracticeExam(): StartExamResponse {
  return {
    attemptId: 'practice',
    exam: { slug: 'practice', title: '시험환경 테스트', durationMinutes: 10, totalQuestions: 6 },
    startedAt: new Date().toISOString(),
    questions: [
      {
        id: 'practice-1',
        number: 1,
        subject: '시험환경 테스트',
        topic: '답 선택',
        prompt:
          '이 화면은 실제 시험과 동일한 응시 환경입니다.\n보기를 클릭하거나, 오른쪽 「답안지」에서 번호를 눌러 답을 선택해 보세요. (채점되지 않습니다)',
        choices: [
          '보기를 클릭해 답을 고른다',
          '오른쪽 답안지의 번호를 눌러 답을 고른다',
          '아래 이전/다음 버튼으로 문항을 이동한다',
          '위 내용이 모두 맞다',
        ],
      },
      {
        id: 'practice-2',
        number: 2,
        subject: '시험환경 테스트',
        topic: '문항 이동',
        prompt: '다른 문항으로 이동하려면 어떻게 하나요?',
        choices: [
          '화면 하단의 「이전」·「다음」 버튼을 누른다',
          '오른쪽 답안지에서 문항 번호를 누른다',
          '둘 다 가능하다',
          '이동할 수 없다',
        ],
      },
      {
        id: 'practice-3',
        number: 3,
        subject: '시험환경 테스트',
        topic: '제한시간',
        prompt: '화면 오른쪽 위의 타이머에 대한 설명으로 맞는 것은?',
        choices: [
          '남은 시간이 표시되며 0이 되면 자동으로 제출된다',
          '경과한 시간만 표시된다',
          '시간 제한이 없다',
          '타이머는 장식일 뿐이다',
        ],
      },
      {
        id: 'practice-4',
        number: 4,
        subject: '시험환경 테스트',
        topic: '답안지',
        prompt: '오른쪽 「답안지」에서 확인할 수 있는 것은?',
        choices: [
          '각 문항에 선택한 답',
          '지금까지 몇 문항을 풀었는지(진행 상황)',
          '아직 풀지 않은 문항',
          '위 내용을 모두 확인할 수 있다',
        ],
      },
      {
        id: 'practice-5',
        number: 5,
        subject: '시험환경 테스트',
        topic: '제출',
        prompt: '시험을 끝내려면 어떻게 하나요?',
        choices: [
          '화면 오른쪽 아래 「제출」 버튼을 누른다',
          '안 푼 문항이 있으면 안내 후 해당 문항으로 이동한다',
          '제출 전 확인 창이 나타난다',
          '위 내용이 모두 맞다',
        ],
      },
      {
        id: 'practice-6',
        number: 6,
        kind: 'short',
        subject: '시험환경 테스트',
        topic: '주관식 답안',
        prompt:
          '주관식 문항입니다. 아래 입력란에 답을 직접 작성해 보세요.\n실제 시험에서는 주관식 답안을 관리자가 검토해 채점합니다. (이 모의 문제는 채점되지 않습니다)',
        choices: [],
      },
    ],
  }
}
