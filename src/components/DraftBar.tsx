// 임시저장 표시 + 불러오기 — 티스토리 글쓰기와 같은 감각.
//
//   [ 임시저장됨 · 방금 ]            [ 임시저장 3 ▾ ]
//
// ⚠️ 배너로 "이어서 하시겠어요?" 를 들이밀지 않는다(옛 번역 화면 방식). 그 방식은
//    ① 저장이 되고 있는지 알 수 없고 ② 불러오기가 한 번뿐이라 놓치면 끝이었다.
//    상태는 늘 보이고, 불러오기는 사용자가 원할 때 목록에서 고른다.
import { useEffect, useRef, useState } from 'react'
import { agoText, removeDraft, loadDraft, type DraftMeta, type DraftStatus } from '../lib/adminDraft'

export default function DraftBar<T>({ status, savedAt, drafts, onRestore, onRefresh, currentKey }: {
  status: DraftStatus
  savedAt: number | null
  drafts: DraftMeta[]
  /** 고른 초안의 내용을 폼에 부어 넣는다. */
  onRestore: (payload: T, meta: DraftMeta) => void
  onRefresh: () => void
  /** 지금 편집 중인 초안 키 — 목록에서 '지금 쓰는 중'으로 표시한다. */
  currentKey?: string
}) {
  const [open, setOpen] = useState(false)
  const [, tick] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  // '방금 → 1분 전' 이 저절로 바뀌게. 저장 시각이 멈춰 있으면 저장이 멈춘 줄 안다.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 20_000)
    return () => clearInterval(t)
  }, [])
  // 목록 밖을 누르면 접는다.
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const label =
    status === 'saving' ? '저장 중…'
      : status === 'saved' && savedAt ? `임시저장됨 · ${agoText(savedAt)}`
        : ''

  return (
    <div ref={boxRef} style={{ display: 'inline-flex', alignItems: 'center', gap: 10, position: 'relative' }}>
      <span style={{ fontSize: 'var(--fs-sm)', color: status === 'saving' ? 'var(--muted)' : 'var(--blue)', minWidth: 110, textAlign: 'right' }}>
        {label}
      </span>
      <button className="admin-mini" onClick={() => { onRefresh(); setOpen((v) => !v) }} disabled={!drafts.length}>
        임시저장 {drafts.length}
      </button>
      {open && drafts.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 30,
          width: 320, maxHeight: 320, overflowY: 'auto',
          background: 'var(--bg)', border: '1px solid var(--line2)', borderRadius: 12,
          boxShadow: '0 16px 40px -16px rgba(0,0,0,.6)',
        }}>
          {drafts.map((d) => {
            const mine = d.key === currentKey
            return (
              <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--line2)' }}>
                <button
                  onClick={() => {
                    const p = loadDraft<T>(d.key)
                    if (p) { onRestore(p, d); setOpen(false) }
                  }}
                  style={{ flex: 1, textAlign: 'left', background: 'none', border: 0, color: 'inherit', cursor: 'pointer', minWidth: 0 }}
                >
                  <div style={{ fontWeight: 700, fontSize: 'var(--fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.title}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--dim)' }}>
                    {agoText(d.savedAt)}{mine ? ' · 지금 쓰는 중' : ''}
                  </div>
                </button>
                <button
                  className="admin-mini"
                  title="이 임시저장 삭제"
                  onClick={() => { removeDraft(d.key); onRefresh() }}
                >✕</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
