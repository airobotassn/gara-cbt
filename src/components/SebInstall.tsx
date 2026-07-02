import { getDesktopOS } from '../lib/device'
import { sebInstaller } from '../lib/seb'
import { useT } from '../lib/i18n'

// SEB 설치 안내(공유) — OS 감지 다운로드(#5) + 안내 문구(#3: 용량·1회·게시자) +
// 시각적 3단계 가이드(#2: SmartScreen '추가 정보 → 실행' 목업) + 원클릭 실행(#4).
// onLaunch 를 주면 마지막에 "SEB로 시험 열기" 버튼을 노출한다(설치 후 바로 실행 — ExamGate 모달 등).
export default function SebInstall({ onLaunch }: { onLaunch?: () => void }) {
  const { t } = useT()
  const inst = sebInstaller(getDesktopOS())
  const isMac = inst.os === 'mac'
  const osLabel = isMac ? 'macOS' : 'Windows'

  const StepNum = ({ n }: { n: number }) => (
    <span className="w-7 h-7 rounded-full bg-primary-container/10 text-primary-container font-label-sm text-label-sm font-bold flex items-center justify-center shrink-0">
      {n}
    </span>
  )

  return (
    <div className="flex flex-col gap-6">
      {/* 다운로드 버튼 + 안내 문구(#3) */}
      <div className="flex flex-col items-center gap-2">
        <a
          href={inst.url}
          target="_blank"
          rel="noreferrer"
          className="w-full sm:w-auto bg-primary-container text-on-primary font-title-md text-title-md font-bold px-8 py-3.5 rounded-xl hover:translate-y-[-2px] transition-transform duration-200 ambient-shadow inline-flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined text-[20px]">download</span>
          {t('seb.download')} ({osLabel})
        </a>
        <p className="font-label-sm text-label-sm text-on-surface-variant text-center break-keep">
          {t('seb.dl_meta', { size: inst.size })}
        </p>
      </div>

      {/* 시각적 3단계 설치 가이드(#2) */}
      <div className="rounded-2xl bg-surface-container-low border border-outline-variant/40 p-5 flex flex-col gap-4">
        <div className="font-label-md text-label-md font-bold text-on-surface">{t('seb.steps_title')}</div>

        {/* 1. 다운로드 */}
        <div className="flex items-start gap-3">
          <StepNum n={1} />
          <div>
            <div className="font-body-md text-body-md font-semibold text-on-surface">{t('seb.step1_t')}</div>
            <p className="font-body-md text-body-md text-on-surface-variant break-keep leading-relaxed">{t('seb.step1_d')}</p>
          </div>
        </div>

        {/* 2. 실행 (Windows 는 SmartScreen 목업, macOS 는 Gatekeeper 안내) */}
        <div className="flex items-start gap-3">
          <StepNum n={2} />
          <div className="flex-grow min-w-0">
            <div className="font-body-md text-body-md font-semibold text-on-surface">{t('seb.step2_t')}</div>
            {isMac ? (
              <p className="font-body-md text-body-md text-on-surface-variant break-keep leading-relaxed">{t('seb.step2_d_mac')}</p>
            ) : (
              <>
                <p className="font-body-md text-body-md text-on-surface-variant break-keep leading-relaxed">{t('check.install_note2')}</p>
                {/* Windows SmartScreen 목업 — '추가 정보 → 실행' 경로 시각화 */}
                <div className="mt-2 rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-3">
                  <div className="flex items-center gap-1.5 font-body-md text-body-md font-bold text-on-surface">
                    <span className="material-symbols-outlined text-[18px] text-primary-container" style={{ fontVariationSettings: "'FILL' 1" }}>shield</span>
                    {t('seb.dialog_title')}
                  </div>
                  <div className="flex items-center flex-wrap gap-2 mt-2">
                    <span className="font-label-md text-label-md text-primary-container underline">{t('seb.dialog_more')}</span>
                    <span className="material-symbols-outlined text-[16px] text-outline">arrow_forward</span>
                    <span className="font-label-sm text-label-sm font-bold px-3 py-1 rounded-md bg-primary-container text-on-primary">{t('seb.dialog_run')}</span>
                  </div>
                </div>
                <p className="font-label-sm text-label-sm text-outline break-keep mt-2">{t('check.install_note1')}</p>
              </>
            )}
          </div>
        </div>

        {/* 3. 시험 열기 */}
        <div className="flex items-start gap-3">
          <StepNum n={3} />
          <div>
            <div className="font-body-md text-body-md font-semibold text-on-surface">{t('seb.step3_t')}</div>
            <p className="font-body-md text-body-md text-on-surface-variant break-keep leading-relaxed">{t('seb.step3_d')}</p>
          </div>
        </div>
      </div>

      {/* 원클릭 실행(#4) — 설치 후 바로 SEB 실행 */}
      {onLaunch && (
        <button
          onClick={onLaunch}
          className="w-full bg-primary-container text-on-primary font-title-md text-title-md font-bold px-8 py-3.5 rounded-xl hover:translate-y-[-2px] transition-transform duration-200 ambient-shadow inline-flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined text-[20px]">lock_open</span>
          {t('seb.launch_btn')}
        </button>
      )}
    </div>
  )
}
