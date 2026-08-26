// 공유 카드 렌더러 — 허브의 "공유하기"가 만드는 1600×900(16:9) PNG.
//
// 설계 메모
//  · 레이아웃 레퍼런스 = 캐릭터 프로필 카드(좌 캐릭터 패널 / 중앙 흰 카드: 이름+능력치 / 우 랭킹 박스 / 하단 다크 바).
//  · 렌더러는 **캔버스 2D 하나뿐**이다. 미리보기도 이 캔버스를 CSS 로 축소해 보여준다
//    (DOM 미리보기 + 캔버스 출력 을 따로 만들면 둘이 반드시 어긋난다 → WYSIWYG 보장).
//  · 업로드 아바타는 교차출처(Supabase Storage) → crossOrigin='anonymous'. 실패하면 젬으로 폴백한다
//    (여기서 폴백 안 하면 캔버스가 오염돼 toBlob 자체가 터진다).


import { qrMatrix } from './qr'
import { callFunction } from './supabase'
import { countryName } from './regions'
import { regionDisplayName } from './regionCatalog'
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

// 배경 그림을 못 받았을 때 남는 바탕색(styles/base.css 의 --blue-deep). 흰 구멍보다 낫다.
const BRAND_DEEP = '#00174b'

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
  // 국가·지역 **표시명**. 있으면 랭킹 칸 라벨이 이 이름이 된다('대한민국 6위'). 없으면 일반명.
  country: string | null
  region: string | null
  // ⚠️ 아래 둘은 카드에 안 그린다(2026-08-20 개편에서 하단 다크 바를 없애면서 빠졌다).
  //    호출부가 계속 넘기고 있어 타입만 남겨 뒀다 — 되살릴 때 다시 쓰면 된다.
  joinedAt: string | null // profiles.created_at
  referralCode: string | null // 내 초대 코드(profiles.referral_code)
  /** 남의 카드(랭킹·채팅에서 연 것)면 true. **랭킹 3종은 남의 카드에도 그린다**(2026-08-20 요청) —
   *  지금 이 플래그가 막는 건 가입일·초대코드처럼 그 화면에 없던 개인 정보뿐이다. */
  publicOnly?: boolean
  /** 장착한 캐릭터 키(`char_a_m` …). null 이면 아직 안 고른 것 → 폴백 캐릭터로 그린다. */
  character?: string | null
  /** 장착한 스킨의 상점 키(`skin_palace` …). 좌 패널 배경이 이 스킨의 배경 그림이 된다. */
  skin?: string | null
  /** 캐릭터 레벨(1~7 = ARENA 레벨). 레벨마다 그림이 달라 카드에도 지금 모습이 나가야 한다.
   *  ⚠️ 안 주면 Lv.1 로 그린다 — 남의 카드에서 이걸 빠뜨리면 상위 랭커가 갓 시작한 모습으로 나간다. */
  charLevel?: number | null
}

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
/** 카드 1장을 canvas 에 그린다(캔버스 크기는 이 함수가 1600×900 으로 맞춘다). */
export async function renderShareCard(canvas: HTMLCanvasElement, d: ShareCardData): Promise<void> {
  canvas.width = CARD_W
  canvas.height = CARD_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d unavailable')

  // 액센트는 브랜드 고정색이다 — 옛 티어색(tierColor)이 정하던 자리인데 티어가 2026-08-04 제거됐다.
  const C = '#5f8ed0'
  const INK = '#191b23'                          // base.css --paper
  const SUB = '#8b8ba3'

  try { await document.fonts.ready } catch { /* 미지원 브라우저는 그냥 진행 */ }

  // ── 배경 = 장착한 스킨 사진 한 장이 카드 전체다(2026-08-20 개편) ──
  //   옛 카드는 '왼쪽 사진 패널 + 오른쪽 흰 카드' 였는데, 허브와 전혀 다른 물건으로 보였다.
  //   지금은 허브 화면 그대로 — 사진이 전면이고 캐릭터가 그 위에 서 있고, 글자는 **판 없이** 얹힌다.
  //   ⚠️ 흰 박스·나무 액자 같은 판을 다시 만들지 말 것(2026-08-20 결정). 허브에서 판이 하는 일은
  //      스킨 그림(9패치)이 하는데 그 자르는 좌표는 CSS 안에만 있어 캔버스가 읽지 못한다.
  const art = cosmeticArt(d.character ?? null, d.skin ?? null, d.charLevel ?? CHAR_MIN_LEVEL)

  // 그림을 못 받아도 카드가 완성되게 바탕부터 칠한다(흰 구멍 방지).
  ctx.fillStyle = BRAND_DEEP
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  try {
    const bg = await loadImage(art.bg)
    // cover — 비율 유지하고 넘치는 쪽을 자른다. 늘려 넣으면 지평선이 휘어 보인다.
    const sc = Math.max(CARD_W / bg.width, CARD_H / bg.height)
    const bw = bg.width * sc
    const bh = bg.height * sc
    // 세로는 위쪽을 남긴다 — 하늘이 보이고 지면이 아래로 와야 캐릭터가 설 자리가 생긴다.
    ctx.drawImage(bg, (CARD_W - bw) / 2, (CARD_H - bh) * 0.34, bw, bh)
  } catch { /* 위 단색 바탕이 그대로 남는다 */ }

  // 스크림 — 왼쪽(글자 영역)을 눌러 흰 글자가 읽히게 한다.
  //   ⚠️ 그림자만으로는 부족하다. 밝은 배경 스킨이 들어오면 흰 글자가 통째로 증발한다(실제로 겪는 문제다).
  //   ⚠️ 그렇다고 사각 박스를 깔면 그게 곧 '판'이다 — 경계 없는 그라디언트라야 사진이 살아 있다.
  const scrim = ctx.createLinearGradient(0, 0, CARD_W * 0.82, 0)
  scrim.addColorStop(0, 'rgba(4,8,22,.88)')
  scrim.addColorStop(0.46, 'rgba(4,8,22,.55)')
  scrim.addColorStop(1, 'rgba(4,8,22,0)')
  ctx.fillStyle = scrim
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  // 위·아래 끝을 아주 살짝 더 눌러 워드마크·주소가 하늘/바닥 무늬에 묻히지 않게.
  const vign = ctx.createLinearGradient(0, 0, 0, CARD_H)
  vign.addColorStop(0, 'rgba(4,8,22,.34)')
  vign.addColorStop(0.42, 'rgba(4,8,22,0)')
  vign.addColorStop(1, 'rgba(4,8,22,.42)')
  ctx.fillStyle = vign
  ctx.fillRect(0, 0, CARD_W, CARD_H)

  // ── 캐릭터 — 오른쪽에 서 있다(글자는 왼쪽이라 겹치지 않는다) ──
  const CH_CX = 1180
  const CH_FOOT = 862 // 발끝
  try {
    let char: HTMLImageElement
    try { char = await loadImage(art.char) } catch { char = await loadImage(CHAR_FALLBACK_SRC) }
    const chH = 660
    const chW = (char.width / char.height) * chH
    // 발밑 그림자 — 없으면 캐릭터가 사진 위에 떠 보인다.
    ctx.save()
    ctx.beginPath()
    ctx.ellipse(CH_CX, CH_FOOT - 6, chW * 0.3, 26, 0, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(0,0,0,.34)'
    ctx.filter = 'blur(10px)'
    ctx.fill()
    ctx.restore()
    ctx.drawImage(char, CH_CX - chW / 2, CH_FOOT - chH, chW, chH)
  } catch { /* 캐릭터 실패해도 카드는 완성된다 */ }

  // ── 글자 — 여기서부터는 전부 사진 위에 직접 얹는다. 그림자는 허브 레일 라벨과 같은 값. ──
  const M = 76
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,.82)'
  ctx.shadowBlur = 12
  ctx.shadowOffsetY = 2

  // 워드마크(좌상단)
  text(ctx, '✦', M, 108, { size: T.title, weight: 900, color: C })
  text(ctx, 'CARIS WORLD ARENA', M + 40, 108, { size: T.label, weight: 800, color: 'rgba(255,255,255,.82)', spacing: 0.6 })

  // 이름 — 카드에서 제일 큰 글자. 세리프는 그대로 둔다(허브 HUD 와 다른 유일한 지점인데,
  // 이름은 '누구의 카드인가' 라 카드에서 한 번만 쓰는 얼굴이다).
  const nmSize = fitSize(ctx, d.name, T.display, 700, 720, SERIF)
  text(ctx, d.name, M, 218, { size: nmSize, weight: 700, color: '#fff', font: SERIF })

  // ── 기록 2×2 — 전세계 / 국가 / 지역 / 시즌 점수 ──
  //   ⚠️ 라벨은 **실제 이름**이다 — '국가 6위' 가 아니라 '대한민국 6위'(2026-08-21 요청).
  //      이름을 모르면(온보딩 전·이름표 못 받음) 일반명으로 떨어진다. 빈칸을 만들지 않기 위해서다.
  //   ⚠️ 모수('3,410명 중')는 넣지 않는다 — 사람이 적을 때 '7명 중'이 그대로 나가 순위를 깎아먹는다.
  const rk = (n: number | null) => (n != null ? tr(d.lang, 'share.card.rank_n', { n: n.toLocaleString() }) : '—')
  const cells: { icon: IconKind; label: string; value: string }[] = [
    { icon: 'rank', label: tr(d.lang, 'share.card.world'), value: rk(d.rank) },
    { icon: 'rank', label: d.country || tr(d.lang, 'share.card.country'), value: rk(d.countryRank) },
    { icon: 'rank', label: d.region || tr(d.lang, 'share.card.region'), value: rk(d.regionRank) },
    { icon: 'score', label: tr(d.lang, 'share.card.season_score'), value: (d.seasonTotal ?? 0).toLocaleString() },
  ]
  const COL_W = 350
  const ROW_H = 152
  cells.forEach((c, i) => {
    const x = M + (i % 2) * COL_W
    const y = 336 + Math.floor(i / 2) * ROW_H
    icon(ctx, c.icon, x + 13, y - 8, C, 1.05)
    // ⚠️ 라벨도 줄여야 한다 — 일반명('국가')일 땐 남았지만 실제 이름('강원특별자치도')은 옆 칸을 침범한다.
    const lSize = fitSize(ctx, c.label, T.label, 800, COL_W - 60)
    text(ctx, c.label, x + 40, y, { size: lSize, weight: 800, color: 'rgba(255,255,255,.72)' })
    const vSize = fitSize(ctx, c.value, T.hero, 900, COL_W - 40)
    text(ctx, c.value, x, y + 62, { size: vSize, weight: 900, color: '#fff' })
  })

  // GARA 로고(우상단) — 원본이 **검정 글씨**라 사진 위에서는 안 보인다 → 반전해 흰 로고로 그린다
  // (앱도 다크 테마에서 같은 방법을 쓴다 — shared.css 의 .gara-wordmark).
  // ⚠️ 로고 파일을 갈면 종횡비(388/95)를 알파로 다시 실측할 것.
  try {
    const gara = await loadImage('/gara-mark-en.png')
    const LH = 62
    const LW = (388 / 95) * LH
    ctx.save()
    ctx.filter = 'invert(1)'
    ctx.globalAlpha = 0.92
    ctx.drawImage(gara, CARD_W - M - LW, 108 - LH * 0.72, LW, LH)
    ctx.restore()
  } catch { /* 로고 실패해도 카드는 완성된다 */ }
  ctx.restore()

  // ── QR(좌하단) ──
  //   판을 안 쓰기로 했지만 **QR 만은 흰 바탕이 규격이다** — 사진 위에 검은 모듈만 찍으면 스캐너가 못 읽는다.
  //   카톡·인스타로 나가면 이미지 한 장만 남으므로 여기 말고는 서비스로 오는 길이 없다.
  const QR = 196
  const qrX = M
  const qrY = 606
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,.45)'
  ctx.shadowBlur = 18
  ctx.shadowOffsetY = 4
  rr(ctx, qrX, qrY, QR, QR, 14)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.restore()
  try {
    const { count, dark } = qrMatrix(SITE_URL, 'M')
    const quiet = 4 // 규격이다. 없으면 스캐너가 못 읽는다.
    const unit = QR / (count + quiet * 2)
    const ox = qrX + unit * quiet
    const oy = qrY + unit * quiet
    ctx.fillStyle = INK
    // +0.5 로 모듈을 살짝 겹쳐 찍는다 — 소수 좌표에서 모듈 사이에 흰 실선이 생기는 것을 막는다.
    for (const [r, c] of dark) ctx.fillRect(ox + c * unit, oy + r * unit, unit + 0.5, unit + 0.5)
  } catch {
    text(ctx, 'QR', qrX + QR / 2, qrY + QR / 2, { size: T.title, weight: 900, color: SUB, align: 'center' })
  }
  // 주소 — QR 옆. 카드를 폰으로 받은 사람은 자기 화면이라 QR 을 못 찍는다 → 그 사람에겐 이 줄이 유일한 길이다.
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,.82)'
  ctx.shadowBlur = 12
  ctx.shadowOffsetY = 2
  const shown = SITE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const aSize = fitSize(ctx, shown, T.label, 800, 430)
  text(ctx, shown, qrX + QR + 26, qrY + QR / 2 + 8, { size: aSize, weight: 800, color: 'rgba(255,255,255,.86)' })
  ctx.restore()
}


/**
 * 카드 한 장에 필요한 '남의 전세계·국가·지역' 값. 순위와 **표시명**을 짝으로 들고 다닌다.
 * ⚠️ 세 순위를 **한 응답에서 같이** 꺼낸다 — 한 칸만 다른 데서 가져오면 그 칸만 다른 기준이 된다
 *    (실제로 그랬다: 아래 scopedForCard 주석 참고).
 */
export interface CardScoped {
  worldRank: number | null
  worldTotal: number | null
  countryRank: number | null
  countryTotal: number | null
  regionRank: number | null
  regionTotal: number | null
  country: string | null
  region: string | null
}

/**
 * 남의 카드를 열 때 그 사람의 전세계·국가·지역 순위와 이름을 받아온다(랭킹·채팅이 **같은 이 함수**를 쓴다).
 * ⚠️ 두 화면이 각자 조립하면 한쪽만 이름이 뜨거나 라벨이 갈린다 — 실제로 그러기 직전이었다.
 * ⛔ **전세계 순위도 여기서 준다(2026-08-26).** 예전엔 국가·지역만 줘서 랭킹 화면이 World 칸을
 *    **목록 행의 순위**로 채웠는데, 그 숫자는 보고 있는 탭의 순위지 전세계 순위가 아니다
 *    (경기도 탭에서 누르면 'World 4위 · 대한민국 9위' 처럼 **월드가 국가보다 앞서는** 카드가 나왔다).
 *    서버는 원래 이 응답에 전세계 순위를 같이 싣고 있었다 — 안 쓰고 있었을 뿐이라 요청이 늘지 않는다.
 * ⚠️ 서버는 **코드**만 준다(`KR`·`KR-11`). 이름표는 앱이 이미 갖고 있어서(249개국 사전 + 지도 파일)
 *    6개국어 이름을 서버가 만들어 내려보낼 이유가 없다.
 * ⚠️ 지역 이름은 그 나라 지도 파일을 받아야 나온다 → 실패하면 이름 없이 순위만 쓴다(카드는 이미 떠 있다).
 */
export async function scopedForCard(uid: string, lang: Lang): Promise<CardScoped> {
  const res = await callFunction<{
    user: { rank: number | null } | null
    total: number | null
    countryRank: number | null; countryTotal: number | null
    regionRank: number | null; regionTotal: number | null
    countryCode: string | null; regionCode: string | null
  }>('leaderboard', { scope: 'user', uid })
  const cc = res.countryCode ?? null
  const rc = res.regionCode ?? null
  let region: string | null = null
  if (cc && rc) {
    try { region = await regionDisplayName(cc, rc, lang) } catch { region = null }
  }
  return {
    worldRank: res.user?.rank ?? null,
    worldTotal: res.total ?? null,
    countryRank: res.countryRank ?? null,
    countryTotal: res.countryTotal ?? null,
    regionRank: res.regionRank ?? null,
    regionTotal: res.regionTotal ?? null,
    country: cc ? countryName(cc, lang) : null,
    region,
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
