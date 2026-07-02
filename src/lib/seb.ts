// Safe Exam Browser(SEB) 연동 — 보안 브라우저 강제 + 실행 링크.
// 서버 검증·.seb 생성·설정 절차: docs/SEB설정.md 참고.

// 운영(배포)에서만 SEB 강제. 개발/데모는 우회(로컬 테스트 가능).
export const SEB_REQUIRED = import.meta.env.PROD

// SEB 공식 다운로드 페이지(참고)
export const SEB_DOWNLOAD_URL = 'https://safeexambrowser.org/download_en.html'
// 직접 다운로드 — GitHub 공식 릴리스의 코드 서명 설치본. SourceForge(광고·미러·interstitial) 대신 github.com
// 직링크라 클릭 즉시 받아짐 = 이탈 friction 감소. 버전 올릴 때 각 repo 의 releases/latest 자산으로 교체.
//   Windows: SafeExamBrowser/seb-win-refactoring · macOS: SafeExamBrowser/seb-mac
export const SEB_INSTALLER_URL =
  'https://github.com/SafeExamBrowser/seb-win-refactoring/releases/download/v3.10.1/SEB_3.10.1.864_SetupBundle.exe'
export const SEB_INSTALLER_URL_MAC =
  'https://github.com/SafeExamBrowser/seb-mac/releases/download/3.6.1/SafeExamBrowser-3.6.1.dmg'

// 접속 OS 에 맞는 설치본(파일·표시 용량). 화면(다운로드 버튼)에서 사용.
import { getDesktopOS } from './device'
export type SebInstaller = { os: 'windows' | 'mac'; url: string; size: string }
export function sebInstaller(os = getDesktopOS()): SebInstaller {
  if (os === 'mac') return { os: 'mac', url: SEB_INSTALLER_URL_MAC, size: '12MB' }
  return { os: 'windows', url: SEB_INSTALLER_URL, size: '351MB' } // Windows 기본(other 포함)
}

// 배포 시: .env 에 VITE_SEB_CONFIG_URL = https://<도메인>/gara.seb 지정.
// 개발 시: 현재 origin 의 /gara.seb (public/gara.seb, tools/make-seb.mjs 로 생성) 자동 사용.
const PROD_CONFIG_FALLBACK = 'https://CHANGE-ME/gara.seb'

export function sebConfigUrl(): string {
  const env = import.meta.env.VITE_SEB_CONFIG_URL as string | undefined
  if (env) return env
  // dev/prod 공통: 현재 도메인의 /gara.seb (public/gara.seb 로 배포됨)
  if (typeof window !== 'undefined') return `${window.location.origin}/gara.seb`
  return PROD_CONFIG_FALLBACK
}

// .seb 설정이 실제로 준비됐는지(자리표시자면 false)
export function sebConfigured(): boolean {
  return !/CHANGE-ME/i.test(sebConfigUrl())
}

// 현재 브라우저가 SEB 인지 — UA 의 "SEB/<버전>" 또는 주입된 window.SafeExamBrowser
export function isSEB(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const injected =
    typeof (window as unknown as { SafeExamBrowser?: unknown }).SafeExamBrowser !== 'undefined'
  return /\bSEB\b/i.test(ua) || injected
}

function toScheme(url: string): string {
  return url.replace(/^https:\/\//i, 'sebs://').replace(/^http:\/\//i, 'seb://')
}

// 설정 URL → SEB 실행 스킴(https→sebs://, http→seb://). 클릭 시 설치된 SEB 가 열려 시험을 로드.
// lang 을 주면 언어별 .seb(gara-<lang>.seb)를 사용 — SEB 안에서도 화면 언어가 유지된다.
export function sebLaunchUrl(lang?: string): string {
  if (lang && typeof window !== 'undefined') {
    return toScheme(`${window.location.origin}/gara-${lang}.seb`)
  }
  return toScheme(sebConfigUrl())
}

// 모의 응시용 .seb (gara-practice[-<lang>].seb) — 실제와 같은 SEB 잠금 환경에서 연습 문제를 연다.
export function sebPracticeLaunchUrl(lang?: string): string {
  if (typeof window === 'undefined') return ''
  const file = lang ? `gara-practice-${lang}.seb` : 'gara-practice.seb'
  return toScheme(`${window.location.origin}/${file}`)
}

// SEB(별도 앱)를 실행한다. 시험을 마쳐 SEB 가 닫히고 이 브라우저로 돌아오면 onReturn 을 한 번 호출한다.
// → 응시자가 SEB 에서 나왔을 때 보이는 화면을 (예: 메인으로) 바꿔줄 수 있다.
//
// ⚠️ blur/focus 는 쓰지 않는다: "SEB 여시겠습니까?" 확인창이 뜨면 창이 blur→(취소 시)focus 되어
//    SEB 를 열지도 않았는데 오발동한다. 대신 visibilitychange 로 "이 탭이 실제로 가려졌다가
//    (=SEB 가 화면을 덮음) 다시 보이는지(=SEB 종료)"만 본다. 확인창은 페이지를 가리지 않으므로
//    취소해도 발동하지 않고, SEB 가 아예 안 뜨면 아무 일도 하지 않아 현재 화면에 그대로 머문다.
export function launchSeb(url: string, onReturn: () => void): void {
  let wasHidden = false
  const onVis = () => {
    if (document.hidden) {
      wasHidden = true
      return
    }
    if (wasHidden) {
      document.removeEventListener('visibilitychange', onVis)
      onReturn()
    }
  }
  document.addEventListener('visibilitychange', onVis)
  window.location.href = url
}
