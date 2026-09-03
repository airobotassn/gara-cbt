// 강의 재생 헬퍼. 목록은 **전부 DB(lectures 테이블)** 이고 여기엔 데이터가 없다.
//
// ⛔ **영상 출처가 둘이다 — 강의 한 편은 둘 중 한쪽이다**(2026-09-03. DB CHECK `lectures_source_chk`).
//    · **유튜브** — 기존 무료 강의. 이 파일의 `ytEmbed` 로 바로 재생한다.
//    · **Bunny Stream** — 유료 강의. 재생 주소를 **서버가 서명해서** 준다(`ebooks.play`).
//      그래서 여기엔 URL 을 만드는 함수가 없다 — 만들 수 있으면 안 된다(토큰 키가 서버에만 있다).
//
// ⛔ **코드에 박힌 데모 목록(LECTURES 7편)은 제거됐다(2026-08-25).** 강의가 이북과 같은 유료 상품이
//    되면서, DB 에 없는 강의는 팔 수도 소유할 수도 없게 됐다 — 폴백을 남겨두면 **아무도 안 판 강의가
//    무료로 재생되는 유령 항목**이 화면에 남는다. DB 가 비었으면 강의 열도 비는 게 맞다.
//    (덤으로 그 7편은 전부 남의 영상이었다 — 남의 영상을 임베드해 돈을 받는 건 유튜브 약관·저작권 위반이다.)
//
// ⛔ **유튜브로 파는 강의는 미등록(unlisted) 업로드여야 한다 — 아래는 유튜브 강의에만 해당한다.**
//    유튜브 공개 영상은 링크(=영상 id)만 알면 누구나 무료로 본다. 그래서 서버(ebooks 함수)는
//    **산 사람에게만 youtubeId 를 내려준다** — 그 값이 곧 상품이다.
//    ⚠️ 이 은닉은 구멍을 **가린 것**이지 막은 게 아니다(산 사람이 id 를 퍼뜨리면 끝난다).
//       그걸 실제로 막으려고 들어온 게 Bunny 다 — 거기선 id 를 알아도 서명 없이는 재생이 안 되므로
//       은닉 자체가 필요 없다. **이 규칙을 Bunny 강의에까지 적용하려 들지 말 것**(반대로도 마찬가지다).
//
// 왜 유튜브를 안 걷어냈나: 영상 데이터가 구글 서버 → 사용자 브라우저로 직접 흐르므로 **대역폭 비용이 0**이다.
//   Bunny 는 종량제라(스토리지 $0.01/GB·월 + 전송 $0.005~0.01/GB) 공짜가 아니다 — 돈을 받는 강의에만 쓴다.
//   ⛔ 영상 파일을 **우리 Supabase Storage** 에 올리는 건 여전히 금지다. 그건 트래픽이 통째로 우리 몫이 되고,
//      CDN 도 아니라 느리다. Bunny 로 가는 것과 전혀 다른 얘기다.

/** 썸네일 — 유튜브가 무료로 주는 정적 이미지(플레이어를 안 띄우므로 목록이 가볍다).
 *  ⚠️ 목록에서는 이걸 직접 부르지 말 것 — 서버가 준 `thumbUrl`(관리자 썸네일이 있으면 그것)을 쓴다.
 *     여기서 만들면 미소유 강의의 영상 id 가 필요해져 은닉이 통째로 무너진다. */
export const ytThumb = (id: string) => `https://img.youtube.com/vi/${id}/hqdefault.jpg`

/** 재생 — nocookie 도메인이라 재생 전까지 추적 쿠키가 안 박힌다.
 *  ⚠️ 산 사람만 부른다(youtubeId 가 그때만 내려온다). */
export const ytEmbed = (id: string) =>
  `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`

// ══════════════════════════════════════════════════════════════
// Bunny 플레이어 — 재생 위치 받아오기 (이어보기)
// ══════════════════════════════════════════════════════════════

/**
 * iframe 안에서 도는 Bunny 플레이어에게 "재생 위치가 바뀌면 알려달라"고 구독한다.
 *
 * 왜 이렇게 하나: 재생기는 **다른 오리진의 iframe** 이라 우리가 `<video>` 를 직접 못 읽는다.
 *   Bunny 플레이어가 지원하는 **player.js** 프로토콜(postMessage)로 물어보는 게 유일한 길이다.
 *
 * ⚠️ **이 연결은 실측으로 확인된 게 아니다**(2026-09-03 기준. Bunny 문서에 player.js 지원이라고
 *    적혀 있는 걸 보고 짠 것이다). 이벤트가 안 오면 **이어보기만 안 되고 재생은 멀쩡하다** —
 *    그러라고 아래를 전부 조용히 실패하게 만들었다. 재생을 막는 코드를 여기 넣지 말 것.
 * ⚠️ 남의 창이 보낸 메시지도 이 핸들러에 온다 → **우리 iframe 이 보낸 것만** 받는다(source 대조).
 *
 * @returns 구독 해제 함수
 */
export function watchBunnyProgress(
  iframe: HTMLIFrameElement,
  onTime: (sec: number) => void,
): () => void {
  // 이 iframe 전용 구독 이름 — 한 페이지에 재생기가 둘 이상 뜰 때 서로의 이벤트를 안 받게 한다.
  const listenerId = `lecpos-${Math.random().toString(36).slice(2, 10)}`

  const subscribe = () => {
    // ⚠️ targetOrigin 을 '*' 로 둔다 — 임베드 호스트가 시크릿으로 바뀔 수 있어(옛/새 플레이어) 여기서
    //    고정하면 호스트를 갈 때 조용히 멈춘다. 보내는 내용에 비밀이 없으므로 위험도 없다.
    try {
      iframe.contentWindow?.postMessage(
        JSON.stringify({ context: 'player.js', version: '0.0.11', method: 'addEventListener', value: 'timeupdate', listener: listenerId }),
        '*',
      )
    } catch { /* 아직 안 떴을 뿐이다 — ready 가 오면 다시 보낸다 */ }
  }

  const onMessage = (e: MessageEvent) => {
    if (e.source !== iframe.contentWindow) return
    let msg: { context?: string; event?: string; listener?: string; value?: { seconds?: number } }
    try {
      msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
    } catch { return }
    if (!msg || msg.context !== 'player.js') return
    // 플레이어가 준비되면 구독을 (다시) 건다 — 우리가 먼저 보낸 게 유실됐을 수 있다.
    if (msg.event === 'ready') { subscribe(); return }
    if (msg.event !== 'timeupdate' || msg.listener !== listenerId) return
    const sec = Number(msg.value?.seconds)
    if (Number.isFinite(sec) && sec >= 0) onTime(sec)
  }

  window.addEventListener('message', onMessage)
  // ready 를 이미 놓쳤을 수 있으니 한 번 먼저 찔러 둔다.
  subscribe()
  return () => window.removeEventListener('message', onMessage)
}
