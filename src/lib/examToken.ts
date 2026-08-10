// SEB 안에서만 쓰는 시험 전용 토큰의 보관소.
//
// SEB 는 별도 브라우저 프로필이라 로그인 세션이 없다. 대신 /exam/seb 가 인계표(nonce)를 토큰으로
// 바꿔 여기 담고, 응시 계열 호출(start-exam · submit-exam)이 이 토큰을 헤더로 실어 보낸다.
// 서버 쪽 설명은 supabase/functions/_shared/exam-token.ts 머리말.
//
// ⚠️ sessionStorage 인 이유: /exam/seb → /exam/run/:id 로 넘어가고 그 화면이 새로고침될 수 있어
//    메모리로는 부족하고, 탭을 닫으면 사라져야 하므로 localStorage 여서도 안 된다.
// ⚠️ 일반 브라우저에서는 이 값이 없어야 정상이다 — 세션이 있으면 서버가 세션을 먼저 본다.

const KEY = 'examToken'

export function setExamToken(token: string) {
  try {
    sessionStorage.setItem(KEY, token)
  } catch {
    /* 저장이 막힌 환경 — 아래 getExamToken 이 빈 값을 주고 호출이 401 로 떨어진다 */
  }
}

export function getExamToken(): string {
  try {
    return sessionStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function clearExamToken() {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* 무시 */
  }
}

/** 응시 계열 호출에 붙일 헤더. 토큰이 없으면 undefined 라 평소(세션) 경로가 그대로 동작한다. */
export function examAuthHeaders(): Record<string, string> | undefined {
  const t = getExamToken()
  return t ? { 'x-exam-token': t } : undefined
}

/**
 * 주소에서 인계표(nonce)를 꺼낸다.
 *
 * ⚠️ `useSearchParams` 로만 읽지 않는 이유 — SEB 가 startURL 뒤에 쿼리를 붙일 때 '?' 를 쓸지 '&' 를 쓸지가
 *    버전마다 다를 수 있고, startURL 에 이미 `?lang=ko` 가 있어서 `?lang=ko?h=…` 같은 모양이 나오면
 *    표준 파서로는 h 가 통째로 안 잡힌다. 원문에서 직접 긁어야 어느 경우든 걸린다.
 */
export function readHandoffNonce(search: string): string {
  const m = /[?&]h=([^&?#]+)/.exec(search)
  return m ? decodeURIComponent(m[1]) : ''
}

/**
 * 주소창에서 인계표를 지운다. 표는 1회용이라 남아 있어도 못 쓰지만,
 * 화면 캡처·어깨너머로 새어나갈 이유를 만들지 않는다.
 */
export function stripHandoffFromUrl() {
  try {
    const url = new URL(window.location.href)
    const cleaned = `${url.pathname}${url.search.replace(/[?&]h=[^&?#]*/g, '')}`.replace(/\?&/, '?')
    window.history.replaceState(null, '', cleaned || url.pathname)
  } catch {
    /* 무시 — 표시상의 문제일 뿐 동작에 영향 없다 */
  }
}
