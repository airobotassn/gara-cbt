// track-visit — 방문 1건을 적재한다. 관리자 홈 대시보드 "방문 통계" 의 유일한 입력.
//
// 브라우저가 라우트를 옮길 때마다 부른다(`src/lib/visitTrack.ts`). 비로그인도 부른다 —
// anon 키가 실려 오므로 **공개 예외가 필요 없다**: `supabase functions deploy track-visit` (플래그 없이).
// ⛔ `--no-verify-jwt` 로 올리지 말 것(chat-translate·seb-handoff 와 같은 이유).
//
// ⛔ **IP 를 보지 않는다.** 국가는 브라우저가 알아내서 두 글자로 실어 보낸 것을 그대로 받는다
//    (`src/lib/geo.ts` 의 2026-08-24 결정 — 그 이유는 마이그레이션 머리 주석에 옮겨 적어 뒀다).
//    `x-forwarded-for` / `cf-ipcountry` 를 읽는 코드를 여기 넣지 말 것.
// ⛔ **User-Agent 원문을 저장하지 않는다.** 여기서 기기·브라우저·OS 세 글자로 접어서 넣는다.
//    원문은 지문(fingerprint)이 되고, 저장해봐야 화면이 쓰는 건 접힌 값뿐이다.
//
// ⚠️ _shared 를 import 하므로 CLI 배포 전용(대시보드 웹에디터는 `../_shared` 가 깨진다).
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient } from '../_shared/lib.ts'

interface Body {
  visitorId?: unknown
  path?: unknown
  country?: unknown
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// 사람이 아닌 것. 자바스크립트를 도는 크롤러는 드물지만, 프리뷰 봇(카톡·슬랙 링크 펼치기)은 실제로 돈다.
const BOT_RE = /bot|crawler|spider|slurp|headless|lighthouse|preview|facebookexternalhit|bingpreview|curl|wget|python-requests|axios|node-fetch/i

/**
 * 화면 주소를 **집계 단위**로 접는다. 안 접으면 `/test/result/<uuid>` 같은 주소가 방문자 수만큼
 * 다른 줄로 쌓여 인기 화면 목록이 통째로 쓸모없어지고, 표의 행 수 바닥(PK 의 path)도 같이 무너진다.
 *   ⚠️ 쿼리스트링은 통째로 버린다 — `?next=`·`?ref=` 에 남의 주소나 초대코드가 섞여 들어온다.
 */
function normalizePath(raw: string): string {
  let p = raw.split('?')[0].split('#')[0].trim()
  if (!p.startsWith('/')) return ''
  if (p.length > 1) p = p.replace(/\/+$/, '')
  const seg = p.split('/')
  for (let i = 1; i < seg.length; i++) {
    const s = seg[i]
    if (UUID_RE.test(s) || /^\d+$/.test(s)) seg[i] = ':id'
  }
  p = seg.join('/')
  // 남의 손잡이(방 handle)·인증서 토큰은 형태가 자유라 위 규칙에 안 걸린다. 자리로 짚는다.
  p = p.replace(/^\/(room|verify)\/[^/]+/, '/$1/:id')
  p = p.replace(/^\/ebooks\/read\/[^/]+/, '/ebooks/read/:id')
  return p.slice(0, 120) || '/'
}

/** mobile | tablet | desktop */
function deviceOf(ua: string): string {
  if (/ipad|tablet|playbook|silk/.test(ua) || (/android/.test(ua) && !/mobile/.test(ua))) return 'tablet'
  if (/mobile|iphone|ipod|android|windows phone/.test(ua)) return 'mobile'
  return 'desktop'
}

/**
 * ⚠️ 순서가 곧 규칙이다. 엣지·삼성·웨일·오페라는 UA 에 `chrome` 을 그대로 달고 다니고,
 *    크롬은 `safari` 를 달고 다닌다 — 넓은 것부터 보면 전부 크롬/사파리로 뭉친다.
 */
function browserOf(ua: string): string {
  if (/edg[ea]?\//.test(ua)) return 'Edge'
  if (/samsungbrowser/.test(ua)) return 'Samsung'
  if (/whale/.test(ua)) return 'Whale'
  if (/opr\/|opera/.test(ua)) return 'Opera'
  if (/firefox|fxios/.test(ua)) return 'Firefox'
  if (/chrome|crios|chromium/.test(ua)) return 'Chrome'
  if (/safari/.test(ua)) return 'Safari'
  return '기타'
}

function osOf(ua: string): string {
  if (/iphone|ipad|ipod/.test(ua)) return 'iOS'
  if (/android/.test(ua)) return 'Android'
  if (/windows/.test(ua)) return 'Windows'
  if (/mac os x|macintosh/.test(ua)) return 'macOS'
  if (/linux|x11|cros/.test(ua)) return 'Linux'
  return '기타'
}

/**
 * 토큰에서 uid 만 꺼낸다. **검증하지 않는다** — `verify_jwt` 가 켜져 있어 게이트웨이가 이미
 * 서명을 확인한 뒤에만 여기 닿는다. 방문 1건마다 auth 서버로 왕복하지 않으려고 이렇게 한다
 * (getUser 를 쓰면 페이지 이동마다 네트워크 왕복이 하나 더 붙는다).
 * anon 키에는 `sub` 가 없다 → 비로그인 방문은 그대로 null.
 */
function uidFromToken(auth: string | null): string | null {
  try {
    const raw = (auth ?? '').replace(/^Bearer\s+/i, '')
    const part = raw.split('.')[1]
    if (!part) return null
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')
    const claims = JSON.parse(atob(b64)) as { sub?: unknown }
    return typeof claims.sub === 'string' && UUID_RE.test(claims.sub) ? claims.sub : null
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const ua = (req.headers.get('user-agent') ?? '').toLowerCase()
    // 봇은 조용히 흘린다. 200 을 주는 이유: 400 을 주면 브라우저 콘솔에 빨간 줄이 남는데,
    // 방문 기록이 안 남는 건 사용자가 알아야 할 일이 아니다.
    if (BOT_RE.test(ua)) return json({ ok: false, skipped: 'bot' })

    const body = (await req.json().catch(() => ({}))) as Body
    const visitorId = typeof body.visitorId === 'string' ? body.visitorId : ''
    const path = normalizePath(typeof body.path === 'string' ? body.path : '')
    if (!UUID_RE.test(visitorId) || !path) return json({ ok: false, skipped: 'invalid' })

    const rawCountry = typeof body.country === 'string' ? body.country.toUpperCase() : ''
    const country = /^[A-Z]{2}$/.test(rawCountry) ? rawCountry : null

    const admin = adminClient()
    const { error } = await admin.rpc('visit_track', {
      p_visitor: visitorId,
      p_user: uidFromToken(req.headers.get('Authorization')),
      p_path: path,
      p_country: country,
      p_device: deviceOf(ua),
      p_browser: browserOf(ua),
      p_os: osOf(ua),
    })
    if (error) return json({ ok: false, error: error.message }, 500)
    return json({ ok: true })
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
