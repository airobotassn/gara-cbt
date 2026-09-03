// 미니게임 레지스트리 — /hub 의 '미니 게임' 선택창(표지형 커버 타일, 세로 배열)과 플레이 라우트(/games/:id)가 공유.
//   게임 본체는 자립형 정적 HTML(public/games/*.html)이라 iframe 으로 임베드한다(월드 아레나와 동일 패턴).
//   새 게임 추가 = 이 배열에 항목 하나 + public/games 에 html/커버아트(art) 넣기.

export interface MiniGame {
  id: string // URL 슬러그 (/games/:id)
  /** 제목·소개·뱃지는 여기 두지 않는다 — 사전 키(mg.<id>.title / .tagline / .badge)로 조립한다.
   *  데이터에 한국어를 두면 언어를 바꿔도 커버만 한국어로 남는다(2026-08-07 이관). */
  accent?: string // 제목 중 파란색으로 강조할 토큰(예: 'CARI') — 캐릭터 이름이라 번역 대상 아님
  art: string // 커버 일러스트(캐릭터) PNG (public 경로)
  src: string // 게임 본체 정적 HTML (public 경로) — iframe src
  /** 플레이 화면 상단 바 색 = 게임 바깥(레터박스) 색.
   *  ⚠️ 게임 HTML 의 body 배경과 짝 — 한쪽만 바꾸면 상단에 이색 띠가 생긴다.
   *  밝기는 자동 판정(어두우면 흰 글자) — MiniGame.tsx 의 isDark 참고. */
  frame: string
  /** 게임 본체(스테이지)의 최대 가로폭 px — 플레이 화면 상단 바를 이 폭으로 좁혀 게임과 왼쪽 끝을 맞춘다.
   *  ⚠️ 게임 HTML 안의 스테이지 폭과 짝이다(.stage 의 `width:min(Npx,100vw)` 또는 #app 의 `max-width`).
   *     한쪽만 바꾸면 상단 바가 게임보다 넓거나 좁게 떠서 왼쪽 끝이 어긋난다.
   *  좁은 화면에선 게임이 100vw 라 바도 자동으로 화면 전체 폭이 된다(min 으로 접힌다). */
  stage: number
}

export const MINIGAMES: MiniGame[] = [
  {
    id: 'beat-cari',
    accent: 'CARI',
    art: '/games/beat-cari-cover-gameplay-v1.webp',
    src: '/games/beat-cari.html',
    frame: '#241830', // 동굴 아트 암부색
    stage: 460,
  },
  {
    id: 'shoot-cari',
    accent: 'CARI',
    art: '/games/shoot-cari-cover.webp',
    src: '/games/shoot-cari.html',
    frame: '#05021c', // 게임 body 와 동일한 우주 남색
    stage: 460,
  },
  {
    id: 'pick-cari',
    accent: 'CARI',
    art: '/games/pick-cari-cover-gameplay-v1.webp',
    src: '/games/pick-cari.html',
    frame: '#e3ebf7', // 스테이지가 크림/밝은 톤이라 밝은 프레임 유지(게임 body 와 동일)
    stage: 460,
  },
  // 아래 둘은 용어 퀴즈가 아니라 로봇 조작/코딩 퍼즐이다(문제 은행을 쓰지 않는다) — 뱃지 문구도 그렇게 구분했다.
  {
    id: 'reach-cari',
    accent: 'CARI',
    art: '/games/reach-cari-cover.webp',
    src: '/games/reach-cari.html',
    frame: '#09172c', // 게임 body 의 연구실 외곽 남색과 동일
    stage: 460,
  },
  {
    id: 'program-cari',
    accent: 'CARI',
    art: '/games/program-cari-cover-v2.webp',
    src: '/games/program-cari.html',
    frame: '#e3ebf7', // 위와 동일 팔레트(같은 시안에서 나온 자매 게임)
    stage: 460,
  },
  {
    id: 'build-cari',
    accent: 'CARI',
    art: '/games/build-cari-cover-gameplay-v1.webp',
    src: '/games/build-cari.html',
    frame: '#d8d4ca', // 지상형 스마트팩토리 작업실 가장자리 색
    stage: 460,
  },
  // 아래 둘은 용어 퀴즈도 조작 퍼즐도 아닌 '판단' 계열이다 —
  // 규정을 읽고 서류를 가리거나(막아라), 지시를 골라 결과를 맞춘다(시켜라).
  {
    id: 'block-cari',
    accent: 'CARI',
    art: '/games/block-cari-cover-gameplay-v1.webp',
    src: '/games/block-cari.html',
    frame: '#14161d', // 게임 body 그라디언트의 가장 어두운 끝
    stage: 520,
  },
  {
    id: 'order-cari',
    accent: 'CARI',
    art: '/games/order-cari-cover-gameplay-v1.webp',
    src: '/games/order-cari.html',
    // ⚠️ 옛 값 #d5dded(밝은 공방 톤)은 v4 아트로 갈면서 죽었다 — body 가 어두운 공장(#071426)이 되며
    //   isDark 가 '밝다'로 판정해 흰 상단 바가 검은 게임 위에 이색 띠로 얹혔다(2026-08-14).
    frame: '#071426', // 게임 body 바탕색과 동일
    stage: 520,
  },
  {
    id: 'feel-cari',
    accent: 'CARI',
    // 센서 탐사 콘셉트와 CARI 캐릭터 시트를 반영한 전용 커버.
    art: '/games/feel-cari-cover-gameplay-v2.webp',
    src: '/games/feel-cari.html',
    frame: '#070a14', // 게임 body 그라디언트의 가장 어두운 끝
    stage: 520,
  },
]

/** 용어 문제 은행(term_questions)을 쓰는 게임 — 나머지는 조작 퍼즐·판단이라 문항이 필요 없다.
 *  ⚠️ 서버 `term-pool` 의 TARGETS · 관리자 화면의 TERM_TARGETS 와 **같은 목록**이어야 한다
 *     (관리자가 '쏴라'에 문항을 담았는데 게임이 안 받아가는 어긋남을 막는다). */
export const TERM_GAME_IDS = ['beat-cari', 'shoot-cari', 'pick-cari'] as const
export function isTermGame(id: string | undefined): boolean {
  return (TERM_GAME_IDS as readonly string[]).includes(id ?? '')
}

/** 비로그인(게스트)에게 열어두는 게임 — **이 하나뿐**이다(2026-08-24 결정).
 *  나머지는 목록에서 PLAY 가 회색으로 죽고, 주소를 직접 쳐도 로그인 안내로 막힌다.
 *  ⚠️ 두 화면(`/games` 목록 · `/games/:id` 실행)이 **같은 판정**을 써야 한다 — 목록만 막으면
 *     회색 버튼은 장식이 되고 주소창으로 그대로 들어간다.
 *  ⚠️ 이건 '무한 공짜'를 끊는 장치지 보안 장치가 아니다. 게스트 식별 수단이 없어서 판수로는 못 세고
 *     (지우면 리셋된다), 대신 **열어주는 게임을 하나로 좁히는** 쪽을 택했다. */
export const GUEST_GAME_ID = 'beat-cari'
export function guestPlayable(id: string | undefined): boolean {
  return id === GUEST_GAME_ID
}

export function findMiniGame(id: string | undefined): MiniGame | undefined {
  return MINIGAMES.find((g) => g.id === id)
}
