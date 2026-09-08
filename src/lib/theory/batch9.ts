// DAILY QUIZ 해설 — 배치 9 「모델을 다루는 기술」.
// 키 = 정답 용어(한국어). 그림 키는 components/dailyVisuals/batch9.tsx 의 VISUALS_B9 와 짝이다.
// ⚠️ 양자화·지식 증류는 헷갈리는 짝 — compare 로 "무엇을 줄이는가"를 가른다(같은 모델을 깎는다 vs 새로 가르친다).
import type { TermTheory } from './types'

export const THEORY_B9: Record<string, TermTheory> = {
  양자화: {
    point: '숫자를 촘촘히 재던 눈금을 성기게 줄여, 가볍지만 뭉툭한 값을 남긴다.',
    visual: 'b9_quant',
    why: ['저장만이 아니라 계산도 줄어 추론 속도까지 빨라진다.'],
    compare: '양자화는 같은 모델을 깎고, 지식 증류는 작은 모델을 새로 가르친다.',
  },
  '지식 증류': {
    point: '작은 모델이 정답이 아니라 큰 모델의 확신 정도까지 베껴 배운다.',
    visual: 'b9_distill',
  },
  'AI 에이전트': {
    point: '한 번 답하고 끝나지 않고, 도구를 써 보고 확인한 뒤 다시 돈다.',
    visual: 'b9_agent',
    compare: '챗봇은 대화 한 번으로 끝나지만, 에이전트는 될 때까지 스스로 돈다.',
  },
  '포지셔널 인코딩': {
    point: '한꺼번에 읽으면 순서가 사라지므로, 자리 번호를 숫자로 얹어 되살린다.',
    visual: 'b9_posenc',
    compare: '임베딩이 뜻을 좌표로 바꾼다면, 이건 그 좌표에 순서를 더한다.',
  },
  '도메인 랜덤화': {
    point: '한 가지 환경만 겪으면 낯선 현실에서 놓친다, 그래서 훈련장을 마구 흔든다.',
    visual: 'b9_domrand',
    compare: '데이터 증강은 사진을 바꾸고, 도메인 랜덤화는 훈련장의 물리 자체를 바꾼다.',
  },
  '그래프 신경망(GNN)': {
    point: '격자도 한 줄도 아닌 연결 구조 위에서, 이웃의 값을 모아 내 값을 고친다.',
    visual: 'b9_gnn',
    compare: 'CNN 은 격자를 훑고, GNN 은 이웃이 몇 개든 연결을 따라 모은다.',
  },
  '유전 알고리즘': {
    point: '잘된 답 둘을 골라 섞고 한 칸을 무작위로 바꿔, 세대마다 최고점을 올린다.',
    visual: 'b9_genetic',
    compare: '브루트포스는 전부 다 해보고, 이건 잘된 것끼리 섞어 좁혀간다.',
  },
}
