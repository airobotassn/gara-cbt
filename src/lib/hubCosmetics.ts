// 허브 꾸미기 카탈로그 — 캐릭터 · 스킨의 **그림과 수치**가 사는 곳.
//
// 왜 DB 가 아니라 코드인가 (2026-08-20 결정)
//   스킨 한 벌은 그림 15장으로 안 끝나고 9패치 자르는 값(`--skin-*-slice`·`--skin-*-edge`)이
//   같이 있어야 판이 안 찌그러진다. 그 숫자는 그림을 보면서 맞추는 값이지 관리자 폼에 칠 값이 아니다.
//   그래서 **그림·수치 = 코드/에셋, 가격·판매여부·진열순서 = DB(`shop_catalog`)** 로 갈랐다.
//   가구(`fur_*`)가 이미 같은 구조다(그림은 `lib/room.ts`, 가격만 DB).
//
// 새 캐릭터를 넣을 때
//   1) `public/hub/char/<key>/lv1.webp` ~ `lv7.webp` 에 그림 7장을 떨군다
//      (레벨마다 한 장 — 선택 화면이 Lv.1~7 을 한 줄로 늘어놓아 '이렇게 자란다'를 보여준다).
//      투명 여백은 **트림**하고 넣을 것 — 아래 ⚠️.
//   2) 이 파일 `CHAR_ART` 에 한 줄(비율).
//   3) `shop_catalog` 에 한 행(관리자 화면에서 가격만 정하면 된다).
//   4) 사전에 `hub.char.<key>` 6개국어.
//
// 새 스킨을 넣을 때
//   1) `public/hub/skin/<key>/` 에 그림 한 벌.
//   2) `hub.css` 에 `.hub[data-skin='<key>']` 값 블록 한 벌(기존 palace 블록을 복사해 값만 갈면 된다).
//   3) 이 파일 `SKINS` 에 한 줄.
//   4) `shop_catalog` 에 한 행 + 사전 `hub.skin.<key>`.

// ── 캐릭터 ──────────────────────────────────────────────────────────────────
/** 계열(생김새) — 화면에 한 줄로 이 순서대로 선다. 좌우 버튼이 계열 안에서 성별을 바꾼다. */
export const CHAR_SERIES = ['a', 'b', 'c'] as const
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
 * ⚠️ 지우지 말 것. 6종 그림이 아직 없어서 지금은 **모든 슬롯이 이 그림으로 그려진다.**
 */
export const CHAR_FALLBACK_SRC = '/hub/char-korea-lv2-hanbok-final.webp'
/** 폴백 그림의 실측 비율(가로/세로). hub.css palace 블록의 `--skin-char-ar` 과 같은 값이다. */
export const CHAR_FALLBACK_AR = 512 / 640

/**
 * 캐릭터별 그림 비율(가로/세로).
 *
 * ⚠️ **그림을 넣을 때마다 알파로 다시 재야 한다.** 아래에 투명 여백이 남아 있으면 발끝이 그만큼
 *    떠서 스킨의 `--skin-char-bottom`(지평선)이 거짓말을 한다. 받은 원본은 아래 14%가 여백이었다.
 * ⚠️ 키(발 크기)와 발끝 위치는 여기 없다 — 그건 **배경마다 지평선이 달라서** 스킨 속성이다
 *    (`hub.css` 의 `--skin-char-h`·`--skin-char-bottom`). 캐릭터가 가진 건 비율 하나뿐이다.
 *
 * 값이 없으면 폴백 비율을 쓴다 → 그림이 아직 없는 지금도 화면이 정상으로 선다.
 */
export const CHAR_AR: Record<string, number> = {
  // char_a_m: 512 / 640,   ← 그림이 도착하면 실측해서 채울 것
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

/**
 * 캐릭터 그림 경로 — **한 캐릭터가 레벨마다 한 장**이다(`/hub/char/char_a_m/lv3.webp`).
 * 그래서 총 장수 = 계열 3 × 성별 2 × 레벨 7 = **42장**.
 * 파일이 없으면 브라우저 onError 가 폴백으로 바꾼다(`<CharArt>` 참고) — 그림이 도착하기 전에도 화면이 선다.
 */
export const charArtSrc = (key: string, level: number) => `/hub/char/${key}/lv${clampCharLevel(level)}.webp`
export const charAspect = (key: string) => CHAR_AR[key] ?? CHAR_FALLBACK_AR

// ── 스킨 ────────────────────────────────────────────────────────────────────
/**
 * 스킨 = 배경 + UI 한 벌(2026-08-20: 통짜 한 상품으로 판다).
 * ⚠️ `key` 는 `hub.css` 의 `.hub[data-skin='<key>']` 블록 이름과 **글자까지 같아야** 한다.
 *    다르면 화면이 값 블록을 못 찾아 판·게이지·스탬프가 통째로 맨몸으로 뜬다.
 */
export interface SkinDef {
  /** `data-skin` 값 = CSS 값 블록 이름 */
  key: string
  /** 상점 카탈로그의 part_key(`shop_catalog`). 소유·구매가 이 값으로 돌아간다. */
  partKey: string
  /** 레일 아이콘 폴더 — CSS 변수로 못 넘기는 유일한 자리(`<img src>` 라 코드가 알아야 한다). */
  iconDir: string
  /** 배경 그림. 공유 카드가 이 그림을 캔버스에 깐다(CSS 변수는 캔버스에서 못 읽는다). */
  bg: string
  /** 상점·인벤토리 썸네일. 없으면 배경 그림을 줄여 쓴다. */
  thumb?: string
}

/**
 * 스킨 목록. **첫 항목이 기본**(아무도 안 산 상태에서 쓰는 바탕)이다.
 * ⚠️ palace 는 상점에 없다(`active=false`) — 전원이 처음부터 쓰는 바탕이라 살 물건이 아니다.
 *    그래도 인벤토리에는 늘 떠야 한다(다른 스킨을 샀다가 되돌아올 길이 필요하다).
 */
export const SKINS: SkinDef[] = [
  {
    key: 'palace',
    partKey: 'skin_palace',
    iconDir: '/hub/ui',
    bg: '/hub/bg.png',
  },
  // 새 스킨 예시 — 그림 한 벌 + hub.css 값 블록이 준비되면 주석을 풀면 된다.
  // { key: 'neon', partKey: 'skin_neon', iconDir: '/hub/skin/neon/ui', bg: '/hub/skin/neon/bg.webp' },
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
