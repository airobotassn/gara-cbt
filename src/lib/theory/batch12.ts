// DAILY QUIZ 해설 — 배치 12 「공장이 디지털로 옮겨가는 층계」.
// 키 = 정답 용어(한국어). 그림 키는 components/dailyVisuals/batch12.tsx 의 VISUALS_B12 와 짝이다.
// ⚠️ 엣지 컴퓨팅·온디바이스 AI 는 헷갈리는 짝 — compare 로 서로를 가른다(거리 vs 경계).
import type { TermTheory } from './types'

export const THEORY_B12: Record<string, TermTheory> = {
  '엣지 컴퓨팅': {
    point: '데이터를 클라우드까지 보내지 않고 가까운 곳에서 처리해 왕복 시간을 줄인다.',
    visual: 'b12_edge',
    compare: '엣지는 근처 장비로는 보내고, 온디바이스는 기기 밖으로 아예 안 보낸다.',
  },
  '디지털 트윈': {
    point: '실물과 똑같이 움직이는 가상 복제본 — 상태도, 실험 결과도 서로 오간다.',
    visual: 'b12_twin',
    compare: '단순 모니터링은 보기만 하고, 트윈은 가상에서 돌려본 결과가 실물로 돌아온다.',
  },
  '온디바이스 AI': {
    point: '센서부터 판단까지 기기 안에서 다 끝내 원본 데이터가 밖으로 안 나간다.',
    visual: 'b12_ondevice',
    compare: '엣지는 그래도 근처까지는 내보내고, 이건 기기 벽을 넘지 않는다.',
  },
  '예지 보전': {
    point: '날짜도 고장도 아니라, 데이터가 보내는 추세 신호로 고칠 때를 정한다.',
    visual: 'b12_pdm',
  },
  '처방적 분석': {
    point: '설명·진단·예측 다음 단계 — 알려주는 데서 그치지 않고 조치를 명령한다.',
    visual: 'b12_stairs',
  },
}
