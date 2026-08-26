// Safe Exam Browser(SEB) 연동 — 보안 브라우저 강제 + 실행 링크.
// 서버 검증·.seb 생성·설정 절차: docs/SEB설정.md 참고.

// 운영(배포)에서만 SEB 강제. 개발/데모는 우회(로컬 테스트 가능).
export const SEB_REQUIRED = import.meta.env.PROD

// SEB 공식 다운로드 페이지(참고)
export const SEB_DOWNLOAD_URL = 'https://safeexambrowser.org/download_en.html'
// 직접 다운로드 — GitHub 공식 릴리스의 코드 서명 설치본. SourceForge(광고·미러·interstitial) 대신 github.com
// 직링크라 클릭 즉시 받아짐 = 이탈 friction 감소. 버전 올릴 때 각 repo 의 releases/latest 자산으로 교체.
//   Windows: SafeExamBrowser/seb-win-refactoring · macOS: SafeExamBrowser/seb-mac
// ⚠️ **버전을 올리면 그 자산이 실제로 받아지는지 눌러볼 것.** 릴리스 자산은 새 버전이 나오면 사라지기도
//    한다 — mac 3.6.1 이 그렇게 없어져서 **맥 사용자 다운로드가 통째로 404** 였다(2026-08-26 발견).
//    화면은 OS 를 제대로 갈라 링크를 주고 있었고, 링크 끝이 죽어 있던 것이라 코드로는 안 드러났다.
export const SEB_INSTALLER_URL =
  'https://github.com/SafeExamBrowser/seb-win-refactoring/releases/download/v3.10.1/SEB_3.10.1.864_SetupBundle.exe'
export const SEB_INSTALLER_URL_MAC =
  'https://github.com/SafeExamBrowser/seb-mac/releases/download/3.7/SafeExamBrowser-3.7.dmg'

// 접속 OS 에 맞는 설치본(파일·표시 용량). 화면(다운로드 버튼)에서 사용.
import { getDesktopOS } from './device'
export type SebInstaller = { os: 'windows' | 'mac'; url: string; size: string }
export function sebInstaller(os = getDesktopOS()): SebInstaller {
  if (os === 'mac') return { os: 'mac', url: SEB_INSTALLER_URL_MAC, size: '11MB' }
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
//
// nonce 를 주면 링크 끝에 `?h=<nonce>` 를 붙인다. SEB 는 이 쿼리스트링을 **startURL 뒤에 그대로 옮겨**
// 주고(.seb 의 startURLAppendQueryParameter), 그래서 /exam/seb 가 로그인 인계표를 받는다.
// 이게 없으면 SEB 안에는 세션도 표도 없어 응시 자체를 시작하지 못한다(SEB 는 별도 브라우저 프로필이다).
// ⚠️ 표는 주소를 타고 다니므로 접속 로그에 남는다 — 그래서 **수 분짜리 1회용 nonce** 이지 인증수단 본체가
//    아니다. 진짜 인증수단(시험 전용 토큰)은 SEB 안에서 교환해 받는다(seb-handoff).
export function sebLaunchUrl(lang?: string, nonce?: string): string {
  const base = lang && typeof window !== 'undefined'
    ? `${window.location.origin}/gara-${lang}.seb`
    : sebConfigUrl()
  // ⚠️ **물음표가 두 개여야 한다(`??h=`).** SEB 는 설정 URL 의 쿼리에서 `LastIndexOf('?') > 0` 일 때만
  //    뒷부분을 startURL 로 옮긴다(ConfigurationOperation.HandleStartUrlQuery). `?h=` 하나면 위치가 0 이라
  //    조건이 거짓이 되어 **표가 조용히 사라지고**, SEB 안에서 "응시 정보를 확인하지 못했습니다" 가 뜬다.
  //    (2026-08-10 실기기에서 실제로 이 증상을 겪고 소스로 확인했다.)
  return toScheme(nonce ? `${base}??h=${encodeURIComponent(nonce)}` : base)
}

/**
 * SEB 종료 URL — 이 주소에 도달하면 SEB 가 **비밀번호 없이** 스스로 닫힌다(.seb 의 quitURLConfirm=false).
 *
 * ⚠️ `tools/make-seb-all.mjs` 의 `quitURL` 과 **글자 그대로 같아야** 한다. 어긋나면 SEB 는 그냥 평범한
 *    페이지로 알고 안 닫히고, 응시자는 잠긴 화면에 남는다. .seb 를 다시 뽑을 때 양쪽을 같이 볼 것.
 * ⚠️ 이게 앱이 제공하는 **유일한 탈출구**다. SEB 는 뒤로가기·새로고침·주소창이 전부 막혀 있고
 *    수동 종료(Ctrl+Q)에는 비밀번호가 걸려 있어서, 화면에 나가는 버튼이 없으면 재부팅 말고는 방법이 없다
 *    (2026-08-10 실제로 겪음). 막다른 화면을 새로 만들 때는 반드시 <SebExitButton> 을 같이 둘 것.
 */
export function sebQuitUrl(): string {
  return `${window.location.origin}/exam/done`
}

/**
 * 2단계(문제 화면) 설정으로 넘겨받는 주소 — **SEB 안에서만** 쓴다.
 *
 * 왜 설정을 갈아타나: SEB 설정은 세션 단위라 화면별로 다르게 잠글 수 없는데, 두 구간의 요구가 정반대다.
 *   · 1단계(본인인증·오류 안내) — 우리 앱이 안 뜨면 화면에 아무것도 없다. SEB 종료(X)를 막아두면
 *     응시자가 **PC 를 강제 종료**해야 한다. 그래서 X 를 남긴다(아직 시험 전이라 서버가 알 필요도 없다).
 *   · 2단계(문제 화면) — X 로 나가면 우리 페이지를 안 거쳐 **서버가 이탈을 영영 모른다.** 그래서 끈다.
 * 그 경계가 여기다 — '확인' 을 누르면 종료가 막힌 설정으로 세션을 다시 연다(SEB 재구성).
 *
 * ⚠️ **물음표 두 개(`??h=`)가 여기서도 필요하다.** 재구성일 때 SEB 는 이 주소의 쿼리를 새 startURL 뒤에
 *    붙이는데(`HandleStartUrlQuery` → `uri.Query.LastIndexOf('?') > 0`), 하나면 위치가 0 이라 조건이
 *    거짓이 되어 **표가 조용히 사라진다**(처음 SEB 를 띄울 때와 똑같은 함정이다).
 * ⚠️ 스킴을 바꾸지 않는다(`sebs://` 아님). 이미 SEB 안이라 **그냥 .seb 파일로 이동**하면 SEB 가 그걸
 *    설정 내려받기로 알아채 재구성한다. 실기기에서 안 걸리면 그때 스킴 쪽을 시도해 볼 것.
 * ⚠️ 이 이동은 1단계 설정의 `examSessionReconfigureAllow` 가 켜져 있어야 한다(tools/make-seb-all.mjs).
 *    꺼져 있으면 SEB 가 내려받기를 거절하고 **아무 일도 일어나지 않는다**(화면엔 오류도 안 뜬다).
 */
export function sebRunConfigUrl(lang: string | undefined, nonce: string): string {
  const file = lang ? `gara-run-${lang}.seb` : 'gara-run-ko.seb'
  return `${window.location.origin}/${file}??h=${encodeURIComponent(nonce)}`
}

// 모의 응시용 .seb (gara-practice[-<lang>].seb) — 실제와 같은 SEB 잠금 환경에서 연습 문제를 연다.
export function sebPracticeLaunchUrl(lang?: string, nonce?: string): string {
  if (typeof window === 'undefined') return ''
  const file = lang ? `gara-practice-${lang}.seb` : 'gara-practice.seb'
  const base = `${window.location.origin}/${file}`
  // ⚠️ 물음표 두 개(`??h=`) — 하나면 SEB 가 startURL 로 안 옮긴다(sebLaunchUrl 주석 참고).
  //    점검 표는 SEB 안에서 교환될 때 **점검 기록만** 남긴다(시험 자격은 안 나온다).
  return toScheme(nonce ? `${base}??h=${encodeURIComponent(nonce)}` : base)
}
