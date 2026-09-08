// DAILY QUIZ 해설 글 — 배치 5(언어·데이터 다루기). 그림은 dailyVisuals/batch5.tsx 의 VISUALS_B5.
// ⚠️ 키 = 한국어 정답 용어. tmp/daily-gen/questions-batch5.json 의 term 과 한 글자도 달라선 안 된다.
import type { TermTheory } from './types'

export const THEORY_B5: Record<string, TermTheory> = {
  '자연어처리(NLP)': {
    point: '말을 잘게 쪼개 컴퓨터가 셀 수 있는 형태로 바꾸는 것.',
    visual: 'b5_nlp',
    compare: '자연어처리는 말을 다루고, 컴퓨터 비전은 그림을 다룬다.',
  },
  '감정 분석': {
    point: '문장 속 낱말을 근거로 긍정·부정을 점수 매긴다.',
    visual: 'b5_sentiment',
  },
  기계번역: {
    point: '낱말을 갈아 끼우지 않고 뜻으로 묶어 다시 편다.',
    visual: 'b5_translate',
  },
  비식별화: {
    point: '지우는 게 아니라 사람을 아는 칸만 가린다.',
    visual: 'b5_deident',
    compare: '비식별화는 가리고, 암호화는 열쇠로 다시 읽는다.',
  },
  '구조화 출력': {
    point: '줄글 대신 정해진 칸에 맞춰 답하게 시킨다.',
    visual: 'b5_structured',
  },
  '문맥 요약': {
    point: '창 크기는 그대로 두고 지난 대화를 접어 자리를 만든다.',
    visual: 'b5_context',
    compare: '컨텍스트 창은 그릇의 크기, 문맥 요약은 그 안을 접는 일.',
  },
}
