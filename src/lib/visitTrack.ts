// 방문 기록 — 라우트가 바뀔 때마다 `track-visit` 함수에 한 줄 보낸다.
// 관리자 홈 대시보드 "방문 통계"(국가·지역·기기·브라우저)의 유일한 입력이다.
//
// ⛔ **국가는 브라우저가 알아내서 보낸다 — 서버가 IP 로 정하지 않는다.** `lib/geo.ts` 의 2026-08-24
//    결정 그대로다(그 파일 머리 주석에 이유가 있다). 서버에서 IP 로 국가를 뽑는 쪽으로 옮기지 말 것.
// ⚠️ 2026-09-09 부터 서버(`track-visit`)가 접속 IP 의 **뒷자리를 가린 대역**(`185.93.89.*`)을 방문 로그에
//    남긴다. 여기서 보낼 것은 없다(헤더는 서버만 볼 수 있다) — 바뀐 건 그 한 가지고 국가는 그대로다.
// ⚠️ 지역(시도)은 여기서 보내지 않는다. 관리자 화면이 조회할 때 `profiles.region_code` 를 조인한다 —
//    그래야 사용자가 나중에 지역을 정정해도 옛 기록까지 같이 맞춰진다.
// ⚠️ 실패는 전부 삼킨다. 통계가 안 쌓이는 것보다 화면에 오류가 뜨는 게 나쁘다.
import { fnUrl, supabaseAnonKey, isSupabaseConfigured, supabase } from './supabase'
import { fetchGeoPrefill } from './geo'

const VID_KEY = 'gara_visitor_id' // 브라우저 난수(사람이 아니라 브라우저를 센다)
const GEO_KEY = 'gara_visit_geo' // 'YYYY-MM-DD|KR' — 하루 한 번만 물어보려고 캐시한다
const ENTRY_KEY = 'gara_visit_entry' // 이 탭에서 이미 첫 화면을 보냈나(sessionStorage = 탭 단위)

/**
 * 이 방문(탭)의 **첫 요청인가**. 맞으면 `document.referrer` 를 같이 보낸다.
 *
 * ⛔ **referrer 를 매번 보내지 말 것.** SPA 는 화면을 옮겨도 `document.referrer` 가 안 바뀌어서,
 *    매번 보내면 외부 유입 1건이 **그 사람이 본 화면 수만큼 뻥튀기**된다(페이스북에서 온 1명이 20건).
 * ⚠️ 판정은 `sessionStorage` 라 **탭 단위**다 — 새 탭으로 열면 그 탭의 첫 화면이 다시 최초 접속으로
 *    잡힌다. 그게 맞다(그 탭은 실제로 밖에서 들어온 것이다).
 */
function takeEntry(): { entry: boolean; ref: string } {
  try {
    if (sessionStorage.getItem(ENTRY_KEY)) return { entry: false, ref: '' }
    sessionStorage.setItem(ENTRY_KEY, '1')
  } catch {
    // 저장이 막힌 브라우저 — 매 요청이 '최초 접속' 이 되면 숫자가 부풀므로 아예 안 보낸다.
    return { entry: false, ref: '' }
  }
  // 우리 도메인에서 온 것은 내부 이동이라 유입이 아니다(새로고침·같은 사이트 링크).
  const r = document.referrer || ''
  try {
    if (r && new URL(r).hostname === location.hostname) return { entry: true, ref: '' }
  } catch { /* 이상한 referrer 는 그냥 버린다 */ }
  return { entry: true, ref: r.slice(0, 500) }
}

/** 안 보내는 곳. 관리자 자기 발자국과 개발 서버가 섞이면 숫자가 통째로 못 믿을 것이 된다. */
function skipPath(path: string): boolean {
  return path === '/admin' || path.startsWith('/admin/')
}
function skipHost(): boolean {
  const h = location.hostname
  return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local')
}

function visitorId(): string {
  try {
    let v = localStorage.getItem(VID_KEY)
    if (!v) {
      v = crypto.randomUUID()
      localStorage.setItem(VID_KEY, v)
    }
    return v
  } catch {
    // 저장이 막힌 브라우저(사생활 보호 모드 등) — 그 방문은 매번 새 사람으로 세어진다.
    return crypto.randomUUID()
  }
}

const todayKst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)

/**
 * 국가 코드(캐시). 하루 한 번만 제3자에게 물어본다 — 페이지 이동마다 물으면 방문자 한 명이
 * 하루에 수십 번 외부 요청을 하게 된다. 못 알아내면 null 이고, 그 방문은 화면에서 '미상'으로 뜬다.
 */
async function country(): Promise<string | null> {
  const day = todayKst()
  try {
    const [d, c] = (localStorage.getItem(GEO_KEY) ?? '').split('|')
    if (d === day) return c || null
  } catch { /* 캐시를 못 읽으면 그냥 물어본다 */ }
  const { country_code } = await fetchGeoPrefill()
  try {
    // 못 알아낸 것도 캐시한다(빈 값) — 차단된 브라우저가 하루 종일 재시도하지 않게.
    localStorage.setItem(GEO_KEY, `${day}|${country_code ?? ''}`)
  } catch { /* 저장 실패는 무시 */ }
  return country_code
}

// 같은 화면을 짧은 사이에 두 번 세지 않는다. React StrictMode 의 이펙트 2회 실행과
// 같은 곳으로 되돌아오는 이동(뒤로가기 연타)을 여기서 막는다.
let lastPath = ''
let lastAt = 0

export function trackVisit(path: string): void {
  if (!isSupabaseConfigured || skipHost() || skipPath(path)) return
  const now = Date.now()
  if (path === lastPath && now - lastAt < 30_000) return
  lastPath = path
  lastAt = now

  // ⚠️ '첫 화면인가' 는 **여기서(=이동이 확정된 시점) 뽑는다.** 아래 setTimeout 안에서 뽑으면
  //    1.2초 사이에 화면을 한 번 더 옮긴 사람의 첫 화면이 두 번째 화면으로 기록된다.
  const { entry, ref } = takeEntry()

  // 첫 화면 그리기와 경쟁시키지 않는다 — 통계는 한 박자 늦어도 아무 문제가 없다.
  setTimeout(() => {
    void (async () => {
      try {
        const [c, { data }] = await Promise.all([country(), supabase.auth.getSession()])
        await fetch(fnUrl('track-visit'), {
          method: 'POST',
          keepalive: true, // 보내는 도중에 화면을 떠나도 요청이 살아남는다
          headers: {
            'Content-Type': 'application/json',
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${data.session?.access_token ?? supabaseAnonKey}`,
          },
          body: JSON.stringify({ visitorId: visitorId(), path, country: c, entry, ref }),
        })
      } catch { /* 기록 실패는 삼킨다 */ }
    })()
  }, 1200)
}
