// 레벨테스트 백오피스 (Admin.tsx 의 "레벨테스트" 탭). ai-level-test/src/pages/Admin.tsx 에서 이관.
//  - 모든 데이터 호출은 새 엣지 함수 `admin-test` 로 (CBT admin 과 분리).
//  - 응시 결과 링크는 gara-cbt 라우트 `/test/result/:id` 를 사용.
//  - 이관 범위: 대시보드(개요/추이/분포/문항난이도/커버리지) · 유저 · 응시 기록 · 제보.
//  - TODO(미이관): 문항 목록/문항 이력/번역 업로드(엑셀+자동번역)/관리자 관리 탭.
//      원본(ai-level-test Admin.tsx)의 ListTab·EventsTab·UploadTab·AdminsTab 참고.
//      admin-test 엣지 함수에는 해당 액션(list/events/upsert/restorable/admins…)이 이미 있어
//      추후 UI만 붙이면 됨.
import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import { axesForLevel, axisDef, MAX_LEVEL } from '../lib/categories'

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

type LtTab = 'dashboard' | 'users' | 'attempts' | 'reports'
export default function LevelTestAdmin() {
  const { isFullUser } = useAuth()
  const [tab, setTab] = useState<LtTab>('dashboard')
  // 관리자 권한은 서버(admin-test 'me')가 판별 — CBT admin 과 동일한 게이트(admin_users/ROOT).
  const [gate, setGate] = useState<'loading' | 'ok' | 'denied'>('loading')

  useEffect(() => {
    if (!isFullUser) { setGate('denied'); return }
    callFunction<{ isRoot: boolean }>('admin-test', { action: 'me' })
      .then(() => setGate('ok'))
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
          <p className="admin-hint">레벨테스트 관리자 계정으로 로그인해야 합니다.</p>
        </div>
      </div>
    )
  }

  const TABS: { key: LtTab; label: string }[] = [
    { key: 'dashboard', label: '대시보드' },
    { key: 'users', label: '유저' },
    { key: 'attempts', label: '응시 기록' },
    { key: 'reports', label: '제보' },
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
      {tab === 'reports' ? <ReportsTab /> : null}
    </div>
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
          시험은 <b>레벨의 각 영역(6개)에서 문제를 무작위로 뽑아</b> 출제합니다. 그래서 <b>영역마다 활성 문항이 넉넉해야</b>(권장 4개 이상) 매번 다른 문제로 출제할 수 있어요. 아래는 <b>출제 가능한(활성) 문항 / 등록된 전체</b>입니다.
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
    <div className="admin-modal" onClick={onClose}>
      <div className="admin-modal-box" onClick={(e) => e.stopPropagation()}>
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
    <div className="admin-modal" onClick={onClose}>
      <div className="admin-modal-box" onClick={(e) => e.stopPropagation()}>
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

// ============================ 제보 탭 ============================
interface ReportRow { id: string; code: string | null; questionId: string; message: string; status: 'open' | 'resolved' | 'dismissed'; lang: string | null; created_at: string; level: number | null; category: string | null; prompt: string }
function ReportsTab() {
  const [rows, setRows] = useState<ReportRow[]>([])
  const [openCount, setOpenCount] = useState(0)
  const [status, setStatus] = useState<'open' | 'resolved' | 'dismissed' | 'all'>('open')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  async function load() {
    setLoading(true); setErr('')
    try {
      const r = await callFunction<{ reports: ReportRow[]; openCount: number }>('admin-test', { action: 'reports', status })
      setRows(r.reports); setOpenCount(r.openCount)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    setLoading(false)
  }
  useEffect(() => { load() }, [status]) // eslint-disable-line

  async function setStat(id: string, s: ReportRow['status']) {
    try {
      await callFunction('admin-test', { action: 'reportStatus', id, status: s })
      load()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }

  if (err) return <ErrBox msg={err} />
  const TABS: [typeof status, string][] = [['open', '미처리'], ['resolved', '해결'], ['dismissed', '무시'], ['all', '전체']]
  return (
    <div>
      <div className="admin-section">
        <div className="admin-toolbar">
          <div className="admin-period">
            {TABS.map(([s, label]) => (
              <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>
                {label}{s === 'open' && openCount ? ` (${openCount})` : ''}
              </button>
            ))}
          </div>
          <span className="admin-hint">{rows.length}건{loading ? ' · 불러오는 중…' : ''}</span>
        </div>
        <div className="report-list">
          {rows.map((r) => {
            const stTag = r.status === 'open'
              ? <span className="badge none">미처리</span>
              : r.status === 'resolved' ? <span className="badge ok">해결</span> : <span className="badge low">무시</span>
            return (
              <div key={r.id} className="report-card" style={{ border: '1px solid var(--a-bd)', borderLeft: `4px solid ${r.status === 'open' ? '#dc2626' : '#dfe3ea'}`, borderRadius: 12, padding: '14px 16px', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                  <span style={{ fontWeight: 800, color: '#3f8fd6' }}>{r.code ?? '번호없음'}</span>
                  {r.level ? <span className="admin-hint">Lv.{r.level} · {r.category ? axisDef(r.category, 'ko').short : '-'}</span> : null}
                  <span className="admin-hint">· {r.lang ? (LANG_LABEL[r.lang] ?? r.lang) : '-'}</span>
                  <span className="admin-hint">· {fmtDT(r.created_at)}</span>
                  <span style={{ marginLeft: 'auto' }}>{stTag}</span>
                </div>
                <div className="admin-hint" style={{ marginBottom: 8 }}>📄 {r.prompt}</div>
                <div style={{ background: 'var(--a-bg)', border: '1px solid var(--a-bd)', borderRadius: 10, padding: '10px 12px', fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: '#1a2230' }}>
                  {r.message}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  {r.status !== 'resolved' ? <button className="admin-mini" onClick={() => setStat(r.id, 'resolved')}>✓ 해결</button> : null}
                  {r.status !== 'dismissed' ? <button className="admin-mini" onClick={() => setStat(r.id, 'dismissed')}>무시</button> : null}
                  {r.status !== 'open' ? <button className="admin-mini" onClick={() => setStat(r.id, 'open')}>다시 열기</button> : null}
                </div>
              </div>
            )
          })}
        </div>
        {rows.length === 0 && !loading ? <div className="admin-empty">해당 상태의 제보가 없습니다.</div> : null}
      </div>
    </div>
  )
}
