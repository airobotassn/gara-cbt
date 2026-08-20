// 공지 본문(관리자가 만들어 올린 HTML)의 **렌더 규칙**.
//   화면(components/HtmlBody)·업로드 정리(lib/noticeHtml)·관리자 미리보기가 전부 여기 값을 본다.
//   ⚠️ 컴포넌트 파일에 두면 lib 이 컴포넌트를 import 하게 되고(순환에 가까운 모양), 화면 파일이
//      컴포넌트 외의 것을 내보내 fast-refresh 도 깨진다. 그래서 규칙만 여기 모아 둔다.
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
export const DOC_ID = 'caris-notice-doc'
/** 문서의 @media 가 기준으로 삼을 칸 이름(아래 '@media → @container' 참고). */
const CONTAINER_NAME = 'caris-notice'
const ISOLATED_BASE_CSS =
  `:host{display:block}` +
  `#${DOC_ID}{display:block;container-type:inline-size;container-name:${CONTAINER_NAME}}` +
  `#${DOC_ID} img,#${DOC_ID} video{max-width:100%;height:auto}`

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

// ── @media → @container ────────────────────────────────────────────────────
// 올려온 문서가 자기 반응형 규칙을 갖고 있으면, 그건 **진짜 화면 폭**을 보고 켜진다.
// 우리는 본문을 늘 1000px 칸에 세우므로(옆으로 밀어서 보는 방식), 폰에서는 상자는 1000px 인데
// 안의 글만 폰용으로 접혀 오른쪽이 텅 비는 어긋난 그림이 나온다(실측: 제목 32px→20px, 표가 접힘).
// → 폭 조건을 **그 1000px 칸 기준**으로 바꿔 준다. 그러면 폰이든 PC 든 같은 모습으로 선다.
//
// ⚠️ 폭·높이 계열 조건만 바꾼다. `print`·`prefers-color-scheme`·`hover` 같은 건 @container 가
//    못 받으므로 손대지 않고 그대로 둔다(그 규칙은 원래대로 화면 기준으로 동작한다).
const CQ_FEATURES = new Set([
  'width', 'min-width', 'max-width',
  'height', 'min-height', 'max-height',
  'inline-size', 'min-inline-size', 'max-inline-size',
  'block-size', 'min-block-size', 'max-block-size',
  'aspect-ratio', 'min-aspect-ratio', 'max-aspect-ratio',
  'orientation',
])

/** 미디어 조건 → 컨테이너 조건. 못 바꾸는 조건이면 null(=건드리지 않음). */
function toContainerCondition(conditionText: string): string | null {
  let c = conditionText.trim()
  c = c.replace(/^only\s+/i, '')
  c = c.replace(/^(all|screen)\s+and\s+/i, '')
  if (/^(all|screen)$/i.test(c) || !c) return null       // 조건 없는 @media — 바꿀 게 없다
  if (/\b(print|speech)\b/i.test(c)) return null         // 화면용이 아니다
  const feats = [...c.matchAll(/\(\s*([a-z-]+)\s*[:)<>=]/gi)].map((m) => m[1].toLowerCase())
  if (!feats.length || feats.some((f) => !CQ_FEATURES.has(f))) return null
  return c
}

/**
 * ⚠️ 셀렉터 재배치(rehostRules)를 **먼저** 끝낸 뒤에 부를 것 — 여기서는 안쪽 규칙을 cssText 로
 *    통째로 옮겨 담기 때문에, 순서가 뒤바뀌면 옮겨진 규칙의 `body{…}` 가 영영 재배치되지 않는다.
 */
function mediaToContainer(group: CSSStyleSheet | CSSGroupingRule) {
  for (let i = 0; i < group.cssRules.length; i++) {
    const rule = group.cssRules[i]
    if (rule instanceof CSSMediaRule) {
      const cond = toContainerCondition(rule.conditionText)
      if (cond) {
        const inner = Array.from(rule.cssRules).map((r) => r.cssText).join(String.fromCharCode(10))
        try {
          // ⚠️ 넣고 나서 지운다 — 먼저 지웠다가 insert 가 실패하면(컨테이너 쿼리 미지원 브라우저)
          //    그 규칙이 통째로 사라져 문서가 더 망가진다.
          group.insertRule(`@container ${CONTAINER_NAME} ${cond} { ${inner} }`, i + 1)
          group.deleteRule(i)
        } catch {
          /* 못 바꾸면 원래 @media 그대로 둔다 */
        }
        continue
      }
    }
    if ('cssRules' in rule) mediaToContainer(rule as CSSGroupingRule) // @supports 안쪽
  }
}

// 격리 대상 판정의 단일 출처 — 렌더러와 페이지 폭이 **같은 기준**을 봐야 한다.
// (한쪽만 바뀌면 원본 폭으로 만든 문서가 좁은 칸에 갇히거나, 평범한 공지가 넓게 퍼진다.)
export const isIsolatedHtml = (html: string) => /<style[\s>]/i.test(html)

/**
 * 만들어 올린 공지 본문의 **표준 폭(px)**. 화면·미리보기·업로드 정규화가 전부 이 값을 본다.
 *
 * 왜 고정하나: 예전엔 글칸만 1120px 로 잡아두고 문서 폭은 재지 않았다. 그래서 1280px 로 만들어
 * 온 공지는 오른쪽 312px 가 통째로 잘렸고(바깥이 overflow-x:hidden 이라 스크롤도 안 생긴다),
 * 800px 짜리는 허전하게 떴다 — **같은 공지판인데 글 크기가 파일마다 달랐다.**
 * ⚠️ 이 값을 바꾸면 NoticeDetail 의 글칸 폭(max-w)도 같이 맞출 것. 둘이 어긋나면 표준 폭으로
 *    맞춰 넣은 문서가 다시 잘리거나 여백이 뜬다.
 */
export const NOTICE_WIDTH = 1000

/**
 * 업로드할 때 박아 넣는 '표준 폭에 이미 맞췄다' 표식(lib/noticeHtml 의 fitNoticeHtml).
 * ⚠️ 화면 쪽이 이 표식을 봐야 한다 — 못 보면 이미 줄여 놓은 문서를 **또 줄여서** 글이 두 번 작아진다.
 */
export const NOTICE_FIT_ATTR = 'data-notice-fit'

export function mountIsolated(host: HTMLElement, cleanHtml: string) {
  // 같은 호스트에 두 번 attach 하면 예외가 난다 — 이미 있으면 그걸 다시 쓴다.
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
  root.innerHTML = `<style>${ISOLATED_BASE_CSS}</style><div id="${DOC_ID}">${cleanHtml}</div>`
  for (const el of Array.from(root.querySelectorAll('style'))) {
    const sheet = (el as HTMLStyleElement).sheet
    if (!sheet) continue
    rehostRules(sheet)
    mediaToContainer(sheet) // 반드시 rehost 뒤에(위 주석 참고)
  }
}

/**
 * 올려온 문서가 표준 폭 안에서 실제로 몇 px 를 차지하는지 잰다(넘치면 1000 보다 큰 값).
 *
 * ⚠️ 반드시 **실제로 렌더되는 방식 그대로**(Shadow DOM + 셀렉터 재배치) 재야 한다. 평범한
 *    iframe 에 띄워 재면 `body{width:…}` 가 그림자 안에서 래퍼로 옮겨지는 것이 반영되지 않아
 *    화면과 다른 숫자가 나온다.
 */
export function measureNoticeWidth(html: string): number {
  const box = document.createElement('div')
  // 화면 밖에 두되 폭은 표준 폭으로 고정한다 — 반응형 문서는 이 폭에 맞게 흐르고,
  // 고정폭 문서만 이 값을 넘긴다. (display:none 은 레이아웃이 안 잡혀 못 쓴다.)
  box.style.cssText = `position:fixed;left:-99999px;top:0;width:${NOTICE_WIDTH}px;visibility:hidden;pointer-events:none`
  const host = document.createElement('div')
  box.appendChild(host)
  document.body.appendChild(box)
  try {
    mountIsolated(host, DOMPurify.sanitize(html, { WHOLE_DOCUMENT: true }))
    const doc = host.shadowRoot?.getElementById(DOC_ID)
    return Math.max(NOTICE_WIDTH, Math.round(doc?.scrollWidth ?? NOTICE_WIDTH))
  } finally {
    box.remove()
  }
}

/**
 * 문서를 표준 폭에 맞추는 배율. 1000px 에 들어오면 1(손대지 않음), 넘치면 줄이는 값.
 *
 * ⚠️ 좁은 문서를 억지로 **키우지는 않는다** — 좁게 만든 건 의도일 수 있고, 키우면 글자만 커진
 *    이상한 문서가 된다. 문제였던 건 '잘리는 것' 하나다.
 */
export const noticeFitZoom = (naturalWidth: number) =>
  naturalWidth > NOTICE_WIDTH ? Number((NOTICE_WIDTH / naturalWidth).toFixed(4)) : 1

