// 공유 카드 렌더러 — 허브의 "공유하기"가 만드는 1600×900(16:9) PNG.
//
// 설계 메모
//  · 레이아웃 레퍼런스 = 캐릭터 프로필 카드(좌 캐릭터 패널 / 중앙 흰 카드: 이름+능력치 / 우 랭킹 박스 / 하단 다크 바).
//  · 렌더러는 **캔버스 2D 하나뿐**이다. 미리보기도 이 캔버스를 CSS 로 축소해 보여준다
//    (DOM 미리보기 + 캔버스 출력 을 따로 만들면 둘이 반드시 어긋난다 → WYSIWYG 보장).
//  · 업로드 아바타는 교차출처(Supabase Storage) → crossOrigin='anonymous'. 실패하면 젬으로 폴백한다
//    (여기서 폴백 안 하면 캔버스가 오염돼 toBlob 자체가 터진다).


import { qrMatrix } from './qr'
// 캔버스에 그리는 글자도 화면 언어를 따른다. 훅을 못 쓰는 계층이라 lang 을 받아 비-훅 번역기(tr)를 쓴다.
import { tr, type Lang } from './i18n'
// 캔버스는 CSS 변수(`--skin-bg`)를 못 읽는다 → 배경·캐릭터 경로를 코드에서 받아온다.
import { cosmeticArt, CHAR_FALLBACK_SRC, CHAR_MIN_LEVEL } from './hubCosmetics'

export const CARD_W = 1600
export const CARD_H = 900

const FONT = `system-ui, -apple-system, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif`
// 이름은 레퍼런스처럼 세리프. 인증서(cert.css)에 이미 @font-face 로 등록된 얼굴을 재사용한다
// — CertGaramond 는 한글 글리프가 없어 한글 이름은 CertMyeongjo 로 자동 폴백된다.
const SERIF = `'CertGaramond', 'CertMyeongjo', Georgia, serif`
// QR 목적지 = 메인(랜딩). 카드를 본 사람이 스캔하면 바로 서비스로 온다 — 이 카드의 유일한 유입 경로다.
const SITE_URL = 'https://gara-cbt.airobotassn.workers.dev/'

// 사이트 브랜드 팔레트(styles/base.css 의 --blue/--blue-deep/--ink-bg). 프레임·좌패널·하단바는 항상 이 색이다.
// ⚠️ 티어색으로 카드 전체를 물들이면 브론즈가 갈색 카드가 된다 → 티어색은 액센트(엠블렘 글로우·값·핍·알약)에만.
const BRAND = '#004ac6'
const BRAND_DEEP = '#00174b'
const PAGE_BG = '#faf8ff'

// 타입 스케일 — 카드에 쓰는 글자 크기는 이 6단이 전부다.
// ⚠️ 여기 없는 숫자를 직접 쓰지 말 것. 한 번 예외를 두면 크기가 다시 흩어진다(실제로 14종까지 늘어났었다).
//    fitSize() 로 줄어드는 건 예외 — 긴 닉네임/문장이 칸을 넘지 않게 하는 하향 조정이라 스케일을 깨지 않는다.
// ⚠️ 이 카드는 1600px 로 그리지만 **소비되는 크기는 훨씬 작다** — 모달 미리보기 823px(1.9배 축소),
//    카톡에서 폰으로 보면 360px 안팎(4.4배 축소)이다. 그래서 아래 단은 "1600 기준"이 아니라
//    "360 으로 줄었을 때도 읽히는가" 로 정해야 한다. 옛 값(sub 16)은 폰에서 3.6px 라 통째로 뭉개졌다.
const T = {
  display: 76, // 이름(세리프) — 카드에 하나뿐
  hero: 48,    // 강조 숫자 — 순위 · 시즌 기록 행(라벨·값 같은 크기)
  value: 38,   // 데이터 값(하단 바 · 좌 플레이트 이름)
  title: 32,   // 섹션 제목(시즌 기록 · QR 박스)
  label: 26,   // 태그라인 · 기록 행 보조설명
  sub: 22,     // 보조(워드마크 · 하단 라벨)
} as const

export interface ShareCardData {
  /** 카드에 그릴 글자의 언어. 카드는 이미지로 밖에 나가는 물건이라 만든 사람의 화면 언어를 따른다. */
  lang: Lang
  name: string
  avatarUrl: string | null
  seed: string // 아바타 시드(uid) — avatar_url 이 없을 때 젬 색 결정
  percentile: number | null // 0~1 (작을수록 상위) — 전세계 기준
  // 랭킹 3종 = /ranking 의 세 탭과 같은 범위(전세계 · 내 국가 · 내 지역). 순위와 모수를 짝으로 받는다.
  //   국가·지역은 온보딩 전이거나 미집계면 null → 카드에 '—' 로 나간다(빈 줄을 만들지 않는다).
  rank: number | null
  rankTotal: number | null
  countryRank: number | null
  countryTotal: number | null
  regionRank: number | null
  regionTotal: number | null
  seasonTotal: number | null // 시즌 점수
  joinedAt: string | null // profiles.created_at
  country: string | null // 국가 표시명
  region: string | null // 지역 표시명(시·도)
  referralCode: string | null // 내 초대 코드(profiles.referral_code) — 하단 바 마지막 칸
  /** 남의 카드(랭킹 TOP10 클릭)면 true — 랭킹 화면에 없던 정보(국가·지역 순위, 가입일, 지역)는 아예 안 그린다.
   *  '—' 로 비워 두면 빈 줄만 남아 카드가 헐거워지고, 채우려면 그 사람의 프로필을 새로 노출해야 한다. */
  publicOnly?: boolean
  /** 장착한 캐릭터 키(`char_a_m` …). null 이면 아직 안 고른 것 → 폴백 캐릭터로 그린다. */
  character?: string | null
  /** 장착한 스킨의 상점 키(`skin_palace` …). 좌 패널 배경이 이 스킨의 배경 그림이 된다. */
  skin?: string | null
  /** 캐릭터 레벨(1~7 = ARENA 레벨). 레벨마다 그림이 달라 카드에도 지금 모습이 나가야 한다.
   *  ⚠️ 안 주면 Lv.1 로 그린다 — 남의 카드에서 이걸 빠뜨리면 상위 랭커가 갓 시작한 모습으로 나간다. */
  charLevel?: number | null
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
    // 인장(인증서)
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
  } else if (i === 3) { // 지도 핀(지역)
    ctx.beginPath()
    ctx.moveTo(0, 12)
    ctx.bezierCurveTo(-7.5, 2, -9, -1, -9, -4.5)
    ctx.arc(0, -4.5, 9, Math.PI, 0)
    ctx.bezierCurveTo(9, -1, 7.5, 2, 0, 12)
    ctx.closePath(); ctx.stroke()
    ctx.beginPath(); ctx.arc(0, -4.5, 3.4, 0, Math.PI * 2); ctx.fill()
  } else { // 두 사람(친구 코드)
    ctx.beginPath(); ctx.arc(-4, -5, 4.6, 0, Math.PI * 2); ctx.stroke()
    ctx.beginPath(); ctx.arc(6.5, -6.5, 3.6, 0, Math.PI * 2); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(-11.5, 9); ctx.bezierCurveTo(-11.5, 1.5, 3.5, 1.5, 3.5, 9); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(6.5, 1.5); ctx.bezierCurveTo(12, 1.5, 12.5, 5, 12.5, 9); ctx.stroke()
  }
  ctx.restore()
}

/** 카드 1장을 canvas 에 그린다(캔버스 크기는 이 함수가 1600×900 으로 맞춘다). */
export async function renderShareCard(canvas: HTMLCanvasElement, d: ShareCardData): Promise<void> {
  canvas.width = CARD_W
  canvas.height = CARD_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d unavailable')

  // 액센트는 브랜드 고정색이다 — 옛 티어색(tierColor)이 정하던 자리인데 티어가 2026-08-04 제거됐다.
  const C = '#5f8ed0'
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
  //   ⚠️ 스킨 배경이 위에 깔리더라도 이 칠은 지우지 말 것. 배경 그림을 못 받으면(오프라인·파일 없음)
  //      이게 그대로 남아 카드가 완성된다. 그림이 유일한 바탕이면 실패했을 때 흰 구멍이 뚫린다.
  const pg = ctx.createLinearGradient(lx, BODY_T, lx + LEFT_W, BODY_B)
  pg.addColorStop(0, mix(BRAND_DEEP, BRAND, 0.4))
  pg.addColorStop(1, dk(BRAND_DEEP, 0.25))
  ctx.fillStyle = pg; ctx.fillRect(lx, BODY_T, LEFT_W, lh)

  // 장착한 스킨의 배경 + 캐릭터. 허브 화면에서 보던 그 두 장이 그대로 카드에 들어간다(2026-08-20).
  const art = cosmeticArt(d.character ?? null, d.skin ?? null, d.charLevel ?? CHAR_MIN_LEVEL)

  // 배경 — 패널이 세로로 길어서(372×약 660) 가로로 긴 배경 그림을 그대로 늘리면 뭉개진다.
  //   ⚠️ `cover` 로 **잘라 넣는다**(비율 유지 + 넘치는 쪽을 자름). 늘려 넣으면 지평선이 휘어 보인다.
  try {
    const bg = await loadImage(art.bg)
    const s = Math.max(LEFT_W / bg.width, lh / bg.height)
    const bw = bg.width * s
    const bh = bg.height * s
    // 가로는 가운데, 세로는 **위쪽을 남긴다**(하늘이 보이고 지면이 아래에 오도록 — 캐릭터가 설 자리다).
    ctx.drawImage(bg, lx + (LEFT_W - bw) / 2, BODY_T + (lh - bh) * 0.35, bw, bh)
    // 배경을 조금 눌러 캐릭터와 이름 플레이트가 읽히게 한다. 안 누르면 밝은 배경에서 흰 이름이 증발한다.
    ctx.fillStyle = rgba(BRAND_DEEP, 0.34); ctx.fillRect(lx, BODY_T, LEFT_W, lh)
  } catch {
    // 배경 그림 실패 → 위 그라디언트 위에 예전처럼 별가루를 뿌린다(빈 판으로 두지 않는다).
    for (let i = 0; i < 46; i++) {
      const a = (i * 2654435761) % 1000 / 1000
      const b = (i * 40503) % 997 / 997
      const r = 1 + ((i * 7) % 3)
      ctx.beginPath(); ctx.arc(lx + a * LEFT_W, BODY_T + b * lh, r, 0, Math.PI * 2)
      ctx.fillStyle = rgba('#ffffff', 0.1 + ((i * 13) % 5) * 0.07); ctx.fill()
    }
  }

  // 캐릭터 뒤 광원 — 배경이 어떤 그림이든 캐릭터 실루엣이 떠 보이게 한다.
  const cgl = ctx.createRadialGradient(lx + LEFT_W / 2, BODY_T + lh * 0.5, 20, lx + LEFT_W / 2, BODY_T + lh * 0.5, 240)
  cgl.addColorStop(0, rgba(lt(mix(BRAND, C, 0.45), 0.35), 0.42)); cgl.addColorStop(1, rgba(BRAND, 0))
  ctx.fillStyle = cgl; ctx.fillRect(lx, BODY_T, LEFT_W, lh)

  // 캐릭터 — 장착한 것. 그림이 아직 없는 키면 폴백 한 장으로 떨어진다(화면의 <CharArt> 와 같은 규칙).
  try {
    let char: HTMLImageElement
    try { char = await loadImage(art.char) } catch { char = await loadImage(CHAR_FALLBACK_SRC) }
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
  text(ctx, 'CARIS WORLD ARENA', hx + 38, BODY_T + 78, { size: T.label, weight: 800, color: SUB, spacing: 0.5 })
  // 헤더 우측 = 발급기관 GARA 로고(마크 + 영문 기관명, 블랙). 파일은 이미 투명 여백을 잘라낸
  // 판(388×95)이라 여기서 크롭하지 않는다 — 통째로 그린다.
  // ⚠️ 높이는 **마크만** 44px 이던 옛 워드마크와 같은 크기로 맞춘 값이다(마크가 전체의 64/95).
  //    영문 기관명이 그 아래 13px 로 붙는데, 이 카드가 폰에서 4.4배 축소되는 걸 감안하면
  //    읽으라고 있는 글자가 아니라 로고의 일부다. 정보는 카드 본문이 이미 다 말한다.
  // ⚠️ 로고 파일을 갈면 아래 종횡비(388/95)를 알파로 다시 실측할 것(파일마다 여백이 다르다).
  try {
    const gara = await loadImage('/gara-mark-en.png')
    const LH = 65
    const LW = (388 / 95) * LH
    ctx.drawImage(gara, wx + ww - 40 - LW, BODY_T + 70 - LH / 2, LW, LH)
  } catch { /* 로고 실패해도 카드는 완성된다 */ }
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
  text(ctx, tr(d.lang, 'share.card.title'), hx + 28, boxT + 46, { size: T.title, weight: 900, color: INK })

  // 행 = [아이콘][라벨] … [값].
  // 순서 = 랭킹 3종(전세계 → 국가 → 지역) → 시즌 점수. 딱 4행이다.
  // ⚠️ 라벨은 '전세계/국가/지역' 으로 일반명만 쓴다 — 실제 국가·지역 이름은 하단 바에 한 번만 나온다.
  // ⚠️ 모수('3,410명 중')는 뺐다 — 사람이 적을 때 '7명 중' 이 그대로 나가서 순위를 깎아먹는다.
  // ⚠️ 레벨·연속 출석·인증서 행은 뺐다(각각 무료 레벨테스트 지표 / 랭킹과 무관한 활동 지표 / 알약 UI).
  //    되살리려면 git 이력에서 pips()·pill() 을 가져올 것.
  interface Row { icon: IconKind; label: string; value: string }
  // 값 표기는 한국어로 통일한다 — 카드의 다른 글자가 전부 한국어라 '#127' 만 영어권 표기로 튄다.
  const rk = (n: number | null) => (n != null ? tr(d.lang, 'share.card.rank_n', { n: n.toLocaleString() }) : '—')
  // 남의 카드(publicOnly)는 국가·지역 행을 통째로 뺀다 — 아래 rowGap 이 행 수로 나누므로 2행이 균등하게 커진다.
  const rows: Row[] = d.publicOnly
    ? [
        { icon: 'rank', label: tr(d.lang, 'share.card.world'), value: rk(d.rank) },
        { icon: 'score', label: tr(d.lang, 'share.card.season_score'), value: (d.seasonTotal ?? 0).toLocaleString() },
      ]
    : [
        { icon: 'rank', label: tr(d.lang, 'share.card.world'), value: rk(d.rank) },
        { icon: 'rank', label: tr(d.lang, 'share.card.country'), value: rk(d.countryRank) },
        { icon: 'rank', label: tr(d.lang, 'share.card.region'), value: rk(d.regionRank) },
        { icon: 'score', label: tr(d.lang, 'share.card.season_score'), value: (d.seasonTotal ?? 0).toLocaleString() },
      ]

  // 행은 박스 높이에 균등 분산한다(고정 간격이면 행 수가 바뀔 때 아래가 텅 빈다).
  // ⚠️ 레벨 행이 빠져 행이 줄면서 같은 박스가 헐거워졌다 → 행 글자·아이콘을 한 단씩 올려 칸을 채운다.
  //    타입 스케일에 없는 숫자를 새로 만들지 않고 기존 단(title/hero)을 끌어 쓴다.
  const rowTop = boxT + 74
  const rowGap = (boxB - 20 - rowTop) / rows.length
  const valX = hx + statW - 26
  const ICON_S = 1.35
  rows.forEach((r, i) => {
    const y = rowTop + rowGap * i + rowGap / 2
    icon(ctx, r.icon, hx + 46, y - 7, C, ICON_S)
    // 라벨은 값과 같은 크기(무게만 800/900 으로 갈라 값이 주인공인 건 유지).
    text(ctx, r.label, hx + 78, y, { size: T.hero, weight: 800, color: INK })
    const vSize = fitSize(ctx, r.value, T.hero, 900, 260)
    text(ctx, r.value, valX, y + 6, { size: vSize, weight: 900, color: INK, align: 'right' })
  })

  // QR 박스 — 옛 티어 엠블렘 자리. 정사각에 가까운 칸이라 QR 이 그대로 들어맞는다.
  //   이 카드가 카톡·인스타로 나가면 이미지 한 장만 남는다 → 스캔 말고는 여기로 오는 길이 없다.
  const rx = hx + statW + 22
  rr(ctx, rx, boxT, rankW, boxB - boxT, 22)
  ctx.fillStyle = '#fafaff'; ctx.fill()
  ctx.strokeStyle = '#ececf5'; ctx.lineWidth = 2; ctx.stroke()
  // ⚠️ 제목 문구를 넣지 말 것. QR 은 설명이 필요 없고, 한국어 명령형('나도 해보기' 등)을 붙이면 광고로 읽힌다.
  //    '상위 N%' 도 넣지 않는다 — 왼쪽에 '전세계 N위' 가 이미 있어 같은 사실을 두 번 말하는 데다,
  //    이 칸의 용도(들어오는 길)와 무관한 값이 섞여 제목·값 정렬이 어긋나 보였다.
  // 대신 QR 아래 **주소 한 줄**. 카드를 폰으로 받은 사람은 자기 화면이라 QR 을 못 찍는다 → 그 사람에겐
  // 주소가 유일한 길이고, QR 은 PC 화면·인쇄물에서 쓰인다. 둘이 서로를 메운다.
  const qrCx = rx + rankW / 2

  // QR — 흰 판 위에 모듈을 사각형으로 직접 찍는다(이미지 로드 없음 → 실패 지점이 없다).
  //   ⚠️ 여백(quiet zone) 4모듈은 규격이다. 없으면 스캐너가 못 읽는다.
  const CAP_H = 56 // QR 아래 주소 줄이 차지하는 높이
  const qrTop = boxT + 34
  const qrBox = Math.min(rankW - 64, boxB - 24 - CAP_H - qrTop)
  const qrY = qrTop + (boxB - 24 - CAP_H - qrTop - qrBox) / 2
  const qrX = qrCx - qrBox / 2
  rr(ctx, qrX, qrY, qrBox, qrBox, 12)
  ctx.fillStyle = '#ffffff'; ctx.fill()
  ctx.strokeStyle = '#e6e6f2'; ctx.lineWidth = 2; ctx.stroke()
  try {
    const { count, dark } = qrMatrix(SITE_URL, 'M')
    const quiet = 4
    const unit = qrBox / (count + quiet * 2)
    const ox = qrX + unit * quiet
    const oy = qrY + unit * quiet
    ctx.fillStyle = INK
    // +0.5 로 모듈을 살짝 겹쳐 찍는다 — 소수 좌표에서 모듈 사이에 흰 실선이 생기는 것을 막는다.
    for (const [r, c] of dark) ctx.fillRect(ox + c * unit, oy + r * unit, unit + 0.5, unit + 0.5)
  } catch {
    text(ctx, 'QR', qrCx, qrY + qrBox / 2, { size: T.title, weight: 900, color: SUB, align: 'center' })
  }
  // 주소 — 스킴(https://)과 끝 슬래시는 뗀다. 읽을 것이지 복붙할 것이 아니다.
  const shown = SITE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const aSize = fitSize(ctx, shown, T.label, 800, rankW - 40)
  text(ctx, shown, qrCx, qrY + qrBox + 40, { size: aSize, weight: 800, color: SUB, align: 'center' })

  // ── 하단 다크 바: 가입일 / 국가 / 지역 ──
  const fy = CARD_H - P - FOOT_H - 2
  rr(ctx, IN, fy, CARD_W - IN * 2, FOOT_H, 22)
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fill()
  // 전투력(=시즌 점수)은 능력치 박스와 같은 값이라 뺐다 — 한 카드에 같은 숫자를 두 번 쓰지 않는다.
  // 옛 '한마디'(사용자 입력) 칸은 지역으로 교체됐다 — 랭킹 3종의 국가·지역이 어디인지 여기서 읽힌다.
  // 남의 카드(publicOnly)는 가입일·국가·지역을 안 그린다 → 하단 바는 주소 칸만 남는다(워터마크처럼).
  const joined = d.joinedAt ? d.joinedAt.slice(0, 10).replace(/-/g, '.') : '—'
  const foots = d.publicOnly
    ? []
    : [
        { label: tr(d.lang, 'share.card.joined'), value: joined },
        { label: tr(d.lang, 'share.card.country'), value: d.country || '—' },
        { label: tr(d.lang, 'share.card.region'), value: d.region || '—' },
      ]
  // 값 3칸 + 오른쪽 끝 친구 코드 칸. 주소 텍스트는 위 QR 박스가 대신하므로 여기서 뺐다
  // — 같은 링크를 카드에 두 번 쓰지 않는다.
  const fw = CARD_W - IN * 2
  const URL_W = foots.length ? 400 : fw
  const cellW = foots.length ? (fw - URL_W) / foots.length : 0
  const widths = foots.map(() => cellW)
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
  // 친구 코드 칸 — 값 칸과 같은 [라벨/값] 리듬. 값은 코드라 자간을 벌리고 액센트색으로 띄운다.
  //   ⚠️ 남의 카드(publicOnly)에는 그리지 않는다 — 남의 카드에 내 코드가 박히면 안 된다.
  //   코드가 아직 없으면(발급 전) 칸을 통째로 비운다. 'CARI0000' 같은 가짜 값을 넣지 말 것.
  if (!d.publicOnly && d.referralCode) {
    ctx.beginPath(); ctx.moveTo(fx, fy + 26); ctx.lineTo(fx, fy + FOOT_H - 26)
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 2; ctx.stroke()
    footIcon(ctx, 4, fx + 52, fy + FOOT_H / 2, rgba(lt(C, 0.42), 0.9))
    text(ctx, tr(d.lang, 'share.card.friend_code'), fx + 80, fy + 44, { size: T.sub, weight: 800, color: 'rgba(255,255,255,.5)' })
    const cSize = fitSize(ctx, d.referralCode, T.value, 900, URL_W - 130)
    text(ctx, d.referralCode, fx + 80, fy + 76, { size: cSize, weight: 900, color: lt(C, 0.35), spacing: 2 })
  }
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
