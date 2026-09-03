// Bunny Stream — 서명된 임베드 URL 발급 + 썸네일 주소.
//
// 유료 강의를 유튜브로 팔 수 없어서 들어온 것이다(유튜브는 영상 id 만 알면 누구나 본다).
// Bunny 는 **서명이 맞아야만** 재생기가 뜬다.
//
// ── 흐름 (관문이 두 개다) ────────────────────────────────────────
//   1) 브라우저 iframe → 임베드 호스트(iframe.mediadelivery.net)
//      여기서 token·expires 를 검사하고, 통과하면 **플레이어(HTML+JS)** 를 내려준다.
//   2) 그 플레이어 → 풀존(vz-xxxx.b-cdn.net)
//      화질 목록(playlist.m3u8) → 조각 목록 → 조각 파일 수백 개. **여기엔 우리 토큰이 안 붙는다.**
//   그래서 2)를 막는 건 Bunny 대시보드의 **허용 도메인(Allowed Domains)** 이다(referer 검사).
//
// ⛔ **대시보드에서 "Embed View Token Authentication" 을 켜야 토큰이 의미를 갖는다.**
//    안 켜면 Bunny 는 token 을 아예 안 보고 그냥 재생시킨다 — 이 파일이 아무리 맞아도 **무방비**고,
//    화면상으로는 정상으로 보여서 티가 안 난다. 배포 뒤 검증에서 **일부러 토큰을 틀리게 보내
//    거절되는지** 확인할 것(거절 안 되면 스위치가 꺼진 것이다).
//
// ⛔ **토큰 키는 서버 밖으로 나가면 안 된다.** 키 하나로 모든 영상의 토큰을 무제한 만들 수 있다.
//    프론트로 내려보내지 말고, 에러 로그에 URL 을 통째로 남기지 말 것.
//    (유출돼서 키를 갈면 이미 발급된 토큰이 전부 죽는다 — 만료가 3시간이라 여파도 최대 3시간이다.)

/** 영상 라이브러리 id. ⚠️ 강의 행이 아니라 **계정 설정**이라 여기(시크릿)가 단일 출처다. */
const LIBRARY_ID = Deno.env.get('BUNNY_STREAM_LIBRARY_ID') ?? ''
/** 토큰 보안 키 — 대시보드 **Video Library → Security** 탭의 `Token Authentication Key` 다.
 *  ⛔ **API 탭의 `API Key` 가 아니다.** 둘 다 UUID 모양이라 헷갈리는데, API Key 로 서명하면
 *     Bunny 가 임베드를 **403** 으로 거절한다(2026-09-03 실기기 확인 — 영상·도메인 설정은 멀쩡한데
 *     토큰만 틀려서 몇 시간 헤맸다). API Key 는 영상을 관리하는 열쇠고, 서명 키는 그 옆 Security 탭에 따로 있다. */
const TOKEN_KEY = Deno.env.get('BUNNY_STREAM_TOKEN_KEY') ?? ''
/** 풀존 호스트(`vz-xxxx.b-cdn.net`). 썸네일 주소를 만드는 데만 쓴다. */
const PULLZONE = (Deno.env.get('BUNNY_STREAM_PULLZONE') ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '')
/** 임베드 호스트. 새 플레이어는 `player.mediadelivery.net`, 옛 것은 `iframe.…` 이고 둘 다 산다.
 *  ⚠️ 라이브러리를 새로 만들었는데 재생이 안 되면 여기부터 의심할 것 — 코드 고치지 말고 시크릿으로 바꾼다. */
const EMBED_HOST = Deno.env.get('BUNNY_STREAM_EMBED_HOST') ?? 'iframe.mediadelivery.net'

/** 서명 URL 유효시간(초) = 3시간.
 *  ⚠️ 검사는 **iframe 진입 시점 한 번**이다(그렇게 이해하고 있다 — Bunny 문서에 명시가 없다).
 *     혹시 재생 중에도 본다면 3시간짜리 강의까지는 안 끊긴다. 실측으로 확인되면 더 줄일 것. */
export const BUNNY_EMBED_TTL = 3 * 60 * 60

/** 시크릿이 다 들어왔나. 안 들어왔으면 Bunny 강의를 팔 수 없다(유튜브 강의는 영향 없음). */
export const bunnyConfigured = (): boolean => !!(LIBRARY_ID && TOKEN_KEY)

/** 풀존 호스트. **관리자 화면이 미리보기 주소를 조립하는 데만** 쓴다(아직 저장 안 된 id 라 서버가 못 만든다).
 *  ⚠️ 비밀이 아니다 — 사용자 브라우저가 받는 썸네일·영상 주소에 그대로 들어 있다.
 *     비밀인 건 토큰 키뿐이고, 그건 절대 안 나간다.
 *  ⛔ 그래도 **프론트 코드에 박지는 말 것.** 라이브러리를 갈면 배포가 두 번이 된다 — 런타임에 받아 쓴다. */
export const bunnyPullzone = (): string => PULLZONE

/** 목록 썸네일 — Bunny 가 업로드할 때 자동으로 뽑아 둔다(관리자가 따로 안 올려도 목록이 안 빈다).
 *  ⚠️ 이 주소는 **풀존**이라 허용 도메인 검사를 받는다. 우리 페이지의 <img> 는 referer 가 붙어 통과하고,
 *     주소만 복사해 붙여넣으면 막힌다 — 노출돼도 괜찮은 이유가 그거다.
 *  ⚠️ 풀존 호스트를 프론트에 박지 말 것. 서버가 완성해서 내려준다(라이브러리를 갈 때 배포가 두 번이 된다). */
export function bunnyThumbUrl(videoId: string): string | null {
  if (!PULLZONE || !videoId) return null
  return `https://${PULLZONE}/${videoId}/thumbnail.jpg`
}

const toHex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

/**
 * 서명된 임베드 URL 을 만든다.
 *
 * 규격(Bunny 문서): `token = SHA256_HEX(토큰키 + 영상id + expires)`.
 *   ⚠️ HMAC 이 아니라 **그냥 이어붙여 SHA256**이다. 순서도 이대로여야 한다.
 *   ⚠️ `expires` 는 **초 단위** 유닉스 타임이다(ms 로 넣으면 100배 미래라 사실상 무기한이 된다).
 *   ⚠️ 해시에 넣은 값과 URL 의 expires 는 **같은 값**이어야 한다 — 따로 계산하지 말 것.
 *
 * 그 밖의 쿼리(autoplay·t)는 해시 대상이 아니라 마음대로 붙여도 된다.
 *
 * @param startSec 이어보기 시작 지점(0이면 안 붙인다)
 */
export async function signBunnyEmbed(videoId: string, startSec = 0): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + BUNNY_EMBED_TTL
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(TOKEN_KEY + videoId + expires))
  const q = new URLSearchParams({ token: toHex(digest), expires: String(expires), autoplay: 'true' })
  // 이어보기 — 앞머리 몇 초는 되감아 주는 게 낫다(끊긴 지점 그대로 시작하면 맥락이 끊긴다).
  if (startSec > 5) q.set('t', String(Math.max(0, Math.floor(startSec) - 5)))
  return `https://${EMBED_HOST}/embed/${LIBRARY_ID}/${videoId}?${q}`
}
