import { useEffect, useRef, useState } from 'react'
import { callFunction } from '../lib/supabase'
import { isSEB } from '../lib/seb'
import { readHandoffNonce, stripHandoffFromUrl } from '../lib/examToken'
import SebExitButton from '../components/SebExitButton'
import { useT } from '../lib/i18n'

// SEB 환경 점검 도착 화면 — 모의 .seb 의 startURL 이 여기다.
//
// ⚠️ **모의 문제를 풀게 하지 않는다.** 확인하려는 건 "이 PC 에서 SEB 가 실제로 뜨는가" 하나뿐이고,
//    이 화면이 보이는 순간 그게 증명된다.
// ⛔ **점검 기록은 여기서 남긴다.** 바깥 브라우저가 버튼 누를 때 남기면 SEB 가 안 떠도 '완료' 가 되어
//    정작 확인하려던 걸 증명하지 못한다. 실행 링크에 실려온 일회용 표를 여기서 교환하면,
//    기록이 남았다는 것 자체가 SEB 가 떴다는 증거가 된다.
// ⚠️ 이 표는 **아무 자격도 주지 않는다** — 교환해도 기록만 남는다(서버 seb-handoff 의 redeem 참고).
//    실제 응시 표와 같은 걸 주면 점검하러 온 사람이 시험을 시작할 수 있게 된다.
export default function ExamEnvCheck() {
  const { t } = useT()
  const [nonce] = useState(() => readHandoffNonce(window.location.search))
  const [saved, setSaved] = useState<boolean | null>(null) // null = 아직 보내는 중
  const ranRef = useRef(false)

  useEffect(() => {
    if (nonce) stripHandoffFromUrl()
  }, [nonce])

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true
    // 표가 없으면 보낼 것도 없다 — 옛 .seb 로 들어왔거나 링크에서 표가 빠진 경우다.
    // 상태 변경은 전부 비동기 콜백 안에서 한다(이펙트 본문에서 setState 하면 렌더가 한 번 더 돈다).
    void report()
    async function report() {
      if (!nonce) { setSaved(false); return }
      try {
        // ⚠️ ua·screen·detail 은 2026-09-04 에 안 보낸다(서버 컬럼도 드롭). 쓰기만 하고 읽는 곳이
        //    0곳이었다 — 남길 값은 "이 응시권으로 점검을 마쳤다" 는 사실 하나면 충분하다.
        //    화면의 점검 항목 표(전체화면·네트워크·해상도)는 그대로다 — 그건 브라우저에서 바로 본다.
        await callFunction('seb-handoff', { action: 'redeem', nonce })
        setSaved(true)
      } catch {
        setSaved(false)
      }
    }
  }, [nonce])

  // ⛔ requestFullscreen() 을 부르지 않는다. 브라우저는 사용자 클릭 없이는 전체화면을 거부해서,
  //    페이지가 열리자마자 시도하면 무조건 실패한다 — SEB 가 이미 전체화면인데도 ✕ 로 떴다.
  //    확인할 것은 "지금 되나" 가 아니라 "이 브라우저가 전체화면을 허용하나" 다.
  const rows = [
    { ok: isSEB(), label: t('envcheck.row_seb') },
    { ok: !!document.fullscreenEnabled || !!document.fullscreenElement, label: t('envcheck.row_fs') },
    { ok: navigator.onLine, label: t('envcheck.row_net') },
    { ok: window.innerWidth >= 1024, label: t('envcheck.row_screen') },
  ]
  const allOk = rows.every((r) => r.ok) && saved === true

  return (
    <div className="exam-center">
      <div style={{ textAlign: 'center', maxWidth: 520, margin: '0 auto', padding: 24 }}>
        <div style={{ fontSize: 48, marginBottom: 14 }}>{saved === null ? '⏳' : allOk ? '✅' : '⚠️'}</div>
        <h2 className="font-title-md text-title-md font-bold text-on-surface" style={{ marginBottom: 10 }}>
          {saved === null ? t('envcheck.saving') : allOk ? t('envcheck.ok_title') : t('envcheck.warn_title')}
        </h2>
        <p className="font-body-md text-body-md text-on-surface-variant" style={{ marginBottom: 24, lineHeight: 1.65 }}>
          {saved === false ? t('envcheck.save_failed') : allOk ? t('envcheck.ok_desc') : t('envcheck.warn_desc')}
        </p>

        <ul style={{ textAlign: 'left', margin: '0 auto 26px', maxWidth: 360, listStyle: 'none', padding: 0 }}>
          {rows.map((r) => (
            <li key={r.label} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 0' }}>
              <span className="material-symbols-outlined" style={{ color: r.ok ? '#2e7d32' : '#c62828' }}>
                {r.ok ? 'check_circle' : 'cancel'}
              </span>
              <span className="font-body-md text-body-md text-on-surface">{r.label}</span>
            </li>
          ))}
        </ul>

        {/* 점검은 여기서 끝이다 — 나가는 버튼 하나만 준다.
            ⚠️ 전역 탈출 버튼(SebEscapeHatch)은 이 경로에서 안 뜬다(App.tsx) — 같은 버튼이 둘이 되기 때문. */}
        <SebExitButton className="exam-btn" />
      </div>
    </div>
  )
}
