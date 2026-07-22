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
  },
  {
    id: 'shoot-cari',
    title: '쏴라 CARI',
    accent: 'CARI',
    tagline: '쏟아지는 운석을 정답으로 격추!',
    badge: 'AI · 로봇 용어 슈팅',
    art: '/games/shoot-cari-cover.png',
    src: '/games/shoot-cari.html',
  },
  {
    id: 'pick-cari',
    title: '골라라 CARI',
    accent: 'CARI',
    tagline: '발판이 무너지기 전에 O·X 를 골라라!',
    badge: 'AI · 로봇 용어 OX 서바이벌',
    art: '/games/pick-cari-cover.png',
    src: '/games/pick-cari.html',
  },
]

export function findMiniGame(id: string | undefined): MiniGame | undefined {
  return MINIGAMES.find((g) => g.id === id)
}
