// DAILY QUIZ 해설 — 배치 6 「센서와 회로」.
// 그림(components/dailyVisuals/batch6.tsx)이 mechanism 을 이미 보여 주므로, 여기 point 는
// "그림이 무엇을 보여주는지"를 결론 한 줄로만 짚는다. 그림이 이미 대조하고 있는 짝(드라이버 거쳐서/바로,
// 아날로그/디지털 계단)은 compare 를 비웠다 — 중복이라 안 읽힌다.
import type { TermTheory } from './types'

export const THEORY_B6: Record<string, TermTheory> = {
  '초음파 센서': {
    point: '거리가 아니라 시간을 재서 거리로 바꾸는 센서.',
    visual: 'b6_ultrasonic',
    compare: '초음파는 소리, 라이다는 빛으로 왕복 시간을 잰다.',
  },
  '자이로 센서': {
    point: '각도가 아니라 도는 속도(각속도)를 재는 센서.',
    visual: 'b6_gyro',
    compare: '자이로는 도는 속도, 가속도 센서는 기울어진 방향을 잰다.',
  },
  '조도 센서': {
    point: '밝기를 전압으로 바꿔, 기준선 아래로 내려가면 스위치를 켠다.',
    visual: 'b6_light',
  },
  '펄스 폭 변조': {
    point: '전압은 그대로 두고, 켜져 있는 시간 비율만 바꿔 세기를 조절한다.',
    visual: 'b6_pwm',
    compare: 'PWM 은 출력을 조절하는 방식, 모터 드라이버는 그 힘을 실어 주는 부품.',
  },
  '모터 드라이버': {
    point: '약한 신호를 큰 전류로 키워 모터에 넘기는 중계 장치.',
    visual: 'b6_driver',
  },
  '아날로그 신호': {
    point: '끊기지 않고 이어지는 값. 디지털은 그걸 계단으로 잘라 담는다.',
    visual: 'b6_analog',
  },
}
