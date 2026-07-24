import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import { linkify } from '../lib/linkify'

// 유사채팅(pseudo-chat) 보드 — 로그인 필요(작성), 조회는 공개. /arena 페이지 안의 섹션으로 렌더된다.
// 초기 페이지 → 폴링(신규분 append) + reconcile(수정/삭제 tombstone) + 위로 스크롤 시 이전 페이지(prepend).
// 본문은 항상 React 텍스트 child 로만 렌더(자동 이스케이프) — URL 만 NoticeDetail.linkify 방식으로 링크화.

interface Row {
  id: number
  user_id: string
  display_name: string
  is_anon: boolean
  body: string | null
  mod_status: 'ok' | 'pending' | 'hidden'
  edited_at: string | null
  created_at: string
  updated_at: string
  sending?: boolean
  deleted_at?: string | null
}

interface Tomb {
  id: number
  deleted_at: string | null
  edited_at: string | null
  mod_status: 'ok' | 'pending' | 'hidden'
  updated_at: string
  body: string | null
}

const MAX_LEN = 500
const POLL_MIN_MS = 3500
const POLL_MAX_MS = 4500

// 본문 렌더(URL 링크화 + 자동 이스케이프)는 ../lib/linkify 로 분리(단위 테스트 가능).

const kstTime = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' })
const kstDay = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' })

// chat-post/chat-edit 에러 코드 → i18n 키 매핑(없으면 e.message 그대로 노출)
const ERR_KEYS: Record<string, string> = {
  empty: 'chat.empty',
  too_long: 'chat.blockedLocal',
  blocked_local: 'chat.blockedLocal',
  blocked_link: 'chat.blockedLink',
  blocked_mod: 'chat.blockedMod',
  mod_unavailable: 'chat.modUnavailable',
  too_fast: 'chat.tooFast',
  rate_limited: 'chat.rateLimited',
  ip_floor: 'chat.rateLimited',
  duplicate: 'chat.duplicate',
  edit_window: 'chat.editWindow',
}

export default function ChatBoard() {
  const { t } = useT()
  const { user } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [reportedIds, setReportedIds] = useState<Set<number>>(new Set())
  const [now, setNow] = useState(() => Date.now())

  const listRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef<Row[]>([])
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tempIdRef = useRef(-1)

  rowsRef.current = rows

  function showToast(msg: string) {
    setToast(msg)
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 3000)
  }

  function errMsg(code: string): string {
    const key = ERR_KEYS[code]
    if (!key) return code
    const s = t(key)
    return s === key ? code : s
  }

  // 상대 시간이 흐르도록 30초마다 갱신(방금 전 → N분 전).
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  // 시간 표시: 1분 미만=방금 전, 1시간 미만=N분 전, 당일=오후 3:12, 그 외=날짜+시각.
  function formatTime(iso: string): string {
    const diff = now - new Date(iso).getTime()
    if (diff < 60_000) return t('chat.justNow')
    if (diff < 3_600_000) return t('chat.minutesAgo', { n: String(Math.floor(diff / 60_000)) })
    const d = new Date(iso)
    return kstDay.format(d) === kstDay.format(new Date(now)) ? kstTime.format(d) : `${kstDay.format(d)} ${kstTime.format(d)}`
  }

  // 초기 30건
  useEffect(() => {
    let alive = true
    setLoading(true)
    callFunction<{ messages: Row[] }>('chat-list', { limit: 30 })
      .then((res) => {
        if (!alive) return
        setRows(res.messages)
        setHasMore(res.messages.length >= 30)
        setLoading(false)
        requestAnimationFrame(() => {
          const el = listRef.current
          if (el) el.scrollTop = el.scrollHeight
        })
      })
      .catch(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  // 폴링: 신규분(after) + reconcile(ids+since). 탭 비활성 시 중단, 지터 3.5~4.5s.
  useEffect(() => {
    function schedule() {
      const jitter = POLL_MIN_MS + Math.random() * (POLL_MAX_MS - POLL_MIN_MS)
      pollRef.current = setTimeout(tick, jitter)
    }
    async function tick() {
      if (document.visibilityState === 'hidden') {
        schedule()
        return
      }
      try {
        const current = rowsRef.current.filter((r) => !r.sending)
        const lastId = current.length ? current[current.length - 1].id : undefined
        if (typeof lastId === 'number') {
          const el = listRef.current
          const atBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 80 : true
          const res = await callFunction<{ messages: Row[] }>('chat-list', { after: lastId })
          if (res.messages.length) {
            setRows((prev) => {
              const seen = new Set(prev.map((r) => r.id))
              return [...prev, ...res.messages.filter((r) => !seen.has(r.id))]
            })
            requestAnimationFrame(() => {
              if (atBottom && el) el.scrollTop = el.scrollHeight
            })
          }
        }
        const visible = rowsRef.current.filter((r) => !r.sending).slice(-200)
        if (visible.length) {
          const ids = visible.map((r) => r.id)
          const since = visible.reduce((max, r) => (r.updated_at > max ? r.updated_at : max), '1970-01-01T00:00:00Z')
          const rec = await callFunction<{ tombstones?: Tomb[] }>('chat-list', { ids, since })
          if (rec.tombstones?.length) {
            const byId = new Map(rec.tombstones.map((tm) => [tm.id, tm]))
            setRows((prev) =>
              prev.map((r) => {
                const tm = byId.get(r.id)
                if (!tm) return r
                if (tm.deleted_at != null) {
                  return { ...r, body: null, deleted_at: tm.deleted_at, edited_at: tm.edited_at, mod_status: tm.mod_status, updated_at: tm.updated_at }
                }
                return { ...r, body: tm.body, edited_at: tm.edited_at, mod_status: tm.mod_status, updated_at: tm.updated_at }
              }),
            )
          }
        }
      } catch {
        /* noop — 다음 tick 에 재시도 */
      }
      schedule()
    }
    schedule()
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current)
    }
  }, [])

  // 위로 스크롤 시 이전 페이지 prepend(스크롤 위치 보존)
  const loadOlder = useCallback(async () => {
    if (loadingOlder || loading || !hasMore || rows.length === 0) return
    const oldestId = rows[0].id
    const el = listRef.current
    const prevHeight = el?.scrollHeight ?? 0
    setLoadingOlder(true)
    try {
      const res = await callFunction<{ messages: Row[] }>('chat-list', { before: oldestId, limit: 30 })
      if (res.messages.length) {
        setRows((prev) => {
          const seen = new Set(prev.map((r) => r.id))
          return [...res.messages.filter((r) => !seen.has(r.id)), ...prev]
        })
        setHasMore(res.messages.length >= 30)
        requestAnimationFrame(() => {
          if (el) el.scrollTop = el.scrollHeight - prevHeight
        })
      } else {
        setHasMore(false)
      }
    } catch {
      /* noop */
    }
    setLoadingOlder(false)
  }, [loadingOlder, loading, hasMore, rows])

  function onScroll() {
    const el = listRef.current
    if (el && el.scrollTop < 60) loadOlder()
  }

  async function onSend(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || sending || !user) return
    if (text.length > MAX_LEN) {
      showToast(errMsg('too_long'))
      return
    }
    setSending(true)
    setInput('')
    const tempId = tempIdRef.current--
    const tempRow: Row = {
      id: tempId,
      user_id: user.id,
      display_name: t('chat.sending'),
      is_anon: !!user.is_anonymous,
      body: text,
      mod_status: 'ok',
      edited_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      sending: true,
    }
    const el = listRef.current
    const atBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 80 : true
    setRows((prev) => [...prev, tempRow])
    requestAnimationFrame(() => {
      if (atBottom && el) el.scrollTop = el.scrollHeight
    })
    try {
      const res = await callFunction<{ id: number; created_at: string; updated_at: string; display_name: string; is_anon: boolean; mod_status: 'ok' | 'pending' }>('chat-post', { body: text })
      setRows((prev) => {
        const withoutTemp = prev.filter((r) => r.id !== tempId)
        if (withoutTemp.some((r) => r.id === res.id)) return withoutTemp
        return [
          ...withoutTemp,
          {
            id: res.id,
            user_id: user.id,
            display_name: res.display_name,
            is_anon: res.is_anon,
            body: text,
            mod_status: res.mod_status,
            edited_at: null,
            created_at: res.created_at,
            updated_at: res.updated_at,
          },
        ]
      })
    } catch (e) {
      setRows((prev) => prev.filter((r) => r.id !== tempId))
      setInput(text)
      showToast(errMsg(e instanceof Error ? e.message : 'error'))
    }
    setSending(false)
  }

  async function onReport(id: number) {
    if (reportedIds.has(id)) return
    try {
      await callFunction('chat-report', { message_id: id })
      setReportedIds((prev) => new Set(prev).add(id))
      showToast(t('chat.reported'))
    } catch (e) {
      if (e instanceof Error && e.message === 'duplicate') {
        setReportedIds((prev) => new Set(prev).add(id))
        showToast(t('chat.reported'))
      } else {
        showToast(errMsg(e instanceof Error ? e.message : 'error'))
      }
    }
  }

  function startEdit(row: Row) {
    setEditingId(row.id)
    setEditText(row.body ?? '')
  }

  async function submitEdit(id: number) {
    const text = editText.trim()
    if (!text) return
    try {
      const res = await callFunction<{ ok: true; id: number; edited_at: string; updated_at: string; mod_status: 'ok' | 'pending' }>('chat-edit', { message_id: id, body: text })
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, body: text, edited_at: res.edited_at, updated_at: res.updated_at, mod_status: res.mod_status } : r)))
      setEditingId(null)
    } catch (e) {
      showToast(errMsg(e instanceof Error ? e.message : 'error'))
    }
  }

  async function onDelete(id: number) {
    if (!window.confirm(t('chat.confirmDelete'))) return
    try {
      await callFunction('chat-delete', { message_id: id })
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, body: null, mod_status: 'ok' as const } : r)))
    } catch (e) {
      showToast(errMsg(e instanceof Error ? e.message : 'error'))
    }
  }

  return (
    <div className="chat-panel">
      <div ref={listRef} onScroll={onScroll} className="chat-list">
        {loading && <div className="chat-hint">{t('common.loading')}</div>}
        {!loading && loadingOlder && <div className="chat-hint">{t('common.loading')}</div>}
        {!loading && rows.length === 0 && <div className="chat-hint">{t('chat.empty')}</div>}
        {!loading &&
          rows.map((r) => {
            const own = !!user && r.user_id === user.id
            const deleted = r.body === null
            return (
              <div key={r.id} className={`chat-bubble-row ${own ? 'own' : 'other'}`}>
                <div className="chat-bubble">
                  {!own && (
                    <div className="chat-meta">
                      <span className="chat-name">{r.display_name}</span>
                      {r.is_anon && <span className="chat-anon-badge">{t('chat.anonBadge')}</span>}
                    </div>
                  )}
                  {editingId === r.id ? (
                    <div className="chat-edit-box">
                      <textarea value={editText} onChange={(e) => setEditText(e.target.value)} maxLength={MAX_LEN} rows={2} />
                      <div className="chat-edit-actions">
                        <button type="button" onClick={() => submitEdit(r.id)}>{t('chat.send')}</button>
                        <button type="button" onClick={() => setEditingId(null)}>{t('common.close')}</button>
                      </div>
                    </div>
                  ) : (
                    <div className="chat-body">
                      {deleted ? t('chat.deleted') : linkify(r.body ?? '')}
                      {r.sending && <span className="chat-sending-tag"> · {t('chat.sending')}</span>}
                    </div>
                  )}
                  <div className="chat-footer">
                    <span className="chat-time">{formatTime(r.created_at)}</span>
                    {r.edited_at && !deleted && <span className="chat-edited">· {t('chat.editedMark')}</span>}
                    {!r.sending && !deleted && own && editingId !== r.id && (
                      <>
                        <button type="button" className="chat-action" onClick={() => startEdit(r)}>{t('chat.edit')}</button>
                        <button type="button" className="chat-action" onClick={() => onDelete(r.id)}>{t('chat.delete')}</button>
                      </>
                    )}
                    {!r.sending && !deleted && !own && (
                      <button type="button" className="chat-action" disabled={reportedIds.has(r.id)} onClick={() => onReport(r.id)}>
                        {reportedIds.has(r.id) ? t('chat.reported') : t('chat.report')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
      </div>

      {toast && <div className="chat-toast">{toast}</div>}

      {user ? (
        <form className="chat-composer" onSubmit={onSend}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('chat.placeholder')}
            maxLength={MAX_LEN}
            disabled={sending}
          />
          <button type="submit" disabled={sending || !input.trim()}>
            {sending ? t('chat.sending') : t('chat.send')}
          </button>
        </form>
      ) : (
        <div className="chat-login-cta">
          <span>{t('chat.loginToJoin')}</span>
          <Link to="/login" className="chat-login-btn">{t('common.login_google')}</Link>
        </div>
      )}
    </div>
  )
}
