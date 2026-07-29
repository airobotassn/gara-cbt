// 공유 카드 렌더러 — 허브의 "공유하기"가 만드는 1600×900(16:9) PNG.
//
// 설계 메모
//  · 레이아웃 레퍼런스 = 캐릭터 프로필 카드(좌 캐릭터 패널 / 중앙 흰 카드: 이름+능력치 / 우 랭킹 박스 / 하단 다크 바).
//  · 렌더러는 **캔버스 2D 하나뿐**이다. 미리보기도 이 캔버스를 CSS 로 축소해 보여준다
//    (DOM 미리보기 + 캔버스 출력 을 따로 만들면 둘이 반드시 어긋난다 → WYSIWYG 보장).
//  · 티어 엠블렘은 `public/emblems/<tier>.png`(배경 제거 완료, 512px). 5티어 = Tier 와 1:1.
//    ⚠️ 화면 UI(TierBadge)는 같은 엠블렘의 256px webp 를 쓴다 — 카드만 큰 png 를 쓴다(캔버스 확대 대비).
//  · 업로드 아바타는 교차출처(Supabase Storage) → crossOrigin='anonymous'. 실패하면 젬으로 폴백한다
//    (여기서 폴백 안 하면 캔버스가 오염돼 toBlob 자체가 터진다).
import { tierColor, type Tier } from './scoring'

export const CARD_W = 1600
export const CARD_H = 900

const FONT = `system-ui, -apple-system, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif`
// 이름은 레퍼런스처럼 세리프. 자격증(cert.css)에 이미 @font-face 로 등록된 얼굴을 재사용한다
// — CertGaramond 는 한글 글리프가 없어 한글 이름은 CertMyeongjo 로 자동 폴백된다.
const SERIF = `'CertGaramond', 'CertMyeongjo', Georgia, serif`
const SHARE_URL = 'gara-cbt.airobotassn.workers.dev/arena'
export const MOTTO_MAX = 28 // 한마디 입력 상한(넘치면 카드 하단 칸이 깨진다)

// 사이트 브랜드 팔레트(styles/base.css 의 --blue/--blue-deep/--ink-bg). 프레임·좌패널·하단바는 항상 이 색이다.
// ⚠️ 티어색으로 카드 전체를 물들이면 브론즈가 갈색 카드가 된다 → 티어색은 액센트(엠블렘 글로우·값·핍·알약)에만.
const BRAND = '#004ac6'
const BRAND_DEEP = '#00174b'
const PAGE_BG = '#faf8ff'

// 타입 스케일 — 카드에 쓰는 글자 크기는 이 6단이 전부다.
// ⚠️ 여기 없는 숫자를 직접 쓰지 말 것. 한 번 예외를 두면 크기가 다시 흩어진다(실제로 14종까지 늘어났었다).
//    fitSize() 로 줄어드는 건 예외 — 긴 닉네임/문장이 칸을 넘지 않게 하는 하향 조정이라 스케일을 깨지 않는다.
const T = {
  display: 76, // 이름(세리프) — 카드에 하나뿐
  hero: 40,    // 강조 숫자 — #순위 · 시즌 기록 행(라벨·값 같은 크기)
  value: 30,   // 데이터 값(하단 바 · 좌 플레이트 이름)
  title: 24,   // 섹션 제목(시즌 기록 · 티어) · 티어명 · 자격증 알약
  label: 20,   // 태그라인 · 알약 · 기록 행 보조설명
  sub: 16,     // 보조(워드마크 · 분모 · 하단 라벨)
} as const

export interface ShareCardData {
  name: string
  avatarUrl: string | null
  seed: string // 아바타 시드(uid) — avatar_url 이 없을 때 젬 색 결정
  tier: Tier | null
  tierLabel: string // 현지화된 티어명(t('rank.tier_*'))
  percentile: number | null // 0~1 (작을수록 상위)
  rank: number | null // 전체 순위(1-base)
  rankTotal: number | null // 전체 참가자 수
  seasonTotal: number | null // 시즌 점수
  streak: number // 연속 출석(일)
  title: string | null // 자격증 칭호 'CARIS Pro 2급' — 없으면 능력치 행 자체를 숨김
  joinedAt: string | null // profiles.created_at
  country: string | null // 국가 표시명(국가만, 지역·학교는 넣지 않음)
  motto: string // 한마디(사용자 입력)
}

// ── 색 헬퍼 ──
type RGB = [number, number, number]
const h2r = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB
const r2h = (a: number[]) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
const mix = (a: string, b: string, t: number) => r2h(h2r(a).map((v, i) => v + (h2r(b)[i] - v) * t))
const lt = (c: string, t: number) => mix(c, '#ffffff', t)
const dk = (c: string, t: number) => mix(c, '#000000', t)
const rgba = (hex: string, a: number) => { const [r, g, b] = h2r(hex); return `rgba(${r},${g},${b},${a})` }

// ── 이미지 로더 ──
function loadImage(src: string, crossOrigin?: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (crossOrigin) img.crossOrigin = crossOrigin
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`image load failed: ${src}`))
    img.src = src
  })
}
// ── 캔버스 프리미티브 ──
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rad, y)
  ctx.arcTo(x + w, y, x + w, y + h, rad)
  ctx.arcTo(x + w, y + h, x, y + h, rad)
  ctx.arcTo(x, y + h, x, y, rad)
  ctx.arcTo(x, y, x + w, y, rad)
  ctx.closePath()
}
interface TextOpt { size: number; weight?: number; color?: string; align?: CanvasTextAlign; spacing?: number; font?: string }
function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, o: TextOpt) {
  ctx.font = `${o.weight ?? 800} ${o.size}px ${o.font ?? FONT}`
  ctx.fillStyle = o.color ?? '#fff'
  ctx.textAlign = o.align ?? 'left'
  ctx.textBaseline = 'alphabetic'
  if (!o.spacing) { ctx.fillText(s, x, y); return }
  // 자간(letterSpacing 은 브라우저 지원이 들쭉날쭉해 글자별로 직접 그린다)
  const chars = [...s]
  const total = chars.reduce((w, c) => w + ctx.measureText(c).width + o.spacing!, -o.spacing!)
  let cx = o.align === 'center' ? x - total / 2 : o.align === 'right' ? x - total : x
  ctx.textAlign = 'left'
  for (const c of chars) { ctx.fillText(c, cx, y); cx += ctx.measureText(c).width + o.spacing! }
}
// 폭을 넘으면 글자 크기를 줄여 한 줄에 맞춘다(닉네임·한마디처럼 길이가 제각각인 값 전용).
function fitSize(ctx: CanvasRenderingContext2D, s: string, size: number, weight: number, maxW: number, font = FONT): number {
  let sz = size
  while (sz > 14) {
    ctx.font = `${weight} ${sz}px ${font}`
    if (ctx.measureText(s).width <= maxW) break
    sz -= 2
  }
  return sz
}
// 알약 뱃지(라벨 칩). 그린 폭을 돌려줘 옆에 이어 붙일 수 있게 한다.
function pill(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, bg: string, fg: string, size: number = T.label): number {
  ctx.font = `800 ${size}px ${FONT}`
  const w = ctx.measureText(s).width + 34
  const h = size + 20
  rr(ctx, x, y - h / 2, w, h, h / 2)
  ctx.fillStyle = bg; ctx.fill()
  text(ctx, s, x + w / 2, y + size * 0.36, { size, weight: 800, color: fg, align: 'center' })
  return w
}
// 능력치 행 아이콘(이모지는 OS 마다 모양이 달라 직접 그린다). 각 함수는 (cx, cy) 중심에 24px 정도로 그린다.
// `s` 로 배율만 준다 — 좌표를 다시 손대면 아이콘마다 비례가 어긋난다(선 굵기도 같이 커져야 맞다).
type IconKind = 'streak' | 'score' | 'cert' | 'rank'
function icon(ctx: CanvasRenderingContext2D, kind: IconKind, cx: number, cy: number, color: string, s = 1) {
  ctx.save()
  ctx.translate(cx, cy)
  if (s !== 1) ctx.scale(s, s)
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineWidth = 2.6
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (kind === 'streak') {
    // 불꽃 — 위쪽을 뾰족하게(둥글면 물방울로 읽힌다)
    ctx.beginPath()
    ctx.moveTo(0, -13)
    ctx.bezierCurveTo(1.5, -6, 9, -4.5, 9.5, 2.5)
    ctx.bezierCurveTo(10, 9, 5, 13, 0, 13)
    ctx.bezierCurveTo(-5, 13, -10, 9, -9.5, 2.5)
    ctx.bezierCurveTo(-9, -3, -4, -5, -3.5, -9)
    ctx.bezierCurveTo(-2, -6.5, -1, -10, 0, -13)
    ctx.fill()
  } else if (kind === 'score') {
    // 6각 코어
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 3
      const fn = i ? 'lineTo' : 'moveTo'
      ctx[fn](11 * Math.cos(a), 11 * Math.sin(a))
    }
    ctx.closePath(); ctx.stroke()
    ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill()
  } else if (kind === 'rank') {
    // 시상대(랭킹)
    ctx.beginPath()
    ctx.rect(-12, -1, 7.5, 12); ctx.rect(-3.75, -9, 7.5, 20); ctx.rect(4.5, -4.5, 7.5, 15.5)
    ctx.fill()
  } else {
    // 인장(자격증)
    ctx.beginPath(); ctx.arc(0, -3, 8.5, 0, Math.PI * 2); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(-5, 4); ctx.lineTo(-7, 13); ctx.lineTo(0, 9.5); ctx.lineTo(7, 13); ctx.lineTo(5, 4)
    ctx.fill()
  }
  ctx.restore()
}
// 하단 바 칸의 작은 아이콘.
function footIcon(ctx: CanvasRenderingContext2D, i: number, cx: number, cy: number, color: string) {
  ctx.save(); ctx.translate(cx, cy)
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'
  if (i === 0) { // 달력
    rr(ctx, -9, -8, 18, 17, 3); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(-9, -2.5); ctx.lineTo(9, -2.5); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(-4.5, -11.5); ctx.lineTo(-4.5, -6); ctx.moveTo(4.5, -11.5); ctx.lineTo(4.5, -6); ctx.stroke()
  } else if (i === 1) { // 번개(전투력)
    ctx.beginPath(); ctx.moveTo(2, -11); ctx.lineTo(-7, 1.5); ctx.lineTo(-0.5, 1.5); ctx.lineTo(-2, 11); ctx.lineTo(7, -1.5); ctx.lineTo(0.5, -1.5); ctx.closePath(); ctx.fill()
  } else if (i === 2) { // 지구(국가)
    ctx.beginPath(); ctx.arc(0, 0, 9.5, 0, Math.PI * 2); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(-9.5, 0); ctx.lineTo(9.5, 0); ctx.stroke()
    ctx.beginPath(); ctx.ellipse(0, 0, 4.6, 9.5, 0, 0, Math.PI * 2); ctx.stroke()
  } else { // 말풍선(한마디)
    rr(ctx, -10, -9, 20, 14, 4); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(-3, 5); ctx.lineTo(-1, 11); ctx.lineTo(3, 5); ctx.fill()
  }
  ctx.restore()
}

/** 카드 1장을 canvas 에 그린다(캔버스 크기는 이 함수가 1600×900 으로 맞춘다). */
export async function renderShareCard(canvas: HTMLCanvasElement, d: ShareCardData): Promise<void> {
  canvas.width = CARD_W
  canvas.height = CARD_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d unavailable')

  const tier: Tier = d.tier ?? 'bronze'
  const C = tierColor(tier)                      // 티어색 = 액센트 전용
  const DEEP = mix(BRAND_DEEP, BRAND, 0.14)      // 프레임/좌패널/하단바 = 브랜드 딥 네이비(티어 무관)
  const INK = '#191b23'                          // base.css --paper
  const SUB = '#8b8ba3'

  try { await document.fonts.ready } catch { /* 미지원 브라우저는 그냥 진행 */ }

  // ── 바탕 + 외곽 프레임 ──
  ctx.fillStyle = PAGE_BG; ctx.fillRect(0, 0, CARD_W, CARD_H)
  const P = 26 // 프레임 여백
  rr(ctx, P, P, CARD_W - P * 2, CARD_H - P * 2, 40)
  ctx.fillStyle = DEEP; ctx.fill()

  const IN = P + 16                       // 프레임 안쪽 컨텐츠 시작
  const FOOT_H = 108                      // 하단 다크 바 높이
  const BODY_T = IN
  const BODY_B = CARD_H - P - FOOT_H - 10 // 본문 하단
  const LEFT_W = 372                      // 좌 캐릭터 패널 폭

  // ── 좌: 캐릭터 패널 ──
  const lx = IN
  const lh = BODY_B - BODY_T
  ctx.save()
  rr(ctx, lx, BODY_T, LEFT_W, lh, 28); ctx.clip()
  // 좌패널도 브랜드 코발트 계열 — 티어색은 아래 광원에만 아주 옅게 섞는다.
  const pg = ctx.createLinearGradient(lx, BODY_T, lx + LEFT_W, BODY_B)
  pg.addColorStop(0, mix(BRAND_DEEP, BRAND, 0.4))
  pg.addColorStop(1, dk(BRAND_DEEP, 0.25))
  ctx.fillStyle = pg; ctx.fillRect(lx, BODY_T, LEFT_W, lh)
  // 반짝이(레퍼의 별가루)
  for (let i = 0; i < 46; i++) {
    const a = (i * 2654435761) % 1000 / 1000
    const b = (i * 40503) % 997 / 997
    const r = 1 + ((i * 7) % 3)
    ctx.beginPath(); ctx.arc(lx + a * LEFT_W, BODY_T + b * lh, r, 0, Math.PI * 2)
    ctx.fillStyle = rgba('#ffffff', 0.1 + ((i * 13) % 5) * 0.07); ctx.fill()
  }
  // 캐릭터 뒤 광원
  const cgl = ctx.createRadialGradient(lx + LEFT_W / 2, BODY_T + lh * 0.5, 20, lx + LEFT_W / 2, BODY_T + lh * 0.5, 240)
  cgl.addColorStop(0, rgba(lt(mix(BRAND, C, 0.45), 0.35), 0.42)); cgl.addColorStop(1, rgba(BRAND, 0))
  ctx.fillStyle = cgl; ctx.fillRect(lx, BODY_T, LEFT_W, lh)
  try {
    const char = await loadImage('/hub-char.png')
    const H = lh * 0.78
    const w = (char.width / char.height) * H
    ctx.drawImage(char, lx + LEFT_W / 2 - w / 2, BODY_T + lh * 0.9 - H, w, H)
  } catch { /* 캐릭터 이미지 실패해도 카드는 완성된다 */ }
  // 이름 플레이트(패널 하단 오버레이)
  const plH = 92
  const plY = BODY_B - plH - 18
  rr(ctx, lx + 18, plY, LEFT_W - 36, plH, 18)
  ctx.fillStyle = 'rgba(12,10,26,.62)'; ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 2; ctx.stroke()
  // 플레이트 = 이름 + 워드마크만.
  // ⚠️ 시드 젬 아바타를 여기 넣었더니 바로 위 캐릭터와 겹쳐 읽히고(같은 사람의 그림 2개), 젬 자체도
  //    카드의 다른 요소와 톤이 안 맞았다. 아바타는 허브 HUD 에 이미 있으므로 카드에서는 뺀다.
  const avCy = plY + plH / 2
  const plSize = fitSize(ctx, d.name, T.value, 900, LEFT_W - 96)
  text(ctx, d.name, lx + LEFT_W / 2, avCy - 2, { size: plSize, weight: 900, color: '#fff', align: 'center' })
  text(ctx, 'CARIS WORLD ARENA', lx + LEFT_W / 2, avCy + 26, { size: T.sub, weight: 800, color: 'rgba(255,255,255,.5)', align: 'center', spacing: 1.6 })
  ctx.restore()

  // ── 중앙 + 우측: 흰 카드 ──
  const wx = lx + LEFT_W + 18
  const ww = CARD_W - P - 16 - wx
  rr(ctx, wx, BODY_T, ww, lh, 28)
  ctx.fillStyle = '#fff'; ctx.fill()

  // 헤더: 태그라인 → 이름(세리프).
  // Lv·티어 알약 줄은 뺐다 — 티어는 오른쪽 박스에 있어 여기 두면 같은 값이 두 번 뜬다(레벨은 카드에서 제외).
  // 대신 그 높이를 헤더가 흡수해 태그라인·이름을 크고 여유 있게 놓는다.
  const hx = wx + 40
  text(ctx, '✦', hx, BODY_T + 78, { size: T.title, weight: 900, color: C })
  text(ctx, 'CARIS WORLD ARENA · 시즌 리포트', hx + 38, BODY_T + 78, { size: T.label, weight: 800, color: SUB, spacing: 0.5 })
  const nmSize = fitSize(ctx, d.name, T.display, 700, ww - 80, SERIF)
  text(ctx, d.name, hx, BODY_T + 172, { size: nmSize, weight: 700, color: INK, font: SERIF })

  // ── 시즌 기록 박스(좌) / 티어 박스(우) ──
  const boxT = BODY_T + 222
  const boxB = BODY_B - 30
  const rankW = 340
  const statW = ww - 80 - rankW - 22
  rr(ctx, hx, boxT, statW, boxB - boxT, 22)
  ctx.fillStyle = '#fafaff'; ctx.fill()
  ctx.strokeStyle = '#ececf5'; ctx.lineWidth = 2; ctx.stroke()
  text(ctx, '시즌 기록', hx + 28, boxT + 46, { size: T.title, weight: 900, color: INK })

  // 행 = [아이콘][라벨] … [값].
  //   kind='num'   숫자류 → 숫자만(억지 게이지 금지)
  //   kind='pill'  자격증 — 보유자만 노출(미보유는 행 자체를 만들지 않는다)
  type Row =
    | { kind: 'num'; icon: IconKind; label: string; value: string; sub?: string }
    | { kind: 'pill'; icon: IconKind; label: string; value: string }
  // 순서 = 랭킹(백분위) → 시즌 점수 → 연속 출석.
  // ⚠️ 레벨 행은 뺐다(무료 레벨테스트 지표라 이 카드의 성격과 어긋난다). 칸(pips) 표시를 쓰던
  //    유일한 행이라 그 헬퍼도 같이 지웠다 — 되살리려면 git 이력에서 pips() 를 가져올 것.
  const rows: Row[] = [
    { kind: 'num', icon: 'rank', label: '랭킹', value: d.percentile != null ? `상위 ${Math.max(1, Math.round(d.percentile * 100))}%` : '—' },
    { kind: 'num', icon: 'score', label: '시즌 점수', value: (d.seasonTotal ?? 0).toLocaleString() },
    { kind: 'num', icon: 'streak', label: '연속 출석', value: `${d.streak}일` },
  ]
  if (d.title) rows.push({ kind: 'pill', icon: 'cert', label: '자격증', value: d.title })

  // 행은 박스 높이에 균등 분산한다(고정 간격이면 행 수가 바뀔 때 아래가 텅 빈다).
  // ⚠️ 레벨 행이 빠져 행이 줄면서 같은 박스가 헐거워졌다 → 행 글자·아이콘을 한 단씩 올려 칸을 채운다.
  //    타입 스케일에 없는 숫자를 새로 만들지 않고 기존 단(title/hero)을 끌어 쓴다.
  const rowTop = boxT + 74
  const rowGap = (boxB - 20 - rowTop) / rows.length
  const valX = hx + statW - 26
  // 알약(자격증)은 40px 라벨을 피해 시작한다 — 라벨과 겹치면 글자가 알약 밑으로 들어간다.
  const trackX = hx + 250
  const ICON_S = 1.35
  rows.forEach((r, i) => {
    const y = rowTop + rowGap * i + rowGap / 2
    icon(ctx, r.icon, hx + 46, y - 7, C, ICON_S)
    // 라벨은 값과 같은 크기(무게만 800/900 으로 갈라 값이 주인공인 건 유지).
    text(ctx, r.label, hx + 78, y, { size: T.hero, weight: 800, color: INK })
    if (r.kind === 'pill') {
      pill(ctx, r.value, trackX, y - 6, 'rgba(242,198,94,.22)', '#8a6a12', T.title)
    } else {
      // 보조 설명은 라벨 옆에 붙인다(값 위에 얹으면 그 행만 2줄이 돼 행 리듬이 깨진다).
      if (r.sub) {
        ctx.font = `800 ${T.hero}px ${FONT}`
        text(ctx, r.sub, hx + 78 + ctx.measureText(r.label).width + 10, y, { size: T.label, weight: 700, color: SUB })
      }
      const vSize = fitSize(ctx, r.value, T.hero, 900, 260)
      text(ctx, r.value, valX, y + 6, { size: vSize, weight: 900, color: INK, align: 'right' })
    }
  })

  // 랭킹 박스: 엠블렘 → 티어명 → 알약 + #순위
  const rx = hx + statW + 22
  rr(ctx, rx, boxT, rankW, boxB - boxT, 22)
  ctx.fillStyle = '#fafaff'; ctx.fill()
  ctx.strokeStyle = '#ececf5'; ctx.lineWidth = 2; ctx.stroke()
  text(ctx, '티어', rx + 28, boxT + 46, { size: T.title, weight: 900, color: INK })

  // 엠블렘은 이 박스의 주인공 — 박스 높이를 채우도록 크게(작으면 아래에 빈 공간이 남는다).
  // 순위 줄이 없는 유저(미집계)는 그만큼 아래로 내려 세로 중앙을 맞춘다.
  const rankNo = d.rank // 좁힌 값을 그대로 쓴다(별도 boolean 을 두면 아래에서 다시 null 가능으로 판정된다)
  const emCx = rx + rankW / 2
  const emCy = boxT + (rankNo != null ? 186 : 232)
  const EM = 224
  try {
    const em = await loadImage(`/emblems/${tier}.png`)
    ctx.save()
    ctx.shadowColor = rgba(C, 0.45); ctx.shadowBlur = 26; ctx.shadowOffsetY = 4
    ctx.drawImage(em, emCx - EM / 2, emCy - EM / 2, EM, EM)
    ctx.restore()
  } catch { /* 엠블렘 실패해도 카드는 완성된다 */ }
  // 티어명은 남긴다 — 엠블렘 5종이 형태가 같고 색만 달라, 처음 보는 사람은 단독으로 티어를 못 읽는다.
  // 대신 크기를 줄여 엠블렘이 주인공인 건 유지. (빼려면 이 한 줄만 지우면 된다.)
  text(ctx, d.tierLabel, emCx, emCy + EM / 2 + 40, { size: T.title, weight: 900, color: INK, align: 'center' })

  // 순위는 있을 때만 그린다 — 미집계 유저에게 '집계 대기' 같은 빈 상태를 보여주지 않는다(티어명까지만).
  if (rankNo != null) {
    const rankY = boxB - 44
    const rankVal = `#${rankNo.toLocaleString()}`
    ctx.font = `900 ${T.hero}px ${FONT}`
    const rvW = ctx.measureText(rankVal).width
    ctx.font = `800 ${T.label}px ${FONT}`
    const lblW = ctx.measureText('전체 랭킹').width + 30
    const grpX = emCx - (lblW + 14 + rvW) / 2
    pill(ctx, '전체 랭킹', grpX, rankY - 12, rgba(C, 0.14), dk(C, 0.28))
    text(ctx, rankVal, grpX + lblW + 14, rankY, { size: T.hero, weight: 900, color: C })
    // 상위%는 기록 박스 첫 행으로 옮겼다 — 여기선 분모만(같은 값을 카드에 두 번 쓰지 않는다).
    // 분모(rankTotal)는 my_rank_context 의 total — 마이그레이션 미적용 DB 에선 없어 줄째로 생략된다.
    if (d.rankTotal != null) {
      text(ctx, `${d.rankTotal.toLocaleString()}명 중`, emCx, rankY + 26, { size: T.sub, weight: 700, color: SUB, align: 'center' })
    }
  }

  // ── 하단 다크 바: 가입일 / 전투력 / 국가 / 한마디 ──
  const fy = CARD_H - P - FOOT_H - 2
  rr(ctx, IN, fy, CARD_W - IN * 2, FOOT_H, 22)
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fill()
  // 전투력(=시즌 점수)은 능력치 박스와 같은 값이라 뺐다 — 한 카드에 같은 숫자를 두 번 쓰지 않는다.
  const joined = d.joinedAt ? d.joinedAt.slice(0, 10).replace(/-/g, '.') : '—'
  const foots = [
    { label: '가입일', value: joined },
    { label: '국가', value: d.country || '—' },
    { label: '한마디', value: d.motto?.trim() || '오늘도 한 걸음.' },
  ]
  // 앞 2칸은 값이 짧아 고정폭, 한마디는 남는 폭을 다 쓴다(문장이라 제일 길다).
  const fw = CARD_W - IN * 2
  const fixed = 340
  const widths = [fixed, fixed, fw - fixed * 2]
  let fx = IN
  foots.forEach((f, i) => {
    if (i > 0) {
      ctx.beginPath(); ctx.moveTo(fx, fy + 26); ctx.lineTo(fx, fy + FOOT_H - 26)
      ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 2; ctx.stroke()
    }
    footIcon(ctx, i === 0 ? 0 : i === 1 ? 2 : 3, fx + 52, fy + FOOT_H / 2, rgba(lt(C, 0.42), 0.9))
    text(ctx, f.label, fx + 80, fy + 44, { size: T.sub, weight: 800, color: 'rgba(255,255,255,.5)' })
    const vs = fitSize(ctx, f.value, T.value, 900, widths[i] - 110)
    text(ctx, f.value, fx + 80, fy + 76, { size: vs, weight: 900, color: '#fff' })
    fx += widths[i]
  })

  // 우하단 주소(프레임 안쪽 여백에)
  text(ctx, SHARE_URL, CARD_W - P - 20, CARD_H - P + 2, { size: T.sub, weight: 700, color: rgba(lt(C, 0.6), 0.0), align: 'right' })
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
  })
}

export function cardFileName(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 24) || 'caris'
  return `caris-card-${safe}.png`
}

/** 저장(다운로드). 모바일 브라우저에서도 a[download] 로 동작한다. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 네이티브 공유 시트(카톡·인스타 등). 지원 안 하면 false 를 돌려주고 호출부가 저장으로 폴백한다. */
export async function shareBlob(blob: Blob, filename: string, title: string): Promise<boolean> {
  const file = new File([blob], filename, { type: 'image/png' })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (!nav.share || !nav.canShare?.({ files: [file] })) return false
  try {
    await nav.share({ files: [file], title, text: title })
    return true
  } catch (e) {
    // 사용자가 공유 시트를 닫은 것(AbortError)은 실패가 아니다 — 폴백하지 않는다.
    if (e instanceof DOMException && e.name === 'AbortError') return true
    return false
  }
}

/** 클립보드 복사(PC 에서 채팅창에 바로 붙여넣기). 미지원이면 false. */
export async function copyBlob(blob: Blob): Promise<boolean> {
  try {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') return false
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch {
    return false
  }
}
