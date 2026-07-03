import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import type {
  AdminListResponse,
  AdminAttemptRow,
  AdminDetailResponse,
  AdminNoticeListResponse,
  NoticeRow,
  AdminFaqListResponse,
  FaqRow,
  AdminExamRoundListResponse,
  ExamRoundRow,
  AdminExamFeeListResponse,
  I18nText,
} from '../lib/types'
import LevelTestAdmin from './AdminLevelTest'

// 관리자 최상위 = 두 제품 백오피스 탭 분리: CARIS 시험(CBT) / 레벨테스트.
//  - "CARIS 시험" = 기존 CBT 관리(<CarisExamAdmin/>, admin 함수 호출) — 그대로 유지.
//  - "레벨테스트" = 이관된 레벨테스트 관리(<LevelTestAdmin/>, admin-test 함수 호출).
type TopTab = 'caris' | 'level'
export default function Admin() {
  const { isFullUser, loginWithGoogle } = useAuth()
  const [topTab, setTopTab] = useState<TopTab>('caris')

  // 로그인 게이트는 최상위에서 공유(두 탭 공통). 세부 권한은 각 탭이 서버로 확인.
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

  return (
    <>
      <div className="wrap" style={{ paddingBottom: 0 }}>
        <div className="admin-tabs admin-tabs-top" style={{ marginTop: 10 }}>
          <button className={topTab === 'caris' ? 'on' : ''} onClick={() => setTopTab('caris')}>
            CARIS 시험
          </button>
          <button className={topTab === 'level' ? 'on' : ''} onClick={() => setTopTab('level')}>
            레벨테스트
          </button>
        </div>
      </div>
      {topTab === 'caris' ? <CarisExamAdmin /> : <LevelTestAdmin />}
    </>
  )
}

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

// CARIS 시험(CBT) 백오피스 — 제출 답안 조회. (기존 Admin 본문 그대로, admin 함수 호출)
function CarisExamAdmin() {
  const { isFullUser, loginWithGoogle } = useAuth()
  const [state, setState] = useState<'checking' | 'denied' | 'ok'>('checking')
  const [rows, setRows] = useState<AdminAttemptRow[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [detail, setDetail] = useState<AdminDetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [sub, setSub] = useState<'subs' | 'notices' | 'faq' | 'rounds' | 'fees' | 'admins'>('subs')
  const [isRoot, setIsRoot] = useState(false)

  useEffect(() => {
    if (!isFullUser) {
      setState('checking')
      return
    }
    callFunction<{ ok: boolean; isRoot?: boolean }>('admin', { action: 'me' })
      .then((r) => {
        setIsRoot(!!r.isRoot)
        setState('ok')
      })
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
      <div className="admin-tabs" style={{ marginBottom: 18 }}>
        <button className={sub === 'subs' ? 'on' : ''} onClick={() => setSub('subs')}>
          제출 답안
        </button>
        <button className={sub === 'notices' ? 'on' : ''} onClick={() => setSub('notices')}>
          공지사항
        </button>
        <button className={sub === 'faq' ? 'on' : ''} onClick={() => setSub('faq')}>
          FAQ
        </button>
        <button className={sub === 'rounds' ? 'on' : ''} onClick={() => setSub('rounds')}>
          시험일정
        </button>
        <button className={sub === 'fees' ? 'on' : ''} onClick={() => setSub('fees')}>
          응시료
        </button>
        {isRoot && (
          <button className={sub === 'admins' ? 'on' : ''} onClick={() => setSub('admins')}>
            관리자 관리
          </button>
        )}
      </div>
      {sub === 'notices' ? (
        <NoticesAdmin />
      ) : sub === 'faq' ? (
        <FaqAdmin />
      ) : sub === 'rounds' ? (
        <RoundsAdmin />
      ) : sub === 'fees' ? (
        <FeesAdmin />
      ) : sub === 'admins' ? (
        <AdminAccountsAdmin />
      ) : (
        <>
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
        </>
      )}
    </div>
  )
}

// ── 공지사항 관리 (admin 함수의 noticeList/noticeUpsert/noticeDelete) ──
const NOTICE_CATS = ['guide', 'schedule', 'maintenance', 'event'] as const
const NOTICE_TAGS = ['notice', 'guide', 'required'] as const
const NOTICE_CAT_LABEL: Record<string, string> = {
  guide: '안내',
  schedule: '시험일정',
  maintenance: '점검',
  event: '이벤트',
}
const NOTICE_TAG_LABEL: Record<string, string> = {
  notice: '공지',
  guide: '안내',
  required: '필독',
}
interface NoticeDraft {
  id?: string
  category: string
  tag: string
  pinned: boolean
  published: boolean
  publishedAt: string // YYYY-MM-DD (편집용)
  titleI18n: I18nText
  bodyI18n: I18nText
}

function emptyDraft(): NoticeDraft {
  return {
    category: 'guide',
    tag: 'notice',
    pinned: false,
    published: true,
    publishedAt: new Date().toISOString().slice(0, 10),
    titleI18n: {},
    bodyI18n: {},
  }
}

function fmtDay(iso?: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '-'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}. ${p(d.getMonth() + 1)}. ${p(d.getDate())}`
}

const inpStyle: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid rgba(128,128,128,.35)',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  width: '100%',
}
const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  fontSize: 13,
  color: 'var(--muted)',
}

function NoticesAdmin() {
  const [rows, setRows] = useState<NoticeRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [draft, setDraft] = useState<NoticeDraft | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const res = await callFunction<AdminNoticeListResponse>('admin', { action: 'noticeList' })
      setRows(res.notices)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '공지를 불러올 수 없습니다.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  function openNew() {
    setDraft(emptyDraft())
  }
  function openEdit(n: NoticeRow) {
    setDraft({
      id: n.id,
      category: n.category,
      tag: n.tag,
      pinned: n.pinned,
      published: n.published,
      publishedAt: (n.publishedAt || '').slice(0, 10),
      titleI18n: { ...n.titleI18n },
      bodyI18n: { ...n.bodyI18n },
    })
  }
  function patch(p: Partial<NoticeDraft>) {
    setDraft((d) => (d ? { ...d, ...p } : d))
  }
  function patchTitle(v: string) {
    setDraft((d) => (d ? { ...d, titleI18n: { ...d.titleI18n, ko: v } } : d))
  }
  function patchBody(v: string) {
    setDraft((d) => (d ? { ...d, bodyI18n: { ...d.bodyI18n, ko: v } } : d))
  }

  async function save() {
    if (!draft) return
    if (!draft.titleI18n.ko?.trim()) {
      alert('한국어 제목은 필수입니다.')
      return
    }
    setSaving(true)
    try {
      const res = await callFunction<{ translateWarning?: string | null }>('admin', {
        action: 'noticeUpsert',
        notice: {
          ...draft,
          publishedAt: draft.publishedAt
            ? new Date(draft.publishedAt + 'T00:00:00+09:00').toISOString()
            : null,
        },
      })
      setDraft(null)
      await load()
      if (res?.translateWarning) alert('저장됐지만 자동 번역은 건너뛰었습니다:\n' + res.translateWarning)
    } catch (e) {
      alert(e instanceof Error ? e.message : '저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }
  async function remove(n: NoticeRow) {
    if (!confirm(`"${n.titleI18n.ko ?? ''}" 공지를 삭제할까요?`)) return
    try {
      await callFunction('admin', { action: 'noticeDelete', id: n.id })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : '삭제에 실패했습니다.')
    }
  }

  return (
    <>
      <div className="admin-head">
        <h1>공지사항 관리</h1>
        <div className="admin-head-actions">
          <span className="admin-count">총 {rows.length}건</span>
          <button className="exam-btn-ghost sm" onClick={load} disabled={loading}>
            새로고침
          </button>
          <button className="exam-btn-ghost sm" onClick={openNew}>
            + 새 공지
          </button>
        </div>
      </div>

      {err && <div className="admin-section admin-empty">불러오기 실패 — {err}</div>}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>상태</th>
              <th>분류</th>
              <th>제목 (한국어)</th>
              <th>게시일</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => (
              <tr key={n.id}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <span className={`admin-badge st-${n.published ? 'submitted' : 'voided'}`}>
                    {n.published ? '공개' : '비공개'}
                  </span>
                  {n.pinned && (
                    <span className="admin-badge st-in_progress" style={{ marginLeft: 6 }}>
                      고정
                    </span>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {NOTICE_CAT_LABEL[n.category] ?? n.category} · {NOTICE_TAG_LABEL[n.tag] ?? n.tag}
                </td>
                <td>{n.titleI18n.ko || <span style={{ color: 'var(--muted)' }}>(제목 없음)</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDay(n.publishedAt)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="exam-btn-ghost sm" onClick={() => openEdit(n)}>
                    편집
                  </button>
                  <button
                    className="exam-btn-ghost sm"
                    style={{ marginLeft: 6 }}
                    onClick={() => remove(n)}
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                  등록된 공지가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {draft && (
        <div className="admin-modal-bg" onClick={() => !saving && setDraft(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <button className="admin-modal-x" onClick={() => setDraft(null)}>
              ✕
            </button>
            <h2>{draft.id ? '공지 편집' : '새 공지'}</h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <label style={{ ...fieldStyle, flex: 1, minWidth: 120 }}>
                  분류
                  <select
                    style={inpStyle}
                    value={draft.category}
                    onChange={(e) => patch({ category: e.target.value })}
                  >
                    {NOTICE_CATS.map((c) => (
                      <option key={c} value={c}>
                        {NOTICE_CAT_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ ...fieldStyle, flex: 1, minWidth: 120 }}>
                  배지
                  <select
                    style={inpStyle}
                    value={draft.tag}
                    onChange={(e) => patch({ tag: e.target.value })}
                  >
                    {NOTICE_TAGS.map((c) => (
                      <option key={c} value={c}>
                        {NOTICE_TAG_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ ...fieldStyle, flex: 1, minWidth: 120 }}>
                  게시일
                  <input
                    type="date"
                    style={inpStyle}
                    value={draft.publishedAt}
                    onChange={(e) => patch({ publishedAt: e.target.value })}
                  />
                </label>
              </div>

              <div style={{ display: 'flex', gap: 20 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={draft.published}
                    onChange={(e) => patch({ published: e.target.checked })}
                  />
                  공개
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={draft.pinned}
                    onChange={(e) => patch({ pinned: e.target.checked })}
                  />
                  상단 고정
                </label>
              </div>

              <label style={fieldStyle}>
                제목 <em style={{ color: 'var(--error, #d43a3a)' }}>(한국어 · 필수)</em>
                <input
                  type="text"
                  style={inpStyle}
                  value={draft.titleI18n.ko ?? ''}
                  onChange={(e) => patchTitle(e.target.value)}
                  placeholder="공지 제목"
                />
              </label>
              <label style={fieldStyle}>
                본문 <em style={{ color: 'var(--muted)' }}>(한국어)</em>
                <textarea
                  rows={6}
                  style={{ ...inpStyle, resize: 'vertical', lineHeight: 1.6 }}
                  value={draft.bodyI18n.ko ?? ''}
                  onChange={(e) => patchBody(e.target.value)}
                  placeholder="공지 본문"
                />
              </label>
              <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
                🌐 저장하면 <b>영어·일본어·중국어·힌디어·베트남어</b>로 자동 번역되어 올라갑니다.
                (한국어 원문 기준 · 수정 후 저장하면 다시 번역)
              </p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button className="exam-btn-ghost" onClick={() => setDraft(null)} disabled={saving}>
                취소
              </button>
              <button className="exam-btn" onClick={save} disabled={saving}>
                {saving ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── FAQ 관리 (admin 함수의 faqList/faqUpsert/faqDelete) ──
const FAQ_CATS = ['schedule', 'system', 'payment', 'grading', 'corporate'] as const
const FAQ_CAT_LABEL: Record<string, string> = {
  schedule: '시험 접수·일정',
  system: '시스템·환경',
  payment: '결제·환불',
  grading: '채점·자격증',
  corporate: '기업·단체',
}

interface FaqDraft {
  id?: string
  category: string
  sort: number
  published: boolean
  questionI18n: I18nText
  answerI18n: I18nText
  tagI18n: I18nText
}

function emptyFaqDraft(): FaqDraft {
  return { category: 'schedule', sort: 9999, published: true, questionI18n: {}, answerI18n: {}, tagI18n: {} }
}

function FaqAdmin() {
  const [rows, setRows] = useState<FaqRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [draft, setDraft] = useState<FaqDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [catFilter, setCatFilter] = useState<string>('schedule')

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const res = await callFunction<AdminFaqListResponse>('admin', { action: 'faqList' })
      setRows(res.faqs)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'FAQ를 불러올 수 없습니다.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  function openNew() {
    setDraft({ ...emptyFaqDraft(), category: catFilter })
  }
  function openEdit(f: FaqRow) {
    setDraft({
      id: f.id,
      category: f.category,
      sort: f.sort,
      published: f.published,
      questionI18n: { ...f.questionI18n },
      answerI18n: { ...f.answerI18n },
      tagI18n: { ...f.tagI18n },
    })
  }
  function patch(p: Partial<FaqDraft>) {
    setDraft((d) => (d ? { ...d, ...p } : d))
  }
  function patchField(k: 'questionI18n' | 'answerI18n' | 'tagI18n', v: string) {
    setDraft((d) => (d ? { ...d, [k]: { ...d[k], ko: v } } : d))
  }

  async function save() {
    if (!draft) return
    if (!draft.questionI18n.ko?.trim()) {
      alert('한국어 질문은 필수입니다.')
      return
    }
    setSaving(true)
    try {
      const res = await callFunction<{ translateWarning?: string | null }>('admin', {
        action: 'faqUpsert',
        faq: draft,
      })
      setDraft(null)
      await load()
      if (res?.translateWarning) alert('저장됐지만 자동 번역은 건너뛰었습니다:\n' + res.translateWarning)
    } catch (e) {
      alert(e instanceof Error ? e.message : '저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }
  async function remove(f: FaqRow) {
    if (!confirm(`"${f.questionI18n.ko ?? ''}" FAQ를 삭제할까요?`)) return
    try {
      await callFunction('admin', { action: 'faqDelete', id: f.id })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : '삭제에 실패했습니다.')
    }
  }

  // 같은 분류 안에서 ↑(-1)/↓(+1) 이동 → 전체 순서 재구성해 서버가 sort 재부여
  async function move(f: FaqRow, dir: -1 | 1) {
    const group = rows.filter((r) => r.category === f.category).sort((a, b) => a.sort - b.sort)
    const idx = group.findIndex((r) => r.id === f.id)
    const swap = idx + dir
    if (swap < 0 || swap >= group.length) return
    const g = [...group]
    ;[g[idx], g[swap]] = [g[swap], g[idx]]
    const known = new Set<string>(FAQ_CATS)
    const ids: string[] = []
    for (const key of FAQ_CATS) {
      if (key === f.category) g.forEach((r) => ids.push(r.id))
      else rows.filter((r) => r.category === key).sort((a, b) => a.sort - b.sort).forEach((r) => ids.push(r.id))
    }
    rows.filter((r) => !known.has(r.category)).sort((a, b) => a.sort - b.sort).forEach((r) => ids.push(r.id))
    setBusy(true)
    try {
      await callFunction('admin', { action: 'faqReorder', ids })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : '순서 변경에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const group = rows.filter((r) => r.category === catFilter).sort((a, b) => a.sort - b.sort)

  return (
    <>
      <div className="admin-head">
        <h1>FAQ 관리</h1>
        <div className="admin-head-actions">
          <span className="admin-count">총 {rows.length}건</span>
          <button className="exam-btn-ghost sm" onClick={load} disabled={loading}>
            새로고침
          </button>
          <button className="exam-btn-ghost sm" onClick={openNew}>
            + 새 FAQ
          </button>
        </div>
      </div>

      {err && <div className="admin-section admin-empty">불러오기 실패 — {err}</div>}

      {/* 분류 버튼 — 눌러서 해당 분류만 보기(공개 FAQ 사이드바처럼) */}
      <div className="admin-tabs" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
        {FAQ_CATS.map((key) => {
          const count = rows.filter((r) => r.category === key).length
          return (
            <button
              key={key}
              className={catFilter === key ? 'on' : ''}
              onClick={() => setCatFilter(key)}
            >
              {FAQ_CAT_LABEL[key]}
              {count > 0 && <span style={{ opacity: 0.55, marginLeft: 5 }}>{count}</span>}
            </button>
          )
        })}
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>상태</th>
              <th>질문 (한국어)</th>
              <th style={{ textAlign: 'center' }}>순서</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {group.map((f, i) => (
              <tr key={f.id}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <span className={`admin-badge st-${f.published ? 'submitted' : 'voided'}`}>
                    {f.published ? '공개' : '비공개'}
                  </span>
                </td>
                <td>{f.questionI18n.ko || <span style={{ color: 'var(--muted)' }}>(질문 없음)</span>}</td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                  <button
                    className="exam-btn-ghost sm"
                    disabled={busy || i === 0}
                    onClick={() => move(f, -1)}
                    aria-label="위로"
                    title="위로"
                  >
                    ↑
                  </button>
                  <button
                    className="exam-btn-ghost sm"
                    style={{ marginLeft: 4 }}
                    disabled={busy || i === group.length - 1}
                    onClick={() => move(f, 1)}
                    aria-label="아래로"
                    title="아래로"
                  >
                    ↓
                  </button>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="exam-btn-ghost sm" onClick={() => openEdit(f)}>
                    편집
                  </button>
                  <button className="exam-btn-ghost sm" style={{ marginLeft: 6 }} onClick={() => remove(f)}>
                    삭제
                  </button>
                </td>
              </tr>
            ))}
            {!group.length && !loading && (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                  이 분류에 FAQ가 없습니다. “+ 새 FAQ”로 추가하세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {draft && (
        <div className="admin-modal-bg" onClick={() => !saving && setDraft(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <button className="admin-modal-x" onClick={() => setDraft(null)}>
              ✕
            </button>
            <h2>{draft.id ? 'FAQ 편집' : '새 FAQ'}</h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <label style={{ ...fieldStyle, flex: 2, minWidth: 140 }}>
                  분류
                  <select
                    style={inpStyle}
                    value={draft.category}
                    onChange={(e) => patch({ category: e.target.value })}
                  >
                    {FAQ_CATS.map((c) => (
                      <option key={c} value={c}>
                        {FAQ_CAT_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, alignSelf: 'flex-end', paddingBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={draft.published}
                    onChange={(e) => patch({ published: e.target.checked })}
                  />
                  공개
                </label>
              </div>

              <label style={fieldStyle}>
                질문 <em style={{ color: 'var(--error, #d43a3a)' }}>(한국어 · 필수)</em>
                <input
                  type="text"
                  style={inpStyle}
                  value={draft.questionI18n.ko ?? ''}
                  onChange={(e) => patchField('questionI18n', e.target.value)}
                  placeholder="질문"
                />
              </label>
              <label style={fieldStyle}>
                답변 <em style={{ color: 'var(--muted)' }}>(한국어)</em>
                <textarea
                  rows={5}
                  style={{ ...inpStyle, resize: 'vertical', lineHeight: 1.6 }}
                  value={draft.answerI18n.ko ?? ''}
                  onChange={(e) => patchField('answerI18n', e.target.value)}
                  placeholder="답변"
                />
              </label>
              <label style={fieldStyle}>
                태그 <em style={{ color: 'var(--muted)' }}>(한국어 · 선택, 짧은 라벨)</em>
                <input
                  type="text"
                  style={inpStyle}
                  value={draft.tagI18n.ko ?? ''}
                  onChange={(e) => patchField('tagI18n', e.target.value)}
                  placeholder="예: 응시 환경"
                />
              </label>
              <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
                🌐 저장하면 <b>영어·일본어·중국어·힌디어·베트남어</b>로 자동 번역되어 올라갑니다.
                (한국어 원문 기준 · 수정 후 저장하면 다시 번역)
              </p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button className="exam-btn-ghost" onClick={() => setDraft(null)} disabled={saving}>
                취소
              </button>
              <button className="exam-btn" onClick={save} disabled={saving}>
                {saving ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── 시험 일정/회차 관리 (exam_rounds) ──────────────────────────────
const ROUND_KINDS = ['regular', 'rolling'] as const
const ROUND_KIND_LABEL: Record<string, string> = { regular: '정기시험', rolling: '상시시험' }

interface RoundDraft {
  id?: string
  kind: 'regular' | 'rolling'
  sort: number
  published: boolean
  titleI18n: I18nText
  noteI18n: I18nText
  examDate: string // YYYY-MM-DD
  applyStart: string // YYYY-MM-DD
  applyEnd: string // YYYY-MM-DD
}

function emptyRoundDraft(kind: 'regular' | 'rolling'): RoundDraft {
  return { kind, sort: 9999, published: true, titleI18n: {}, noteI18n: {}, examDate: '', applyStart: '', applyEnd: '' }
}

function RoundsAdmin() {
  const [rows, setRows] = useState<ExamRoundRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [draft, setDraft] = useState<RoundDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [kindFilter, setKindFilter] = useState<'regular' | 'rolling'>('regular')

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const res = await callFunction<AdminExamRoundListResponse>('admin', { action: 'examRoundList' })
      setRows(res.rounds)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '시험 일정을 불러올 수 없습니다.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  function openNew() {
    setDraft(emptyRoundDraft(kindFilter))
  }
  function openEdit(r: ExamRoundRow) {
    setDraft({
      id: r.id,
      kind: r.kind,
      sort: r.sort,
      published: r.published,
      titleI18n: { ...r.titleI18n },
      noteI18n: { ...r.noteI18n },
      examDate: r.examDate ?? '',
      applyStart: r.applyStartAt ? r.applyStartAt.slice(0, 10) : '',
      applyEnd: r.applyEndAt ? r.applyEndAt.slice(0, 10) : '',
    })
  }
  function patch(p: Partial<RoundDraft>) {
    setDraft((d) => (d ? { ...d, ...p } : d))
  }
  function patchField(k: 'titleI18n' | 'noteI18n', v: string) {
    setDraft((d) => (d ? { ...d, [k]: { ...d[k], ko: v } } : d))
  }

  async function save() {
    if (!draft) return
    if (!draft.titleI18n.ko?.trim()) {
      alert('한국어 회차명은 필수입니다.')
      return
    }
    const isReg = draft.kind === 'regular'
    setSaving(true)
    try {
      const res = await callFunction<{ translateWarning?: string | null }>('admin', {
        action: 'examRoundUpsert',
        round: {
          id: draft.id,
          kind: draft.kind,
          sort: draft.sort,
          published: draft.published,
          titleI18n: draft.titleI18n,
          noteI18n: isReg ? {} : draft.noteI18n,
          examDate: isReg ? draft.examDate || null : null,
          applyStartAt: isReg && draft.applyStart ? `${draft.applyStart}T00:00:00` : null,
          applyEndAt: isReg && draft.applyEnd ? `${draft.applyEnd}T23:59:59` : null,
        },
      })
      setDraft(null)
      await load()
      if (res?.translateWarning) alert('저장됐지만 자동 번역은 건너뛰었습니다:\n' + res.translateWarning)
    } catch (e) {
      alert(e instanceof Error ? e.message : '저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }
  async function remove(r: ExamRoundRow) {
    if (!confirm(`"${r.titleI18n.ko ?? ''}" 일정을 삭제할까요?`)) return
    try {
      await callFunction('admin', { action: 'examRoundDelete', id: r.id })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : '삭제에 실패했습니다.')
    }
  }

  // 같은 유형(정기/상시) 안에서 ↑↓ 이동 → 전체 순서 재구성해 서버가 sort 재부여
  async function move(r: ExamRoundRow, dir: -1 | 1) {
    const grp = rows.filter((x) => x.kind === r.kind).sort((a, b) => a.sort - b.sort)
    const idx = grp.findIndex((x) => x.id === r.id)
    const swap = idx + dir
    if (swap < 0 || swap >= grp.length) return
    const g = [...grp]
    ;[g[idx], g[swap]] = [g[swap], g[idx]]
    const ids: string[] = []
    for (const k of ROUND_KINDS) {
      if (k === r.kind) g.forEach((x) => ids.push(x.id))
      else rows.filter((x) => x.kind === k).sort((a, b) => a.sort - b.sort).forEach((x) => ids.push(x.id))
    }
    setBusy(true)
    try {
      await callFunction('admin', { action: 'examRoundReorder', ids })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : '순서 변경에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const group = rows.filter((r) => r.kind === kindFilter).sort((a, b) => a.sort - b.sort)
  const isReg = draft?.kind === 'regular'

  return (
    <>
      <div className="admin-head">
        <h1>시험 일정 관리</h1>
        <div className="admin-head-actions">
          <span className="admin-count">총 {rows.length}건</span>
          <button className="exam-btn-ghost sm" onClick={load} disabled={loading}>
            새로고침
          </button>
          <button className="exam-btn-ghost sm" onClick={openNew}>
            + 새 일정
          </button>
        </div>
      </div>

      {err && <div className="admin-section admin-empty">불러오기 실패 — {err}</div>}

      {/* 유형 버튼 — 정기/상시 나눠 보기 */}
      <div className="admin-tabs" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
        {ROUND_KINDS.map((k) => {
          const count = rows.filter((r) => r.kind === k).length
          return (
            <button key={k} className={kindFilter === k ? 'on' : ''} onClick={() => setKindFilter(k)}>
              {ROUND_KIND_LABEL[k]}
              {count > 0 && <span style={{ opacity: 0.55, marginLeft: 5 }}>{count}</span>}
            </button>
          )
        })}
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>상태</th>
              <th>회차명 (한국어)</th>
              <th>시험일</th>
              <th>접수기간</th>
              <th style={{ textAlign: 'center' }}>순서</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {group.map((r, i) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <span className={`admin-badge st-${r.published ? 'submitted' : 'voided'}`}>
                    {r.published ? '공개' : '비공개'}
                  </span>
                </td>
                <td>{r.titleI18n.ko || <span style={{ color: 'var(--muted)' }}>(회차명 없음)</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{r.kind === 'rolling' ? '상시' : r.examDate ?? '-'}</td>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 13 }}>
                  {r.kind === 'rolling'
                    ? '연중'
                    : r.applyStartAt || r.applyEndAt
                      ? `${r.applyStartAt?.slice(0, 10) ?? '?'} ~ ${r.applyEndAt?.slice(0, 10) ?? '?'}`
                      : '-'}
                </td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                  <button
                    className="exam-btn-ghost sm"
                    disabled={busy || i === 0}
                    onClick={() => move(r, -1)}
                    aria-label="위로"
                    title="위로"
                  >
                    ↑
                  </button>
                  <button
                    className="exam-btn-ghost sm"
                    style={{ marginLeft: 4 }}
                    disabled={busy || i === group.length - 1}
                    onClick={() => move(r, 1)}
                    aria-label="아래로"
                    title="아래로"
                  >
                    ↓
                  </button>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="exam-btn-ghost sm" onClick={() => openEdit(r)}>
                    편집
                  </button>
                  <button className="exam-btn-ghost sm" style={{ marginLeft: 6 }} onClick={() => remove(r)}>
                    삭제
                  </button>
                </td>
              </tr>
            ))}
            {!group.length && !loading && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                  이 유형의 일정이 없습니다. “+ 새 일정”으로 추가하세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {draft && (
        <div className="admin-modal-bg" onClick={() => !saving && setDraft(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <button className="admin-modal-x" onClick={() => setDraft(null)}>
              ✕
            </button>
            <h2>{draft.id ? '시험 일정 편집' : '새 시험 일정'}</h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <label style={{ ...fieldStyle, flex: 2, minWidth: 140 }}>
                  유형
                  <select
                    style={inpStyle}
                    value={draft.kind}
                    onChange={(e) => patch({ kind: e.target.value as 'regular' | 'rolling' })}
                  >
                    {ROUND_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {ROUND_KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, alignSelf: 'flex-end', paddingBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={draft.published}
                    onChange={(e) => patch({ published: e.target.checked })}
                  />
                  공개
                </label>
              </div>

              <label style={fieldStyle}>
                회차명 <em style={{ color: 'var(--error, #d43a3a)' }}>(한국어 · 필수)</em>
                <input
                  type="text"
                  style={inpStyle}
                  value={draft.titleI18n.ko ?? ''}
                  onChange={(e) => patchField('titleI18n', e.target.value)}
                  placeholder="예: 제 5회 정기시험"
                />
              </label>

              {isReg ? (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <label style={{ ...fieldStyle, flex: 1, minWidth: 130 }}>
                    시험일
                    <input type="date" style={inpStyle} value={draft.examDate} onChange={(e) => patch({ examDate: e.target.value })} />
                  </label>
                  <label style={{ ...fieldStyle, flex: 1, minWidth: 130 }}>
                    접수 시작
                    <input type="date" style={inpStyle} value={draft.applyStart} onChange={(e) => patch({ applyStart: e.target.value })} />
                  </label>
                  <label style={{ ...fieldStyle, flex: 1, minWidth: 130 }}>
                    접수 마감
                    <input type="date" style={inpStyle} value={draft.applyEnd} onChange={(e) => patch({ applyEnd: e.target.value })} />
                  </label>
                </div>
              ) : (
                <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: 0 }}>
                  상시시험은 시험일·접수기간이 없습니다(연중 접수).
                </p>
              )}

              {/* 설명은 상시시험 카드에만 표시됨 → 상시일 때만 입력 */}
              {!isReg && (
                <label style={fieldStyle}>
                  설명 <em style={{ color: 'var(--muted)' }}>(한국어 · 카드에 표시)</em>
                  <textarea
                    rows={3}
                    style={{ ...inpStyle, resize: 'vertical', lineHeight: 1.6 }}
                    value={draft.noteI18n.ko ?? ''}
                    onChange={(e) => patchField('noteI18n', e.target.value)}
                    placeholder="예: 원하는 날짜를 예약해 온라인(CBT)으로 응시합니다."
                  />
                </label>
              )}

              <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
                🌐 {isReg ? '회차명은' : '회차명·설명은'} 저장 시 <b>영어·일본어·중국어·힌디어·베트남어</b>로 자동 번역됩니다. 날짜는 화면 언어에 맞게 자동 표기됩니다.
              </p>
              {isReg && (
                <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
                  ⓘ 접수 시작~마감 기간이면 “접수중”, 시작 전이면 “예정”, 마감 후면 “마감”으로 표시됩니다.
                </p>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button className="exam-btn-ghost" onClick={() => setDraft(null)} disabled={saving}>
                취소
              </button>
              <button className="exam-btn" onClick={save} disabled={saving}>
                {saving ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── 응시료 관리 (exam_fees) ────────────────────────────────────────
// 급수/과목/합격컷은 코드 고정 — 여기선 "금액"만 편집.
const FEE_ROWS = [
  { key: 'pro', label: 'CARIS Pro', sub: '단일 응시료 (점수로 4~1급 판정)' },
  { key: 'master_g4', label: 'CARIS Master 4급', sub: '' },
  { key: 'master_g3', label: 'CARIS Master 3급', sub: '' },
  { key: 'master_g2', label: 'CARIS Master 2급', sub: '' },
  { key: 'master_g1', label: 'CARIS Master 1급', sub: '' },
] as const

function FeesAdmin() {
  const [amounts, setAmounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const res = await callFunction<AdminExamFeeListResponse>('admin', { action: 'examFeeList' })
      const map: Record<string, number> = {}
      for (const f of res.fees) map[f.key] = f.amount
      setAmounts(map)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '응시료를 불러올 수 없습니다.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  function setAmt(key: string, v: string) {
    const n = Math.max(0, Math.floor(Number(v) || 0))
    setAmounts((a) => ({ ...a, [key]: n }))
  }

  async function save() {
    setSaving(true)
    try {
      const fees = FEE_ROWS.map((r) => ({ key: r.key, amount: amounts[r.key] ?? 0 }))
      await callFunction('admin', { action: 'examFeeSave', fees })
      await load()
      alert('응시료를 저장했습니다.')
    } catch (e) {
      alert(e instanceof Error ? e.message : '저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const won = (n: number) => (n || 0).toLocaleString('ko-KR')

  return (
    <>
      <div className="admin-head">
        <h1>응시료 관리</h1>
        <div className="admin-head-actions">
          <button className="exam-btn-ghost sm" onClick={load} disabled={loading || saving}>
            새로고침
          </button>
          <button className="exam-btn" onClick={save} disabled={loading || saving}>
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>

      {err && <div className="admin-section admin-empty">불러오기 실패 — {err}</div>}

      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 16px', lineHeight: 1.6 }}>
        급수 체계·과목·합격 기준은 코드로 고정되어 있고, 여기서는 <b>응시료 금액</b>만 변경합니다. 저장하면 원서접수 화면에 바로 반영됩니다.
      </p>

      <div className="admin-section" style={{ maxWidth: 500, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {FEE_ROWS.map((r) => (
          <div key={r.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{r.label}</div>
              {r.sub && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{r.sub}</div>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                <input
                  type="number"
                  min={0}
                  step={1000}
                  style={{ ...inpStyle, width: 140, textAlign: 'right' }}
                  value={amounts[r.key] ?? 0}
                  onChange={(e) => setAmt(r.key, e.target.value)}
                />
                <span style={{ color: 'var(--muted)' }}>원</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>₩ {won(amounts[r.key] ?? 0)}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// ── 관리자 계정 관리 (루트 전용) ──────────────────────────────────
// admin_users 는 CBT·레벨테스트 공용 → 여기서 추가하면 양쪽 관리자 권한이 함께 부여됨.
interface AdminAccountRow {
  email: string
  role: 'root' | 'admin'
  added_by: string | null
  created_at: string | null
}

function AdminAccountsAdmin() {
  const [rows, setRows] = useState<AdminAccountRow[] | null>(null)
  const [candidates, setCandidates] = useState<string[]>([])
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await callFunction<{ admins: AdminAccountRow[]; candidates?: string[] }>('admin', { action: 'admins' })
      setRows(r.admins)
      setCandidates(r.candidates ?? [])
    } catch (e) {
      setMsg('불러오기 실패: ' + (e instanceof Error ? e.message : String(e)))
      setRows([])
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  async function add() {
    const t = email.trim().toLowerCase()
    if (!t) return
    setBusy(true)
    setMsg('')
    try {
      const r = await callFunction<{ admins: AdminAccountRow[]; candidates?: string[] }>('admin', { action: 'addAdmin', email: t })
      setRows(r.admins)
      setCandidates(r.candidates ?? [])
      setEmail('')
      setMsg(`✅ ${t} 추가됨`)
    } catch (e) {
      setMsg('실패: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
    }
  }
  async function remove(target: string) {
    if (!confirm(`${target} 을(를) 관리자에서 삭제할까요?`)) return
    setBusy(true)
    setMsg('')
    try {
      const r = await callFunction<{ admins: AdminAccountRow[]; candidates?: string[] }>('admin', { action: 'removeAdmin', email: target })
      setRows(r.admins)
      setCandidates(r.candidates ?? [])
      setMsg(`🗑 ${target} 삭제됨`)
    } catch (e) {
      setMsg('실패: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="admin-head">
        <h1>관리자 관리</h1>
        <div className="admin-head-actions">
          <span className="admin-count">{rows ? `${rows.length}명` : ''}</span>
          <button className="exam-btn-ghost sm" onClick={load} disabled={busy}>
            새로고침
          </button>
        </div>
      </div>

      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 16px', lineHeight: 1.6 }}>
        이미 <b>로그인(회원가입)한 유저</b>만 관리자로 지정할 수 있습니다. 추가하면 그 계정으로 CARIS·레벨테스트 관리자 페이지를 모두 쓸 수 있어요. (추가·삭제는 루트 관리자만)
      </p>

      <div className="admin-section" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <input
          list="cbt-admin-candidates"
          style={{ ...inpStyle, width: 280 }}
          placeholder="가입 유저 이메일 선택/입력"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
        />
        <datalist id="cbt-admin-candidates">
          {candidates.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <button className="exam-btn" onClick={add} disabled={busy || !email.trim()}>
          추가
        </button>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>지정 가능 {candidates.length}명</span>
        {msg && <span style={{ fontSize: 13 }}>{msg}</span>}
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>이메일</th>
              <th>권한</th>
              <th>추가한 사람</th>
              <th>추가일</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((a) => (
              <tr key={a.email}>
                <td>{a.email}</td>
                <td>
                  <span className={`admin-badge st-${a.role === 'root' ? 'submitted' : 'in_progress'}`}>
                    {a.role === 'root' ? '루트' : '관리자'}
                  </span>
                </td>
                <td>{a.added_by ?? '-'}</td>
                <td>{fmtDT(a.created_at)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {a.role === 'root' ? (
                    <span style={{ color: 'var(--muted)' }}>삭제 불가</span>
                  ) : (
                    <button className="exam-btn-ghost sm" onClick={() => remove(a.email)} disabled={busy}>
                      삭제
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                  관리자 목록이 비어 있습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
