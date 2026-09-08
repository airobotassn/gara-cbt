// DAILY QUIZ 해설 카드 — /daily 에서 답을 고른 뒤 펼쳐지는 것과, 관리자 › DAILY QUIZ › 문항 관리의
// '해설 미리보기' 가 **같은 컴포넌트**를 그린다(2026-09-08). 두 벌이면 미리보기가 실제 화면과 어긋난다.
//
// ⚠️ 스타일은 daily.css 가 `.dy-page` 아래로 묶어 뒀다. /daily 는 페이지 자체가 .dy-page 라 그냥 되고,
//    다른 화면에 끼울 땐 `<div className="dy-page dy-embed">` 로 감싼다(dy-embed 가 페이지 배경·최소높이만 끈다).
//    daily.css 는 페이지가 직접 import 하는 파일이라 끼우는 쪽도 import 해야 한다.
// ⚠️ 해설의 열쇠는 **한국어 정답 표기**다(terms.ts 의 TERM_THEORY). 찾는 건 호출부(termTheory)가 하고
//    여기는 받은 것을 그리기만 한다.
import DailyVisual from './DailyVisual'
import { useT } from '../lib/i18n'
import { tTheory, useDailyI18n } from '../lib/dailyI18n'
import type { TermTheory } from '../lib/terms'

/**
 * @param answer   화면에 보이는 정답(언어로 투영된 것) — 카드 제목이다.
 * @param answerKo 한국어 정답 — **번역을 찾는 열쇠**(해설이 코드에 한국어 표기로 저장돼 있다).
 */
export default function DailyTheoryCard({ answer, answerKo, theory }: { answer: string; answerKo?: string; theory: TermTheory }) {
  const { t, lang } = useT()
  // 해설 글·그림 라벨의 번역표를 이 화면 언어로 받아 둔다(도착하면 다시 그려진다).
  useDailyI18n(lang)
  const tr = tTheory(answerKo ?? answer, theory)
  return (
    <div className="dy-th-card">
      <div className="dy-th-head">
        <span className="dy-th-badge">{t('daily.theory')}</span>
        <b>{answer}</b>
      </div>
      {/* 그림이 먼저다 — 2초에 읽히는 건 이쪽이고, 아래 한 줄은 그 캡션이다. */}
      <DailyVisual name={tr.visual} />
      <p className="dy-th-point">{tr.point}</p>
      {tr.why && tr.why.length > 0 && (
        <ul className="dy-th-why">
          {tr.why.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      {tr.compare && (
        <p className="dy-th-cmp">
          <span>{t('daily.hint_lead')}</span>
          {tr.compare}
        </p>
      )}
    </div>
  )
}
