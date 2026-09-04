// CARIS ARENA 백오피스 (Admin.tsx 의 "CARIS ARENA" 탭). ai-level-test/src/pages/Admin.tsx 에서 이관.
//  - 모든 데이터 호출은 새 엣지 함수 `admin-test` 로 (CBT admin 과 분리).
//  - 응시 결과 링크는 gara-cbt 라우트 `/test/result/:id` 를 사용.
//  - 이관 범위: 대시보드 · 유저 · 응시 기록 · 문항 목록 · 문항 이력 · 문항 생성(KB 파이프라인) · 번역 · 제보 · 관리자 관리.
//  - KB 파이프라인(kb-extract/generate/save/publish/embed-backfill)·translate-questions 는 관리자 인증만으로 호출한다
//    (옛 x-passcode 입력칸은 제거 — 서버 시크릿 KB_PASSCODE/TRANSLATE_PASSCODE 미설정이라 검사 자체를 안 함).
import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { callFunction } from '../lib/supabase'
import { axesForLevel, axisDef, MAX_LEVEL } from '../lib/categories'
import { optionCountForLevel } from '../lib/scoring'
import { runTranslation, type TransItem, type TransResult } from '../lib/adminTranslate'
import { useDraft } from '../lib/adminDraft'
import DraftBar from '../components/DraftBar'

const LANGS = ['en', 'ja', 'zh', 'hi', 'vi'] as const
const LANG_LABEL: Record<string, string> = { ko: '한국어', en: '영어', ja: '일본어', zh: '중국어', hi: '힌디어', vi: '베트남어' }

const ErrBox = ({ msg }: { msg: string }) => <div className="admin-section admin-empty">불러오기 실패 — {msg}</div>

// DB는 UTC(timestamptz). 화면엔 KST로 변환해 표시.
function fmtDT(iso?: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '-' : d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
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

// 2026-08-11 재편 — 이 파일은 더 이상 자기 껍데기(탭 줄·권한 게이트·wrap)를 갖지 않는다.
//   화면들은 Admin.tsx 의 대메뉴 `WORLD ARENA` 아래에 개별 컴포넌트로 꽂힌다.
//   · 대시보드 → WORLD ARENA > 대시보드
//   · 응시 기록 + 문항 → WORLD ARENA > 레벨테스트 (아래 ArenaLevelTest 가 한 화면에서 전환)
//   · 유저 → **회원관리 > 회원 으로 흡수**(CARIS 목록과 한 벌로 합침). 여기엔 상세 패널만 남는다.
//   · 채팅 검수 → WORLD ARENA > 채팅 관리 / 이북 → Learning Library / 관리자 관리 → 홈페이지 관리
//   ⚠️ 권한 확인도 Admin.tsx 한 곳으로 올라갔다. 여기서 `admin-test me` 를 다시 부르지 않는다.

// WORLD ARENA > 레벨테스트 아래 두 세부(참여 현황 · 문항 관리)는 상위 메뉴 줄이 직접 고른다.
export { DashboardTab as ArenaDashboard, AttemptsTab as ArenaAttempts, QuestionsTab as ArenaQuestions }

// ============================ 문항 탭 (목록·이력·생성·번역 통합) ============================
// CARIS(CBT) 관리자의 '문항' 탭과 동일하게, 문항 관련 화면을 한 탭 안 서브탭으로 묶는다.
type LtQSub = 'list' | 'events' | 'generate' | 'upload'
// isRoot = 서버('admin-test' me 액션)가 판정한 루트 관리자 여부. 문항 엑셀 다운로드는 루트 전용.
function QuestionsTab({ isRoot }: { isRoot: boolean }) {
  const [sub, setSub] = useState<LtQSub>('list')
  // 방금 반영한 문항 — '문항 추가 & 번역' 이 넘겨주고 '문항 목록' 이 받아 그것만 걸러 보여준다.
  //   ⚠️ 반영하고 그 화면에 남아 있으면 버튼이 다시 눌려 같은 문항이 한 벌 더 들어간다(2026-09-02 사고).
  //      그래서 성공하면 **화면을 떠난다.** 다만 이동만 시키면 잘 들어갔는지 확인할 데가 없어서
  //      번호를 같이 넘겨 목록에서 방금 것만 볼 수 있게 한다.
  const [justAdded, setJustAdded] = useState<{ level: number; codes: string[]; at: number } | null>(null)
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
      {sub === 'list' ? <ListTab isRoot={isRoot} justAdded={justAdded} /> : null}
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
      {sub === 'upload' ? (
        <UploadTab
          onApplied={(level, codes) => {
            setJustAdded({ level, codes, at: Date.now() })
            setSub('list')
          }}
        />
      ) : null}
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

// ============================ 유저(아레나 쪽) ============================
// 목록은 **회원관리 > 회원**(Admin.tsx 의 MembersAdmin)으로 흡수됐다 — CARIS 목록과 두 벌이던 것을 합쳤다.
// 여기 남은 건 그 상세 모달 안에서 쓰는 `WORLD ARENA` 탭 본문뿐이다.
/** `admin-test users` 응답 한 줄. 회원 목록이 CARIS 쪽 행과 이 행을 사람 기준으로 겹쳐 쓴다. */
export interface ArenaUserRow {
  id: string; name: string | null; email: string | null; anon: boolean
  created: string; rank: number; attempts: number; lastActive: string | null
}

interface UserDetailData { rank: number; skills: { level: number; attempts_count: number; placed: boolean; ratings: Record<string, number> }[]; attempts: Omit<AttemptRow, 'name'>[]; ageBand: string | null }

// 연령대 표기 — 값은 온보딩에서 받은 밴드(profiles.age_band) 그대로다.
//  ⚠️ '공개 안 함'(private)과 '미수집'(null)은 다른 뜻이다. 전자는 답한 것이고 후자는 아직 안 물어본
//     계정(연령대 도입 전 가입자 중 아레나에 안 들어온 사람)이라, 통계에서 분모가 갈린다.
const AGE_BAND_LABEL: Record<string, string> = {
  '10s': '10대 이하', '20s': '20대', '30s': '30대', '40s': '40대', '50s': '50대', '60s': '60대 이상',
  private: '공개 안 함',
}
/**
 * 회원 상세 모달의 `WORLD ARENA` 탭 본문 — 연령대 · 등급 수동조정 · 레벨별 레이팅 · 레벨테스트 응시 이력.
 * ⚠️ 모달 껍데기(닫기·배경)를 갖지 않는다. 감싸는 쪽(MembersAdmin)이 이미 모달 안이다.
 */
export function ArenaUserPanel({ userId, initialRank }: { userId: string; initialRank: number }) {
  const [data, setData] = useState<UserDetailData | null>(null)
  const [rank, setRank] = useState(initialRank)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    callFunction<UserDetailData>('admin-test', { action: 'userDetail', userId })
      .then((d) => { setData(d); setRank(d.rank) })
      .catch((e) => setMsg('불러오기 실패: ' + (e instanceof Error ? e.message : String(e))))
  }, [userId])
  async function saveRank() {
    setMsg('저장 중…')
    try { await callFunction('admin-test', { action: 'setRank', userId, rank }); setMsg('✅ 등급 변경됨') }
    catch (e) { setMsg('실패: ' + (e instanceof Error ? e.message : String(e))) }
  }
  return (
    <div>
      <div className="admin-row" style={{ marginTop: 4 }}>
        <span>연령대</span>
        <b>{data ? (AGE_BAND_LABEL[data.ageBand ?? ''] ?? '미수집') : '…'}</b>
      </div>
      <div className="admin-row" style={{ marginTop: 4 }}>
        <span>등급 수동 조정</span>
        <select value={rank} onChange={(e) => setRank(+e.target.value)}>
          {Array.from({ length: MAX_LEVEL }, (_, i) => i + 1).map((l) => <option key={l} value={l}>Lv.{l}</option>)}
        </select>
        <button className="admin-mini" onClick={saveRank}>저장</button>
        {msg ? <span className="admin-msg">{msg}</span> : null}
      </div>
      {data?.skills?.length ? <RatingByLevel skills={data.skills} /> : null}
      <AttemptHistory attempts={data?.attempts ?? []} />
    </div>
  )
}

// 레벨별 누적 레이팅 — 레벨 오름차순.
//  · 값이 있는 레벨만 펼친다. 전 축이 0인 레벨(=배치만 되고 점수가 없음)은 한 줄로 접는다 —
//    전에는 0짜리 알약이 화면을 다 먹어서 정작 값이 있는 레벨이 스크롤 아래로 밀렸다.
//  · 알약 대신 막대. 0~100 척도가 보이고, 축 이름 폭이 고정이라 레벨끼리 세로로 줄이 맞는다.
function RatingByLevel({ skills }: { skills: UserDetailData['skills'] }) {
  const rows = [...skills].sort((a, b) => a.level - b.level)
  const scored = rows.filter((s) => Object.values(s.ratings || {}).some((v) => Math.round(v) > 0))
  const blank = rows.filter((s) => !Object.values(s.ratings || {}).some((v) => Math.round(v) > 0))
  // 레벨 카드 접기. 기본은 전부 펼침(닫힌 레벨만 담는다) — 열어봐야 알 수 있는 걸 기본으로 숨기지 않는다.
  const [shut, setShut] = useState<Record<number, boolean>>({})
  const allShut = scored.length > 0 && scored.every((s) => shut[s.level])
  function toggleAll() {
    setShut(allShut ? {} : Object.fromEntries(scored.map((s) => [s.level, true])))
  }
  return (
    <>
      <div className="rt-hist-h">
        <div className="admin-sub" style={{ margin: 0 }}>레벨별 누적 레이팅</div>
        {scored.length > 1 ? (
          <button className="admin-mini" style={{ marginLeft: 'auto' }} onClick={toggleAll}>
            {allShut ? '모두 펼치기' : '모두 접기'}
          </button>
        ) : null}
      </div>
      {scored.map((s) => {
        const vals = Object.values(s.ratings || {}).map((v) => Math.round(v))
        const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0
        const open = !shut[s.level]
        return (
          <div key={s.level} className={`rt-lv ${open ? '' : 'is-shut'}`}>
            {/* 헤더 전체가 토글. 접었을 때도 평균이 남아 있어야 접은 채로 레벨 비교가 된다. */}
            <button
              type="button"
              className="rt-lv-h"
              aria-expanded={open}
              onClick={() => setShut((m) => ({ ...m, [s.level]: open }))}
            >
              <span className="rt-caret">{open ? '▾' : '▸'}</span>
              <b>Lv.{s.level}</b>
              <span className="admin-hint">{s.attempts_count}회 응시</span>
              {!s.placed ? <span className="badge low">미배치</span> : null}
              <span className="rt-avg">평균 {avg}</span>
            </button>
            {open
              ? Object.entries(s.ratings || {}).map(([k, v]) => {
                  const n = Math.round(v)
                  return (
                    <div key={k} className="rt-axis">
                      <span className="rt-axis-n">{axisDef(k, 'ko').short}</span>
                      <span className="rt-bar"><i style={{ width: `${Math.max(0, Math.min(100, n))}%` }} /></span>
                      <span className="rt-axis-v">{n}</span>
                    </div>
                  )
                })
              : null}
          </div>
        )
      })}
      {blank.length ? (
        <div className="rt-blank">
          {blank.map((s) => (
            <span key={s.level} className="admin-pill">Lv.{s.level} <em>{s.attempts_count}회 · 점수 없음</em></span>
          ))}
        </div>
      ) : null}
      {!scored.length && !blank.length ? <div className="admin-empty">레이팅 없음</div> : null}
    </>
  )
}

// 응시 이력 — 기본은 완료(submitted)만. 시작만 하고 이탈한 건(in_progress·expired)이 섞이면
// 목록이 0/30 으로 도배돼 실제 성적이 안 보인다. 상태·등급변동은 응시 기록 탭과 같은 배지를 쓴다.
const HIST_PAGE = 10
function AttemptHistory({ attempts }: { attempts: Omit<AttemptRow, 'name'>[] }) {
  const [withIncomplete, setWithIncomplete] = useState(false)
  const [page, setPage] = useState(0)
  const doneCount = attempts.filter((a) => a.status === 'submitted').length
  const shown = withIncomplete ? attempts : attempts.filter((a) => a.status === 'submitted')
  const pageCount = Math.max(1, Math.ceil(shown.length / HIST_PAGE))
  const safePage = Math.min(page, pageCount - 1)
  const slice = shown.slice(safePage * HIST_PAGE, safePage * HIST_PAGE + HIST_PAGE)
  return (
    <>
      <div className="rt-hist-h">
        <div className="admin-sub" style={{ margin: 0 }}>응시 이력</div>
        <span className="admin-hint">완료 {doneCount}건 / 전체 {attempts.length}건</span>
        <label className="rt-toggle">
          <input
            type="checkbox"
            checked={withIncomplete}
            onChange={(e) => { setWithIncomplete(e.target.checked); setPage(0) }}
          />
          미완료 포함
        </label>
      </div>
      <table className="admin-table">
        <thead><tr><th>일시</th><th>레벨</th><th>언어</th><th>점수</th><th>상태</th><th>등급변동</th></tr></thead>
        <tbody>
          {slice.map((a) => {
            const logs = a.violations ?? []
            const vs = logs.length ? violationSummary(logs) : null
            return (
              <tr key={a.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDT(a.submitted_at || a.created_at)}</td>
                <td>Lv.{a.level}</td>
                <td>{a.lang}</td>
                {/* 미완료는 0/30 이 '0점'으로 읽히므로 점수를 아예 안 쓴다 */}
                <td>{a.status === 'submitted' ? `${a.total_correct}/${a.total_questions}` : <span className="rc-none">–</span>}</td>
                <td>
                  <OutcomeBadge status={a.status} v={a.violation_count} endReason={a.end_reason} />
                  {/* 왜 걸렸는지 — 마우스를 올리면 시각까지 나온다 */}
                  {vs ? <div className="vio-sum" title={vs.detail}>{vs.text}</div> : null}
                </td>
                <td><RankBadge before={a.rank_before} after={a.rank_after} dir={a.rank_dir} /></td>
              </tr>
            )
          })}
          {!slice.length ? (
            <tr><td colSpan={6} className="admin-empty">{attempts.length ? '완료된 응시 없음' : '응시 이력 없음'}</td></tr>
          ) : null}
        </tbody>
      </table>
      {pageCount > 1 ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 12 }}>
          <button className="admin-mini" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage <= 0}>‹</button>
          <span className="admin-hint">{safePage + 1} / {pageCount}</span>
          <button className="admin-mini" onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={safePage >= pageCount - 1}>›</button>
        </div>
      ) : null}
    </>
  )
}

// ============================ 응시 기록 탭 ============================
/** 부정행위 감지 1건(서버 test_attempts.violations). reason = tab|blur|fs */
interface ViolationLog { at: string; reason: string }
interface AttemptRow { id: string; name: string; email?: string | null; level: number; lang: string; status: string; total_correct: number; total_questions: number; rank_before: number | null; rank_after: number | null; rank_dir: string | null; violation_count?: number; violations?: ViolationLog[]; end_reason?: string | null; submitted_at: string | null; created_at: string }

const VIOLATION_LABEL: Record<string, string> = { tab: '탭 전환', blur: '창 이탈', fs: '전체화면 해제', unknown: '기타' }
/** 위반 내역을 "탭 전환 2회 · 전체화면 해제 1회" 로. 시각은 툴팁(title)에 붙인다. */
function violationSummary(logs: ViolationLog[]): { text: string; detail: string } {
  const by: Record<string, string[]> = {}
  for (const v of logs) {
    const k = VIOLATION_LABEL[v.reason] ?? v.reason
    ;(by[k] ??= []).push(new Date(v.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
  }
  const parts = Object.entries(by)
  return {
    text: parts.map(([k, times]) => `${k} ${times.length}회`).join(' · '),
    detail: parts.map(([k, times]) => `${k}: ${times.join(', ')}`).join('\n'),
  }
}

// 종료 사유까지 반영한 배지.
//  · 완료           = submitted
//  · 경고중단       = voided (경고 3회 누적 → 무효)
//  · 중단(자진)     = 나가기 버튼을 눌러 end_reason='quit' 이 찍힘
//  · 중단(무단)     = 아무 신호 없이 사라짐(브라우저 닫기·방치). end_reason 이 비어 있다.
//    ⚠️ 2026-08-05 이전 기록은 end_reason 이 없어 전부 '중단(무단)' 으로 보인다.
function OutcomeBadge({ status, v, endReason }: { status: string; v?: number; endReason?: string | null }) {
  if (status === 'submitted') return <span className="badge ok">완료</span>
  if (status === 'voided') return <span className="badge none">⚠ 경고중단{v ? ` ${v}회` : ''}</span>
  if (endReason === 'quit') return <span className="badge low">중단 <em>자진</em></span>
  return <span className="badge low">중단 <em>무단</em></span>
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
                <td>
                  <OutcomeBadge status={a.status} v={a.violation_count} endReason={a.end_reason} />
                  {a.violations?.length
                    ? (() => { const vs = violationSummary(a.violations!); return <div className="vio-sum" title={vs.detail}>{vs.text}</div> })()
                    : null}
                </td>
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

function ListTab({ isRoot, justAdded }: { isRoot: boolean; justAdded?: { level: number; codes: string[]; at: number } | null }) {
  const [level, setLevel] = useState(justAdded?.level ?? 1)
  const [cat, setCat] = useState('all')
  const [q, setQ] = useState('')
  // 방금 반영하고 넘어왔을 때만 켜진다 — 그 번호들만 보여줘 "잘 들어갔나"를 눈으로 확인시킨다.
  const [onlyNew, setOnlyNew] = useState(!!justAdded?.codes.length)
  const [rows, setRows] = useState<ListRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [edit, setEdit] = useState<ListRow | 'new' | null>(null) // 'new' = 문항 추가
  const [sel, setSel] = useState<Set<string>>(new Set()) // 체크박스 선택(일괄 비활성·삭제용)
  const [bulk, setBulk] = useState('')
  const [page, setPage] = useState(0) // 클라 페이징 — 검색·필터는 전체 기준 그대로다

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
  // ⚠️ '방금 추가분만' 은 넘어온 레벨을 보고 있을 때만 건다 — 레벨을 바꾸면 그 번호들이 없어 빈 목록이 된다.
  const newCodes = onlyNew && justAdded && justAdded.level === level ? new Set(justAdded.codes) : null
  const filtered = rows
    .filter((r) => !newCodes || (r.code && newCodes.has(r.code)))
    .filter((r) => cat === 'all' || r.category === cat)
    .filter((r) => !qq || (r.code ?? '').toLowerCase().includes(qq) || (r.prompt_i18n?.ko ?? '').toLowerCase().includes(qq))

  // ⚠️ 페이징은 **클라이언트 전용**이다(CBT 문항 목록과 같은 방식) — 영역·검색 필터, 전체선택, 일괄 처리,
  //    엑셀 다운로드는 전부 `filtered`(전체) 기준으로 돌고 `shown` 은 화면에 그릴 줄만 잘라낸 것이다.
  //    서버 페이징으로 바꾸면 검색이 현재 페이지만 뒤지게 되니 주의. (레벨 필터만 서버가 처리 — admin-test list,
  //    거기 .limit(2000) 상한이 있어 한 레벨 문항이 2000을 넘으면 초과분은 조용히 안 내려온다.)
  const PER = 50
  const pageMax = Math.max(1, Math.ceil(filtered.length / PER))
  const pageSafe = Math.min(page, pageMax - 1) // 필터가 좁아져 페이지 수가 줄면 빈 화면이 되는 걸 막는다
  const shown = filtered.slice(pageSafe * PER, pageSafe * PER + PER)

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
      {/* 방금 반영하고 넘어온 직후에만 뜬다 — 이동만 시키면 잘 들어갔는지 확인할 데가 없다. */}
      {justAdded && justAdded.codes.length > 0 ? (
        <div
          className="admin-msg"
          style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12,
            padding: '10px 14px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--bg2, transparent)' }}
        >
          <b>✅ Lv.{justAdded.level} 문항 {justAdded.codes.length}개 추가됨</b>
          <span style={{ color: 'var(--muted)' }}>
            {justAdded.codes[0]} ~ {justAdded.codes[justAdded.codes.length - 1]}
          </span>
          <button className="admin-mini" onClick={() => setOnlyNew((v) => !v)}>
            {onlyNew ? '전체 보기' : '방금 추가분만 보기'}
          </button>
        </div>
      ) : null}
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
            {shown.map((r) => (
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
        {pageMax > 1 && (
          <div className="admin-pager">
            {/* ⚠️ page 가 아니라 pageSafe 기준 — 필터를 좁혀 페이지 수가 줄면 page 는 범위 밖에 남아 있어서
                그 값으로 +1 하면 화면은 그대로인 채 버튼만 눌린 것처럼 보인다. */}
            <button className="admin-mini" disabled={pageSafe === 0} onClick={() => setPage(Math.max(0, pageSafe - 1))}>‹ 이전</button>
            <span>{pageSafe + 1} / {pageMax}</span>
            <button className="admin-mini" disabled={pageSafe + 1 >= pageMax} onClick={() => setPage(pageSafe + 1)}>다음 ›</button>
          </div>
        )}
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
  // 신규는 그 레벨의 보기 개수만큼 빈칸을 띄운다(Lv.1~4 4개 / Lv.5~7 5개).
  const [oi, setOi] = useState<Record<string, string[]>>(
    row ? { ...row.options_i18n } : { ko: Array.from({ length: optionCountForLevel(listLevel) }, () => '') },
  )
  const [ei, setEi] = useState<Record<string, string>>({ ...(row?.explanation_i18n ?? {}) })
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  // 임시저장 — 문제·보기·해설에 6개국어까지 얹히는 화면이라 날리면 손해가 가장 크다.
  const draft = useDraft({
    kind: 'lt-question',
    refId: row?.id,
    value: { level, cat, correct, active, pi, oi, ei },
    title: (pi.ko ?? '').trim().slice(0, 40) || (row ? row.code ?? `Lv.${row.level}` : '새 문항'),
  })
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
      draft.clear()
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
          {/* 6개국어를 번역까지 채운 뒤 날리면 손해가 특히 크다. */}
          <DraftBar
            status={draft.status}
            savedAt={draft.savedAt}
            drafts={draft.drafts}
            onRefresh={draft.refresh}
            onRestore={(p: { level: number; cat: string; correct: number; active: boolean; pi: Record<string, string>; oi: Record<string, string[]>; ei: Record<string, string> }) => {
              setLevel(p.level); setCat(p.cat); setCorrect(p.correct); setActive(p.active)
              setPi(p.pi); setOi(p.oi); setEi(p.ei)
            }}
          />
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
// 이력 한 줄. 세 제도 공용 표(question_history)에서 오므로 이름이 제도 중립이다 —
// `label` = 옛 code(L3-045) · `scope` = 옛 level(둘 다 text). 아래 QState 의 code·level 은
// ⚠️ **다른 것**이다(test_questions 에서 직접 온 현재 상태라 옛 이름 그대로다).
interface QEvent {
  id: string
  question_id: string | null
  label: string | null
  scope: string | null
  action: 'add' | 'edit' | 'deactivate' | 'activate' | 'delete'
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
  // ⚠️ 모르는 값은 맨 아래 '삭제'(빨강)로 떨어진다 — 새 action 을 서버에 추가하면 여기도 같이 넣을 것.
  if (a === 'add') return <span className="badge ok">추가</span>
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
  const evView = rows.filter((r) => matchCode(r.label))
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
                    <span style={{ fontWeight: 800, color: '#3f8fd6' }}>{ev.label ?? '번호없음'}</span>
                    <EvBadge a={ev.action} />
                    {ev.scope ? <span className="admin-hint">Lv.{ev.scope}</span> : null}
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

// 관리자 관리는 홈페이지 관리 대메뉴의 한 벌(Admin.tsx 의 AdminAccountsAdmin)로 통일했다 — 여기 있던 아레나 전용 화면은 제거(2026-08-11).
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

function UploadTab({ onApplied }: { onApplied: (level: number, codes: string[]) => void }) {
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
      const r = await callFunction<{ count: number; skipped?: number; codes?: string[] }>(
        'admin-test', { action: 'upsert', rows: qrows },
      )
      const skipped = r.skipped ?? 0
      // ⚠️ **하나도 안 들어갔으면 화면을 떠나지 않는다.** 아무 일도 안 일어났는데 목록으로 보내면
      //    뭐가 어떻게 된 건지 알 수 없다 — 여기서 이유(이미 있음)를 말하고 세워 둔다.
      if (r.count === 0) {
        setApplyMsg(`이미 등록된 문항입니다 — ${skipped}개 전부 같은 지문이 있어 넣지 않았습니다.`)
        setBusy(false)
        return
      }
      discardJob()
      setApplyMsg('')
      setBusy(false)
      // ⛔ **성공하면 이 화면을 떠난다.** 남아 있으면 「DB에 반영」이 다시 눌려 같은 문항이 한 벌 더
      //    들어간다(2026-09-02 Lv.1 사고 — 8초 간격 두 번). 잠금이 `disabled={busy}` 뿐이라
      //    "이미 반영됨" 을 화면이 못 말한다.
      onApplied(level, r.codes ?? [])
      return
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
