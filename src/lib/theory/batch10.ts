// DAILY QUIZ 해설 — 배치 10 「임베디드와 실시간」.
// 그림(components/dailyVisuals/batch10.tsx)이 mechanism 을 이미 보여 주므로 point 는 결론 한 줄만,
// compare 는 그림이 대조하지 않는 헷갈리는 짝(워치독/RTC, 이동평균/칼만 등)만 붙였다.
import type { TermTheory } from './types'

export const THEORY_B10: Record<string, TermTheory> = {
  인터럽트: {
    point: '일하다가도 신호가 오면 하던 일을 멈추고 먼저 처리한다.',
    visual: 'b10_interrupt',
    compare: '폴링은 내가 계속 물어보고, 인터럽트는 저쪽이 알려준다.',
  },
  '워치독 타이머': {
    point: '정해진 시간 안에 신호를 못 받으면 장치를 강제로 재부팅한다.',
    visual: 'b10_watchdog',
    compare: '실시간 클럭은 시각을 재고, 워치독은 멈춤을 잡아낸다.',
  },
  '직접 메모리 접근(DMA)': {
    point: '주변장치가 CPU를 거치지 않고 메모리로 데이터를 직접 옮긴다.',
    visual: 'b10_dma',
    compare: '인터럽트는 CPU를 잠깐 부르고, DMA는 아예 CPU를 안 거친다.',
  },
  '메모리 정렬': {
    point: 'CPU가 한 번에 읽도록 자료 사이에 빈 바이트를 끼워 넣는다.',
    visual: 'b10_align',
    why: ['크기가 늘어나는 대신 읽는 횟수가 준다.'],
  },
  포인터: {
    point: '값이 아니라 값이 있는 번지를 들고 다니는 변수다.',
    visual: 'b10_pointer',
    compare: '큰 데이터를 통째로 복사하지 않고 번지 하나만 건넨다.',
  },
  'PID 제어': {
    point: '지금 오차·쌓인 오차·변화 속도 셋을 더해 출력을 정한다.',
    visual: 'b10_pid',
    compare: 'P만 쓰면 목표 근처에서 멈추고, I·D가 오차와 출렁임을 잡는다.',
  },
  '이동 평균 필터': {
    point: '최근 몇 개 값을 평균 내며 창을 옮겨 잡음을 누른다.',
    visual: 'b10_movavg',
    compare: '창을 넓힐수록 매끈해지지만 변화를 늦게 따라간다.',
  },
  '칼만 필터': {
    point: '예측값과 측정값을 신뢰도로 섞어 참값에 가깝게 맞춘다.',
    visual: 'b10_kalman',
    compare: '이동 평균은 과거 값만 보고, 칼만은 예측과 측정을 같이 본다.',
  },
}
