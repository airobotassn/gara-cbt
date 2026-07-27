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

/** HTTP 요청당 조각 수 — 함수의 MAX_TEXTS 와 맞출 것. */
const CHUNK = 120

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
  /** 넘쳐서 잘린 페이지 번호(1부터). 조판이 `.page` 가 아니면 빈 배열 */
  overflowPages: number[]
}

export interface TranslateProgress {
  phase: 'extract' | 'translate' | 'build' | 'check'
  done: number
  total: number
  lang?: EbookLang
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

/**
 * 언어별 HTML 을 숨김 iframe 에 띄워 **잘린 페이지**를 찾는다.
 * 텍스트를 직접 품은 요소의 최하단이 페이지 바닥을 넘으면 그 페이지는 잘린 것.
 * (`.frame`·`.inner` 처럼 height:100% 인 구조 요소는 항상 바닥에 닿으므로 세면 안 된다.)
 */
async function findOverflowPages(html: string): Promise<number[]> {
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-same-origin') // 책 스크립트 실행 금지(관리자 세션 보호)
  frame.style.cssText = 'position:fixed;left:-99999px;top:0;width:794px;height:1123px;border:0;pointer-events:none'
  document.body.appendChild(frame)
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('넘침 검사 시간 초과')), 30000)
      frame.onload = () => { clearTimeout(timer); resolve() }
      frame.onerror = () => { clearTimeout(timer); reject(new Error('넘침 검사용 렌더 실패')) }
      frame.srcdoc = html
    })
    const doc = frame.contentDocument
    if (!doc) return []
    try { await doc.fonts?.ready } catch { /* 폰트 API 없으면 아래 rAF 대기로 갈음 */ }
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

    const out: number[] = []
    const pages = Array.from(doc.querySelectorAll<HTMLElement>('.page'))
    pages.forEach((pg, i) => {
      const pr = pg.getBoundingClientRect()
      let bottom = pr.top
      for (const el of Array.from(pg.querySelectorAll<HTMLElement>('*'))) {
        // 자기 자식으로 직접 텍스트를 가진 요소만 = 실제 글이 끝나는 지점
        const hasText = Array.from(el.childNodes).some((c) => c.nodeType === 3 && (c.nodeValue ?? '').trim())
        if (!hasText) continue
        const r = el.getBoundingClientRect()
        if (r.height > 0 && r.bottom > bottom) bottom = r.bottom
      }
      if (bottom > pr.bottom + 1) out.push(i + 1)
    })
    return out
  } finally {
    frame.remove()
  }
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

  // ── 번역: 청크로 나눠 순차 호출(부분 실패는 인덱스별로 원문 유지) ──
  const translated: (Record<string, string> | null)[] = new Array(texts.length).fill(null)
  for (let i = 0; i < texts.length; i += CHUNK) {
    const slice = texts.slice(i, i + CHUNK)
    const res = await callFunction<{
      results: ({ tr: Record<string, string> } | { error: string })[]
      error?: string
    }>('translate-ebook', { texts: slice, langs, context: meta.title })
    res.results?.forEach((r, k) => {
      if ('tr' in r) translated[i + k] = r.tr
    })
    onProgress?.({ phase: 'translate', done: Math.min(i + CHUNK, texts.length), total: texts.length })
    if (res.error === 'quota_daily') throw new Error('Gemini 일일 한도를 다 썼습니다. 내일 다시 시도해 주세요.')
  }

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
    const langHtml = serialize(doc)

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

    onProgress?.({ phase: 'check', done: out.length, total: langs.length, lang })
    let overflowPages: number[] = []
    try {
      overflowPages = await findOverflowPages(langHtml)
    } catch {
      // 넘침 검사 실패는 번역 자체를 막지 않는다(검사는 보조 정보).
    }
    out.push({ lang, html: langHtml, meta: langMeta, failed, overflowPages })
  }
  return out
}
