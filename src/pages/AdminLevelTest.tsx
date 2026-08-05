// CARIS ARENA 백오피스 (Admin.tsx 의 "CARIS ARENA" 탭). ai-level-test/src/pages/Admin.tsx 에서 이관.
//  - 모든 데이터 호출은 새 엣지 함수 `admin-test` 로 (CBT admin 과 분리).
//  - 응시 결과 링크는 gara-cbt 라우트 `/test/result/:id` 를 사용.
//  - 이관 범위: 대시보드 · 유저 · 응시 기록 · 문항 목록 · 문항 이력 · 문항 생성(KB 파이프라인) · 번역 · 제보 · 관리자 관리.
//  - KB 파이프라인(kb-extract/generate/save/publish/embed-backfill)·translate-questions 는 관리자 인증만으로 호출한다
//    (옛 x-passcode 입력칸은 제거 — 서버 시크릿 KB_PASSCODE/TRANSLATE_PASSCODE 미설정이라 검사 자체를 안 함).
import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import { axesForLevel, axisDef, MAX_LEVEL } from '../lib/categories'
import { optionCountForLevel } from '../lib/scoring'
import { runTranslation, type TransItem, type TransResult } from '../lib/adminTranslate'
// 채팅 검수·이북 관리는 Admin.tsx 에 정의된 컴포넌트를 그대로 노출(데이터는 admin 함수). 위치만 WORLD ARENA 로 이동.
import { ChatModAdmin, EbooksAdmin } from './Admin'

const LANGS = ['en', 'ja', 'zh', 'hi', 'vi'] as const
const LANG_LABEL: Record<string, string> = { ko: '한국어', en: '영어', ja: '일본어', zh: '중국어', hi: '힌디어', vi: '베트남어' }

const ErrBox = ({ msg }: { msg: string }) => <div className="admin-section admin-empty">불러오기 실패 — {msg}</div>

// DB는 UTC(timestamptz). 화면엔 KST로 변환해 표시.
function fmtDT(iso?: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '-' : d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}
function fmtDate(iso?: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '-' : d.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
}

// "3/l3_rag" → "Lv.3 · RAG·검색" (사람 언어)
function catName(key: string): string {
  const [lv, code] = key.split('/')
  return `Lv.${lv} · ${axisDef(code, 'ko').short}`
}
function codeName(level: number, code: string): string {
  return `Lv.${level} · ${axisDef(code, 'ko').short}`
}

export interface QDiffRow {
  id: string
  level: number
  category: string
  prompt: string
  options: string[]
  correctIndex: number
  active: boolean
  n: number
  rate: number
}
export interface Analytics {
  overview: { users: number; guests: number; attemptsAll: number; attempts7d: number; questions: number; questionsActive: number }
  days: string[]
  signupByDay: Record<string, number>
  attemptByDay: Record<string, number>
  byLevel: Record<string, number>
  byLang: Record<string, number>
  userByLevel: Record<string, number>
  rankDir: { up: number; down: number; stay: number }
  qHardest: QDiffRow[]
  qEasiest: QDiffRow[]
  catCorrect: { key: string; n: number; rate: number }[]
  pool: Record<string, { total: number; active: number }>
  coverage: Record<string, number>
}

type LtTab = 'dashboard' | 'users' | 'attempts' | 'questions' | 'chatmod' | 'ebooks' | 'admins'
export default function LevelTestAdmin() {
  const { isFullUser } = useAuth()
  const [tab, setTab] = useState<LtTab>('dashboard')
  // 관리자 권한은 서버(admin-test 'me')가 판별 — CBT admin 과 동일한 게이트(admin_users/ROOT).
  const [gate, setGate] = useState<'loading' | 'ok' | 'denied'>('loading')
  const [isRoot, setIsRoot] = useState(false)

  useEffect(() => {
    if (!isFullUser) { setGate('denied'); return }
    callFunction<{ isRoot: boolean }>('admin-test', { action: 'me' })
      .then((r) => { setGate('ok'); setIsRoot(!!r.isRoot) })
      .catch(() => setGate('denied'))
  }, [isFullUser])

  if (gate === 'loading') {
    return <div className="wrap admin"><div className="admin-section">권한 확인 중…</div></div>
  }
  if (gate === 'denied') {
    return (
      <div className="wrap admin">
        <div className="admin-section" style={{ textAlign: 'center' }}>
          <h3>관리자 전용</h3>
          <p className="admin-hint">WORLD ARENA 관리자 계정으로 로그인해야 합니다.</p>
        </div>
      </div>
    )
  }

  const TABS: { key: LtTab; label: string }[] = [
    { key: 'dashboard', label: '대시보드' },
    { key: 'users', label: '유저' },
    { key: 'attempts', label: '응시 기록' },
    { key: 'questions', label: '문항' },
    { key: 'chatmod', label: '채팅 검수' },
    { key: 'ebooks', label: '이북' },
    ...(isRoot ? [{ key: 'admins' as const, label: '관리자 관리' }] : []),
  ]

  return (
    <div className="wrap admin">
      <div className="admin-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'dashboard' ? <DashboardTab /> : null}
      {tab === 'users' ? <UsersTab /> : null}
      {tab === 'attempts' ? <AttemptsTab /> : null}
      {tab === 'questions' ? <QuestionsTab isRoot={isRoot} /> : null}
      {/* 채팅 검수·이북은 Admin.tsx(.admin-cbt 스코프) 컴포넌트라 .admin-head 가 먹도록 admin-cbt 로 감싼다. */}
      {tab === 'chatmod' ? <div className="admin-cbt"><ChatModAdmin /></div> : null}
      {tab === 'ebooks' ? <div className="admin-cbt"><EbooksAdmin /></div> : null}
      {tab === 'admins' && isRoot ? <AdminsTab /> : null}
    </div>
  )
}

// ============================ 문항 탭 (목록·이력·생성·번역 통합) ============================
// CARIS(CBT) 관리자의 '문항' 탭과 동일하게, 문항 관련 화면을 한 탭 안 서브탭으로 묶는다.
type LtQSub = 'list' | 'events' | 'generate' | 'upload'
// isRoot = 서버('admin-test' me 액션)가 판정한 루트 관리자 여부. 문항 엑셀 다운로드는 루트 전용.
function QuestionsTab({ isRoot }: { isRoot: boolean }) {
  const [sub, setSub] = useState<LtQSub>('list')
  const SUBS: { key: LtQSub; label: string }[] = [
    { key: 'list', label: '문항 목록' },
    { key: 'events', label: '문항 이력' },
    { key: 'generate', label: '문항 생성' },
    // 엑셀로 문항을 새로 올리면서 5개 언어를 자동 번역하는 탭 — '번역'만 쓰면 기존 문항만 손대는 것처럼 읽힌다.
    { key: 'upload', label: '문항 추가 & 번역' },
  ]
  return (
    <>
      {/* CARIS(CBT) '문항 관리'와 동일한 위계: 상단 네비 탭 → 페이지 제목 헤더 → 서브탭 → 내용.
          제목 헤더가 두 pill 탭줄(상단 네비·서브탭) 사이를 갈라줘야 겹쳐 보이지 않는다.
          .admin-head 는 .admin-cbt 스코프라 LevelTest(.admin)엔 안 먹어 레이아웃을 인라인으로 고정. */}
      <div
        className="admin-head"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, margin: '4px 0 14px' }}
      >
        <h1 style={{ fontSize: 'var(--fs-md)', fontWeight: 800, color: 'var(--ink)', margin: 0 }}>문항 관리</h1>
      </div>
      <div className="admin-tabs" style={{ marginBottom: 16 }}>
        {SUBS.map((s) => (
          <button key={s.key} className={sub === s.key ? 'on' : ''} onClick={() => setSub(s.key)}>
            {s.label}
          </button>
        ))}
      </div>
      {sub === 'list' ? <ListTab isRoot={isRoot} /> : null}
      {sub === 'events' ? <EventsTab /> : null}
      {sub === 'generate' ? (
        <>
          {/* 문항 생성은 아직 개발 중 — 구현(GenerateTab)은 보존하되 미노출(나중에 이 false를 열면 됨) */}
          {false && <GenerateTab />}
          <div className="panel-card" style={{ textAlign: 'center', padding: '52px 24px', color: 'var(--muted)', lineHeight: 1.7 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🚧</div>
            <b style={{ color: 'var(--ink)' }}>문항 생성 기능은 아직 개발 중입니다.</b>
            <div style={{ fontSize: 13, marginTop: 6 }}>준비되면 열릴 예정이에요.</div>
          </div>
        </>
      ) : null}
      {sub === 'upload' ? <UploadTab /> : null}
    </>
  )
}

// ---- 차트 헬퍼 ----
function MiniBars({ days, map, color }: { days: string[]; map: Record<string, number>; color: string }) {
  const vals = days.map((d) => map[d] ?? 0)
  const max = Math.max(1, ...vals)
  const sum = vals.reduce((a, b) => a + b, 0)
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
      <span className="hbar-l">{label}</span>
      <div className="hbar-track"><div className="hbar-fill" style={{ width: `${max ? (value / max) * 100 : 0}%` }} /></div>
      <span className="hbar-v">{value}{sub ?? ''}</span>
    </div>
  )
}
function DiffList({ rows }: { rows: QDiffRow[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const [override, setOverride] = useState<Record<string, boolean>>({})
  if (!rows.length) return <div className="admin-empty">아직 응시 데이터가 없습니다.</div>
  async function toggle(r: QDiffRow) {
    const next = !(override[r.id] ?? r.active)
    setOverride((s) => ({ ...s, [r.id]: next }))
    try { await callFunction('admin-test', { action: 'setActive', id: r.id, active: next }) } catch { /* 데모면 무시 */ }
  }
  return (
    <div className="diff-list">
      {rows.map((r) => {
        const active = override[r.id] ?? r.active
        const isOpen = open === r.id
        return (
          <div key={r.id} className={`diff-item ${r.rate < 35 ? 'hard' : ''} ${!active ? 'off' : ''}`}>
            <div className="diff-head" onClick={() => setOpen(isOpen ? null : r.id)}>
              <span className={`diff-rate ${r.rate < 35 ? 'low' : r.rate > 90 ? 'high' : ''}`}>{r.rate}%</span>
              <span className="diff-q">{r.prompt}</span>
              <span className="diff-meta">{codeName(r.level, r.category)} · 응시 {r.n}{!active ? ' · 비활성' : ''}</span>
              <span className="diff-caret">{isOpen ? '▾' : '▸'}</span>
            </div>
            {isOpen ? (
              <div className="diff-body">
                <ol>
                  {r.options.map((o, k) => (
                    <li key={k} className={k === r.correctIndex ? 'ans' : ''}>{o}{k === r.correctIndex ? '  ✓ 정답' : ''}</li>
                  ))}
                </ol>
                <div className="diff-actions">
                  <button className="admin-mini" onClick={() => toggle(r)}>
                    {active ? '비활성화 (출제에서 제외)' : '다시 활성화'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

// ============================ 대시보드 탭 ============================
const PERIODS = [
  { key: 7, label: '7일' },
  { key: 30, label: '30일' },
  { key: 90, label: '90일' },
] as const

// 독립 기간 선택을 가진 추이 차트
function TrendChart({ title, days, map, color }: { title: string; days: string[]; map: Record<string, number>; color: string }) {
  const [period, setPeriod] = useState<number | 'custom'>(30)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const view = period === 'custom' ? days.filter((d) => (!from || d >= from) && (!to || d <= to)) : days.slice(-period)
  return (
    <div className="admin-section">
      <div className="admin-section-head">
        <h3>{title}</h3>
        <div className="admin-period">
          {PERIODS.map((p) => (
            <button key={p.key} className={period === p.key ? 'on' : ''} onClick={() => setPeriod(p.key)}>{p.label}</button>
          ))}
          <button className={period === 'custom' ? 'on' : ''} onClick={() => setPeriod('custom')}>사용자지정</button>
          {period === 'custom' ? (
            <span className="admin-daterange">
              <input type="date" value={from} min={days[0]} max={days[days.length - 1]} onChange={(e) => setFrom(e.target.value)} />
              ~
              <input type="date" value={to} min={days[0]} max={days[days.length - 1]} onChange={(e) => setTo(e.target.value)} />
            </span>
          ) : null}
        </div>
      </div>
      <MiniBars days={view} map={map} color={color} />
    </div>
  )
}

function DashboardTab() {
  const [a, setA] = useState<Analytics | null>(null)
  const [err, setErr] = useState('')
  const [catLevel, setCatLevel] = useState(1)
  const [poolLevel, setPoolLevel] = useState(1)
  useEffect(() => {
    callFunction<Analytics>('admin-test', { action: 'analytics' })
      .then(setA)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [])
  if (err) return <ErrBox msg={err} />
  if (!a) return <div className="admin-section">불러오는 중…</div>

  const o = a.overview
  const levelMax = Math.max(1, ...Object.values(a.byLevel))
  const langMax = Math.max(1, ...Object.values(a.byLang))
  const userLvMax = Math.max(1, ...Object.values(a.userByLevel))
  const rankTotal = a.rankDir.up + a.rankDir.down + a.rankDir.stay || 1
  const lowPools = Object.entries(a.pool).filter(([, v]) => v.active < 4)

  // 영역 평균 정답률: 선택 레벨의 6축
  const rateByKey: Record<string, { rate: number; n: number }> = {}
  for (const c of a.catCorrect) rateByKey[c.key] = { rate: c.rate, n: c.n }
  const catAxes = axesForLevel(catLevel, 'ko')

  const cards = [
    { k: '유저', v: o.users, sub: `게스트 ${o.guests}명` },
    { k: '전체 응시', v: o.attemptsAll, sub: '제출 완료 기준' },
    { k: '문항', v: `${o.questionsActive} / ${o.questions}`, sub: '활성 / 전체' },
  ]

  return (
    <div className="admin-dash">
      <div className="admin-cards">
        {cards.map((c) => (
          <div key={c.k} className="admin-card">
            <div className="k">{c.k}</div>
            <div className="v">{c.v}</div>
            <div className="sub">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* 추이 — 각각 독립 기간 선택 */}
      <TrendChart title="가입 추이" days={a.days} map={a.signupByDay} color="#3aa79f" />
      <TrendChart title="응시 추이" days={a.days} map={a.attemptByDay} color="#3f8fd6" />

      {/* 분포 */}
      <div className="admin-grid2">
        <div className="admin-section">
          <h3>유저 등급 분포 <span className="admin-hint">현재 등급별 인원</span></h3>
          {Object.keys(a.userByLevel).sort().map((l) => <HBar key={l} label={`Lv.${l}`} value={a.userByLevel[l]} max={userLvMax} sub="명" />)}
          {Object.keys(a.userByLevel).length === 0 ? <div className="admin-empty">유저 없음</div> : null}
        </div>
        <div className="admin-section">
          <h3>레벨별 응시 <span className="admin-hint">응시한 레벨</span></h3>
          {Object.keys(a.byLevel).sort().map((l) => <HBar key={l} label={`Lv.${l}`} value={a.byLevel[l]} max={levelMax} />)}
          {Object.keys(a.byLevel).length === 0 ? <div className="admin-empty">응시 없음</div> : null}
        </div>
      </div>

      <div className="admin-grid2">
        <div className="admin-section">
          <h3>응시 언어</h3>
          {Object.entries(a.byLang).sort((x, y) => y[1] - x[1]).map(([l, v]) => <HBar key={l} label={LANG_LABEL[l] ?? l} value={v} max={langMax} />)}
          {Object.keys(a.byLang).length === 0 ? <div className="admin-empty">응시 없음</div> : null}
        </div>
        <div className="admin-section">
          <h3>등급 변동 <span className="admin-hint">응시 {rankTotal}건</span></h3>
          <div className="rank-bar">
            <div className="up" style={{ width: `${(a.rankDir.up / rankTotal) * 100}%` }}>승급 {a.rankDir.up}</div>
            <div className="stay" style={{ width: `${(a.rankDir.stay / rankTotal) * 100}%` }}>유지 {a.rankDir.stay}</div>
            <div className="down" style={{ width: `${(a.rankDir.down / rankTotal) * 100}%` }}>강등 {a.rankDir.down}</div>
          </div>
        </div>
      </div>

      {/* 문항 난이도 — 세로로 */}
      <div className="admin-section">
        <h3>⚠ 어려운 문항 <span className="admin-hint">정답률 낮음 · 클릭하면 보기·정답 확인 + 비활성화</span></h3>
        <DiffList rows={a.qHardest} />
      </div>
      <div className="admin-section">
        <h3>쉬운 문항 <span className="admin-hint">정답률 높음</span></h3>
        <DiffList rows={a.qEasiest} />
      </div>

      {/* 영역 평균 정답률 — 레벨 선택 → 그 레벨 6영역 */}
      <div className="admin-section">
        <div className="admin-section-head">
          <h3>영역별 평균 정답률</h3>
          <select value={catLevel} onChange={(e) => setCatLevel(+e.target.value)}>
            {Array.from({ length: MAX_LEVEL }, (_, i) => i + 1).map((l) => <option key={l} value={l}>Lv.{l}</option>)}
          </select>
        </div>
        {catAxes.map((ax) => {
          const d = rateByKey[`${catLevel}/${ax.key}`]
          return d ? (
            <HBar key={ax.key} label={ax.short} value={d.rate} max={100} sub={`% (${d.n})`} />
          ) : (
            <div key={ax.key} className="hbar"><span className="hbar-l">{ax.short}</span><div className="hbar-track" /><span className="hbar-v admin-hint">데이터 없음</span></div>
          )
        })}
      </div>

      {/* 레벨·영역별 문항 수 — 레벨 선택 */}
      <div className="admin-section">
        <div className="admin-section-head">
          <h3>레벨·영역별 문항 수</h3>
          <select value={poolLevel} onChange={(e) => setPoolLevel(+e.target.value)}>
            {Array.from({ length: MAX_LEVEL }, (_, i) => i + 1).map((l) => <option key={l} value={l}>Lv.{l}</option>)}
          </select>
        </div>
        <p className="admin-desc">
          시험은 <b>레벨의 각 영역({axesForLevel(poolLevel, 'ko').length}개)에서 문제를 무작위로 뽑아</b> 출제합니다. 그래서 <b>영역마다 활성 문항이 넉넉해야</b>(권장 4개 이상) 매번 다른 문제로 출제할 수 있어요. 아래는 <b>출제 가능한(활성) 문항 / 등록된 전체</b>입니다.
        </p>
        {lowPools.length ? <div className="admin-warn">⚠ (전 레벨) 활성 문항 4개 미만: {lowPools.map(([k]) => catName(k)).join(' · ')}</div> : null}
        <table className="admin-table pool-table">
          <thead><tr><th>영역</th><th>출제 가능(활성)</th><th>전체</th><th>상태</th></tr></thead>
          <tbody>
            {axesForLevel(poolLevel, 'ko').map((ax) => {
              const v = a.pool[`${poolLevel}/${ax.key}`] ?? { active: 0, total: 0 }
              const ok = v.active >= 4
              return (
                <tr key={ax.key} className={ok ? '' : 'prob'}>
                  <td>{ax.short}</td>
                  <td><b>{v.active}개</b></td>
                  <td>{v.total}개</td>
                  <td>{v.total === 0 ? <span className="badge none">없음</span> : ok ? <span className="badge ok">충분</span> : <span className="badge low">부족</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* 번역 완료율 */}
      <div className="admin-section">
        <h3>언어별 번역 완료율 <span className="admin-hint">전체 {o.questions}문항 중</span></h3>
        {['ko', ...LANGS].map((l) => {
          const c = a.coverage[l] ?? 0
          const pct = o.questions ? Math.round((c / o.questions) * 100) : 0
          return <HBar key={l} label={LANG_LABEL[l]} value={pct} max={100} sub={`% (${c})`} />
        })}
      </div>
    </div>
  )
}

// ============================ 유저 탭 ============================
interface UserRow {
  id: string; name: string | null; email: string | null; anon: boolean
  created: string; rank: number; attempts: number; lastActive: string | null
}
function UsersTab() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [type, setType] = useState<'all' | 'google' | 'guest'>('google')
  const [rankF, setRankF] = useState(0)
  const [sort, setSort] = useState<'created' | 'rank' | 'attempts'>('created')
  const [open, setOpen] = useState<UserRow | null>(null)
  const [page, setPage] = useState(0)

  useEffect(() => {
    callFunction<{ users: UserRow[] }>('admin-test', { action: 'users' })
      .then((r) => setUsers(r.users))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [])
  // 필터·정렬 바뀌면 1페이지로
  useEffect(() => { setPage(0) }, [q, type, rankF, sort])

  if (err) return <ErrBox msg={err} />

  const filtered = users
    .filter((u) => {
      if (type === 'google' && u.anon) return false
      if (type === 'guest' && !u.anon) return false
      if (rankF && u.rank !== rankF) return false
      if (q) {
        const s = q.toLowerCase()
        if (!(u.name || '').toLowerCase().includes(s) && !(u.email || '').toLowerCase().includes(s)) return false
      }
      return true
    })
    .sort((a, b) =>
      sort === 'rank' ? b.rank - a.rank : sort === 'attempts' ? b.attempts - a.attempts : (b.created || '').localeCompare(a.created || ''),
    )
  const googleN = users.filter((u) => !u.anon).length
  const PER = 50
  const pageCount = Math.max(1, Math.ceil(filtered.length / PER))
  const safePage = Math.min(page, pageCount - 1)
  const pageItems = filtered.slice(safePage * PER, safePage * PER + PER)
  // 표시할 페이지 번호: 처음·끝·현재±2 만 (나머지는 … 로 접음)
  const pageNums: (number | '…')[] = []
  for (let i = 0; i < pageCount; i++) {
    if (i === 0 || i === pageCount - 1 || (i >= safePage - 2 && i <= safePage + 2)) pageNums.push(i)
    else if (pageNums[pageNums.length - 1] !== '…') pageNums.push('…')
  }

  return (
    <div>
      <div className="admin-cards">
        <div className="admin-card"><div className="k">전체 유저</div><div className="v">{users.length}</div></div>
        <div className="admin-card"><div className="k">구글 로그인</div><div className="v">{googleN}</div></div>
        <div className="admin-card"><div className="k">게스트</div><div className="v">{users.length - googleN}</div></div>
      </div>
      <div className="admin-section">
        <div className="admin-toolbar">
          <input className="admin-search" placeholder="이름·이메일 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <option value="google">가입유저</option><option value="guest">게스트</option><option value="all">전체(게스트 포함)</option>
          </select>
          <select value={rankF} onChange={(e) => setRankF(+e.target.value)}>
            <option value={0}>전체 등급</option>
            {Array.from({ length: MAX_LEVEL }, (_, i) => i + 1).map((l) => <option key={l} value={l}>Lv.{l}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="created">최신가입순</option><option value="rank">등급순</option><option value="attempts">응시많은순</option>
          </select>
          <span className="admin-hint">{filtered.length}명{loading ? ' · 불러오는 중…' : ''}</span>
        </div>
        <table className="admin-table">
          <thead><tr><th>이름</th><th>이메일</th><th>유형</th><th>등급</th><th>응시</th><th>마지막 활동</th><th>가입</th><th></th></tr></thead>
          <tbody>
            {pageItems.map((u) => (
              <tr key={u.id}>
                <td>{u.name || '-'}</td>
                <td>{u.email || '-'}</td>
                <td>{u.anon ? '게스트' : '구글'}</td>
                <td>Lv.{u.rank}</td>
                <td>{u.attempts}</td>
                <td>{fmtDate(u.lastActive)}</td>
                <td>{fmtDate(u.created)}</td>
                <td><button className="admin-mini" onClick={() => setOpen(u)}>상세</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && !loading ? <div className="admin-empty">조건에 맞는 유저가 없습니다.</div> : null}
        {pageCount > 1 ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>
            <button className="admin-mini" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0}>‹</button>
            {pageNums.map((n, i) =>
              n === '…' ? (
                <span key={`e${i}`} className="admin-hint">…</span>
              ) : (
                <button
                  key={n}
                  className="admin-mini"
                  onClick={() => setPage(n)}
                  style={n === safePage ? { fontWeight: 800, background: 'var(--accent)', color: '#fff' } : undefined}
                >
                  {n + 1}
                </button>
              ),
            )}
            <button className="admin-mini" onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={safePage >= pageCount - 1}>›</button>
          </div>
        ) : null}
      </div>
      {open ? <UserDetail user={open} onClose={() => setOpen(null)} /> : null}
    </div>
  )
}

interface UserDetailData { rank: number; skills: { level: number; attempts_count: number; placed: boolean; ratings: Record<string, number> }[]; attempts: Omit<AttemptRow, 'name'>[] }
function UserDetail({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const [data, setData] = useState<UserDetailData | null>(null)
  const [rank, setRank] = useState(user.rank)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    callFunction<UserDetailData>('admin-test', { action: 'userDetail', userId: user.id })
      .then((d) => { setData(d); setRank(d.rank) })
      .catch((e) => setMsg('불러오기 실패: ' + (e instanceof Error ? e.message : String(e))))
  }, []) // eslint-disable-line
  async function saveRank() {
    setMsg('저장 중…')
    try { await callFunction('admin-test', { action: 'setRank', userId: user.id, rank }); setMsg('✅ 등급 변경됨') }
    catch (e) { setMsg('실패: ' + (e instanceof Error ? e.message : String(e))) }
  }
  return (
    <div className="lt-modal" onClick={onClose}>
      <div className="lt-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-h">
          <b>{user.name || '유저'}</b>
          <span className="admin-hint">{user.email || (user.anon ? '게스트' : '')}</span>
          <button className="admin-x" onClick={onClose}>✕</button>
        </div>
        <div className="admin-row" style={{ marginTop: 4 }}>
          <span>등급 수동 조정</span>
          <select value={rank} onChange={(e) => setRank(+e.target.value)}>
            {Array.from({ length: MAX_LEVEL }, (_, i) => i + 1).map((l) => <option key={l} value={l}>Lv.{l}</option>)}
          </select>
          <button className="admin-mini" onClick={saveRank}>저장</button>
          {msg ? <span className="admin-msg">{msg}</span> : null}
        </div>
        {data?.skills?.length ? (
          <>
            <div className="admin-sub" style={{ marginTop: 12 }}>레벨별 누적 레이팅</div>
            {data.skills.map((s) => (
              <div key={s.level} className="admin-row">
                <b>Lv.{s.level}</b><span className="admin-hint">{s.attempts_count}회</span>
                {Object.entries(s.ratings || {}).map(([k, v]) => <span key={k} className="admin-pill">{axisDef(k, 'ko').short} {Math.round(v)}</span>)}
              </div>
            ))}
          </>
        ) : null}
        <div className="admin-sub" style={{ marginTop: 12 }}>응시 이력</div>
        <table className="admin-table">
          <thead><tr><th>일시</th><th>레벨</th><th>언어</th><th>점수</th><th>등급변동</th></tr></thead>
          <tbody>
            {(data?.attempts || []).map((a) => (
              <tr key={a.id}>
                <td>{fmtDT(a.submitted_at || a.created_at)}</td>
                <td>Lv.{a.level}</td><td>{a.lang}</td>
                <td>{a.total_correct}/{a.total_questions}</td>
                <td>{a.rank_before != null ? `${a.rank_before}→${a.rank_after}` : '-'}</td>
              </tr>
            ))}
            {!data?.attempts?.length ? <tr><td colSpan={5} className="admin-empty">응시 이력 없음</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ============================ 응시 기록 탭 ============================
interface AttemptRow { id: string; name: string; email?: string | null; level: number; lang: string; status: string; total_correct: number; total_questions: number; rank_before: number | null; rank_after: number | null; rank_dir: string | null; violation_count?: number; submitted_at: string | null; created_at: string }
function OutcomeBadge({ status, v }: { status: string; v?: number }) {
  if (status === 'submitted') return <span className="badge ok">완료</span>
  if (status === 'voided') return <span className="badge none">⚠ 경고중단{v ? ` ${v}회` : ''}</span>
  return <span className="badge low">중단</span> // in_progress · expired = 미완료 이탈
}
function RankBadge({ before, after, dir }: { before: number | null; after: number | null; dir: string | null }) {
  if (before == null || after == null) return <span className="rc-none">–</span>
  const cls = dir === 'up' ? 'up' : dir === 'down' ? 'down' : 'stay'
  const tag = dir === 'up' ? '▲ 승급' : dir === 'down' ? '▼ 강등' : '유지'
  return (
    <span className={`rc rc-${cls}`}>
      <b>Lv.{before}</b><span className="rc-arr">→</span><b>Lv.{after}</b>
      <span className="rc-tag">{tag}</span>
    </span>
  )
}

function AttemptsTab() {
  const [rows, setRows] = useState<AttemptRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [levelF, setLevelF] = useState(0)
  const [langF, setLangF] = useState('all')
  const [dirF, setDirF] = useState<'all' | 'up' | 'down' | 'stay'>('all')
  const [outF, setOutF] = useState<'all' | 'submitted' | 'voided' | 'incomplete'>('all')
  const [open, setOpen] = useState<AttemptRow | null>(null)

  useEffect(() => {
    callFunction<{ attempts: AttemptRow[] }>('admin-test', { action: 'attempts' })
      .then((r) => setRows(r.attempts))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [])

  if (err) return <ErrBox msg={err} />

  const filtered = rows.filter((a) => {
    if (levelF && a.level !== levelF) return false
    if (langF !== 'all' && a.lang !== langF) return false
    if (dirF !== 'all' && (a.rank_dir ?? 'stay') !== dirF) return false
    if (outF === 'submitted' && a.status !== 'submitted') return false
    if (outF === 'voided' && a.status !== 'voided') return false
    if (outF === 'incomplete' && a.status !== 'in_progress' && a.status !== 'expired') return false
    if (q && !(a.name || '').toLowerCase().includes(q.toLowerCase())) return false
    return true
  })
  const langs = [...new Set(rows.map((a) => a.lang))]

  return (
    <div>
      <div className="admin-section">
        <div className="admin-toolbar">
          <input className="admin-search" placeholder="유저 이름 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={levelF} onChange={(e) => setLevelF(+e.target.value)}>
            <option value={0}>전체 레벨</option>
            {Array.from({ length: MAX_LEVEL }, (_, i) => i + 1).map((l) => <option key={l} value={l}>Lv.{l}</option>)}
          </select>
          <select value={langF} onChange={(e) => setLangF(e.target.value)}>
            <option value="all">전체 언어</option>
            {langs.map((l) => <option key={l} value={l}>{LANG_LABEL[l] ?? l}</option>)}
          </select>
          <select value={dirF} onChange={(e) => setDirF(e.target.value as typeof dirF)}>
            <option value="all">전체 변동</option><option value="up">승급</option><option value="stay">유지</option><option value="down">강등</option>
          </select>
          <select value={outF} onChange={(e) => setOutF(e.target.value as typeof outF)}>
            <option value="all">전체 결과</option><option value="submitted">완료</option><option value="voided">경고중단</option><option value="incomplete">중도이탈</option>
          </select>
          <span className="admin-hint">{filtered.length}건{loading ? ' · 불러오는 중…' : ''}</span>
        </div>
        <table className="admin-table">
          <thead><tr><th>유저</th><th>레벨</th><th>언어</th><th>점수</th><th>결과</th><th>등급변동</th><th>일시</th><th></th></tr></thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.id} className={a.status === 'voided' ? 'prob' : ''}>
                <td>{a.name}</td>
                <td>Lv.{a.level}</td>
                <td>{LANG_LABEL[a.lang] ?? a.lang}</td>
                <td>{a.status === 'submitted' ? `${a.total_correct}/${a.total_questions}` : '–'}</td>
                <td><OutcomeBadge status={a.status} v={a.violation_count} /></td>
                <td>{a.status === 'submitted' ? <RankBadge before={a.rank_before} after={a.rank_after} dir={a.rank_dir} /> : <span className="rc-none">–</span>}</td>
                <td>{fmtDT(a.submitted_at || a.created_at)}</td>
                <td><button className="admin-mini" onClick={() => setOpen(a)}>상세</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && !loading ? <div className="admin-empty">조건에 맞는 응시가 없습니다.</div> : null}
      </div>
      {open ? <AttemptDetail attempt={open} onClose={() => setOpen(null)} /> : null}
    </div>
  )
}

interface AnswerRow { category: string; prompt: string; options: string[]; selectedIndex: number | null; correctIndex: number; isCorrect: boolean }
// 중단 응시 사유 (status 기준 — voided/expired/in_progress)
const ABORT_INFO: Record<string, { title: string; desc: string }> = {
  voided: { title: '경고중단 — 부정행위 감지', desc: '시험 중 탭 전환·다른 창 이동·전체화면 해제 등이 감지돼 경고가 누적됐고, 한도 초과로 자동 무효 처리됐어요.' },
  expired: { title: '시간 초과 중단', desc: '제한 시간이 지나 자동으로 종료됐어요.' },
  in_progress: { title: '중도 이탈 — 미제출', desc: '응시를 끝내지 않고 나가서 제출 기록이 없어요.' },
}
function AttemptDetail({ attempt, onClose }: { attempt: AttemptRow; onClose: () => void }) {
  const aborted = attempt.status !== 'submitted'
  const [answers, setAnswers] = useState<AnswerRow[] | null>(null)
  useEffect(() => {
    if (aborted) return // 중단 응시는 문항 안 불러옴
    callFunction<{ answers: AnswerRow[] }>('admin-test', { action: 'attemptDetail', attemptId: attempt.id })
      .then((r) => setAnswers(r.answers))
      .catch(() => setAnswers([]))
  }, []) // eslint-disable-line
  const info = ABORT_INFO[attempt.status] ?? ABORT_INFO.in_progress
  return (
    <div className="lt-modal" onClick={onClose}>
      <div className="lt-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-h">
          <b>{attempt.name} · Lv.{attempt.level}</b>
          <span className="admin-hint">
            {attempt.email || '게스트'} · {LANG_LABEL[attempt.lang] ?? attempt.lang}
            {aborted ? '' : ` · ${attempt.total_correct}/${attempt.total_questions}점`}
          </span>
          <button className="admin-x" onClick={onClose}>✕</button>
        </div>
        {aborted ? (
          <div className={`abort-reason ${attempt.status === 'voided' ? 'void' : ''}`}>
            <div className="ar-title">
              ⛔ {info.title}
              {attempt.status === 'voided' && attempt.violation_count ? ` · 경고 ${attempt.violation_count}회` : ''}
            </div>
            <div className="ar-desc">{info.desc}</div>
            <div className="ar-meta">
              시작 {fmtDT(attempt.created_at)}
              {attempt.submitted_at ? ` · 종료 ${fmtDT(attempt.submitted_at)}` : ''}
            </div>
          </div>
        ) : (
          <>
            {!answers ? <div className="admin-empty">불러오는 중…</div> : null}
            {answers?.map((ans, i) => (
              <div key={i} className={`ans-item ${ans.isCorrect ? 'ok' : 'no'}`}>
                <div className="ans-q"><span className="ans-badge">{ans.isCorrect ? '정답' : '오답'}</span> {ans.prompt}</div>
                <ol>
                  {ans.options.map((o, k) => (
                    <li key={k} className={`${k === ans.correctIndex ? 'correct' : ''} ${k === ans.selectedIndex && !ans.isCorrect ? 'picked-wrong' : ''}`}>
                      {o}
                      {k === ans.correctIndex ? ' ✓ 정답' : ''}
                      {k === ans.selectedIndex && k !== ans.correctIndex ? ' ← 선택' : ''}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
            {answers?.length === 0 ? <div className="admin-empty">문항 기록 없음</div> : null}
          </>
        )}
      </div>
    </div>
  )
}

// ============================ 문항 목록 탭 ============================
interface ListRow {
  id: string
  code: string | null
  level: number
  category: string
  correct_index: number
  prompt_i18n: Record<string, string>
  options_i18n: Record<string, string[]>
  explanation_i18n: Record<string, string>
  active: boolean
  missing: string[]
}
// 목록 다운로드 — 서버에 다시 묻지 않고 "화면에 보이는 그대로"(레벨·영역·검색 필터 적용분) 엑셀로 내보낸다.
// 시트 = 언어별(ko 먼저 — 업로드 파서가 첫 시트를 읽으므로 열 구성도 업로드 템플릿과 맞춘다).
const EXPORT_LANGS = ['ko', 'en', 'ja', 'zh', 'hi', 'vi']
function todayKST(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(/-/g, '') // YYYYMMDD
}
function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_')
}
function exportQuestionsXlsx(rows: ListRow[], level: number, cat: string) {
  const maxOpts = Math.max(4, ...rows.map((r) => Math.max(0, ...EXPORT_LANGS.map((l) => r.options_i18n?.[l]?.length ?? 0))))
  const wb = XLSX.utils.book_new()
  for (const lang of EXPORT_LANGS) {
    // 한 문항도 번역이 없는 언어는 빈 시트를 만들지 않는다(ko 는 항상).
    if (lang !== 'ko' && !rows.some((r) => (r.prompt_i18n?.[lang] ?? '').trim())) continue
    const header = ['번호', '영역', '문제', ...Array.from({ length: maxOpts }, (_, i) => `보기${i + 1}`), '정답', '해설']
    const body = rows.map((r) => {
      const opts = r.options_i18n?.[lang] ?? []
      return [
        r.code ?? '',
        axisDef(r.category, lang).short,
        r.prompt_i18n?.[lang] ?? '',
        ...Array.from({ length: maxOpts }, (_, i) => opts[i] ?? ''),
        r.correct_index + 1,
        r.explanation_i18n?.[lang] ?? '',
      ]
    })
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...body]), LANG_LABEL[lang] ?? lang)
  }
  const catName = cat === 'all' ? '전체영역' : axisDef(cat, 'ko').short
  XLSX.writeFile(wb, safeFileName(`아레나문항_Lv${level}_${catName}_${todayKST()}.xlsx`))
}

function ListTab({ isRoot }: { isRoot: boolean }) {
  const [level, setLevel] = useState(1)
  const [cat, setCat] = useState('all')
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<ListRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [edit, setEdit] = useState<ListRow | 'new' | null>(null) // 'new' = 문항 추가
  const [sel, setSel] = useState<Set<string>>(new Set()) // 체크박스 선택(일괄 비활성·삭제용)
  const [bulk, setBulk] = useState('')

  async function load() {
    setLoading(true)
    setErr('')
    setSel(new Set())
    try {
      const r = await callFunction<{ rows: ListRow[] }>('admin-test', { action: 'list', level })
      setRows(r.rows)
    } catch (e) {
      setRows([])
      setErr(e instanceof Error ? e.message : String(e))
    }
    setLoading(false)
  }
  useEffect(() => { load() }, [level]) // eslint-disable-line

  // 비활성/삭제 → 메인 목록에서 빠지고 '문항 이력' 탭으로. (낙관적으로 행 제거)
  async function act(row: ListRow, action: 'deactivate' | 'delete') {
    const word = action === 'delete' ? '삭제' : '비활성화'
    if (!confirm(`${row.code ?? '이 문항'} 을(를) ${word}할까요?\n메인 목록에서 빠지고 '문항 이력' 탭으로 이동합니다. (거기서 되돌리기 가능)`)) return
    const prev = rows
    setRows((rs) => rs.filter((x) => x.id !== row.id))
    try {
      if (action === 'delete') await callFunction('admin-test', { action: 'delete', id: row.id })
      else await callFunction('admin-test', { action: 'setActive', id: row.id, active: false })
    } catch (e) {
      setRows(prev)
      alert(`${word} 실패: ` + (e instanceof Error ? e.message : String(e)))
    }
  }

  const axes = axesForLevel(level, 'ko')
  const qq = q.trim().toLowerCase()
  const filtered = rows
    .filter((r) => cat === 'all' || r.category === cat)
    .filter((r) => !qq || (r.code ?? '').toLowerCase().includes(qq) || (r.prompt_i18n?.ko ?? '').toLowerCase().includes(qq))

  // 일괄 처리·다운로드 대상 = 체크된 것 중 지금 화면에 보이는 것만.
  const selRows = filtered.filter((r) => sel.has(r.id))
  const selCount = selRows.length
  const allChecked = filtered.length > 0 && selCount === filtered.length
  function toggle(id: string) {
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function toggleAll() {
    setSel((s) => {
      const n = new Set(s)
      if (allChecked) filtered.forEach((r) => n.delete(r.id))
      else filtered.forEach((r) => n.add(r.id))
      return n
    })
  }

  // 선택 일괄 처리 — 함수에 벌크 API가 없어 건별 호출을 4개씩 병렬로 돌린다.
  async function bulkAct(action: 'deactivate' | 'delete') {
    const targets = filtered.filter((r) => sel.has(r.id))
    if (!targets.length) return
    const word = action === 'delete' ? '삭제' : '비활성화'
    if (!confirm(`선택한 ${targets.length}개 문항을 ${word}할까요?\n메인 목록에서 빠지고 '문항 이력' 탭으로 이동합니다. (거기서 되돌리기 가능)`)) return
    setBulk(`${word} 중… 0/${targets.length}`)
    let done = 0
    const fails: string[] = []
    let i = 0
    const worker = async () => {
      while (i < targets.length) {
        const r = targets[i++]
        try {
          if (action === 'delete') await callFunction('admin-test', { action: 'delete', id: r.id })
          else await callFunction('admin-test', { action: 'setActive', id: r.id, active: false })
        } catch { fails.push(r.code ?? r.id.slice(0, 6)) }
        setBulk(`${word} 중… ${++done}/${targets.length}`)
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, targets.length) }, worker))
    setBulk(fails.length ? `⚠️ ${targets.length - fails.length}개 ${word} · 실패 ${fails.length}개(${fails.join(', ')})` : `✅ ${targets.length}개 ${word} 완료`)
    await load()
  }

  return (
    <div>
      {err ? <ErrBox msg={err} /> : null}
      <div className="admin-section">
        <div className="admin-toolbar">
          <label>레벨 <select value={level} onChange={(e) => { setLevel(+e.target.value); setCat('all') }}>
            {Array.from({ length: MAX_LEVEL }, (_, i) => i + 1).map((l) => <option key={l} value={l}>Lv.{l}</option>)}
          </select></label>
          <label>영역 <select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="all">전체 영역</option>
            {axes.map((a) => <option key={a.key} value={a.key}>{a.short}</option>)}
          </select></label>
          <input className="admin-search" placeholder="번호(L3-045)·문제 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="admin-mini" onClick={() => setEdit('new')}>+ 문항 추가</button>
          {/* 문항 반출은 루트 관리자 전용(체크박스 자체는 일괄 비활성·삭제에도 쓰이므로 그대로 둔다). */}
          {isRoot && (
            <button
              className="admin-mini"
              disabled={!selCount}
              title={selCount ? '' : '다운로드할 문항을 체크하세요(머리글 체크박스 = 전체 선택)'}
              onClick={() => exportQuestionsXlsx(selRows, level, cat)}
            >엑셀 다운로드{selCount ? ` (${selCount})` : ''}</button>
          )}
          <button className="admin-mini" onClick={load}>새로고침</button>
          <span className="admin-hint">{filtered.length}문항{loading ? ' · 불러오는 중…' : ''}</span>
        </div>
        {/* 선택 일괄 처리 바 — 체크된 게 있을 때만 */}
        {selCount ? (
          <div className="admin-toolbar" style={{ marginBottom: 10 }}>
            <b>{selCount}개 선택됨</b>
            <button className="admin-mini" disabled={!!bulk && bulk.endsWith('중…')} onClick={() => bulkAct('deactivate')}>선택 비활성</button>
            <button className="admin-mini danger" disabled={!!bulk && bulk.endsWith('중…')} onClick={() => bulkAct('delete')}>선택 삭제</button>
            <button className="admin-mini" onClick={() => setSel(new Set())}>선택 해제</button>
            {bulk ? <span className="admin-msg">{bulk}</span> : null}
          </div>
        ) : bulk ? <div className="admin-toolbar" style={{ marginBottom: 10 }}><span className="admin-msg">{bulk}</span></div> : null}
        <table className="admin-table">
          <thead><tr>
            <th style={{ width: 34 }}><input type="checkbox" checked={allChecked} onChange={toggleAll} title="전체 선택" /></th>
            <th>번호</th><th>영역</th><th>문제(ko)</th><th>정답</th><th>미번역</th><th></th>
          </tr></thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className={r.missing.length ? 'prob' : ''}>
                <td><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                <td style={{ whiteSpace: 'nowrap', fontWeight: 700, color: '#3f8fd6' }}>{r.code ?? '-'}</td>
                <td>{axisDef(r.category, 'ko').short}</td>
                <td className="admin-q">{r.prompt_i18n?.ko ?? ''}</td>
                <td>{r.correct_index + 1}번</td>
                <td className="admin-status">{r.missing.length ? r.missing.map((l) => LANG_LABEL[l] ?? l).join(', ') : '완료'}</td>
                <td style={{ whiteSpace: 'nowrap', display: 'flex', gap: 6 }}>
                  <button className="admin-mini" onClick={() => setEdit(r)}>수정</button>
                  <button className="admin-mini" onClick={() => act(r, 'deactivate')}>비활성</button>
                  <button className="admin-mini danger" onClick={() => act(r, 'delete')}>삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && !loading ? <div className="admin-empty">조건에 맞는 문항이 없습니다.</div> : null}
        <p className="admin-hint" style={{ marginTop: 8 }}>비활성·삭제한 문항은 <b>문항 이력</b> 탭에서 확인·되돌리기 할 수 있어요.</p>
      </div>
      {edit ? (
        <QuestionEdit
          row={edit === 'new' ? null : edit}
          level={level}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); load() }}
        />
      ) : null}
    </div>
  )
}

// 문항 추가/수정 — row=null 이면 신규(추가). 한국어로 쓰고 '자동 번역'으로 나머지 5개 언어를 채운다
// (번역 탭과 같은 translate-questions 파이프라인 = runTranslation).
function QuestionEdit({ row, level: listLevel, onClose, onSaved }: {
  row: ListRow | null; level: number; onClose: () => void; onSaved: () => void
}) {
  const isNew = !row
  const [level, setLevel] = useState(row?.level ?? listLevel) // 신규만 변경 가능(영역 목록이 레벨 종속)
  const [lang, setLang] = useState('ko')
  const [cat, setCat] = useState(row?.category ?? axesForLevel(row?.level ?? listLevel, 'ko')[0]?.key ?? '')
  const [correct, setCorrect] = useState(row?.correct_index ?? 0)
  const [active, setActive] = useState(row?.active ?? true)
  const [pi, setPi] = useState<Record<string, string>>({ ...(row?.prompt_i18n ?? {}) })
  // 신규는 그 레벨의 보기 개수만큼 빈칸을 띄운다(Lv.1~3 4개 / Lv.4~7 5개).
  const [oi, setOi] = useState<Record<string, string[]>>(
    row ? { ...row.options_i18n } : { ko: Array.from({ length: optionCountForLevel(listLevel) }, () => '') },
  )
  const [ei, setEi] = useState<Record<string, string>>({ ...(row?.explanation_i18n ?? {}) })
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const axes = axesForLevel(level, 'ko')
  const koCount = Math.max(1, (oi.ko ?? []).length)
  // 보기 개수는 레벨이 정한다 — lib/scoring.ts 의 OPTIONS_BY_LEVEL(서버도 같은 값으로 강제).
  // 그래서 '보기 추가' 버튼이 없다. 개수가 어긋난 옛 문항만 ✕ 로 줄일 수 있게 남겨둔다.
  const need = optionCountForLevel(level)
  const ALL_LANGS = ['ko', ...LANGS]
  const koOpts = (oi.ko ?? []).map((s) => (s ?? '').trim())
  const koReady = !!(pi.ko ?? '').trim() && koOpts.length >= 2 && koOpts.every(Boolean)
  const trDone = LANGS.filter((l) => !!(pi[l] ?? '').trim())

  function setOptText(l: string, k: number, val: string) {
    setOi((o) => { const arr = [...(o[l] ?? [])]; arr[k] = val; return { ...o, [l]: arr } })
  }
  function removeOpt(k: number) {
    setOi((o) => { const next = { ...o }; for (const l of ALL_LANGS) if (o[l]) next[l] = o[l].filter((_, i) => i !== k); return next })
    setCorrect((c) => (c > k ? c - 1 : c === k ? 0 : c))
  }

  // 한국어 원문 → 5개 언어 자동 번역(번역 탭과 동일 파이프라인). 보기 개수가 어긋난 언어는 버린다(서버 검증 통과용).
  async function translate() {
    setBusy(true)
    setMsg('번역 중… (영어·일본어·중국어·힌디어·베트남어)')
    const [res] = await runTranslation(
      [{ prompt: (pi.ko ?? '').trim(), options: koOpts, explanation: (ei.ko ?? '').trim() }],
      [...LANGS],
    )
    if (!res || 'error' in res) {
      setMsg('번역 실패: ' + (res ? res.error : '빈 응답'))
      setBusy(false)
      return
    }
    const tr = res.tr as Record<string, TransItem>
    const ok: string[] = []
    const bad: string[] = []
    const nextP = { ...pi }, nextO = { ...oi }, nextE = { ...ei }
    for (const l of LANGS) {
      const t = tr[l]
      if (!t?.prompt || !Array.isArray(t.options) || t.options.length !== koOpts.length) { bad.push(l); continue }
      nextP[l] = t.prompt
      nextO[l] = t.options
      nextE[l] = t.explanation ?? ''
      ok.push(l)
    }
    setPi(nextP); setOi(nextO); setEi(nextE)
    const issues = Object.entries(res.issues ?? {}).filter(([, v]) => (v ?? []).length)
    setMsg(
      (bad.length ? `⚠️ ${bad.map((l) => LANG_LABEL[l]).join('·')} 실패 — 다시 시도하세요. ` : `✅ ${ok.length}개 언어 번역 완료. `) +
      (issues.length ? `검수 경고: ${issues.map(([l, v]) => `${LANG_LABEL[l] ?? l}(${v.join(',')})`).join(' / ')}` : '언어 탭에서 확인 후 저장하세요.'),
    )
    setBusy(false)
  }

  // 저장 payload: 한국어는 필수, 나머지는 "문제·보기가 다 차 있고 보기 개수가 ko와 같은" 언어만 보낸다.
  function buildI18n() {
    const P: Record<string, string> = { ko: (pi.ko ?? '').trim() }
    const O: Record<string, string[]> = { ko: koOpts }
    const E: Record<string, string> = { ko: (ei.ko ?? '').trim() }
    const dropped: string[] = []
    for (const l of LANGS) {
      const p = (pi[l] ?? '').trim()
      const o = (oi[l] ?? []).map((s) => (s ?? '').trim())
      if (!p && !o.some(Boolean)) continue // 아예 비어 있으면 조용히 생략(미번역)
      if (!p || o.length !== koOpts.length || o.some((x) => !x)) { dropped.push(l); continue }
      P[l] = p; O[l] = o; E[l] = (ei[l] ?? '').trim()
    }
    return { P, O, E, dropped }
  }

  async function save() {
    if (!(pi.ko ?? '').trim()) { setMsg('문제(한국어)를 입력하세요.'); return }
    if (koOpts.length < 2 || koOpts.some((s) => !s)) { setMsg('보기(한국어)를 모두 채우세요. (2개 이상)'); return }
    if (koOpts.length !== need) { setMsg(`레벨 ${level}은 보기 ${need}개 고정입니다. (현재 ${koOpts.length}개 — ✕ 로 지우세요)`); return }
    if (!cat) { setMsg('영역을 선택하세요.'); return }
    const { P, O, E, dropped } = buildI18n()
    setBusy(true)
    setMsg('저장 중…')
    try {
      await callFunction('admin-test', {
        action: 'upsert',
        rows: [{
          ...(row ? { id: row.id } : {}),
          level, category: cat, correct_index: correct,
          prompt_i18n: P, options_i18n: O, explanation_i18n: E, active,
        }],
      })
      setMsg(`✅ ${isNew ? '추가' : '저장'}됨`)
      if (dropped.length) alert(`${dropped.map((l) => LANG_LABEL[l]).join('·')} 은(는) 문제·보기가 덜 채워져 저장에서 제외했습니다.`)
      onSaved()
    } catch (e) {
      setMsg('실패: ' + (e instanceof Error ? e.message : String(e)))
      setBusy(false)
    }
  }

  return (
    <div className="lt-modal">
      <div className="lt-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-h">
          <b>{isNew ? '문항 추가' : '문항 수정'}</b>
          <span className="admin-hint">{row ? row.code ?? `Lv.${row.level}` : '번호(L1-001…)는 저장 시 자동 부여'}</span>
          <button className="admin-x" onClick={onClose}>✕</button>
        </div>
        <div className="admin-row">
          {isNew ? (
            <label>레벨 <select value={level} onChange={(e) => {
              const lv = +e.target.value
              setLevel(lv)
              setCat(axesForLevel(lv, 'ko')[0]?.key ?? '')
              // 레벨을 바꾸면 보기 칸 수도 그 레벨 값으로 맞춘다(모자라면 빈칸 추가, 넘치면 뒤를 자름).
              // Lv.3↔Lv.4 를 오가면 4↔5 로 바뀐다.
              const c = optionCountForLevel(lv)
              setOi((o) => {
                const next: Record<string, string[]> = {}
                for (const [l, arr] of Object.entries(o)) {
                  next[l] = Array.from({ length: c }, (_, i) => arr[i] ?? '')
                }
                return next
              })
              setCorrect((x) => (x >= c ? 0 : x))
            }}>
              {Array.from({ length: MAX_LEVEL }, (_, i) => i + 1).map((l) => <option key={l} value={l}>Lv.{l}</option>)}
            </select></label>
          ) : null}
          <label>영역 <select value={cat} onChange={(e) => setCat(e.target.value)}>{axes.map((a) => <option key={a.key} value={a.key}>{a.short}</option>)}</select></label>
          <label><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ width: 'auto' }} /> 활성</label>
        </div>
        {/* 한국어로 작성 → 자동 번역으로 5개 언어를 채운다(실패 언어는 저장에서 제외되고 목록에 '미번역'으로 표시). */}
        <div className="admin-row" style={{ marginTop: 10, gap: 8, alignItems: 'center' }}>
          <button className="btn-ink" disabled={busy || !koReady} onClick={translate}>
            {busy ? '처리 중…' : '🌐 자동 번역 (5개 언어)'}
          </button>
          <span className="admin-hint">
            {koReady
              ? `한국어 원문 기준 · 현재 번역됨 ${trDone.length}/${LANGS.length}`
              : '문제·보기(한국어)를 모두 채우면 번역할 수 있어요.'}
          </span>
        </div>
        <div className="admin-langtabs" style={{ marginLeft: 0, marginTop: 10 }}>
          {['ko', ...LANGS].map((l) => (
            <button key={l} className={lang === l ? 'on' : ''} onClick={() => setLang(l)}>
              {LANG_LABEL[l]}{l !== 'ko' && !(pi[l] ?? '').trim() ? ' •' : ''}
            </button>
          ))}
        </div>
        <div className="admin-sub" style={{ marginTop: 8 }}>문제 ({LANG_LABEL[lang]})</div>
        <input className="admin-in" value={pi[lang] ?? ''} placeholder="문제" onChange={(e) => setPi((p) => ({ ...p, [lang]: e.target.value }))} />
        <div className="admin-sub">보기 <span className="admin-hint">
          ◉ 표시가 정답 · 보기 개수/정답은 모든 언어 공통 · 레벨 {level}은 {need}지선다 고정
        </span></div>
        <div className="opt-editor">
          {Array.from({ length: koCount }, (_, k) => k).map((k) => (
            <div key={k} className={`opt-row ${correct === k ? 'is-correct' : ''}`}>
              <label className="opt-radio" title="정답으로 지정">
                <input type="radio" name="correct" checked={correct === k} onChange={() => setCorrect(k)} />
              </label>
              <span className="opt-num">{k + 1}</span>
              <input className="opt-in" value={(oi[lang] ?? [])[k] ?? ''} placeholder={`보기 ${k + 1}`} onChange={(e) => setOptText(lang, k, e.target.value)} />
              <button className="opt-del" title="삭제" disabled={koCount <= need} onClick={() => removeOpt(k)}>✕</button>
            </div>
          ))}
          {/* 보기 개수가 고정인 레벨(1~3)에선 추가 자체를 막는다 — 저장해도 서버가 400 으로 되돌린다 */}
        </div>
        <div className="admin-sub">해설</div>
        <textarea className="admin-ta" rows={3} value={ei[lang] ?? ''} onChange={(e) => setEi((x) => ({ ...x, [lang]: e.target.value }))} />
        <div className="admin-row" style={{ marginTop: 12 }}>
          <button className="btn-ink" onClick={save} disabled={busy}>{isNew ? '추가' : '저장'}</button>
          {msg ? <span className="admin-msg">{msg}</span> : null}
        </div>
      </div>
    </div>
  )
}

// ============================ 문항 이력 탭 ============================
interface QEvent {
  id: string
  question_id: string | null
  code: string | null
  level: number | null
  action: 'edit' | 'deactivate' | 'activate' | 'delete'
  actor: string | null
  detail: Record<string, { before: unknown; after: unknown }> | null
  created_at: string
  restorable?: boolean // 그 문항이 *현재* 비활성/삭제라 되돌릴 수 있는가(서버 계산)
}
const EV_FIELD: Record<string, string> = { prompt_i18n: '문제', options_i18n: '보기', explanation_i18n: '해설', correct_index: '정답', category: '영역', active: '활성' }
function evVal(field: string, v: unknown): string {
  if (v === null || v === undefined) return '-'
  if (field === 'correct_index') return `${Number(v) + 1}번`
  if (field === 'category') return axisDef(String(v), 'ko').short
  if (field === 'active') return v ? '활성' : '비활성'
  if (field === 'options_i18n') { const ko = (v as { ko?: unknown })?.ko; return Array.isArray(ko) ? ko.join(' / ') : '-' }
  if (field === 'prompt_i18n' || field === 'explanation_i18n') return (v as { ko?: string })?.ko ?? '-'
  return String(v)
}
function EvBadge({ a }: { a: QEvent['action'] }) {
  if (a === 'edit') return <span className="badge low">수정</span>
  if (a === 'deactivate') return <span className="badge none">비활성</span>
  if (a === 'activate') return <span className="badge ok">활성·복구</span>
  return <span className="badge none" style={{ color: '#dc2626' }}>삭제</span>
}
interface QState { id: string; code: string | null; level: number | null; category: string; prompt: string; deleted_at: string | null }
function EventsTab() {
  // 탭: 히스토리(전체 이벤트 로그) / 비활성(현재 active=false) / 삭제(현재 deleted)
  const [tab, setTab] = useState<'history' | 'inactive' | 'deleted'>('history')
  const [rows, setRows] = useState<QEvent[]>([])
  const [inactive, setInactive] = useState<QState[]>([])
  const [deleted, setDeleted] = useState<QState[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set()) // 비활성·삭제 탭의 체크박스(일괄 되돌리기)
  const [bulk, setBulk] = useState('')

  async function load() {
    setLoading(true); setErr(''); setSel(new Set())
    try {
      if (tab === 'history') {
        const r = await callFunction<{ events: QEvent[] }>('admin-test', { action: 'events', filter: 'all' })
        setRows(r.events)
      } else {
        const r = await callFunction<{ inactive: QState[]; deleted: QState[] }>('admin-test', { action: 'restorable' })
        setInactive(r.inactive); setDeleted(r.deleted)
      }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    setLoading(false)
  }
  useEffect(() => { load() }, [tab]) // eslint-disable-line

  async function restore(it: { id: string; code: string | null }) {
    if (!confirm(`${it.code ?? '이 문항'} 을(를) 다시 활성 상태로 되돌릴까요?`)) return
    try {
      await callFunction('admin-test', { action: 'restore', id: it.id })
      alert('✅ 되돌렸습니다. 문항 목록에 다시 나타납니다.')
      load()
    } catch (e) { alert('실패: ' + (e instanceof Error ? e.message : String(e))) }
  }

  const qq = q.trim().toLowerCase()
  const matchCode = (c: string | null) => !qq || (c ?? '').toLowerCase().includes(qq)
  const TABS: [typeof tab, string][] = [['history', '히스토리'], ['inactive', '비활성'], ['deleted', '삭제']]
  const evView = rows.filter((r) => matchCode(r.code))
  const stateView = (tab === 'inactive' ? inactive : deleted).filter((r) => matchCode(r.code))
  const count = tab === 'history' ? evView.length : stateView.length

  const selCount = stateView.filter((r) => sel.has(r.id)).length
  const allChecked = stateView.length > 0 && selCount === stateView.length
  function toggle(id: string) {
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function toggleAll() {
    setSel((s) => {
      const n = new Set(s)
      if (allChecked) stateView.forEach((r) => n.delete(r.id))
      else stateView.forEach((r) => n.add(r.id))
      return n
    })
  }
  // 선택 일괄 되돌리기 — 벌크 API가 없어 건별 호출을 4개씩 병렬로.
  async function bulkRestore() {
    const targets = stateView.filter((r) => sel.has(r.id))
    if (!targets.length) return
    if (!confirm(`선택한 ${targets.length}개 문항을 다시 활성 상태로 되돌릴까요?\n문항 목록에 다시 나타납니다.`)) return
    setBulk(`되돌리는 중… 0/${targets.length}`)
    let done = 0
    const fails: string[] = []
    let i = 0
    const worker = async () => {
      while (i < targets.length) {
        const it = targets[i++]
        try { await callFunction('admin-test', { action: 'restore', id: it.id }) }
        catch { fails.push(it.code ?? it.id.slice(0, 6)) }
        setBulk(`되돌리는 중… ${++done}/${targets.length}`)
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, targets.length) }, worker))
    setBulk(fails.length ? `⚠️ ${targets.length - fails.length}개 복구 · 실패 ${fails.length}개(${fails.join(', ')})` : `✅ ${targets.length}개 되돌림`)
    await load()
  }

  if (err) return <ErrBox msg={err} />

  return (
    <div>
      <div className="admin-section">
        <div className="admin-toolbar">
          <div className="admin-period">
            {TABS.map(([f, label]) => (
              <button key={f} className={tab === f ? 'on' : ''} onClick={() => setTab(f)}>{label}</button>
            ))}
          </div>
          <input className="admin-search" placeholder="번호(L3-045) 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="admin-hint">{count}건{loading ? ' · 불러오는 중…' : ''}</span>
        </div>

        {tab === 'history' ? (
          <>
            <p className="admin-hint" style={{ margin: '0 0 10px' }}>수정·비활성·복구·삭제 자취 전체 기록입니다(되돌리기는 ‘비활성/삭제’ 탭에서).</p>
            <div className="ev-list">
              {evView.map((ev) => (
                <div key={ev.id} className="ev-card">
                  <div className="ev-head">
                    <span style={{ fontWeight: 800, color: '#3f8fd6' }}>{ev.code ?? '번호없음'}</span>
                    <EvBadge a={ev.action} />
                    {ev.level ? <span className="admin-hint">Lv.{ev.level}</span> : null}
                    <span className="admin-hint">· {ev.actor ?? '-'}</span>
                    <span className="admin-hint">· {fmtDT(ev.created_at)}</span>
                  </div>
                  {ev.action === 'edit' && ev.detail ? (
                    <div className="ev-diff">
                      {Object.entries(ev.detail).map(([field, v]) => (
                        <div key={field} className="ev-diff-row">
                          <span className="ev-field">{EV_FIELD[field] ?? field}</span>
                          <span className="ev-before">{evVal(field, v.before)}</span>
                          <span className="ev-arr">→</span>
                          <span className="ev-after">{evVal(field, v.after)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            {evView.length === 0 && !loading ? <div className="admin-empty">해당 이력이 없습니다.</div> : null}
          </>
        ) : (
          <>
            {/* 선택 일괄 되돌리기 */}
            {stateView.length ? (
              <div className="admin-toolbar" style={{ marginBottom: 10 }}>
                <label style={{ gap: 6 }}>
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} style={{ width: 'auto' }} /> 전체 선택
                </label>
                {selCount ? <b>{selCount}개 선택됨</b> : <span className="admin-hint">여러 개 선택해 한 번에 되돌릴 수 있어요.</span>}
                {selCount ? <button className="admin-mini" disabled={bulk.endsWith('중…')} onClick={bulkRestore}>선택 되돌리기</button> : null}
                {selCount ? <button className="admin-mini" onClick={() => setSel(new Set())}>선택 해제</button> : null}
                {bulk ? <span className="admin-msg">{bulk}</span> : null}
              </div>
            ) : null}
            <div className="ev-list">
              {stateView.map((it) => (
                <div key={it.id} className="ev-card">
                  <div className="ev-head">
                    <input type="checkbox" checked={sel.has(it.id)} onChange={() => toggle(it.id)} style={{ width: 'auto' }} />
                    <span style={{ fontWeight: 800, color: '#3f8fd6' }}>{it.code ?? '번호없음'}</span>
                    {it.level ? <span className="admin-hint">Lv.{it.level}</span> : null}
                    <span className="admin-hint">· {axisDef(it.category, 'ko').short}</span>
                    {it.deleted_at ? <span className="admin-hint">· 삭제 {fmtDT(it.deleted_at)}</span> : null}
                    <button className="admin-mini" style={{ marginLeft: 'auto' }} onClick={() => restore(it)}>되돌리기</button>
                  </div>
                  {it.prompt ? <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted)' }}>{it.prompt}</p> : null}
                </div>
              ))}
            </div>
            {stateView.length === 0 && !loading ? (
              <div className="admin-empty">{tab === 'inactive' ? '현재 비활성인 문항이 없습니다.' : '현재 삭제된 문항이 없습니다.'}</div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

// ============================ 관리자 관리 탭 (루트 전용) ============================
interface AdminRow { email: string; role: 'root' | 'admin'; added_by: string | null; created_at: string | null }
function AdminsTab() {
  const [rows, setRows] = useState<AdminRow[] | null>(null)
  const [candidates, setCandidates] = useState<string[]>([])
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const r = await callFunction<{ admins: AdminRow[]; candidates?: string[] }>('admin-test', { action: 'admins' })
      setRows(r.admins); setCandidates(r.candidates ?? [])
    } catch (e) { setMsg('불러오기 실패: ' + (e instanceof Error ? e.message : String(e))); setRows([]) }
  }
  useEffect(() => { load() }, [])

  async function add() {
    const t = email.trim().toLowerCase()
    if (!t) return
    setBusy(true); setMsg('')
    try {
      const r = await callFunction<{ admins: AdminRow[]; candidates?: string[] }>('admin-test', { action: 'addAdmin', email: t })
      setRows(r.admins); setCandidates(r.candidates ?? []); setEmail(''); setMsg(`✅ ${t} 추가됨`)
    } catch (e) { setMsg('실패: ' + (e instanceof Error ? e.message : String(e))) }
    setBusy(false)
  }
  async function remove(target: string) {
    if (!confirm(`${target} 을(를) 관리자에서 삭제할까요?`)) return
    setBusy(true); setMsg('')
    try {
      const r = await callFunction<{ admins: AdminRow[]; candidates?: string[] }>('admin-test', { action: 'removeAdmin', email: target })
      setRows(r.admins); setCandidates(r.candidates ?? []); setMsg(`🗑 ${target} 삭제됨`)
    } catch (e) { setMsg('실패: ' + (e instanceof Error ? e.message : String(e))) }
    setBusy(false)
  }

  return (
    <div>
      <div className="admin-section">
        <h3>관리자 추가</h3>
        <p className="admin-desc">이미 <b>로그인(회원가입)한 유저</b>만 관리자로 지정할 수 있어요. 추가하면 그 계정으로 로그인 시 관리자 페이지를 쓸 수 있습니다. (추가·삭제는 루트 관리자만)</p>
        <div className="admin-toolbar">
          <input className="admin-search" list="admin-candidates" placeholder="가입 유저 이메일 선택/입력" value={email}
            onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add() }} />
          <datalist id="admin-candidates">
            {candidates.map((c) => <option key={c} value={c} />)}
          </datalist>
          <button className="btn-ink" onClick={add} disabled={busy || !email.trim()}>추가</button>
          <span className="admin-hint">지정 가능 {candidates.length}명</span>
          {msg ? <span className="admin-msg">{msg}</span> : null}
        </div>
      </div>
      <div className="admin-section">
        <h3>관리자 목록 <span className="admin-hint">{rows ? `${rows.length}명` : ''}</span></h3>
        <table className="admin-table">
          <thead><tr><th>이메일</th><th>권한</th><th>추가한 사람</th><th>추가일</th><th></th></tr></thead>
          <tbody>
            {(rows ?? []).map((a) => (
              <tr key={a.email}>
                <td>{a.email}</td>
                <td>{a.role === 'root' ? <span className="badge ok">루트</span> : <span className="badge low">관리자</span>}</td>
                <td>{a.added_by ?? '-'}</td>
                <td>{fmtDate(a.created_at)}</td>
                <td>{a.role === 'root'
                  ? <span className="admin-hint">삭제 불가</span>
                  : <button className="admin-mini" onClick={() => remove(a.email)} disabled={busy}>삭제</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && rows.length === 0 ? <div className="admin-empty">불러오기 실패 또는 비어 있음</div> : null}
      </div>
    </div>
  )
}

// ============================ 번역 탭 (엑셀 업로드 + 자동번역) ============================
// ── 번역 작업 자동저장/이어서하기 (localStorage) ──
const XLATE_JOB_KEY = 'gara_xlate_job_v1'
interface XlateJob {
  fileName: string
  level: number
  cfg: ColCfg
  catMap: Record<string, string>
  drafts: QDraft[]
  savedAt: number
}
function saveXlateJob(job: Omit<XlateJob, 'savedAt'>): boolean {
  try {
    localStorage.setItem(XLATE_JOB_KEY, JSON.stringify({ ...job, savedAt: Date.now() }))
    return true
  } catch {
    return false // 용량 초과 등 — 호출부에서 1회 경고
  }
}
function loadXlateJob(): XlateJob | null {
  try {
    const s = localStorage.getItem(XLATE_JOB_KEY)
    return s ? (JSON.parse(s) as XlateJob) : null
  } catch {
    return null
  }
}
function clearXlateJob() {
  try { localStorage.removeItem(XLATE_JOB_KEY) } catch { /* noop */ }
}
// 번역 결과 배열을 drafts 뼈대에 병합(성공 → tr/issues, 실패 → error)
function mergeTransResults(base: QDraft[], results: (TransResult | undefined)[]): QDraft[] {
  return base.map((d, i) => {
    const res = results[i]
    if (!res) return d
    return 'tr' in res
      ? { ...d, tr: res.tr as Record<string, TransItem>, issues: res.issues, error: '' }
      : { ...d, error: res.error }
  })
}
// 모든 대상 언어가 번역 완료된 문항인지
const draftDone = (d: QDraft) => LANGS.every((l) => !!d.tr[l]?.prompt)

interface QDraft {
  num: string
  excelCat: string
  correctIndex: number // 0-based
  ko: TransItem
  tr: Record<string, TransItem>
  issues: Record<string, string[]>
  error: string
  excluded: boolean
}

// ── 한글 원본 임포트: 자동 인식 헬퍼 (사람마다 다른 형식 대응) ──
type ColCfg = { cNum: number; cCat: number; cPrompt: number; cOptions: number[]; cAns: number; cExpl: number }

// 비교용 정규화: 공백·구두점·접속사(및) 제거
function normKey(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/\s+/g, '').replace(/[·.,/()[\]{}・:|~\-]/g, '').replace(/및/g, '')
}
function bigrams(s: string): string[] {
  const t = normKey(s)
  if (t.length < 2) return t ? [t] : []
  const out: string[] = []
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2))
  return out
}
// 0~1 유사도(Dice 계수)
function sim(a: string, b: string): number {
  const A = bigrams(a), B = bigrams(b)
  if (!A.length || !B.length) return normKey(a) && normKey(a) === normKey(b) ? 1 : 0
  const cnt = new Map<string, number>()
  for (const x of B) cnt.set(x, (cnt.get(x) ?? 0) + 1)
  let inter = 0
  for (const x of A) { const c = cnt.get(x); if (c) { inter++; cnt.set(x, c - 1) } }
  return (2 * inter) / (A.length + B.length)
}
// 영역 텍스트 → 그 레벨에서 가장 비슷한 축 코드
function bestAxis(cat: string, level: number): { key: string; score: number } {
  let best = { key: '', score: 0 }
  for (const a of axesForLevel(level, 'ko')) {
    const s = Math.max(sim(cat, a.label), sim(cat, a.short))
    if (s > best.score) best = { key: a.key, score: s }
  }
  return best
}
// 영역 집합으로 레벨 추정(지문)
function detectLevelByCats(cats: string[]): number {
  let best = { lv: 0, score: 0 }
  for (let lv = 1; lv <= MAX_LEVEL; lv++) {
    if (!axesForLevel(lv).length) continue
    const score = cats.reduce((s, c) => s + bestAxis(c, lv).score, 0)
    if (score > best.score) best = { lv, score }
  }
  return best.lv || 1
}
function detectLevelFromName(name: string): number {
  const m = String(name).match(/(?:level|레벨|lv)\s*\.?\s*([1-7])/i)
  return m ? +m[1] : 0
}
// 헤더 행으로 컬럼 자동 인식
const HEAD_ALIAS = {
  num: ['번호', 'no', '순번', '문항번호'],
  cat: ['영역', '출제영역', '카테고리', '분류', '영역명'],
  prompt: ['문제', '문항', '질문', 'question'],
  ans: ['정답', '정답번호', 'answer', '정답인덱스'],
  expl: ['해설', '설명', '풀이', 'explanation'],
}
function findCol(header: string[], aliases: string[]): number {
  const h = header.map(normKey)
  for (const a of aliases) { const i = h.indexOf(normKey(a)); if (i >= 0) return i }
  for (let i = 0; i < h.length; i++) if (h[i] && aliases.some((a) => h[i].includes(normKey(a)))) return i
  return -1
}
function detectColumns(header: string[], ncol: number): { cfg: ColCfg; hasHeader: boolean } {
  const h = header.map(normKey)
  const optCols = h.map((x, i) => ({ x, i })).filter((o) => /보기|선택지|option|지문/.test(o.x)).map((o) => o.i)
  const cPrompt = findCol(header, HEAD_ALIAS.prompt)
  const cAns = findCol(header, HEAD_ALIAS.ans)
  const cCat = findCol(header, HEAD_ALIAS.cat)
  const cNum = findCol(header, HEAD_ALIAS.num)
  const cExpl = findCol(header, HEAD_ALIAS.expl)
  const hasHeader = cPrompt >= 0 || cAns >= 0 || cCat >= 0
  return {
    cfg: {
      cNum: cNum >= 0 ? cNum : 0,
      cCat: cCat >= 0 ? cCat : 1,
      cPrompt: cPrompt >= 0 ? cPrompt : 2,
      cOptions: optCols.length ? optCols : [3, 4, 5, 6, 7].filter((c) => c < ncol),
      cAns: cAns >= 0 ? cAns : 8,
      cExpl: cExpl >= 0 ? cExpl : 9,
    },
    hasHeader,
  }
}
function colLetter(i: number): string {
  let s = ''; let n = i
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1 } while (n >= 0)
  return s
}
// 한 행이 "머리글"처럼 보이는 정도(알려진 헤더 종류가 몇 개 들어있나)
function rowHeaderScore(row: string[]): number {
  const cells = (row ?? []).map(normKey).filter(Boolean)
  const groups = [HEAD_ALIAS.prompt, HEAD_ALIAS.ans, HEAD_ALIAS.cat, HEAD_ALIAS.expl, HEAD_ALIAS.num, ['보기', '선택지', 'option']]
  let hits = 0
  for (const g of groups) if (cells.some((c) => g.some((a) => c === normKey(a) || c.includes(normKey(a))))) hits++
  return hits
}
// 앞쪽 행들을 훑어 머리글 행 위치를 찾는다(제목/안내 줄이 위에 있어도 대응). 못 찾으면 0행.
function findHeaderRow(aoa: string[][], maxScan = 15): number {
  let best = { idx: 0, score: 0 }
  const lim = Math.min(maxScan, aoa.length)
  for (let i = 0; i < lim; i++) {
    const s = rowHeaderScore(aoa[i])
    if (s > best.score) best = { idx: i, score: s }
  }
  return best.score >= 2 ? best.idx : 0
}

function UploadTab() {
  const [wb, setWb] = useState<XLSX.WorkBook | null>(null)
  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [sheetIdx, setSheetIdx] = useState(0)
  const [rows, setRows] = useState<string[][] | null>(null)
  const [fileName, setFileName] = useState('')
  const [headerRow, setHeaderRow] = useState(0) // 머리글 행 인덱스(0-based, -1=머리글 없음)
  const [cfg, setCfg] = useState<ColCfg>({ cNum: 0, cCat: 1, cPrompt: 2, cOptions: [3, 4, 5, 6, 7], cAns: 8, cExpl: 9 })
  const [editCols, setEditCols] = useState(false)
  const [level, setLevel] = useState(1)
  const [detectedLevel, setDetectedLevel] = useState(0)
  const [catMap, setCatMap] = useState<Record<string, string>>({})
  const [phase, setPhase] = useState<'config' | 'translating' | 'review'>('config')
  const [progress, setProgress] = useState({ done: 0, total: 0, note: '' })
  const [drafts, setDrafts] = useState<QDraft[]>([])
  const [reviewLang, setReviewLang] = useState<string>('en')
  const [onlyProblems, setOnlyProblems] = useState(true)
  const [applyMsg, setApplyMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [savedJob, setSavedJob] = useState<XlateJob | null>(null) // 이어서할 작업(배너)
  const [saveWarn, setSaveWarn] = useState(false) // 자동저장 용량초과 경고

  // 진입 시 저장된 미완료 작업이 있으면 배너로 안내
  useEffect(() => { setSavedJob(loadXlateJob()) }, [])

  // 번역 진행 중 이탈 시 브라우저 기본 경고
  useEffect(() => {
    if (!(busy && phase === 'translating')) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [busy, phase])

  function persistJob(
    draftsArr: QDraft[],
    meta: { level: number; catMap: Record<string, string>; cfg: ColCfg; fileName: string },
  ) {
    const ok = saveXlateJob({ fileName: meta.fileName, level: meta.level, cfg: meta.cfg, catMap: meta.catMap, drafts: draftsArr })
    if (!ok) setSaveWarn(true)
  }
  function discardJob() { clearXlateJob(); setSavedJob(null) }

  const axes = axesForLevel(level, 'ko')
  const data = rows ? rows.slice(headerRow + 1) : []
  const distinctCats = Array.from(new Set(data.map((r) => String(r[cfg.cCat] ?? '').trim()).filter(Boolean)))
  const ncol = rows && rows.length ? Math.max(...rows.map((r) => r.length)) : 0

  function suggestCatMap(cats: string[], lv: number): Record<string, string> {
    const m: Record<string, string> = {}
    for (const c of cats) { const b = bestAxis(c, lv); if (b.score >= 0.5) m[c] = b.key }
    return m
  }

  // 머리글 행 수동 변경 → 그 행 기준으로 열·카테고리 재인식
  function changeHeaderRow(i: number) {
    setHeaderRow(i)
    if (!rows) return
    const det = detectColumns(rows[i] ?? [], ncol)
    setCfg(det.cfg)
    const body = rows.slice(i + 1)
    const cats = Array.from(new Set(body.map((r) => String(r[det.cfg.cCat] ?? '').trim()).filter(Boolean)))
    setCatMap(suggestCatMap(cats, level))
  }

  // 시트 1개를 읽어 자동 인식(열·레벨·카테고리)까지 수행
  function ingestSheet(workbook: XLSX.WorkBook, idx: number, name: string) {
    const ws = workbook.Sheets[workbook.SheetNames[idx]]
    const aoa = XLSX.utils
      .sheet_to_json<string[]>(ws, { header: 1, defval: '', raw: false })
      .filter((row) => row.some((c) => String(c).trim() !== ''))
    setRows(aoa)
    setSheetIdx(idx)
    setPhase('config')
    setDrafts([])
    setApplyMsg('')
    const nc = aoa.length ? Math.max(...aoa.map((r) => r.length)) : 0
    const hr = findHeaderRow(aoa)
    const det = detectColumns(aoa[hr] ?? [], nc)
    setCfg(det.cfg)
    setHeaderRow(hr)
    setEditCols(false)
    const body = aoa.slice(hr + 1)
    const cats = Array.from(new Set(body.map((r) => String(r[det.cfg.cCat] ?? '').trim()).filter(Boolean)))
    const lv = detectLevelFromName(name) || detectLevelFromName(workbook.SheetNames[idx]) || detectLevelByCats(cats)
    setLevel(lv)
    setDetectedLevel(lv)
    setCatMap(suggestCatMap(cats, lv))
  }

  function handleFile(file: File) {
    setFileName(file.name)
    const r = new FileReader()
    r.onload = (e) => {
      const workbook = XLSX.read(e.target?.result, { type: 'array' })
      setWb(workbook)
      setSheetNames(workbook.SheetNames)
      ingestSheet(workbook, 0, file.name)
    }
    r.readAsArrayBuffer(file)
  }

  async function startTranslate() {
    const unmappedC = distinctCats.filter((c) => !catMap[c])
    if (unmappedC.length) {
      setApplyMsg(`카테고리 매핑 필요: ${unmappedC.join(', ')}`)
      return
    }
    setApplyMsg('')
    setSaveWarn(false)
    setBusy(true)
    setPhase('translating')
    const skeleton: QDraft[] = data.map((row, i) => {
      const optCols = cfg.cOptions.filter((c) => String(row[c] ?? '').trim() !== '')
      return {
        num: String(row[cfg.cNum] ?? i + 1),
        excelCat: String(row[cfg.cCat] ?? '').trim(),
        correctIndex: Math.max(0, (parseInt(String(row[cfg.cAns] ?? '1'), 10) || 1) - 1),
        ko: {
          prompt: String(row[cfg.cPrompt] ?? '').trim(),
          options: optCols.map((c) => String(row[c])),
          explanation: String(row[cfg.cExpl] ?? '').trim(),
        },
        tr: {},
        issues: {},
        error: '',
        excluded: false,
      }
    })
    const meta = { level, catMap, cfg, fileName }
    setDrafts(skeleton)
    setProgress({ done: 0, total: skeleton.length, note: '' })
    setSavedJob(null)
    persistJob(skeleton, meta)
    const results = await runTranslation(
      skeleton.map((d) => d.ko),
      [...LANGS],
      (done, total, note) => setProgress({ done, total, note }),
      {
        onBatch: (rs) => {
          const merged = mergeTransResults(skeleton, rs)
          setDrafts(merged)
          persistJob(merged, meta)
        },
      },
    )
    const built = mergeTransResults(skeleton, results)
    setDrafts(built)
    persistJob(built, meta)
    setPhase('review')
    setBusy(false)
  }

  // 저장된 작업 이어서: 미번역·실패 문항만 다시 호출
  async function resumeJob() {
    const job = savedJob ?? loadXlateJob()
    if (!job) return
    setSaveWarn(false)
    setFileName(job.fileName)
    setLevel(job.level)
    setCfg(job.cfg)
    setCatMap(job.catMap)
    setDrafts(job.drafts)
    setSavedJob(null)
    const base = job.drafts
    const meta = { level: job.level, catMap: job.catMap, cfg: job.cfg, fileName: job.fileName }
    if (base.every(draftDone)) { setPhase('review'); return }
    setBusy(true)
    setPhase('translating')
    const seed: (TransResult | undefined)[] = base.map((d) =>
      draftDone(d) ? { tr: d.tr, issues: d.issues } : undefined,
    )
    setProgress({ done: seed.filter(Boolean).length, total: base.length, note: '이어서' })
    const results = await runTranslation(
      base.map((d) => d.ko),
      [...LANGS],
      (done, total, note) => setProgress({ done, total, note }),
      {
        seed,
        onBatch: (rs) => {
          const merged = mergeTransResults(base, rs)
          setDrafts(merged)
          persistJob(merged, meta)
        },
      },
    )
    const built = mergeTransResults(base, results)
    setDrafts(built)
    persistJob(built, meta)
    setPhase('review')
    setBusy(false)
  }

  function hasProblem(d: QDraft): boolean {
    if (d.error) return true
    for (const l of LANGS) {
      if (!d.tr[l] || !d.tr[l].prompt) return true
      if ((d.issues[l] || []).length) return true
    }
    return false
  }

  function editTr(idx: number, lang: string, field: 'prompt' | 'explanation', val: string) {
    setDrafts((ds) =>
      ds.map((d, i) => {
        if (i !== idx) return d
        const cur = d.tr[lang] ?? { prompt: '', options: [...d.ko.options], explanation: '' }
        return { ...d, tr: { ...d.tr, [lang]: { ...cur, [field]: val } }, error: '' }
      }),
    )
  }
  function editOpts(idx: number, lang: string, text: string) {
    const opts = text.split('\n')
    setDrafts((ds) =>
      ds.map((d, i) => {
        if (i !== idx) return d
        const cur = d.tr[lang] ?? { prompt: '', options: [], explanation: '' }
        return { ...d, tr: { ...d.tr, [lang]: { ...cur, options: opts } }, error: '' }
      }),
    )
  }
  function toggleExclude(idx: number) {
    setDrafts((ds) => ds.map((d, i) => (i === idx ? { ...d, excluded: !d.excluded } : d)))
  }
  async function retranslateOne(idx: number) {
    setBusy(true)
    const d = drafts[idx]
    const [res] = await runTranslation([d.ko], [...LANGS])
    setDrafts((ds) =>
      ds.map((x, i) =>
        i === idx
          ? 'tr' in res
            ? { ...x, tr: res.tr as Record<string, TransItem>, issues: res.issues, error: '' }
            : { ...x, error: res.error }
          : x,
      ),
    )
    setBusy(false)
  }

  async function apply() {
    const use = drafts.filter((d) => !d.excluded)
    const bad = use.filter((d) => d.error || !catMap[d.excelCat])
    if (bad.length) {
      setApplyMsg(`반영 불가: 오류/미매핑 ${bad.length}개. 수정하거나 제외하세요.`)
      return
    }
    const qrows = use.map((d) => {
      const prompt_i18n: Record<string, string> = { ko: d.ko.prompt }
      const options_i18n: Record<string, string[]> = { ko: d.ko.options }
      const explanation_i18n: Record<string, string> = { ko: d.ko.explanation }
      for (const l of LANGS) {
        if (d.tr[l] && d.tr[l].prompt) {
          prompt_i18n[l] = d.tr[l].prompt
          options_i18n[l] = d.tr[l].options
          explanation_i18n[l] = d.tr[l].explanation
        }
      }
      return {
        level,
        category: catMap[d.excelCat],
        correct_index: d.correctIndex,
        prompt_i18n,
        options_i18n,
        explanation_i18n,
        active: true,
      }
    })
    setBusy(true)
    setApplyMsg('반영 중…')
    try {
      const r = await callFunction<{ count: number }>('admin-test', { action: 'upsert', rows: qrows })
      setApplyMsg(`✅ ${r.count}개 문항 반영 완료`)
      discardJob()
    } catch (e) {
      setApplyMsg('반영 실패: ' + (e instanceof Error ? e.message : String(e)))
    }
    setBusy(false)
  }

  function download() {
    const out0 = XLSX.utils.book_new()
    const header = ['번호', '카테고리코드', '정답', '문제', '보기…', '해설']
    for (const lang of ['ko', ...LANGS]) {
      const out: string[][] = [header]
      drafts.forEach((d) => {
        const t = lang === 'ko' ? d.ko : d.tr[lang]
        out.push([
          d.num,
          catMap[d.excelCat] ?? d.excelCat,
          String(d.correctIndex + 1),
          t?.prompt ?? '(미번역)',
          ...(t?.options ?? []),
          t?.explanation ?? '',
        ])
      })
      XLSX.utils.book_append_sheet(out0, XLSX.utils.aoa_to_sheet(out), LANG_LABEL[lang])
    }
    XLSX.writeFile(out0, (fileName.replace(/\.(xlsx|csv)$/i, '') || 'questions') + '_번역.xlsx')
  }

  const shown = phase === 'review' ? drafts.map((d, i) => ({ d, i })).filter(({ d }) => !onlyProblems || hasProblem(d)) : []
  const problemCount = drafts.filter(hasProblem).length

  const cfgOk = cfg.cPrompt >= 0 && cfg.cAns >= 0 && cfg.cOptions.length >= 2
  const colOpts = Array.from({ length: ncol }, (_, i) => ({
    i,
    label: `${colLetter(i)}열${headerRow >= 0 && rows?.[headerRow]?.[i] != null && String(rows[headerRow][i]).trim() ? ' · ' + String(rows[headerRow][i]).trim().slice(0, 12) : ''}`,
  }))
  const optCountOf = (row: string[]) => cfg.cOptions.filter((c) => String(row[c] ?? '').trim() !== '').length
  const rowErrors = data
    .map((row, i) => {
      const errs: string[] = []
      if (!String(row[cfg.cPrompt] ?? '').trim()) errs.push('문제 없음')
      const oc = optCountOf(row)
      if (oc < 2) errs.push('보기 2개 미만')
      const ans = parseInt(String(row[cfg.cAns] ?? ''), 10)
      if (!ans || ans < 1 || ans > oc) errs.push(`정답번호 범위(${String(row[cfg.cAns] ?? '-')})`)
      return { i, num: String(row[cfg.cNum] ?? i + 1), errs }
    })
    .filter((r) => r.errs.length)
  const unmapped = distinctCats.filter((c) => !catMap[c])
  const levelMismatch = !!detectedLevel && level !== detectedLevel
  const canTranslate = data.length > 0 && cfgOk && unmapped.length === 0 && rowErrors.length === 0

  return (
    <div>
      {/* 0) 이어서하기 배너 */}
      {savedJob && phase === 'config' ? (
        <div className="admin-section" style={{ borderColor: 'var(--ink)' }}>
          <div className="admin-row">
            <b>이어서 할 번역 작업이 있어요</b>
            <span>{savedJob.fileName} · {savedJob.drafts.filter(draftDone).length}/{savedJob.drafts.length} 완료</span>
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button className="btn-ink" disabled={busy} onClick={resumeJob}>이어서 하기</button>
            <button className="dl-btn" disabled={busy} onClick={discardJob}>버리기</button>
          </div>
        </div>
      ) : null}

      {/* 1) 파일 + 설정 */}
      <div className="admin-section">
        <div className="up-step">
          <div className="up-step-h"><span className="up-step-n">1</span> 엑셀 파일</div>
          <label
            className={`dropzone ${dragOver ? 'over' : ''} ${rows ? 'has-file' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f) }}
          >
            <input type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => e.target.files && handleFile(e.target.files[0])} />
            <div className="dz-icon">{rows ? '📊' : '⬆️'}</div>
            {rows ? (
              <>
                <div className="dz-title">{fileName}</div>
                <div className="dz-sub">{data.length}문항 · 다른 파일을 끌어다 놓거나 눌러서 교체</div>
              </>
            ) : (
              <>
                <div className="dz-title">엑셀 파일을 끌어다 놓거나 눌러서 선택</div>
                <div className="dz-sub">.xlsx · .xls · .csv · 형식이 달라도 자동 인식</div>
              </>
            )}
          </label>
          {rows && sheetNames.length > 1 ? (
            <div className="admin-row" style={{ marginTop: 10 }}>
              <label>시트 선택&nbsp;
                <select value={sheetIdx} onChange={(e) => wb && ingestSheet(wb, +e.target.value, fileName)}>
                  {sheetNames.map((s, i) => <option key={i} value={i}>{s}</option>)}
                </select>
              </label>
              <span className="admin-hint">시트가 여러 개예요 — 한국어 원본 시트를 고르세요.</span>
            </div>
          ) : null}
        </div>

        {rows ? (
          <>
            <div className="up-step">
              <div className="up-step-h"><span className="up-step-n">2</span> 레벨 확인</div>
              <div className="admin-row">
                <label>레벨&nbsp;
                  <select value={level} onChange={(e) => { const lv = +e.target.value; setLevel(lv); setCatMap(suggestCatMap(distinctCats, lv)) }}>
                    {Array.from({ length: MAX_LEVEL }, (_, i) => i + 1).map((l) => <option key={l} value={l}>Lv.{l}</option>)}
                  </select>
                </label>
                {detectedLevel ? (
                  <span className="admin-hint">자동 감지: <b>Lv.{detectedLevel}</b>{detectedLevel === level ? ' (일치 ✓)' : ''}</span>
                ) : null}
              </div>
              {levelMismatch ? (
                <div className="admin-warn">⚠ 파일은 <b>Lv.{detectedLevel}</b>로 보이는데 <b>Lv.{level}</b>을 선택했어요. 정말 맞나요?</div>
              ) : null}
            </div>

            <div className="up-step">
              <div className="up-step-h">
                <span className="up-step-n">3</span> 열 인식 · 미리보기
                <button className="admin-mini" style={{ marginLeft: 'auto' }} onClick={() => setEditCols((v) => !v)}>{editCols ? '닫기' : '열 수정'}</button>
              </div>
              {!cfgOk ? <div className="admin-warn">⚠ 문제/정답/보기 열을 자동으로 못 찾았어요. <b>‘열 수정’</b>에서 직접 지정하세요.</div> : null}
              {editCols ? (
                <div className="col-map">
                  {([['번호', 'cNum'], ['영역', 'cCat'], ['문제', 'cPrompt'], ['정답번호', 'cAns'], ['해설', 'cExpl']] as const).map(([lbl, key]) => (
                    <div key={key} className="admin-row">
                      <span style={{ width: 64, color: '#6b7686' }}>{lbl}</span>
                      <select value={cfg[key]} onChange={(e) => setCfg((c) => ({ ...c, [key]: +e.target.value }))}>
                        {colOpts.map((o) => <option key={o.i} value={o.i}>{o.label}</option>)}
                      </select>
                    </div>
                  ))}
                  <div className="admin-row" style={{ alignItems: 'flex-start' }}>
                    <span style={{ width: 64, color: '#6b7686', paddingTop: 6 }}>보기</span>
                    <div className="col-chips">
                      {colOpts.map((o) => (
                        <label key={o.i} className={`col-chip ${cfg.cOptions.includes(o.i) ? 'on' : ''}`}>
                          <input type="checkbox" checked={cfg.cOptions.includes(o.i)} onChange={() => setCfg((c) => ({ ...c, cOptions: c.cOptions.includes(o.i) ? c.cOptions.filter((x) => x !== o.i) : [...c.cOptions, o.i].sort((a, b) => a - b) }))} />
                          {o.label}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="up-preview">
                {data.slice(0, 2).map((row, i) => {
                  const opts = cfg.cOptions.filter((c) => String(row[c] ?? '').trim() !== '')
                  const ans = parseInt(String(row[cfg.cAns] ?? ''), 10)
                  return (
                    <div key={i} className="up-prev-item">
                      <div className="up-prev-q"><b>문제</b> {String(row[cfg.cPrompt] ?? '').trim() || <em className="admin-hint">(비어있음)</em>}</div>
                      <ol>{opts.map((c, k) => <li key={c} className={ans === k + 1 ? 'ans' : ''}>{String(row[c])}{ans === k + 1 ? ' ✓정답' : ''}</li>)}</ol>
                      <div className="admin-hint">영역: {String(row[cfg.cCat] ?? '').trim() || '-'} · 정답번호: {String(row[cfg.cAns] ?? '').trim() || '-'}</div>
                    </div>
                  )
                })}
                {!data.length ? <div className="admin-empty">데이터 행이 없습니다.</div> : null}
              </div>
              <div className="dz-opt admin-row">
                <label>머리글 행&nbsp;
                  <select value={headerRow} onChange={(e) => changeHeaderRow(+e.target.value)}>
                    <option value={-1}>없음</option>
                    {(rows ?? []).slice(0, Math.min(15, rows?.length ?? 0)).map((_, i) => <option key={i} value={i}>{i + 1}행</option>)}
                  </select>
                </label>
                <span className="admin-hint">자동 감지됨 · 미리보기가 어긋나면 바꾸세요</span>
              </div>
            </div>

            {distinctCats.length ? (
              <div className="up-step">
                <div className="up-step-h"><span className="up-step-n">4</span> 카테고리 매핑</div>
                <p className="admin-desc">엑셀 영역 → <b>Lv.{level} 영역 코드({axes.length}개)</b>. 비슷한 걸 미리 골라뒀어요 — 확인/수정만 하면 됩니다.</p>
                <div className="admin-catmap">
                  {distinctCats.map((c) => (
                    <div key={c} className={`admin-row ${catMap[c] ? '' : 'prob'}`}>
                      <span className="admin-cat">{c}</span> →
                      <select value={catMap[c] ?? ''} onChange={(e) => setCatMap((m) => ({ ...m, [c]: e.target.value }))}>
                        <option value="">선택…</option>
                        {axes.map((a) => <option key={a.key} value={a.key}>{a.label} ({a.key})</option>)}
                      </select>
                      {catMap[c] ? null : <span className="admin-hint">미매핑</span>}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="up-step">
              {!cfgOk || unmapped.length || rowErrors.length ? (
                <div className="admin-warn">
                  번역/저장 전 고칠 것:
                  {!cfgOk ? <div>· 문제/정답/보기 열이 지정되지 않음</div> : null}
                  {unmapped.length ? <div>· 카테고리 미매핑 {unmapped.length}개: {unmapped.join(', ')}</div> : null}
                  {rowErrors.length ? <div>· 문항 오류 {rowErrors.length}개 (예: {rowErrors.slice(0, 3).map((r) => `${r.num}번 ${r.errs[0]}`).join(' / ')}{rowErrors.length > 3 ? ' …' : ''})</div> : null}
                </div>
              ) : data.length ? (
                <div className="admin-msg">✅ {data.length}문항 검증 통과 — 번역 시작 가능</div>
              ) : null}
              <button className="btn-ink" disabled={busy || !canTranslate} onClick={startTranslate} style={{ marginTop: 12 }}>
                {phase === 'translating' ? '번역 중…' : '번역 시작'}
              </button>
              {applyMsg ? <div className="admin-msg" style={{ marginTop: 8 }}>{applyMsg}</div> : null}
            </div>
          </>
        ) : null}
      </div>

      {/* 2) 진행 */}
      {phase === 'translating' ? (
        <div className="admin-section">
          <div className="admin-bar"><i style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
          <div>{progress.done}/{progress.total} {progress.note}</div>
          <div className="admin-msg" style={{ marginTop: 8 }}>💾 진행상황이 자동 저장돼요 — 페이지를 나가도 다시 들어오면 이어서 할 수 있어요.</div>
          {saveWarn ? (
            <div className="admin-msg" style={{ marginTop: 6, color: 'var(--danger-fg, #b91c1c)' }}>
              ⚠️ 자동저장 용량이 초과돼 일부는 복구가 안 될 수 있어요(배치가 매우 큰 경우). 번역은 계속 진행됩니다.
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 3) 검토 */}
      {phase === 'review' ? (
        <div className="admin-section">
          <div className="admin-row">
            <b>검토</b>
            <span>문제 {problemCount}개</span>
            <label><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> 문제만 보기</label>
            <span className="admin-langtabs">
              {LANGS.map((l) => {
                const cnt = drafts.filter((d) => d.error || !d.tr[l]?.prompt || (d.issues[l] || []).length).length
                return (
                  <button key={l} className={`${reviewLang === l ? 'on' : ''} ${cnt ? 'has-prob' : ''}`} onClick={() => setReviewLang(l)}>
                    {LANG_LABEL[l]}{cnt ? ` (${cnt})` : ''}
                  </button>
                )
              })}
            </span>
          </div>

          {/* 열 폭 고정(colgroup + .review-table) — 편집칸·검수 사유가 길어도 표가 카드 밖으로 안 넘치게 */}
          <div className="review-wrap">
          <table className="admin-table review-table">
            <colgroup>
              <col style={{ width: 44 }} />
              <col style={{ width: '32%' }} />
              <col style={{ width: '34%' }} />
              <col style={{ width: '24%' }} />
              <col style={{ width: 56 }} />
            </colgroup>
            <thead><tr><th>#</th><th>한국어</th><th>{LANG_LABEL[reviewLang]} (편집)</th><th>상태</th><th>제외</th></tr></thead>
            <tbody>
              {shown.map(({ d, i }) => {
                const t = d.tr[reviewLang]
                const langProbs = LANGS.map((l) => {
                  const ps = [...(d.issues[l] || [])]
                  if (!d.tr[l] || !d.tr[l].prompt) ps.unshift('미번역')
                  return ps.length ? `${LANG_LABEL[l]} ${ps.join('/')}` : ''
                }).filter(Boolean)
                const probs = d.error ? [d.error, ...langProbs] : langProbs
                return (
                  <tr key={i} className={probs.length ? 'prob' : ''}>
                    <td>{d.num}</td>
                    <td className="admin-ko">
                      <div className="admin-q">{d.ko.prompt}</div>
                      <ol>{d.ko.options.map((o, k) => <li key={k} className={k === d.correctIndex ? 'ans' : ''}>{o}</li>)}</ol>
                    </td>
                    <td>
                      <input className="admin-in" value={t?.prompt ?? ''} placeholder="문제" onChange={(e) => editTr(i, reviewLang, 'prompt', e.target.value)} />
                      <textarea className="admin-ta" rows={d.ko.options.length} placeholder="보기(줄당 1개)" value={(t?.options ?? []).join('\n')} onChange={(e) => editOpts(i, reviewLang, e.target.value)} />
                      <textarea className="admin-ta" rows={2} placeholder="해설" value={t?.explanation ?? ''} onChange={(e) => editTr(i, reviewLang, 'explanation', e.target.value)} />
                      <button className="admin-mini" disabled={busy} onClick={() => retranslateOne(i)}>이 문항 재번역</button>
                    </td>
                    <td className="admin-status">{probs.length ? probs.join(', ') : 'OK'}</td>
                    <td><input type="checkbox" checked={d.excluded} onChange={() => toggleExclude(i)} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>

          <div className="admin-row" style={{ marginTop: 14 }}>
            <button className="dl-btn" onClick={download}>엑셀 다운로드</button>
            <button className="btn-ink" disabled={busy} onClick={apply}>DB에 반영</button>
            {applyMsg ? <span className="admin-msg">{applyMsg}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ============================ 문항 생성 탭 (KB 파이프라인) ============================
//  자료 넣기(kb-extract: recommend/fetch/extract → kb-save) → 문항 생성(kb-generate)
//  → 발행(kb-publish) → 임베딩 백필(kb-embed-backfill). (관리자 인증만 — 별도 암호 없음)
interface ExSource { title: string; url: string; why: string }
interface ExChunk { text: string; axis: string; topic: string; quote_ok: boolean; excluded: boolean }
interface GenVerify { supported: boolean; distractorsOk: boolean; suspect: boolean; reason: string }
interface GenDraft {
  axis: string | null
  topic: string | null
  chunkId?: string
  prompt: string
  options: string[]
  correctIndex: number
  explanation: string
  quote: string
  quote_ok: boolean
  lint: string[]
  verify: GenVerify
  suspect: boolean
  excluded: boolean
}
interface GenQResp {
  axis: string | null; topic: string | null; chunkId?: string
  prompt: string; options: string[]; correctIndex: number; explanation: string
  quote: string; quote_ok: boolean; lint?: string[]; verify?: Partial<GenVerify>; suspect?: boolean
}

function GenerateTab() {
  const [level, setLevel] = useState(1)
  const [selAxes, setSelAxes] = useState<string[]>([])

  // INPUT
  const [url, setUrl] = useState('')
  const [srcTitle, setSrcTitle] = useState('')
  const [text, setText] = useState('')
  const [sources, setSources] = useState<ExSource[]>([])
  const [chunks, setChunks] = useState<ExChunk[]>([])
  const [extractNotes, setExtractNotes] = useState<string[]>([])
  const [embed, setEmbed] = useState(false)
  const [busyIn, setBusyIn] = useState('')
  const [inMsg, setInMsg] = useState('')

  // GENERATE
  const [count, setCount] = useState(5)
  const [guidance, setGuidance] = useState('')
  const [drafts, setDrafts] = useState<GenDraft[]>([])
  const [genNotes, setGenNotes] = useState<string[]>([])
  const [busyGen, setBusyGen] = useState(false)
  const [genMsg, setGenMsg] = useState('')

  // PUBLISH
  const [busyPub, setBusyPub] = useState(false)
  const [pubMsg, setPubMsg] = useState('')

  // BACKFILL
  const [bfLimit, setBfLimit] = useState(200)
  const [busyBf, setBusyBf] = useState(false)
  const [bfMsg, setBfMsg] = useState('')

  const levelAxes = axesForLevel(level, 'ko')
  function axesPayload(): { key: string; label: string }[] {
    const chosen = levelAxes.filter((a) => selAxes.includes(a.key))
    const use = chosen.length ? chosen : levelAxes
    return use.map((a) => ({ key: a.key, label: a.label }))
  }
  function toggleAxis(key: string) {
    setSelAxes((s) => (s.includes(key) ? s.filter((x) => x !== key) : [...s, key]))
  }
  const errStr = (e: unknown) => (e instanceof Error ? e.message : String(e))

  async function recommend() {
    setBusyIn('recommend'); setInMsg('')
    try {
      const r = await callFunction<{ sources: ExSource[] }>('kb-extract', { mode: 'recommend', level, axes: axesPayload() })
      setSources(r.sources ?? [])
      if (!r.sources?.length) setInMsg('추천 출처가 없습니다.')
    } catch (e) { setInMsg('추천 실패: ' + errStr(e)) }
    setBusyIn('')
  }
  async function fetchUrl() {
    const u = url.trim()
    if (!/^https?:\/\//i.test(u)) { setInMsg('올바른 URL이 아닙니다.'); return }
    setBusyIn('fetch'); setInMsg('')
    try {
      const r = await callFunction<{ text: string; url: string; chars: number }>('kb-extract', { mode: 'fetch', url: u })
      setText(r.text ?? '')
      if (!srcTitle) setSrcTitle(u)
      setInMsg(`가져옴: ${r.chars ?? 0}자`)
    } catch (e) { setInMsg('가져오기 실패: ' + errStr(e)) }
    setBusyIn('')
  }
  async function extract() {
    if (!text.trim()) { setInMsg('원문 텍스트가 비어 있습니다.'); return }
    setBusyIn('extract'); setInMsg('')
    try {
      const r = await callFunction<{ chunks: { text: string; topic: string; axis: string; quote_ok: boolean }[]; notes: string[] }>(
        'kb-extract', { mode: 'extract', text: text.trim(), level, axes: axesPayload() },
      )
      setChunks((r.chunks ?? []).map((c) => ({ text: c.text, axis: c.axis ?? '', topic: c.topic ?? '', quote_ok: !!c.quote_ok, excluded: !c.quote_ok })))
      setExtractNotes(r.notes ?? [])
      setInMsg(`청크 ${r.chunks?.length ?? 0}개 추출 (원문에 없는 청크는 기본 제외됨)`)
    } catch (e) { setInMsg('추출 실패: ' + errStr(e)) }
    setBusyIn('')
  }
  async function save() {
    const use = chunks.filter((c) => !c.excluded && c.text.trim())
    if (!use.length) { setInMsg('저장할 청크가 없습니다.'); return }
    setBusyIn('save'); setInMsg('')
    try {
      const r = await callFunction<{ saved: number; skipped: number }>(
        'kb-save',
        { level, source: { url: url.trim() || undefined, title: srcTitle.trim() || undefined }, embed, chunks: use.map((c) => ({ text: c.text, axis: c.axis, topic: c.topic })) },
      )
      setInMsg(`✅ 저장 ${r.saved}개 (중복 건너뜀 ${r.skipped})`)
    } catch (e) { setInMsg('저장 실패: ' + errStr(e)) }
    setBusyIn('')
  }
  function updChunk(i: number, patch: Partial<ExChunk>) {
    setChunks((cs) => cs.map((c, k) => (k === i ? { ...c, ...patch } : c)))
  }

  async function generate() {
    setBusyGen(true); setGenMsg(''); setPubMsg('')
    try {
      const r = await callFunction<{ questions: GenQResp[]; available: number; used: number; notes: string[] }>(
        'kb-generate',
        { level, axes: axesPayload(), count, levelGuidance: guidance.split('\n').map((s) => s.trim()).filter(Boolean) },
      )
      setDrafts((r.questions ?? []).map((q) => ({
        axis: q.axis ?? null, topic: q.topic ?? null, chunkId: q.chunkId,
        prompt: q.prompt, options: q.options, correctIndex: q.correctIndex, explanation: q.explanation,
        quote: q.quote, quote_ok: !!q.quote_ok, lint: q.lint ?? [],
        verify: { supported: q.verify?.supported !== false, distractorsOk: q.verify?.distractorsOk !== false, suspect: !!q.verify?.suspect, reason: q.verify?.reason ?? '' },
        suspect: !!q.suspect, excluded: false,
      })))
      setGenNotes(r.notes ?? [])
      setGenMsg(`생성 ${r.used}개 (자료 ${r.available}개 중)`)
    } catch (e) { setGenMsg('생성 실패: ' + errStr(e)) }
    setBusyGen(false)
  }
  function updDraft(i: number, patch: Partial<GenDraft>) {
    setDrafts((ds) => ds.map((d, k) => (k === i ? { ...d, ...patch } : d)))
  }
  function updDraftOpt(i: number, oi: number, val: string) {
    setDrafts((ds) => ds.map((d, k) => { if (k !== i) return d; const o = [...d.options]; o[oi] = val; return { ...d, options: o } }))
  }

  async function publish() {
    const use = drafts.filter((d) => !d.excluded && d.prompt.trim() && d.options.length === 4)
    if (!use.length) { setPubMsg('발행할 문항이 없습니다.'); return }
    setBusyPub(true); setPubMsg('')
    try {
      const r = await callFunction<{ published: number; failed: number; notes: string[] }>(
        'kb-publish',
        { questions: use.map((d) => ({ level, axis: d.axis ?? '', prompt: d.prompt, options: d.options, correctIndex: d.correctIndex, explanation: d.explanation })) },
      )
      setPubMsg(`✅ 발행 ${r.published}개${r.failed ? ` · 실패 ${r.failed}` : ''}${r.notes?.length ? ' · ' + r.notes.join(' / ') : ''}`)
    } catch (e) { setPubMsg('발행 실패: ' + errStr(e)) }
    setBusyPub(false)
  }

  async function backfill() {
    setBusyBf(true); setBfMsg('')
    try {
      const r = await callFunction<{ embedded: number; remaining: number; done: boolean; notes: string[] }>(
        'kb-embed-backfill', { limit: bfLimit },
      )
      setBfMsg(`임베딩 ${r.embedded}개 · 남음 ${r.remaining}${r.done ? ' · 완료' : ''}${r.notes?.length ? ' · ' + r.notes.join(' / ') : ''}`)
    } catch (e) { setBfMsg('백필 실패: ' + errStr(e)) }
    setBusyBf(false)
  }

  const draftBad = drafts.filter((d) => d.suspect).length

  return (
    <div>
      <div className="admin-section">
        <p className="admin-desc" style={{ marginTop: 8 }}>
          <b>자료 넣기</b>(출처 추천·가져오기·청크 추출 → 지식 저장소 저장) → <b>문항 생성</b>(초안) → <b>발행</b>(번역+문제은행 반영) 순서로 진행합니다.
        </p>
        <div className="admin-toolbar" style={{ marginTop: 8 }}>
          <label>레벨 <select value={level} onChange={(e) => { setLevel(+e.target.value); setSelAxes([]) }}>
            {Array.from({ length: MAX_LEVEL }, (_, i) => i + 1).map((l) => <option key={l} value={l}>Lv.{l}</option>)}
          </select></label>
          <span className="admin-hint">영역(미선택 시 전체):</span>
          <div className="col-chips">
            {levelAxes.map((a) => (
              <label key={a.key} className={`col-chip ${selAxes.includes(a.key) ? 'on' : ''}`}>
                <input type="checkbox" checked={selAxes.includes(a.key)} onChange={() => toggleAxis(a.key)} />
                {a.short}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* A) 자료 넣기 */}
      <div className="admin-section">
        <h3>① 자료 넣기 <span className="admin-hint">지식 저장소(kb_chunks) 적재</span></h3>

        <div className="admin-toolbar">
          <button className="admin-mini" disabled={!!busyIn} onClick={recommend}>{busyIn === 'recommend' ? '검색 중…' : '출처 추천받기(AI)'}</button>
          <input className="admin-search" placeholder="출처 URL (https://…)" value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
          <button className="admin-mini" disabled={!!busyIn} onClick={fetchUrl}>{busyIn === 'fetch' ? '가져오는 중…' : 'URL 가져오기'}</button>
        </div>

        {sources.length ? (
          <div className="ev-list" style={{ marginTop: 8 }}>
            {sources.map((s, i) => (
              <div key={i} className="ev-card">
                <div className="ev-head">
                  <a href={s.url} target="_blank" rel="noreferrer" style={{ fontWeight: 700, color: '#3f8fd6' }}>{s.title || s.url}</a>
                  <button className="admin-mini" style={{ marginLeft: 'auto' }} onClick={() => { setUrl(s.url); setSrcTitle(s.title || '') }}>URL 채우기</button>
                </div>
                {s.why ? <p className="admin-hint" style={{ margin: '4px 0 0' }}>{s.why}</p> : null}
              </div>
            ))}
          </div>
        ) : null}

        <div className="admin-row" style={{ marginTop: 10 }}>
          <input className="admin-search" placeholder="출처 제목(선택)" value={srcTitle} onChange={(e) => setSrcTitle(e.target.value)} style={{ maxWidth: 320 }} />
        </div>
        <textarea className="admin-ta" rows={8} placeholder="원문 텍스트 (URL 가져오기로 채우거나 직접 붙여넣기)" value={text} onChange={(e) => setText(e.target.value)} style={{ marginTop: 8, width: '100%' }} />
        <div className="admin-row" style={{ marginTop: 8 }}>
          <button className="btn-ink" disabled={!!busyIn} onClick={extract}>{busyIn === 'extract' ? '추출 중…' : '청크 추출'}</button>
          {inMsg ? <span className="admin-msg">{inMsg}</span> : null}
        </div>
        {extractNotes.length ? <div className="admin-warn" style={{ marginTop: 8 }}>{extractNotes.map((n, i) => <div key={i}>· {n}</div>)}</div> : null}

        {chunks.length ? (
          <>
            <table className="admin-table" style={{ marginTop: 10 }}>
              <thead><tr><th>본문</th><th>영역</th><th>토픽</th><th>원문검증</th><th>제외</th></tr></thead>
              <tbody>
                {chunks.map((c, i) => (
                  <tr key={i} className={!c.quote_ok ? 'prob' : ''}>
                    <td style={{ maxWidth: 420, fontSize: 13 }}>{c.text}</td>
                    <td>
                      <select value={c.axis} onChange={(e) => updChunk(i, { axis: e.target.value })}>
                        <option value="">(미배정)</option>
                        {levelAxes.map((a) => <option key={a.key} value={a.key}>{a.short}</option>)}
                      </select>
                    </td>
                    <td><input className="admin-in" value={c.topic} onChange={(e) => updChunk(i, { topic: e.target.value })} style={{ minWidth: 100 }} /></td>
                    <td>{c.quote_ok ? <span className="badge ok">원문일치</span> : <span className="badge none">불일치</span>}</td>
                    <td><input type="checkbox" checked={c.excluded} onChange={() => updChunk(i, { excluded: !c.excluded })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="admin-row" style={{ marginTop: 10 }}>
              <label><input type="checkbox" checked={embed} onChange={(e) => setEmbed(e.target.checked)} style={{ width: 'auto' }} /> 임베딩까지 생성(중복검사·유사도 · 할당량 소모)</label>
              <button className="btn-ink" disabled={!!busyIn} onClick={save}>{busyIn === 'save' ? '저장 중…' : '지식 저장소에 저장'}</button>
            </div>
          </>
        ) : null}
      </div>

      {/* B) 문항 생성 */}
      <div className="admin-section">
        <h3>② 문항 생성 <span className="admin-hint">저장된 자료에서 객관식 초안 생성 (발행 아님)</span></h3>
        <div className="admin-toolbar">
          <label>개수 <input type="number" min={1} max={20} value={count} onChange={(e) => setCount(Math.min(20, Math.max(1, +e.target.value || 1)))} style={{ width: 64 }} /></label>
          <button className="btn-ink" disabled={busyGen} onClick={generate}>{busyGen ? '생성 중…' : '문항 생성'}</button>
          {genMsg ? <span className="admin-msg">{genMsg}</span> : null}
        </div>
        <textarea className="admin-ta" rows={2} placeholder="레벨 출제 지침(선택, 줄당 1개) — 난이도·중점" value={guidance} onChange={(e) => setGuidance(e.target.value)} style={{ width: '100%', marginTop: 8 }} />
        {genNotes.length ? <div className="admin-warn" style={{ marginTop: 8 }}>{genNotes.map((n, i) => <div key={i}>· {n}</div>)}</div> : null}

        {drafts.length ? (
          <>
            <p className="admin-hint" style={{ margin: '10px 0 6px' }}>정답 의심 {draftBad}개 — 빨간 문항은 정답 근거·오답 검토를 집중하세요.</p>
            {drafts.map((d, i) => (
              <div key={i} className={`ans-item ${d.suspect ? 'no' : 'ok'}`} style={{ marginBottom: 10 }}>
                <div className="admin-row" style={{ marginBottom: 4 }}>
                  <span className="admin-hint">{d.axis ? axisDef(d.axis, 'ko').short : '(미배정)'}{d.topic ? ` · ${d.topic}` : ''}</span>
                  {d.suspect ? <span className="badge none" style={{ color: '#dc2626' }}>정답 의심</span> : <span className="badge ok">양호</span>}
                  {!d.quote_ok ? <span className="badge low">인용 불일치</span> : null}
                  <label style={{ marginLeft: 'auto' }}><input type="checkbox" checked={d.excluded} onChange={() => updDraft(i, { excluded: !d.excluded })} /> 제외</label>
                </div>
                <input className="admin-in" value={d.prompt} onChange={(e) => updDraft(i, { prompt: e.target.value })} placeholder="문제" />
                <div className="opt-editor" style={{ marginTop: 6 }}>
                  {d.options.map((o, k) => (
                    <div key={k} className={`opt-row ${d.correctIndex === k ? 'is-correct' : ''}`}>
                      <label className="opt-radio" title="정답으로 지정"><input type="radio" name={`gc-${i}`} checked={d.correctIndex === k} onChange={() => updDraft(i, { correctIndex: k })} /></label>
                      <span className="opt-num">{k + 1}</span>
                      <input className="opt-in" value={o} onChange={(e) => updDraftOpt(i, k, e.target.value)} placeholder={`보기 ${k + 1}`} />
                    </div>
                  ))}
                </div>
                <textarea className="admin-ta" rows={2} value={d.explanation} onChange={(e) => updDraft(i, { explanation: e.target.value })} placeholder="해설" style={{ marginTop: 6 }} />
                {d.quote ? <div className="admin-hint" style={{ marginTop: 4 }}>📎 인용: {d.quote}</div> : null}
                {d.lint.length ? <div className="admin-hint" style={{ color: '#b91c1c' }}>규칙: {d.lint.join(', ')}</div> : null}
                {d.verify.reason ? <div className="admin-hint">검증: {d.verify.reason}</div> : null}
              </div>
            ))}
            <div className="admin-row" style={{ marginTop: 10 }}>
              <button className="btn-ink" disabled={busyPub} onClick={publish}>{busyPub ? '발행 중…' : '③ 발행 (번역 + 문제은행 반영)'}</button>
              {pubMsg ? <span className="admin-msg">{pubMsg}</span> : null}
            </div>
          </>
        ) : null}
      </div>

      {/* D) 임베딩 백필 */}
      <div className="admin-section">
        <h3>임베딩 백필 <span className="admin-hint">embed 없이 저장한 청크에 벡터 채우기</span></h3>
        <div className="admin-toolbar">
          <label>한 번에 <input type="number" min={1} max={500} value={bfLimit} onChange={(e) => setBfLimit(Math.min(500, Math.max(1, +e.target.value || 1)))} style={{ width: 72 }} />개</label>
          <button className="admin-mini" disabled={busyBf} onClick={backfill}>{busyBf ? '처리 중…' : '임베딩 백필 실행'}</button>
          {bfMsg ? <span className="admin-msg">{bfMsg}</span> : null}
        </div>
      </div>
    </div>
  )
}
