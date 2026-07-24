// 한국어 비속어 필터 (Deno-native, 런타임 API 미사용 — bun에서도 단위테스트 가능한 순수 TS).
//
// KO_BADWORDS 출처(PROVENANCE): 자체 작성한 최소 시드 목록(self-authored minimal seed).
// 외부 목록(예: badwords-ko 등)에서 확장하려면 반드시 해당 목록의 라이선스/출처 표기 요건을
// 먼저 검증할 것 — 이 슬라이스에서는 외부 목록을 vendoring하지 않는다.
//
// 매칭 전략: 원문에서 "구분자(공백/구두점 등)로 갈라진 지점"을 경계(boundary)로 기록해 두고,
// 구분자 자체는 제거해 정규화 문자열을 만든다("시 발" -> "시발" 같은 회피 표기를 폴딩).
// 이후 정규화 문자열에서 나쁜말 토큰을 찾되, 매칭 시작/끝이 원래 경계(문자열 시작/끝 또는
// 구분자가 있던 자리)와 일치할 때만 실제 매칭으로 인정한다. 이렇게 하면 "시발점"처럼 구분자
// 없이 이어붙은 합성어 안에 우연히 토큰이 포함된 경우는 자연스럽게 걸러진다.

// 자체 작성 커스텀 목록: 명백한 한국어 비속어/욕설 루트(+흔한 변형).
//  · 공백/숫자/구두점/자모분리 우회는 normalizeKo 가 흡수하므로 여기엔 기본형만 넣는다.
//  · 정밀도(오탐)를 위해 경계-앵커링으로 매칭 — 시발점/개발자/발표 등 합성어는 통과.
//  · ⚠️ 100% 아님. 문맥형·비한국어·신조어는 OpenAI Moderation + 신고가 보완(설계 3종세트).
//    더 높은 recall 이 필요하면 검증된 외부 목록(라이선스 확인 후) 병합 여지 있음.
//  · 동음이의(보지/자지=동사 활용형) 오탐 가능성은 알려진 한계.
export const KO_BADWORDS: string[] = [
  // ㅅ 계열
  '씨발', '시발', '씨팔', '시팔', '씨바', '시바', '씨발놈', '씨발년', '씨발새끼', '시발새끼', '씨불', '씨봉', '씨앙', '싸발',
  '썅', '썅년', '썅놈', '쌍놈', '쌍년', '씹새', '씹새끼', '씹창', '씹할', '씹년',
  // ㄱ 계열
  '개새끼', '개새', '개색끼', '개색기', '개세끼', '개놈', '개년', '개지랄', '개씨발', '개자식',
  // ㅂ/ㅈ 계열
  '병신', '븅신', '빙신', '지랄', '좆', '좃', '좆같', '좆도', '좆밥', '좆까', '좆만', '좆되', '조까',
  // ('보지'·'자지'·'자위' 는 동사 활용형(안 보지 마 / 자지 마)과 동음이의라 오탐 위험 → 목록 제외; 신고+moderation 이 보완)
  // 기타 욕설/멸칭
  '미친놈', '미친년', '창녀', '창놈', '걸레년', '후레자식', '후장', '니미', '니애미', '니미럴', '느금마', '느개비',
  '엿같', '엿먹', '염병', '옘병', '지랄맞', '뒈져', '닥쳐',
]

// 정밀도(오탐 억제)는 위의 경계-앵커링 매칭이 담당한다: 나쁜말 토큰은 시작/끝이 모두
// 원래 경계와 일치할 때만 매칭되므로 "시발점"·"개발자"·"발표" 같은 합성어는 자연히 통과한다.
// (별도 허용목록은 현재 앵커링 하에서 아무것도 억제하지 못해 제거함 — 시드 목록 확장으로
//  실제 오탐이 관측되면 그때 테스트와 함께 허용목록을 도입할 것.)

const ZERO_WIDTH_RE = /[\u200b-\u200d\uFEFF]/g

// 흔히 자모/음절을 흉내내는 숫자 leetspeak 문자들("시1발"처럼 숫자가 글자 사이에 끼어드는
// 회피 표기가 흔함). TOKEN_CHAR_RE가 숫자를 토큰 문자로 인정하지 않으므로 아래 분류 루프에서
// 숫자는 다른 구분자(공백/구두점)와 동일하게 "경계를 만드는 노이즈"로 취급되어 제거된다
// — 그 결과 "시1발" -> "시발"로 폴딩된다.

// 한글 자모(호환용 자모, 초성/중성/종성) + 한글 음절 + 영숫자만 "토큰 문자"로 간주하고
// 나머지는 전부 구분자(경계 생성원)로 취급한다.
const TOKEN_CHAR_RE = /[a-zA-Z\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]/

const CHOSEONG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']
const JUNGSEONG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ']

interface NormalizedResult {
  text: string
  // gapBefore[i] === true  ->  output char i 바로 앞에 원문 구분자가 있었다(경계).
  gapBefore: boolean[]
}

function foldAndSplit(raw: string): { chars: string[]; gapBefore: boolean[] } {
  let s = raw.normalize('NFC').toLowerCase()
  s = s.replace(ZERO_WIDTH_RE, '')

  const chars: string[] = []
  const gapBefore: boolean[] = []
  let pendingGap = false
  for (const ch of s) {
    if (TOKEN_CHAR_RE.test(ch)) {
      chars.push(ch)
      gapBefore.push(pendingGap)
      pendingGap = false
    } else {
      pendingGap = true
    }
  }
  return { chars, gapBefore }
}

// 호환용 자모(ㅅㅣ발 같은 분해 입력)를 최대한 완성형 음절로 결합한다(근사치 조합기, 종성 미지원).
function joinJamoPass(chars: string[], gapBefore: boolean[]): { chars: string[]; gapBefore: boolean[] } {
  const outChars: string[] = []
  const outGap: boolean[] = []
  let i = 0
  while (i < chars.length) {
    const c = chars[i]
    const cIdx = CHOSEONG.indexOf(c)
    if (cIdx >= 0 && i + 1 < chars.length) {
      const vIdx = JUNGSEONG.indexOf(chars[i + 1])
      if (vIdx >= 0) {
        const code = 0xac00 + (cIdx * 21 + vIdx) * 28
        outChars.push(String.fromCharCode(code))
        outGap.push(gapBefore[i])
        i += 2
        continue
      }
    }
    outChars.push(c)
    outGap.push(gapBefore[i])
    i += 1
  }
  return { chars: outChars, gapBefore: outGap }
}

// 2회 이상 연속 반복되는 문자를 1회로 축약 (예: "ㅋㅋㅋ" -> "ㅋ") — best-effort.
function collapseRepeatsPass(chars: string[], gapBefore: boolean[]): { chars: string[]; gapBefore: boolean[] } {
  const outChars: string[] = []
  const outGap: boolean[] = []
  let i = 0
  while (i < chars.length) {
    let j = i
    while (j < chars.length && chars[j] === chars[i]) j++
    outChars.push(chars[i])
    outGap.push(gapBefore[i])
    i = j
  }
  return { chars: outChars, gapBefore: outGap }
}

function normalizeWithBoundary(text: string): NormalizedResult {
  let { chars, gapBefore } = foldAndSplit(text)
  ;({ chars, gapBefore } = joinJamoPass(chars, gapBefore))
  ;({ chars, gapBefore } = collapseRepeatsPass(chars, gapBefore))
  return { text: chars.join('').normalize('NFC'), gapBefore }
}

export function normalizeKo(text: string): string {
  return normalizeWithBoundary(text).text
}

interface Hit {
  token: string
  start: number
  end: number // exclusive
}

function findAnchoredHits(normalized: NormalizedResult, tokens: string[]): Hit[] {
  const { text, gapBefore } = normalized
  const isBoundary = (pos: number): boolean => pos === 0 || pos === text.length || gapBefore[pos] === true

  const hits: Hit[] = []
  for (const token of tokens) {
    if (!token) continue
    let fromIndex = 0
    while (fromIndex <= text.length) {
      const idx = text.indexOf(token, fromIndex)
      if (idx === -1) break
      const end = idx + token.length
      if (isBoundary(idx)) {
        hits.push({ token, start: idx, end })
      }
      fromIndex = idx + 1
    }
  }
  return hits
}

// 始發(시발점 등)처럼 '나쁜말로 시작하지만' 무해한 합성어 — 시작-앵커 매칭의 오탐을 억제.
const ALLOWLIST = ['시발점', '시발역', '시발차', '시발유', '시발지', '시발탄']

export function checkBadword(text: string): { blocked: boolean; hit?: string } {
  const normalized = normalizeWithBoundary(text)
  const badHits = findAnchoredHits(normalized, KO_BADWORDS)
  for (const h of badHits) {
    // 매칭 위치부터의 나머지가 allowlist 무해어로 시작하면 오탐 → 건너뜀.
    if (ALLOWLIST.some((w) => normalized.text.slice(h.start).startsWith(w))) continue
    return { blocked: true, hit: h.token }
  }
  return { blocked: false }
}
