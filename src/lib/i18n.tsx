import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

import KO from './dict/ko'

export type Lang = 'ko' | 'en' | 'ja' | 'zh' | 'hi' | 'vi'
export const LANGS: { code: Lang; label: string }[] = [
  { code: 'ko', label: '한국어' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'zh', label: '中文' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'vi', label: 'Tiếng Việt' },
]

/* ─────────────────────────────────────────────────────────────────────────────
 * 사전은 **언어별 파일**이다 — src/lib/dict/<lang>.ts (2026-08-14)
 *
 * 예전엔 이 파일 안에 `D: Record<key, Record<Lang, string>>` 로 키 1,568개 × 6개국어가
 * 통째로 있었다(490KB). i18n 은 최상위 프로바이더라 **모든 화면이 무조건** 이걸 받아서
 * 파싱했고, 첫 진입 JS 의 절반 가까이가 아무도 안 읽는 5개 언어였다.
 *
 * 지금은 한국어만 정적으로 싣고(기본 언어이자 폴백) 나머지는 그 언어를 고른 사람만 받는다.
 *
 * ⚠️ `tr()` 은 **동기 함수로 유지해야 한다** — shareCard.ts·caris.ts 처럼 훅을 못 쓰는
 *    계층이 이걸 그대로 부른다. 그래서 사전은 프로바이더가 미리 받아 두고, 조회는 메모리에서만 한다.
 * ⚠️ 언어를 바꿀 때는 **사전을 받은 뒤에** lang 을 바꾼다(setLang 참고). 먼저 바꾸면
 *    사전이 도착하기 전 한 프레임이 한국어로 그려져 화면이 번쩍인다.
 * ⚠️ 6개 파일의 키 집합은 같아야 한다. 문구를 추가하면 6개 다 채울 것(예전 규칙 그대로).
 * ───────────────────────────────────────────────────────────────────────────── */

type Dict = Record<string, string>

const LOADERS: Record<Exclude<Lang, 'ko'>, () => Promise<{ default: Dict }>> = {
  en: () => import('./dict/en'),
  ja: () => import('./dict/ja'),
  zh: () => import('./dict/zh'),
  hi: () => import('./dict/hi'),
  vi: () => import('./dict/vi'),
}

const LOADED: Partial<Record<Lang, Dict>> = { ko: KO }

/** 그 언어 사전이 이미 메모리에 있나. */
// eslint-disable-next-line react-refresh/only-export-components
export function dictReady(lang: Lang): boolean {
  return !!LOADED[lang]
}

/** 사전을 받아온다(이미 있으면 즉시 끝난다). */
// eslint-disable-next-line react-refresh/only-export-components
export async function loadDict(lang: Lang): Promise<void> {
  if (LOADED[lang]) return
  const mod = await LOADERS[lang as Exclude<Lang, 'ko'>]()
  LOADED[lang] = mod.default
}

/** 사전에 있는 키인가.
 *  regionCatalog 가 "지도 파일의 이름 대신 사전 이름을 쓸지" 고를 때만 쓴다 —
 *  키 존재 여부는 언어와 무관하므로 한국어 사전 하나로 판단한다. */
// eslint-disable-next-line react-refresh/only-export-components
export function hasKey(key: string): boolean {
  return key in KO
}

// 비-훅 번역기 — caris.ts·shareCard.ts 등 훅을 못 쓰는 lib 계층이 lang 을 넘겨 부른다. t() 도 이걸 재사용.
// eslint-disable-next-line react-refresh/only-export-components
export function tr(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  // 사전이 아직 없는 언어면 한국어로 읽는다(프로바이더가 받아오는 중인 아주 짧은 구간).
  const d = LOADED[lang] ?? KO
  let s = d[key] ?? KO[key] ?? key
  if (vars) {
    for (const k of Object.keys(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(vars[k]))
    }
  }
  return s
}

/** 우리 언어코드 → BCP-47. Intl(날짜·시각·숫자) 에 넘길 때 쓴다.
 *  ⚠️ 'ko-KR' 을 코드에 직접 박으면 화면 언어를 바꿔도 날짜만 한국어로 남는다(/daily 헤더가 실제로 그랬다).
 *  (src/lib/rounds.ts 에도 같은 표가 사본으로 있다 — 그쪽을 손볼 일이 생기면 이걸 쓰도록 합칠 것.) */
// eslint-disable-next-line react-refresh/only-export-components
export function localeOf(lang: Lang): string {
  return { ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN', hi: 'hi-IN', vi: 'vi-VN' }[lang] ?? 'en-US'
}

export type TFunc = (key: string, vars?: Record<string, string | number>) => string

interface I18nState {
  lang: Lang
  setLang: (l: Lang) => void
  t: TFunc
}

const Ctx = createContext<I18nState | undefined>(undefined)

function detect(): Lang {
  // URL ?lang= 우선 — 보안 브라우저(SEB)는 새 프로필이라 저장값이 없으므로,
  // 응시 진입 URL에 실어 보낸 언어로 SEB 안에서도 동일 언어가 적용된다.
  // ⚠️ 값 뒤를 잘라내는 이유 — SEB 가 로그인 인계표를 startURL 뒤에 붙일 때 '?' 를 쓰면
  //    `?lang=ko?h=<표>` 가 돼서 표준 파서는 lang 을 "ko?h=…" 로 읽는다. 그러면 언어가 통째로 폴백된다.
  //    첫 '?'·'&' 앞까지만 보면 SEB 가 어느 쪽으로 붙이든 언어가 살아남는다(src/lib/examToken.ts 와 같은 방어).
  try {
    const raw = new URLSearchParams(window.location.search).get('lang')
    const q = (raw ? raw.split(/[?&]/)[0] : null) as Lang | null
    if (q && LANGS.some((l) => l.code === q)) {
      localStorage.setItem('lang', q)
      return q
    }
  } catch {
    /* noop */
  }
  const saved = localStorage.getItem('lang') as Lang | null
  if (saved && LANGS.some((l) => l.code === saved)) return saved
  const n = (navigator.language || 'en').toLowerCase()
  if (n.startsWith('ko')) return 'ko'
  if (n.startsWith('ja')) return 'ja'
  if (n.startsWith('zh')) return 'zh'
  if (n.startsWith('hi')) return 'hi'
  if (n.startsWith('vi')) return 'vi'
  return 'en'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  // 지연 초기화 — 첫 렌더부터 감지된 언어로 시작(마운트 후 교체 시
  // 데이터 페이지들이 ko→실제 언어로 이중 fetch 하던 문제 방지)
  const [lang, setLangState] = useState<Lang>(() => detect())
  // 한국어는 정적이라 항상 true. 외국어로 처음 들어온 사람만 사전을 기다린다.
  const [ready, setReady] = useState(() => dictReady(lang))

  useEffect(() => {
    if (ready) return
    let alive = true
    loadDict(lang).then(() => { if (alive) setReady(true) })
    return () => { alive = false }
  }, [lang, ready])

  function setLang(l: Lang) {
    localStorage.setItem('lang', l)
    document.documentElement.lang = l
    // ⚠️ 사전을 받은 **뒤에** 바꾼다 — 먼저 바꾸면 사전이 도착하기 전 한 프레임이 한국어로 그려진다.
    //    (여기서 화면을 통째로 언마운트하면 열려 있던 페이지 상태·조회 결과가 다 날아간다.)
    void loadDict(l).then(() => setLangState(l))
  }

  const t: TFunc = (key, vars) => tr(lang, key, vars)

  // 사전이 오기 전 한 프레임을 한국어로 그리지 않는다. 한국어 사용자는 이 경로를 타지 않는다.
  if (!ready) return null

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useT(): I18nState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useT must be used within I18nProvider')
  return ctx
}
