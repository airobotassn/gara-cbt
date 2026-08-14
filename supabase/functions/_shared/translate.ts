// 번역 엔진 어댑터 + 공용 판정.
//
//  엔진이 셋이고 역할이 다르다.
//   · **엣지**(주력)   — 우리 기계의 Edge 브라우저 온디바이스 번역. 공짜·무제한.
//                        여기서 호출하지 않는다(브라우저가 필요하므로 워커가 한다).
//   · **Azure**(폴백)  — 월 200만자 무료(F0). ⚠️ **초과하면 거절**이라 모르는 새 돈이 나가지 않는다.
//   · **구글**(폴백)   — 월 50만자 무료. ⚠️ **초과하면 자동 과금**($20/100만자)이므로
//                        쓸 거면 GCP 콘솔에서 할당량 상한을 같이 걸어야 Azure 와 같은 안전성이 된다.
//
//  결제의 payment-provider 포트와 같은 구조다 — 호출부(chat-translate)는 엔진을 모르고
//  **어느 키가 꽂혀 있느냐로 엔진이 정해진다**. 갈아탈 때 코드를 안 고치려고 이렇게 뒀다
//  (2026-08-13 에 Azure↔구글을 계정 문제로 한 번 왕복했다).

export type TranslateItem = { text: string; from?: string | null }
export type TranslateResult = { text: string; detected: string | null }
export type EngineName = 'azure' | 'google'

// 두 엔진의 상한 중 **작은 쪽**으로 맞춘다(Azure 100건/50k자 · 구글 128건/30k 코드포인트).
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

// ── 엔진 선택 ──────────────────────────────────────────────
// 키가 꽂힌 쪽을 쓴다. 둘 다 있으면 Azure(무료분이 4배고 초과 시 과금이 아니라 거절이다).
// TRANSLATE_ENGINE 으로 강제할 수 있다.
type Cfg =
  | { name: 'azure'; key: string; region: string; url: string }
  | { name: 'google'; key: string }

function activeEngine(): Cfg | null {
  const forced = (Deno.env.get('TRANSLATE_ENGINE') ?? '').trim().toLowerCase()
  const azureKey = Deno.env.get('AZURE_TRANSLATOR_KEY')
  const googleKey = Deno.env.get('GOOGLE_TRANSLATE_KEY')

  const azure = (): Cfg | null =>
    azureKey
      ? {
          name: 'azure',
          key: azureKey,
          region: Deno.env.get('AZURE_TRANSLATOR_REGION') ?? 'koreacentral',
          url: (Deno.env.get('AZURE_TRANSLATOR_ENDPOINT') ?? 'https://api.cognitive.microsofttranslator.com').replace(/\/+$/, ''),
        }
      : null
  const google = (): Cfg | null => (googleKey ? { name: 'google', key: googleKey } : null)

  if (forced === 'azure') return azure()
  if (forced === 'google') return google()
  return azure() ?? google()
}

/** 지금 어느 엔진이 붙어 있나(없으면 null). 창고에 engine 을 기록할 때 쓴다. */
export function engineName(): EngineName | null {
  return activeEngine()?.name ?? null
}

// ── 언어 코드 표기 ────────────────────────────────────────
// 우리 표기 = 브라우저 Translator API 기준 BCP-47(country-lang.ts). 엔진마다 다른 표기를 쓴다.
//  ⚠️ 저장은 **언제나 우리 표기**로 통일한다. 엔진마다 다르게 저장하면
//     "원문 == 독자 언어" 판정이 흔들려 같은 글을 계속 다시 번역한다.
//  ⚠️ 중국어는 반드시 갈라야 한다 — 간체·번체를 뭉뚱그리면 대만 사용자가 간체를 받는다.
const GOOGLE_LANG: Record<string, string> = {
  'zh-hans': 'zh-CN',
  'zh-hant': 'zh-TW',
  'pt-pt': 'pt',
  'sr-cyrl': 'sr',
  'sr-latn': 'sr',
  nb: 'no',
  fil: 'tl',
  he: 'iw', // 구글은 히브리어에 옛 코드를 쓴다
}

function toEngineLang(code: string, engine: EngineName): string {
  const k = code.trim().toLowerCase()
  // Azure 는 우리 표기(zh-Hans·pt-pt·sr-Cyrl)를 그대로 받는다.
  if (engine === 'azure') return code.trim()
  return GOOGLE_LANG[k] ?? k.split('-')[0]
}

function fromEngineLang(code: string | null | undefined, engine: EngineName): string | null {
  const k = (code ?? '').trim()
  if (!k) return null
  if (engine === 'azure') return k
  const low = k.toLowerCase()
  if (low === 'zh-cn' || low === 'zh') return 'zh-Hans'
  if (low === 'zh-tw') return 'zh-Hant'
  if (low === 'iw') return 'he'
  if (low === 'tl') return 'fil'
  if (low === 'no') return 'nb'
  return low
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
 *  ⚠️ 원문 언어가 섞여 있을 수 있는데 `from` 은 요청 단위라, 원문 언어별로 묶어서 보낸다.
 *     모르는 것(from=null)은 한 덩어리로 묶어 자동 감지에 맡기고 detected 를 받아 저장한다.
 *  ⚠️ **원문 언어를 아는 건 반드시 명시한다** — 구글은 미지정 시 감지를 별도 과금해서
 *     같은 번역에 문자 수가 두 배로 청구된다(Azure 는 응답에 딸려 온다).
 *
 *  실패하면 예외를 던지지 않고 **그 건만 null** 로 돌려준다 — 번역은 부가 기능이라
 *  실패했다고 목록이 비면 안 된다. 호출부는 null 인 건을 원문 그대로 둔다.
 */
export async function translateBatch(
  items: TranslateItem[],
  to: string,
): Promise<{ engine: EngineName | null; results: (TranslateResult | null)[] }> {
  const results: (TranslateResult | null)[] = new Array(items.length).fill(null)
  const cfg = activeEngine()
  if (!cfg || items.length === 0) return { engine: cfg?.name ?? null, results }

  // 원문 언어별로 묶는다. ' auto' = 자동 감지 그룹(공백 접두라 실제 언어코드와 겹치지 않는다).
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
      const part = partIdxs.map((i) => items[i])
      const res = cfg.name === 'azure'
        ? await callAzure(cfg, part, to, from)
        : await callGoogle(cfg.key, part, to, from)
      if (!res) continue
      partIdxs.forEach((origIdx, j) => {
        const r = res[j]
        if (r) results[origIdx] = r
      })
    }
  }
  return { engine: cfg.name, results }
}

async function callAzure(
  cfg: Extract<Cfg, { name: 'azure' }>,
  part: TranslateItem[],
  to: string,
  from: string | null,
): Promise<(TranslateResult | null)[] | null> {
  const qs = new URLSearchParams({ 'api-version': '3.0', to: toEngineLang(to, 'azure'), textType: 'plain' })
  if (from) qs.set('from', toEngineLang(from, 'azure'))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  try {
    const res = await fetch(`${cfg.url}/translate?${qs}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': cfg.key,
        // ⚠️ 지역 헤더가 없으면 401 이다. 번역 주소가 전 세계 공용이라 키만으로는
        //    어느 리소스인지 Azure 가 알 수 없다.
        'Ocp-Apim-Subscription-Region': cfg.region,
      },
      body: JSON.stringify(part.map((p) => ({ Text: p.text }))),
      signal: controller.signal,
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!Array.isArray(data)) return null
    return part.map((_, i) => {
      const row = data[i]
      const text = row?.translations?.[0]?.text
      if (typeof text !== 'string') return null
      return { text, detected: fromEngineLang(row?.detectedLanguage?.language, 'azure') ?? from ?? null }
    })
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function callGoogle(
  key: string,
  part: TranslateItem[],
  to: string,
  from: string | null,
): Promise<(TranslateResult | null)[] | null> {
  const body: Record<string, unknown> = {
    q: part.map((p) => p.text),
    target: toEngineLang(to, 'google'),
    // ⚠️ format 을 안 주면 기본이 'html' 이라 <, & 가 엔티티(&lt; &amp;)로 돌아온다.
    format: 'text',
  }
  if (from) body.source = toEngineLang(from, 'google')

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
      return { text, detected: fromEngineLang(row?.detectedSourceLanguage, 'google') ?? from ?? null }
    })
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
