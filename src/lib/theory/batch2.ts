// DAILY QUIZ 해설 — 배치 2 · 언어모델 안에서 벌어지는 일.
// 키 = 정답 용어(한국어). 그림 키는 components/dailyVisuals/batch2.tsx 의 VISUALS_B2 와 짝이다.
import type { TermTheory } from './types'

export const THEORY_B2: Record<string, TermTheory> = {
  '거대언어모델(LLM)': {
    point: '하는 일은 다음 한 조각 고르기 하나. 나머지는 규모가 만들었다.',
    visual: 'b2_llm',
    compare: '검색은 어딘가에서 찾아오고, 이쪽은 매번 새로 지어낸다.',
  },
  토큰: {
    point: '글자도 단어도 아닌 모델만의 조각. 이 개수가 분량이자 요금이다.',
    visual: 'b2_token',
    why: ['한국어는 글자마다 잘리는 일이 많아 같은 뜻도 조각을 더 먹는다.'],
  },
  '컨텍스트 창': {
    point: '한 번에 볼 수 있는 폭. 넘친 앞부분은 요약되는 게 아니라 잊힌다.',
    visual: 'b2_context',
    compare: '토큰은 조각 하나의 단위, 이건 그 조각을 몇 개까지 담느냐.',
  },
  임베딩: {
    point: '뜻을 좌표로 바꾼다. 가까우면 비슷하고, 방향이 관계를 담는다.',
    visual: 'b2_embed',
    compare: '토큰화는 글을 조각으로 자르고, 임베딩은 그 조각에 좌표를 준다.',
  },
  '어텐션 메커니즘': {
    point: '단어마다 지금 어디를 봐야 하는지를 가중치로 정한다.',
    visual: 'b2_attention',
    why: ['멀리 떨어진 단어도 한 번에 이어 준다 — 트랜스포머의 심장.'],
  },
  '다음 토큰 예측': {
    point: '문장을 미리 짜 두지 않는다. 한 조각 붙이고 처음부터 다시 고른다.',
    visual: 'b2_next',
    compare: '그래서 같은 질문에도 매번 다른 문장이 나올 수 있다.',
  },
  '온도(Temperature)': {
    point: '후보는 그대로 두고 분포만 뾰족하게(안전) 혹은 납작하게(다양).',
    visual: 'b2_temp',
    compare: '온도는 분포 모양을 바꾸고, 탑피는 후보 수를 잘라낸다.',
  },
  '탑피(Top-P)': {
    point: '확률 높은 순으로 누적해, p 에 닿는 데까지만 후보로 남긴다.',
    visual: 'b2_topp',
    compare: '개수로 자르면 탑케이, 누적 확률로 자르면 이것이다.',
  },
  '코사인 유사도': {
    point: '길이는 무시하고 사잇각만 본다. 1 에 가까울수록 같은 뜻.',
    visual: 'b2_cosine',
    compare: '유클리드 거리는 떨어진 거리, 이건 바라보는 방향.',
  },
}
