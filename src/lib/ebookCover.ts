// 이북 표지 자동 생성 — 업로드한 본문 HTML 의 '1페이지'를 그대로 그려 표지 이미지로 굽는다.
//
// 왜 관리자 브라우저인가:
//   · Edge Function(Deno)은 헤드리스 브라우저를 못 돌린다 → 서버 렌더 불가.
//   · 스토어에서 본문을 실시간 iframe 으로 보여주면 유료 본문 전체(수 MB)를 비구매자에게 내려보내게 된다.
//   → 등록 시점에 관리자 브라우저에서 한 번만 굽고, 결과 이미지만 공개 버킷에 올린다.
//
// 렌더 방식:
//   숨김 iframe 에 본문을 띄워 브라우저가 레이아웃을 잡게 하고(첫 `.page` 요소 = 한 페이지),
//   그 요소를 SVG <foreignObject> 로 직렬화해 <img> 로 로드 → canvas 에 그린다.
//   html2canvas 류(CSS 를 JS 로 재구현)와 달리 렌더링 엔진이 직접 그리므로 재현도가 높고,
//   벡터 상태로 확대해 래스터화하므로 글자가 또렷하다.
//
// 전제: 이북은 외부 리소스가 없는 단일 HTML(폰트·이미지는 data: URI) — 뷰어(EbookReader)와 같은 전제다.
//   외부 URL 리소스를 쓰면 foreignObject 가 그걸 못 불러와 그 부분만 비어 보인다.

/** A4 @96dpi — 이북 조판 기준(`.page { width:210mm; height:297mm }`). */
const A4_W = 794
const A4_H = 1123
/** 저장 해상도(폭). 스토어 표시 폭이 240~320px 이라 3배 이상 확보한다. */
const OUT_W = 1000
const LOAD_TIMEOUT_MS = 30000

export interface EbookCoverImage {
  blob: Blob
  /** 업로드 경로 확장자 */
  ext: 'webp' | 'png'
  width: number
  height: number
}

/** CSS 를 XML CDATA 로 안전하게 감싼다(`]]>` 가 들어 있어도 깨지지 않게 쪼갠다). */
function cdata(s: string): string {
  return `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`
}

/**
 * SVG 문자열을 <img> 로 로드.
 * ⚠️ 반드시 data: URI 여야 한다 — blob: URL 로 준 SVG 에 <foreignObject> 가 들어 있으면
 *    Chromium 이 캔버스를 tainted 로 취급해 toBlob 이 SecurityError 로 죽는다(확인 완료).
 *    data: URI 는 오리진이 상속돼 오염되지 않는다. base64 는 4/3 로 불어나므로 퍼센트 인코딩을 쓴다.
 */
function loadSvg(svg: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    const timer = setTimeout(() => reject(new Error('표지 렌더가 시간 안에 끝나지 않았습니다.')), LOAD_TIMEOUT_MS)
    img.onload = () => {
      clearTimeout(timer)
      resolve(img)
    }
    img.onerror = () => {
      clearTimeout(timer)
      reject(new Error('표지 렌더에 실패했습니다.'))
    }
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}

/**
 * 본문 HTML → 표지 이미지(1페이지 렌더).
 * @param html 업로드한 이북 본문 HTML 원본
 */
export async function renderEbookCover(html: string): Promise<EbookCoverImage> {
  const frame = document.createElement('iframe')
  // allow-scripts 를 주지 않는다 — 책 안의 스크립트가 관리자 세션(로컬스토리지의 Supabase 토큰)에
  // 닿지 못하게 격리한다. allow-same-origin 은 우리가 contentDocument 를 읽으려면 필요하다.
  frame.setAttribute('sandbox', 'allow-same-origin')
  frame.style.cssText =
    `position:fixed;left:-99999px;top:0;width:${A4_W}px;height:${A4_H}px;border:0;pointer-events:none`
  document.body.appendChild(frame)

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('본문 렌더가 시간 안에 끝나지 않았습니다.')), LOAD_TIMEOUT_MS)
      frame.onload = () => {
        clearTimeout(timer)
        resolve()
      }
      frame.onerror = () => {
        clearTimeout(timer)
        reject(new Error('본문 HTML 을 열지 못했습니다.'))
      }
      frame.srcdoc = html
    })

    const doc = frame.contentDocument
    const win = frame.contentWindow
    if (!doc || !win) throw new Error('본문 문서에 접근할 수 없습니다.')

    // 폰트가 로드되기 전에 그리면 글자가 대체 폰트로 찍힌다.
    try {
      await doc.fonts?.ready
    } catch {
      /* 폰트 API 가 없어도 아래 rAF 대기로 대부분 커버된다 */
    }
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

    // 1페이지 = 첫 `.page`. 페이지 단위 조판이 아닌 책은 body 첫 화면(A4 한 장)을 잘라 쓴다.
    const pageEl = doc.querySelector<HTMLElement>('.page')
    const bodyStyle = win.getComputedStyle(doc.body)
    const rect = pageEl?.getBoundingClientRect()
    const w = Math.round(rect?.width || A4_W)
    const h = Math.round(rect?.height || A4_H)

    // ⚠️ 페이지를 <div> 래퍼에 담고 body 의 computed style 을 베껴 넣으면 안 된다.
    //    computed 값은 이미 px 로 굳은 값이라(line-height:1.62 → 26.8px) 자식들이 자기 font-size 기준으로
    //    다시 계산하지 못하고, word-break 같은 상속 속성도 일일이 빠뜨리게 된다(행간·줄바꿈이 어긋났다).
    //    → 대신 **book 의 <body> 를 그대로 복제**해 그 안에 페이지를 넣는다. SVG 는 XML 로 파싱되므로
    //      <body> 가 html 밖에 있어도 그대로 살아 있고, `body { ... }` 규칙이 원래 명시값으로 적용된다.
    const bodyClone = doc.body.cloneNode(false) as HTMLElement
    if (pageEl) {
      bodyClone.appendChild(pageEl.cloneNode(true))
    } else {
      for (const child of Array.from(doc.body.children)) bodyClone.appendChild(child.cloneNode(true))
    }
    // 화면용 body 여백(`@media screen { body { padding:10mm 0 } }` 류)은 표지에선 페이지를 밀어 잘리게 한다.
    // 인라인 style 이라 규칙보다 우선한다.
    bodyClone.setAttribute(
      'style',
      `${doc.body.getAttribute('style') ?? ''};margin:0;padding:0;width:${w}px;height:${h}px;overflow:hidden` +
        (pageEl ? ';background:transparent' : `;background:${bodyStyle.backgroundColor}`),
    )

    // 문서의 <style> 을 전부 걷어 SVG 안에 심는다(단일 HTML 원칙이라 외부 스타일시트는 없다).
    const css = Array.from(doc.querySelectorAll('style'))
      .map((s) => s.textContent ?? '')
      .join('\n')
    // 화면용 페이지 여백·그림자는 표지에선 군더더기다(`@media screen` 규칙이 SVG 안에서도 적용된다).
    const override = `.page{margin:0!important;box-shadow:none!important}`

    // CSS 는 직렬화 후 CDATA 로 갈아끼운다 — XMLSerializer 에 맡기면 `>`·`&` 가 이스케이프돼 CSS 가 깨진다.
    const TOKEN = '__EBOOK_COVER_CSS__'
    const style = doc.createElement('style')
    style.textContent = TOKEN
    bodyClone.insertBefore(style, bodyClone.firstChild)
    const serialized = new XMLSerializer().serializeToString(bodyClone).replace(TOKEN, cdata(`${css}\n${override}`))

    const outH = Math.round((OUT_W * h) / w)
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${OUT_W}" height="${outH}" viewBox="0 0 ${w} ${h}">` +
      `<foreignObject x="0" y="0" width="${w}" height="${h}">${serialized}</foreignObject></svg>`

    const img = await loadSvg(svg)
    const canvas = document.createElement('canvas')
    canvas.width = OUT_W
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('캔버스를 만들 수 없습니다.')
    ctx.fillStyle = '#ffffff' // 배경이 투명한 책이면 흰 종이로 깔아준다
    ctx.fillRect(0, 0, OUT_W, outH)
    ctx.drawImage(img, 0, 0, OUT_W, outH)

    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.92))
    if (blob && blob.type === 'image/webp') return { blob, ext: 'webp', width: OUT_W, height: outH }
    const png = blob ?? (await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png')))
    if (!png) throw new Error('표지 이미지를 만들지 못했습니다.')
    return { blob: png, ext: 'png', width: OUT_W, height: outH }
  } finally {
    frame.remove()
  }
}
