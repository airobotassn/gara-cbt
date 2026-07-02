import { getDesktopOS } from '../lib/device'
import { sebInstaller } from '../lib/seb'
import { useT } from '../lib/i18n'

// SEB 설치 안내(공유) — OS 감지 다운로드(#5) + 신뢰 칩(#3: 1회·서명·용량) +
// 실제 마찰점 하나(설치 경고 대처)만 단정한 콜아웃(#2) + 선택적 원클릭 실행(#4).
// ⚠️ ExamCheck Step1 카드(①②③) 안에 놓이므로 자체 번호 스텝은 두지 않는다(번호 중복 방지).
// onLaunch 를 주면 마지막에 "SEB로 시험 열기" 버튼을 노출한다(설치 후 바로 실행).
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

  return (
    <div className="flex flex-col gap-5">
      {/* 다운로드 + 신뢰 칩(#3) — 작은 회색 fine-print 대신 아이콘 칩으로 신뢰감 */}
      <div className="flex flex-col gap-3">
        <a
          href={inst.url}
          target="_blank"
          rel="noreferrer"
          className="w-full sm:w-auto self-start bg-primary-container text-on-primary font-title-md text-title-md font-bold px-8 py-3.5 rounded-xl hover:translate-y-[-2px] transition-transform duration-200 ambient-shadow inline-flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined text-[20px]">download</span>
          {t('seb.download')} · {osLabel}
        </a>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {chips.map((c) => (
            <span key={c.icon} className="inline-flex items-center gap-1.5 font-label-md text-label-md text-on-surface-variant">
              <span className="material-symbols-outlined text-[18px] text-primary-container" style={{ fontVariationSettings: "'FILL' 1" }}>
                {c.icon}
              </span>
              {c.label}
            </span>
          ))}
        </div>
      </div>

      {/* 실제 마찰점 하나만 단정한 콜아웃(#2) — 중첩 박스·중복 번호 없음 */}
      <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-4 flex gap-3">
        <span
          className="material-symbols-outlined text-primary-container shrink-0 mt-0.5"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          {isMac ? 'lightbulb' : 'shield'}
        </span>
        <div className="flex flex-col gap-2 min-w-0">
          <div className="font-label-md text-label-md font-bold text-on-surface">{t('seb.warn_title')}</div>
          {isMac ? (
            <p className="font-body-md text-body-md text-on-surface-variant break-keep leading-relaxed">{t('seb.step2_d_mac')}</p>
          ) : (
            <>
              <p className="font-body-md text-body-md text-on-surface-variant break-keep leading-relaxed">{t('check.install_note2')}</p>
              {/* '추가 정보 → 실행' 클릭 경로를 칩으로 시각화 */}
              <div className="flex items-center flex-wrap gap-2 my-0.5">
                <span className="font-label-md text-label-md px-2.5 py-1 rounded-md bg-surface-container-highest text-on-surface">{t('seb.dialog_more')}</span>
                <span className="material-symbols-outlined text-[18px] text-outline">arrow_forward</span>
                <span className="font-label-md text-label-md font-bold px-2.5 py-1 rounded-md bg-primary-container text-on-primary">{t('seb.dialog_run')}</span>
              </div>
              <p className="font-body-md text-body-md text-on-surface-variant break-keep leading-relaxed">{t('check.install_note1')}</p>
            </>
          )}
        </div>
      </div>

      {/* 원클릭 실행(#4) — 설치 후 바로 SEB 실행 */}
      {onLaunch && (
        <button
          onClick={onLaunch}
          className="w-full sm:w-auto self-start bg-primary-container text-on-primary font-title-md text-title-md font-bold px-8 py-3.5 rounded-xl hover:translate-y-[-2px] transition-transform duration-200 ambient-shadow inline-flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined text-[20px]">lock_open</span>
          {t('seb.launch_btn')}
        </button>
      )}
    </div>
  )
}
