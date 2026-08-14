import { useEffect, useMemo, useRef } from 'react'
import DOMPurify from 'dompurify'

// 공지 본문 HTML 렌더러.
//
// ⚠️ 관리자가 만들어 올린 HTML 은 **자기 CSS 를 들고 온다.** 그걸 페이지에 그냥 얹으면
//    `body{…}` 같은 셀렉터가 앱 헤더·푸터까지 물들인다. 그래서 `<style>` 이 든 본문은
//    Shadow DOM 안에 넣어 양방향으로 격리한다 — 밖으로 안 새고, 앱 CSS 도 안 들어가서
//    만든 사람이 본 그대로 나온다.
//
// 여기 세 줄이 전부 **실측으로 얻은 것**이라 지우면 조용히 깨진다:
//
//  ① DOMPurify 는 기본 설정에서 `<style>` 을 **통째로 버린다.** 허용 태그 목록에 'style' 이
//     있어서 통과할 것처럼 보이지만 실제로는 안 남는다(조각 파싱이라 `<style>` 이 `<head>` 로
//     들어가고, 반환은 `<body>` 안쪽만이라 같이 사라진다). `ADD_TAGS:['style']` 도 소용없다.
//     `WHOLE_DOCUMENT:true` 만 살린다. ⚠️ 그래서 격리 여부 판정은 **sanitize 전 원본**으로 한다 —
//     결과물로 판정하면 `<style>` 이 이미 지워져 있어 격리가 **영원히 안 켜진다**.
//
//  ② Shadow DOM 안에는 `:root` 도 `body` 도 없다. 올려온 CSS 가 `:root{--navy:…}` 로 변수를
//     깔고 `var(--navy)` 로 쓰면 변수가 아예 정의되지 않아 **색이 전부 날아간다**(실제로 그랬다).
//     `body{padding:40px;background:…}` 도 마찬가지로 아무데도 안 붙는다.
//     그래서 그 셀렉터들을 안쪽 래퍼로 옮겨 적는다.
//     ⚠️ 호스트(`:host`)로 옮기면 안 된다 — 그림자 경계는 **호스트 자신은 못 막는다.**
//     앱 전역 리셋(`*{margin:0;padding:0}`)이 `:host` 규칙을 이겨서 **padding 만 조용히 0** 이 된다
//     (배경·폰트는 멀쩡히 먹어서 다 된 것처럼 보인다 — 실제로 그렇게 속았다).
//     래퍼는 그림자 **안쪽**이라 바깥 CSS 가 닿지 않는다.
//
//  ③ 셀렉터 치환은 문자열이 아니라 CSSOM(`selectorText`)으로 한다. 원문을 정규식으로 갈면
//     주석·문자열·`.body-x` 같은 클래스명까지 같이 바뀐다.
//
// ⚠️ `<style>` 이 없는 평범한 공지(WYSIWYG 로 쓴 글)는 격리하지 않는다 — 격리하면 앱 폰트·색을
//    통째로 잃어서 지금까지 올라간 공지가 전부 맨몸 HTML 로 보인다.
// 올려온 문서가 앉는 안쪽 래퍼. 그림자 안이라 앱 CSS 가 못 닿는다.
const DOC_ID = 'caris-notice-doc'
const ISOLATED_BASE_CSS =
  `:host{display:block}#${DOC_ID}{display:block}#${DOC_ID} img,#${DOC_ID} video{max-width:100%;height:auto}`

// 문서 루트를 가리키던 셀렉터를 그 래퍼로 옮긴다.
const ROOTISH = /(^|,\s*)(?::root|html|body)\b/g

function rehostRules(group: CSSStyleSheet | CSSGroupingRule) {
  for (const rule of Array.from(group.cssRules)) {
    if (rule instanceof CSSStyleRule) {
      const next = rule.selectorText.replace(ROOTISH, `$1#${DOC_ID}`)
      if (next !== rule.selectorText) {
        try {
          rule.selectorText = next
        } catch {
          // 브라우저가 못 받아주는 셀렉터면 원문 그대로 둔다(그 규칙만 안 먹는다).
        }
      }
    } else if ('cssRules' in rule) {
      rehostRules(rule as CSSGroupingRule) // @media·@supports 안쪽
    }
  }
}

// 격리 대상 판정의 단일 출처 — 렌더러와 페이지 폭이 **같은 기준**을 봐야 한다.
// (한쪽만 바뀌면 원본 폭으로 만든 문서가 좁은 칸에 갇히거나, 평범한 공지가 넓게 퍼진다.)
export const isIsolatedHtml = (html: string) => /<style[\s>]/i.test(html)

export function mountIsolated(host: HTMLElement, cleanHtml: string) {
  // 같은 호스트에 두 번 attach 하면 예외가 난다 — 이미 있으면 그걸 다시 쓴다.
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
  root.innerHTML = `<style>${ISOLATED_BASE_CSS}</style><div id="${DOC_ID}">${cleanHtml}</div>`
  for (const el of Array.from(root.querySelectorAll('style'))) {
    const sheet = (el as HTMLStyleElement).sheet
    if (sheet) rehostRules(sheet)
  }
}

export default function HtmlBody({ html, className }: { html: string; className?: string }) {
  // ⚠️ 판정은 원본으로(위 ①). sanitize 결과에는 <style> 이 남지 않는다.
  const isolated = useMemo(() => isIsolatedHtml(html), [html])
  const clean = useMemo(
    () => (isolated ? DOMPurify.sanitize(html, { WHOLE_DOCUMENT: true }) : DOMPurify.sanitize(html)),
    [html, isolated],
  )
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isolated) return
    const host = hostRef.current
    if (host) mountIsolated(host, clean)
  }, [clean, isolated])

  if (isolated) return <div ref={hostRef} className={className} />
  return <div className={className} dangerouslySetInnerHTML={{ __html: clean }} />
}
