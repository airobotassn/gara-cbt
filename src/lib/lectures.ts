// 러닝 라이브러리(/ebooks) 의 강의 목록 — **데모용 하드코딩**이다.
//   운영으로 가면 이북처럼 관리자 등록(테이블 `lectures` + admin 탭)으로 옮기고, 이 파일은 시드로만 남긴다.
//
// 왜 유튜브 임베드인가: 영상 데이터는 구글 서버 → 사용자 브라우저로 직접 흐른다.
//   우리 쪽(Cloudflare)에서 나가는 건 <iframe> 태그 몇 KB 뿐이라 **대역폭 비용이 0**이다.
//   (mp4 를 Storage 에 올려 직접 서빙하면 그때부터 트래픽이 우리 몫이 된다 — 하지 말 것.)
//   대가: 광고·수익은 유튜브/영상 소유자 것이고, 원본이 내려가면 우리 화면에서 그냥 깨진다.
//
// ⚠️ 레벨 배정은 데모라 임의다(공식 커리큘럼 아님). 실제 강의가 들어오면 다시 짤 것.

export interface Lecture {
  /** 유튜브 video id */
  id: string
  title: string
  channel: string
  /** 레벨테스트 레벨(1~7) */
  level: number
}

/** 썸네일 — 유튜브가 무료로 주는 정적 이미지(플레이어를 안 띄우므로 목록이 가볍다). */
export const ytThumb = (id: string) => `https://img.youtube.com/vi/${id}/hqdefault.jpg`
/** 재생 — nocookie 도메인이라 재생 전까지 추적 쿠키가 안 박힌다. */
export const ytEmbed = (id: string) =>
  `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`
/** 임베드가 막힌 영상(소유자가 차단)일 때의 탈출구 */
export const ytWatch = (id: string) => `https://www.youtube.com/watch?v=${id}`

// 레벨당 1편. 교재도 레벨당 1권이라 짝을 맞춘 것 — 늘릴 땐 화면 쪽은 손댈 게 없다(열이 알아서 스크롤).
export const LECTURES: Lecture[] = [
  { level: 1, id: 'zjkBMFhNj_g', title: 'Intro to Large Language Models', channel: 'Andrej Karpathy' },
  { level: 2, id: 'LPZh9BOjkQs', title: 'Large Language Models explained briefly', channel: '3Blue1Brown' },
  { level: 3, id: 'rfscVS0vtbw', title: 'Learn Python — Full Course for Beginners', channel: 'freeCodeCamp' },
  { level: 4, id: 'kCc8FmEb1nY', title: "Let's build GPT: from scratch, in code", channel: 'Andrej Karpathy' },
  { level: 5, id: 'VMj-3S1tku0', title: 'The spelled-out intro to neural networks and backpropagation', channel: 'Andrej Karpathy' },
  { level: 6, id: '9-Jl0dxWQs8', title: 'How might LLMs store facts', channel: '3Blue1Brown' },
  { level: 7, id: '7xTGNNLPyMI', title: 'Deep Dive into LLMs like ChatGPT', channel: 'Andrej Karpathy' },
]

export function lecturesForLevel(level: number): Lecture[] {
  return LECTURES.filter((l) => l.level === level)
}
