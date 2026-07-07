import { useCallback, useEffect, useState, lazy, Suspense, type CSSProperties } from 'react'
import { useSearchParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import type {
  AdminListResponse,
  AdminAttemptRow,
  AdminDetailResponse,
  AdminAnswerRow,
  GradeQueueItem,
  GradeQueueResponse,
  GradeRound,
  GradeRoundsResponse,
  AdminNoticeListResponse,
  NoticeRow,
  AdminFaqListResponse,
  FaqRow,
  AdminExamRoundListResponse,
  ExamRoundRow,
  AdminExamListResp,
  AdminExamItem,
  AdminQuestionListResp,
  AdminQuestionRow,
  AdminQuestionEventsResp,
  AdminQuestionEvent,
  QuestionImportRow,
  CbtAnalytics,
  CbtRoundStat,
  CbtQDiff,
  CbtUserRow,
  CbtUsersResp,
  CbtUserDetailResp,
  I18nText,
} from '../lib/types'
import LevelTestAdmin from './AdminLevelTest'
import { getTracks } from '../lib/caris'

// 관리자 최상위 = 두 제품 백오피스 탭 분리: CARIS 시험(CBT) / 레벨테스트.
//  - "CARIS 시험" = 기존 CBT 관리(<CarisExamAdmin/>, admin 함수 호출) — 그대로 유지.
//  - "레벨테스트" = 이관된 레벨테스트 관리(<LevelTestAdmin/>, admin-test 함수 호출).
type TopTab = 'caris' | 'level'
export default function Admin() {
  const { isFullUser, loginWithGoogle } = useAuth()
  // 탭 상태를 URL 쿼리(?top)로 → 브라우저 뒤로/앞으로가 탭 사이를 오간다.
  const [params, setParams] = useSearchParams()
  const topTab: TopTab = params.get('top') === 'level' ? 'level' : 'caris'
  const setTopTab = (t: TopTab) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev)
      if (t === 'caris') p.delete('top')
      else { p.set('top', t); p.delete('tab') } // 레벨탭이면 CARIS 서브탭 제거
      return p
    })

  // 로그인 게이트는 최상위에서 공유(두 탭 공통). 세부 권한은 각 탭이 서버로 확인.
  if (!isFullUser) {
    return (
      <div className="wrap">
        <div className="exam-card" style={{ textAlign: 'center', maxWidth: 420, margin: '40px auto' }}>
          <h2 className="exam-title">관리자 로그인</h2>
          <p className="exam-sub">관리자 계정으로 로그인해 주세요.</p>
          <button className="btn-ink" style={{ marginTop: 16 }} onClick={() => loginWithGoogle()}>
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

// CARIS 백오피스 서브탭 — DashboardBody 액션 카드가 탭 이동에 재사용.
type CarisSub = 'dash' | 'subs' | 'grading' | 'users' | 'questions' | 'notices' | 'faq' | 'rounds' | 'admins'
const CARIS_SUBS: CarisSub[] = ['dash', 'subs', 'grading', 'users', 'questions', 'notices', 'faq', 'rounds', 'admins']
// 제출답안 목록 빠른 필터 — 대시보드 '처리 대기' 카드가 딥링크로 지정.
type SubsFilter = 'all' | 'in_progress' | 'result_pending' | 'passed' | 'failed'
const SUBS_FILTERS: { key: SubsFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'in_progress', label: '진행중' },
  { key: 'result_pending', label: '결과공개 대기' },
  { key: 'passed', label: '합격' },
  { key: 'failed', label: '불합격' },
]
function matchSubsFilter(r: AdminAttemptRow, f: SubsFilter): boolean {
  const pct = r.totalQuestions && r.totalCorrect != null ? (r.totalCorrect / r.totalQuestions) * 100 : null
  const releasePending = !r.resultReleaseAt || new Date(r.resultReleaseAt).getTime() > Date.now()
  switch (f) {
    case 'in_progress': return r.status === 'in_progress'
    case 'result_pending': return r.status === 'submitted' && releasePending
    case 'passed': return r.status === 'submitted' && pct != null && pct >= 60
    case 'failed': return r.status === 'submitted' && pct != null && pct < 60
    default: return true
  }
}

// CARIS 시험(CBT) 백오피스 — 제출 답안 조회. (기존 Admin 본문 그대로, admin 함수 호출)
function CarisExamAdmin() {
  const { isFullUser, loginWithGoogle } = useAuth()
  // 서브탭도 URL 쿼리(?tab)로 → 대시보드→문항 후 뒤로가기 시 대시보드로 복귀.
  const [params, setParams] = useSearchParams()
  const rawTab = params.get('tab') ?? ''
  const sub: CarisSub = (CARIS_SUBS as string[]).includes(rawTab) ? (rawTab as CarisSub) : 'dash'
  const setSub = (t: CarisSub) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev)
      if (t === 'dash') p.delete('tab')
      else p.set('tab', t)
      return p
    })
  const [state, setState] = useState<'checking' | 'denied' | 'ok'>('checking')
  const [rows, setRows] = useState<AdminAttemptRow[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [detail, setDetail] = useState<AdminDetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [subsFilter, setSubsFilter] = useState<SubsFilter>('all')
  const [isRoot, setIsRoot] = useState(false)

  // 대시보드 액션 카드 → 탭 이동(+제출답안 필터 프리셋)
  const nav = (t: CarisSub, f: SubsFilter = 'all') => { setSubsFilter(f); setSub(t) }

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

  // ── 게이트 ──
  if (!isFullUser) {
    return (
      <div className="wrap">
        <div className="exam-card" style={{ textAlign: 'center', maxWidth: 420, margin: '40px auto' }}>
          <h2 className="exam-title">관리자 로그인</h2>
          <p className="exam-sub">관리자 계정으로 로그인해 주세요.</p>
          <button className="btn-ink" style={{ marginTop: 16 }} onClick={() => loginWithGoogle()}>
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
    <div className="wrap admin admin-cbt">
      <div className="admin-tabs" style={{ marginBottom: 18, flexWrap: 'wrap' }}>
        <button className={sub === 'dash' ? 'on' : ''} onClick={() => setSub('dash')}>
          대시보드
        </button>
        <button className={sub === 'subs' ? 'on' : ''} onClick={() => setSub('subs')}>
          제출 답안
        </button>
        <button className={sub === 'grading' ? 'on' : ''} onClick={() => setSub('grading')}>
          주관식 채점
        </button>
        <button className={sub === 'users' ? 'on' : ''} onClick={() => setSub('users')}>
          회원
        </button>
        <button className={sub === 'questions' ? 'on' : ''} onClick={() => setSub('questions')}>
          문항
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
        {isRoot && (
          <button className={sub === 'admins' ? 'on' : ''} onClick={() => setSub('admins')}>
            관리자 관리
          </button>
        )}
      </div>
      {sub === 'dash' ? (
        <DashboardAdmin onNav={nav} />
      ) : sub === 'grading' ? (
        <GradingAdmin />
      ) : sub === 'users' ? (
        <UsersAdmin />
      ) : sub === 'questions' ? (
        <QuestionsAdmin />
      ) : sub === 'notices' ? (
        <NoticesAdmin />
      ) : sub === 'faq' ? (
        <FaqAdmin />
      ) : sub === 'rounds' ? (
        <RoundsAdmin />
      ) : sub === 'admins' ? (
        <AdminAccountsAdmin />
      ) : (
        <>
      <div className="admin-head">
        <h1>제출 답안 관리</h1>
        <div className="admin-head-actions">
          <span className="admin-count">총 {total}건</span>
          <button className="admin-mini" onClick={() => load(offset)} disabled={loading}>
            새로고침
          </button>
        </div>
      </div>

      {/* 빠른 필터(이 페이지 기준) — 대시보드 '처리 대기' 카드가 프리셋 지정 */}
      <div className="admin-tabs" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
        {SUBS_FILTERS.map((f) => {
          const c = rows.filter((r) => matchSubsFilter(r, f.key)).length
          return (
            <button key={f.key} className={subsFilter === f.key ? 'on' : ''} onClick={() => setSubsFilter(f.key)}>
              {f.label}
              {f.key !== 'all' && <span style={{ opacity: 0.55, marginLeft: 5 }}>{c}</span>}
            </button>
          )
        })}
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
            {rows.filter((r) => matchSubsFilter(r, subsFilter)).map((r) => (
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
                  <button className="admin-mini" onClick={() => openDetail(r.attemptId)}>
                    상세
                  </button>
                </td>
              </tr>
            ))}
            {!rows.filter((r) => matchSubsFilter(r, subsFilter)).length && !loading && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                  {rows.length ? '이 필터에 해당하는 답안이 없습니다(이 페이지 기준).' : '제출된 답안이 없습니다.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="admin-pager">
        <button className="admin-mini" disabled={offset === 0 || loading} onClick={() => load(Math.max(0, offset - PAGE))}>
          ‹ 이전
        </button>
        <span>
          {pageNo} / {pageMax}
        </span>
        <button
          className="admin-mini"
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
const NOTICE_CAT_LABEL: Record<string, string> = {
  guide: '안내',
  schedule: '시험일정',
  maintenance: '점검',
  event: '이벤트',
}
interface NoticeDraft {
  id?: string
  category: string
  required: boolean
  pinned: boolean
  published: boolean
  publishedAt: string // YYYY-MM-DD (편집용)
  titleI18n: I18nText
  bodyI18n: I18nText
}

function emptyDraft(): NoticeDraft {
  return {
    category: 'guide',
    required: false,
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

// 공지 본문 WYSIWYG 에디터(react-quill) — 관리자 전용이라 lazy 로딩(공개 번들에 Quill 제외)
const RichEditor = lazy(() => import('../components/RichEditor'))

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

  // 작성 중 자동 임시저장(localStorage) — 실수로 닫히거나 새로고침해도 복구(새 공지에만).
  useEffect(() => {
    if (!draft || draft.id) return
    const id = setTimeout(() => localStorage.setItem('notice-draft', JSON.stringify(draft)), 600)
    return () => clearTimeout(id)
  }, [draft])

  function openNew() {
    const saved = localStorage.getItem('notice-draft')
    if (saved) {
      try {
        const d = JSON.parse(saved) as NoticeDraft
        const hasContent = !!(d.titleI18n?.ko?.trim() || d.bodyI18n?.ko?.trim())
        if (!d.id && hasContent && confirm('작성 중이던 공지가 있습니다. 이어서 작성할까요?')) {
          setDraft(d)
          return
        }
      } catch {
        /* 무시 */
      }
    }
    setDraft(emptyDraft())
  }
  function openEdit(n: NoticeRow) {
    setDraft({
      id: n.id,
      category: n.category,
      required: n.required,
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
      localStorage.removeItem('notice-draft')
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
          <button className="admin-mini" onClick={load} disabled={loading}>
            새로고침
          </button>
          <button className="admin-mini" onClick={openNew}>
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
                  {NOTICE_CAT_LABEL[n.category] ?? n.category}
                  {n.required && (
                    <span className="admin-badge st-voided" style={{ marginLeft: 6 }}>
                      필독
                    </span>
                  )}
                </td>
                <td>{n.titleI18n.ko || <span style={{ color: 'var(--muted)' }}>(제목 없음)</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDay(n.publishedAt)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="admin-mini" onClick={() => openEdit(n)}>
                    편집
                  </button>
                  <button
                    className="admin-mini"
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
        <div className="admin-modal-bg">
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
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={draft.required}
                    onChange={(e) => patch({ required: e.target.checked })}
                  />
                  필독
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
              <div style={fieldStyle}>
                <span>본문 <em style={{ color: 'var(--muted)' }}>(한국어 · 서식·이미지 가능)</em></span>
                <Suspense fallback={<div style={{ padding: 12, color: 'var(--muted)', fontSize: 13 }}>에디터 불러오는 중…</div>}>
                  <RichEditor value={draft.bodyI18n.ko ?? ''} onChange={patchBody} />
                </Suspense>
              </div>
              <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
                🌐 저장하면 <b>영어·일본어·중국어·힌디어·베트남어</b>로 자동 번역되어 올라갑니다.
                (한국어 원문 기준 · 수정 후 저장하면 다시 번역)
              </p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button className="admin-mini" onClick={() => setDraft(null)} disabled={saving}>
                취소
              </button>
              <button className="btn-ink" onClick={save} disabled={saving}>
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
          <button className="admin-mini" onClick={load} disabled={loading}>
            새로고침
          </button>
          <button className="admin-mini" onClick={openNew}>
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
                    className="admin-mini"
                    disabled={busy || i === 0}
                    onClick={() => move(f, -1)}
                    aria-label="위로"
                    title="위로"
                  >
                    ↑
                  </button>
                  <button
                    className="admin-mini"
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
                  <button className="admin-mini" onClick={() => openEdit(f)}>
                    편집
                  </button>
                  <button className="admin-mini" style={{ marginLeft: 6 }} onClick={() => remove(f)}>
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
              <button className="admin-mini" onClick={() => setDraft(null)} disabled={saving}>
                취소
              </button>
              <button className="btn-ink" onClick={save} disabled={saving}>
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
const ROUND_KIND_LABEL: Record<string, string> = { regular: '정기시험', rolling: '상시시험' } // 편집폼 유형 select 라벨

// 목록 필터 세그먼트: 정기(안 지난 것) · 상시 · 지난 시험(지난 정기). '지난 시험'은 별도 데이터가 아니라 시험일 기준 분류.
type RoundFilter = 'regular' | 'rolling' | 'past'
const ROUND_FILTERS: { key: RoundFilter; label: string }[] = [
  { key: 'regular', label: '정기시험' },
  { key: 'rolling', label: '상시시험' },
  { key: 'past', label: '지난 시험' },
]
// 지난 시험 판정 — 공개화면(useExamRounds)의 isPastExam 과 동일 경계: 시험일 다음날 0시부터 과거.
function isPastRound(examDate: string | null): boolean {
  if (!examDate) return false
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const d = Date.parse(`${examDate}T23:59:59`)
  return !Number.isNaN(d) && d < todayStart.getTime()
}
// 회차가 필터 세그먼트에 속하는지 (지난 시험 = 지난 정기, 정기 = 안 지난 정기, 상시 = rolling)
function matchRoundFilter(r: ExamRoundRow, f: RoundFilter): boolean {
  if (f === 'rolling') return r.kind === 'rolling'
  const past = r.kind === 'regular' && isPastRound(r.examDate)
  return f === 'past' ? past : r.kind === 'regular' && !past
}

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
  const [kindFilter, setKindFilter] = useState<RoundFilter>('regular')

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
    setDraft(emptyRoundDraft(kindFilter === 'rolling' ? 'rolling' : 'regular'))
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

  // 정기시험은 시험일 오름차순 자동정렬(수동 순서 없음). 상시는 sort(수동 ↑↓) 순.
  const group = rows
    .filter((r) => matchRoundFilter(r, kindFilter))
    .sort((a, b) => {
      if (kindFilter === 'rolling') return a.sort - b.sort
      const av = a.examDate || '9999-99-99'
      const bv = b.examDate || '9999-99-99'
      return kindFilter === 'past' ? bv.localeCompare(av) : av.localeCompare(bv) // 지난 시험은 최근순
    })
  const isReg = draft?.kind === 'regular'

  return (
    <>
      <div className="admin-head">
        <h1>시험 일정 관리</h1>
        <div className="admin-head-actions">
          <span className="admin-count">총 {rows.length}건</span>
          <button className="admin-mini" onClick={load} disabled={loading}>
            새로고침
          </button>
          <button className="admin-mini" onClick={openNew}>
            + 새 일정
          </button>
        </div>
      </div>

      {err && <div className="admin-section admin-empty">불러오기 실패 — {err}</div>}

      {/* 유형 세그먼트 — 정기 / 상시 / 지난 시험(지난 정기, 시험일 다음날 0시부터) */}
      <div className="admin-tabs" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
        {ROUND_FILTERS.map((f) => {
          const count = rows.filter((r) => matchRoundFilter(r, f.key)).length
          return (
            <button key={f.key} className={kindFilter === f.key ? 'on' : ''} onClick={() => setKindFilter(f.key)}>
              {f.label}
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
              {kindFilter === 'rolling' && <th style={{ textAlign: 'center' }}>순서</th>}
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
                {kindFilter === 'rolling' && (
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                    <button
                      className="admin-mini"
                      disabled={busy || i === 0}
                      onClick={() => move(r, -1)}
                      aria-label="위로"
                      title="위로"
                    >
                      ↑
                    </button>
                    <button
                      className="admin-mini"
                      style={{ marginLeft: 4 }}
                      disabled={busy || i === group.length - 1}
                      onClick={() => move(r, 1)}
                      aria-label="아래로"
                      title="아래로"
                    >
                      ↓
                    </button>
                  </td>
                )}
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="admin-mini" onClick={() => openEdit(r)}>
                    편집
                  </button>
                  <button className="admin-mini" style={{ marginLeft: 6 }} onClick={() => remove(r)}>
                    삭제
                  </button>
                </td>
              </tr>
            ))}
            {!group.length && !loading && (
              <tr>
                <td colSpan={kindFilter === 'rolling' ? 6 : 5} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                  {kindFilter === 'past' ? '지난 시험이 없습니다.' : '이 유형의 일정이 없습니다. “+ 새 일정”으로 추가하세요.'}
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
              <button className="admin-mini" onClick={() => setDraft(null)} disabled={saving}>
                취소
              </button>
              <button className="btn-ink" onClick={save} disabled={saving}>
                {saving ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
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
          <button className="admin-mini" onClick={load} disabled={busy}>
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
        <button className="btn-ink" onClick={add} disabled={busy || !email.trim()}>
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
                    <button className="admin-mini" onClick={() => remove(a.email)} disabled={busy}>
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

// ── 주관식 채점 (admin 함수의 gradeQueue/gradeAnswer) ──
//   대기 목록에서 O/X 채점, "채점 완료 포함" 토글로 재채점(수정), 각 항목에서 그 응시의 객관식 답안 참고 조회.
function fmtDTShort(iso?: string | null) {
  if (!iso) return '-'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '-' : d.toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function GradingAdmin() {
  const [items, setItems] = useState<GradeQueueItem[]>([])
  const [scope, setScope] = useState<'pending' | 'all'>('pending')
  const [round, setRound] = useState<string>('') // '' = 전체, roundId, 'none' = 상시/미배정
  const [rounds, setRounds] = useState<GradeRound[]>([])
  const [unassigned, setUnassigned] = useState(0)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null) // 채점 중인 answerId
  const [mcFor, setMcFor] = useState<GradeQueueItem | null>(null) // 객관식 참고 조회 대상
  const [open, setOpen] = useState<Set<string>>(new Set()) // 펼친 응시(attemptId)
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const loadRounds = useCallback(async () => {
    try {
      const r = await callFunction<GradeRoundsResponse>('admin', { action: 'gradeRounds' })
      setRounds(r.rounds)
      setUnassigned(r.unassigned)
    } catch {
      /* 회차 목록 실패해도 채점은 가능 */
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const r = await callFunction<GradeQueueResponse>('admin', { action: 'gradeQueue', scope, roundId: round || undefined })
      setItems(r.items)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '불러오기 실패')
    } finally {
      setLoading(false)
    }
  }, [scope, round])
  useEffect(() => {
    load()
  }, [load])
  useEffect(() => {
    loadRounds()
  }, [loadRounds])
  useEffect(() => {
    setOpen(new Set()) // 회차/범위 바뀌면 펼침 초기화
  }, [scope, round])

  async function grade(it: GradeQueueItem, correct: boolean) {
    setBusy(it.answerId)
    try {
      await callFunction('admin', { action: 'gradeAnswer', answerId: it.answerId, correct })
      if (scope === 'pending') {
        // 대기만 보는 중 — 채점하면 목록에서 제거
        setItems((prev) => prev.filter((x) => x.answerId !== it.answerId))
      } else {
        setItems((prev) => prev.map((x) => (x.answerId === it.answerId ? { ...x, isCorrect: correct, reviewStatus: 'graded' } : x)))
      }
      loadRounds() // 회차별 대기 수 갱신
    } catch (e) {
      alert(e instanceof Error ? e.message : '채점 실패')
    } finally {
      setBusy(null)
    }
  }

  const pendingN = items.filter((i) => i.reviewStatus === 'pending').length
  const regular = rounds.filter((r) => r.kind === 'regular')

  // 응시(attempt)별로 묶는다 — 응시자 한 명이 여러 주관식을 한 카드묶음으로(끝없이 길어지는 문제 해결).
  const groups: { attemptId: string; userName: string | null; userEmail: string | null; examTitle: string | null; submittedAt: string | null; items: GradeQueueItem[] }[] = []
  {
    const byId = new Map<string, (typeof groups)[number]>()
    for (const it of items) {
      let g = byId.get(it.attemptId)
      if (!g) {
        g = { attemptId: it.attemptId, userName: it.userName, userEmail: it.userEmail, examTitle: it.examTitle, submittedAt: it.submittedAt, items: [] }
        byId.set(it.attemptId, g)
        groups.push(g)
      }
      g.items.push(it)
    }
  }

  return (
    <>
      <div className="admin-head">
        <h1>주관식 채점</h1>
        <div className="admin-head-actions">
          <span className="admin-count">대기 {scope === 'pending' ? items.length : pendingN}건</span>
          <label className="grade-round">
            <span className="grade-round-lab">회차</span>
            <select value={round} onChange={(e) => setRound(e.target.value)}>
              <option value="">전체</option>
              {regular.map((r) => (
                <option key={r.roundId} value={r.roundId}>{r.title}{r.pending ? ` (${r.pending})` : ''}</option>
              ))}
              <option value="none">상시·미배정{unassigned ? ` (${unassigned})` : ''}</option>
            </select>
          </label>
          <div className="admin-tabs" style={{ marginBottom: 0 }}>
            <button className={scope === 'pending' ? 'on' : ''} onClick={() => setScope('pending')}>채점 대기</button>
            <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>완료 포함(수정)</button>
          </div>
          <button className="admin-mini" onClick={() => { load(); loadRounds() }} disabled={loading}>새로고침</button>
        </div>
      </div>

      {err && <div className="admin-section admin-empty">불러오기 실패 — {err}</div>}
      {loading && <div className="admin-section" style={{ color: 'var(--muted)' }}>불러오는 중…</div>}
      {!loading && !err && groups.length === 0 && (
        <div className="admin-section admin-empty">{scope === 'pending' ? '채점 대기 중인 주관식 답안이 없습니다.' : '주관식 답안이 없습니다.'}</div>
      )}

      {/* 응시자(응시)별로 접힌 목록 → 클릭하면 그 사람 주관식 문항이 펼쳐진다 */}
      <div className="grade-groups">
        {groups.map((g) => {
          const isOpen = open.has(g.attemptId)
          const pend = g.items.filter((x) => x.reviewStatus === 'pending').length
          return (
            <div key={g.attemptId} className={`grade-group ${isOpen ? 'open' : ''}`}>
              <button className="grade-group-head" onClick={() => toggle(g.attemptId)} aria-expanded={isOpen}>
                <span className="material-symbols-outlined ggh-caret">{isOpen ? 'expand_more' : 'chevron_right'}</span>
                <span className="ggh-who">
                  <b>{g.userName || '이름없음'}</b>
                  <span>{g.userEmail}</span>
                </span>
                <span className="ggh-meta">{g.examTitle} · 제출 {fmtDTShort(g.submittedAt)}</span>
                <span className={`ggh-count ${pend ? 'pend' : 'done'}`}>
                  {scope === 'pending'
                    ? `주관식 ${g.items.length}문항`
                    : pend
                      ? `대기 ${pend} · 완료 ${g.items.length - pend}`
                      : `완료 ${g.items.length}`}
                </span>
              </button>
              {isOpen && (
                <div className="grade-group-body">
                  {g.items.map((it) => (
                    <GradeCard key={it.answerId} it={it} busy={busy} onGrade={grade} onMc={setMcFor} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {mcFor && <McReviewModal item={mcFor} onClose={() => setMcFor(null)} />}
    </>
  )
}

// 주관식 답안 1건 카드 — 그룹(응시자) 펼침 안에서 렌더.
function GradeCard({ it, busy, onGrade, onMc }: {
  it: GradeQueueItem
  busy: string | null
  onGrade: (it: GradeQueueItem, correct: boolean) => void
  onMc: (it: GradeQueueItem) => void
}) {
  const done = it.reviewStatus === 'graded'
  return (
    <div className={`grade-card ${done ? (it.isCorrect ? 'ok' : 'no') : ''}`}>
      <div className="grade-top">
        <div className="grade-meta">
          {it.number}번 · {it.subject}
          {done && (
            <span className={`grade-badge ${it.isCorrect ? 'ok' : 'no'}`}>{it.isCorrect ? '정답 처리' : '오답 처리'}</span>
          )}
        </div>
      </div>

      <div className="grade-q">
        <p className="grade-q-prompt">{it.prompt}</p>
      </div>

      {it.answerKey && (
        <div className="grade-key">
          <span className="grade-label">모범답안 / 채점 기준</span>
          <p>{it.answerKey}</p>
        </div>
      )}

      <div className="grade-ans">
        <span className="grade-label">응시자 답안</span>
        <p>{it.answerText?.trim() ? it.answerText : <em className="grade-empty">(무응답)</em>}</p>
      </div>

      <div className="grade-actions">
        <button className={`grade-btn ok ${done && it.isCorrect ? 'active' : ''}`} disabled={busy === it.answerId} onClick={() => onGrade(it, true)}>
          <span className="material-symbols-outlined">check_circle</span>
          {done ? '정답으로 수정' : '정답'}
        </button>
        <button className={`grade-btn no ${done && !it.isCorrect ? 'active' : ''}`} disabled={busy === it.answerId} onClick={() => onGrade(it, false)}>
          <span className="material-symbols-outlined">cancel</span>
          {done ? '오답으로 수정' : '오답'}
        </button>
        <button className="admin-mini" style={{ marginLeft: 'auto' }} onClick={() => onMc(it)}>
          이 응시 객관식 보기
        </button>
      </div>
    </div>
  )
}

// 채점 참고용 — 해당 응시의 객관식 답안(정오답)을 조회해 보여준다.
function McReviewModal({ item, onClose }: { item: GradeQueueItem; onClose: () => void }) {
  const [answers, setAnswers] = useState<AdminAnswerRow[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    callFunction<AdminDetailResponse>('admin', { action: 'detail', attemptId: item.attemptId })
      .then((r) => setAnswers(r.answers.filter((a) => a.kind !== 'short')))
      .catch((e) => setErr(e instanceof Error ? e.message : '불러오기 실패'))
  }, [item.attemptId])

  return (
    <div className="admin-modal-bg" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <button className="admin-modal-x" onClick={onClose}>✕</button>
        <h2>{item.userName || '-'} <span className="admin-modal-email">{item.userEmail}</span></h2>
        <p className="admin-modal-meta">{item.examTitle} · 객관식 답안(참고)</p>
        {err && <div className="admin-empty">{err}</div>}
        {!answers && !err && <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>불러오는 중…</div>}
        {answers && (
          <div className="admin-ans-list">
            {answers.map((a) => (
              <div key={a.answerId} className={`admin-ans ${a.isCorrect ? 'ok' : 'no'}`}>
                <span className="admin-ans-no">{a.number}</span>
                <span className="admin-ans-q">{a.prompt}</span>
                <span className="admin-ans-pick">
                  {a.selectedIndex === null ? '미응답' : `${a.selectedIndex + 1}번`} / 정답 {a.correctIndex + 1}번
                </span>
              </div>
            ))}
            {!answers.length && <div className="admin-empty">객관식 문항이 없습니다.</div>}
          </div>
        )}
      </div>
    </div>
  )
}

// ── 대시보드 (운영 분석) — admin.css(레벨테스트) 클래스 그대로 사용 ──
function MiniBars({ days, map, color }: { days: string[]; map: Record<string, number>; color: string }) {
  const vals = days.map((d) => map[d] ?? 0)
  const max = Math.max(1, ...vals)
  const sum = vals.reduce((x, y) => x + y, 0)
  return (
    <>
      <div className="mini-bars">
        {days.map((d, i) => (
          <div key={d} className="mini-bar">
            <div className="fill" style={{ height: `${(vals[i] / max) * 100}%`, background: color }} />
            <div className="mini-tip"><span>{d.slice(5)}</span><b>{vals[i]}</b></div>
          </div>
        ))}
      </div>
      <div className="mini-foot">{days[0]?.slice(5)} ~ {days[days.length - 1]?.slice(5)} · 합계 {sum}</div>
    </>
  )
}

function HBar({ label, value, max, sub }: { label: string; value: number; max: number; sub?: string }) {
  return (
    <div className="hbar">
      <span className="hbar-l" title={label}>{label}</span>
      <div className="hbar-track"><div className="hbar-fill" style={{ width: `${max ? Math.min(100, (value / max) * 100) : 0}%` }} /></div>
      <span className="hbar-v">{value}{sub ?? ''}</span>
    </div>
  )
}

// 기간 선택(7/30/90 + 사용자지정 날짜). 추이·결제 차트 공용.
type DayRange = { preset: number; from: string; to: string } // preset 0 = 사용자지정
function useDayRange(days: string[], def = 30): [DayRange, (r: DayRange) => void, string[]] {
  const last = days[days.length - 1] ?? ''
  const [r, setR] = useState<DayRange>({ preset: def, from: days[Math.max(0, days.length - def)] ?? days[0] ?? '', to: last })
  const view = r.preset ? days.slice(-r.preset) : days.filter((d) => (!r.from || d >= r.from) && (!r.to || d <= r.to))
  return [r, setR, view]
}
function RangeControl({ value, onChange, days }: { value: DayRange; onChange: (r: DayRange) => void; days: string[] }) {
  const first = days[0] ?? ''
  const last = days[days.length - 1] ?? ''
  return (
    <div className="rng">
      {[7, 30, 90].map((p) => (
        <button key={p} className={value.preset === p ? 'on' : ''} onClick={() => onChange({ preset: p, from: days[Math.max(0, days.length - p)] ?? first, to: last })}>{p}일</button>
      ))}
      <input type="date" className="rng-date" min={first} max={last} value={value.from} onChange={(e) => onChange({ preset: 0, from: e.target.value, to: value.to || last })} />
      <span className="rng-tilde">~</span>
      <input type="date" className="rng-date" min={first} max={last} value={value.to} onChange={(e) => onChange({ preset: 0, from: value.from || first, to: e.target.value })} />
    </div>
  )
}
function TrendChart({ title, days, map, color }: { title: string; days: string[]; map: Record<string, number>; color: string }) {
  const [range, setRange, view] = useDayRange(days, 30)
  return (
    <div className="admin-section">
      <div className="admin-section-head">
        <h3>{title}</h3>
        <RangeControl value={range} onChange={setRange} days={days} />
      </div>
      <MiniBars days={view} map={map} color={color} />
    </div>
  )
}

function DiffRows({ rows, empty }: { rows: CbtQDiff[]; empty: string }) {
  if (!rows.length) return <div className="admin-empty">{empty}</div>
  return (
    <div className="diff-list">
      {rows.map((r) => (
        <div key={r.id} className={`diff-item ${r.rate < 35 ? 'hard' : ''} ${!r.active ? 'off' : ''}`}>
          <div className="diff-head" style={{ cursor: 'default' }}>
            <span className={`diff-rate ${r.rate < 35 ? 'low' : r.rate > 90 ? 'high' : ''}`}>{r.rate}%</span>
            <span className="diff-q">{r.number}. {r.prompt}</span>
            <span className="diff-meta">{r.subject}{r.exam ? ` · ${r.exam}` : ''} · 응시 {r.n}{!r.active ? ' · 비활성' : ''}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function DashboardAdmin({ onNav }: { onNav: (t: CarisSub, f?: SubsFilter) => void }) {
  const [a, setA] = useState<CbtAnalytics | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      setA(await callFunction<CbtAnalytics>('admin', { action: 'cbtAnalytics' }))
    } catch (e) {
      setErr(e instanceof Error ? e.message : '불러오기 실패')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  return (
    <>
      <div className="admin-head">
        <h1>대시보드</h1>
        <div className="admin-head-actions">
          <button className="admin-mini" onClick={load} disabled={loading}>
            새로고침
          </button>
        </div>
      </div>
      {err && <div className="admin-section admin-empty">불러오기 실패 — {err}</div>}
      {loading && !a && <div className="admin-section" style={{ color: 'var(--muted)' }}>불러오는 중…</div>}
      {a && <DashboardBody a={a} onNav={onNav} />}
    </>
  )
}

// ── 시연용 데모 데이터 ─────────────────────────────────────────────
// DB에 결제/접수 테이블·티어별 개별시험이 아직 없어 하드코딩. 실연동 시 이 상수/생성기를 서버 데이터로 교체.
const won = (n: number) => `₩${n.toLocaleString()}`
function wonShort(n: number): string {
  if (n >= 1e8) return `₩${(n / 1e8).toFixed(n % 1e8 === 0 ? 0 : 1)}억`
  if (n >= 1e4) return `₩${Math.round(n / 1e4).toLocaleString()}만`
  return won(n)
}
// 문자열 → 0..1 안정 해시(데모값 생성 · 새로고침해도 동일)
function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return ((h >>> 0) % 100000) / 100000
}

const DEMO_PAY = {
  refundRate: 0.035,
  methods: [
    { k: '신용카드', n: 71 },
    { k: '계좌이체', n: 13 },
    { k: '간편결제', n: 6 },
  ],
  recent: [
    { name: '김민준', grade: 'Elite', amount: 55000, method: '신용카드', status: 'paid', at: '2026-07-07 14:22' },
    { name: '이서연', grade: 'Pro', amount: 40000, method: '간편결제', status: 'paid', at: '2026-07-07 11:05' },
    { name: '박도윤', grade: 'Master', amount: 80000, method: '계좌이체', status: 'paid', at: '2026-07-06 17:48' },
    { name: '최지우', grade: 'Pro', amount: 40000, method: '신용카드', status: 'refund', at: '2026-07-06 09:31' },
    { name: '정하준', grade: 'Beginner', amount: 30000, method: '신용카드', status: 'paid', at: '2026-07-05 20:14' },
    { name: '강수아', grade: 'Elite', amount: 55000, method: '신용카드', status: 'paid', at: '2026-07-05 13:02' },
    { name: '조은우', grade: 'Grand Master', amount: 100000, method: '계좌이체', status: 'paid', at: '2026-07-04 16:39' },
    { name: '윤서준', grade: 'Pro', amount: 40000, method: '간편결제', status: 'paid', at: '2026-07-04 10:12' },
  ],
}
// 날짜별 데모 매출(원) — 안정 해시(주말 낮음·간헐 0). 결제 차트/합계가 기간 선택에 반응.
function demoRevByDay(days: string[]): Record<string, number> {
  const m: Record<string, number> = {}
  for (const d of days) m[d] = hash01('z' + d) < 0.12 ? 0 : (Math.floor(hash01('rev' + d) * 26) + 3) * 10000
  return m
}

// admin 함수(구버전)가 신규 지표를 안 주면 쓰는 데모 폴백 — 재배포 시 실데이터로 자동 전환.
const DEMO_FB = {
  signups7d: 9, certIssued: 42, certPending: 8, resultPending: 5, inProgress: 2,
  pendingGrading: 11, openRounds: 2, nextExamDate: '2026-07-18' as string | null, avgScore: 73, avgDurationMin: 38,
}
const DEMO_ROUNDS: CbtRoundStat[] = [
  { id: 'd7', title: '제 2회 정기시험 (2027)', examDate: '2027-06-19', kind: 'regular', attempts: 12, pass: 8, cert: 5 },
  { id: 'd6', title: '제 4회 정기시험', examDate: '2026-10-17', kind: 'regular', attempts: 28, pass: 19, cert: 14 },
  { id: 'd5', title: '제 3회 정기시험', examDate: '2026-09-19', kind: 'regular', attempts: 41, pass: 30, cert: 26 },
  { id: 'd2', title: '제 2회 정기시험', examDate: '2026-08-15', kind: 'regular', attempts: 34, pass: 25, cert: 21 },
  { id: 'd1', title: '제 1회 정기시험', examDate: '2026-07-18', kind: 'regular', attempts: 52, pass: 39, cert: 37 },
  { id: 'd0', title: '상시 CBT', examDate: null, kind: 'rolling', attempts: 18, pass: 12, cert: 9 },
]

// 급수(티어)별 데모 통계 — /guide 의 getTracks subjects 로 라벨, 해시로 수치(재배포/티어 추적 전까지 사용).
interface TierStat {
  attempts: number
  pass: number
  passRate: number
  scoreHist: number[] // [0-59,60-69,70-79,80-89,90-100]
  subjects: { subject: string; rate: number; n: number }[]
  hard: CbtQDiff[]
  easy: CbtQDiff[]
  pool: { subject: string; total: number; active: number }[]
}
function tierStat(key: string, name: string, subjects: string[]): TierStat {
  const attempts = 24 + Math.floor(hash01('att' + key) * 176)
  const passRate = 48 + Math.floor(hash01('pr' + key) * 42)
  const pass = Math.round((attempts * passRate) / 100)
  const w = [0, 1, 2, 3, 4].map((i) => 0.4 + hash01('h' + key + i))
  const wSum = w.reduce((x, y) => x + y, 0)
  const scoreHist = w.map((x) => Math.round((x / wSum) * attempts))
  const subj = subjects.map((s, i) => ({
    subject: s,
    rate: 52 + Math.floor(hash01('sr' + key + i) * 44),
    n: Math.round(attempts * (0.6 + hash01('sn' + key + i) * 0.4)),
  }))
  const mkQ = (i: number, rate: number): CbtQDiff => ({
    id: `${key}-${i}`,
    number: 3 + Math.floor(hash01('qn' + key + i) * 38),
    subject: subjects[Math.floor(hash01('qs' + key + i) * subjects.length)] ?? subjects[0] ?? '과목',
    prompt: `${name} · ${subjects[Math.floor(hash01('qs' + key + i) * subjects.length)] ?? '개념'} 적용/해석 유형 문항`,
    exam: name,
    active: true,
    n: 12 + Math.floor(hash01('qnn' + key + i) * 60),
    rate,
  })
  const hard = [0, 1, 2, 3].map((i) => mkQ(i, 18 + Math.floor(hash01('hr' + key + i) * 20))).sort((x, y) => x.rate - y.rate)
  const easy = [0, 1, 2, 3].map((i) => mkQ(i + 10, 82 + Math.floor(hash01('er' + key + i) * 16))).sort((x, y) => y.rate - x.rate)
  const pool = subjects.map((s, i) => {
    const active = 3 + Math.floor(hash01('pa' + key + i) * 9)
    return { subject: s, active, total: active + Math.floor(hash01('pt' + key + i) * 5) }
  })
  return { attempts, pass, passRate, scoreHist, subjects: subj, hard, easy, pool }
}

function DashboardBody({ a, onNav }: { a: CbtAnalytics; onNav: (t: CarisSub, f?: SubsFilter) => void }) {
  const o = a.overview
  // 구버전 함수 호환: 신규 지표(certIssued)가 없으면 데모값으로 채우고 안내 배너 표시.
  const live = o.certIssued !== undefined
  const fb = <T,>(v: T | undefined, d: T): T => (v === undefined ? d : v)
  const signups7d = fb(o.signups7d, DEMO_FB.signups7d)
  const certIssued = fb(o.certIssued, DEMO_FB.certIssued)
  const certPending = fb(o.certPending, DEMO_FB.certPending)
  const resultPending = fb(o.resultPending, DEMO_FB.resultPending)
  const inProgress = fb(o.inProgress, DEMO_FB.inProgress)
  const pendingGrading = fb(o.pendingGrading, DEMO_FB.pendingGrading)
  const avgScore = fb(a.avgScore, DEMO_FB.avgScore)
  const rounds = a.rounds && a.rounds.length ? a.rounds : live ? [] : DEMO_ROUNDS

  // 결제 KPI(데모) — 최근 30일 매출 합계
  const demoRev = demoRevByDay(a.days)
  const pay30 = a.days.slice(-30).reduce((s, d) => s + (demoRev[d] || 0), 0)
  const payCount = Math.max(1, Math.round(pay30 / 52000))

  const actions = [
    { ico: 'rate_review', label: '주관식 채점 대기', n: pendingGrading, tone: 'amber', go: () => onNav('grading') },
    { ico: 'workspace_premium', label: '자격증 미발급(합격)', n: certPending, tone: 'blue', go: () => onNav('subs', 'passed') },
    { ico: 'schedule', label: '결과 공개 대기', n: resultPending, tone: 'muted', go: () => onNav('subs', 'result_pending') },
    { ico: 'timelapse', label: '응시 진행 중', n: inProgress, tone: 'muted', go: () => onNav('subs', 'in_progress') },
  ]
  const kpis = [
    { ico: 'group', k: '누적 회원', v: o.users.toLocaleString(), sub: `이번주 신규 +${signups7d}명`, accent: 'blue', delta: signups7d > 0 ? `+${signups7d}` : undefined },
    { ico: 'assignment_turned_in', k: '응시 제출', v: o.attemptsAll.toLocaleString(), sub: `최근 7일 ${o.attempts7d}건`, accent: 'violet' },
    { ico: 'verified', k: '합격률', v: `${a.passRate}%`, sub: `채점 ${a.scoredN}건 · 평균 ${avgScore}점`, accent: 'green' },
    { ico: 'workspace_premium', k: '자격증 발급', v: certIssued.toLocaleString(), sub: `미발급 ${certPending}건`, accent: 'amber' },
    { ico: 'payments', k: '매출(30일)', v: wonShort(pay30), sub: `결제 ${payCount}건 · 데모`, accent: 'green', demo: true },
  ]

  return (
    <div className="admin-dash">
      {!live && (
        <div className="admin-demo">
          ⓘ 자격증·회차·급수·평균 등 일부 지표는 <b>데모값</b>입니다 — <code>admin</code> 함수 재배포 후 실데이터로 자동 전환됩니다. 결제·급수별 분석은 실연동/티어 추적 전까지 데모입니다.
        </div>
      )}

      {/* KPI */}
      <div className="kpi-grid">
        {kpis.map((c) => <Kpi key={c.k} {...c} />)}
      </div>

      {/* 처리 대기(액션) */}
      <div className="admin-section-head" style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>처리 대기</h3>
        <span className="admin-hint">클릭하면 해당 화면(필터 적용)으로 이동</span>
      </div>
      <div className="act-grid">
        {actions.map((x) => (
          <button key={x.label} className={`act ${x.n > 0 ? `t-${x.tone}` : 'done'}`} onClick={x.go}>
            <span className="material-symbols-outlined act-ico">{x.n > 0 ? x.ico : 'check_circle'}</span>
            <span className="act-n">{x.n}</span>
            <span className="act-l">{x.label}</span>
          </button>
        ))}
      </div>

      {/* 결제(데모) */}
      <PaymentSection days={a.days} />

      {/* 추이 */}
      <div className="admin-grid2">
        <TrendChart title="가입 추이" days={a.days} map={a.signupByDay} color="var(--k-blue)" />
        <TrendChart title="응시(제출) 추이" days={a.days} map={a.submitByDay} color="var(--k-violet)" />
      </div>
      {a.certByDay && <TrendChart title="자격증 발급 추이" days={a.days} map={a.certByDay} color="var(--k-green)" />}

      {/* 급수별 분석 (/guide 자격 체계 기준) */}
      <TierAnalysis />

      {/* 회차별 현황 퍼널 */}
      <div className="admin-section">
        <h3>회차별 현황 <span className="admin-hint">응시 → 합격 → 자격증 발급</span></h3>
        <RoundFunnel rows={rounds} />
      </div>
    </div>
  )
}

// KPI 카드 — 아이콘 칩 + 값 + 증감/데모 배지 + 색상 액센트.
function Kpi({ ico, k, v, sub, accent, delta, demo }: {
  ico: string; k: string; v: string; sub: string; accent: string; delta?: string; demo?: boolean
}) {
  return (
    <div className={`kpi k-${accent}`}>
      <div className="kpi-top">
        <span className="material-symbols-outlined kpi-ico">{ico}</span>
        {demo ? <span className="kpi-tag">데모</span> : delta ? <span className="kpi-delta">▲ {delta}</span> : null}
      </div>
      <div className="kpi-k">{k}</div>
      <div className="kpi-v">{v}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  )
}

// 급수(티어)별 분석 — /guide 의 getTracks 를 그대로 selector 로. 급수 분포 막대 = 티어 선택기 겸용.
function TierAnalysis() {
  const tracks = getTracks('ko')
  const tiers = tracks.flatMap((tr) => tr.tiers.map((ti) => ({ track: tr.name, key: ti.key, name: ti.name, subjects: ti.subjects })))
  const [sel, setSel] = useState(tiers[1]?.key ?? tiers[0]?.key ?? '')
  const cur = tiers.find((t) => t.key === sel) ?? tiers[0]
  if (!cur) return null
  const dist = tiers.map((t) => ({ ...t, n: tierStat(t.key, t.name, t.subjects).attempts }))
  const distMax = Math.max(1, ...dist.map((d) => d.n))
  const st = tierStat(cur.key, cur.name, cur.subjects)
  const bands = ['0-59', '60-69', '70-79', '80-89', '90-100']
  const histMax = Math.max(1, ...st.scoreHist)
  const poolWarn = st.pool.filter((p) => p.active < 4)

  return (
    <div className="admin-section">
      <div className="admin-section-head">
        <h3>급수별 분석 <span className="admin-hint">/guide 자격 체계 기준</span></h3>
        <span className="admin-badge-demo">데모</span>
      </div>

      {/* 급수 분포 = 응시 수 막대 + 클릭 선택 */}
      <div className="admin-sub">급수 분포 · 응시 수 <span style={{ textTransform: 'none', fontWeight: 400, color: 'var(--dim)' }}>(막대 클릭 → 아래 상세 전환)</span></div>
      <div className="tier-dist">
        {dist.map((d) => (
          <button key={d.key} className={`tdist ${d.key === sel ? 'on' : ''}`} onClick={() => setSel(d.key)} title={`${d.track} · ${d.name} · 응시 ${d.n}`}>
            <span className="tdist-track">{d.track.replace('CARIS-', '')}</span>
            <span className="tdist-col"><span className="tdist-bar" style={{ height: `${(d.n / distMax) * 100}%` }} /></span>
            <span className="tdist-n">{d.n}</span>
            <span className="tdist-l">{d.name}</span>
          </button>
        ))}
      </div>

      {/* 선택 급수 상세 */}
      <div className="tier-detail">
        <div className="tier-detail-head">
          <b>{cur.track} · {cur.name}</b>
          <span>응시 <b>{st.attempts}</b> · 합격 <b>{st.pass}</b> ({st.passRate}%)</span>
        </div>
        <div className="admin-grid2">
          <div className="tier-panel">
            <div className="admin-sub">점수 분포</div>
            {bands.map((lb, i) => <HBar key={lb} label={`${lb}점`} value={st.scoreHist[i]} max={histMax} sub="명" />)}
          </div>
          <div className="tier-panel">
            <div className="admin-sub">과목별 정답률</div>
            {st.subjects.map((s) => <HBar key={s.subject} label={s.subject} value={s.rate} max={100} sub={`% (${s.n})`} />)}
          </div>
        </div>
        <div className="tier-panel" style={{ marginTop: 14 }}>
          <div className="admin-sub">⚠ 어려운 문항 <span style={{ textTransform: 'none', fontWeight: 400, color: 'var(--dim)' }}>정답률 낮은 순</span></div>
          <DiffRows rows={st.hard} empty="—" />
        </div>
        <div className="tier-panel" style={{ marginTop: 14 }}>
          <div className="admin-sub">쉬운 문항 <span style={{ textTransform: 'none', fontWeight: 400, color: 'var(--dim)' }}>정답률 높은 순</span></div>
          <DiffRows rows={st.easy} empty="—" />
        </div>
        <div className="tier-panel" style={{ marginTop: 14 }}>
          <div className="admin-sub">과목별 문항 풀 <span style={{ textTransform: 'none', fontWeight: 400, color: 'var(--dim)' }}>활성 4개 이상 권장</span></div>
          {poolWarn.length ? <div className="admin-warn">⚠ 활성 4개 미만: {poolWarn.map((p) => p.subject).join(' · ')}</div> : null}
          <table className="admin-table pool-table">
            <thead>
              <tr><th>과목</th><th>활성</th><th>전체</th><th>상태</th></tr>
            </thead>
            <tbody>
              {st.pool.map((p) => {
                const ok = p.active >= 4
                return (
                  <tr key={p.subject} className={ok ? '' : 'prob'}>
                    <td>{p.subject}</td>
                    <td><b>{p.active}</b></td>
                    <td>{p.total}</td>
                    <td>{ok ? <span className="badge ok">충분</span> : <span className="badge low">부족</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// 회차별 응시→합격→발급 퍼널 표 (페이징 5행/쪽).
function RoundFunnel({ rows }: { rows: CbtRoundStat[] }) {
  const [page, setPage] = useState(0)
  const PER = 5
  if (!rows.length) return <div className="admin-empty">회차 응시 데이터가 없습니다.</div>
  const pageMax = Math.max(1, Math.ceil(rows.length / PER))
  const shown = rows.slice(page * PER, page * PER + PER)
  return (
    <>
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>회차</th>
            <th>시험일</th>
            <th style={{ textAlign: 'right' }}>응시</th>
            <th style={{ textAlign: 'right' }}>합격</th>
            <th style={{ textAlign: 'right' }}>합격률</th>
            <th style={{ textAlign: 'right' }}>발급</th>
            <th style={{ minWidth: 130 }}>진행</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const passRate = r.attempts ? Math.round((r.pass / r.attempts) * 100) : 0
            const certRate = r.attempts ? Math.round((r.cert / r.attempts) * 100) : 0
            return (
              <tr key={r.id}>
                <td><b>{r.title}</b></td>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{r.kind === 'rolling' ? '상시' : r.examDate ?? '-'}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.attempts}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.pass}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{passRate}%</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.cert}</td>
                <td>
                  <div className="fn-bar" title={`합격 ${passRate}% · 발급 ${certRate}%`}>
                    <div className="fn-pass" style={{ width: `${passRate}%` }} />
                    <div className="fn-cert" style={{ width: `${certRate}%` }} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
    {pageMax > 1 && (
      <div className="admin-pager" style={{ marginTop: 12 }}>
        <button className="admin-mini" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>‹ 이전</button>
        <span>{page + 1} / {pageMax}</span>
        <button className="admin-mini" disabled={page + 1 >= pageMax} onClick={() => setPage((p) => p + 1)}>다음 ›</button>
      </div>
    )}
    </>
  )
}

// 결제 현황(시연용 하드코딩) — 기간 선택 반응. 실연동 전까지 데모.
function PaymentSection({ days }: { days: string[] }) {
  const [range, setRange, view] = useDayRange(days, 30)
  const revMap = demoRevByDay(days)
  const series = view.map((d) => revMap[d] ?? 0)
  const total = series.reduce((s, v) => s + v, 0)
  const max = Math.max(1, ...series)
  const count = Math.max(1, Math.round(total / 52000))
  const refunds = Math.max(0, Math.round(count * DEMO_PAY.refundRate))
  const aov = count ? Math.round(total / count) : 0
  const methodTotal = DEMO_PAY.methods.reduce((s, m) => s + m.n, 0)
  const rangeLabel = range.preset ? `최근 ${range.preset}일` : `${range.from || '?'} ~ ${range.to || '?'}`
  return (
    <div className="admin-section pay-sec">
      <div className="admin-section-head">
        <h3><span className="material-symbols-outlined pay-ico">credit_card</span>결제 현황</h3>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <RangeControl value={range} onChange={setRange} days={days} />
          <span className="admin-badge-demo">데모</span>
        </div>
      </div>
      <div className="pay-kpis">
        <div><span className="pk-k">매출 · {rangeLabel}</span><span className="pk-v">{won(total)}</span></div>
        <div><span className="pk-k">결제 건수</span><span className="pk-v">{count}건</span></div>
        <div><span className="pk-k">환불</span><span className="pk-v">{refunds}건</span></div>
        <div><span className="pk-k">객단가</span><span className="pk-v">{won(aov)}</span></div>
      </div>
      <div className="pay-grid">
        <div>
          <div className="admin-sub">일별 매출 · {rangeLabel}</div>
          <div className="mini-bars" style={{ height: 76 }}>
            {view.map((d) => (
              <div key={d} className="mini-bar">
                <div className="fill" style={{ height: `${(revMap[d] / max) * 100}%`, background: 'var(--k-green)' }} />
                <div className="mini-tip"><span>{d.slice(5)}</span><b>{won(revMap[d] ?? 0)}</b></div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="admin-sub">결제 수단</div>
          {DEMO_PAY.methods.map((m) => <HBar key={m.k} label={m.k} value={m.n} max={methodTotal} sub="건" />)}
        </div>
      </div>
      <div className="admin-sub">최근 결제</div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr><th>응시자</th><th>급수</th><th style={{ textAlign: 'right' }}>금액</th><th>수단</th><th>상태</th><th>일시</th></tr>
          </thead>
          <tbody>
            {DEMO_PAY.recent.map((r, i) => (
              <tr key={i}>
                <td>{r.name}</td>
                <td>{r.grade}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{won(r.amount)}</td>
                <td style={{ color: 'var(--muted)' }}>{r.method}</td>
                <td><span className={`admin-badge st-${r.status === 'refund' ? 'voided' : 'submitted'}`}>{r.status === 'refund' ? '환불' : '완료'}</span></td>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{r.at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── 회원 관리 (목록 · 상세) ────────────────────────────────────────
function UsersAdmin() {
  const [users, setUsers] = useState<CbtUserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'created' | 'attempts'>('created')
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<CbtUserRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const r = await callFunction<CbtUsersResp>('admin', { action: 'cbtUsers' })
      setUsers(r.users)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '불러오기 실패')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])
  useEffect(() => {
    setPage(0)
  }, [q, sort])

  const filtered = users
    .filter((u) => {
      if (q) {
        const s = q.toLowerCase()
        if (!(u.name || '').toLowerCase().includes(s) && !(u.email || '').toLowerCase().includes(s)) return false
      }
      return true
    })
    .sort((x, y) => (sort === 'attempts' ? y.attempts - x.attempts : (y.created || '').localeCompare(x.created || '')))
  const PER = 50
  const pageMax = Math.max(1, Math.ceil(filtered.length / PER))
  const shown = filtered.slice(page * PER, page * PER + PER)

  return (
    <>
      <div className="admin-head">
        <h1>회원 관리</h1>
        <div className="admin-head-actions">
          <span className="admin-count">회원 {users.length}명</span>
          <button className="admin-mini" onClick={load} disabled={loading}>
            새로고침
          </button>
        </div>
      </div>
      {err && <div className="admin-section admin-empty">불러오기 실패 — {err}</div>}

      <div className="admin-toolbar">
        <select value={sort} onChange={(e) => setSort(e.target.value as 'created' | 'attempts')}>
          <option value="created">가입 최신순</option>
          <option value="attempts">응시 많은순</option>
        </select>
        <input className="admin-search" placeholder="이름·이메일 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="admin-hint">{filtered.length}명</span>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>이름</th>
              <th>이메일</th>
              <th>가입</th>
              <th style={{ textAlign: 'right' }}>응시</th>
              <th>마지막 활동</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id}>
                <td>{u.name || '-'}</td>
                <td style={{ color: 'var(--muted)' }}>{u.email || '-'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDT(u.created)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{u.attempts}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDT(u.lastActive)}</td>
                <td>
                  <button className="admin-mini" onClick={() => setOpen(u)}>상세</button>
                </td>
              </tr>
            ))}
            {!shown.length && !loading && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                  회원이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pageMax > 1 && (
        <div className="admin-pager">
          <button className="admin-mini" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            ‹ 이전
          </button>
          <span>{page + 1} / {pageMax}</span>
          <button className="admin-mini" disabled={page + 1 >= pageMax} onClick={() => setPage((p) => p + 1)}>
            다음 ›
          </button>
        </div>
      )}
      {open && <UserDetailModal user={open} onClose={() => setOpen(null)} />}
    </>
  )
}

function UserDetailModal({ user, onClose }: { user: CbtUserRow; onClose: () => void }) {
  const [detail, setDetail] = useState<CbtUserDetailResp | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    callFunction<CbtUserDetailResp>('admin', { action: 'cbtUserDetail', userId: user.id })
      .then(setDetail)
      .catch(() => setDetail({ attempts: [] }))
      .finally(() => setLoading(false))
  }, [user.id])
  return (
    <div className="admin-modal-bg" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <button className="admin-modal-x" onClick={onClose}>
          ✕
        </button>
        <h2>
          {user.name || '-'} <span className="admin-modal-email">{user.email}</span>
        </h2>
        <p className="admin-modal-meta">
          가입 {fmtDT(user.created)} · 응시 {user.attempts}건
        </p>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>불러오는 중…</div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>시험</th>
                  <th>상태</th>
                  <th>점수</th>
                  <th>제출</th>
                </tr>
              </thead>
              <tbody>
                {(detail?.attempts ?? []).map((at) => (
                  <tr key={at.id}>
                    <td>{at.examTitle || '-'}</td>
                    <td>
                      <span className={`admin-badge st-${at.status}`}>{STATUS_LABEL[at.status] ?? at.status}</span>
                    </td>
                    <td>{at.totalCorrect != null ? `${at.totalCorrect} / ${at.totalQuestions}` : '-'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDT(at.submittedAt)}</td>
                  </tr>
                ))}
                {!(detail?.attempts ?? []).length && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>
                      응시 이력이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 문항 관리 (목록 · 이력 · 엑셀 업로드) ──────────────────────────
function QuestionsAdmin() {
  const [exams, setExams] = useState<AdminExamItem[]>([])
  const [examId, setExamId] = useState<string>('')
  const [view, setView] = useState<'list' | 'events' | 'import'>('list')

  const loadExams = useCallback(async () => {
    try {
      const r = await callFunction<AdminExamListResp>('admin', { action: 'examListForAdmin' })
      setExams(r.exams)
      setExamId((cur) => cur || r.exams[0]?.id || '')
    } catch {
      /* 무시 */
    }
  }, [])
  useEffect(() => {
    loadExams()
  }, [loadExams])

  return (
    <>
      <div className="admin-head">
        <h1>문항 관리</h1>
        <div className="admin-head-actions">
          <select style={{ minWidth: 220 }} value={examId} onChange={(e) => setExamId(e.target.value)}>
            {exams.length === 0 && <option value="">시험 없음</option>}
            {exams.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.title} ({ex.activeCount}/{ex.questionCount})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="admin-tabs" style={{ marginBottom: 16 }}>
        <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
          문항 목록
        </button>
        <button className={view === 'events' ? 'on' : ''} onClick={() => setView('events')}>
          문항 이력
        </button>
        <button className={view === 'import' ? 'on' : ''} onClick={() => setView('import')}>
          엑셀 업로드
        </button>
      </div>

      {!examId ? (
        <div className="admin-section admin-empty">등록된 시험이 없습니다. 먼저 시험(exams)을 만들어 주세요.</div>
      ) : view === 'list' ? (
        <QuestionListView examId={examId} onChanged={loadExams} />
      ) : view === 'events' ? (
        <QuestionEventsView examId={examId} onChanged={loadExams} />
      ) : (
        <QuestionImportView examId={examId} onImported={loadExams} />
      )}
    </>
  )
}

function QuestionListView({ examId, onChanged }: { examId: string; onChanged: () => void }) {
  const [rows, setRows] = useState<AdminQuestionRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [edit, setEdit] = useState<AdminQuestionRow | 'new' | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const r = await callFunction<AdminQuestionListResp>('admin', { action: 'questionList', examId })
      setRows(r.rows)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '불러오기 실패')
    } finally {
      setLoading(false)
    }
  }, [examId])
  useEffect(() => {
    load()
  }, [load])

  async function act(action: string, id: string, extra?: object) {
    setBusy(true)
    try {
      await callFunction('admin', { action, id, ...extra })
      await load()
      onChanged()
    } catch (e) {
      alert(e instanceof Error ? e.message : '처리 실패')
    } finally {
      setBusy(false)
    }
  }

  const nextNumber = rows.reduce((m, q) => Math.max(m, q.number), 0) + 1

  return (
    <>
      <div className="admin-head" style={{ marginTop: 0 }}>
        <span className="admin-count">총 {rows.length}문항</span>
        <div className="admin-head-actions">
          <button className="admin-mini" onClick={() => setEdit('new')}>+ 문항 추가</button>
          <button className="admin-mini" onClick={load} disabled={loading}>
            새로고침
          </button>
        </div>
      </div>
      {err && <div className="admin-section admin-empty">불러오기 실패 — {err}</div>}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>#</th>
              <th>유형</th>
              <th>과목</th>
              <th>지문</th>
              <th>정답</th>
              <th>상태</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => (
              <tr key={q.id} style={{ opacity: q.active ? 1 : 0.55 }}>
                <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{q.number}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <span className={`admin-badge st-${q.kind === 'short' ? 'in_progress' : 'submitted'}`}>{q.kind === 'short' ? '주관식' : '객관식'}</span>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <b>{q.subject}</b>
                </td>
                <td style={{ maxWidth: 340 }}>{q.prompt}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{q.kind === 'short' ? <span style={{ color: 'var(--muted)' }}>검수 채점</span> : `${(q.correct_index ?? 0) + 1}번`}</td>
                <td>
                  <span className={`admin-badge st-${q.active ? 'submitted' : 'voided'}`}>{q.active ? '활성' : '비활성'}</span>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="admin-mini" disabled={busy} onClick={() => setEdit(q)}>수정</button>
                  <button className="admin-mini" style={{ marginLeft: 6 }} disabled={busy} onClick={() => act('questionSetActive', q.id, { active: !q.active })}>
                    {q.active ? '비활성' : '활성'}
                  </button>
                  <button
                    className="admin-mini"
                    style={{ marginLeft: 6 }}
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`${q.number}번 문항을 삭제할까요? (이력에서 복구 가능)`)) act('questionDelete', q.id)
                    }}
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                  문항이 없습니다. “+ 문항 추가” 또는 “엑셀 업로드”로 추가하세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {edit && (
        <QuestionEditModal
          examId={examId}
          row={edit === 'new' ? null : edit}
          defaultNumber={nextNumber}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); load(); onChanged() }}
        />
      )}
    </>
  )
}

// 문항 편집 폼 인라인 스타일(전역 .admin label 규칙에 밀리지 않도록 div+인라인으로 고정)
const QE: Record<string, CSSProperties> = {
  row: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  field: { display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'left', minWidth: 0 },
  lab: { fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--muted)' },
}

// 개별 문항 추가/편집 — 유형(객관식/주관식) 선택 → 객관식은 보기4·정답, 주관식은 모범답안.
function QuestionEditModal({ examId, row, defaultNumber, onClose, onSaved }: {
  examId: string; row: AdminQuestionRow | null; defaultNumber: number; onClose: () => void; onSaved: () => void
}) {
  const [number] = useState<number>(row?.number ?? defaultNumber) // 자동 부여(수정 불가)
  const [kind, setKind] = useState<'mc' | 'short'>(row?.kind ?? 'mc')
  // /guide 급수(티어) → 과목 종속 드롭박스. 티어 목록은 getTracks(=/guide) 단일 출처.
  const tiers = getTracks('ko').flatMap((tr) => tr.tiers.map((ti) => ({ track: tr.name, key: ti.key, name: ti.name, subjects: ti.subjects })))
  const [tierKey, setTierKey] = useState(
    (row?.subject ? tiers.find((t) => t.subjects.includes(row.subject)) : undefined)?.key ?? tiers[0]?.key ?? '',
  )
  const curTier = tiers.find((t) => t.key === tierKey) ?? tiers[0]
  const [subject, setSubject] = useState(row?.subject ?? curTier?.subjects[0] ?? '')
  const baseSubjects = curTier?.subjects ?? []
  // 편집 중 기존 과목이 현재 급수 목록에 없으면(레거시 자유입력) 옵션에 그대로 유지
  const subjectOptions = subject && !baseSubjects.includes(subject) ? [subject, ...baseSubjects] : baseSubjects
  const [prompt, setPrompt] = useState(row?.prompt ?? '')
  const [choices, setChoices] = useState<string[]>(() => {
    const c = row?.choices ?? []
    return [c[0] ?? '', c[1] ?? '', c[2] ?? '', c[3] ?? '']
  })
  const [correctIndex, setCorrectIndex] = useState<number>(row?.correct_index ?? 0)
  const [answerKey, setAnswerKey] = useState(row?.answer_key ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    setErr('')
    setSaving(true)
    try {
      await callFunction('admin', {
        action: 'questionUpsert',
        question: { id: row?.id, examId, number, kind, subject, prompt, choices, correctIndex, answerKey, active: row ? row.active : true },
      })
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '저장 실패')
      setSaving(false)
    }
  }

  return (
    <div className="admin-modal-bg" onClick={onClose}>
      <div className="admin-modal" style={{ textAlign: 'left' }} onClick={(e) => e.stopPropagation()}>
        <button className="admin-modal-x" onClick={onClose}>✕</button>
        <h2>{row ? `${row.number}번 문항 수정` : '문항 추가'}</h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12, textAlign: 'left' }}>
          <div style={QE.row}>
            <div style={{ ...QE.field, width: 110, flex: 'none' }}>
              <span style={QE.lab}>번호</span>
              <input className="admin-in" value={number} readOnly disabled title="번호는 자동 부여됩니다" style={{ opacity: 0.6, cursor: 'not-allowed' }} />
            </div>
            <div style={{ ...QE.field, flex: 1 }}>
              <span style={QE.lab}>유형</span>
              <select className="admin-in" value={kind} onChange={(e) => setKind(e.target.value as 'mc' | 'short')}>
                <option value="mc">객관식</option>
                <option value="short">주관식</option>
              </select>
            </div>
          </div>
          <div style={QE.row}>
            <div style={{ ...QE.field, flex: 1 }}>
              <span style={QE.lab}>급수 <span style={{ color: 'var(--dim)', fontWeight: 400 }}>(/guide)</span></span>
              <select
                className="admin-in"
                value={tierKey}
                onChange={(e) => {
                  const k = e.target.value
                  setTierKey(k)
                  const t = tiers.find((x) => x.key === k)
                  if (t) setSubject(t.subjects[0] ?? '')
                }}
              >
                {tiers.map((t) => (
                  <option key={t.key} value={t.key}>{t.track.replace('CARIS-', '')} · {t.name}</option>
                ))}
              </select>
            </div>
            <div style={{ ...QE.field, flex: 1 }}>
              <span style={QE.lab}>과목</span>
              <select className="admin-in" value={subject} onChange={(e) => setSubject(e.target.value)}>
                {!subject && <option value="">과목 선택</option>}
                {subjectOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={QE.field}>
            <span style={QE.lab}>지문</span>
            <textarea className="admin-ta" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="문항 지문" />
          </div>

          {kind === 'mc' ? (
            <div style={QE.field}>
              <span style={QE.lab}>보기 · 정답 선택</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {choices.map((c, i) => (
                  <div key={i} className={`qedit-choice ${correctIndex === i ? 'correct' : ''}`}>
                    <input type="radio" name="correct" checked={correctIndex === i} onChange={() => setCorrectIndex(i)} title="정답" />
                    <span className="qedit-choice-no">{i + 1}</span>
                    <input className="admin-in" style={{ flex: 1 }} value={c} onChange={(e) => setChoices((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`보기 ${i + 1}`} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={QE.field}>
              <span style={QE.lab}>모범답안 / 채점 기준 <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(관리자 검수 참고 · 응시자 비노출)</span></span>
              <textarea className="admin-ta" rows={3} value={answerKey} onChange={(e) => setAnswerKey(e.target.value)} placeholder="핵심어·채점 기준" />
            </div>
          )}
        </div>

        {err && <p className="admin-warn" style={{ marginTop: 12 }}>{err}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="admin-mini" onClick={onClose} disabled={saving}>취소</button>
          <button className="grade-btn ok active" onClick={save} disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
        </div>
      </div>
    </div>
  )
}

const CBT_EVENT_LABEL: Record<string, string> = {
  import: '가져오기',
  edit: '수정',
  activate: '활성화',
  deactivate: '비활성화',
  delete: '삭제',
  restore: '복구',
}

function QuestionEventsView({ examId, onChanged }: { examId: string; onChanged: () => void }) {
  const [events, setEvents] = useState<AdminQuestionEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await callFunction<AdminQuestionEventsResp>('admin', { action: 'questionEvents', examId })
      setEvents(r.events)
    } catch {
      /* 무시 */
    } finally {
      setLoading(false)
    }
  }, [examId])
  useEffect(() => {
    load()
  }, [load])

  async function restore(id: string) {
    setBusy(true)
    try {
      await callFunction('admin', { action: 'questionRestore', id })
      await load()
      onChanged()
    } catch (e) {
      alert(e instanceof Error ? e.message : '복구 실패')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="admin-head" style={{ marginTop: 0 }}>
        <span className="admin-count">{events.length}건</span>
        <div className="admin-head-actions">
          <button className="admin-mini" onClick={load} disabled={loading}>
            새로고침
          </button>
        </div>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>일시</th>
              <th>작업</th>
              <th>문항</th>
              <th>담당</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDT(e.created_at)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {CBT_EVENT_LABEL[e.action] ?? e.action}
                  {e.action === 'import' && e.detail ? ` (${(e.detail as { count?: number }).count ?? ''})` : ''}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{e.number != null ? `${e.number}번` : '-'}</td>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{e.actor ?? '-'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {e.restorable && e.question_id ? (
                    <button className="admin-mini" disabled={busy} onClick={() => restore(e.question_id as string)}>
                      복구
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {!events.length && !loading && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                  변경 이력이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

function QuestionImportView({ examId, onImported }: { examId: string; onImported: () => void }) {
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<QuestionImportRow[]>([])
  const [parseErr, setParseErr] = useState('')
  const [importing, setImporting] = useState(false)
  const [msg, setMsg] = useState('')

  function parseCorrect(v: unknown, choices: string[]): number {
    const s = String(v ?? '').trim()
    const n = Number(s)
    if (Number.isFinite(n) && n >= 1 && n <= 4) return n - 1
    const idx = choices.findIndex((c) => c && c === s)
    return idx // 못 찾으면 -1
  }

  function handleFile(file: File) {
    setFileName(file.name)
    setMsg('')
    setParseErr('')
    setRows([])
    const r = new FileReader()
    r.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const aoa = XLSX.utils
          .sheet_to_json<string[]>(ws, { header: 1, defval: '', raw: false })
          .filter((row) => row.some((c) => String(c).trim() !== ''))
        if (aoa.length < 2) {
          setParseErr('데이터 행이 없습니다. (첫 행은 머리글)')
          return
        }
        const out: QuestionImportRow[] = []
        for (let i = 1; i < aoa.length; i++) {
          const row = aoa[i]
          const choices = [row[3], row[4], row[5], row[6]].map((c) => String(c ?? '').trim())
          // 유형 열(열9, 인덱스8)이 '주관식/short' 면 주관식. 비면 객관식(하위호환).
          const kind: 'mc' | 'short' = /주관식|short/i.test(String(row[8] ?? '').trim()) ? 'short' : 'mc'
          out.push({
            number: Math.floor(Number(row[0])) || i,
            subject: String(row[1] ?? '').trim(),
            prompt: String(row[2] ?? '').trim(),
            kind,
            choices,
            correctIndex: kind === 'short' ? -1 : parseCorrect(row[7], choices),
            answerKey: kind === 'short' ? String(row[9] ?? '').trim() : undefined,
          })
        }
        setRows(out)
      } catch (err) {
        setParseErr(err instanceof Error ? err.message : '엑셀을 읽지 못했습니다.')
      }
    }
    r.readAsArrayBuffer(file)
  }

  function downloadTemplate() {
    const header = ['번호', '과목', '지문', '보기1', '보기2', '보기3', '보기4', '정답(1~4)', '유형(객관식/주관식)', '모범답안(주관식)']
    const sampleMc = [1, 'AI 리터러시', '다음 중 옳은 것은?', '보기 A', '보기 B', '보기 C', '보기 D', 2, '객관식', '']
    const sampleShort = [2, '피지컬 AI 및 데이터 처리', '피지컬 AI란 무엇인지 서술하시오.', '', '', '', '', '', '주관식', '센서·액추에이터로 물리세계와 상호작용하는 AI']
    const ws = XLSX.utils.aoa_to_sheet([header, sampleMc, sampleShort])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '문항')
    XLSX.writeFile(wb, 'cbt_문항_템플릿.xlsx')
  }

  const problems = rows
    .map((r, i) => {
      if (!r.subject || !r.prompt) return `${i + 2}행: 과목/지문 비어있음`
      if (r.kind === 'short') return '' // 주관식은 보기·정답 검증 없음
      if (r.choices.length !== 4 || r.choices.some((c) => !c)) return `${i + 2}행(번호 ${r.number}): 보기 4개 필요`
      if (r.correctIndex < 0 || r.correctIndex > 3) return `${i + 2}행(번호 ${r.number}): 정답(1~4) 확인`
      return ''
    })
    .filter(Boolean)

  async function doImport() {
    if (!rows.length) return
    if (problems.length) {
      setMsg('오류를 먼저 해결하세요: ' + problems[0])
      return
    }
    setImporting(true)
    setMsg('')
    try {
      const res = await callFunction<{ count: number }>('admin', { action: 'questionsImport', examId, rows })
      setMsg(`✅ ${res.count}문항 반영됨`)
      setRows([])
      setFileName('')
      onImported()
    } catch (e) {
      setMsg('실패: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 14px', lineHeight: 1.6 }}>
        엑셀 열 순서: <b>번호 · 과목 · 토픽 · 지문 · 보기1~4 · 정답(1~4) · 유형(객관식/주관식) · 모범답안(주관식)</b>. 유형이 비면 객관식입니다. 주관식은 보기·정답 없이 모범답안만 넣으면 됩니다. 첫 행은 머리글로 건너뛰고, 같은 번호가 있으면 <b>덮어씁니다</b>(재업로드 = 수정).
      </p>
      <div className="admin-section" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <label className="admin-mini" style={{ cursor: 'pointer' }}>
          엑셀 선택
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
              e.target.value = ''
            }}
          />
        </label>
        <button className="admin-mini" onClick={downloadTemplate}>
          템플릿 다운로드
        </button>
        {fileName && (
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>
            {fileName} · {rows.length}행
          </span>
        )}
        {rows.length > 0 && (
          <button className="btn-ink" onClick={doImport} disabled={importing || problems.length > 0}>
            {importing ? '반영 중…' : `${rows.length}문항 반영`}
          </button>
        )}
        {msg && <span style={{ fontSize: 13 }}>{msg}</span>}
      </div>
      {parseErr && <div className="admin-section admin-empty">엑셀 오류 — {parseErr}</div>}
      {problems.length > 0 && (
        <div className="admin-section admin-empty" style={{ marginBottom: 14 }}>
          ⚠️ {problems.length}개 행에 문제: {problems.slice(0, 5).join(' / ')}
          {problems.length > 5 ? ' …' : ''}
        </div>
      )}
      {rows.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>#</th>
                <th>유형</th>
                <th>과목</th>
                <th>지문</th>
                <th>보기 / 모범답안</th>
                <th>정답</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 100).map((r, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.number}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span className={`admin-badge st-${r.kind === 'short' ? 'in_progress' : 'submitted'}`}>{r.kind === 'short' ? '주관식' : '객관식'}</span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <b>{r.subject}</b>
                  </td>
                  <td style={{ maxWidth: 320 }}>{r.prompt}</td>
                  <td style={{ maxWidth: 260, fontSize: 12.5, color: 'var(--muted)' }}>{r.kind === 'short' ? (r.answerKey || '—') : r.choices.join(' / ')}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {r.kind === 'short' ? <span style={{ color: 'var(--muted)' }}>검수</span> : r.correctIndex >= 0 ? `${r.correctIndex + 1}번` : <span style={{ color: 'var(--error,#d43a3a)' }}>?</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 100 && (
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
              미리보기는 100행까지 · 실제로는 {rows.length}행 모두 반영됩니다.
            </p>
          )}
        </div>
      )}
    </>
  )
}
