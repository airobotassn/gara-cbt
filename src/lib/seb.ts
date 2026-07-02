// Safe Exam Browser(SEB) 연동 — 보안 브라우저 강제 + 실행 링크.
// 서버 검증·.seb 생성·설정 절차: docs/SEB설정.md 참고.

// 운영(배포)에서만 SEB 강제. 개발/데모는 우회(로컬 테스트 가능).
export const SEB_REQUIRED = import.meta.env.PROD

// SEB 공식 다운로드 페이지(참고)
export const SEB_DOWNLOAD_URL = 'https://safeexambrowser.org/download_en.html'
// 직접 다운로드 — GitHub 공식 릴리스의 코드 서명된 SetupBundle(약 351MB, .NET 등 선행조건 포함).
// SourceForge(광고·미러 선택·"곧 시작" interstitial) 대신 github.com 직링크라 클릭 즉시 받아짐 = 이탈 friction 감소.
// 버전 올릴 때: https://github.com/SafeExamBrowser/seb-win-refactoring/releases/latest 의 SetupBundle 자산으로 교체.
export const SEB_INSTALLER_URL =
  'https://github.com/SafeExamBrowser/seb-win-refactoring/releases/download/v3.10.1/SEB_3.10.1.864_SetupBundle.exe'

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
