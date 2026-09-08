// DAILY QUIZ 해설 — 배치 16 「피지컬 AI」.
// 키 = 정답 용어(한국어). 그림 키는 components/dailyVisuals/batch16.tsx 의 VISUALS_B16 과 짝이다.
// ⚠️ 임베디드 AI 는 엣지 컴퓨팅·온디바이스 AI 와 헷갈리는 짝 — compare 로 "위치 vs 자원 크기"를 가른다.
// ⚠️ 실시간 제어는 '빠르다'가 아니라 '마감을 반드시 지킨다'가 핵심 — point 를 그쪽으로 잡는다.
import type { TermTheory } from './types'

export const THEORY_B16: Record<string, TermTheory> = {
  '임베디드 AI': {
    point: '이 기기 한 대에 쓸 수 있는 메모리·전력이 처음부터 못박혀 있다.',
    visual: 'b16_embedded',
    compare: '온디바이스·엣지는 처리 위치를 가르는 말이고, 임베디드는 그 안에서 쓸 자원의 크기를 가르는 말이다.',
  },
  '실시간 제어': {
    point: '평균은 빨라도 한 번이라도 마감을 넘기면 그걸로 끝이다.',
    visual: 'b16_realtime',
    compare: '비동기 제어는 끝나기만 하면 되지만, 실시간 제어는 마감을 놓치면 그 자체로 실패다.',
  },
  '시뮬레이션 투 리얼(Sim-to-Real)': {
    point: '같은 정책, 같은 동작인데 현실에선 미끄러진다 — 그 틈을 reality gap이라 부른다.',
    visual: 'b16_sim2real',
    compare: '디지털 트윈은 실물을 계속 비추는 거울이고, 심투리얼은 배운 정책을 현실로 한 번 옮기는 일이다.',
  },
  'VLA 모델': {
    point: '사람이 짜 넣던 중간 규칙 칸이 통째로 사라졌다 — 보고 들은 게 곧장 동작이 된다.',
    visual: 'b16_vla',
    compare: '파운데이션 모델은 밑동을 여러 일에 나눠 쓰는 것이고, VLA는 보고 듣는 것에서 동작까지 잇는 구조다.',
  },
  '파운데이션 모델': {
    point: '한 번 크게 배운 밑동 하나에, 작업마다는 아주 조금만 더 가르친다.',
    visual: 'b16_foundation',
    compare: 'VLA는 입력에서 동작까지 잇는 구조고, 파운데이션 모델은 그 안에 쓰일 수 있는 범용 밑동이다.',
  },
  '강건성(Robustness)': {
    point: '조건이 딱 맞을 때만 세 보이는 건 진짜 강한 게 아니다.',
    visual: 'b16_robust',
    compare: '일반화는 새로운 데이터에도 통하는 힘이고, 강건성은 조건이 흔들려도 무너지지 않는 힘이다.',
  },
}
