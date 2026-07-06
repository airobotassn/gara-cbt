import { getDesktopOS } from '../lib/device'
import { sebInstaller } from '../lib/seb'
import { useT } from '../lib/i18n'

// SEB 설치 안내(공유) — 정보 설계 우선.
//  · 다운로드 버튼 → 프로그램 정보(라벨:값 — 프로그램/만든 곳/설치) → 설치 경고 대처.
//  · 경고는 "무슨 창이 뜨는지(제목) + 왜 괜찮고 뭘 누르면 되는지(문장)"로 완결되게.
//  · onLaunch 주면 실행 버튼 노출.
export default function SebInstall({ onLaunch }: { onLaunch?: () => void }) {
  const { t } = useT()
  const inst = sebInstaller(getDesktopOS())
  const isMac = inst.os === 'mac'
  const osLabel = isMac ? 'macOS' : 'Windows'

  const facts: [string, string][] = [
    [t('seb.fact_program'), `Safe Exam Browser (${osLabel})`],
    [t('seb.fact_maker'), t('seb.fact_maker_v')],
    [t('seb.fact_install'), `${t('seb.chip_once')} · ${t('seb.chip_size', { size: inst.size })}`],
  ]

  const btn =
    'w-full sm:w-auto sm:self-start shrink-0 bg-primary-container text-on-primary font-title-md text-title-md font-bold px-7 py-3 rounded-xl hover:translate-y-[-2px] transition-transform duration-200 ambient-shadow inline-flex items-center justify-center gap-2'

  const kbd =
    'inline-flex items-center align-middle px-2 py-0.5 mx-0.5 rounded-md border border-outline-variant/60 bg-surface-container-low font-label-md text-label-md text-on-surface whitespace-nowrap'

  return (
    <div className="flex flex-col gap-6">
      {/* 다운로드 */}
      <a href={inst.url} target="_blank" rel="noreferrer" className={btn}>
        <span className="material-symbols-outlined text-[20px]">download</span>
        {t('seb.download')}
      </a>

      {/* 프로그램 정보 — 라벨:값 */}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2.5">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-label-md text-label-md font-bold text-on-surface-variant pt-px whitespace-nowrap">{k}</dt>
            <dd className="font-body-md text-body-md text-on-surface break-keep leading-relaxed">{v}</dd>
          </div>
        ))}
      </dl>

      {/* 설치 경고 대처 */}
      <div className="border-t border-outline-variant/30 pt-5 flex items-start gap-3">
        <span
          className="material-symbols-outlined text-[20px] text-primary-container shrink-0 mt-0.5"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          {isMac ? 'lightbulb' : 'shield'}
        </span>
        <div className="min-w-0">
          <div className="font-label-md text-label-md font-bold text-on-surface break-keep">
            {isMac ? t('seb.warn_title') : t('seb.warn_title_win', { dialog: t('seb.dialog_title') })}
          </div>
          {isMac ? (
            <p className="mt-1.5 font-body-md text-body-md text-on-surface-variant break-keep leading-relaxed">{t('seb.step2_d_mac')}</p>
          ) : (
            <p className="mt-1.5 font-body-md text-body-md text-on-surface-variant break-keep leading-loose">
              {t('seb.warn_body_pre')} <span className={kbd}>{t('seb.dialog_more')}</span>
              <span className="material-symbols-outlined align-middle text-[14px] text-outline mx-0.5">arrow_forward</span>
              <span className={`${kbd} font-bold`}>{t('seb.dialog_run')}</span> {t('seb.warn_body_post')}
            </p>
          )}
        </div>
      </div>

      {/* 원클릭 실행 */}
      {onLaunch && (
        <button onClick={onLaunch} className={btn}>
          <span className="material-symbols-outlined text-[20px]">lock_open</span>
          {t('seb.launch_btn')}
        </button>
      )}
    </div>
  )
}
