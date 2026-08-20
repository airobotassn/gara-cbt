import { useEffect, useState } from 'react'
import { isSEB } from '../lib/seb'
import SebExitButton from '../components/SebExitButton'
import { useT } from '../lib/i18n'

// SEB 환경 점검 도착 화면 — 모의 .seb 의 startURL 이 여기다.
//
// ⚠️ **여기서 모의 문제를 풀게 하지 않는다.** 우리가 확인하려는 건 "이 PC 에서 SEB 가 실제로 떴는가"
//    하나뿐이고, 이 화면이 보이는 순간 그게 증명된다. 문제를 끝까지 푸는지는 서버가 알 수도 없고
//    (모의는 채점도 제출도 없다) 알 필요도 없다.
// ⚠️ 점검 기록은 **바깥 브라우저가** 남긴다(ExamCheck). SEB 안에는 로그인 세션이 없어서
//    여기서는 서버에 기록을 남길 수 없다 — 시험 전용 토큰은 응시 계열 두 함수만 받는다.
export default function ExamEnvCheck() {
  const { t } = useT()
  const [full, setFull] = useState(false)

  // 전체화면이 실제로 되는지까지 여기서 확인한다 — 실제 응시가 요구하는 조건이라 미리 걸러야 한다.
  useEffect(() => {
    document.documentElement.requestFullscreen?.()
      .then(() => setFull(true))
      .catch(() => setFull(false))
  }, [])

  const rows = [
    { ok: isSEB(), label: t('envcheck.row_seb') },
    { ok: full || !!document.fullscreenElement, label: t('envcheck.row_fs') },
    { ok: navigator.onLine, label: t('envcheck.row_net') },
    { ok: window.innerWidth >= 1024, label: t('envcheck.row_screen') },
  ]
  const allOk = rows.every((r) => r.ok)

  return (
    <div className="exam-center">
      <div style={{ textAlign: 'center', maxWidth: 520, margin: '0 auto', padding: 24 }}>
        <div style={{ fontSize: 48, marginBottom: 14 }}>{allOk ? '✅' : '⚠️'}</div>
        <h2 className="font-title-md text-title-md font-bold text-on-surface" style={{ marginBottom: 10 }}>
          {allOk ? t('envcheck.ok_title') : t('envcheck.warn_title')}
        </h2>
        <p className="font-body-md text-body-md text-on-surface-variant" style={{ marginBottom: 24, lineHeight: 1.65 }}>
          {allOk ? t('envcheck.ok_desc') : t('envcheck.warn_desc')}
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

        {/* 점검은 여기서 끝이다 — 나가는 버튼 하나만 준다. */}
        <SebExitButton className="exam-btn" />
      </div>
    </div>
  )
}
