import { isSEB, sebQuitUrl } from '../lib/seb'
import { useT } from '../lib/i18n'

// SEB 탈출구 — 잠금 브라우저 안에서 **막다른 화면에 도달했을 때 나가는 유일한 길**.
//
// 왜 필요한가: SEB 는 뒤로가기·새로고침·주소창·작업전환이 전부 막혀 있고, 수동 종료(Ctrl+Q)에는
// 비밀번호(tools/make-seb-all.mjs 의 QUIT_PASSWORD)가 걸려 있다. 그래서 오류 화면에 나가는 버튼이
// 하나도 없으면 응시자는 **컴퓨터를 재부팅해야 빠져나온다**(2026-08-10 테스트 중 실제로 그랬다).
// 종료 URL 로 이동하면 SEB 가 비밀번호 없이 스스로 닫힌다.
//
// ⚠️ **응시 중 화면에는 넣지 말 것.** 시험 도중 나가는 길은 이미 따로 있다(종료=포기 → 응시 무효).
//    여기 버튼은 "아직 시작 못 했거나 이미 못 이어가는" 화면 전용이라 잠금을 약화시키지 않는다.
// ⚠️ SEB 밖에서는 아무것도 그리지 않는다 — 일반 브라우저에는 나갈 것도, 나갈 이유도 없다.
export default function SebExitButton({ className }: { className?: string }) {
  const { t } = useT()
  if (!isSEB()) return null
  return (
    <button
      className={className ?? 'exam-btn-ghost'}
      onClick={() => {
        window.location.href = sebQuitUrl()
      }}
    >
      {t('seb.exit')}
    </button>
  )
}
