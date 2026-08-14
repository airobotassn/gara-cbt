// 관리자가 **직접 만든 HTML**(파일 업로드 · 소스 붙여넣기)을 공지 본문으로 들일 때의 정리.
//
// ⚠️ 통짜 문서(`<html><head>…`)를 그대로 저장하면 안 된다 — 렌더 직전 sanitize 가 문서 껍데기를
//    풀어헤치면서 `<head>` 안의 `<style>` 이 같이 날아가, **글은 남고 디자인만 빠진** 상태가 된다.
//    그래서 여기서 `<head>` 의 `<style>` 을 본문 앞으로 옮겨 붙이고 `<body>` 안쪽만 취한다.
//
// ⚠️ 못 살리는 것(스크립트·외부 CSS·상대경로 이미지)은 **조용히 지우지 않고 알려준다.**
//    파일을 만든 사람은 자기 화면에서 멀쩡히 보고 왔기 때문에, 말해주지 않으면
//    올린 뒤에 왜 다르게 나오는지 알 길이 없다.
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
