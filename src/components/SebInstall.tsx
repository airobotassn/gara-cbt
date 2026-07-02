import { getDesktopOS } from '../lib/device'
import { sebInstaller } from '../lib/seb'
import { useT } from '../lib/i18n'

// SEB 설치 안내(공유) — 좁은 팝업에도 들어가게 컴팩트하게. OS 감지 다운로드(#5) + 신뢰 칩(#3) +
// 실제 마찰점 하나(경고 대처)만 '제목 + 클릭경로 칩'으로 압축(#2). onLaunch 주면 실행 버튼(#4).
// ⚠️ 중복 제거: 게시자 문구는 칩으로, SmartScreen 긴 문장은 [추가 정보]→[실행] 칩으로 대체.
export default function SebInstall({ onLaunch }: { onLaunch?: () => void }) {
  const { t } = useT()
  const inst = sebInstaller(getDesktopOS())
  const isMac = inst.os === 'mac'
  const osLabel = isMac ? 'macOS' : 'Windows'

  const chips = [
    { icon: 'check_circle', label: t('seb.chip_once') },
    { icon: 'verified_user', label: t('seb.chip_publisher') },
    { icon: 'download', label: t('seb.chip_size', { size: inst.size }) },
  ]

  const btn =
    'w-full sm:w-auto self-center bg-primary-container text-on-primary font-title-md text-title-md font-bold px-7 py-3 rounded-xl hover:translate-y-[-2px] transition-transform duration-200 ambient-shadow inline-flex items-center justify-center gap-2'

  return (
    <div className="flex flex-col gap-4">
      {/* 다운로드 + 신뢰 칩(#3) */}
      <div className="flex flex-col gap-2.5">
        <a href={inst.url} target="_blank" rel="noreferrer" className={btn}>
          <span className="material-symbols-outlined text-[20px]">download</span>
          {t('seb.download')} · {osLabel}
        </a>
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
          {chips.map((c) => (
            <span key={c.icon} className="inline-flex items-center gap-1 font-label-md text-label-md text-on-surface-variant">
              <span className="material-symbols-outlined text-[16px] text-primary-container" style={{ fontVariationSettings: "'FILL' 1" }}>
                {c.icon}
              </span>
              {c.label}
            </span>
          ))}
        </div>
      </div>

      {/* 경고 대처 — 제목 한 줄 + 클릭 경로 칩(긴 설명 문장 제거) */}
      <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low px-3.5 py-3 flex items-start gap-2.5">
        <span
          className="material-symbols-outlined text-[20px] text-primary-container shrink-0 mt-0.5"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          {isMac ? 'lightbulb' : 'shield'}
        </span>
        <div className="flex flex-col gap-1.5 min-w-0">
          <div className="font-label-md text-label-md font-bold text-on-surface break-keep">{t('seb.warn_title')}</div>
          {isMac ? (
            <p className="font-body-md text-body-md text-on-surface-variant break-keep leading-relaxed">{t('seb.step2_d_mac')}</p>
          ) : (
            <div className="flex items-center flex-wrap gap-1.5">
              <span className="font-label-md text-label-md px-2 py-0.5 rounded bg-surface-container-highest text-on-surface">{t('seb.dialog_more')}</span>
              <span className="material-symbols-outlined text-[16px] text-outline">arrow_forward</span>
              <span className="font-label-md text-label-md font-bold px-2 py-0.5 rounded bg-primary-container text-on-primary">{t('seb.dialog_run')}</span>
            </div>
          )}
        </div>
      </div>

      {/* 원클릭 실행(#4) */}
      {onLaunch && (
        <button onClick={onLaunch} className={btn}>
          <span className="material-symbols-outlined text-[20px]">lock_open</span>
          {t('seb.launch_btn')}
        </button>
      )}
    </div>
  )
}
