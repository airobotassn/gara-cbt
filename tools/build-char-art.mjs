// 허브 캐릭터 시트(Lv.1~7 한 줄) → `public/hub/char/<키>/lv1.webp` ~ `lv7.webp`.
//
//   node tools/build-char-art.mjs "<흰배경시트.png>" <키> ["<배경뺀시트.png>"]
//   예: node tools/build-char-art.mjs "C:/…/남자.png" char_a_m "C:/…/남자_배경뺀.png"
//
// 시트가 지켜야 할 것은 두 개뿐이다 — **7칸이 한 줄** · **발끝이 같은 바닥선**.
//
// ── 세 번째 인자(배경 뺀 시트)가 왜 있나 ────────────────────────────────────
// Lv.1~6 은 **배경제거 프로그램이 잡아준 모양(알파)을 쓴다.** 색만 보고는 팔과 몸 사이의
// '틈'(종이)과 Lv.7 후광 속 구름의 흰색을 구분할 수 없어서, 아래 흰 배경 빼기가 그 틈을 흰
// 덩어리로 메운다. "여긴 몸 사이 빈틈" 은 계산이 아니라 판단이고 그건 그쪽이 잘하는 일이다.
//   ⛔ **알파만 가져오고 색은 흰 배경 원본에서 쓴다**(2026-08-26). Photoroom 은 결과를 절반
//      크기로 줄여서 내놓는데, 그 색을 그대로 쓰면 해상도가 통째로 깎인다. 모양은 부드러운
//      마스크라 늘려도 멀쩡하지만 그림은 아니다. 그래서 알파만 원본 크기로 늘려 쓰고,
//      가장자리의 흰색 섞임은 그 알파로 역산해서(un-premultiply) 벗긴다.
//   ⚠️ 잘라내거나 비율을 바꾼 파일은 못 쓴다 — **비율이 같아야** 자리가 맞는다(아래에서 검사한다).
//   ⚠️ 그 파일에 Lv.7 이 같이 들어 있어도 **쓰지 않는다** — 후광이 이미 깨져 있다.
//
// ── Lv.7 은 여기서 흰 배경을 뺀다 ───────────────────────────────────────────
// Lv.7 후광은 바깥으로 갈수록 흰색으로 옅어져 배경과 경계가 없다. 그래서 배경제거 프로그램은
// 후광을 배경으로 보고 같이 지우거나(빛이 통째로 날아간다) 남기면 흰 사각형이 남는다.
// 여기서는 **흰색 위에 합성된 것을 역산해서**(un-premultiply) 후광을 반투명한 빛으로 되살리고,
// 그림 안쪽 흰색(구름·달)은 바깥과 이어지지 않게 막아 구멍이 안 뚫리게 한다.
//   ⚠️ 그러니 **흰 배경 원본을 버리지 말 것** — Lv.7 은 계속 그쪽에서 나온다.
//
// ── 왜 낱장으로 딱 맞게 자르지 않나 ─────────────────────────────────────────
// 무대의 캐릭터 칸은 높이가 고정이고 그림이 object-fit:contain 으로 그 칸에 맞춰진다.
// 레벨마다 여백을 없애 딱 맞게 자르면 **7장이 전부 같은 키로 늘어나** Lv.7 이 오히려 작아진다.
// 그래서 7장을 **같은 크기 캔버스**에 바닥 맞춰 얹는다 — 그림 안의 크기 차이가 화면에 그대로 나온다.
//   ⚠️ 캔버스 높이 = Lv.1~6 평균 키 × HEADROOM. 이 배수는 **캐릭터마다 같아야** 남녀가
//      무대에서 같은 키로 선다(캐릭터별로 재면 Lv.7 이 큰 쪽만 작아진다).
//   ⚠️ 이 배수를 바꾸면 `hub.css` 의 --skin-char-h 도 같이 바꿔야 한다(한 쌍이다).
//      Lv.1~6 이 화면에서 차지하는 높이 = --skin-char-h ÷ HEADROOM.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const HEADROOM = 1.42 // 캔버스 높이 ÷ Lv.1~6 평균 키. 제일 큰 Lv.7 이 들어갈 만큼은 돼야 한다.
const T = 60 // 배경에서 이만큼(0~255) 멀어지면 '벽' — flood fill 이 여기서 멈춘다
const DIL = 3 // 벽 부풀리기(px). 구름 윤곽의 1~2px 틈으로 배경이 새는 것을 막는다
const FEATHER = 14 // 벽 안쪽으로 이만큼 들어가면 완전 불투명. 경계 단차를 없앤다
const LO = 15 // 배경 밝기 편차(가장자리 255 · 안쪽 246)를 흡수할 여유

const [sheet, key, cutout, lv7sheet] = process.argv.slice(2)
if (!sheet || !/^char_[a-z]+_[a-z]+$/.test(key || '')) {
  console.error('사용법: node tools/build-char-art.mjs "<흰배경시트.png>" char_<계열>_<성별> ["<배경뺀시트.png>"]')
  process.exit(1)
}

const size = (f) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
  '-show_entries', 'stream=width,height', '-of', 'csv=p=0:nk=1', f]).toString().trim().split(/[\s,]+/).map(Number)
const raw = (f) => execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
  { maxBuffer: 1 << 30 })

const [W, H] = size(sheet)
const src = raw(sheet)
const dark = (x, y) => { const i = (y * W + x) * 4; return 255 - Math.min(src[i], src[i + 1], src[i + 2]) }

// 배경 뺀 시트에서 **알파만** 원본 크기로 늘려 받는다(색은 안 쓴다 — 위 ⛔ 참고)
let altA = null
if (cutout) {
  const [aw, ah] = size(cutout)
  if (Math.abs(aw / ah - W / H) > 0.01) {
    console.error(`배경 뺀 시트 비율이 다르다(${aw}x${ah} vs 원본 ${W}x${H}) — 잘라내거나 늘리지 말 것`)
    process.exit(1)
  }
  altA = execFileSync('ffmpeg', ['-v', 'error', '-i', cutout,
    '-vf', `alphaextract,scale=${W}:${H}:flags=lanczos`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    { maxBuffer: 1 << 30 })
  let clear = 0
  for (let i = 0; i < altA.length; i++) if (altA[i] === 0) clear++
  if (clear < W * H * 0.2) {
    console.error('배경 뺀 시트에 투명한 곳이 거의 없다 — 배경이 안 지워진 파일 같다')
    process.exit(1)
  }
  if (aw !== W) console.log(`배경 뺀 시트 ${aw}x${ah} → 알파만 ${W}x${H} 로 늘려 씀`)
}

// ── 칸 찾기 ─────────────────────────────────────────────────────────────────
const colOn = new Array(W).fill(0)
for (let x = 0; x < W; x++) { let c = 0; for (let y = 0; y < H; y++) if (dark(x, y) >= T) c++; colOn[x] = c }
const cols = []
let s = -1
for (let x = 0; x < W; x++) {
  const on = colOn[x] > H * 0.004
  if (on && s < 0) s = x
  if (!on && s >= 0) { if (x - s > W * 0.01) cols.push([s, x - 1]); s = -1 }
}
if (s >= 0) cols.push([s, W - 1])
if (cols.length !== 7) {
  console.error(`가로 덩어리가 ${cols.length}개다 — 7칸(Lv.1~7)이 한 줄이어야 한다`)
  process.exit(1)
}

// ── 인물과 'LEVEL N' 라벨을 가르는 빈 줄 ────────────────────────────────────
let figTop = H, figBot = 0, labelTop = H
for (const [x0, x1] of cols) {
  const row = new Array(H).fill(0)
  for (let y = 0; y < H; y++) { let c = 0; for (let x = x0; x <= x1; x++) if (dark(x, y) >= T) c++; row[y] = c }
  const top = row.findIndex((v) => v > 0)
  let bot = H - 1
  while (bot > 0 && row[bot] === 0) bot--
  const gaps = []
  let g = -1
  for (let y = top; y <= bot; y++) {
    if (row[y] === 0) { if (g < 0) g = y } else if (g >= 0) { if (y - g > 8) gaps.push([g, y - 1]); g = -1 }
  }
  const last = gaps.at(-1)
  figTop = Math.min(figTop, top)
  figBot = Math.max(figBot, last ? last[0] - 1 : bot)
  labelTop = Math.min(labelTop, last ? last[1] + 1 : H)
}
const cy0 = Math.max(0, figTop - 12), cy1 = Math.min(labelTop - 3, figBot + 10)
if (cy1 <= figBot) { console.error('인물과 라벨 사이 여백이 없다 — 시트를 다시 뽑을 것'); process.exit(1) }

// 칸 경계 = 이웃 덩어리 사이 중간
const cut = cols.map(([a, b], i) => {
  const prev = i > 0 ? cols[i - 1][1] : -1
  const next = i < 6 ? cols[i + 1][0] : W
  return [
    Math.round(i > 0 ? (prev + a) / 2 : Math.max(0, a - 20)),
    Math.round(i < 6 ? (b + next) / 2 : Math.min(W - 1, b + 20)),
  ]
})

/** 체비쇼프 거리 변환 — seed 가 켜진 곳에서 각 픽셀까지 (2패스 스캔) */
function dist(seed, w, h) {
  const N = w * h, d = new Int32Array(N).fill(1e9)
  for (let p = 0; p < N; p++) if (seed[p]) d[p] = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x
    if (x > 0) d[p] = Math.min(d[p], d[p - 1] + 1)
    if (y > 0) d[p] = Math.min(d[p], d[p - w] + 1)
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const p = y * w + x
    if (x < w - 1) d[p] = Math.min(d[p], d[p + 1] + 1)
    if (y < h - 1) d[p] = Math.min(d[p], d[p + w] + 1)
  }
  return d
}

/** 시트에서 칸 하나를 오려낸다(색만 — 알파는 아직 전부 불투명) */
function crop(x0, x1, buf = src) {
  const w = x1 - x0 + 1, h = cy1 - cy0 + 1
  const P = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) buf.copy(P, y * w * 4, ((cy0 + y) * W + x0) * 4, ((cy0 + y) * W + x0 + w) * 4)
  return { P, w, h, x0 }
}

/**
 * 단색 배경 빼기 — **가장자리가 또렷한** 그림용(Lv.7 교체 시트처럼).
 * 배경색에서 얼마나 멀어졌는지만 보고 알파를 매기고, 섞여 들어간 배경색은 역산해서 벗긴다.
 *   ⚠️ 부드럽게 번지는 빛에는 쓰면 안 된다 — 생성 AI 는 그런 빛을 **배경색과 이미 섞어서** 칠하므로
 *      되돌릴 원래 색이 없다(마젠타 배경이면 후광이 통째로 분홍으로 남는다. 2026-08-26 실측).
 *      그래서 이 경로는 빛이 또렷한 테두리 안에서 끝나는 그림에만 쓴다.
 */
function dekey(c, BG, lo = 25, hi = 90) {
  const { P, w, h } = c
  for (let p = 0; p < w * h; p++) {
    const i = p * 4
    const d = Math.hypot(P[i] - BG[0], P[i + 1] - BG[1], P[i + 2] - BG[2])
    const a = Math.min(1, Math.max(0, (d - lo) / (hi - lo)))
    if (a <= 0) { P[i] = P[i + 1] = P[i + 2] = P[i + 3] = 0; continue }
    if (a < 1) for (let k = 0; k < 3; k++) P[i + k] = Math.max(0, Math.min(255, Math.round((P[i + k] - (1 - a) * BG[k]) / a)))
    P[i + 3] = Math.round(a * 255)
  }
  return c
}

/**
 * 배경제거 프로그램이 잡아준 모양을 입힌다 — Lv.1~6 용.
 * 알파는 그쪽 것, 색은 원본 것. 반투명한 가장자리는 흰색이 섞여 있으니 역산해서 벗긴다
 * (안 벗기면 실루엣을 두른 흰 테두리가 남는다).
 */
function applyMask(c) {
  const { P, w, h, x0 } = c
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4
    const a = altA[(cy0 + y) * W + x0 + x] / 255
    if (a <= 0) { P[i] = P[i + 1] = P[i + 2] = P[i + 3] = 0; continue }
    if (a < 1) for (let k = 0; k < 3; k++) P[i + k] = Math.max(0, Math.min(255, Math.round((P[i + k] - (1 - a) * 255) / a)))
    P[i + 3] = Math.round(a * 255)
  }
  return c
}

/** 흰 배경 빼기 — Lv.7 전용(위 '왜' 참고). 자세한 단계는 파일 머리 주석에 있다. */
function dewhite(c) {
  const { P, w, h } = c, N = w * h
  const D = new Float32Array(N)
  for (let p = 0; p < N; p++) { const i = p * 4; D[p] = 255 - Math.min(P[i], P[i + 1], P[i + 2]) }
  const wall = new Uint8Array(N)
  for (let p = 0; p < N; p++) if (D[p] >= T) wall[p] = 1
  const dw = dist(wall, w, h)

  const outside = new Uint8Array(N), st = []
  for (let x = 0; x < w; x++) st.push(x, (h - 1) * w + x)
  for (let y = 0; y < h; y++) st.push(y * w, y * w + w - 1)
  while (st.length) {
    const p = st.pop()
    if (outside[p] || dw[p] <= DIL) continue
    outside[p] = 1
    const x = p % w, y = (p - x) / w
    if (x > 0) st.push(p - 1)
    if (x < w - 1) st.push(p + 1)
    if (y > 0) st.push(p - w)
    if (y < h - 1) st.push(p + w)
  }
  const din = dist(outside, w, h)

  for (let p = 0; p < N; p++) {
    const i = p * 4
    const bare = Math.min(1, Math.max(0, (D[p] - LO) / (255 - LO)))
    const a = Math.min(1, Math.max(bare, din[p] / FEATHER))
    if (a <= 0) { P[i] = P[i + 1] = P[i + 2] = P[i + 3] = 0; continue }
    if (a < 1) for (let k = 0; k < 3; k++) P[i + k] = Math.max(0, Math.min(255, Math.round((P[i + k] - (1 - a) * 255) / a)))
    P[i + 3] = Math.round(a * 255)
  }
  return c
}

/**
 * 칸 아래쪽에 남은 'LEVEL N' 글자를 지운다 — Lv.7 교체 시트용.
 * 자르는 높이(cy0~cy1)는 **원본 시트**에서 잰 값이라, 판이 조금이라도 다른 시트를 끼우면
 * 글자가 그 안으로 딸려 들어온다. 인물과 글자 사이의 빈 줄을 다시 찾아 그 아래를 비운다.
 */
function dropLabel(c) {
  const { P, w, h } = c
  const on = new Array(h).fill(false)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (P[(y * w + x) * 4 + 3] > 8) { on[y] = true; break }
  let last = -1, g = -1
  for (let y = 0; y < h; y++) {
    if (!on[y]) { if (g < 0) g = y } else if (g >= 0) { if (y - g > 8) last = g; g = -1 }
  }
  if (last < 0) return c
  P.fill(0, last * w * 4)
  return c
}

/** 알파로 인물 상자와 '서는 자리'를 잰다 */
function measure(c) {
  const { P, w, h } = c
  let bx0 = w, bx1 = -1, by0 = h, by1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (P[(y * w + x) * 4 + 3] > 8) {
    if (x < bx0) bx0 = x
    if (x > bx1) bx1 = x
    if (y < by0) by0 = y
    if (y > by1) by1 = y
  }
  // 서는 자리 = 아래 25% 의 알파 무게중심. 상자 가운데로 잡으면 창·두루마리 쪽으로 몸이 밀린다.
  const from = by1 - Math.round((by1 - by0 + 1) * 0.25)
  let sw = 0, sx = 0
  for (let y = from; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
    const a = P[(y * w + x) * 4 + 3]
    if (a > 8) { sw += a; sx += a * x }
  }
  return { ...c, bx0, bx1, by0, by1, footX: sw ? sx / sw : (bx0 + bx1) / 2 }
}

/**
 * Lv.7 만 다른 시트에서 가져올 때(네 번째 인자). 그 시트를 원본과 같은 크기로 맞춰 두면
 * 칸 자리·바닥선이 그대로 맞으므로 아래 파이프라인이 손댈 것 없이 돈다.
 *   ⚠️ 원본보다 작은 파일이면 **늘려 쓴다 — 그만큼 흐려진다.** Lv.1~6 은 원본 해상도라
 *      선택 화면에 나란히 서면 Lv.7 만 뭉개져 보인다. 되도록 같은 크기로 받을 것.
 */
let lv7 = null
if (lv7sheet) {
  const [sw, sh] = size(lv7sheet)
  lv7 = sw === W && sh === H ? raw(lv7sheet)
    : execFileSync('ffmpeg', ['-v', 'error', '-i', lv7sheet, '-vf', `scale=${W}:${H}:flags=lanczos`,
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 30 })
  if (sw !== W) console.log(`⚠️ Lv.7 시트 ${sw}x${sh} → ${W}x${H} 로 늘려 씀(그만큼 흐려진다)`)
}

// Lv.1~6 은 배경 뺀 시트의 모양을 입히고, 없으면(그리고 Lv.7 은 언제나) 여기서 배경을 뺀다.
const cells = cut.map(([x0, x1], i) => {
  if (altA && i < 6) return measure(applyMask(crop(x0, x1)))
  if (i === 6 && lv7) {
    const c = crop(x0, x1, lv7)
    const BG = [lv7[0], lv7[1], lv7[2]]
    // 흰 배경이면 번지는 빛까지 살리는 쪽, 단색 키 배경이면 또렷한 쪽(위 dekey 주석 참고)
    return measure(dropLabel(Math.min(...BG) > 235 ? dewhite(c) : dekey(c, BG)))
  }
  return measure(dewhite(crop(x0, x1)))
})

// 늘린 알파가 원본과 같은 자리에 있나 — 어긋나면 실루엣이 한쪽으로 밀린 채 잘린다
if (altA) {
  const [x0, x1] = cut[0]
  let ink0 = x1
  for (let x = x0; x <= x1 && ink0 === x1; x++) for (let y = cy0; y <= cy1; y++) if (dark(x, y) >= T) { ink0 = x; break }
  const off = cells[0].bx0 + x0 - ink0
  if (Math.abs(off) > 8) console.warn(`⚠️ 모양이 원본보다 ${off}px 어긋나 있다 — 잘라낸 파일이 아닌지 볼 것`)
}

// ── 같은 크기 캔버스에 바닥 맞춰 얹기 ───────────────────────────────────────
const base = cells.slice(0, 6).reduce((a, c) => a + (c.by1 - c.by0 + 1), 0) / 6
const tallest = Math.max(...cells.map((c) => c.by1 - c.by0 + 1))
const CH = Math.max(Math.round(base * HEADROOM), tallest + 8)
const CW = Math.round(Math.max(...cells.map((c) => 2 * Math.max(c.footX - c.bx0, c.bx1 - c.footX)))) + 16

const dir = resolve('public/hub/char', key)
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
console.log(`${key} · 캔버스 ${CW}x${CH} (비율 ${(CW / CH).toFixed(4)}) · Lv.1~6 평균 키 ${Math.round(base)}px`)
console.log(altA ? '  Lv.1~6 = 배경 뺀 시트의 모양 + 원본 색 · Lv.7 = 흰 배경 원본에서 직접'
  : '  전부 흰 배경 원본에서 직접')

cells.forEach((c, i) => {
  const fw = c.bx1 - c.bx0 + 1, fh = c.by1 - c.by0 + 1
  const ox = Math.round(CW / 2 - (c.footX - c.bx0)), oy = CH - fh
  const out = Buffer.alloc(CW * CH * 4)
  for (let y = 0; y < fh; y++) {
    const ty = oy + y
    if (ty < 0 || ty >= CH) continue
    for (let x = 0; x < fw; x++) {
      const tx = ox + x
      if (tx < 0 || tx >= CW) continue
      const from = ((c.by0 + y) * c.w + c.bx0 + x) * 4
      c.P.copy(out, (ty * CW + tx) * 4, from, from + 4)
    }
  }
  const file = resolve(dir, `lv${i + 1}.webp`)
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${CW}x${CH}`,
    '-i', '-', '-c:v', 'libwebp', '-quality', '90', '-frames:v', '1', file], { input: out })
  console.log(`  lv${i + 1}: 인물 ${fw}x${fh} · 캔버스 대비 세로 ${(fh / CH * 100).toFixed(0)}%`)
})
console.log(`\n→ hubCosmetics.ts 의 CHAR_AR: ${key}: ${CW} / ${CH},`)
