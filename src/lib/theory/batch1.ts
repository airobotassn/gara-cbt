// DAILY QUIZ 해설 — 배치 1 · 프롬프트를 어떻게 쓰느냐.
// 키 = 정답 용어(한국어). 그림 키는 components/dailyVisuals/batch1.tsx 의 VISUALS_B1 과 짝이다.
import type { TermTheory } from './types'

export const THEORY_B1: Record<string, TermTheory> = {
  '프롬프트 엔지니어링': {
    point: '지시문에 조건을 하나씩 붙일수록 답이 원하는 곳으로 좁혀진다.',
    visual: 'b1_prompt_eng',
    compare: '파인튜닝은 모델 자체를 바꾸고, 이건 지시문만 바꾼다.',
  },
  '롤 프롬프팅': {
    point: '같은 질문도 누구에게 물었다고 하느냐로 답이 달라진다.',
    visual: 'b1_role',
    compare: '역할은 한 번 갈아 끼우는 관점, 시스템 프롬프트는 계속 깔리는 규칙.',
  },
  '퓨샷 프롬프팅': {
    point: '정답이 아니라 답의 틀(형식)을 예시로 먼저 보여준다.',
    visual: 'b1_fewshot',
    compare: '예시 없이 시키면 제로샷, 몇 개 보여주면 퓨샷이다.',
  },
  '생각의 사슬': {
    point: '한 번에 답하지 않고 중간 풀이를 거치게 해 정확도를 높인다.',
    visual: 'b1_cot',
    compare: '퓨샷은 예시로 형식을 주고, 이건 풀이 과정을 강제한다.',
  },
  '네거티브 프롬프트': {
    point: '원하는 것 대신 빼야 할 것만 콕 집어 막는 지시다.',
    visual: 'b1_negative',
    compare: '보통 프롬프트는 되는 걸 말하고, 이건 안 되는 걸 말한다.',
  },
  '시스템 프롬프트': {
    point: '대화 시작 전에 깔아 둔 규칙이 모든 턴에 계속 적용된다.',
    visual: 'b1_system',
    compare: '인젝션은 이 규칙을 사용자 입력으로 몰래 뒤집으려는 공격이다.',
  },
  '프롬프트 인젝션': {
    point: '모델은 규칙과 사용자 입력을 구분하지 않고 이어 붙여 읽는다.',
    visual: 'b1_injection',
    why: ['그래서 입력에 명령처럼 생긴 문장이 섞이면 그대로 실행된다.'],
    compare: 'SQL 인젝션이 코드에 명령을 섞듯, 이건 문장에 명령을 섞는다.',
  },
  '프롬프트 템플릿': {
    point: '틀은 고정해 두고 빈칸에 값만 갈아 끼워 반복 생산한다.',
    visual: 'b1_template',
    compare: '템플릿은 틀을 고정하고, 퓨샷은 예시로 틀을 짐작하게 한다.',
  },
}
