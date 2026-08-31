// 허브 꾸미기 카탈로그 — 캐릭터 · 스킨의 **그림과 수치**가 사는 곳.
//
// 왜 DB 가 아니라 코드인가 (2026-08-20 결정)
//   스킨 한 벌은 그림 15장으로 안 끝나고 9패치 자르는 값(`--skin-*-slice`·`--skin-*-edge`)이
//   같이 있어야 판이 안 찌그러진다. 그 숫자는 그림을 보면서 맞추는 값이지 관리자 폼에 칠 값이 아니다.
//   그래서 **그림·수치 = 코드/에셋, 가격·판매여부·진열순서 = DB(`shop_catalog`)** 로 갈랐다.
//   가구(`fur_*`)가 이미 같은 구조다(그림은 `lib/room.ts`, 가격만 DB).
//
// 새 캐릭터를 넣을 때 (2026-08-31 부터 **배포가 필요 없다**)
//   1) Lv.1~7 이 **한 줄로 선 시트 한 장**(흰 배경 그대로)을 받아
//      `node tools/build-char-art.mjs "<시트.png>" <키>` → `lv1..7.webp` 7장을 만든다.
//      ⚠️ 손으로 자르지 말 것 — 흰 배경 빼기와 '7장을 같은 캔버스에' 규칙이 그 도구 안에 있다.
//      ⚠️ 이 단계는 **여전히 사람이 한다.** 배경 뺀 시트를 따로 넣어야 하고(팔과 몸 사이 틈은
//         계산이 아니라 판단이다), 엣지 함수에는 그 이미지 처리기가 아예 없다.
//   2) 관리자 › WORLD ARENA › 꾸미기 관리 › **캐릭터 업로드** 에서 그 7장을 올리고 이름·가격을 정한다.
//      → `hub_char_art` 한 행 + `shop_catalog` 한 행이 같이 생기고, 이름 5개국어는 자동 번역된다.
//      비율은 브라우저가 올린 그림에서 재서 같이 보낸다(아래 `charAspect`).
//   ⛔ 아래 `CHAR_SERIES`·`CHAR_AR`·파일 경로 규칙을 지우지 말 것 — **이미 있는 두 캐릭터**
//      (`char_a_m`·`char_a_f`)는 표에 행이 없고 계속 `public/hub/char/...` 에서 그려진다.
//
// 새 스킨을 넣을 때
//   1) `public/hub/skin/<key>/` 에 그림 한 벌.
//   2) `hub.css` 에 `.hub[data-skin='<key>']` 배경 블록(그림·확대·캐릭터 키/발끝) 한 벌.
//   3) UI 를 새로 입힐 거면 `SkinUi` 에 이름을 하나 더 만들고 `hub.css` 에 `[data-ui='<이름>']`
//      값 블록 + 규칙 한 벌(기존 palace 블록을 복사해 값만 갈면 된다).
//      기존 벌을 그대로 쓸 거면 `ui` 에 그 이름만 적는다.
//   4) 이 파일 `SKINS` 에 한 줄.
//   5) `shop_catalog` 에 한 행 + 사전 `hub.part.skin_<key>`.

import { supabase } from './supabase'

// ── 캐릭터 ──────────────────────────────────────────────────────────────────
/**
 * 계열(생김새) — 화면에 한 줄로 이 순서대로 선다. 좌우 버튼이 계열 안에서 성별을 바꾼다.
 *
 * ⚠️ 지금은 **a 한 줄뿐이다**(2026-08-26). b·c 는 그림이 아직 없어서 고르면 폴백 한 장만 뜨는
 *    빈 껍데기였다 — 시트가 도착하면 여기에 다시 넣고 `shop_catalog` 의 active 를 되살리면 된다
 *    (행은 안 지웠다: `20260826170000_hub_char_bc_off.sql`).
 */
export const CHAR_SERIES = ['a'] as const
export type CharSeries = (typeof CHAR_SERIES)[number]

/** 성별 — 계열마다 두 벌. 순서가 곧 좌우 버튼 순서다. */
export const CHAR_GENDERS = ['m', 'f'] as const
export type CharGender = (typeof CHAR_GENDERS)[number]

/** 캐릭터 키 = `char_<계열>_<성별>`. ⚠️ 이 규칙이 곧 DB(`shop_catalog.part_key`) 값이다. */
export function charKey(series: CharSeries, gender: CharGender): string {
  return `char_${series}_${gender}`
}

/** 캐릭터 6종의 키 — 계열 순 → 성별 순. 선택 화면·인벤토리가 이 순서로 그린다. */
export const CHAR_KEYS: string[] = CHAR_SERIES.flatMap((s) => CHAR_GENDERS.map((g) => charKey(s, g)))

/** 키가 캐릭터인가. 인벤토리·상점이 종류를 가를 때 쓴다(kind 를 못 받는 자리의 폴백). */
export const isCharKey = (key: string) => key.startsWith('char_')

/**
 * 캐릭터 키에서 계열을 뽑는다(`char_a_m` → `a`). 선택 화면이 계열마다 카드 한 장을 세울 때 쓴다.
 * ⚠️ 규칙을 못 지키는 키(예전 값·직접 넣은 값)는 **자기 자신을 계열로** 삼는다 —
 *    그러면 카드 한 장으로 혼자 서고, 목록에서 사라지지 않는다.
 */
export function charSeriesOf(key: string): string {
  const parts = key.split('_')
  return parts.length >= 3 ? parts[1] : key
}

/**
 * 아직 캐릭터를 안 고른 사람(또는 그림이 없는 키)에게 보여줄 그림.
 * 2026-08-14 부터 무대에 서 있던 그 캐릭터 그대로다 — 새 그림이 도착하기 전에도 화면이 비지 않는다.
 * ⚠️ 지우지 말 것. 2026-08-26 현재 그림이 있는 건 계열 a(`char_a_m`·`char_a_f`) 둘뿐이고
 *    나머지 4종은 아직 **모든 레벨이 이 그림으로 그려진다.**
 */
export const CHAR_FALLBACK_SRC = '/hub/char-korea-lv2-hanbok-final.webp'
/** 폴백 그림의 실측 비율(가로/세로). */
export const CHAR_FALLBACK_AR = 512 / 640

/**
 * 캐릭터별 **캔버스** 비율(가로/세로) — `tools/build-char-art.mjs` 가 마지막에 찍어주는 값이다.
 *
 * ⚠️ 인물 비율이 아니라 **캔버스 비율**이다. 한 캐릭터의 7장은 같은 캔버스를 쓰고 그 안에서
 *    Lv.7 만 크다(마지막 레벨이라 일부러 크게 그렸다) — 레벨마다 딱 맞게 트림하면 7장이 전부
 *    같은 키로 늘어나 그 크기 차이가 통째로 사라진다.
 * ⚠️ 캔버스 아래끝 = 발끝(또는 옥좌 바닥)이라 여백이 없다. 그래서 `--skin-char-bottom` 이 그대로
 *    지평선이 된다.
 * ⚠️ 키(발 크기)와 발끝 위치는 여기 없다 — 그건 **배경마다 지평선이 달라서** 스킨 속성이다
 *    (`hub.css` 의 `--skin-char-h`·`--skin-char-bottom`). 캐릭터가 가진 건 비율 하나뿐이다.
 *
 * 값이 없으면 폴백 비율을 쓴다 → 그림이 아직 없는 계열(b·c)도 화면이 정상으로 선다.
 */
export const CHAR_AR: Record<string, number> = {
  char_a_m: 417 / 654,
  char_a_f: 852 / 1102,
}

/**
 * 캐릭터 레벨 — **1~7**. ARENA 레벨(`scoring.ts` 의 `arenaLevelForScore`)과 같은 축이다.
 * ⚠️ 시험 사다리 등급(`user_progress.rank`)이 아니다. 둘 다 1~7이라 헷갈리기 쉬운데,
 *    캐릭터가 자라는 기준은 **시즌 총점 밴드**(허브 HUD 경험치 바가 말하는 그 값)다.
 */
export const CHAR_MIN_LEVEL = 1
export const CHAR_MAX_LEVEL = 7
export const CHAR_LEVELS: number[] = Array.from(
  { length: CHAR_MAX_LEVEL - CHAR_MIN_LEVEL + 1 },
  (_, i) => CHAR_MIN_LEVEL + i,
)
/** 범위 밖 값을 1~7 로 접는다 — 점수가 0이거나 아직 안 받았을 때도 그림이 반드시 하나는 나온다. */
export const clampCharLevel = (lv: number | null | undefined): number =>
  Math.max(CHAR_MIN_LEVEL, Math.min(CHAR_MAX_LEVEL, Math.round(lv ?? CHAR_MIN_LEVEL) || CHAR_MIN_LEVEL))

/* ── 관리자가 올린 그림이 코드 경로를 이긴다 (2026-08-31) ──────────────────────
 * 캐릭터를 늘리는 데 배포가 필요 없게 하려고 `hub_char_art` 표를 하나 뒀다. 여기 있는 키는
 * 업로드된 주소로 그리고, 없는 키는 **예전 그대로** `public/hub/char/...` 에서 그린다.
 *
 * ⛔ 아래 파일 경로 규칙을 지우지 말 것 — 지금 그림이 있는 두 캐릭터(`char_a_m`·`char_a_f`)는
 *    표에 행이 없다. 규칙을 없애면 누군가 그 둘을 다시 업로드하기 전까지 허브가 폴백 한 장으로 뜬다.
 * ⚠️ 조회는 **한 번만** 하고 모듈에 들고 있는다 — `charArtSrc` 는 렌더 중에 불리는 동기 함수라
 *    (공유 카드처럼 훅을 못 쓰는 자리도 부른다) 여기서 await 할 수가 없다.
 * ⚠️ 도착하면 구독자에게 알린다. 안 알리면 이미 그려진 화면이 폴백 그림인 채로 남는다.
 */
interface CharArtRow {
  ar: number | null
  urls: Record<string, string>
  nameKo: string
  nameI18n: Record<string, string>
  /** 레벨(문자열 '1'~'7') → 크기 배율. 없는 레벨은 1. */
  scales: Record<string, number>
}
let CHAR_ART: Record<string, CharArtRow> = {}
const artSubs = new Set<() => void>()
let artVersion = 0
let artLoading: Promise<void> | null = null

export function subscribeCharArt(fn: () => void): () => void {
  artSubs.add(fn)
  return () => { artSubs.delete(fn) }
}
export const charArtVersion = () => artVersion

/** 업로드된 캐릭터 표를 한 번 받아 둔다. 실패하면 조용히 코드 경로로 남는다(화면이 비지 않는다). */
export function loadCharArt(): Promise<void> {
  if (!artLoading) {
    artLoading = (async () => {
      try {
        const { data } = await supabase.from('hub_char_art').select('part_key, ar, urls, name_ko, name_i18n, scales')
        const next: Record<string, CharArtRow> = {}
        for (const r of (data ?? []) as Record<string, unknown>[]) {
          next[String(r.part_key)] = {
            ar: r.ar === null || r.ar === undefined ? null : Number(r.ar),
            urls: (r.urls ?? {}) as Record<string, string>,
            nameKo: (r.name_ko as string) ?? '',
            nameI18n: (r.name_i18n ?? {}) as Record<string, string>,
            scales: (r.scales ?? {}) as Record<string, number>,
          }
        }
        CHAR_ART = next
        artVersion++
        for (const fn of artSubs) fn()
      } catch { /* 못 받으면 코드 경로 그대로 — 화면이 비지 않는다 */ }
    })()
  }
  return artLoading
}

/** 업로드된 캐릭터 키 — 코드 목록(`CHAR_KEYS`)에 없는 새 캐릭터가 보관함에서 사라지지 않게 한다. */
export const uploadedCharKeys = (): string[] => Object.keys(CHAR_ART)

/**
 * 캐릭터 이름 — 업로드된 것이면 관리자가 넣은 이름, 아니면 사전(`hub.part.<key>`).
 * ⚠️ 한국어는 `name_ko` 가 원본이고 `name_i18n` 에는 번역본만 있다(공지·강의와 같은 규칙).
 */
export function charArtName(key: string, lang: string): string | null {
  const row = CHAR_ART[key]
  if (!row) return null
  return (lang === 'ko' ? row.nameKo : row.nameI18n[lang] || row.nameKo) || null
}

/**
 * 캐릭터 그림 경로 — **한 캐릭터가 레벨마다 한 장**이다(`/hub/char/char_a_m/lv3.webp`).
 * 파일이 없으면 브라우저 onError 가 폴백으로 바꾼다(`<CharArt>` 참고) — 그림이 도착하기 전에도 화면이 선다.
 */
export const charArtSrc = (key: string, level: number) =>
  CHAR_ART[key]?.urls[String(clampCharLevel(level))] ?? `/hub/char/${key}/lv${clampCharLevel(level)}.webp`

/**
 * 무대에서 이 레벨이 기본 키의 몇 배로 설 것인가 (`hub.css` 의 `--char-scale`).
 *
 * 왜 필요한가: 업로드된 그림은 **투명 여백까지 잘라서** 올라오므로 그대로 두면 7장이 전부 같은 키가
 * 된다(레벨이 올라도 안 커진다). 원본에서 인물이 캔버스의 몇 %를 차지했는지를 업로드가 배율로
 * 옮겨 담고, 관리자가 거기서부터 조정한다.
 * ⚠️ 값이 없으면 1 — 그래서 표에 행이 없는 옛 캐릭터는 예전 그대로 그려진다.
 * ⛔ 이 값으로 발끝 위치를 대신하려 들지 말 것. 그건 배경마다 다른 값이라 스킨이 갖는다.
 */
export const charScale = (key: string | null | undefined, level: number): number =>
  (key ? CHAR_ART[key]?.scales?.[String(clampCharLevel(level))] : undefined) ?? 1
export const charAspect = (key: string) => CHAR_ART[key]?.ar ?? CHAR_AR[key] ?? CHAR_FALLBACK_AR

// ── 스킨 ────────────────────────────────────────────────────────────────────
/**
 * 스킨 = 배경 + UI 한 벌(2026-08-20: 통짜 한 상품으로 판다).
 * ⚠️ `key` 는 `hub.css` 의 `.hub[data-skin='<key>']` 블록 이름과 **글자까지 같아야** 한다.
 *    다르면 화면이 값 블록을 못 찾아 판·게이지·스탬프가 통째로 맨몸으로 뜬다.
 */
/**
 * 이 스킨이 입는 **UI 한 벌**의 이름 = `.hub` 의 `data-ui` 값.
 * `base`   = 아무 그림도 안 얹는 원래 카툰 CSS(흰 면 + 두꺼운 외곽선 + SVG 아이콘).
 * `palace` = 궁궐 9패치 판·게이지·도장·아이콘 한 벌(`public/hub/ui/*`).
 *
 * ⚠️ **스킨 이름(`data-skin`)으로 UI 를 고르지 말 것.** 예전엔 CSS 가 `.hub[data-skin]` 이면
 *    무조건 궁궐 UI 를 얹었는데, 기본 배경(초원)이 생기자 초원 위에 궁궐 판이 그대로 얹혔다.
 *    급한 대로 선택자를 `palace_night` 하나로 좁혔더니 이번엔 **고궁 낮이 UI 를 잃었다**
 *    (2026-08-25). 배경과 UI 는 각자 이름을 갖는다 — 그래야 "배경만 다른 두 스킨"이 성립한다.
 */
export type SkinUi = 'base' | 'palace'

export interface SkinDef {
  /** `data-skin` 값 = 배경 값 블록 이름(`hub.css` 의 `.hub[data-skin='<키>']`) */
  key: string
  /** 상점 카탈로그의 part_key(`shop_catalog`). 소유·구매가 이 값으로 돌아간다. */
  partKey: string
  /** 입는 UI 한 벌 = `data-ui` 값. 같은 벌을 쓰는 스킨끼리 CSS 를 통째로 공유한다. */
  ui: SkinUi
  /** 레일 아이콘 폴더 — CSS 변수로 못 넘기는 유일한 자리(`<img src>` 라 코드가 알아야 한다).
   *  null 이면 원래 쓰던 SVG 아이콘으로 돌아간다(= `ui: 'base'` 와 한 쌍). */
  iconDir: string | null
  /** 배경 그림. 공유 카드가 이 그림을 캔버스에 깐다(CSS 변수는 캔버스에서 못 읽는다). */
  bg: string
  /** 상점·인벤토리 썸네일. 없으면 배경 그림을 줄여 쓴다. */
  thumb?: string
}

/**
 * 스킨 목록 — 기본 초원 + 판매용 고궁 두 장(낮·밤).
 * ⚠️ **첫 항목이 기본**이다. 아무것도 장착 안 한 사람과 모르는 값이 저장된 사람이 전부 여기로
 *    떨어진다(`skinByPart`) — 그래서 첫 항목은 반드시 **값이 0**이어서 전원이 쓸 수 있어야 한다.
 *    값을 매기면 신규 회원 화면에 배경이 없다.
 * ⚠️ 값 0인 스킨은 사지 않아도 장착된다(`hub_equip` 이 price=0 을 예외로 둔다) — 되돌아올 길이다.
 */
export const SKINS: SkinDef[] = [
  // 초원 — 값이 0이라 전원이 쓰는 **기본**이자 첫 화면. 비판매(상점에 안 뜨고 보관함에만 있다).
  //   ⚠️ 이 자리를 고궁 낮에 얹어 쓰지 말 것(2026-08-25 에 실제로 그랬다). 기본은 자기 키를 갖는다 —
  //      그래야 고궁 낮이 자기 배경·자기 UI 를 그대로 들고 판매용 스킨으로 설 수 있다.
  {
    key: 'meadow',
    partKey: 'skin_meadow',
    // 기본 초원은 옛 CSS 카드·게이지와 SVG 아이콘을 한 세트로 쓴다 — 그래서 아이콘 폴더가 없다.
    ui: 'base',
    iconDir: null,
    bg: '/hub/bg-meadow-default.webp',
  },
  // 같은 고궁의 **낮**과 **밤**. 둘 다 코인으로 산다.
  //   ⚠️ 이 둘은 UI 한 벌(판·게이지·도장·아이콘)을 통째로 공유하고 배경만 다르다 —
  //      hub.css 도 값 블록 하나(`[data-ui='palace']`)를 둘이 같이 쓰고 --skin-bg 만 각자 덮는다.
  {
    key: 'palace_day',
    partKey: 'skin_palace_day',
    ui: 'palace',
    iconDir: '/hub/ui',
    bg: '/hub/bg-v2.webp',
  },
  {
    key: 'palace_night',
    partKey: 'skin_palace_night',
    ui: 'palace',
    iconDir: '/hub/ui',
    bg: '/hub/bg-v5.webp',
  },
]

export const DEFAULT_SKIN = SKINS[0].key
export const DEFAULT_SKIN_PART = SKINS[0].partKey

const SKIN_BY_KEY = new Map(SKINS.map((s) => [s.key, s]))
const SKIN_BY_PART = new Map(SKINS.map((s) => [s.partKey, s]))

/** 스킨 키(`data-skin` 값) → 정의. 모르는 값이면 기본 스킨으로 떨어진다. */
export const skinByKey = (key: string | null | undefined): SkinDef =>
  (key ? SKIN_BY_KEY.get(key) : null) ?? SKINS[0]
/** 상점 part_key → 정의. 장착값은 part_key 로 저장되므로 화면은 대개 이쪽을 쓴다. */
export const skinByPart = (partKey: string | null | undefined): SkinDef =>
  (partKey ? SKIN_BY_PART.get(partKey) : null) ?? SKINS[0]

/** 키가 스킨인가 — 인벤토리가 종류를 가를 때. */
export const isSkinKey = (key: string) => key.startsWith('skin_')

export const skinThumb = (s: SkinDef) => s.thumb ?? s.bg

// ── 공유 카드가 쓰는 해석 ────────────────────────────────────────────────────
/**
 * 남의 카드/방을 그릴 때 서버가 주는 값(캐릭터 키 · 스킨 part_key)을 그림 두 장으로 바꾼다.
 * ⚠️ 캔버스는 CSS 변수를 못 읽는다 — 그래서 배경 경로가 `SkinDef.bg` 로 코드에 있어야 한다.
 *    이 함수가 그 유일한 이유다(화면은 `data-skin` 만으로 충분하다).
 */
export function cosmeticArt(
  character: string | null,
  skinPart: string | null,
  level: number,
): { char: string; bg: string } {
  return {
    char: character && character !== 'default' ? charArtSrc(character, level) : CHAR_FALLBACK_SRC,
    bg: skinByPart(skinPart).bg,
  }
}
