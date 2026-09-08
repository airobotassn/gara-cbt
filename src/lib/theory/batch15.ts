// DAILY QUIZ 해설 — 배치 15 「학습의 기본기」.
import type { TermTheory } from './types'

export const THEORY_B15: Record<string, TermTheory> = {
  신경망: {
    point: '입력마다 가중치를 곱해 더하고, 문턱을 넘으면 다음으로 신호를 보낸다.',
    visual: 'b15_neuron',
    compare: '딥러닝은 이 뉴런을 여러 겹 쌓아 올린 것이다.',
  },
  지도학습: {
    point: '정답표를 옆에 두고, 예측이 그 정답과 같아질 때까지 맞춰 간다.',
    visual: 'b15_supervised',
    compare: '비지도학습은 정답 없이 데이터끼리 알아서 나뉜다.',
  },
  비지도학습: {
    point: '정답표 없이 데이터끼리 가까운 것을 스스로 묶는다.',
    visual: 'b15_unsupervised',
    compare: '지도학습은 정답과 대조하고, 비지도학습은 대조할 정답이 없다.',
  },
  강화학습: {
    point: '해보고, 한참 뒤에 온 보상으로 지나온 선택을 강화한다.',
    visual: 'b15_reinforce',
    compare: '모방학습은 남의 궤적을 베끼고, 강화학습은 직접 겪어 본다.',
  },
  모방학습: {
    point: '전문가가 보여준 궤적을 점 하나하나 그대로 따라 하며 배운다.',
    visual: 'b15_imitate',
    compare: '강화학습은 보상으로 배우고, 모방학습은 시연을 그대로 베낀다.',
  },
  과적합: {
    point: '가진 점은 다 맞히지만, 처음 보는 점에서는 크게 틀린다.',
    visual: 'b15_overfit',
  },
  트랜스포머: {
    point: '한 글자씩 순서대로 읽지 않고, 전부를 동시에 놓고 서로 참조한다.',
    visual: 'b15_transformer',
    compare: '이전 모델(RNN)은 한 글자씩 순서대로만 읽었다.',
  },
  하이퍼파라미터: {
    point: '데이터가 못 정하고, 사람이 학습 전에 미리 돌려놓는 값이다.',
    visual: 'b15_hyper',
    why: ['값 하나로 수렴 속도와 안정성이 통째로 바뀐다.'],
  },
}
