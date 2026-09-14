// 닿아라(reach-cari) 레벨 기하 — 서버 재채점용 사본.
//
// ⛔ 단일 출처는 게임 `public/games/reach-cari.html` 의 LEVELS 다(레벨 설계는 거기서 한다). 이 파일은 그중
//    **채점에 필요한 기하만**(팔 뿌리·마디 길이·관절 한계·목표·장애물·제한시간) 베낀 것이고, 문구(name·sub·goal·take)와
//    start·solve 는 안 담는다. 게임에 레벨을 넣거나 고치면 여기도 같이 — tests/minigame-replay.mjs 가 두 파일을 대조한다.
//    (HTML 은 자립형이라 TS 모듈을 import 할 수 없고, 엣지 함수는 public/ 을 못 읽는다 — 그래서 두 벌이다.)
//
// 서버는 게임이 보낸 "레벨별 최종 관절 각도" 로 손끝 위치를 다시 계산해(정기구학) 목표 반경 안인지, 팔이 장애물·
// 화면 밖에 닿지 않았는지 본다. 게임의 draw() 판정과 같은 식이다(반경 +9 여유, 장애물 두께 6 패딩).

export interface ReachLevel {
  base: { x: number; y: number }
  segs: number[]
  limits: [number, number][]
  target: { x: number; y: number; r: number }
  obstacles: { x: number; y: number; w: number; h: number }[]
  /** 제한시간(초). 게임의 L.time — 없으면 DEFAULT_TIME. */
  time: number
}

export const REACH_DEFAULT_TIME = 60

export const REACH_LEVELS: ReachLevel[] = [
  { base: { x: 200, y: 460 }, segs: [115,100], limits: [[-165,165],[-155,155]],
    target: { x: 300, y: 340, r: 20 }, obstacles: [], time: REACH_DEFAULT_TIME },
  { base: { x: 200, y: 460 }, segs: [115,100], limits: [[-165,165],[-150,150]],
    target: { x: 105, y: 335, r: 20 }, obstacles: [], time: REACH_DEFAULT_TIME },
  { base: { x: 200, y: 460 }, segs: [110,90,66], limits: [[-160,160],[-150,150],[-150,150]],
    target: { x: 300, y: 320, r: 23 }, obstacles: [], time: REACH_DEFAULT_TIME },
  { base: { x: 210, y: 460 }, segs: [100,88,70], limits: [[-160,160],[-150,150],[-150,150]],
    target: { x: 120, y: 320, r: 19 }, obstacles: [{ x: 210, y: 360, w: 120, h: 24 }], time: REACH_DEFAULT_TIME },
  { base: { x: 200, y: 460 }, segs: [100,88,70], limits: [[-165,165],[-150,150],[-150,150]],
    target: { x: 205, y: 262, r: 19 }, obstacles: [{ x: 200, y: 340, w: 120, h: 22 }], time: REACH_DEFAULT_TIME },
  { base: { x: 200, y: 460 }, segs: [95,85,75,62], limits: [[-165,165],[-150,150],[-150,150],[-150,150]],
    target: { x: 330, y: 250, r: 18 }, obstacles: [{ x: 260, y: 325, w: 22, h: 190 }, { x: 190, y: 300, w: 140, h: 22 }], time: REACH_DEFAULT_TIME },
  { base: { x: 90, y: 460 }, segs: [95,85,74,62], limits: [[-170,170],[-160,160],[-160,160],[-160,160]],
    target: { x: 300, y: 300, r: 18 }, obstacles: [{ x: 200, y: 150, w: 24, h: 150 }, { x: 200, y: 400, w: 24, h: 120 }], time: REACH_DEFAULT_TIME },
  { base: { x: 100, y: 460 }, segs: [95,85,75,62], limits: [[-165,165],[-150,150],[-150,150],[-150,150]],
    target: { x: 300, y: 340, r: 20 }, obstacles: [{ x: 200, y: 375, w: 22, h: 190 }], time: REACH_DEFAULT_TIME },
  { base: { x: 110, y: 460 }, segs: [95,85,75,62], limits: [[-170,170],[-160,160],[-160,160],[-160,160]],
    target: { x: 300, y: 430, r: 20 }, obstacles: [{ x: 230, y: 350, w: 32, h: 226 }], time: REACH_DEFAULT_TIME },
  { base: { x: 110, y: 460 }, segs: [95,85,75,62], limits: [[-165,165],[-150,150],[-150,150],[-150,150]],
    target: { x: 295, y: 320, r: 22 }, obstacles: [{ x: 230, y: 385, w: 26, h: 170 }], time: REACH_DEFAULT_TIME },
  { base: { x: 200, y: 460 }, segs: [100,90,75], limits: [[-165,165],[-150,150],[-150,150]],
    target: { x: 200, y: 262, r: 18 }, obstacles: [{ x: 200, y: 392, w: 100, h: 22 }, { x: 100, y: 300, w: 22, h: 170 }, { x: 300, y: 300, w: 22, h: 170 }], time: REACH_DEFAULT_TIME },
  { base: { x: 200, y: 460 }, segs: [95,85,75,62], limits: [[-165,165],[-150,150],[-150,150],[-150,150]],
    target: { x: 200, y: 200, r: 18 }, obstacles: [{ x: 250, y: 330, w: 130, h: 22 }, { x: 110, y: 250, w: 130, h: 22 }], time: REACH_DEFAULT_TIME },
  { base: { x: 90, y: 460 }, segs: [95,85,75,62], limits: [[-165,165],[-150,150],[-150,150],[-150,150]],
    target: { x: 320, y: 420, r: 18 }, obstacles: [{ x: 230, y: 470, w: 24, h: 90 }, { x: 230, y: 330, w: 24, h: 140 }], time: REACH_DEFAULT_TIME },
  { base: { x: 310, y: 460 }, segs: [95,85,75,62], limits: [[-165,165],[-150,150],[-150,150],[-150,150]],
    target: { x: 80, y: 420, r: 18 }, obstacles: [{ x: 170, y: 470, w: 24, h: 90 }, { x: 170, y: 330, w: 24, h: 140 }], time: REACH_DEFAULT_TIME },
  { base: { x: 200, y: 460 }, segs: [95,85,75,62], limits: [[-165,165],[-150,150],[-150,150],[-150,150]],
    target: { x: 200, y: 200, r: 18 }, obstacles: [{ x: 150, y: 330, w: 130, h: 22 }, { x: 290, y: 250, w: 130, h: 22 }], time: REACH_DEFAULT_TIME },
  { base: { x: 200, y: 460 }, segs: [90,80,72,64,56], limits: [[-165,165],[-150,150],[-150,150],[-150,150],[-150,150]],
    target: { x: 108, y: 338, r: 18 }, obstacles: [{ x: 150, y: 310, w: 100, h: 22 }, { x: 150, y: 410, w: 100, h: 22 }, { x: 200, y: 360, w: 22, h: 100 }, { x: 60, y: 290, w: 22, h: 80 }], time: REACH_DEFAULT_TIME },
  { base: { x: 200, y: 460 }, segs: [90,80,72,64,56], limits: [[-165,165],[-150,150],[-150,150],[-150,150],[-150,150]],
    target: { x: 73, y: 438, r: 18 }, obstacles: [{ x: 142, y: 435, w: 28, h: 136 }, { x: 48, y: 365, w: 28, h: 216 }, { x: 132.5, y: 285, w: 241, h: 28 }], time: REACH_DEFAULT_TIME },
  { base: { x: 200, y: 460 }, segs: [90,80,72,64,56], limits: [[-165,165],[-150,150],[-150,150],[-150,150],[-150,150]],
    target: { x: 244, y: 383, r: 18 }, obstacles: [{ x: 250, y: 310, w: 112, h: 34 }, { x: 250, y: 410, w: 112, h: 34 }, { x: 200, y: 360, w: 34, h: 112 }, { x: 340, y: 290, w: 34, h: 92 }], time: REACH_DEFAULT_TIME },
  { base: { x: 200, y: 460 }, segs: [90,80,72,64,56], limits: [[-165,165],[-150,150],[-150,150],[-150,150],[-150,150]],
    target: { x: 327, y: 321, r: 18 }, obstacles: [{ x: 148, y: 380, w: 34, h: 192 }, { x: 252, y: 405, w: 34, h: 142 }, { x: 244, y: 245, w: 204, h: 34 }, { x: 311, y: 350, w: 130, h: 34 }], time: REACH_DEFAULT_TIME },
  { base: { x: 200, y: 460 }, segs: [90,80,72,64,56], limits: [[-165,165],[-150,150],[-150,150],[-150,150],[-150,150]],
    target: { x: 334, y: 434, r: 18 }, obstacles: [{ x: 258, y: 435, w: 28, h: 136 }, { x: 352, y: 365, w: 28, h: 216 }, { x: 267.5, y: 285, w: 241, h: 28 }], time: REACH_DEFAULT_TIME },
  { base: { x: 210, y: 460 }, segs: [90,80,72,64,56], limits: [[-165,165],[-150,150],[-150,150],[-150,150],[-150,150]],
    target: { x: 234, y: 276, r: 18 }, obstacles: [{ x: 245, y: 395, w: 208, h: 40 }, { x: 80, y: 390, w: 40, h: 198 }, { x: 112.5, y: 305, w: 223, h: 40 }, { x: 290, y: 295, w: 40, h: 228 }], time: REACH_DEFAULT_TIME },
  { base: { x: 200, y: 460 }, segs: [90,80,72,64,56], limits: [[-165,165],[-150,150],[-150,150],[-150,150],[-150,150]],
    target: { x: 128, y: 272, r: 18 }, obstacles: [{ x: 150, y: 265, w: 28, h: 136 }, { x: 150, y: 440, w: 28, h: 86 }, { x: 250, y: 390, w: 28, h: 186 }, { x: 200, y: 200, w: 128, h: 28 }, { x: 60, y: 340, w: 28, h: 286 }, { x: 105, y: 430, w: 96, h: 28 }], time: REACH_DEFAULT_TIME },
  { base: { x: 200, y: 470 }, segs: [85,76,68,60,54,48], limits: [[-165,165],[-150,150],[-150,150],[-150,150],[-150,150],[-150,150]],
    target: { x: 197, y: 272, r: 18 }, obstacles: [{ x: 275, y: 345, w: 22, h: 290 }, { x: 125, y: 345, w: 22, h: 290 }, { x: 235, y: 400, w: 80, h: 22 }, { x: 165, y: 320, w: 80, h: 22 }], time: REACH_DEFAULT_TIME },
  { base: { x: 200, y: 470 }, segs: [85,76,68,60,54,48], limits: [[-165,165],[-150,150],[-150,150],[-150,150],[-150,150],[-150,150]],
    target: { x: 199, y: 271, r: 18 }, obstacles: [{ x: 125, y: 345, w: 22, h: 290 }, { x: 275, y: 345, w: 22, h: 290 }, { x: 165, y: 400, w: 80, h: 22 }, { x: 235, y: 320, w: 80, h: 22 }], time: REACH_DEFAULT_TIME },
  { base: { x: 200, y: 478 }, segs: [80,72,65,58,52,46,40], limits: [[-165,165],[-150,150],[-150,150],[-150,150],[-150,150],[-150,150],[-150,150]],
    target: { x: 256, y: 185, r: 17 }, obstacles: [{ x: 165, y: 392.5, w: 22, h: 205 }, { x: 235, y: 392.5, w: 22, h: 205 }, { x: 87.5, y: 320, w: 155, h: 22 }, { x: 267.5, y: 320, w: 65, h: 22 }, { x: 110, y: 245, w: 22, h: 150 }, { x: 237.5, y: 235, w: 125, h: 22 }, { x: 280, y: 192.5, w: 22, h: 85 }, { x: 195, y: 165, w: 170, h: 22 }], time: REACH_DEFAULT_TIME },
  { base: { x: 200, y: 478 }, segs: [80,72,65,58,52,46,40], limits: [[-165,165],[-150,150],[-150,150],[-150,150],[-150,150],[-150,150],[-150,150]],
    target: { x: 307, y: 396, r: 17 }, obstacles: [{ x: 165, y: 407.5, w: 22, h: 175 }, { x: 235, y: 407.5, w: 22, h: 175 }, { x: 87.5, y: 345, w: 155, h: 22 }, { x: 247.5, y: 245, w: 195, h: 22 }, { x: 275, y: 362.5, w: 22, h: 115 }, { x: 340, y: 332.5, w: 22, h: 175 }], time: REACH_DEFAULT_TIME },
  { base: { x: 200, y: 478 }, segs: [80,72,65,58,52,46,40], limits: [[-165,165],[-150,150],[-150,150],[-150,150],[-150,150],[-150,150],[-150,150]],
    target: { x: 179, y: 196, r: 17 }, obstacles: [{ x: 140, y: 337.5, w: 22, h: 315 }, { x: 260, y: 337.5, w: 22, h: 315 }, { x: 169.5, y: 400, w: 59, h: 22 }, { x: 230.5, y: 330, w: 59, h: 22 }, { x: 169.5, y: 260, w: 59, h: 22 }], time: REACH_DEFAULT_TIME },
  { base: { x: 190, y: 478 }, segs: [80,72,65,58,52,46,40], limits: [[-165,165],[-150,150],[-150,150],[-150,150],[-150,150],[-150,150],[-150,150]],
    target: { x: 270, y: 435, r: 18 }, obstacles: [{ x: 240, y: 415, w: 22, h: 170 }, { x: 310, y: 360, w: 22, h: 220 }, { x: 237.5, y: 265, w: 175, h: 22 }], time: REACH_DEFAULT_TIME },
  { base: { x: 200, y: 478 }, segs: [80,72,65,58,52,46,40], limits: [[-165,165],[-150,150],[-150,150],[-150,150],[-150,150],[-150,150],[-150,150]],
    target: { x: 93, y: 396, r: 17 }, obstacles: [{ x: 235, y: 407.5, w: 22, h: 175 }, { x: 165, y: 407.5, w: 22, h: 175 }, { x: 312.5, y: 345, w: 155, h: 22 }, { x: 152.5, y: 245, w: 195, h: 22 }, { x: 125, y: 362.5, w: 22, h: 115 }, { x: 60, y: 332.5, w: 22, h: 175 }], time: REACH_DEFAULT_TIME },
  { base: { x: 200, y: 478 }, segs: [80,72,65,58,52,46,40], limits: [[-165,165],[-150,150],[-150,150],[-150,150],[-150,150],[-150,150],[-150,150]],
    target: { x: 144, y: 185, r: 17 }, obstacles: [{ x: 235, y: 392.5, w: 22, h: 205 }, { x: 165, y: 392.5, w: 22, h: 205 }, { x: 312.5, y: 320, w: 155, h: 22 }, { x: 132.5, y: 320, w: 65, h: 22 }, { x: 290, y: 245, w: 22, h: 150 }, { x: 162.5, y: 235, w: 125, h: 22 }, { x: 120, y: 192.5, w: 22, h: 85 }, { x: 205, y: 165, w: 170, h: 22 }], time: REACH_DEFAULT_TIME },
]

// ── 정기구학 + 충돌 — 게임 HTML 의 fkPoints / segRect / segAABB / segSeg / armHitsAny 그대로 ──
const D2R = Math.PI / 180
type Pt = { x: number; y: number }

export function fkPoints(L: ReachLevel, a: number[]): Pt[] {
  const pts: Pt[] = [{ x: L.base.x, y: L.base.y }]
  let acc = 0
  for (let i = 0; i < a.length; i++) {
    acc += a[i] * D2R
    const p = pts[i]
    pts.push({ x: p.x + L.segs[i] * Math.cos(acc), y: p.y + L.segs[i] * Math.sin(acc) })
  }
  return pts
}
function segSeg(a: number, b: number, c: number, d: number, p: number, q: number, r: number, s: number): boolean {
  const d1 = (r - p) * (b - q) - (s - q) * (a - p)
  const d2 = (r - p) * (d - q) - (s - q) * (c - p)
  const d3 = (c - a) * (q - b) - (d - b) * (p - a)
  const d4 = (c - a) * (s - b) - (d - b) * (r - a)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}
function segAABB(x1: number, y1: number, x2: number, y2: number, xmin: number, ymin: number, xmax: number, ymax: number): boolean {
  const inside = (x: number, y: number) => x >= xmin && x <= xmax && y >= ymin && y <= ymax
  if (inside(x1, y1) || inside(x2, y2)) return true
  return segSeg(x1, y1, x2, y2, xmin, ymin, xmax, ymin) ||
    segSeg(x1, y1, x2, y2, xmax, ymin, xmax, ymax) ||
    segSeg(x1, y1, x2, y2, xmax, ymax, xmin, ymax) ||
    segSeg(x1, y1, x2, y2, xmin, ymax, xmin, ymin)
}
function segRect(p1: Pt, p2: Pt, r: { x: number; y: number; w: number; h: number }): boolean {
  const pad = 5.5 // 팔 두께 — 게임은 6. 각도를 0.1° 로 반올림해 보내므로 0.5px 만큼 봐준다(멀쩡한 클리어를 튕기지 않게)
  const rx = r.x - r.w / 2 - pad, ry = r.y - r.h / 2 - pad, rw = r.w + pad * 2, rh = r.h + pad * 2
  return segAABB(p1.x, p1.y, p2.x, p2.y, rx, ry, rx + rw, ry + rh)
}
export function armHitsAny(L: ReachLevel, pts: Pt[]): boolean {
  for (const ob of L.obstacles) for (let i = 0; i < pts.length - 1; i++) if (segRect(pts[i], pts[i + 1], ob)) return true
  for (let i = 1; i < pts.length; i++) if (pts[i].x < 3.5 || pts[i].x > 396.5 || pts[i].y < 3.5 || pts[i].y > 516.5) return true // 게임은 4/396/4/516
  return false
}
/** 판정점 = 집게 중심. 집게 그림이 마지막 마디 끝에서 앞으로 뻗어 있어 손끝 점으로 재면 "감싸고 있는데 안 닿음" 이 된다.
 *  ⛔ 게임 HTML 의 GRIP 과 sync pair(tests/minigame-replay.mjs 가 대조). */
export const REACH_GRIP = 26
export function gripPoint(pts: Pt[]): Pt {
  const t = pts[pts.length - 1], p = pts[pts.length - 2], len = Math.hypot(t.x - p.x, t.y - p.y) || 1
  return { x: t.x + (t.x - p.x) / len * REACH_GRIP, y: t.y + (t.y - p.y) / len * REACH_GRIP }
}
/** 그 각도로 정말 닿았나 — 게임 judge() 의 `reached` 판정과 같다(집게 중심이 목표 반경 +9 안, 충돌 없음). */
export function reachedWith(L: ReachLevel, a: number[]): boolean {
  if (a.length !== L.segs.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] < L.limits[i][0] - 0.05 || a[i] > L.limits[i][1] + 0.05) return false
  const pts = fkPoints(L, a)
  const g = gripPoint(pts)
  return Math.hypot(g.x - L.target.x, g.y - L.target.y) < L.target.r + 9 + 1 && !armHitsAny(L, pts) // +1 = 반올림 여유
}
