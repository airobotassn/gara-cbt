// DAILY QUIZ 해설 — 배치 11 「현장의 안전과 조율」.
// 키 = 정답 용어(한국어). 그림 키는 components/dailyVisuals/batch11.tsx 의 VISUALS_B11 와 짝이다.
// ⚠️ 비상 정지·인터록 회로는 헷갈리는 짝 — compare 로 "전부를 끄는가 / 둘만 가르는가"를 가른다.
import type { TermTheory } from './types'

export const THEORY_B11: Record<string, TermTheory> = {
  '비상 정지': {
    point: '제어 프로그램을 거치지 않고 배선으로 곧장 전원을 끊는 최후의 장치.',
    visual: 'b11_estop',
    compare: '인터록은 서로를 막고, 비상 정지는 소프트웨어까지 건너뛴다.',
  },
  '인터록 회로': {
    point: '한쪽이 켜지면 반대쪽 회로를 물리적으로 끊어 동시에 못 켜지게 한다.',
    visual: 'b11_interlock',
    compare: '비상 정지는 전부를 끄고, 인터록은 겹치면 안 되는 둘만 가른다.',
  },
  '교착 상태': {
    point: '여럿이 각자 목표만 고집하다 서로의 길을 막아 아무도 못 움직이는 상태.',
    visual: 'b11_deadlock',
    why: ['하나가 양보해 고리를 끊으면 나머지가 풀린다.'],
  },
  '센서 스푸핑': {
    point: '코드는 안 건드리고 센서에 가짜 물리 신호를 먹여 계측값 자체를 속인다.',
    visual: 'b11_spoof',
    compare: '해킹은 통신을 가로채고, 스푸핑은 센서가 보는 세상을 바꾼다.',
  },
  '액션 통신': {
    point: '오래 걸리는 작업에 목표를 보내고, 진행률과 취소까지 계속 주고받는 통신.',
    visual: 'b11_action',
    compare: '토픽은 보내고 끝, 서비스는 답이 올 때까지 묶이고, 액션만 중간에 오간다.',
  },
  '복셀 그리드 다운샘플링': {
    point: '점 구름을 격자 칸으로 나눠 칸마다 대표점 하나로 접어 개수를 줄인다.',
    visual: 'b11_voxel',
    why: ['칸을 너무 키우면 얇은 부분부터 사라진다.'],
  },
}
