// 평문 텍스트 내 URL 을 안전한 React <a> 로 링크화한다.
//  · dangerouslySetInnerHTML 미사용(NoticeDetail 과 동일 접근): 모든 조각은 React 텍스트 child 로
//    렌더되어 자동 이스케이프되므로 사용자 입력이 마크업으로 해석되지 않는다(XSS-inert).
//  · 링크는 https?:// 패턴만 매칭하고 rel="noopener noreferrer" + target="_blank" 를 강제한다.
import type { ReactNode } from 'react'

const URL_RE = /(https?:\/\/[^\s<>"'()]+)/g

export function linkify(text: string): ReactNode[] {
  return text.split(URL_RE).map((part, i) => {
    if (i % 2 === 0) return part
    const url = part.replace(/[.,;:!?]+$/, '')
    const tail = part.slice(url.length)
    return (
      <span key={i}>
        <a href={url} target="_blank" rel="noopener noreferrer" className="chat-link">
          {url}
        </a>
        {tail}
      </span>
    )
  })
}
