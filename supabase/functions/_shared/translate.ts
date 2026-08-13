// 번역 엔진 어댑터 + 공용 판정.
//
//  엔진이 둘이다.
//   · **엣지**(주력)  — 우리 기계의 Edge 브라우저 온디바이스 번역. 공짜·무제한.
//                       여기서 호출하지 않는다(브라우저가 필요하므로 워커가 한다).
//   · **구글**(폴백) — 창고에 없을 때만. 워커가 죽었거나 새 조합의 첫 요청.
//                       Cloud Translation v2 = **API 키 한 줄**. v3 는 서비스 계정 JWT 서명이 필요해
//                       Edge Function 에서 쓰기 번거롭고, 채팅 텍스트엔 v2 로 충분하다.
//
//  결제의 payment-provider 포트와 같은 생각이다 — 호출부(chat-translate)는 엔진을 모른다.
//  다른 엔진으로 갈아탈 일이 생기면 이 파일에 어댑터를 하나 더 두고 translateBatch 안에서 고른다.

export type TranslateItem = { text: string; from?: string | null }
export type TranslateResult = { text: string; detected: string | null }

// 구글 v2 한 요청 상한. 문서상 요청당 30,000 코드포인트 · q 128개.
// 여유를 둔다 — 상한에 정확히 붙이면 계산 오차로 400 이 난다.
const MAX_ITEMS = 100
const MAX_CHARS = 25_000

/**
 * 번역할 가치가 있는 글인가.
 *  · 글자(letter)가 하나도 없으면 번역해도 결과가 같다 — 이모지·숫자·기호만 있는 줄.
 *  · 2자 이하는 맥락이 없어 감지도 번역도 신뢰할 수 없다("ㅋㅋ", "ok", "gg").
 * 채팅은 짧은 글이 절반이라 이 필터 하나가 실사용량을 크게 줄인다.
 */
export function isTranslatable(text: string | null | undefined): boolean {
  const s = (text ?? '').trim()
  if (s.length <= 2) return false
  return /\p{L}/u.test(s)
}

// 우리 언어코드(country-lang.ts · 브라우저 Translator API 기준 BCP-47) → 구글 v2 코드.
//  ⚠️ 구글은 옛 코드를 쓰는 데가 있다(히브리어 iw, 인도네시아어 in 등). 안 맞추면 그 언어만 조용히 실패한다.
//  ⚠️ 중국어는 반드시 갈라야 한다 — 간체(zh-CN)와 번체(zh-TW)를 뭉뚱그리면 대만 사용자가 간체를 받는다.
const GOOGLE_LANG: Record<string, string> = {
  'zh-hans': 'zh-CN',
  'zh-hant': 'zh-TW',
  'pt-pt': 'pt',
  'sr-cyrl': 'sr',
  'sr-latn': 'sr',
  nb: 'no',
  fil: 'tl',
  he: 'iw',
  id: 'id',
  dz: 'dz',
}

function toGoogleLang(code: string): string {
  const k = code.trim().toLowerCase()
  return GOOGLE_LANG[k] ?? k.split('-')[0]
}

/**
 * 구글이 돌려준 코드를 우리 표기로 되돌린다. 이 값이 chat_messages.src_lang 에 저장되고
 * 다음부터 "원문 == 독자 언어면 번역 안 함" 판정에 쓰이므로, 저장 표기가 흔들리면 안 된다.
 */
function fromGoogleLang(code: string | null | undefined): string | null {
  const k = (code ?? '').trim().toLowerCase()
  if (!k) return null
  if (k === 'zh-cn' || k === 'zh') return 'zh-Hans'
  if (k === 'zh-tw') return 'zh-Hant'
  if (k === 'iw') return 'he'
  if (k === 'tl') return 'fil'
  if (k === 'no') return 'nb'
  return k
}

function googleKey(): string | null {
  return Deno.env.get('GOOGLE_TRANSLATE_KEY') ?? null
}

/**
 * 요청 상한(건수·문자수)에 맞춰 **인덱스를** 자른다.
 * 값이 아니라 인덱스를 다루는 이유 = 응답을 원래 자리에 되돌려 놓아야 하기 때문.
 */
function chunkIdx(idxs: number[], items: TranslateItem[]): number[][] {
  const out: number[][] = []
  let cur: number[] = []
  let chars = 0
  for (const i of idxs) {
    const len = items[i].text.length
    if (cur.length >= MAX_ITEMS || (cur.length > 0 && chars + len > MAX_CHARS)) {
      out.push(cur)
      cur = []
      chars = 0
    }
    cur.push(i)
    chars += len
  }
  if (cur.length) out.push(cur)
  return out
}

/**
 * 여러 글을 한 대상 언어로 번역한다. 입력 순서 그대로 돌려준다.
 *
 *  ⚠️ 배열로 한 번에 보내는 게 핵심이다 — 방을 열 때 30건이면 호출 30번이 아니라 1번이다.
 *  ⚠️ 원문 언어가 섞여 있을 수 있는데 `source` 는 요청 단위라, 원문 언어별로 묶어서 보낸다.
 *     모르는 것(from=null)은 한 덩어리로 묶어 자동 감지에 맡기고 detected 를 받아 저장한다.
 *  ⚠️ **`source` 를 아는 건 반드시 명시한다** — 구글은 미지정 시 감지를 별도 과금해서
 *     같은 번역에 문자 수가 두 배로 청구된다.
 *
 *  실패하면 예외를 던지지 않고 **그 건만 null** 로 돌려준다 — 번역은 부가 기능이라
 *  실패했다고 목록이 비면 안 된다. 호출부는 null 인 건을 원문 그대로 둔다.
 */
export async function translateBatch(
  items: TranslateItem[],
  to: string,
): Promise<(TranslateResult | null)[]> {
  const out: (TranslateResult | null)[] = new Array(items.length).fill(null)
  const key = googleKey()
  if (!key || items.length === 0) return out

  // 원문 언어별로 묶는다(source 가 요청 단위라서). ' auto' = 자동 감지 그룹(공백 접두라 실제 코드와 겹치지 않는다).
  const groups = new Map<string, number[]>()
  items.forEach((it, i) => {
    const k = (it.from ?? '').trim() || ' auto'
    const g = groups.get(k)
    if (g) g.push(i)
    else groups.set(k, [i])
  })

  for (const [groupKey, idxs] of groups) {
    const from = groupKey === ' auto' ? null : groupKey
    for (const partIdxs of chunkIdx(idxs, items)) {
      const res = await callGoogle(key, partIdxs.map((i) => items[i]), to, from)
      if (!res) continue
      partIdxs.forEach((origIdx, j) => {
        const r = res[j]
        if (r) out[origIdx] = r
      })
    }
  }
  return out
}

async function callGoogle(
  key: string,
  part: TranslateItem[],
  to: string,
  from: string | null,
): Promise<(TranslateResult | null)[] | null> {
  const body: Record<string, unknown> = {
    q: part.map((p) => p.text),
    target: toGoogleLang(to),
    // ⚠️ format 을 안 주면 기본이 'html' 이라 <, & 가 엔티티(&lt; &amp;)로 돌아온다.
    format: 'text',
  }
  if (from) body.source = toGoogleLang(from)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  try {
    const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) return null
    const data = await res.json()
    const list = data?.data?.translations
    if (!Array.isArray(list)) return null
    return part.map((_, i) => {
      const row = list[i]
      const text = row?.translatedText
      if (typeof text !== 'string') return null
      return { text, detected: fromGoogleLang(row?.detectedSourceLanguage) ?? from ?? null }
    })
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
