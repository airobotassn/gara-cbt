// 관리자 폼 임시저장 — 브라우저에만 남긴다(2026-08-11).
//
// 왜 필요한가: 관리자 폼은 저장 전까지 아무 데도 안 남는다. 창을 잘못 닫거나 브라우저가 죽으면
//   약관 본문·문항·공지처럼 오래 쓴 것이 통째로 사라진다(되돌릴 방법이 없다).
//
// ⚠️ **서버에 저장하지 않는다**(사용자 결정 2026-08-11). 관리자가 늘 같은 자리에서 작업하므로
//    다른 PC 이어쓰기가 필요 없고, 서버가 끊긴 상황에서 서버 저장은 애초에 실패한다 —
//    지금 막으려는 사고가 정확히 그 경우라 로컬이 더 맞다.
// ⚠️ 초안 하나당 키 하나다. 통짜 맵으로 두면 글자를 칠 때마다 남의 초안까지 통째로 다시 쓴다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const PREFIX = 'gara_draft_v1:'
/** 오래된 초안은 목록만 어지럽힌다 — 30일 지나면 알아서 지운다. */
const TTL_MS = 30 * 86400_000
/** 타이핑이 멈추고 이만큼 지나면 저장. 짧으면 매 글자마다 쓰고, 길면 사고 직전 몇 초를 잃는다. */
const DEBOUNCE_MS = 800

export interface DraftMeta {
  key: string
  kind: string
  refId: string
  title: string
  savedAt: number
}
interface Stored<T> { title: string; savedAt: number; payload: T }

const keyOf = (kind: string, refId?: string | null) => `${PREFIX}${kind}:${refId || 'new'}`

function readRaw<T>(key: string): Stored<T> | null {
  try {
    const s = localStorage.getItem(key)
    if (!s) return null
    const v = JSON.parse(s) as Stored<T>
    if (!v || typeof v.savedAt !== 'number') return null
    if (Date.now() - v.savedAt > TTL_MS) { localStorage.removeItem(key); return null }
    return v
  } catch { return null }
}

/** 이 종류의 초안 목록(최신순). 만료된 것은 읽으면서 정리된다. */
export function listDrafts(kind: string): DraftMeta[] {
  const out: DraftMeta[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(`${PREFIX}${kind}:`)) continue
      const v = readRaw<unknown>(key)
      if (!v) continue
      out.push({ key, kind, refId: key.slice(`${PREFIX}${kind}:`.length), title: v.title, savedAt: v.savedAt })
    }
  } catch { /* localStorage 못 쓰면 초안 기능만 조용히 없어진다 */ }
  return out.sort((a, b) => b.savedAt - a.savedAt)
}

export function loadDraft<T>(key: string): T | null {
  return readRaw<T>(key)?.payload ?? null
}
export function removeDraft(key: string) {
  try { localStorage.removeItem(key) } catch { /* noop */ }
}

export type DraftStatus = 'idle' | 'saving' | 'saved'

/**
 * 폼 상태를 자동으로 임시저장한다.
 * @param kind  폼 종류('notice' · 'policy:terms' · 'cbt-question' …). 목록이 이 단위로 갈린다.
 * @param refId 수정 중인 대상 id. 새로 쓰는 중이면 비운다.
 * @param value 지금 폼 상태(그대로 JSON 으로 저장된다).
 * @param title 목록에 보일 이름.
 * @param enabled 폼이 열려 있을 때만 true — 닫힌 폼이 빈 값을 덮어쓰면 안 된다.
 */
export function useDraft<T>({ kind, refId, value, title, enabled = true }: {
  kind: string; refId?: string | null; value: T; title: string; enabled?: boolean
}) {
  const key = useMemo(() => keyOf(kind, refId), [kind, refId])
  const [status, setStatus] = useState<DraftStatus>('idle')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [drafts, setDrafts] = useState<DraftMeta[]>([])
  // 열린 직후의 값 — 이것과 같으면 "안 건드린 것"이라 저장하지 않는다(빈 초안이 목록에 쌓이는 걸 막는다).
  //   ⚠️ ref 가 아니라 state 다. 렌더 중에 ref 를 읽으면 값이 바뀌어도 화면이 안 따라온다
  //      (`임시저장됨` 표시가 한 박자 늦거나 아예 안 뜬다).
  const [baseline, setBaseline] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  const refresh = useCallback(() => setDrafts(listDrafts(kind)), [kind])
  useEffect(() => { refresh() }, [refresh])

  // 폼이 열릴 때 기준값을 잡는다. refId 가 바뀌면(다른 항목 편집) 다시 잡는다.
  useEffect(() => {
    if (!enabled) { setBaseline(null); setStatus('idle'); setSavedAt(null); return }
    setBaseline(JSON.stringify(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key])

  const serialized = JSON.stringify(value)
  const dirty = enabled && baseline != null && serialized !== baseline

  useEffect(() => {
    if (!dirty) return
    setStatus('saving')
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      try {
        const at = Date.now()
        localStorage.setItem(key, JSON.stringify({ title: title || '제목 없음', savedAt: at, payload: value }))
        setSavedAt(at)
        setStatus('saved')
        refresh()
      } catch {
        // 용량 초과 등 — 저장은 못 했지만 작업은 계속돼야 한다.
        setStatus('idle')
      }
    }, DEBOUNCE_MS)
    return () => { if (timer.current) window.clearTimeout(timer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, dirty, key, title])

  // 실수로 창을 닫는 경우 — 브라우저가 한 번 물어본다.
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  /** 저장에 성공했을 때 부른다 — 초안은 더 이상 필요 없다. */
  const clear = useCallback(() => {
    removeDraft(key)
    setBaseline(serialized) // 저장된 값이 새 기준 — 바로 다시 '수정됨'으로 잡히면 안 된다
    setStatus('idle')
    setSavedAt(null)
    refresh()
  }, [key, refresh, serialized])

  return { status, savedAt, dirty, drafts, refresh, clear, removeDraft, loadDraft }
}

/** "방금 · 3분 전" 같은 표기. 초안 저장 시각은 정확한 시각보다 '얼마나 됐나'가 중요하다. */
export function agoText(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 10) return '방금'
  if (s < 60) return `${s}초 전`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}분 전`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}시간 전`
  return `${Math.round(h / 24)}일 전`
}
