import { useEffect, useMemo, useRef } from 'react'
import DOMPurify from 'dompurify'
import { DOC_ID, NOTICE_FIT_ATTR, NOTICE_WIDTH, isIsolatedHtml, mountIsolated } from '../lib/noticeRender'

// 공지 본문 HTML 렌더러 — 규칙·상수는 lib/noticeRender 에 있다(그 파일 머리말을 볼 것).
export default function HtmlBody({ html, className }: { html: string; className?: string }) {
  // ⚠️ 판정은 원본으로(위 ①). sanitize 결과에는 <style> 이 남지 않는다.
  const isolated = useMemo(() => isIsolatedHtml(html), [html])
  const clean = useMemo(
    () => (isolated ? DOMPurify.sanitize(html, { WHOLE_DOCUMENT: true }) : DOMPurify.sanitize(html)),
    [html, isolated],
  )
  const hostRef = useRef<HTMLDivElement>(null)
  const fitRef = useRef<HTMLDivElement>(null)
  // 이미 표준 폭으로 맞춰 저장된 본문인가. 옛 공지는 표식이 없어 화면에서 재서 맞춘다.
  const prefitted = useMemo(() => html.includes(NOTICE_FIT_ATTR), [html])

  useEffect(() => {
    if (!isolated) return
    const host = hostRef.current
    if (host) mountIsolated(host, clean)
  }, [clean, isolated])

  // ── 표준 폭 맞추기 ──
  // 본문은 화면 크기와 무관하게 **늘 표준 폭(1000px)** 으로 선다. 자리가 좁으면(폰) 줄이지 않고
  // **옆으로 밀어서 본다**(아래 overflow-x:auto).
  //
  // ⚠️ 폰에서 화면 폭에 맞춰 줄이는 방식을 썼다가 되돌렸다(2026-08-19). 1000px 문서를 390px 에
  //    다 넣으면 배율이 34% 라 16px 글자가 5px 이 된다 — 안 잘리지만 못 읽는다. 어떤 형태가
  //    올지 모르는 상태(표·카드·포스터·절대좌표)에서 남의 CSS 를 반응형으로 고치는 것도 접었다:
  //    글과 표에만 듣고 나머지는 조용히 망가진다.
  // ⚠️ 그래도 배율이 한 군데 남아 있다 — **옛 공지**. 업로드 때 표준 폭으로 맞추기 시작한 게
  //    최근이라 그전 공지는 제 폭(예: 1384px) 그대로다. 그것만 1000px 로 눌러 맞춘다. 안 그러면
  //    같은 공지판에서 문서마다 폭이 달라지고, 그게 애초에 고치려던 문제다.
  // ⚠️ zoom 은 레이아웃에 반영되는 축소라 부모 높이도 같이 줄어든다(transform:scale 은 그렇지 않아
  //    아래에 빈 공간이 남는다). 그래서 scale 이 아니라 zoom 이다.
  useEffect(() => {
    if (!isolated) return
    const outer = fitRef.current
    const host = hostRef.current
    if (!outer || !host) return
    const apply = () => {
      host.style.zoom = ''
      host.style.width = `${NOTICE_WIDTH}px`
      const doc = host.shadowRoot?.getElementById(DOC_ID)
      // 업로드 때 맞춰 둔 문서는 이미 표준 폭이다 — 다시 재면 그 배율이 한 번 더 곱해진다
      // (scrollWidth 는 배율을 벗긴 원래 폭을 돌려주기 때문이다. 실제로 91% 가 82% 로 줄었다).
      const natural = prefitted
        ? NOTICE_WIDTH
        : Math.max(NOTICE_WIDTH, Math.round(doc?.scrollWidth ?? NOTICE_WIDTH))
      if (natural > NOTICE_WIDTH) {
        // 옛 공지는 제 폭 그대로 자리를 주고 배율로 눌러 맞춘다 — 1000px 상자에 가둔 채 줄이면
        // 내용이 상자 밖으로 삐져나온 채 작아져서, 줄인 만큼 오른쪽이 비어 보인다.
        host.style.width = `${natural}px`
        host.style.zoom = String(Number((NOTICE_WIDTH / natural).toFixed(4)))
      }
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(outer)
    return () => ro.disconnect()
  }, [isolated, clean, prefitted])

  if (isolated) {
    return (
      // ⚠️ 가로 스크롤은 **여기**여야 한다. 페이지 바깥은 overflow-x:hidden 이라 거기서 넘치면
      //    스크롤이 안 생기고 그냥 잘린다(그게 원래 증상이었다). 이 칸 안에서만 옆으로 민다.
      <div ref={fitRef} className={className} style={{ overflowX: 'auto' }}>
        <div ref={hostRef} style={{ width: NOTICE_WIDTH }} />
      </div>
    )
  }
  return <div className={className} dangerouslySetInnerHTML={{ __html: clean }} />
}
