import { SEB_DOWNLOAD_URL, sebConfigured, sebLaunchUrl } from '../lib/seb'

// SEB 가 시작 단계에서 내는 대표 영문 오류 → 한국어 원인/해결
const SEB_ERRORS: { code: string; fix: string }[] = [
  {
    code: 'Prohibited Display Configuration',
    fix: '모니터가 2대 이상 연결되어 있습니다. 하나만 남기고 나머지를 분리한 뒤 다시 시작하세요.',
  },
  {
    code: 'running in a virtual machine',
    fix: '가상머신(VM)에서는 응시할 수 없습니다. 실제 PC에서 실행하세요.',
  },
  {
    code: 'Prohibited process(es) detected',
    fix: '차단된 프로그램(원격제어·화면녹화·메신저 등)이 실행 중입니다. 모두 종료한 뒤 다시 시작하세요.',
  },
]

// SEB(보안 브라우저)로만 응시 가능 — 미설치/일반 브라우저 진입 시 안내.
export default function SebRequired() {
  const ready = sebConfigured()
  return (
    <div className="exam-center">
      <div className="exam-card" style={{ textAlign: 'center', maxWidth: 520 }}>
        <div className="exam-ico">🛡️</div>
        <h2 className="exam-title">보안 브라우저로 응시하세요</h2>
        <p className="exam-sub">
          이 시험은 화면 캡처·복사·다른 프로그램 전환을 차단하는{' '}
          <b>Safe Exam Browser(SEB)</b>에서만 응시할 수 있습니다.
        </p>

        <div className="seb-reqs-wrap">
          <h3 className="seb-reqs-title">✅ 응시 전 확인사항</h3>
          <ul className="seb-reqs">
            <li>
              <span>🖥️</span>
              <span>
                모니터는 <b>1대만</b> 연결하세요. 노트북에 외부 모니터를 꽂았다면 <b>분리</b>해야 합니다.
              </span>
            </li>
            <li>
              <span>🔒</span>
              <span>
                <b>Safe Exam Browser</b>가 설치되어 있어야 합니다. (아래 「SEB 설치」)
              </span>
            </li>
            <li>
              <span>🚫</span>
              <span>
                <b>가상머신(VM)·원격제어</b>(TeamViewer·AnyDesk 등)에서는 응시할 수 없습니다.
              </span>
            </li>
            <li>
              <span>❌</span>
              <span>
                <b>화면 녹화·캡처 프로그램</b>과 불필요한 앱을 모두 종료하세요.
              </span>
            </li>
          </ul>
        </div>

        <div className="seb-actions">
          <a className="exam-btn-ghost" href={SEB_DOWNLOAD_URL} target="_blank" rel="noreferrer">
            SEB 설치
          </a>
          {ready ? (
            <a className="exam-btn" href={sebLaunchUrl()}>
              보안 브라우저로 시작
            </a>
          ) : (
            <button className="exam-btn" disabled title="배포 후 .seb 설정이 필요합니다 (docs/SEB설정.md)">
              보안 브라우저로 시작 (설정 전)
            </button>
          )}
        </div>

        <details className="seb-trouble">
          <summary>시작이 안 되고 영어 오류창이 떠요</summary>
          <dl>
            {SEB_ERRORS.map((e) => (
              <div key={e.code}>
                <dt>“{e.code}”</dt>
                <dd>{e.fix}</dd>
              </div>
            ))}
          </dl>
          <p className="seb-trouble-foot">
            그 외 오류가 계속되면 오류창을 캡처해 관리자에게 문의해 주세요.
          </p>
        </details>
      </div>
    </div>
  )
}
