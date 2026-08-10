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
}

export const MINIGAMES: MiniGame[] = [
  {
    id: 'beat-cari',
    accent: 'CARI',
    art: '/games/beat-cari-cover.png',
    src: '/games/beat-cari.html',
    frame: '#241830', // 동굴 아트 암부색
  },
  {
    id: 'shoot-cari',
    accent: 'CARI',
    art: '/games/shoot-cari-cover.png',
    src: '/games/shoot-cari.html',
    frame: '#05021c', // 게임 body 와 동일한 우주 남색
  },
  {
    id: 'pick-cari',
    accent: 'CARI',
    art: '/games/pick-cari-cover.png',
    src: '/games/pick-cari.html',
    frame: '#e3ebf7', // 스테이지가 크림/밝은 톤이라 밝은 프레임 유지(게임 body 와 동일)
  },
  // 아래 둘은 용어 퀴즈가 아니라 로봇 조작/코딩 퍼즐이다(문제 은행을 쓰지 않는다) — 뱃지 문구도 그렇게 구분했다.
  {
    id: 'reach-cari',
    accent: 'CARI',
    art: '/games/reach-cari-cover.png',
    src: '/games/reach-cari.html',
    frame: '#e3ebf7', // 게임 body 의 radial-gradient 바깥색과 동일(밝은 톤)
  },
  {
    id: 'program-cari',
    accent: 'CARI',
    art: '/games/program-cari-cover.png',
    src: '/games/program-cari.html',
    frame: '#e3ebf7', // 위와 동일 팔레트(같은 시안에서 나온 자매 게임)
  },
  {
    id: 'build-cari',
    accent: 'CARI',
    art: '/games/build-cari-cover.png',
    src: '/games/build-cari.html',
    frame: '#e3ebf7', // 위와 동일 팔레트
  },
]

export function findMiniGame(id: string | undefined): MiniGame | undefined {
  return MINIGAMES.find((g) => g.id === id)
}
