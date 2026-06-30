import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import type { AdminListResponse, AdminAttemptRow, AdminDetailResponse } from '../lib/types'

const PAGE = 50

function fmtDT(iso?: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return isNaN(d.getTime())
    ? '-'
    : d.toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: '2-digit',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
}

const STATUS_LABEL: Record<string, string> = {
  in_progress: '응시 중',
  submitted: '제출 완료',
  voided: '무효',
  expired: '만료',
}

function csvCell(v: unknown): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default function Admin() {
  const { isFullUser, loginWithGoogle } = useAuth()
  const [state, setState] = useState<'checking' | 'denied' | 'ok'>('checking')
  const [rows, setRows] = useState<AdminAttemptRow[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [detail, setDetail] = useState<AdminDetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    if (!isFullUser) {
      setState('checking')
      return
    }
    callFunction('admin', { action: 'me' })
      .then(() => setState('ok'))
      .catch(() => setState('denied'))
  }, [isFullUser])

  const load = useCallback(async (off: number) => {
    setLoading(true)
    setErr('')
    try {
      const res = await callFunction<AdminListResponse>('admin', {
        action: 'list',
        limit: PAGE,
        offset: off,
      })
      setRows(res.attempts)
      setTotal(res.total)
      setOffset(off)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '목록을 불러올 수 없습니다.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (state === 'ok') load(0)
  }, [state, load])

  async function openDetail(id: string) {
    setDetailLoading(true)
    try {
      setDetail(await callFunction<AdminDetailResponse>('admin', { action: 'detail', attemptId: id }))
    } catch (e) {
      alert(e instanceof Error ? e.message : '상세를 불러올 수 없습니다.')
    } finally {
      setDetailLoading(false)
    }
  }

  function exportCsv() {
    const head = ['제출일시', '시험', '응시자', '이메일', '상태', '점수', '총문항', '결과공개']
    const lines = rows.map((r) =>
      [
        fmtDT(r.submittedAt),
        r.examTitle,
        r.userName ?? '',
        r.userEmail ?? '',
        STATUS_LABEL[r.status] ?? r.status,
        r.totalCorrect ?? '',
        r.totalQuestions ?? '',
        fmtDT(r.resultReleaseAt),
      ]
        .map(csvCell)
        .join(','),
    )
    const csv = '﻿' + [head.join(','), ...lines].join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'gara-cbt-submissions.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // ── 게이트 ──
  if (!isFullUser) {
    return (
      <div className="wrap">
        <div className="exam-card" style={{ textAlign: 'center', maxWidth: 420, margin: '40px auto' }}>
          <h2 className="exam-title">관리자 로그인</h2>
          <p className="exam-sub">관리자 계정으로 로그인해 주세요.</p>
          <button className="exam-btn" style={{ marginTop: 16 }} onClick={() => loginWithGoogle()}>
            구글로 로그인
          </button>
        </div>
      </div>
    )
  }
  if (state === 'checking') {
    return (
      <div className="wrap">
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>확인 중…</div>
      </div>
    )
  }
  if (state === 'denied') {
    return (
      <div className="wrap">
        <div className="exam-card" style={{ textAlign: 'center', maxWidth: 420, margin: '40px auto' }}>
          <div className="exam-ico">🔒</div>
          <h2 className="exam-title">접근 권한이 없습니다</h2>
          <p className="exam-sub">관리자 전용 페이지입니다.</p>
        </div>
      </div>
    )
  }

  const pageNo = Math.floor(offset / PAGE) + 1
  const pageMax = Math.max(1, Math.ceil(total / PAGE))

  return (
    <div className="wrap admin-cbt">
      <div className="admin-head">
        <h1>제출 답안 관리</h1>
        <div className="admin-head-actions">
          <span className="admin-count">총 {total}건</span>
          <button className="exam-btn-ghost sm" onClick={() => load(offset)} disabled={loading}>
            새로고침
          </button>
          <button className="exam-btn-ghost sm" onClick={exportCsv} disabled={!rows.length}>
            CSV 내보내기
          </button>
        </div>
      </div>

      {err && <div className="admin-section admin-empty">불러오기 실패 — {err}</div>}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>제출일시</th>
              <th>시험</th>
              <th>응시자</th>
              <th>상태</th>
              <th>점수</th>
              <th>결과 공개</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.attemptId}>
                <td>{fmtDT(r.submittedAt)}</td>
                <td>{r.examTitle}</td>
                <td>
                  <div className="admin-user">
                    <b>{r.userName || '-'}</b>
                    <span>{r.userEmail}</span>
                  </div>
                </td>
                <td>
                  <span className={`admin-badge st-${r.status}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
                </td>
                <td>
                  {r.status === 'submitted' && r.totalCorrect != null
                    ? `${r.totalCorrect} / ${r.totalQuestions}`
                    : '-'}
                </td>
                <td>{fmtDT(r.resultReleaseAt)}</td>
                <td>
                  <button className="exam-btn-ghost sm" onClick={() => openDetail(r.attemptId)}>
                    상세
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                  제출된 답안이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="admin-pager">
        <button className="exam-btn-ghost sm" disabled={offset === 0 || loading} onClick={() => load(Math.max(0, offset - PAGE))}>
          ‹ 이전
        </button>
        <span>
          {pageNo} / {pageMax}
        </span>
        <button
          className="exam-btn-ghost sm"
          disabled={offset + PAGE >= total || loading}
          onClick={() => load(offset + PAGE)}
        >
          다음 ›
        </button>
      </div>

      {(detail || detailLoading) && (
        <div className="admin-modal-bg" onClick={() => setDetail(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <button className="admin-modal-x" onClick={() => setDetail(null)}>
              ✕
            </button>
            {detailLoading || !detail ? (
              <div style={{ padding: 40, textAlign: 'center' }}>불러오는 중…</div>
            ) : (
              <>
                <h2>
                  {detail.attempt.userName || '-'} <span className="admin-modal-email">{detail.attempt.userEmail}</span>
                </h2>
                <p className="admin-modal-meta">
                  {detail.attempt.examTitle} · 제출 {fmtDT(detail.attempt.submittedAt)} ·{' '}
                  {detail.attempt.totalCorrect != null
                    ? `${detail.attempt.totalCorrect}/${detail.attempt.totalQuestions}점`
                    : '미채점'}
                </p>
                <div className="admin-ans-list">
                  {detail.answers.map((a) => (
                    <div key={a.number} className={`admin-ans ${a.isCorrect ? 'ok' : 'no'}`}>
                      <span className="admin-ans-no">{a.number}</span>
                      <span className="admin-ans-q">{a.prompt}</span>
                      <span className="admin-ans-pick">
                        {a.selectedIndex === null ? '미응답' : `${a.selectedIndex + 1}번`}
                        {' / 정답 '}
                        {a.correctIndex + 1}번
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
