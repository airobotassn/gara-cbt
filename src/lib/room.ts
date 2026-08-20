// 방(남의 방) 주소 헬퍼.
//
// ⚠️ 2026-08-20: **가구·미니룸은 제거됐다.** 방 안에 물건을 놓는 기능(슬롯·좌표·가구 그림)이
//    통째로 사라졌고, `/room/:handle` 은 이제 "그 사람이 꾸민 배경 + 캐릭터"를 보여주는 화면이다.
//    걷어낸 이유: 허브 배경이 사진 한 장이 되면서 CSS 벽·바닥이 설 자리를 잃었고(2026-08-14 허브에서
//    먼저 껐다), 그 뒤로 남의 방에만 옛 상자가 남아 새 배경 위에 겹쳐 떠 있었다.
//    걷어낼 때 **산 사람이 한 명도 없었다**(보유 0 · 구매 0 · 쓴 코인 0) — 그래서 몰수 문제가 없었다.
//    되살리려면 이 커밋을 되짚되, 배경 사진 위 %좌표로 다시 잡아야 한다(CSS 벽·바닥은 못 쓴다).

/** 방 주소. 지금 handle = uid — 서버 room 함수의 handle 해석과 짝이다(짧은 코드로 바꾸면 양쪽 한 줄씩). */
export function roomPath(handle: string): string {
  return `/room/${handle}`
}

export function roomUrl(handle: string): string {
  return `${window.location.origin}${roomPath(handle)}`
}
