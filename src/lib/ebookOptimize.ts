// 이북 HTML 다이어트 — 업로드 직후 한 번 돌려서 파일을 줄인다.
//
// **왜 필요한가 (2026-08-18 실측)**
//   이북 한 권(7.03MB)의 내용물은 이랬다:
//     · 폰트 7개(Jua·Noto Sans KR ×4·Gaegu ×2, 전부 woff2 base64)  3.12MB  ← 제일 큰 덩어리
//     · PNG 이미지 1장                                              2.10MB
//     · 실제 글·서식                                                1.81MB
//   "이미지가 많아서 크다" 가 아니라 **한글 폰트를 통째로 박아둔 것**이 원인이었다.
//   이북은 열람할 때마다 이 파일이 통째로 내려가고, 그게 Supabase egress(무료 5GB/월)를 먹는다.
//   7MB → 2.3MB 면 월 열람 한도가 700회 → 2,200회가 된다.
//
// **왜 폰트를 '빼는' 게 아니라 '밖에서 불러쓰게' 하는가**
//   서브셋(쓰는 글자만 남기기)도 방법이지만 우리 이북은 6개국어(한·영·일·중·힌디·베트남)다.
//   언어마다 문자 집합이 달라서 빠뜨린 글자가 네모(□)로 뜬다 — 독자가 깨진 책을 본다.
//   외부 참조는 그 위험이 0이고, 브라우저가 캐시해서 두 번째 책부터는 아예 0바이트다.
//
// ⚠️ **뷰어가 sandbox iframe 이라는 게 전제다.** EbookReader 는 srcdoc + `allow-same-origin 없음`
//    으로 띄우므로 iframe 이 opaque origin 이 된다. 폰트는 언제나 CORS 요청이라 `Origin: null` 로
//    나가는데, **Google Fonts 는 `Access-Control-Allow-Origin: *` 를 주므로 통과한다.**
//    우리 CDN(Cloudflare)으로 옮기고 싶으면 그쪽에 같은 헤더를 붙여야 한다 — 안 붙이면 조용히
//    차단되고 시스템 기본 글꼴로 폴백된다(책이 깨지진 않고 모양만 달라진다).
//
// ⚠️ **상대경로 리소스는 못 쓴다.** srcdoc 문서의 base URL 은 about:srcdoc 이라 `./img/a.png` 같은
//    경로가 죽는다. 그래서 이미지는 계속 base64 로 두고 **형식만** WebP 로 바꾼다(빼내지 않는다).
//
// 📌 **Spring 으로 옮길 때**
//   · 이 파일의 두 규칙(폰트 외부화·이미지 WebP)을 서버로 그대로 옮긴다. 규칙은 바뀌지 않고
//     실행 위치만 바뀐다. Java 는 이미지 인코딩 품질을 더 세밀히 잡을 수 있다.
//   · 진짜 이득은 **번역**에서 온다. 지금은 관리자 브라우저가 Gemini 를 25회씩 부르며 몇 분을
//     붙들고 있는데(Admin.tsx 의 runTranslation), Edge Functions 에는 작업 큐가 없어서 그렇다.
//     Spring 에서는 `업로드 → 큐 적재 → 폰트·이미지·번역·표지 순차 처리 → 완료 알림` 으로 바꾸고
//     관리자는 저장을 누른 뒤 창을 닫을 수 있게 한다.
//   · 그때 이북 저장소를 **Cloudflare R2** 로 옮기는 것도 같이 검토할 것 — egress 가 무료라
//     "월 5GB" 라는 제약 자체가 사라지고, 이 최적화의 중요도도 같이 내려간다.
//   · 폰트를 우리 CDN 으로 옮길 거면 위의 CORS 헤더 주의사항을 먼저 처리할 것.

/** 진행 상황 알림(관리자 화면 표시용). 폰트 치환은 즉시, 이미지는 장당 수백 ms. */
export type OptimizeProgress = { phase: 'font' | 'image'; done: number; total: number }

export type OptimizeResult = {
  html: string
  /** 원본 바이트 */
  before: number
  /** 최적화 후 바이트 */
  after: number
  /** 사람이 읽는 요약(관리자에게 그대로 보여준다) */
  notes: string[]
}

/**
 * 밖으로 뺄 수 있는 폰트 목록 — **실제 Google Fonts 에 있는 이름만** 적는다.
 * 여기 없는 폰트는 건드리지 않고 base64 그대로 남긴다(모르는 폰트를 URL 로 바꾸면 글꼴이 통째로 사라진다).
 */
const GOOGLE_FONTS = new Set([
  'Jua',
  'Noto Sans KR',
  'Noto Serif KR',
  'Gaegu',
  'Nanum Gothic',
  'Nanum Myeongjo',
  'Nanum Pen Script',
  'Do Hyeon',
  'Black Han Sans',
  'Gowun Dodum',
  'Gowun Batang',
  'Song Myung',
  'Sunflower',
  'Poor Story',
  'Cute Font',
  'Dokdo',
  'East Sea Dokdo',
  'Hi Melody',
  'Kirang Haerang',
  'Single Day',
  'Stylish',
  'Yeon Sung',
  'IBM Plex Sans KR',
])

/** `@font-face { ... }` 한 블록에서 family 와 weight 를 뽑는다. */
function readFontFace(block: string): { family: string; weight: string } | null {
  const family = block.match(/font-family\s*:\s*['"]?([^;'"}]+)['"]?/)?.[1]?.trim()
  if (!family) return null
  const weight = block.match(/font-weight\s*:\s*(\d{3})/)?.[1] ?? '400'
  return { family, weight }
}

/**
 * base64 로 박힌 @font-face 를 Google Fonts 링크로 바꾼다.
 * 목록에 없는 폰트의 블록은 **그대로 둔다** — 줄이는 것보다 안 깨지는 게 우선이다.
 *
 * ⚠️ export 인 이유 — 이미 올라간 책을 일괄 재처리하는 스크립트가 **이 함수를 그대로** 쓴다.
 *    규칙을 스크립트에 복사하면 두 벌이 되어 곧 어긋난다(이미지 쪽은 브라우저 API 라 못 쓰고
 *    스크립트가 ffmpeg 로 대신한다 — 그건 인코더만 다르고 결과물 형식은 같다).
 */
export function externalizeFonts(html: string): { html: string; saved: number; note: string } {
  const blocks = [...html.matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => m[0])
  if (!blocks.length) return { html, saved: 0, note: '' }

  // family → 쓰이는 weight 모음. 링크 URL 을 만들 때 필요하다.
  const wanted = new Map<string, Set<string>>()
  const removable: string[] = []
  const kept = new Set<string>()

  for (const block of blocks) {
    if (!/base64,/.test(block)) continue // 이미 외부 참조면 건드릴 게 없다
    const face = readFontFace(block)
    if (!face) continue
    if (!GOOGLE_FONTS.has(face.family)) {
      kept.add(face.family)
      continue
    }
    if (!wanted.has(face.family)) wanted.set(face.family, new Set())
    wanted.get(face.family)!.add(face.weight)
    removable.push(block)
  }
  if (!removable.length) {
    return { html, saved: 0, note: kept.size ? `폰트 유지(구글 폰트 아님): ${[...kept].join(', ')}` : '' }
  }

  const before = html.length
  let out = html
  for (const block of removable) out = out.replace(block, '')

  // families 는 이름 순으로 고정한다 — 같은 책을 다시 올려도 URL 이 같아야 브라우저 캐시가 산다.
  const families = [...wanted.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([family, weights]) => {
      const ws = [...weights].sort()
      const name = family.replace(/ /g, '+')
      return ws.length === 1 && ws[0] === '400' ? `family=${name}` : `family=${name}:wght@${ws.join(';')}`
    })
  const link = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${families.join('&')}&display=swap">`

  // head 가 있으면 그 안에, 없으면 문서 맨 앞에 넣는다(브라우저가 알아서 head 로 올린다).
  out = /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, (m) => `${m}\n${link}`) : `${link}\n${out}`

  const saved = before - out.length
  const names = [...wanted.keys()].join(', ')
  const keptNote = kept.size ? ` · 유지: ${[...kept].join(', ')}` : ''
  return { html: out, saved, note: `폰트 ${removable.length}개 외부화(${names})${keptNote}` }
}

/**
 * data URI 이미지 하나를 WebP 로 다시 인코딩한다.
 * 더 커지거나 실패하면 null → 호출부가 원본을 유지한다(줄이려다 키우는 일이 없게).
 */
async function toWebpDataUri(dataUri: string, quality: number): Promise<string | null> {
  try {
    const res = await fetch(dataUri)
    const blob = await res.blob()
    const bitmap = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    const webp = await canvas.convertToBlob({ type: 'image/webp', quality })
    if (webp.type !== 'image/webp') return null // 인코더가 없으면 png 로 떨어진다 — 그건 이득이 없다
    if (webp.size >= blob.size) return null
    const buf = new Uint8Array(await webp.arrayBuffer())
    let bin = ''
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    return `data:image/webp;base64,${btoa(bin)}`
  } catch {
    return null
  }
}

/** 박혀 있는 PNG·JPEG 를 WebP 로 바꾼다(빼내지 않는다 — 위 '상대경로' 주의 참고). */
async function convertImages(
  html: string,
  quality: number,
  onProgress?: (p: OptimizeProgress) => void,
): Promise<{ html: string; saved: number; note: string }> {
  const found = [...html.matchAll(/data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=]+/g)].map((m) => m[0])
  if (!found.length) return { html, saved: 0, note: '' }

  // 같은 이미지가 여러 번 박힌 경우 한 번만 변환한다.
  const uniq = [...new Set(found)]
  let out = html
  let saved = 0
  let converted = 0
  for (let i = 0; i < uniq.length; i++) {
    onProgress?.({ phase: 'image', done: i, total: uniq.length })
    const webp = await toWebpDataUri(uniq[i], quality)
    if (!webp) continue
    saved += (uniq[i].length - webp.length) * out.split(uniq[i]).length // 등장 횟수만큼 절약
    out = out.split(uniq[i]).join(webp)
    converted++
  }
  onProgress?.({ phase: 'image', done: uniq.length, total: uniq.length })
  return {
    html: out,
    saved,
    note: converted ? `이미지 ${converted}/${uniq.length}개 WebP 변환` : '이미지 변환 이득 없음(원본 유지)',
  }
}

/**
 * 이북 HTML 을 줄인다. 실패해도 예외를 던지지 않고 **원본을 그대로 돌려준다** —
 * 최적화가 안 됐다고 이북 등록이 막히면 안 된다.
 *
 * @param quality WebP 품질(0~1). 이북은 도표·스크린샷이 섞여 있어 0.92 를 기본으로 둔다.
 */
export async function optimizeEbookHtml(
  html: string,
  onProgress?: (p: OptimizeProgress) => void,
  quality = 0.92,
): Promise<OptimizeResult> {
  const before = html.length
  const notes: string[] = []
  let work = html

  try {
    onProgress?.({ phase: 'font', done: 0, total: 1 })
    const f = externalizeFonts(work)
    work = f.html
    if (f.note) notes.push(f.note)
    onProgress?.({ phase: 'font', done: 1, total: 1 })

    const i = await convertImages(work, quality, onProgress)
    work = i.html
    if (i.note) notes.push(i.note)
  } catch {
    return { html, before, after: before, notes: ['최적화 실패 — 원본 그대로 등록됨'] }
  }

  return { html: work, before, after: work.length, notes }
}

/** "7.03MB → 2.31MB (67% 감소)" 처럼 사람이 읽는 한 줄. */
export function optimizeSummary(r: OptimizeResult): string {
  const mb = (n: number) => (n / 1048576).toFixed(2)
  if (r.after >= r.before) return `크기 변화 없음 (${mb(r.before)}MB)`
  const pct = Math.round((1 - r.after / r.before) * 100)
  return `${mb(r.before)}MB → ${mb(r.after)}MB (${pct}% 감소)`
}
