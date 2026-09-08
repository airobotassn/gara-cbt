import type { TermTheory } from './types'

export const THEORY_B7: Record<string, TermTheory> = {
  '빅오 표기법': {
    point: '몇 초 걸리나가 아니라, 커질수록 몇 배로 불어나나를 보는 것.',
    visual: 'b7_bigo',
  },
  '선택 정렬': {
    point: '매 회차, 남은 것 중 제일 작은 값을 맨 앞으로 보낸다.',
    visual: 'b7_select_sort',
    compare: '선택 정렬은 최솟값을 고르고, 버블 정렬은 옆끼리 계속 맞바꾼다.',
  },
  '순차 탐색': {
    point: '정렬 안 된 데이터는 처음부터 하나씩 볼 수밖에 없다.',
    visual: 'b7_linear_search',
    compare: '정렬돼 있으면 절반씩 지우는 이진 탐색이 훨씬 빠르다.',
  },
  '중첩 루프': {
    point: '안쪽 루프가 다 돌아야 바깥이 한 칸 움직인다.',
    visual: 'b7_nested_loop',
    why: ['겹치는 만큼 실행 횟수가 곱으로 늘어난다.'],
    compare: '중첩 루프 두 겹이 앞의 빅오 그래프에서 N² 곡선이 된다.',
  },
  'AND 연산자': {
    point: '두 조건이 동시에 참이어야만 통과한다.',
    visual: 'b7_and',
  },
  순서도: {
    point: '마름모에서 조건에 따라 갈 길이 갈린다.',
    visual: 'b7_flowchart',
    why: ['타원=시작·끝, 사각형=처리, 마름모=판단.'],
  },
  '예외 처리': {
    point: '오류가 나도 멈추지 않게 미리 파 둔 샛길이다.',
    visual: 'b7_except',
  },
  '메시지 방송': {
    point: '한 번 쏘면 기다리던 모두가 동시에 움직인다.',
    visual: 'b7_broadcast',
    compare: '함수 호출은 상대를 콕 집어 부르고, 방송은 누구든 받는다.',
  },
}
