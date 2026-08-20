// 관리자가 **직접 만든 HTML**(파일 업로드 · 소스 붙여넣기)을 공지 본문으로 들일 때의 정리.
//
// ⚠️ 통짜 문서(`<html><head>…`)를 그대로 저장하면 안 된다 — 렌더 직전 sanitize 가 문서 껍데기를
//    풀어헤치면서 `<head>` 안의 `<style>` 이 같이 날아가, **글은 남고 디자인만 빠진** 상태가 된다.
//    그래서 여기서 `<head>` 의 `<style>` 을 본문 앞으로 옮겨 붙이고 `<body>` 안쪽만 취한다.
//
// ⚠️ 못 살리는 것(스크립트·외부 CSS·상대경로 이미지)은 **조용히 지우지 않고 알려준다.**
//    파일을 만든 사람은 자기 화면에서 멀쩡히 보고 왔기 때문에, 말해주지 않으면
//    올린 뒤에 왜 다르게 나오는지 알 길이 없다.
import { NOTICE_FIT_ATTR, NOTICE_WIDTH, isIsolatedHtml, measureNoticeWidth, noticeFitZoom } from './noticeRender'

export interface ImportedHtml {
  html: string
  notes: string[]
}

export function importNoticeHtml(source: string): ImportedHtml {
  const notes: string[] = []
  const doc = new DOMParser().parseFromString(source, 'text/html')
  const isFullDoc = /<html[\s>]|<body[\s>]/i.test(source)

  if (doc.querySelector('script')) {
    notes.push('<script> 는 저장할 때 제거됩니다(보안). 움직이는 요소는 동작하지 않습니다.')
  }
  if (doc.querySelector('link[rel~="stylesheet" i]')) {
    notes.push('외부 CSS 파일(<link>)은 적용되지 않습니다 — <style> 안으로 옮겨 주세요.')
  }
  const hasRelativeAsset = Array.from(doc.querySelectorAll('img[src], source[src]')).some((el) => {
    const v = el.getAttribute('src') ?? ''
    return v !== '' && !/^(https?:|data:|\/\/)/i.test(v)
  })
  if (hasRelativeAsset) {
    notes.push('상대경로 이미지(예: ./img.png)는 뜨지 않습니다 — 본문에 직접 넣거나 전체 주소를 쓰세요.')
  }

  if (!isFullDoc) return { html: source.trim(), notes }

  const headStyles = Array.from(doc.head.querySelectorAll('style'))
    .map((s) => s.outerHTML)
    .join('\n')
  return { html: `${headStyles}\n${doc.body.innerHTML}`.trim(), notes }
}

// ── 표준 폭 맞추기 ───────────────────────────────────────────────────────────
// 공지판에 서는 문서는 전부 같은 폭(NOTICE_WIDTH)이어야 한다. 파일마다 제 폭으로 그려지면
// 넓은 건 잘리고 좁은 건 허전한, "같은 게시판인데 글 크기가 제각각"인 상태가 된다.
//
// 방식: 들어올 때 **실제 렌더 방식 그대로 재서** 넘치는 만큼의 배율을 문서에 박아 둔다.
//   · 남의 CSS 를 고쳐 쓰지 않는다 — 폭 선언이 어디 있는지(body·.wrap·table…) 파일마다 다르고,
//     `white-space:nowrap` 표처럼 폭만 줄여선 안 들어가는 것도 많다. 배율은 무엇이든 들어간다.
//   · 저장된 본문 자체가 1000px 문서가 되므로, 화면 쪽은 "1000px 을 화면에 맞춰 줄이는" 일만 한다.
export interface FittedHtml {
  html: string
  /** 표준 폭 안에서 문서가 실제로 차지한 폭(px). 1000 이면 그대로 들어온 것. */
  naturalWidth: number
  /** 박아 넣은 배율(1 = 손대지 않음) */
  zoom: number
  note: string
}

/** 앞서 박아 둔 배율 태그를 걷어낸다 — 안 걷으면 저장할 때마다 배율이 곱해져 글이 계속 작아진다. */
function stripFit(html: string): string {
  return html.replace(new RegExp(`<style[^>]*${NOTICE_FIT_ATTR}[^>]*>[\\s\\S]*?</style>\\s*`, 'gi'), '')
}

/**
 * 올려온 본문을 표준 폭에 맞춘다. **브라우저에서만 동작한다**(실측이 필요하다).
 * `<style>` 이 없는 평범한 글은 격리 대상이 아니라 그대로 통과시킨다.
 */
export function fitNoticeHtml(html: string): FittedHtml {
  const base = stripFit(html)
  if (!isIsolatedHtml(base)) return { html: base, naturalWidth: NOTICE_WIDTH, zoom: 1, note: '' }

  const naturalWidth = measureNoticeWidth(base)
  const zoom = noticeFitZoom(naturalWidth)
  if (zoom === 1) {
    return { html: base, naturalWidth, zoom, note: `표준 폭 ${NOTICE_WIDTH}px 에 그대로 들어갑니다.` }
  }
  // ⚠️ 배율은 `#caris-notice-doc`(그림자 안 래퍼)에 건다. 래퍼가 곧 문서의 뿌리이고,
  //    `body{…}` 로 쓴 규칙도 렌더 시 이 선택자로 옮겨 붙기 때문에 폭 선언과 같은 자리에 얹힌다.
  const fit = `<style ${NOTICE_FIT_ATTR}="${NOTICE_WIDTH}">#caris-notice-doc{zoom:${zoom}}</style>`
  return {
    html: `${fit}\n${base}`,
    naturalWidth,
    zoom,
    note: `문서 폭이 ${naturalWidth}px 라 표준 폭 ${NOTICE_WIDTH}px 에 맞춰 ${Math.round(zoom * 100)}% 로 줄였습니다.`,
  }
}
