// DAILY QUIZ 해설 — 배치 8 「눈으로 보는 AI를 만들고 채점하는 일」.
import type { TermTheory } from './types'

export const THEORY_B8: Record<string, TermTheory> = {
  '합성곱 신경망(CNN)': {
    point: '필터 하나가 그림 전체를 돌며 같은 무늬만 반복해서 찾아낸다.',
    visual: 'b8_cnn',
    compare: '완전연결망은 픽셀마다 다른 가중치를 쓰고, CNN 은 필터를 통째로 재사용한다.',
  },
  세그멘테이션: {
    point: '있다·없다를 넘어 물체의 픽셀 경계선까지 그어낸다.',
    visual: 'b8_seg',
  },
  IoU: {
    point: '겹친 넓이를 합친 넓이로 나눈 값, 클수록 잘 맞힌 것이다.',
    visual: 'b8_iou',
    compare: 'IoU 는 상자 하나의 정확도고, mAP 는 그걸 모은 평균 점수다.',
  },
  '혼동 행렬': {
    point: '맞고 틀림을 넷으로 쪼개면, 같은 틀림도 손해가 다르게 보인다.',
    visual: 'b8_confusion',
  },
  '데이터 증강': {
    point: '가진 사진을 비틀어 학습 표본을 인위적으로 불린다.',
    visual: 'b8_aug',
    compare: '전이 학습은 배운 모델을 재사용하고, 증강은 가진 사진 수를 불린다.',
  },
  '카메라 캘리브레이션': {
    point: '렌즈가 휘게 찍은 상을 계수로 펴서 실제 치수와 맞춘다.',
    visual: 'b8_calib',
    why: ['로봇이 카메라로 잰 위치를 좌표로 쓰려면 이 보정이 먼저다.'],
  },
  '비최대 억제(NMS)': {
    point: '겹친 예측 상자 중 확신이 가장 낮은 것부터 지워 하나만 남긴다.',
    visual: 'b8_nms',
    compare: 'IoU 로 겹침을 재고, 그 값이 기준을 넘으면 NMS 가 지운다.',
  },
  '합성 데이터': {
    point: '찍은 적 없는 장면을 시뮬레이터로 만들어 라벨까지 붙여 낸다.',
    visual: 'b8_synth',
    compare: '데이터 증강은 있는 사진을 비틀고, 합성 데이터는 없는 장면을 통째로 만든다.',
  },
}
