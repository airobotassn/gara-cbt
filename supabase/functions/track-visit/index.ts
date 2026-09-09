// track-visit — 방문 1건을 적재한다. 관리자 홈 대시보드 "방문 통계" 의 유일한 입력.
//
// 브라우저가 라우트를 옮길 때마다 부른다(`src/lib/visitTrack.ts`). 비로그인도 부른다 —
// anon 키가 실려 오므로 **공개 예외가 필요 없다**: `supabase functions deploy track-visit` (플래그 없이).
// ⛔ `--no-verify-jwt` 로 올리지 말 것(chat-translate·seb-handoff 와 같은 이유).
//
// ⚠️ **접속 IP 를 원문 그대로 남긴다**(2026-09-09 지시 — 같은 날 잠깐 마스킹했다가 열었다).
//    ⛔ **개인정보처리방침과 한 벌이다.** 방침 제2조에 '접속 IP 정보' 로 적혀 있고, 제3조의 보유기간
//       (180일)은 DB 크론 `purge_visit_history` 가 실제로 집행한다. **크론을 끄면 방침이 거짓이 된다.**
//    ⛔ **국가는 여전히 브라우저가 알아낸 값이다.** `cf-ipcountry` / IP 로 국가를 정하는 쪽으로 바꾸지 말 것 —
//       `src/lib/geo.ts` 의 2026-08-24 결정은 그대로 살아 있다. 바뀐 건 "IP 를 통계로 본다" 까지다.
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
  // 이 방문(탭)의 첫 요청인가 + 그때의 document.referrer. 첫 요청에만 실려 온다(visitTrack.ts 의 이유).
  entry?: unknown
  ref?: unknown
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

/**
 * referrer → 링크된 서버(host) · 링크된 주소(url).
 *
 * ⚠️ **클라가 보낸 문자열을 그대로 담지 않는다** — URL 로 파싱해서 http(s) 인 것만 받는다.
 *    안 거르면 `javascript:` 같은 값이 관리자 표에 그대로 링크로 서고, 길이도 제한이 없다.
 * ⚠️ 호스트의 `www.` 는 **떼지 않는다.** 레퍼런스가 `facebook.com` 과 `m.facebook.com` 을 다른 줄로
 *    세는 것과 같은 이유 — 모바일 유입과 PC 유입은 다른 정보다.
 */
function parseRef(raw: unknown): { host: string | null; url: string | null } {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return { host: null, url: null }
  try {
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { host: null, url: null }
    return { host: u.hostname.slice(0, 120), url: s.slice(0, 500) }
  } catch {
    return { host: null, url: null }
  }
}

/**
 * 접속 IP. 관리자 '통계 › 접속·유입 › IP주소별' 과 방문자 로그가 읽는다.
 *
 * ⚠️ `x-forwarded-for` 는 **쉼표로 이어진 목록**이고 맨 앞이 클라이언트다. 뒤엣것을 쓰면 프록시 주소가
 *    줄줄이 쌓여 표가 우리 인프라 주소로 채워진다.
 * ⚠️ **모양을 검사해서 넣는다.** 헤더는 클라가 위조할 수 있는 값이라, 거르지 않으면 관리자 표에
 *    아무 문자열이나 줄로 서고 길이 제한도 없어진다(주소가 아닌 값은 버린다).
 * ⚠️ 못 알아내면 null 이다(로컬·헤더 없음). 화면은 그걸 '미상' 한 줄로 남긴다 — 조용히 버리면
 *    합계가 왜 안 맞는지 아무도 못 찾는다.
 */
function clientIp(req: Request): string | null {
  const raw = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
  if (!raw || raw.length > 45) return null
  // IPv4 점 넷 · IPv6 는 16진 그룹과 `::` 만. 둘 중 어느 모양도 아니면 버린다.
  const v4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(raw) && raw.split('.').every((x) => Number(x) <= 255)
  const v6 = raw.includes(':') && /^[0-9a-f:.]+$/i.test(raw)
  return v4 || v6 ? raw : null
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
    const entry = body.entry === true
    const { host: refHost, url: refUrl } = parseRef(entry ? body.ref : '')

    const admin = adminClient()
    const uid = uidFromToken(req.headers.get('Authorization'))
    const device = deviceOf(ua)
    const browser = browserOf(ua)
    const os = osOf(ua)

    // ⛔ **두 표에 같이 쓴다.** 요약(`visit_track`)은 "몇 명이 왔나"를 싸게 세는 자리고,
    //    로그(`visit_log_add`)는 시간별·유입경로·최초 접속 페이지·방문자 로그가 읽는 자리다.
    //    한쪽만 부르면 같은 기간을 두고 두 화면이 다른 숫자를 말한다.
    // ⚠️ 로그 쓰기가 실패해도 요약은 살린다 — 로그는 상한(하루 1000줄)에 걸려 조용히 안 들어갈 수도 있다.
    const [sum, log] = await Promise.all([
      admin.rpc('visit_track', {
        p_visitor: visitorId, p_user: uid, p_path: path, p_country: country,
        p_device: device, p_browser: browser, p_os: os,
      }),
      admin.rpc('visit_log_add', {
        p_visitor: visitorId, p_user: uid, p_path: path, p_country: country,
        p_device: device, p_browser: browser, p_os: os,
        p_ref_host: refHost, p_ref_url: refUrl, p_entry: entry, p_ip: clientIp(req),
      }),
    ])
    if (sum.error) return json({ ok: false, error: sum.error.message }, 500)
    return json({ ok: true, logged: !log.error })
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
