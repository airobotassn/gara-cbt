// 이북 본문 다국어화 — 업로드한 HTML 을 언어별 HTML 로 만든다.
//
// 왜 클라(관리자 브라우저)인가:
//   · 마크업을 서버로 보내지 않는다. 여기서 HTML 을 파싱해 **텍스트 노드만** 뽑아 번역 함수에 보내고,
//     받은 번역을 같은 노드에 도로 꽂는다 → 태그·CSS·임베드 폰트가 원본 그대로 남는다.
//   · 완성된 언어별 HTML 을 실제로 렌더해 **페이지 넘침(clipping)** 까지 여기서 검사한다.
//     A4 고정 높이 + overflow:hidden 조판이라, 번역문이 길어지면 조용히 잘린다.
//
// 전제(표지 생성과 동일): 이북은 외부 리소스가 없는 단일 HTML.

import { callFunction } from './supabase'

/** 번역 대상 언어. 원문은 한국어(ko)라 목록에 없다. */
export const EBOOK_LANGS = ['en', 'ja', 'zh', 'hi', 'vi'] as const
export type EbookLang = (typeof EBOOK_LANGS)[number]

export const EBOOK_LANG_LABEL: Record<string, string> = {
  ko: '한국어',
  en: 'English',
  ja: '日本語',
  zh: '简体中文',
  hi: 'हिन्दी',
  vi: 'Tiếng Việt',
}

// 책에 임베드된 한글 폰트(서브셋)에는 가나·한자·데바나가리 글리프가 없다 → 그대로 두면 두부(tofu)가 된다.
// 원본 지정 폰트 뒤에 그 언어의 시스템 폰트를 덧붙여 최소한 읽히게 한다(서체 디자인은 그 언어에서만 달라진다).
const FONT_FALLBACK: Partial<Record<EbookLang, string>> = {
  ja: `"Noto Sans JP","Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic","Meiryo","MS PGothic",sans-serif`,
  zh: `"Noto Sans SC","PingFang SC","Hiragino Sans GB","Microsoft YaHei","SimHei",sans-serif`,
  hi: `"Noto Sans Devanagari","Nirmala UI","Mangal","Kohinoor Devanagari",sans-serif`,
}

// ── 호출 사다리 (문항 번역 `adminTranslate.ts` 와 같은 방식) ───────────────────────────
// 실패한 조각만 **점점 작은 묶음으로** 다시 돌린다. 모델이 항목을 빠뜨리거나(모델항목누락)
// 깨진 JSON 을 뱉는 사고는 묶음이 클수록 잘 나고, 작게 다시 물으면 대개 통과한다.
//   1차 120 = 함수의 MAX_TEXTS(요청당 상한). 함수가 25개씩 묶어 병렬 호출 → 제일 빠름.
//   2차 12 / 3차 4 = 함수의 GROUP_SIZE(25)보다 작아 그대로 한 묶음이 된다 → 실패율이 뚝 떨어진다.
const SPLIT_STEPS = [120, 12, 4]
/** 함수의 GROUP_SIZE(Gemini 호출 1회에 묶는 조각 수). 분당 호출 수를 세는 데만 쓴다. */
const GROUP_SIZE = 25
/** 동시에 띄우는 HTTP 요청 수. */
const POOL = 2
/** 분당 Gemini 호출 상한. 로그상 분당 18건에서 429 가 났다(2026-07-28) → 여유를 둔 값. */
const RPM = 12

/**
 * 분당 호출 스로틀(토큰 버킷).
 * ⚠️ **모듈 전역**이다 — 책마다 새로 만들면 3권을 연달아 번역할 때 각자 가득 찬 버킷으로 시작해
 *    그대로 429 가 난다(실제로 그렇게 났다). 전역이라 연속 실행이 한도를 나눠 쓴다.
 */
const takeSlots = (() => {
  let tokens = 2
  let last = Date.now()
  return async (n: number): Promise<void> => {
    for (;;) {
      const now = Date.now()
      tokens = Math.min(RPM, tokens + ((now - last) * RPM) / 60000)
      last = now
      if (tokens >= n) {
        tokens -= n
        return
      }
      await new Promise((r) => setTimeout(r, 400))
    }
  }
})()

/** 일일 한도(RPD) 소진 — 오늘은 더 돌려도 소용없으므로 사다리를 즉시 중단시킨다. */
class DailyQuotaError extends Error {}

/** 스토어 카드에 쓰는 메타(제목·지은이·소개) — 본문과 같이 번역해 언어별로 저장한다. */
export interface EbookMeta {
  title: string
  author: string
  description: string
}

export interface LangResult {
  lang: EbookLang
  html: string
  meta: EbookMeta
  /** 번역이 실패해 원문(한국어)이 그대로 남은 조각 수 */
  failed: number
  /** 글이 넘쳐 자동으로 축소해 맞춘 페이지 번호(1부터) */
  fittedPages: number[]
  /** 축소 하한까지 줄여도 안 들어간 페이지 번호 — 사람이 손봐야 하는 것만 남는다 */
  overflowPages: number[]
}

export interface TranslateProgress {
  phase: 'extract' | 'translate' | 'build' | 'fit'
  done: number
  total: number
  lang?: EbookLang
  /** 재시도 단계 표시(예: '재시도 12개씩'). 1차 통과 중에는 빈 문자열. */
  note?: string
}

const SKIP_TAGS = new Set(['STYLE', 'SCRIPT', 'NOSCRIPT', 'TEMPLATE', 'TITLE'])

/** 번역 대상 텍스트 노드만 순서대로 수집. 한글이 없는 조각(숫자·영문 라벨 등)은 건너뛴다. */
function collectNodes(doc: Document): Text[] {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement
      if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT
      const t = node.nodeValue ?? ''
      // 한글이 없으면 번역할 게 없다 — 토큰도 아끼고 "CONTENTS" 같은 라벨도 그대로 지킨다.
      return t.trim() && /[가-힣]/.test(t) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })
  const out: Text[] = []
  let n: Node | null
  while ((n = walker.nextNode())) out.push(n as Text)
  return out
}

/**
 * 원본 CSS 의 모든 `font-family` 선언 뒤에 대체 폰트를 덧붙인다.
 * @font-face 블록의 font-family 는 **얼굴 이름**이라 건드리면 안 되므로 먼저 들어낸 뒤 복원한다.
 */
function appendFontFallback(css: string, fallback: string): string {
  const faces: string[] = []
  const masked = css.replace(/@font-face\s*\{[^}]*\}/g, (m) => {
    faces.push(m)
    return `@__FACE${faces.length - 1}__`
  })
  const patched = masked.replace(/font-family\s*:\s*([^;}]+)/g, (_m, value: string) => {
    const v = value.trim().replace(/\s*!important$/, '')
    const important = /!important\s*$/.test(value) ? ' !important' : ''
    return `font-family: ${v}, ${fallback}${important}`
  })
  return patched.replace(/@__FACE(\d+)__/g, (_m, i: string) => faces[Number(i)])
}

/** 언어별 문서 후처리: lang 속성 + 폰트 폴백 주입. */
function localizeDocument(doc: Document, lang: EbookLang): void {
  doc.documentElement.setAttribute('lang', lang)
  const fallback = FONT_FALLBACK[lang]
  if (!fallback) return
  for (const style of Array.from(doc.querySelectorAll('style'))) {
    style.textContent = appendFontFallback(style.textContent ?? '', fallback)
  }
}

function serialize(doc: Document): string {
  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`
}

/** 자동 축소 하한. 이보다 더 줄여야 하는 페이지는 원문 조판 자체가 감당 못 하는 분량이라 사람이 봐야 한다. */
const MIN_ZOOM = 0.82
/** 축소 → 재배치 → 재측정 반복 횟수. 줄이면 줄바꿈이 바뀌어 높이가 선형으로 줄지 않아 한 번으론 안 맞는다. */
const FIT_ROUNDS = 5

/**
 * 언어별 HTML 을 숨김 iframe 에 띄워 **넘친 페이지를 그 자리에서 맞춰 넣는다**(검사만 하지 않는다).
 *
 * 맞추는 법: `.page` 에 `zoom:z` 를 주고 width/height 를 1/z 로 키운다.
 *   → 렌더 크기(210×297mm)는 그대로인데 내부 레이아웃 공간만 넓어져 글이 다 들어간다.
 *     구조를 건드리지 않아 어떤 책에도 안전하고, z 가 0.95 수준이면 눈에 띄지 않는다.
 *
 * 넘침 판정은 **텍스트를 직접 품은 요소**의 최하단으로 한다
 * (`.frame`·`.inner` 처럼 height:100% 인 구조 요소는 항상 바닥에 닿으므로 세면 안 된다).
 *
 * @returns 맞춘 결과 HTML · 축소한 페이지 번호 · 하한까지 줄여도 안 들어간 페이지 번호
 */
async function fitToPages(html: string): Promise<{ html: string; fitted: number[]; remaining: number[] }> {
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-same-origin') // 책 스크립트 실행 금지(관리자 세션 보호)
  frame.style.cssText = 'position:fixed;left:-99999px;top:0;width:794px;height:1123px;border:0;pointer-events:none'
  document.body.appendChild(frame)
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('페이지 맞춤 시간 초과')), 30000)
      frame.onload = () => { clearTimeout(timer); resolve() }
      frame.onerror = () => { clearTimeout(timer); reject(new Error('페이지 맞춤용 렌더 실패')) }
      frame.srcdoc = html
    })
    const doc = frame.contentDocument
    const win = frame.contentWindow
    if (!doc || !win) return { html, fitted: [], remaining: [] }
    try { await doc.fonts?.ready } catch { /* 폰트 API 없으면 아래 rAF 대기로 갈음 */ }
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

    const pages = Array.from(doc.querySelectorAll<HTMLElement>('.page'))
    if (!pages.length) return { html, fitted: [], remaining: [] }

    const hasOwnText = (el: Element): boolean =>
      Array.from(el.childNodes).some((c) => c.nodeType === 3 && (c.nodeValue ?? '').trim())

    /**
     * 글이 실제로 끝나는 지점 ÷ 쓸 수 있는 바닥까지의 높이. 1을 넘으면 잘리거나 겹친다.
     *
     * ⚠️ '쓸 수 있는 바닥'은 페이지 바닥이 아니다 — 쪽번호·러닝풋처럼 하단에 붙박이(absolute)로
     *    놓인 요소는 글이 밀어내지 못하고 **그 위로 겹쳐진다**. 잘리진 않아 바닥 기준으로는
     *    통과해버리므로(실제로 그렇게 새어나갔다), 붙박이의 윗변을 바닥으로 삼는다.
     */
    const fillRatio = (pg: HTMLElement): number => {
      const pr = pg.getBoundingClientRect()
      // 붙박이 = absolute/fixed · 내용 있음 · 페이지 하단 30% 에 위치 · 페이지의 1/4 미만 높이.
      //   마지막 조건이 없으면 본문을 통째로 감싼 absolute 컨테이너까지 붙박이로 오인한다.
      const furniture: HTMLElement[] = []
      for (const el of Array.from(pg.querySelectorAll<HTMLElement>('*'))) {
        const pos = win.getComputedStyle(el).position
        if (pos !== 'absolute' && pos !== 'fixed') continue
        const r = el.getBoundingClientRect()
        if (!r.height || r.height > pr.height * 0.25) continue
        if (r.top < pr.top + pr.height * 0.7) continue
        if (!(el.textContent ?? '').trim()) continue
        furniture.push(el)
      }
      const limit = furniture.reduce((m, el) => Math.min(m, el.getBoundingClientRect().top), pr.bottom)

      let bottom = pr.top
      for (const el of Array.from(pg.querySelectorAll<HTMLElement>('*'))) {
        if (!hasOwnText(el)) continue
        if (furniture.some((f) => f === el || f.contains(el))) continue // 붙박이 자신은 흐름이 아니다
        const r = el.getBoundingClientRect()
        if (r.height > 0 && r.bottom > bottom) bottom = r.bottom
      }
      const usable = limit - pr.top
      return usable > 0 ? (bottom - pr.top) / usable : 1
    }

    // 페이지별 누적 축소율. 원래 크기는 첫 회차에 재둔다(축소 후엔 width/height 를 우리가 덮어쓰므로).
    const zoom = new Map<number, number>()
    const baseSize = new Map<number, { w: number; h: number }>()
    const fitted = new Set<number>()
    let remaining: number[] = []

    for (let round = 0; round < FIT_ROUNDS; round++) {
      remaining = []
      let changed = false
      pages.forEach((pg, i) => {
        const ratio = fillRatio(pg)
        if (ratio <= 1.001) return
        if (!baseSize.has(i)) {
          const r = pg.getBoundingClientRect()
          baseSize.set(i, { w: r.width, h: r.height })
        }
        const cur = zoom.get(i) ?? 1
        // 1% 여유를 두고 줄인다. 줄바꿈이 바뀌며 다시 넘칠 수 있어 다음 회차에서 또 조인다.
        const next = Math.max(MIN_ZOOM, cur / (ratio * 1.01))
        if (next >= cur - 0.0005) { remaining.push(i + 1); return } // 하한 도달 — 더는 못 줄인다
        zoom.set(i, next)
        fitted.add(i + 1)
        const base = baseSize.get(i)!
        pg.style.width = `${base.w / next}px`
        pg.style.height = `${base.h / next}px`
        pg.style.zoom = String(next)
        changed = true
      })
      if (!changed) break
      // 축소 반영 후 재배치 대기
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    }

    // 맞춘 상태 그대로 직렬화 — 인라인 style 이 DOM 에 이미 들어가 있다.
    return {
      html: `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`,
      fitted: [...fitted].sort((a, b) => a - b),
      remaining: remaining.sort((a, b) => a - b),
    }
  } finally {
    frame.remove()
  }
}

/**
 * 조각 배열 → 조각별 다국어 번역. 실패분은 사다리(SPLIT_STEPS)를 타고 더 작은 묶음으로 다시 돈다.
 *
 * 함수는 조각 단위로 성공/실패를 돌려준다({tr} 또는 {error}) — 성공분만 채우고,
 * 아직 빈 자리를 다음 단계에서 다시 묻는다. 마지막 단계까지 못 채운 자리는 null(원문 유지).
 *
 * @returns 길이 = texts.length. 각 칸 = { en:'…', ja:'…' } 또는 null(실패)
 */
async function translateTexts(
  texts: string[],
  langs: readonly EbookLang[],
  context: string,
  onProgress?: (done: number, total: number, note: string) => void,
): Promise<(Record<string, string> | null)[]> {
  const out: (Record<string, string> | null)[] = new Array(texts.length).fill(null)
  const filled = () => out.reduce((n, t) => (t ? n + 1 : n), 0)

  // 배치 하나(인덱스 묶음) 처리. 실패해도 던지지 않는다 — 빈 자리는 다음 단계가 가져간다.
  //   (예외: 일일 한도는 더 돌려도 소용없으니 위로 던져 사다리를 끝낸다)
  async function handle(idxs: number[]): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      await takeSlots(Math.ceil(idxs.length / GROUP_SIZE)) // 이 요청이 쓸 Gemini 호출 수만큼 슬롯 확보
      try {
        const res = await callFunction<{
          results: ({ tr: Record<string, string> } | { error: string })[]
        }>('translate-ebook', { texts: idxs.map((i) => texts[i]), langs, context })
        res.results?.forEach((r, k) => {
          if ('tr' in r) out[idxs[k]] = r.tr
        })
        return
      } catch (e) {
        // ⚠️ 일일 한도는 함수가 429 + {error:'quota_daily'} 로 준다 → callFunction 이 그 문자열을
        //    그대로 메시지로 삼아 던진다(부분 결과는 이때 버려진다).
        const msg = e instanceof Error ? e.message : String(e)
        if (/quota_daily|일일한도/.test(msg)) {
          throw new DailyQuotaError('Gemini 일일 한도를 다 썼습니다. 내일 다시 시도해 주세요.')
        }
        if (attempt >= 1) return // 네트워크·서버 오류는 1회만 재시도, 나머지는 다음 단계로 넘긴다
        await new Promise((r) => setTimeout(r, 1500))
      }
    }
  }

  for (const size of SPLIT_STEPS) {
    const todo: number[] = []
    for (let i = 0; i < texts.length; i++) if (!out[i]) todo.push(i)
    if (!todo.length) break
    const note = size === SPLIT_STEPS[0] ? '' : `재시도 ${size}개씩`
    const batches: number[][] = []
    for (let j = 0; j < todo.length; j += size) batches.push(todo.slice(j, j + size))
    let bi = 0
    const worker = async () => {
      while (bi < batches.length) {
        await handle(batches[bi++])
        onProgress?.(filled(), texts.length, note)
      }
    }
    await Promise.all(Array.from({ length: Math.min(POOL, batches.length) }, worker))
  }
  return out
}

/**
 * 본문 HTML → 언어별 HTML.
 * @param html   원문(한국어) 이북 HTML
 * @param title  번역 품질용 문맥(책 제목)
 * @param langs  대상 언어(기본 5개)
 * @param onProgress 진행 상황 콜백
 */
export async function translateEbook(
  html: string,
  meta: EbookMeta,
  langs: readonly EbookLang[] = EBOOK_LANGS,
  onProgress?: (p: TranslateProgress) => void,
): Promise<LangResult[]> {
  const parser = new DOMParser()
  const source = parser.parseFromString(html, 'text/html')
  const nodes = collectNodes(source)
  if (!nodes.length) throw new Error('번역할 한국어 텍스트를 찾지 못했습니다.')
  // 스토어 카드용 메타를 본문 조각 **앞**에 붙여 같은 호출로 번역한다(빈 필드는 보내지 않는다).
  const metaKeys = (['title', 'author', 'description'] as const).filter((k) => meta[k].trim())
  const texts = [...metaKeys.map((k) => meta[k].trim()), ...nodes.map((n) => (n.nodeValue ?? '').trim())]
  const bodyOffset = metaKeys.length
  onProgress?.({ phase: 'extract', done: texts.length, total: texts.length })

  // ── 번역: 사다리(120 → 12 → 4)로 실패분만 다시 돈다. 끝까지 못 채운 조각은 원문 유지 ──
  const translated = await translateTexts(texts, langs, meta.title, (done, total, note) =>
    onProgress?.({ phase: 'translate', done, total, note }),
  )

  // ── 언어별 문서 생성 ──
  const out: LangResult[] = []
  for (const lang of langs) {
    onProgress?.({ phase: 'build', done: out.length, total: langs.length, lang })
    const doc = source.cloneNode(true) as Document
    const clonedNodes = collectNodes(doc)
    // 같은 문서를 같은 규칙으로 훑으므로 순서·개수가 일치해야 한다. 어긋나면 잘못 꽂느니 멈춘다.
    if (clonedNodes.length !== nodes.length) throw new Error('문서 복제 중 텍스트 노드 수가 어긋났습니다.')
    let failed = 0
    clonedNodes.forEach((node, i) => {
      const tr = translated[bodyOffset + i]?.[lang]
      if (!tr) { failed++; return } // 번역 실패 조각은 원문(한국어) 유지
      // 원문의 앞뒤 공백을 지켜야 인접 인라인 요소 사이가 붙지 않는다.
      const raw = node.nodeValue ?? ''
      const lead = raw.match(/^\s*/)?.[0] ?? ''
      const trail = raw.match(/\s*$/)?.[0] ?? ''
      node.nodeValue = `${lead}${tr}${trail}`
    })
    localizeDocument(doc, lang)
    let langHtml = serialize(doc)

    // 메타는 실패 시 원문 유지(스토어 카드가 비지 않게).
    const metaOf = (key: (typeof metaKeys)[number]): string => {
      const idx = metaKeys.indexOf(key)
      return (idx >= 0 ? translated[idx]?.[lang] : '') || meta[key]
    }
    const langMeta: EbookMeta = {
      title: metaOf('title'),
      author: metaOf('author'),
      description: metaOf('description'),
    }

    onProgress?.({ phase: 'fit', done: out.length, total: langs.length, lang })
    let fittedPages: number[] = []
    let overflowPages: number[] = []
    try {
      const fit = await fitToPages(langHtml)
      langHtml = fit.html
      fittedPages = fit.fitted
      overflowPages = fit.remaining
    } catch {
      // 맞춤 실패는 번역 자체를 막지 않는다(원문 조판 그대로 저장된다).
    }
    out.push({ lang, html: langHtml, meta: langMeta, failed, fittedPages, overflowPages })
  }
  return out
}
