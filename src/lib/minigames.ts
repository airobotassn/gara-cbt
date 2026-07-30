// 미니게임 레지스트리 — /hub 의 '미니 게임' 선택창(표지형 커버 타일, 세로 배열)과 플레이 라우트(/games/:id)가 공유.
//   게임 본체는 자립형 정적 HTML(public/games/*.html)이라 iframe 으로 임베드한다(월드 아레나와 동일 패턴).
//   새 게임 추가 = 이 배열에 항목 하나 + public/games 에 html/커버아트(art) 넣기.

export interface MiniGame {
  id: string // URL 슬러그 (/games/:id)
  title: string // 커버 제목
  accent?: string // 제목 중 파란색으로 강조할 토큰(예: 'CARI')
  tagline: string // 커버 하단 한 줄 소개
  badge: string // 커버 상단 카테고리 뱃지
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
    title: '버텨라 CARI',
    accent: 'CARI',
    tagline: '쏟아지는 돌, 문제로 버텨라!',
    badge: 'AI · 로봇 용어 서바이벌',
    art: '/games/beat-cari-cover.png',
    src: '/games/beat-cari.html',
    frame: '#241830', // 동굴 아트 암부색
  },
  {
    id: 'shoot-cari',
    title: '쏴라 CARI',
    accent: 'CARI',
    tagline: '쏟아지는 운석을 정답으로 격추!',
    badge: 'AI · 로봇 용어 슈팅',
    art: '/games/shoot-cari-cover.png',
    src: '/games/shoot-cari.html',
    frame: '#05021c', // 게임 body 와 동일한 우주 남색
  },
  {
    id: 'pick-cari',
    title: '골라라 CARI',
    accent: 'CARI',
    tagline: '발판이 무너지기 전에 O·X 를 골라라!',
    badge: 'AI · 로봇 용어 OX 서바이벌',
    art: '/games/pick-cari-cover.png',
    src: '/games/pick-cari.html',
    frame: '#e3ebf7', // 스테이지가 크림/밝은 톤이라 밝은 프레임 유지(게임 body 와 동일)
  },
  // 아래 둘은 용어 퀴즈가 아니라 로봇 조작/코딩 퍼즐이다(문제 은행을 쓰지 않는다) — 뱃지 문구도 그렇게 구분했다.
  {
    id: 'reach-cari',
    title: '닿아라 CARI',
    accent: 'CARI',
    tagline: '관절을 움직여 목표에 닿아라',
    badge: '로봇팔 · 기구학 퍼즐',
    art: '/games/reach-cari-cover.png',
    src: '/games/reach-cari.html',
    frame: '#e3ebf7', // 게임 body 의 radial-gradient 바깥색과 동일(밝은 톤)
  },
  {
    id: 'program-cari',
    title: '프로그램해라 CARI',
    accent: 'CARI',
    tagline: '명령을 짜서 CARI를 움직여라',
    badge: '로봇 · 블록 코딩 퍼즐',
    art: '/games/program-cari-cover.png',
    src: '/games/program-cari.html',
    frame: '#e3ebf7', // 위와 동일 팔레트(같은 시안에서 나온 자매 게임)
  },
  {
    id: 'build-cari',
    title: '지어라 CARI',
    accent: 'CARI',
    tagline: '라인을 깔면 공장이 알아서 돌아가요!',
    badge: '스마트팩토리 · 라인 설계 퍼즐',
    art: '/games/build-cari-cover.png',
    src: '/games/build-cari.html',
    frame: '#e3ebf7', // 위와 동일 팔레트
  },
]

export function findMiniGame(id: string | undefined): MiniGame | undefined {
  return MINIGAMES.find((g) => g.id === id)
}
