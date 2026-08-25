import { useLocation } from 'react-router-dom'
import { isSEB, sebQuitUrl } from '../lib/seb'
import { useT } from '../lib/i18n'

// SEB 전역 안전망 — 잠금 브라우저 안 **어느 화면에서든** 나갈 수 있게 하는 마지막 보루.
//
// 막다른 화면마다 버튼을 다는 것(<SebExitButton>)만으로는 부족하다. 라우트가 하나도 안 맞으면 앱이
// 랜딩(/)으로 리다이렉트하고, 거기엔 시험용 UI 가 없어서 나가는 길도 없다 — SEB 는 뒤로가기·새로고침·
// 주소창이 전부 막혀 있고 수동 종료엔 비밀번호가 걸려 있으니, 그 순간 재부팅 말고는 방법이 없다
// (2026-08-10 테스트 중 실제로 재부팅했다). 그래서 화면이 무엇이든 구석에 하나 띄운다.
//
// ⚠️ **응시 중에는 뜨지 않는다.** `/exam/run/*` 은 시험 화면이라, 여기서 한 번에 나가지는 길을 주면
//    잠금이 무의미해진다. 그 화면에는 이미 '종료(포기)' 가 있고 그건 응시를 무효로 기록한다.
// ⚠️ 종료 화면(/exam/complete·/exam/done)에도 안 띄운다 — 거기엔 이미 종료 버튼이 있고,
//    /exam/done 은 SEB 가 스스로 닫는 주소라 버튼이 뜰 새도 없다.
// ⚠️ /exam/envcheck 는 그 화면이 자기 종료 버튼을 이미 갖고 있다 — 여기까지 뜨면 같은 버튼이 둘이 된다.
const HIDDEN_PREFIXES = ['/exam/run', '/exam/complete', '/exam/done', '/exam/envcheck']

export default function SebEscapeHatch() {
  const { pathname } = useLocation()
  const { t } = useT()
  if (!isSEB()) return null
  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null
  return (
    <button
      type="button"
      onClick={() => {
        window.location.href = sebQuitUrl()
      }}
      // 인라인 스타일인 이유 = 이 버튼은 **어떤 페이지 CSS 도 안 불러온 화면**(랜딩·오류 폴백)에서도
      // 똑같이 보여야 한다. 클래스에 기대면 정작 필요한 순간에 안 보일 수 있다.
      style={{
        position: 'fixed',
        right: 12,
        bottom: 12,
        zIndex: 2147483647, // 무엇 위에도 — 이게 안 보이면 사용자는 갇힌다
        padding: '10px 16px',
        borderRadius: 10,
        border: '1px solid rgba(0,0,0,.25)',
        background: '#fff',
        color: '#111',
        font: '600 14px/1.2 system-ui, sans-serif',
        cursor: 'pointer',
        boxShadow: '0 2px 10px rgba(0,0,0,.18)',
      }}
    >
      {t('seb.exit')}
    </button>
  )
}
