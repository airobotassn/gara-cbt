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
import type { TermTheory } from '../lib/terms'

export default function DailyTheoryCard({ answer, theory }: { answer: string; theory: TermTheory }) {
  const { t } = useT()
  return (
    <div className="dy-th-card">
      <div className="dy-th-head">
        <span className="dy-th-badge">{t('daily.theory')}</span>
        <b>{answer}</b>
      </div>
      {/* 그림이 먼저다 — 2초에 읽히는 건 이쪽이고, 아래 한 줄은 그 캡션이다. */}
      <DailyVisual name={theory.visual} />
      <p className="dy-th-point">{theory.point}</p>
      {theory.why && theory.why.length > 0 && (
        <ul className="dy-th-why">
          {theory.why.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      {theory.compare && (
        <p className="dy-th-cmp">
          <span>{t('daily.hint_lead')}</span>
          {theory.compare}
        </p>
      )}
    </div>
  )
}
