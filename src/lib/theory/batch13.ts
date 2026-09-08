// DAILY QUIZ 해설 — 배치 13 「로봇 기본기」.
// 키 = 정답 용어(한국어). 그림 키는 components/dailyVisuals/batch13.tsx 의 VISUALS_B13 와 짝이다.
// ⚠️ 센서 ↔ 액추에이터, 순기구학 ↔ 역기구학은 그림 자체가 방향을 대조하고 있어 compare 를 비웠다.
import type { TermTheory } from './types'

export const THEORY_B13: Record<string, TermTheory> = {
  액추에이터: {
    point: '판단은 못 한다 — 신호가 오면 그대로 움직일 뿐이다.',
    visual: 'b13_actuator',
  },
  센서: {
    point: '재는 게 끝이 아니다 — 값을 신호로 바꿔 내보내야 끝난다.',
    visual: 'b13_sensor',
  },
  엔코더: {
    point: '몇 도 돌았는지 펄스 개수로 세는, 서보의 눈 역할.',
    visual: 'b13_encoder',
    compare: '엔코더는 숫자를 만들고, 서보는 그 숫자로 위치를 되돌린다.',
  },
  토크: {
    point: '같은 힘도 축에서 멀리 가하면 더 세게 돈다.',
    visual: 'b13_torque',
  },
  역기구학: {
    point: '사람은 좌표로 말한다 — 그 말을 관절 각도로 옮기는 계산.',
    visual: 'b13_ik',
  },
  순기구학: {
    point: '각도만 알면 손끝 위치는 계산으로 바로 나온다.',
    visual: 'b13_fk',
  },
  SLAM: {
    point: '지도가 있어야 위치를 알고, 위치를 알아야 지도를 그린다 — 그걸 같이 푼다.',
    visual: 'b13_slam',
    compare: '라이다 같은 센서가 잰 거리를 이어 붙이면 지도가 된다.',
  },
  '라이다(LiDAR)': {
    point: '빛의 속도를 아니까, 갔다 온 시간만 재면 거리가 나온다.',
    visual: 'b13_lidar',
    compare: '카메라는 색과 형태를 보고, 라이다는 갔다 온 시간을 잰다.',
  },
}
