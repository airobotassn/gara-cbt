import type { TermTheory } from './types'

export const THEORY_B14: Record<string, TermTheory> = {
  자율주행: {
    point: '인식·판단·행동을 매 순간 스스로 돌리는 전체 고리.',
    visual: 'b14_autodrive',
    compare: '경로계획은 그 고리 중 "어디로 갈지" 계산하는 한 조각.',
  },
  경로계획: {
    point: '출발 전에 장애물을 피할 한 줄을 미리 계산해 두는 것.',
    visual: 'b14_pathplan',
    compare: '자율주행은 그 경로를 실제로 인식·판단하며 돌리는 전체 고리.',
  },
  '협동로봇(코봇)': {
    point: '펜스가 없는 건 순해서가 아니라 힘·속도를 스스로 낮춰서다.',
    visual: 'b14_cobot',
    why: ['사람이 다가오면 느려지고, 닿으면 힘을 확 낮춘다.'],
  },
  '휴머노이드 로봇': {
    point: '사람 모양인 이유 — 계단·문·도구가 이미 사람 몸에 맞춰져 있다.',
    visual: 'b14_humanoid',
    compare: '바퀴형은 평평한 바닥까지, 다리는 다음 단에도 발을 놓는다.',
  },
  '촉각 센서': {
    point: '만졌을 때 압력·질감을 읽는다 — 닿아야만 안다.',
    visual: 'b14_tactile',
    compare: '자기수용감각은 안 닿아도 자기 관절 위치를 스스로 안다.',
  },
  자기수용감각: {
    point: '밖을 안 보고도 자기 관절이 지금 몇 도인지 스스로 안다.',
    visual: 'b14_proprio',
    compare: '촉각 센서는 밖의 것을 만져야 알고, 이건 안 만져도 안다.',
  },
  '컴플라이언트 제어': {
    point: '부딪히면 버티지 않고, 밀리는 만큼 물러나 힘을 흡수한다.',
    visual: 'b14_compliant',
    compare: '위치 제어는 각도를 고집해 무리가 가고, 이건 비켜준다.',
  },
  '스와름 로보틱스': {
    point: '지휘자 없이 옆 로봇 몇 대만 보는 규칙에서 전체 대형이 나온다.',
    visual: 'b14_swarm',
    why: ['각자 이웃 위치만 보고 반응할 뿐, 전체 그림은 아무도 안 그린다.'],
  },
}
