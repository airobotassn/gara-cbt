// Safe Exam Browser(SEB) 연동 — 보안 브라우저 강제 + 실행 링크.
// 서버 검증·.seb 생성·설정 절차: docs/SEB설정.md 참고.

// 운영(배포)에서만 SEB 강제. 개발/데모는 우회(로컬 테스트 가능).
export const SEB_REQUIRED = import.meta.env.PROD

// SEB 공식 다운로드(영문 사이트 — 참고용)
export const SEB_DOWNLOAD_URL = 'https://safeexambrowser.org/download_en.html'

// 우리 도메인에서 받는 설치 파일(권장) — 배포 시 public/seb-setup.exe 에 '공식 서명본'을 넣을 것.
// (응시자가 외부 영어 사이트로 안 가고 우리 한국어 페이지에서 바로 받게)
export const SEB_INSTALLER_URL = '/seb-setup.exe'

// 배포 시: .env 에 VITE_SEB_CONFIG_URL = https://<도메인>/gara.seb 지정.
// 개발 시: 현재 origin 의 /gara.seb (public/gara.seb, tools/make-seb.mjs 로 생성) 자동 사용.
const PROD_CONFIG_FALLBACK = 'https://CHANGE-ME/gara.seb'

export function sebConfigUrl(): string {
  const env = import.meta.env.VITE_SEB_CONFIG_URL as string | undefined
  if (env) return env
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    return `${window.location.origin}/gara.seb`
  }
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

// 설정 URL → SEB 실행 스킴(https→sebs://, http→seb://). 클릭 시 설치된 SEB 가 열려 시험을 로드.
export function sebLaunchUrl(): string {
  return sebConfigUrl()
    .replace(/^https:\/\//i, 'sebs://')
    .replace(/^http:\/\//i, 'seb://')
}
