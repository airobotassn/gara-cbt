// 로그인 후 돌아갈 자리 — 심는 곳과 읽는 곳의 단일 출처 (2026-08-24)
//
// 왜 파일로 뺐나: 심는 쪽(허브·결제·이북·뷰어·미니게임)은 전부 `sessionStorage` 에 썼는데
// **읽는 쪽이 둘**이었고 그중 하나(`Landing`)가 `localStorage` 를 보고 있었다. 그래서
// "로그인이 홈으로 떨어졌을 때 되돌려 보내는" 안전망이 통째로 죽어 있었다 — 심은 사람은
// 아무도 localStorage 에 쓰지 않는다. 두 저장소를 손으로 맞춰 쓰는 대신 여기 한 곳에 모은다.
//
// ⚠️ **왜 두 저장소에 같이 쓰나**: 복귀가 어디로 떨어지는지가 한 가지가 아니다.
//    · 정상 경로 = `/auth/callback` (같은 탭이라 sessionStorage 로 충분)
//    · 그런데 Supabase 는 `redirectTo` 가 허용목록에 없으면 **Site URL(=홈)** 로 떨어뜨린다.
//      로컬 개발 서버를 5173 이 아닌 포트로 띄우면 바로 이 경우가 되고, 그때는 아예
//      **다른 오리진(배포 주소)** 이라 sessionStorage 가 없다. localStorage 사본이 그 자리를 받는다.
//
// ⚠️ localStorage 사본에는 **유효시간**이 붙는다. 세션 저장소와 달리 탭을 닫아도 남기 때문에,
//    결제를 하다 그만둔 사람이 며칠 뒤 다른 화면에서 로그인했을 때 난데없이 결제 화면으로
//    튀는 일을 막아야 한다. 30분이면 로그인 왕복(OAuth 동의·계정 선택)에는 충분히 넉넉하다.

const KEY = 'postLoginRedirect'
const TTL_MS = 30 * 60 * 1000

/** 우리 앱 안의 경로인지. 주소를 그대로 믿고 이동하면 오픈 리다이렉트가 된다(`//evil.com` 는 외부다). */
function isInternalPath(p: string): boolean {
  return p.startsWith('/') && !p.startsWith('//')
}

/** 로그인 직전에 부른다 — 돌아올 자리를 심는다. 쿼리스트링(담은 교재·묶음 목록)까지 그대로 넣을 것. */
export function rememberPostLogin(path: string): void {
  if (!isInternalPath(path)) return
  try { sessionStorage.setItem(KEY, path) } catch { /* 무시 */ }
  try { localStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() })) } catch { /* 무시 */ }
}

/**
 * 로그인 직후에 부른다 — 심어둔 자리를 꺼내고 **양쪽 저장소에서 지운다**.
 * 한 번 쓰면 사라져야 한다(안 지우면 그 뒤로 홈에 갈 때마다 같은 곳으로 끌려간다).
 */
export function takePostLogin(): string | null {
  let path: string | null = null
  try { path = sessionStorage.getItem(KEY) } catch { /* 무시 */ }
  if (!path) {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) {
        // 옛 값은 그냥 경로 문자열이었다 — JSON 이 아니어도 견딘다.
        const v: unknown = raw.startsWith('{') ? JSON.parse(raw) : { path: raw, at: Date.now() }
        const o = v as { path?: unknown; at?: unknown }
        if (typeof o.path === 'string' && typeof o.at === 'number' && Date.now() - o.at < TTL_MS) {
          path = o.path
        }
      }
    } catch { /* 무시 */ }
  }
  clearPostLogin()
  return path && isInternalPath(path) ? path : null
}

/** 심어둔 자리를 버린다(로그인 없이 떠난 경우). */
export function clearPostLogin(): void {
  try { sessionStorage.removeItem(KEY) } catch { /* 무시 */ }
  try { localStorage.removeItem(KEY) } catch { /* 무시 */ }
}
