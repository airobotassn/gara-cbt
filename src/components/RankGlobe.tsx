// 랜딩 히어로 — 밤지구 순위 지구본.
//
// 옛 히어로(NASA 밤지구 영상 21.6MB)를 대체한다. 지구를 **사진으로 깔지 않고**
// 그 자리에서 그린다: 바다는 거의 검게, 모든 나라는 균일한 어두운 판, **상위 10개국만 빛난다.**
// 전송량 21.6MB → 약 40KB(`geo/world.json` brotli 32KB + 이 렌더러). 게다가 그 경계 파일은
// `/arena` 가 이미 받는 것이라 실질 추가분은 더 작고, 메인에서 먼저 받아두면 /arena 가 캐시를 쓴다.
//
// 왜 위성사진이 아닌가 —
//   위성사진을 깔면 사하라 갈색·아마존 초록·구름 흰색이 순위색과 같은 세기로 튄다.
//   지구가 사실적일수록 순위가 안 읽히는 구조라, 순위 지도로는 아무리 다듬어도 실패한다.
//   (그 시도의 잔재였던 `public/earth/*.webp` 3장과 옛 영상 히어로 `EarthHero`+`earth.mp4` 는
//    2026-08-14 에 삭제했다 — 아무 데서도 안 쓰이면서 배포에 23MB 를 얹고 있었다. 되살릴 일이
//    생기면 그 커밋을 되짚을 것이고, 되살리기 전에 위 두 문단을 다시 읽을 것.)
//
// ⚠️ 아래 수치는 전부 시안(`docs/globe-mock.html`)에서 값을 직접 만져 고른 결과다.
//    바꾸고 싶으면 시안을 열어 슬라이더로 맞춘 뒤 그 값을 여기 옮기는 게 빠르다.
import { useEffect, useMemo, useRef } from 'react'
import { geoArea, geoDistance, geoOrthographic, geoPath } from 'd3-geo'
import { buildRegions, EMPTY_REAL, loadCountries, type GeoFeature, type RealData } from '../lib/arena/data'
import { M49_TO_ISO2 } from '../lib/arena/tables'
// 라벨 기준점 — `/arena` 지도(ArenaMap)와 **같은 헬퍼**를 쓴다. 구면 중심은 섬이 딸린 나라에서 바다로 나간다.
import { labelAnchor } from '../lib/arena/labelPoint'
import { callFunction } from '../lib/supabase'
import { paintStars } from '../lib/starfield'
import '../styles/rankglobe.css'

/** 시안에서 고른 값(2026-08-06). 이름은 시안 컨트롤의 항목명과 그대로 맞춰 뒀다. */
const CFG = {
  sea: 11, // 바다 밝기
  land: 62, // 대륙 밝기
  border: 100, // 국경선
  atmo: 49, // 대기광(테두리)
  shade: 100, // 명암(입체감)
  lit: 10, // 빛나는 나라 수
  glow: 75, // 발광 세기
  bleed: 29, // 번짐
  hue: 211, // 불빛 색조
  markSize: 54, // 1st·2nd·3rd 표시 크기
  stars: 50, // 별 밝기
  spin: 90, // 자전 속도
  size: 150, // 지구 크기
  posx: 50, // 가로 위치
  posy: 53, // 세로 위치
} as const

/**
 * 1·2·3위 표시 크기 상한(지구 반지름 대비, markSize 가 곱해진다).
 * 땅이 넉넉하면 이 크기까지 쓰고, 좁은 나라(한국·영국)에서는 땅에 맞춰 줄인다 — 아래 `roomOf` 참고.
 * ⚠️ 다만 **바닥(`ORD_FLOOR_R`)은 지킨다.** 이 표시는 궤도와 RANK 라벨까지 품은 에셋이라
 *    끝까지 땅에 맞추면 숫자가 점처럼 뭉개진다(그래서 한때 땅 크기 측정을 통째로 걷어냈었다).
 */
const ORD_SZ: Record<number, number> = { 1: 0.18, 2: 0.155, 3: 0.14 }
/** 1~3위 에셋이 이보다 작아지지는 않는다(지구 반지름 대비). */
const ORD_FLOOR_R = 0.055

/**
 * 순위 숫자 크기 규칙 — **`/arena` 지도(ArenaMap 의 sizeLabels)와 같은 식**이다.
 * 두 화면이 같은 순위를 말하므로 글자가 커지고 작아지는 감각도 같아야 한다.
 *   RATIO  = 땅 짧은 변의 몇 %까지 쓸지
 *   CAP_R  = 큰 땅에서 글자만 비대해지는 걸 막는 상한(지구 반지름 대비)
 *   FLOOR  = 좁은 나라도 여기까지는 유지(폭 상한에 걸리면 더 줄어든다)
 *   HIDE   = 그래도 이보다 작으면 못 읽으므로 안 그린다
 */
const LBL_RATIO = 0.3
const LBL_CAP_R = 0.04
const LBL_FLOOR = 9
const LBL_HIDE = 6
const RANK_ASSET = [
  '/landing/rank-medal-1.png',
  '/landing/rank-medal-2.png',
  '/landing/rank-medal-3.png',
] as const

/** 첫 화면에 보이는 경도(정면 경도 = -이 값). -180 = **날짜변경선(180°)이 정면**.
 *  옛 값 -80(동경 80°)은 유럽·인도·중국·한국을 한 화면에 넣으려던 값이고,
 *  지금은 태평양에서 시작해 자전으로 아시아가 들어오는 그림을 택했다(2026-08-11 요청).
 *  ⚠️ 태평양이 정면이면 처음엔 한국·일본·호주만 테두리 쪽에 걸리고 **유럽·인도는 지구 뒤편**이다.
 *  자전으로 들어오는 데 걸리는 시간이 곧 첫인상이라 이 값은 자전 속도(CFG.spin)와 한 쌍이다. */
const ROT_LON0 = -180
/** 기울기 초기값(음수 = 북반구가 위로). 상위권이 북반구에 몰려 있어 크게 주면 불빛이 문구 뒤로 숨는다.
 *  드래그로 바뀔 수 있는 값이라 상수는 '시작 각도'일 뿐이다. */
const ROT_LAT0 = -7
/** 위도 회전 한계. 극을 넘겨 뒤집히면 방향 감각이 사라진다. */
const LAT_LIMIT = 78
/** 손을 뗀 뒤 자동 회전을 다시 켜기까지(ms). 놓자마자 흘러가면 만지던 자리를 뺏긴 느낌이 든다. */
const RESUME_MS = 2200

type Land = {
  /** GeoJSON geometry — d3 가 그대로 그리고 구면 클리핑한다 */
  g: GeoFeature['geometry']
  /** 대표점 [lon, lat] — 불빛·순위 표시를 세울 자리 */
  c: [number, number]
  /** 면적(steradian) — 면 발광을 면적으로 보정할 때 쓴다(나라 전체) */
  area: number
  /** 라벨이 얹힌 덩어리(본체) — 글자 크기를 이 땅에 맞춘다 */
  part: GeoFeature
  /** 그 덩어리의 면적 */
  partArea: number
  iso: string
  name: string
  rank: number
}

function hsl(h: number, s: number, l: number, a: number) {
  return `hsla(${h},${s}%,${l}%,${a})`
}

/** 순위 → 불빛 색. 1·2·3위만 금·은·동으로 갈라 시상대를 읽게 하고 나머지는 브랜드 색 한 계열. */
function litColor(rank: number) {
  const t = 1 - (rank - 1) / CFG.lit
  const s = Math.max(0, t) ** 1.5
  if (rank <= 3) {
    const M: [number, number, number][] = [
      [44, 92, 66],
      [205, 18, 84],
      [24, 72, 58],
    ]
    const [h, sa, li] = M[rank - 1]
    return { h, s: sa, l: li, k: 0.72 + 0.28 * s }
  }
  return { h: CFG.hue, s: 92 - 42 * s, l: 46 + 44 * s, k: 0.28 + 0.72 * s }
}

export default function RankGlobe() {
  const cvRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const landsRef = useRef<Land[]>([])
  const areaRefRef = useRef(1)

  // 별은 매 프레임 다시 찍을 이유가 없다 — 오프스크린에 한 번 그려 통째로 얹는다.
  const starCv = useMemo(() => document.createElement('canvas'), [])
  const glowCv = useMemo(() => document.createElement('canvas'), [])

  useEffect(() => {
    const cv = cvRef.current
    const wrap = wrapRef.current
    if (!cv || !wrap) return
    const ctx = cv.getContext('2d')
    const glowCtx = glowCv.getContext('2d')
    if (!ctx || !glowCtx) return

    const rankImgs = RANK_ASSET.map((src) => {
      const img = new Image()
      img.decoding = 'async'
      img.src = src
      return img
    })

    let dead = false
    let raf = 0
    let W = 0
    let H = 0
    let DPR = 1
    let visible = true
    const t0 = performance.now()

    // 투영 — clipAngle(90) 이 핵심이다. 지구 뒤로 넘어간 부분을 **실제로 잘라내고** 잘린 자리를
    // 지구 테두리 호로 이어 닫는다. 이걸 근사로 때우면(뒷면 점을 테두리로 밀기) 러시아·남극처럼
    // 경도로 긴 땅이 넘어갈 때 폴리곤이 넓적하게 늘어나 바다를 덮었다 벗겨졌다 한다(실제로 겪었다).
    const projection = geoOrthographic().clipAngle(90).precision(0.4)
    const pathMain = geoPath(projection, ctx)
    const pathGlow = geoPath(projection, glowCtx)

    // 회전 상태. 자동 회전은 **경과 시간**으로 내되(탭을 갔다 와도 튀지 않는다) 기준점을 두어
    // 드래그로 옮긴 각도에서 이어지게 한다 — 기준을 안 두면 손을 떼는 순간 원래 궤도로 순간이동한다.
    let rotLon = ROT_LON0
    let rotLat = ROT_LAT0
    let spinBase = ROT_LON0
    let spinFrom = t0
    /** 드래그 중이면 포인터 좌표, 아니면 null */
    let drag: { x: number; y: number } | null = null
    /** 이 시각 전에는 자동 회전을 멈춘다(손 뗀 직후 유예) */
    let holdUntil = 0

    const resize = () => {
      DPR = Math.min(window.devicePixelRatio || 1, 2)
      W = wrap.clientWidth
      H = wrap.clientHeight
      cv.width = Math.max(1, Math.round(W * DPR))
      cv.height = Math.max(1, Math.round(H * DPR))
      glowCv.width = Math.max(1, Math.round(W * DPR * 0.5))
      glowCv.height = Math.max(1, Math.round(H * DPR * 0.5))
      buildStars()
    }

    // 별은 `lib/starfield.ts` 가 그린다 — /arena 배경(StarField)과 **같은 하늘**이어야 한다.
    const buildStars = () => paintStars(starCv, W, H, DPR)

    /** 지구 중심·반지름 — 구도의 단일 출처(CSS 에는 기하가 없다).
     *  ⚠️ 좁은 화면에서 폭 계수를 그대로 쓰면 지구가 손톱만 해진다(390px 에서 반지름 101px 였다). */
    const geom = () => {
      const narrow = W < 640
      const k = CFG.size / 100
      const R = Math.min(W * (narrow ? 0.42 : 0.3), H * (narrow ? 0.26 : 0.42)) * k
      return { cx: W * (narrow ? 0.5 : CFG.posx / 100), cy: H * (CFG.posy / 100), R }
    }

    /** [lon,lat] 이 지금 앞면인가. 1 = 정면, 0 = 테두리, 음수 = 뒷면. */
    const facing = (ll: [number, number]) => Math.cos(geoDistance(ll, [-rotLon, -rotLat]))

    const draw = (now: number) => {
      if (dead) return
      raf = requestAnimationFrame(draw)
      if (!visible || !W || !H) return

      // 자동 회전 — 드래그 중이거나 손 뗀 직후 유예 동안은 멈춘다.
      if (!drag && now >= holdUntil) {
        rotLon = spinBase + ((now - spinFrom) / 1000) * (CFG.spin / 100) * 6
      }
      const g = geom()
      projection.rotate([rotLon, rotLat]).translate([g.cx, g.cy]).scale(g.R)
      const lands = landsRef.current
      const AREA_REF = areaRefRef.current

      ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
      ctx.clearRect(0, 0, W, H)

      // ── 우주 + 별
      const bg = ctx.createRadialGradient(g.cx, g.cy, 0, g.cx, g.cy, Math.max(W, H) * 0.9)
      bg.addColorStop(0, '#070c1a')
      bg.addColorStop(1, '#03050b')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, W, H)
      ctx.save()
      ctx.globalAlpha = CFG.stars / 100
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.drawImage(starCv, 0, 0)
      ctx.restore()
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0)

      // ── 바깥 대기 헤일로
      const ha = (CFG.atmo / 100) * 0.5
      const hg = ctx.createRadialGradient(g.cx, g.cy, g.R * 0.985, g.cx, g.cy, g.R * 1.16)
      hg.addColorStop(0, hsl(208, 90, 62, ha))
      hg.addColorStop(0.35, hsl(210, 92, 56, ha * 0.34))
      hg.addColorStop(1, hsl(212, 90, 50, 0))
      ctx.fillStyle = hg
      ctx.beginPath()
      ctx.arc(g.cx, g.cy, g.R * 1.16, 0, 6.283)
      ctx.fill()

      ctx.save()
      ctx.beginPath()
      ctx.arc(g.cx, g.cy, g.R, 0, 6.283)
      ctx.clip()

      // ── 바다. 광원은 왼쪽 위 — 명암이 있어야 원판이 아니라 공으로 보인다.
      const sl = CFG.sea / 100
      const sh = CFG.shade / 100
      const sg = ctx.createRadialGradient(g.cx - g.R * 0.36, g.cy - g.R * 0.34, g.R * 0.05, g.cx, g.cy, g.R * 1.06)
      sg.addColorStop(0, hsl(218, 62, 4 + sl * 17, 1))
      sg.addColorStop(0.55, hsl(220, 66, (4 + sl * 17) * (1 - sh * 0.42), 1))
      sg.addColorStop(1, hsl(224, 70, (3 + sl * 12) * (1 - sh * 0.78), 1))
      ctx.fillStyle = sg
      ctx.beginPath()
      ctx.arc(g.cx, g.cy, g.R, 0, 6.283)
      ctx.fill()

      // ── 대륙 — 순위와 무관하게 전부 같은 어두운 판. 여기서 색을 나누지 않는 게 핵심이다.
      ctx.beginPath()
      for (const c of lands) pathMain(c.g as never)
      ctx.fillStyle = hsl(214, 34, 7 + (CFG.land / 100) * 15, 1)
      ctx.fill()
      ctx.strokeStyle = `rgba(150,195,255,${(0.045 + (CFG.border / 100) * 0.3).toFixed(3)})`
      ctx.lineWidth = 0.6
      ctx.stroke()

      // ── 순위 불빛 — 상위 10개국의 **국토 면이** 빛난다.
      //    ①저해상도 오프스크린에 그려 blur 로 번지게 하고 ②그 위에 선명한 면을 얹어 형태를 살린다.
      const gk = CFG.glow / 100
      const lit = lands.filter((c) => c.rank > 0 && c.rank <= CFG.lit)
      if (lit.length) {
        glowCtx.setTransform(DPR * 0.5, 0, 0, DPR * 0.5, 0, 0)
        glowCtx.clearRect(0, 0, W, H)
        for (const c of lit) {
          if (facing(c.c) < -0.35) continue
          const col = litColor(c.rank)
          // 면적 보정 — 국토가 크면 옅게. 안 하면 밝기가 순위가 아니라 영토 크기를 말한다
          // (보정을 끄면 6위 중국이 1위 한국보다 압도적으로 밝다).
          const an = Math.min(1, (AREA_REF / c.area) ** 0.42)
          glowCtx.beginPath()
          pathGlow(c.g as never)
          glowCtx.fillStyle = hsl(col.h, col.s, col.l, col.k * gk * an)
          glowCtx.fill()
        }
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.filter = `blur(${(2 + (CFG.bleed / 100) * 22).toFixed(1)}px)`
        ctx.globalAlpha = 0.55 + gk * 0.45
        ctx.drawImage(glowCv, 0, 0, W * DPR, H * DPR)
        ctx.filter = `blur(${(1 + (CFG.bleed / 100) * 5).toFixed(1)}px)`
        ctx.globalAlpha = 0.5 + gk * 0.5
        ctx.drawImage(glowCv, 0, 0, W * DPR, H * DPR)
        ctx.restore()
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0)

        for (const c of lit) {
          if (facing(c.c) < -0.35) continue
          const col = litColor(c.rank)
          const an = Math.min(1, (AREA_REF / c.area) ** 0.42)
          ctx.beginPath()
          pathMain(c.g as never)
          ctx.fillStyle = hsl(col.h, col.s, Math.min(96, col.l + 14), col.k * gk * 0.85 * an)
          ctx.fill()
        }
      }
      ctx.restore() // 원 clip 해제

      // ── 안쪽 대기 산란(림). 공으로 보이게 하는 건 색이 아니라 이 테두리다.
      ctx.save()
      ctx.beginPath()
      ctx.arc(g.cx, g.cy, g.R, 0, 6.283)
      ctx.clip()
      ctx.globalCompositeOperation = 'lighter'
      const ia = (CFG.atmo / 100) * 0.3
      const ig = ctx.createRadialGradient(g.cx, g.cy, g.R * 0.55, g.cx, g.cy, g.R)
      ig.addColorStop(0, hsl(208, 90, 56, 0))
      ig.addColorStop(0.82, hsl(208, 92, 58, ia * 0.5))
      ig.addColorStop(1, hsl(206, 95, 64, ia))
      ctx.fillStyle = ig
      ctx.beginPath()
      ctx.arc(g.cx, g.cy, g.R, 0, 6.283)
      ctx.fill()
      ctx.restore()

      // ── 등수 표시 — 그 나라 땅 위에. 1·2·3위는 메달 에셋, 4~10위는 숫자.
      //
      // ⚠️ 4~10위를 메달과 같은 에셋으로 만들지 않았다. 그 에셋은 궤도와 RANK 라벨을 품은 그림이라
      //    열 개가 뜨면 지구가 배지밭이 된다 — 시상대 셋만 그림이고 나머지는 숫자여야 위계가 산다.
      // ⚠️ 숫자는 **어두운 테를 먼저 긋고 밝은 면을 얹는다**(`strokeText` → `fillText`).
      //    빛나는 국토 위에도 얹히므로 면만 칠하면 밝은 땅에서 글자가 통째로 증발한다.
      const mk = CFG.markSize / 100
      type Mark = {
        x: number; y: number; ty: number; w: number; h: number; rank: number; fade: number
        /** 숫자 표시일 때의 글자 크기(px). 메달(1~3위)이면 0. */
        fontPx: number
      }
      const marks: Mark[] = []
      /**
       * 그 나라가 화면에서 차지하는 "짧은 변" 근사치 — `/arena` 의 `roomOf` 와 같은 식이다.
       *   (1) 구면 면적의 제곱근 × 배율. 지구본이라 가장자리 단축(cos θ)을 곱해 보정한다.
       *   (2) 실제 바운딩박스의 짧은 변 — 칠레·노르웨이처럼 가늘고 긴 땅에서 (1)의 과대평가를 자른다.
       * 둘 중 작은 쪽을 쓴다.
       */
      const roomOf = (c: Land) => {
        const a = c.partArea * Math.max(0.12, facing(c.c))
        const bb = pathMain.bounds(c.part as never)
        const shortSide = Math.min(bb[1][0] - bb[0][0], bb[1][1] - bb[0][1])
        return Math.min(Math.sqrt(a) * g.R, shortSide)
      }

      // ⚠️ **상위 10개국만이 아니라 전 국가에 등수를 찍는다**(`/arena` 와 같다). 불빛은 여전히 10개국뿐이고
      //    숫자만 전부 뜬다 — 두 화면이 같은 순위를 말하는데 한쪽만 셋을 보여주면 다른 그림이 된다.
      for (const c of W < 720 ? [] : lands) {
        if (c.rank <= 0) continue
        const fz = facing(c.c)
        // 지구 가장자리에서는 표시가 반쯤 잘려 보이므로 정면에 충분히 들어온 뒤 표시한다.
        if (fz <= 0.2) continue
        const p = projection(c.c)
        if (!p) continue
        const room = roomOf(c)
        const medal = c.rank <= 3
        let fontPx = 0
        let h: number
        if (medal) {
          // 1~3위 에셋 — 땅에 맞춰 줄이되 바닥은 지킨다(끝까지 맞추면 궤도·라벨이 뭉개진다).
          h = Math.min(Math.max(room * 0.6, g.R * ORD_FLOOR_R), g.R * ORD_SZ[c.rank] * mk)
        } else {
          const digits = String(c.rank).length
          // 절대 안 넘치게 하는 폭 상한. font-size 가 아니라 **그려지는 글자 폭**으로 재야 한다 —
          // 두 자릿수는 폭이 font-size 의 1.4배쯤이라 크기만 잘라 두면 그대로 삐져나온다.
          const widthCap = (room * 0.92) / (0.62 * digits + 0.24)
          fontPx = Math.min(Math.max(room * LBL_RATIO, LBL_FLOOR), g.R * LBL_CAP_R, widthCap)
          if (fontPx < LBL_HIDE) continue // 읽을 수 없는 크기면 아예 안 그린다
          h = fontPx
        }
        const img = medal ? rankImgs[c.rank - 1] : null
        const aspect = img?.naturalWidth && img?.naturalHeight ? img.naturalWidth / img.naturalHeight : 0.74
        marks.push({
          x: p[0],
          y: p[1],
          // 시상대(1~3위)만 중앙 카피와 겹칠 때 제목 바로 위까지 비켜 세운다.
          // ⚠️ 숫자(4위~)는 비켜 세우지 않는다 — 전 국가에 찍히므로 다 피하려 들면 위쪽에 무더기로 쌓인다.
          // ⚠️ 카피 밖으로 **완전히** 빼지는 않는다. 그렇게 하면 인도의 메달이 중앙아시아 상공에 뜬
          //    미아가 되어 어느 나라 것인지 못 읽는다(실제로 해보고 되돌렸다). 카피에 가리는 건
          //    자전으로 곧 풀리지만, 엉뚱한 땅 위에 선 등수는 계속 틀린 말을 한다.
          // 순위 마커는 문구 영역을 피하지 않고 해당 국가 좌표에 그대로 붙인다.
          ty: p[1],
          w: medal ? h * aspect : fontPx * 0.72,
          h,
          rank: c.rank,
          fade: Math.min(1, Math.max(0, (fz - 0.2) * 3.2)),
          fontPx,
        })
      }
      // 겹침 해소는 시상대 셋만. `/arena` 는 겹침을 안 풀고 작은 땅의 숫자를 숨기는 쪽인데,
      // 여기선 1~3위가 이웃하면(한국·일본) 에셋이 통째로 포개져 등수를 못 읽는다.
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      // 등수가 낮은 것부터 그려 1위가 맨 위에 온다(겹치면 시상대가 이긴다).
      for (const m of marks.slice().sort((a, b) => b.rank - a.rank)) {
        const col = litColor(m.rank)
        ctx.save()
        ctx.globalAlpha = 0.98 * m.fade
        if (m.fontPx) {
          // 4위~ 숫자 — `/arena` 의 `.ranklab` 과 같은 칠: **흰 글자 + 어두운 테**.
          // ⚠️ 등수 색으로 칠하지 말 것. 상위권은 국토가 밝게 빛나는데 글자까지 같은 밝은 색이면
          //    그 위에서 형체가 녹는다(한국 4위에서 실제로 그랬다). 등수는 이미 땅 색이 말한다.
          // ⚠️ 테를 먼저 긋고 면을 얹는 순서라야 한다(= arena 의 `paint-order: stroke`).
          ctx.font = `800 ${m.fontPx.toFixed(1)}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`
          ctx.lineJoin = 'round'
          ctx.lineWidth = Math.max(1.5, m.fontPx * 0.22)
          ctx.strokeStyle = 'rgba(5,16,34,0.8)'
          ctx.strokeText(String(m.rank), m.x, m.ty)
          ctx.fillStyle = '#f2f7ff'
          ctx.fillText(String(m.rank), m.x, m.ty)
        } else {
          const img = rankImgs[m.rank - 1]
          if (img?.complete && img.naturalWidth) {
            ctx.shadowColor = hsl(col.h, 94, 66, 0.22 * m.fade)
            ctx.shadowBlur = m.h * 0.035
            ctx.drawImage(img, m.x - m.w / 2, m.ty - m.h * 0.9, m.w, m.h)
          }
        }
        ctx.restore()
      }
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)

    // ── 드래그 회전 (/arena 와 같은 조작감). 감도는 반지름에 맞춘다 — 큰 지구는 같은 픽셀에
    //    더 적게 돌아야 손끝을 따라오는 느낌이 난다.
    const onDown = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY }
      cv.setPointerCapture(e.pointerId)
      cv.classList.add('is-drag')
    }
    const onMove = (e: PointerEvent) => {
      if (!drag) return
      const R = geom().R || 1
      const k = 90 / R
      rotLon += (e.clientX - drag.x) * k
      rotLat = Math.max(-LAT_LIMIT, Math.min(LAT_LIMIT, rotLat - (e.clientY - drag.y) * k))
      if (rotLon > 180) rotLon -= 360
      if (rotLon < -180) rotLon += 360
      drag = { x: e.clientX, y: e.clientY }
    }
    const onUp = () => {
      if (!drag) return
      drag = null
      cv.classList.remove('is-drag')
      // 멈춘 그 각도를 자동 회전의 새 기준으로 삼는다(안 하면 원래 궤도로 튄다).
      holdUntil = performance.now() + RESUME_MS
      spinBase = rotLon
      spinFrom = holdUntil
    }
    cv.addEventListener('pointerdown', onDown)
    cv.addEventListener('pointermove', onMove)
    cv.addEventListener('pointerup', onUp)
    cv.addEventListener('pointercancel', onUp)

    // 화면 밖이면 렌더를 멈춘다. 대가 없는 절약이라 이것만 넣었다(30fps 제한·WebGL 은 안 한다).
    const io = new IntersectionObserver((es) => { visible = es[0]?.isIntersecting ?? true }, { threshold: 0 })
    io.observe(wrap)
    // ⚠️ 탭이 백그라운드면 rAF 가 멈춘다. 각도는 경과 시간으로 내므로 튀지 않지만 가시성 플래그는
    //    직접 되돌려 줘야 한다(영상 히어로에서 같은 함정을 밟은 적이 있다).
    const onVis = () => { if (document.visibilityState === 'visible') visible = true }
    document.addEventListener('visibilitychange', onVis)

    raf = requestAnimationFrame(draw)

    // ── 데이터: 경계(모듈 캐시라 /arena 와 공유) + 나라별 시즌 점수
    //
    // ⚠️ 순위는 `/arena` 와 **완전히 같은 소스**(`leaderboard` scope:'country' → `buildRegions`)를 쓴다.
    //    서버가 시드 더미와 실집계를 이미 가중평균으로 섞어 내려주므로 여기서 보정할 게 없다.
    //    ⛔ 못 받았을 때 쓸 목값을 프론트에 두지 말 것 — 그러면 같은 순위를 말하는 두 화면이
    //       서로 다른 그림이 된다(2026-08-18 에 그 목값을 DB `arena_seed_buckets` 로 옮겼다).
    void (async () => {
      try {
        const feats = await loadCountries()
        if (dead) return

        let real: RealData = EMPTY_REAL
        try {
          const res = await callFunction<{
            buckets?: { code: string; score: number; member_count: number; has_real?: boolean }[]
          }>('leaderboard', { scope: 'country', window: 'season' })
          const country: RealData['country'] = {}
          for (const b of res?.buckets ?? []) {
            if (b?.code) {
              country[b.code] = { score: Number(b.score), members: Number(b.member_count), hasReal: !!b.has_real }
            }
          }
          real = { country, region: {} }
        } catch {
          /* 못 받으면 순위 없이 균일한 어두운 판으로 뜬다 — /arena 도 같은 방식이라 그림이 어긋나지 않는다 */
        }
        if (dead) return

        // lang 은 나라 **이름**을 만들 때만 쓰이는데 지구본은 이름을 그리지 않는다(순위 상세는 /arena).
        const regions = buildRegions({
          level: 0,
          lang: 'ko',
          real,
          countries: feats,
          provinces: [],
          drillIso: null,
          adm1Index: {},
        })
        const rankOf = new Map<string, number>()
        regions
          .slice()
          .sort((a, b) => b.score - a.score)
          .forEach((r, i) => {
            const iso = M49_TO_ISO2[String(r.f.id)]
            if (iso) rankOf.set(iso, i + 1)
          })

        const lands: Land[] = []
        for (const f of feats) {
          if (!f.geometry) continue
          // ⚠️ **구면 중심(geoCentroid)을 그대로 쓰면 안 된다.** 멀리 떨어진 섬이 딸린 나라는
          //    중심이 바다로 끌려간다 — 프랑스(해외령)는 (-6.8, 43.1) 비스케이만 한복판이라
          //    12위 숫자가 땅이 아니라 물 위에 떴다. `/arena` 지도가 쓰는 `labelAnchor` 와 같은 것을
          //    쓴다(가장 큰 덩어리를 골라 그 안쪽 점에 찍는다).
          const anchor = labelAnchor(f)
          const c = anchor.point
          if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue
          const iso = M49_TO_ISO2[String(f.id)] ?? ''
          lands.push({
            g: f.geometry,
            c,
            // 발광은 나라 전체 면이 빛나므로 **전체 면적**으로 보정한다.
            area: Math.max(1e-6, geoArea(f as never)),
            // 글자 크기는 라벨이 얹힌 **그 덩어리**에 맞춘다 — 전체로 재면 해외령까지 더해져
            // 본토보다 큰 글자가 나온다.
            part: anchor.part,
            partArea: Math.max(1e-6, geoArea(anchor.part as never)),
            iso,
            name: f.properties?.name ?? '',
            rank: rankOf.get(iso) ?? 0,
          })
        }
        // 면적 보정 기준 = 빛나는 나라들의 중간 크기. 이보다 크면 옅게, 작으면 진하게.
        const areas = lands
          .filter((c) => c.rank > 0 && c.rank <= CFG.lit)
          .map((c) => c.area)
          .sort((a, b) => a - b)
        areaRefRef.current = areas[Math.floor(areas.length / 2)] || 1
        landsRef.current = lands
      } catch {
        // 경계를 못 받으면 별만 남는다. 메인이 통째로 깨지는 것보다 낫다.
      }
    })()

    return () => {
      dead = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      cv.removeEventListener('pointerdown', onDown)
      cv.removeEventListener('pointermove', onMove)
      cv.removeEventListener('pointerup', onUp)
      cv.removeEventListener('pointercancel', onUp)
    }
  }, [glowCv, starCv])

  return (
    <div className="rg" ref={wrapRef}>
      <canvas className="rg-canvas" ref={cvRef} aria-label="세계 순위 지구본 — 끌어서 돌릴 수 있다" role="img" />
      {/* 히어로 문구가 얹히는 가운데를 눌러 글자가 지구 위에서도 읽히게 한다. */}
      <div className="rg-veil" aria-hidden="true" />
    </div>
  )
}
