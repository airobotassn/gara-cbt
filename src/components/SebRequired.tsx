import { SEB_DOWNLOAD_URL, sebConfigured, sebLaunchUrl } from '../lib/seb'
import { useT } from '../lib/i18n'

// SEB 가 시작 단계에서 내는 대표 영문 오류 → 안내 키
const SEB_ERRORS: { code: string; fixKey: string }[] = [
  { code: 'Prohibited Display Configuration', fixKey: 'seb.err_display' },
  { code: 'running in a virtual machine', fixKey: 'seb.err_vm' },
  { code: 'Prohibited process(es) detected', fixKey: 'seb.err_process' },
]

// SEB(보안 브라우저)로만 응시 가능 — 미설치/일반 브라우저 진입 시 안내.
export default function SebRequired() {
  const { t, lang } = useT()
  const ready = sebConfigured()
  return (
    <div className="exam-center">
      <div className="exam-card" style={{ textAlign: 'center', maxWidth: 520 }}>
        <div className="exam-ico">🛡️</div>
        <h2 className="exam-title">{t('seb.title')}</h2>
        <p className="exam-sub">{t('seb.sub')}</p>

        <div className="seb-reqs-wrap">
          <h3 className="seb-reqs-title">{t('seb.reqs_title')}</h3>
          <ul className="seb-reqs">
            <li>
              <span>🖥️</span>
              <span>{t('seb.req_monitor')}</span>
            </li>
            <li>
              <span>🔒</span>
              <span>{t('seb.req_install')}</span>
            </li>
            <li>
              <span>🚫</span>
              <span>{t('seb.req_vm')}</span>
            </li>
            <li>
              <span>❌</span>
              <span>{t('seb.req_record')}</span>
            </li>
          </ul>
        </div>

        <div className="seb-actions">
          <a className="exam-btn-ghost" href={SEB_DOWNLOAD_URL} target="_blank" rel="noreferrer">
            {t('seb.install')}
          </a>
          {ready ? (
            <a className="exam-btn" href={sebLaunchUrl(lang)}>
              {t('seb.start')}
            </a>
          ) : (
            <button className="exam-btn" disabled title="배포 후 .seb 설정이 필요합니다 (docs/SEB설정.md)">
              {t('seb.start_unset')}
            </button>
          )}
        </div>

        <details className="seb-trouble">
          <summary>{t('seb.trouble_summary')}</summary>
          <dl>
            {SEB_ERRORS.map((e) => (
              <div key={e.code}>
                <dt>“{e.code}”</dt>
                <dd>{t(e.fixKey)}</dd>
              </div>
            ))}
          </dl>
          <p className="seb-trouble-foot">{t('seb.trouble_foot')}</p>
        </details>
      </div>
    </div>
  )
}
