// 관리자페이지 재편(PPT `관리자 페이지 수정사항`)으로 **새로 만든** 화면들 — 2026-08-11.
//   Admin.tsx 가 이미 6천 줄이라 신규 화면은 여기 모은다. 라우팅(어느 메뉴에 서는가)은 Admin.tsx 가 정한다.
//   서버는 전부 `admin` 함수의 reform.ts 액션이고, 관리자 게이트는 최상위 <Admin/> 이 이미 통과시킨 뒤다.
import { Fragment, useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type ReactNode } from 'react'
import { callFunction, supabase } from '../lib/supabase'
import { useAdminData, fmtAdminDT as fmtDT, PAY_STATUS_LABEL, payStatusLabel, productLabel, readSummary, type EbookReadRow } from '../lib/adminData'
import { useDraft } from '../lib/adminDraft'
import DraftBar from '../components/DraftBar'
import { krw } from '../lib/money'
import { getTracks } from '../lib/caris'
import { MAX_LEVEL } from '../lib/categories'
import * as XLSX from 'xlsx'

// ── 공용 ──────────────────────────────────────────────────────
const inp: CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 10,
  border: '1px solid var(--line2)', background: 'var(--bg)', color: 'var(--ink)',
  fontSize: 'var(--fs-sm)',
}
const fld: CSSProperties = { display: 'grid', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--muted)' }

export function AdminHead({ title, count, children, onReload, loading }: {
  title: string; count?: string; children?: ReactNode; onReload?: () => void; loading?: boolean
}) {
  return (
    <div className="admin-head">
      <h1>{title}</h1>
      <div className="admin-head-actions">
        {count && <span className="admin-count">{count}</span>}
        {children}
        {onReload && <button className="admin-mini" onClick={onReload} disabled={loading}>새로고침</button>}
      </div>
    </div>
  )
}

const ErrBox = ({ msg }: { msg: string }) => (msg ? <div className="admin-section admin-empty">{msg}</div> : null)

// ── 막대 그래프 ───────────────────────────────────────────────
// 대시보드(`MiniBars`)와 **같은 모양**을 쓴다 — 관리자 화면 안에서 그래프가 두 가지로 보이면 안 된다.
//   · 막대에 올리면 날짜와 값이 뜬다(`.mini-tip`)
//   · 아래 꼬리말에 기간과 합계
// ⚠️ 한 그래프에 두 값을 겹쳐 그리지 않는다 — 하루에 막대가 둘이면 무엇이 무엇인지 읽히지 않는다.
//    값이 둘이면 **그래프를 둘로** 나눈다.
function MiniBars({ labels, values, color }: { labels: string[]; values: number[]; color: string }) {
  if (!labels.length) return <div className="admin-empty">이 기간에 기록이 없습니다.</div>
  const max = Math.max(1, ...values)
  const sum = values.reduce((a, b) => a + b, 0)
  return (
    <>
      <div className="mini-bars">
        {labels.map((lb, i) => (
          <div key={lb} className="mini-bar">
            <div className="fill" style={{ height: `${(values[i] / max) * 100}%`, background: color }} />
            <div className="mini-tip"><span>{lb}</span><b>{values[i]}</b></div>
          </div>
        ))}
      </div>
      <div className="mini-foot">{labels[0]} ~ {labels[labels.length - 1]} · 최대 {max} · 합계 {sum}</div>
    </>
  )
}

// ══════════════════════════════════════════════════════════════
// 회원관리 > 결제관리
// ══════════════════════════════════════════════════════════════
interface PaymentRow {
  id: string; userId: string; name: string | null; email: string | null
  orderId: string; orderName: string; productType: string; amount: number
  status: string; method: string | null; fulfilledAt: string | null; createdAt: string
  // 이 결제로 나간 이북들의 열람 여부. 이북이 안 붙은 결제(응시료 단독 등)는 빈 배열이다.
  reads?: EbookReadRow[]
}
interface PaymentListResp {
  payments: PaymentRow[]; total: number
  stats30d: { paidN: number; paidAmount: number; refundN: number; refundAmount: number }
  queues: { unfulfilled: number; revoked: number }
}
/** 열람 칸 — 결제 목록(여기)과 회원 상세 '결제·구매' 탭이 같이 쓴다.
 *  ⚠️ 여러 권이면 제목·시각을 칸에 펼치지 않고 마우스 올림(title)으로 넘긴다 — 표 줄이 무너진다.
 *  ⚠️ **읽음을 경고색(amber)으로 칠하지 않는다.** 이 화면에서 amber 는 '미지급'(우리가 잘못한 것) 한 뜻이다.
 *     열람은 잘못이 아니라 사실이라 굵기로만 세운다. */
export function ReadCell({ reads }: { reads?: EbookReadRow[] }) {
  const s = readSummary(reads)
  const detail = (reads ?? [])
    .map((r) => `${r.title ?? r.ebookId} — ${r.firstAt ? `${fmtDT(r.firstAt)} 첫 열람 · ${r.count}회` : '열람 없음'}`)
    .join('\n')
  return (
    <td style={{ whiteSpace: 'nowrap' }} title={detail || undefined}>
      {s.none
        ? <span style={{ color: 'var(--muted)' }}>-</span>
        : s.opened
          ? <b>{s.text}</b>
          : <span style={{ color: 'var(--muted)' }}>{s.text}</span>}
      {/* 한 권짜리 결제는 마지막 열람 시각까지 — 환불 문의가 들어온 시점과 대조하는 값이다. */}
      {s.opened && reads?.length === 1 && reads[0].lastAt && (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtDT(reads[0].lastAt)}</div>
      )}
    </td>
  )
}

export function PaymentsAdmin() {
  const [status, setStatus] = useState('')
  const [productType, setProductType] = useState('')
  const [queue, setQueue] = useState('')
  const [q, setQ] = useState('')
  const { data, loading, err, reload } = useAdminData<PaymentListResp>('paymentList', { status, productType, queue, limit: 300 })

  const rows = (data?.payments ?? []).filter((p) => {
    if (!q) return true
    const s = q.toLowerCase()
    return (p.name ?? '').toLowerCase().includes(s) || (p.email ?? '').toLowerCase().includes(s) || p.orderId.toLowerCase().includes(s)
  })
  const st = data?.stats30d

  return (
    <>
      <AdminHead title="결제관리" count={`총 ${data?.total ?? 0}건`} onReload={reload} loading={loading} />
      <ErrBox msg={err} />

      <div className="admin-cards" style={{ marginBottom: 16 }}>
        <div className="admin-card"><div className="k">매출(30일)</div><div className="v">{krw(st?.paidAmount ?? 0)}</div></div>
        <div className="admin-card"><div className="k">결제 건수(30일)</div><div className="v">{st?.paidN ?? 0}건</div></div>
        <div className="admin-card"><div className="k">환불(30일)</div><div className="v">{st?.refundN ?? 0}건</div></div>
        {/* 이 숫자가 0이 아니면 누군가 돈만 내고 못 받고 있다는 뜻이다. */}
        <div className="admin-card">
          <div className="k">미지급</div>
          <div className="v" style={(data?.queues.unfulfilled ?? 0) ? { color: 'var(--k-amber, #d98a00)' } : undefined}>
            {data?.queues.unfulfilled ?? 0}건
          </div>
        </div>
      </div>

      <div className="admin-toolbar">
        <input className="admin-search" placeholder="이름·이메일·주문번호 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setQueue('') }}>
          <option value="">전체 상태</option>
          {Object.entries(PAY_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={productType} onChange={(e) => setProductType(e.target.value)}>
          <option value="">전체 상품</option>
          <option value="exam">응시료</option>
          <option value="cert">자격증 발급비</option>
          <option value="ebook">이북</option>
        </select>
        <select value={queue} onChange={(e) => { setQueue(e.target.value); if (e.target.value) setStatus('') }}>
          <option value="">처리 대기 보기</option>
          <option value="unfulfilled">미지급(돈 받고 안 준 것)</option>
          <option value="revoked">환불 후 미회수</option>
        </select>
        <span className="admin-hint">{rows.length}건{loading ? ' · 불러오는 중…' : ''}</span>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr><th>일시</th><th>구매자</th><th>상품</th><th style={{ textAlign: 'right' }}>금액</th><th>수단</th><th>상태</th><th>열람</th></tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{fmtDT(p.createdAt)}</td>
                <td><div className="admin-user"><b>{p.name || '-'}</b><span>{p.email || p.orderId}</span></div></td>
                <td>{p.orderName}<span style={{ color: 'var(--muted)' }}> · {productLabel(p.productType)}</span></td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{krw(p.amount)}</td>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{p.method || '-'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <span className="badge">{payStatusLabel(p.status)}</span>
                  {p.status === 'paid' && !p.fulfilledAt && <b style={{ color: 'var(--k-amber, #d98a00)' }}> · 미지급</b>}
                </td>
                {/* 열람 여부 — 환불 문의가 왔을 때 제일 먼저 보는 칸이다. 읽은 건은 눈에 띄어야 한다. */}
                <ReadCell reads={p.reads} />
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>결제 내역이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="admin-hint" style={{ marginTop: 10, lineHeight: 1.7 }}>
        ⚠️ 환불을 <b>실행</b>하는 버튼은 두지 않습니다 — 돈을 되돌리는 건 토스 대시보드에서 하고, 우리 쪽은 환불 웹훅을
        받아 아직 안 쓴 이북·응시권만 자동 회수합니다. <b>미지급</b>은 승인은 됐는데 물건이 안 나간 건으로, 대사(reconcile)가
        같은 목록을 봅니다.
      </p>
    </>
  )
}

// ══════════════════════════════════════════════════════════════
// WORLD ARENA > 미니게임 > 게임 현황
// ══════════════════════════════════════════════════════════════
// 게임 이름·지표 — 화면에 `pick-cari` 같은 내부 id 를 내보내지 않는다.
//   지표가 게임마다 다르다(점수 / 도달 라운드 / 도달 레벨). 단위를 안 붙이면 5 가 5점인지 5레벨인지 모른다.
const GAME_META: Record<string, { name: string; unit: string; max: number }> = {
  'beat-cari': { name: '버텨라 CARI', unit: '점', max: 5000 },
  'shoot-cari': { name: '쏴라 CARI', unit: '점', max: 5000 },
  'pick-cari': { name: '골라라 CARI', unit: '라운드', max: 15 },
  'reach-cari': { name: '닿아라 CARI', unit: '레벨', max: 5 },
  'build-cari': { name: '지어라 CARI', unit: '레벨', max: 3 },
  'program-cari': { name: '프로그램해라 CARI', unit: '레벨', max: 6 },
}
const gameName = (id: string) => GAME_META[id]?.name ?? id
const gameUnit = (id: string) => GAME_META[id]?.unit ?? ''

interface GameStat {
  gameId: string; players: number; plays: number; playsPerPlayer: number
  best: number; avgBest: number; avgSec: number | null; recentPlays: number
  hours: number[]; days: Record<string, number>
}

/** 24시간 분포 — "언제 하는가". 축이 있는 공용 차트를 그대로 쓴다. */
function HourChart({ hours, color = 'var(--k-teal, #2aa6a0)' }: { hours: number[]; color?: string }) {
  const total = hours.reduce((a, b) => a + b, 0)
  if (!total) return <div className="admin-empty">아직 기록이 없습니다.</div>
  const peak = hours.indexOf(Math.max(...hours))
  return (
    <>
      <p className="admin-hint" style={{ margin: '0 0 10px' }}>
        가장 많은 시간대 <b>{peak}시</b> ({hours[peak]}회) · 전체 {total.toLocaleString()}회
      </p>
      <MiniBars labels={Array.from({ length: 24 }, (_, h) => `${h}시`)} values={hours} color={color} />
    </>
  )
}

const PERIODS: [number, string][] = [[7, '7일'], [30, '30일'], [90, '90일']]
const fmtSec = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s}초`)

export function MinigameStatAdmin() {
  const [days, setDays] = useState(30)
  const { data, loading, err, reload } = useAdminData<{ games: GameStat[]; days: number; hasPlayLog: boolean }>('minigameStats', { days })
  const games = data?.games ?? []
  const [open, setOpen] = useState<string | null>(null)
  return (
    <>
      <AdminHead title="게임 현황" count={`${games.length}종`} onReload={reload} loading={loading} />
      <ErrBox msg={err} />
      <div className="admin-toolbar">
        {PERIODS.map(([d, label]) => (
          <button key={d} className="admin-mini" onClick={() => setDays(d)}
            style={days === d ? { background: 'var(--blue)', color: '#fff' } : undefined}>{label}</button>
        ))}
        <span className="admin-hint">이용 통계(플레이 시간·시간대·일별)는 이 기간 기준입니다{loading ? ' · 불러오는 중…' : ''}</span>
      </div>
      {data && !data.hasPlayLog && (
        <div className="admin-section" style={{ borderColor: 'var(--k-amber, #d98a00)' }}>
          <b>이 기간에 매 판 기록이 아직 없습니다.</b>
          <p className="admin-hint" style={{ margin: '6px 0 0', lineHeight: 1.7 }}>
            평균 플레이 시간·시간대·일별 그래프는 <b>지금부터 쌓이는</b> 판부터 나옵니다.
            참여자·최고 기록처럼 예전부터 있던 값은 그대로 보입니다.
          </p>
        </div>
      )}

      {games.map((g) => {
        const meta = GAME_META[g.gameId]
        const opened = open === g.gameId
        const dayKeys = Object.keys(g.days).sort()
        return (
          <div key={g.gameId} className="admin-section">
            <div className="admin-section-head">
              <h3>{gameName(g.gameId)}</h3>
              <button className="admin-mini" onClick={() => setOpen(opened ? null : g.gameId)}>
                {opened ? '그래프 접기' : '언제 하는지 보기'}
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              <div className="admin-card"><div className="k">참여자</div><div className="v">{g.players}명</div></div>
              <div className="admin-card">
                <div className="k">총 플레이</div><div className="v">{g.plays.toLocaleString()}회</div>
                <div className="s">1인 평균 {g.playsPerPlayer}회</div>
              </div>
              <div className="admin-card">
                <div className="k">최근 {data?.days ?? days}일</div><div className="v">{g.recentPlays.toLocaleString()}회</div>
                <div className="s">이 기간 플레이</div>
              </div>
              <div className="admin-card">
                <div className="k">평균 플레이 시간</div>
                <div className="v">{g.avgSec == null ? '–' : fmtSec(g.avgSec)}</div>
                <div className="s">{g.avgSec == null ? '아직 기록 없음' : '이 기간 판들의 평균'}</div>
              </div>
              <div className="admin-card">
                <div className="k">최고 기록</div>
                <div className="v">{g.best.toLocaleString()}{gameUnit(g.gameId)}</div>
                {meta && <div className="s">만점 {meta.max.toLocaleString()}{meta.unit}</div>}
              </div>
              <div className="admin-card">
                <div className="k">평균</div><div className="v">{g.avgBest.toLocaleString()}{gameUnit(g.gameId)}</div>
                <div className="s">사람별 최고기록 평균</div>
              </div>
            </div>
            {opened && (
              <div style={{ marginTop: 18, display: 'grid', gap: 22 }}>
                <div>
                  <h3 style={{ marginBottom: 10 }}>시간대</h3>
                  <HourChart hours={g.hours} />
                </div>
                <div>
                  <h3 style={{ marginBottom: 10 }}>일별 <span className="admin-hint">최근 {data?.days ?? days}일</span></h3>
                  <MiniBars
                    labels={dayKeys.map((d) => d.slice(5))}
                    values={dayKeys.map((d) => g.days[d])}
                    color="var(--k-blue, #3f7bd6)"
                  />
                </div>
              </div>
            )}
          </div>
        )
      })}
      {!games.length && !loading && <div className="admin-section admin-empty">아직 플레이 기록이 없습니다.</div>}
    </>
  )
}

// ══════════════════════════════════════════════════════════════
// WORLD ARENA > DAILY QUIZ > 참여 현황
// ══════════════════════════════════════════════════════════════
interface DailySeriesRow { key: string; learn: number; attend: number; minigame: number; leveltest: number }
interface DailyStatsResp {
  from: string; to: string; bucket: string
  series: DailySeriesRow[]
  hours: number[]
  totals: { learn: number; attend: number; people: number; days: number }
}
const PRESETS: [number, string][] = [[7, '7일'], [30, '30일'], [90, '90일'], [365, '1년']]
const todayKst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)

export function DailyStatAdmin() {
  const [days, setDays] = useState(30)
  const [bucket, setBucket] = useState<'day' | 'week' | 'month'>('day')
  const [to, setTo] = useState(todayKst)
  const { data, loading, err, reload } = useAdminData<DailyStatsResp>('dailyStats', { days, bucket, to })
  const rows = data?.series ?? []
  const hours = data?.hours ?? []
  const t = data?.totals

  return (
    <>
      <AdminHead
        title="DAILY QUIZ · 참여 현황"
        count={t ? `풀이 ${t.learn.toLocaleString()}건 · ${t.people.toLocaleString()}명 · 출석 ${t.attend.toLocaleString()}건` : ''}
        onReload={reload}
        loading={loading}
      />
      <ErrBox msg={err} />

      <div className="admin-toolbar">
        {PRESETS.map(([d, label]) => (
          <button key={d} className={days === d ? 'admin-mini on' : 'admin-mini'} onClick={() => setDays(d)}
            style={days === d ? { background: 'var(--blue)', color: '#fff' } : undefined}>{label}</button>
        ))}
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>
          기준일 <input style={{ ...inp, width: 160 }} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <select value={bucket} onChange={(e) => setBucket(e.target.value as typeof bucket)}>
          <option value="day">일별</option>
          <option value="week">주별</option>
          <option value="month">월별</option>
        </select>
        <span className="admin-hint">{data ? `${data.from} ~ ${data.to}` : ''}{loading ? ' · 불러오는 중…' : ''}</span>
      </div>

      <div className="admin-cards">
        <div className="admin-card"><div className="k">DAILY QUIZ 완료</div><div className="v">{(t?.learn ?? 0).toLocaleString()}건</div><div className="s">기간 합계</div></div>
        <div className="admin-card"><div className="k">참여 인원</div><div className="v">{(t?.people ?? 0).toLocaleString()}명</div><div className="s">중복 제외</div></div>
        <div className="admin-card"><div className="k">출석</div><div className="v">{(t?.attend ?? 0).toLocaleString()}건</div><div className="s">DAILY QUIZ와 별개 집계</div></div>
        <div className="admin-card">
          <div className="k">하루 평균</div>
          <div className="v">{t ? Math.round((t.learn / Math.max(1, t.days)) * 10) / 10 : 0}건</div>
          <div className="s">{t?.days ?? 0}일 기준</div>
        </div>
      </div>

      {/* ⚠️ 한 그래프에 DAILY QUIZ·출석을 겹쳐 그리면 하루에 막대가 둘이라 해석이 안 된다 → 그래프를 둘로 나눈다. */}
      {(() => {
        const labels = rows.map((r) => (bucket === 'month' ? r.key : r.key.slice(5)))
        return (
          <>
            <div className="admin-section">
              <h3>DAILY QUIZ 완료</h3>
              <MiniBars labels={labels} values={rows.map((r) => r.learn)} color="var(--k-blue, #3f7bd6)" />
            </div>
            <div className="admin-section">
              <h3>출석 <span className="admin-hint">DAILY QUIZ와 별개로 집계됩니다</span></h3>
              <MiniBars labels={labels} values={rows.map((r) => r.attend)} color="var(--k-violet, #7c6cf0)" />
            </div>
          </>
        )
      })()}

      <div className="admin-section">
        <h3>구간별 숫자</h3>
        {rows.length ? (
          <>
            <div className="admin-table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{bucket === 'month' ? '월' : bucket === 'week' ? '주(시작일)' : '날짜'}</th>
                    <th style={{ textAlign: 'right' }}>DAILY QUIZ</th>
                    <th style={{ textAlign: 'right' }}>출석</th>
                    <th style={{ textAlign: 'right' }}>미니게임</th>
                    <th style={{ textAlign: 'right' }}>레벨테스트</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].reverse().map((r) => (
                    <tr key={r.key}>
                      <td style={{ whiteSpace: 'nowrap' }}>{r.key}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}><b>{r.learn}</b></td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.attend}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.minigame}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.leveltest}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : <div className="admin-empty">이 기간에 기록이 없습니다.</div>}
      </div>

      {/* 어느 시간에 많이 하는지 — 그날 처음 들어온 시각 기준, 한국 시간. */}
      <div className="admin-section">
        <h3>시간대 <span className="admin-hint">DAILY QUIZ를 푼 사람이 그날 처음 들어온 시각(한국 시간)</span></h3>
        <HourChart hours={hours} />
      </div>
    </>
  )
}

// ══════════════════════════════════════════════════════════════
// 용어 문항 풀 — 미니게임 3종 + DAILY QUIZ 가 **같이 쓰는 한 벌**
// ══════════════════════════════════════════════════════════════
interface TermRow {
  id: string; field: string; active: boolean; sort_order: number
  desc_i18n: Record<string, string>; answer_i18n: Record<string, string>
  distractors_i18n: Record<string, string[]>
  /** 이 문항을 담고 있는 게임들. 비어 있으면 어느 게임에도 안 담긴 상태. */
  games: string[]
}
type TermDraft = Partial<TermRow> & { _new?: boolean }
const TERM_FIELDS = ['AI', '로봇', '피지컬AI']

// 용어 문항을 쓰는 곳 — 미니게임 3종 + DAILY QUIZ.
//   ⚠️ 퍼즐형(닿아라·지어라·프로그램해라)은 용어 문제가 아니라 레벨 설계라 여기 없다.
const TERM_TARGETS: [string, string][] = [
  ['beat-cari', '버텨라 CARI'],
  ['shoot-cari', '쏴라 CARI'],
  ['pick-cari', '골라라 CARI'],
  ['daily', 'DAILY QUIZ'],
]

export function TermPoolAdmin({ scope }: { scope: 'minigame' | 'daily' }) {
  const { data, loading, err, reload } = useAdminData<{ terms: TermRow[]; counts: Record<string, number> }>('termList')
  const [edit, setEdit] = useState<TermDraft | null>(null)
  const draft = useDraft({ kind: 'term-question', refId: edit?.id, value: edit, title: edit?.answer_i18n?.ko?.trim() || '새 용어 문항', enabled: !!edit })
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  // 어느 게임의 세트를 편집 중인가. 기본은 이 메뉴가 속한 곳.
  const [target, setTarget] = useState(scope === 'daily' ? 'daily' : 'beat-cari')
  const all = data?.terms ?? []
  const rows = all.filter((t) =>
    !q || (t.answer_i18n?.ko ?? '').includes(q) || (t.desc_i18n?.ko ?? '').includes(q))
  const inSet = (t: TermRow) => (t.games ?? []).includes(target)
  const setCount = data?.counts?.[target] ?? 0

  // 문항 하나를 이 게임에 담거나 뺀다.
  async function toggle(t: TermRow) {
    const next = inSet(t) ? (t.games ?? []).filter((g) => g !== target) : [...(t.games ?? []), target]
    try {
      await callFunction('admin', { action: 'termSetGames', questionId: t.id, games: next })
      await reload()
    } catch (e) { alert(e instanceof Error ? e.message : '저장 실패') }
  }
  // 지금 보이는 목록을 통째로 담거나 뺀다.
  async function bulk(pick: boolean) {
    const ids = pick ? rows.map((t) => t.id) : []
    if (!pick && !confirm(`${TERM_TARGETS.find(([g]) => g === target)?.[1]} 의 문항을 모두 뺄까요?\n(비우면 은행 전체를 쓰게 됩니다)`)) return
    setBusy(true)
    try {
      await callFunction('admin', { action: 'termSetBulk', gameId: target, questionIds: ids })
      await reload()
    } catch (e) { alert(e instanceof Error ? e.message : '저장 실패') } finally { setBusy(false) }
  }

  async function save() {
    if (!edit) return
    setBusy(true)
    try {
      await callFunction('admin', {
        action: 'termUpsert',
        term: {
          id: edit._new ? undefined : edit.id,
          field: edit.field ?? 'AI',
          descKo: edit.desc_i18n?.ko ?? '',
          answerKo: edit.answer_i18n?.ko ?? '',
          distractorsKo: edit.distractors_i18n?.ko ?? [],
          descI18n: edit.desc_i18n, answerI18n: edit.answer_i18n, distractorsI18n: edit.distractors_i18n,
          active: edit.active !== false, sortOrder: edit.sort_order ?? 0,
        },
      })
      draft.clear()
      setEdit(null)
      await reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : '저장 실패')
    } finally { setBusy(false) }
  }
  async function del(id: string) {
    if (!confirm('이 문항을 삭제할까요?')) return
    try { await callFunction('admin', { action: 'termDelete', id }); await reload() }
    catch (e) { alert(e instanceof Error ? e.message : '삭제 실패') }
  }
  // 코드(`src/lib/terms.ts`)에 박힌 50문항을 DB 로 한 번 옮긴다. 이미 있는 정답은 건너뛰므로 여러 번 눌러도 안전.
  async function importFromCode() {
    if (!confirm('코드에 들어 있는 기본 용어 문항을 불러올까요? (이미 있는 것은 건너뜁니다)')) return
    setBusy(true)
    try {
      const { TERMS } = await import('../lib/terms')
      const r = await callFunction<{ added: number }>('admin', {
        action: 'termImport',
        items: TERMS.map((t) => ({ field: t.field, desc: t.desc, answer: t.answer, distractors: t.distractors })),
      })
      alert(`${r.added}문항을 불러왔습니다.`)
      await reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : '불러오기 실패')
    } finally { setBusy(false) }
  }

  const blank: TermDraft = {
    _new: true, field: 'AI', active: true, sort_order: rows.length,
    desc_i18n: {}, answer_i18n: {}, distractors_i18n: { ko: ['', '', ''] },
  }
  return (
    <>
      <AdminHead
        title={scope === 'daily' ? 'DAILY QUIZ · 문항 관리' : '게임 문항'}
        count={`총 ${data?.terms.length ?? 0}문항`}
        onReload={reload}
        loading={loading}
      >
        <button className="admin-mini" onClick={importFromCode} disabled={busy}>기본 문항 불러오기</button>
        <button className="admin-mini" onClick={() => setEdit(blank)}>+ 새 문항</button>
      </AdminHead>
      <ErrBox msg={err} />
      <p className="admin-hint" style={{ marginBottom: 12, lineHeight: 1.7 }}>
        CARIS 문제은행과 같은 방식입니다 — <b>은행에 문항을 쌓아두고, 게임마다 담을 문항을 고릅니다.</b>
        <br />⚠️ 담긴 문항이 <b>0개면 그 게임은 은행 전체</b>를 씁니다(“아직 안 골랐다”는 뜻이지 “문제 없음”이 아닙니다).
      </p>

      {/* 어느 게임의 세트를 편집할지 — 담긴 개수를 같이 보여준다. */}
      <div className="admin-tabs admin-tabs-sub" style={{ marginBottom: 14 }}>
        {TERM_TARGETS.map(([g, label]) => (
          <button key={g} className={target === g ? 'on' : ''} onClick={() => setTarget(g)}>
            {label} <span style={{ opacity: 0.6 }}>{data?.counts?.[g] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="admin-toolbar">
        <input className="admin-search" placeholder="용어·설명 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="admin-hint">
          은행 {all.length}문항 · <b>{TERM_TARGETS.find(([g]) => g === target)?.[1]}</b> 에 담긴 것 {setCount}개
          {setCount === 0 && ' (= 은행 전체 사용)'}
        </span>
        <button className="admin-mini" onClick={() => bulk(true)} disabled={busy || !rows.length}>보이는 것 모두 담기</button>
        <button className="admin-mini" onClick={() => bulk(false)} disabled={busy || !setCount}>모두 빼기</button>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th style={{ width: 90 }}>담기</th>
              <th>분야</th><th>정답 용어</th><th>설명</th><th>쓰는 곳</th><th>상태</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} style={inSet(t) ? undefined : { opacity: 0.55 }}>
                <td>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                    <input type="checkbox" checked={inSet(t)} onChange={() => toggle(t)} />
                    {inSet(t) ? '담김' : ''}
                  </label>
                </td>
                <td><span className="badge">{t.field}</span></td>
                <td><b>{t.answer_i18n?.ko}</b></td>
                {/* ⚠️ maxWidth 만으로는 안 잘린다 — 표 셀은 내용에 맞춰 늘어나서 옆 열 글자와 겹친다.
                    한 줄로 자르고 전체는 마우스를 올려 본다. */}
                <td
                  title={t.desc_i18n?.ko}
                  style={{ maxWidth: 340, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {t.desc_i18n?.ko}
                </td>
                <td style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>
                  {(t.games ?? []).length
                    ? (t.games ?? []).map((g) => TERM_TARGETS.find(([k]) => k === g)?.[1] ?? g).join(' · ')
                    : <span style={{ color: 'var(--dim)' }}>어디에도 안 담김</span>}
                </td>
                <td>{t.active ? <span className="badge ok">사용</span> : <span className="badge low">중지</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="admin-mini" onClick={() => setEdit({ ...t })}>수정</button>{' '}
                  <button className="admin-mini" onClick={() => del(t.id)}>삭제</button>
                </td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                문항이 없습니다. 「기본 문항 불러오기」로 코드에 있던 50문항을 옮겨올 수 있습니다.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {edit && (
        <div className="admin-modal-bg">
        {/* ⚠️ 바깥을 눌러도 닫지 않는다 — 입력하던 내용이 통째로 날아간다(닫기는 ✕·취소 버튼으로). */}
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <button className="admin-modal-x" onClick={() => setEdit(null)}>✕</button>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0 }}>{edit._new ? '새 문항' : '문항 수정'}</h2>
              <DraftBar status={draft.status} savedAt={draft.savedAt} drafts={draft.drafts} onRefresh={draft.refresh} onRestore={(p: TermDraft) => setEdit(p)} />
            </div>
            <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
              <label style={fld}>분야
                <select style={inp} value={edit.field ?? 'AI'} onChange={(e) => setEdit({ ...edit, field: e.target.value })}>
                  {TERM_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
              <label style={fld}>설명(문제문)
                <textarea style={{ ...inp, minHeight: 72 }} value={edit.desc_i18n?.ko ?? ''}
                  onChange={(e) => setEdit({ ...edit, desc_i18n: { ...edit.desc_i18n, ko: e.target.value } })} />
              </label>
              <label style={fld}>정답 용어
                <input style={inp} value={edit.answer_i18n?.ko ?? ''}
                  onChange={(e) => setEdit({ ...edit, answer_i18n: { ...edit.answer_i18n, ko: e.target.value } })} />
              </label>
              {[0, 1, 2].map((i) => (
                <label key={i} style={fld}>오답 {i + 1}
                  <input style={inp} value={edit.distractors_i18n?.ko?.[i] ?? ''}
                    onChange={(e) => {
                      const arr = [...(edit.distractors_i18n?.ko ?? ['', '', ''])]
                      arr[i] = e.target.value
                      setEdit({ ...edit, distractors_i18n: { ...edit.distractors_i18n, ko: arr } })
                    }} />
                </label>
              ))}
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--fs-sm)' }}>
                <input type="checkbox" checked={edit.active !== false} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />
                사용
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
              <button className="admin-mini" onClick={() => setEdit(null)}>취소</button>
              <button className="btn-ink" onClick={save} disabled={busy}>{busy ? '저장 중…' : '저장'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ══════════════════════════════════════════════════════════════
// WORLD ARENA > 코인 관리 (코인 · 시즌 점수 적립 정책)
// ══════════════════════════════════════════════════════════════
interface RewardRow { wallet: 'coin' | 'score'; kind: string; label: string; amount: number; per_day: number; active: boolean; sort_order: number }
export function CoinPolicyAdmin() {
  const { data, loading, err, reload } = useAdminData<{ policy: RewardRow[] }>('rewardPolicy')
  const [rows, setRows] = useState<RewardRow[] | null>(null)
  const draft = useDraft({ kind: 'reward-policy', value: rows, title: '코인·점수 적립 정책', enabled: !!rows })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => { if (data) setRows(data.policy) }, [data])

  const patch = (i: number, p: Partial<RewardRow>) =>
    setRows((prev) => (prev ? prev.map((r, k) => (k === i ? { ...r, ...p } : r)) : prev))

  async function save() {
    if (!rows) return
    setBusy(true); setMsg('')
    try {
      await callFunction('admin', {
        action: 'rewardPolicySave',
        rows: rows.map((r) => ({ wallet: r.wallet, kind: r.kind, amount: r.amount, perDay: r.per_day, active: r.active })),
      })
      setMsg('✅ 저장했습니다')
      draft.clear()
      await reload()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '저장 실패')
    } finally { setBusy(false) }
  }

  // 미니게임은 부모 한 줄(`minigame`) + 게임별 자식(`minigame:<id>`)이다.
  //   부모는 **기본값**이고, 펼쳐서 게임별로 다르게 줄 수 있다.
  const [openGames, setOpenGames] = useState(false)
  const isChild = (k: string) => k.startsWith('minigame:')

  const row = (r: RewardRow, i: number, child = false) => (
    <tr key={`${r.wallet}/${r.kind}`}>
      <td style={child ? { paddingLeft: 34, color: 'var(--muted)' } : undefined}>
        {child ? r.label : <b>{r.label}</b>}
      </td>
      <td><input style={inp} type="number" min={0} value={r.amount} onChange={(e) => patch(i, { amount: Math.max(0, +e.target.value) })} /></td>
      <td><input style={inp} type="number" min={0} value={r.per_day} onChange={(e) => patch(i, { per_day: Math.max(0, +e.target.value) })} /></td>
      <td>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={r.active} onChange={(e) => patch(i, { active: e.target.checked })} />
          {r.active ? '정상' : '중지'}
        </label>
      </td>
    </tr>
  )

  const table = (wallet: 'coin' | 'score', title: string, desc: string) => {
    const list = (rows ?? []).map((r, i) => ({ r, i })).filter(({ r }) => r.wallet === wallet)
    return (
      <div className="admin-section">
        <h3>{title}</h3>
        <p className="admin-hint" style={{ marginTop: -6, marginBottom: 12 }}>{desc}</p>
        <table className="admin-table">
          <thead><tr><th>활동</th><th style={{ width: 140 }}>적립</th><th style={{ width: 140 }}>1일 한도</th><th style={{ width: 120 }}>사용</th></tr></thead>
          <tbody>
            {list.map(({ r, i }) => {
              if (isChild(r.kind)) return null // 자식은 부모 아래에서 그린다
              if (r.kind !== 'minigame') return row(r, i)
              const kids = list.filter((x) => isChild(x.r.kind))
              return (
                <Fragment key={r.kind}>
                  <tr>
                    <td>
                      <button className="admin-mini" onClick={() => setOpenGames((v) => !v)} style={{ marginRight: 8 }}>
                        {openGames ? '▾' : '▸'}
                      </button>
                      <b>{r.label}</b>
                      <span className="admin-hint"> · 게임별로 다르게 주려면 펼치세요 ({kids.length}종)</span>
                    </td>
                    <td><input style={inp} type="number" min={0} value={r.amount} onChange={(e) => patch(i, { amount: Math.max(0, +e.target.value) })} /></td>
                    <td><input style={inp} type="number" min={0} value={r.per_day} onChange={(e) => patch(i, { per_day: Math.max(0, +e.target.value) })} /></td>
                    <td>
                      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input type="checkbox" checked={r.active} onChange={(e) => patch(i, { active: e.target.checked })} />
                        {r.active ? '정상' : '중지'}
                      </label>
                    </td>
                  </tr>
                  {openGames && kids.map(({ r: kr, i: ki }) => row(kr, ki, true))}
                  {openGames && (
                    <tr>
                      <td colSpan={4} className="admin-hint" style={{ paddingLeft: 34 }}>
                        게임별 값이 위 「미니게임」 기본값을 덮어씁니다. 같게 두면 기본값과 똑같이 동작합니다.
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <>
      <AdminHead title="코인 관리" onReload={reload} loading={loading}>
        {msg && <span className="admin-msg">{msg}</span>}
        <DraftBar status={draft.status} savedAt={draft.savedAt} drafts={draft.drafts} onRefresh={draft.refresh}
          onRestore={(p: RewardRow[]) => setRows(p)} />
        <button className="btn-ink" onClick={save} disabled={busy || !rows}>{busy ? '저장 중…' : '저장'}</button>
      </AdminHead>
      <ErrBox msg={err} />
      {/* ⚠️ 지갑이 둘이다. 코인은 상점에서 쓰는 재화, 시즌 점수는 랭킹을 매기는 값이다. 섞으면 안 된다. */}
      {table('coin', '코인 (상점 재화)', '캐릭터 허브 상점에서 쓰는 재화입니다. 랭킹과는 관계가 없습니다.')}
      {table('score', '시즌 점수 (랭킹)', '리더보드 순위를 매기는 값입니다. 레벨테스트 클리어 점수(레벨당 1,000)는 여기서 바꾸지 않습니다.')}
      <p className="admin-hint" style={{ lineHeight: 1.7 }}>
        ⚠️ 이미 쌓인 점수는 그대로입니다 — 값을 바꾸면 <b>바꾼 시점 이후</b>부터 달라집니다. 시즌 도중에 올리면
        늦게 시작한 사람이 유리해질 수 있습니다.
      </p>
    </>
  )
}

// ══════════════════════════════════════════════════════════════
// CARIS > 인증서 관리
// ══════════════════════════════════════════════════════════════
interface CertRow {
  attemptId: string; userId: string; name: string | null; examTitle: string | null
  submittedAt: string | null; releasedAt: string | null
  score: number | null; total: number | null; passRatio: number
  certNo: string | null; certIssuedAt: string | null; nameRoman: string | null
}
interface CertTierRow { tier: string; sort: number; pass_ratio: number | null; cert_available_after_days: number | null; cert_fee_override: number | null }

export function CertAdmin() {
  const [view, setView] = useState<'list' | 'cond'>('list')
  return (
    <>
      <AdminHead title="인증서 관리" />
      <div className="admin-tabs" style={{ marginBottom: 16 }}>
        <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>발급 현황</button>
        <button className={view === 'cond' ? 'on' : ''} onClick={() => setView('cond')}>급수별 발급 조건</button>
      </div>
      {view === 'list' ? <CertList /> : <CertConditions />}
    </>
  )
}

// 발급 현황 — 급수로 접어서 본다. 한 표에 다 펴놓으면 어느 급수가 몇 건인지 안 보인다.
function CertList() {
  const [pendingOnly, setPendingOnly] = useState(false)
  const { data, loading, err, reload } = useAdminData<{ certs: CertRow[] }>('certList', { pendingOnly })
  const [open, setOpen] = useState<string | null>(null)
  const rows = data?.certs ?? []

  // 시험명에서 급수를 뽑는다(제 5회 CARIS · Pro → Pro). 급수를 못 읽으면 '기타'로 모은다.
  const groups = new Map<string, CertRow[]>()
  for (const r of rows) {
    const g = (r.examTitle ?? '').split('·').pop()?.trim() || '기타'
    ;(groups.get(g) ?? groups.set(g, []).get(g)!).push(r)
  }
  const list = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
  const issued = rows.filter((r) => r.certNo).length

  return (
    <>
      <div className="admin-toolbar">
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--fs-sm)' }}>
          <input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} />
          미발급만 보기
        </label>
        <span className="admin-hint">합격 {rows.length}건 · 발급 완료 {issued}건 · 미발급 {rows.length - issued}건{loading ? ' · 불러오는 중…' : ''}</span>
        <button className="admin-mini" onClick={reload} disabled={loading}>새로고침</button>
      </div>
      <ErrBox msg={err} />

      {list.map(([g, items]) => {
        const done = items.filter((r) => r.certNo).length
        const opened = open === g
        return (
          <div key={g} className="admin-section" style={{ padding: opened ? '18px 20px' : '14px 20px' }}>
            <button
              onClick={() => setOpen(opened ? null : g)}
              style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 10, background: 'none', border: 0, color: 'inherit', cursor: 'pointer', textAlign: 'left', padding: 0 }}
            >
              <span style={{ color: 'var(--muted)' }}>{opened ? '▾' : '▸'}</span>
              <b style={{ fontSize: 'var(--fs-md)' }}>{g}</b>
              <span className="admin-hint">합격 {items.length}건 · 발급 {done}건 · 미발급 {items.length - done}건</span>
            </button>
            {opened && (
              <div className="admin-table-wrap" style={{ marginTop: 12 }}>
                <table className="admin-table">
                  <thead>
                    <tr><th>응시자</th><th>회차</th><th>점수</th><th>합격선</th><th>영문 성명</th><th>자격번호</th><th>발급일</th></tr>
                  </thead>
                  <tbody>
                    {items.map((r) => (
                      <tr key={r.attemptId}>
                        <td><b>{r.name || '-'}</b></td>
                        <td style={{ color: 'var(--muted)' }}>{(r.examTitle ?? '').split('·')[0].trim() || '-'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{r.score}/{r.total}</td>
                        <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{Math.round(r.passRatio * 100)}%</td>
                        <td style={{ color: 'var(--muted)' }}>{r.nameRoman || <span style={{ color: 'var(--dim)' }}>미입력</span>}</td>
                        <td>{r.certNo ? <b>{r.certNo}</b> : <span className="badge low">미발급</span>}</td>
                        <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{fmtDT(r.certIssuedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
      {!list.length && !loading && <div className="admin-section admin-empty">합격한 응시가 없습니다.</div>}

      <p className="admin-hint" style={{ marginTop: 10, lineHeight: 1.7 }}>
        합격 판정은 <b>응시 시점의 합격선</b>을 씁니다(응시 기록에 박혀 있음). 그래서 나중에 조건을 바꿔도 과거 판정은 흔들리지 않습니다.
        <br />⚠️ 수동 발급은 응시자의 <b>영문 성명</b>이 있어야 합니다 — 자격증에 인쇄되는 이름이라 관리자가 임의로 정할 수 없습니다.
      </p>
    </>
  )
}

// 발급 조건 = **급수 그 자체**를 바꾸는 것. 비기너를 고치면 비기너 전체(모든 회차)에 적용된다.
function CertConditions() {
  const { data, loading, err, reload } = useAdminData<{ tiers: CertTierRow[] }>('certConditions')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [draft, setDraft] = useState<Record<string, { ratio: string; days: string; fee: string }>>({})
  const names = Object.fromEntries(getTracks('ko').flatMap((tr) => tr.tiers.map((ti) => [ti.key, ti.name])))

  const val = (r: CertTierRow) => draft[r.tier] ?? {
    ratio: r.pass_ratio == null ? '' : String(r.pass_ratio),
    days: r.cert_available_after_days == null ? '' : String(r.cert_available_after_days),
    fee: r.cert_fee_override == null ? '' : String(r.cert_fee_override),
  }
  async function save(r: CertTierRow) {
    const v = val(r)
    setBusy(r.tier); setMsg('')
    try {
      await callFunction('admin', { action: 'certConditionsSave', tier: r.tier, passRatio: v.ratio, days: v.days, fee: v.fee })
      setMsg(`✅ ${names[r.tier] ?? r.tier} 저장했습니다`)
      await reload()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '저장 실패')
    } finally { setBusy('') }
  }

  return (
    <>
      <div className="admin-toolbar">
        <span className="admin-hint">급수마다 정합니다 — 고치면 그 급수의 모든 회차에 적용됩니다{loading ? ' · 불러오는 중…' : ''}</span>
        {msg && <span className="admin-msg">{msg}</span>}
        <button className="admin-mini" onClick={reload} disabled={loading}>새로고침</button>
      </div>
      <ErrBox msg={err} />
      <p className="admin-hint" style={{ marginBottom: 12, lineHeight: 1.7 }}>
        비워두면 기본값을 씁니다 — 합격선 60% · 결과 공개 즉시 발급 · 발급비는 그 급수 응시료와 동일.
        <br />⛔ 이미 응시한 사람의 합격 판정은 <b>바뀌지 않습니다</b>(응시 시점 값이 기록에 박혀 있습니다).
        여기서 바꾼 값은 <b>앞으로의 응시</b>부터 적용됩니다.
      </p>
      {(data?.tiers ?? []).map((r) => {
        const v = val(r)
        return (
          <div key={r.tier} className="admin-section">
            <div className="admin-section-head">
              <h3>{names[r.tier] ?? r.tier}</h3>
              <button className="admin-mini" onClick={() => save(r)} disabled={busy === r.tier}>
                {busy === r.tier ? '저장 중…' : '저장'}
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <label style={fld}>합격선
                <input style={inp} placeholder="비워두면 60%" value={v.ratio}
                  onChange={(e) => setDraft({ ...draft, [r.tier]: { ...v, ratio: e.target.value } })} />
                <span style={{ fontWeight: 400, color: 'var(--dim)' }}>0.6 = 60% · 0.55 = 55%</span>
              </label>
              <label style={fld}>발급 가능 시점
                <input style={inp} placeholder="비워두면 결과 공개 즉시" value={v.days}
                  onChange={(e) => setDraft({ ...draft, [r.tier]: { ...v, days: e.target.value } })} />
                <span style={{ fontWeight: 400, color: 'var(--dim)' }}>결과 공개 후 N일</span>
              </label>
              <label style={fld}>발급비
                <input style={inp} placeholder="비워두면 응시료와 동일" value={v.fee}
                  onChange={(e) => setDraft({ ...draft, [r.tier]: { ...v, fee: e.target.value } })} />
                <span style={{ fontWeight: 400, color: 'var(--dim)' }}>원 단위 · 0 이면 무료</span>
              </label>
            </div>
          </div>
        )
      })}
    </>
  )
}

// ══════════════════════════════════════════════════════════════
// Learning Library > 콘텐츠(강의) 관리
// ══════════════════════════════════════════════════════════════
interface LectureRow {
  id: string; catalog: 'leveltest' | 'caris'
  target_level: number | null; target_tier: string | null
  /** ⚠️ channel 은 관리자 화면에서 뺐다(2026-08-25) — DB 컬럼은 남아 있고 옛 값도 그대로다. */
  youtube_id: string; title: string; channel: string; description: string
  /** 정가 — **달러 센트**(100 = $1.00). 이북과 같은 단위다. 0 = 무료. */
  price_usd_cents: number
  /** 목록 썸네일 주소. 비우면 유튜브 썸네일로 폴백한다(그 주소엔 영상 id 가 박혀 있다 — 아래 경고 참고). */
  thumb_url: string | null
  published: boolean; sort_order: number
}
type LectureDraft = Partial<LectureRow> & { _new?: boolean }
const ytThumbUrl = (id: string) => `https://img.youtube.com/vi/${id}/mqdefault.jpg`

export function LecturesAdmin({ catalog }: { catalog: 'leveltest' | 'caris' }) {
  const { data, loading, err, reload } = useAdminData<{ lectures: LectureRow[] }>('lectureList', { catalog })
  const [edit, setEdit] = useState<LectureDraft | null>(null)
  const draft = useDraft({ kind: 'lecture', refId: edit?.id, value: edit, title: edit?.title?.trim() || '새 강의', enabled: !!edit })
  const [busy, setBusy] = useState(false)
  const tiers = getTracks('ko').flatMap((tr) => tr.tiers.map((ti) => ({ key: ti.key, name: ti.name })))
  const rows = data?.lectures ?? []

  async function save() {
    if (!edit) return
    setBusy(true)
    try {
      // ⚠️ 번역 경고는 저장 실패가 아니다 — 한국어로는 등록됐다는 뜻이라 문구도 그렇게 쓴다
      //    (공지·FAQ 와 같은 규칙. '실패'로 띄우면 관리자가 안 올라간 줄 알고 같은 강의를 또 만든다).
      const res = await callFunction<{ translateWarning?: string }>('admin', {
        action: 'lectureUpsert',
        lecture: {
          id: edit._new ? undefined : edit.id,
          catalog,
          targetLevel: catalog === 'leveltest' ? (edit.target_level ?? null) : null,
          targetTier: catalog === 'caris' ? (edit.target_tier ?? null) : null,
          youtubeId: edit.youtube_id ?? '',
          // ⚠️ 채널은 2026-08-25 에 관리자 화면에서 뺐다 — 우리가 만든 강의를 파는 것이라 '어느 채널 영상인가'
          //    가 쓸 정보가 아니다. 넘기지 않으면 서버가 빈 값으로 덮고, 사용자 화면은 비면 그 줄을 안 그린다.
          title: edit.title ?? '', description: edit.description ?? '',
          // ⚠️ 화면 입력은 **달러**, 저장은 센트다(이북과 같은 규칙). 소수 둘째 자리까지 받는다.
          priceUsdCents: Math.max(0, Math.round(Number(edit.price_usd_cents ?? 0)) || 0),
          thumbUrl: edit.thumb_url ?? '',
          published: edit.published !== false, sortOrder: edit.sort_order ?? rows.length,
        },
      })
      if (res?.translateWarning) alert('저장됐지만 자동 번역은 건너뛰었습니다:\n' + res.translateWarning)
      draft.clear()
      setEdit(null)
      await reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : '저장 실패')
    } finally { setBusy(false) }
  }
  async function del(id: string) {
    if (!confirm('이 강의를 삭제할까요?')) return
    try { await callFunction('admin', { action: 'lectureDelete', id }); await reload() }
    catch (e) { alert(e instanceof Error ? e.message : '삭제 실패') }
  }

  const blank: LectureDraft = { _new: true, published: true, sort_order: rows.length, target_level: catalog === 'leveltest' ? 1 : null, price_usd_cents: 0 }
  return (
    <>
      <AdminHead title={`콘텐츠 관리 · ${catalog === 'caris' ? 'CARIS' : 'LEVEL TEST'}`} count={`총 ${rows.length}편`} onReload={reload} loading={loading}>
        <button className="admin-mini" onClick={() => setEdit(blank)}>+ 새 강의</button>
      </AdminHead>
      <ErrBox msg={err} />
      <p className="admin-hint" style={{ marginBottom: 12, lineHeight: 1.7 }}>
        ⚠️ <b>유튜브 링크만</b> 받습니다. 영상 파일을 우리 서버에 올리면 그때부터 영상 트래픽 비용이 전부 우리 몫이 됩니다.<br />
        ⛔ <b>돈을 받는 강의는 반드시 &lsquo;미등록(unlisted)&rsquo; 으로 올리세요.</b> 유튜브 <b>공개</b> 영상은 주소만 알면 누구나 무료로 보기 때문에,
        값을 매겨도 결제가 아무 의미가 없습니다. (미소유자에게 영상 ID 는 내려보내지 않습니다.)<br />
        ⚠️ <b>썸네일을 안 올리면</b> 유튜브 썸네일을 대신 쓰는데, 그 주소에는 <b>영상 ID 가 들어 있어</b> 아직 안 산 사람에게도 노출됩니다.
        유료 강의라면 썸네일을 직접 올려주세요.
      </p>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>썸네일</th><th>제목</th><th>{catalog === 'caris' ? '대상 급수' : '대상 레벨'}</th><th>가격</th><th>상태</th><th></th></tr></thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id}>
                <td><img src={l.thumb_url || ytThumbUrl(l.youtube_id)} alt="" style={{ width: 96, borderRadius: 6, display: 'block' }} /></td>
                <td><b>{l.title}</b></td>
                <td>{catalog === 'caris'
                  ? (l.target_tier ? <span className="badge">{tiers.find((t) => t.key === l.target_tier)?.name ?? l.target_tier}</span> : <span style={{ color: 'var(--dim)' }}>급수 무관</span>)
                  : (l.target_level ? `Lv.${l.target_level}` : <span style={{ color: 'var(--dim)' }}>레벨 무관</span>)}</td>
                {/* 정가는 달러 센트다 — 100 = $1.00. */}
                <td style={{ whiteSpace: 'nowrap' }}>{(l.price_usd_cents ?? 0) > 0 ? `$${((l.price_usd_cents ?? 0) / 100).toFixed(2)}` : <span style={{ color: 'var(--dim)' }}>무료</span>}</td>
                <td>{l.published ? <span className="badge ok">공개</span> : <span className="badge low">비공개</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="admin-mini" onClick={() => setEdit({ ...l })}>수정</button>{' '}
                  <button className="admin-mini" onClick={() => del(l.id)}>삭제</button>
                </td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>등록된 강의가 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {edit && (
        <div className="admin-modal-bg">
        {/* ⚠️ 바깥을 눌러도 닫지 않는다 — 입력하던 내용이 통째로 날아간다(닫기는 ✕·취소 버튼으로). */}
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <button className="admin-modal-x" onClick={() => setEdit(null)}>✕</button>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0 }}>{edit._new ? '새 강의' : '강의 수정'}</h2>
              <DraftBar status={draft.status} savedAt={draft.savedAt} drafts={draft.drafts} onRefresh={draft.refresh} onRestore={(p: LectureDraft) => setEdit(p)} />
            </div>
            <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
              <label style={fld}>유튜브 주소 또는 영상 ID
                <input style={inp} placeholder="https://youtu.be/…" value={edit.youtube_id ?? ''}
                  onChange={(e) => setEdit({ ...edit, youtube_id: e.target.value })} />
              </label>
              <label style={fld}>제목
                <input style={inp} value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
              </label>
              {/* 정가 — 화면은 **달러**, 저장은 센트(이북 폼과 같은 규칙). 0 = 무료(결제창을 안 타고 바로 지급). */}
              <label style={fld}>가격 (달러 · 0 이면 무료)
                <input
                  style={inp}
                  type="number"
                  min={0}
                  step={0.01}
                  value={((edit.price_usd_cents ?? 0) / 100).toString()}
                  onChange={(e) => {
                    const dollars = Number(e.target.value)
                    setEdit({ ...edit, price_usd_cents: Number.isFinite(dollars) ? Math.max(0, Math.round(dollars * 100)) : 0 })
                  }}
                />
              </label>
              {/* ⚠️ 비우면 유튜브 썸네일 폴백 — 그 주소엔 영상 id 가 박혀 있어 미소유자에게 노출된다(위 안내 참고).
                  ⛔ 주소를 손으로 적게 하지 말 것(ImageField 주석과 같은 이유) — 남의 서버 링크가 걸리면
                     그쪽이 내려가는 순간 우리 목록이 깨지고, 원인을 찾기도 어렵다. */}
              <label style={fld}>썸네일 (안 올리면 유튜브 썸네일을 씁니다)
                <ImageField
                  dir="lecture"
                  value={edit.thumb_url ?? ''}
                  onChange={(url) => setEdit({ ...edit, thumb_url: url })}
                  hint="가로 16:9 그림을 권장합니다. 유료 강의는 반드시 올려주세요 — 안 올리면 영상 ID가 노출됩니다."
                />
              </label>
              <label style={fld}>{catalog === 'caris' ? '대상 급수' : '대상 레벨'}
                {catalog === 'caris' ? (
                  <select style={inp} value={edit.target_tier ?? ''} onChange={(e) => setEdit({ ...edit, target_tier: e.target.value || null })}>
                    <option value="">급수 무관</option>
                    {tiers.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                  </select>
                ) : (
                  <select style={inp} value={edit.target_level ?? ''} onChange={(e) => setEdit({ ...edit, target_level: e.target.value ? +e.target.value : null })}>
                    <option value="">레벨 무관</option>
                    {Array.from({ length: MAX_LEVEL }, (_, i) => i + 1).map((l) => <option key={l} value={l}>Lv.{l}</option>)}
                  </select>
                )}
              </label>
              <label style={fld}>소개
                <textarea style={{ ...inp, minHeight: 64 }} value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--fs-sm)' }}>
                <input type="checkbox" checked={edit.published !== false} onChange={(e) => setEdit({ ...edit, published: e.target.checked })} />
                공개
              </label>
              {/* 공지·FAQ 폼과 같은 안내다 — 관리자가 한국어만 쓰고, 버튼은 없다(저장이 곧 번역). */}
              <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
                🌐 제목·소개는 저장하면 <b>영어·일본어·중국어·힌디어·베트남어</b>로 자동 번역됩니다.
                (한국어 원문 기준 · 수정 후 저장하면 다시 번역)
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
              <button className="admin-mini" onClick={() => setEdit(null)}>취소</button>
              <button className="btn-ink" onClick={save} disabled={busy}>{busy ? '저장 중…' : '저장'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ══════════════════════════════════════════════════════════════
// 게시판 관리 > 고객센터 > Q&A (1:1 문의)
// ══════════════════════════════════════════════════════════════
interface InquiryRow {
  id: string; userId: string; name: string | null; email: string | null
  category: string; title: string; body: string; status: string
  answer: string | null; answeredAt: string | null; createdAt: string
}
const INQ_CAT: Record<string, string> = { exam: '응시', payment: '결제', account: '계정', arena: 'WORLD ARENA', etc: '기타' }
const INQ_STATUS: Record<string, string> = { open: '답변 대기', answered: '답변 완료', closed: '종료' }

export function QnaAdmin() {
  const [status, setStatus] = useState('')
  const { data, loading, err, reload } = useAdminData<{ inquiries: InquiryRow[]; total: number }>('inquiryList', { status })
  const [open, setOpen] = useState<InquiryRow | null>(null)
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  // 답변도 길게 쓰다 날아갈 수 있다 — 문의 건별로 초안을 잡는다.
  const draft = useDraft({ kind: 'inquiry-answer', refId: open?.id, value: answer, title: open?.title ?? '문의 답변', enabled: !!open })
  const rows = data?.inquiries ?? []
  const pending = rows.filter((r) => r.status === 'open').length

  async function send() {
    if (!open || !answer.trim()) return
    setBusy(true)
    try {
      await callFunction('admin', { action: 'inquiryAnswer', id: open.id, answer })
      draft.clear()
      setOpen(null); setAnswer('')
      await reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : '저장 실패')
    } finally { setBusy(false) }
  }

  return (
    <>
      <AdminHead title="고객센터 · Q&A" count={`답변 대기 ${pending}건 / 전체 ${data?.total ?? 0}건`} onReload={reload} loading={loading} />
      <ErrBox msg={err} />
      <p className="admin-hint" style={{ marginBottom: 12, lineHeight: 1.7 }}>
        1:1 <b>비공개</b> 문의입니다 — 쓴 사람과 관리자만 봅니다. 여러 사람이 물어보는 내용은 FAQ 로 옮겨 주세요.
      </p>
      <div className="admin-toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">전체</option>
          {Object.entries(INQ_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="admin-hint">{rows.length}건</span>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>등록</th><th>분류</th><th>제목</th><th>작성자</th><th>상태</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{fmtDT(r.createdAt)}</td>
                <td><span className="badge">{INQ_CAT[r.category] ?? r.category}</span></td>
                <td><b>{r.title}</b></td>
                <td><div className="admin-user"><b>{r.name || '-'}</b><span>{r.email || ''}</span></div></td>
                <td>{r.status === 'open' ? <span className="badge low">답변 대기</span> : <span className="badge ok">{INQ_STATUS[r.status]}</span>}</td>
                <td><button className="admin-mini" onClick={() => { setOpen(r); setAnswer(r.answer ?? '') }}>보기</button></td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>문의가 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="admin-modal-bg">
        {/* ⚠️ 바깥을 눌러도 닫지 않는다 — 입력하던 내용이 통째로 날아간다(닫기는 ✕·취소 버튼으로). */}
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <button className="admin-modal-x" onClick={() => setOpen(null)}>✕</button>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0 }}>{open.title}</h2>
              <DraftBar status={draft.status} savedAt={draft.savedAt} drafts={draft.drafts} onRefresh={draft.refresh}
                onRestore={(p: string) => setAnswer(p)} />
            </div>
            <p className="admin-modal-meta">
              {open.name || '-'} · {INQ_CAT[open.category] ?? open.category} · {fmtDT(open.createdAt)}
            </p>
            <div className="admin-section" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.75 }}>{open.body}</div>
            <label style={{ ...fld, marginTop: 8 }}>답변
              <textarea style={{ ...inp, minHeight: 140 }} value={answer} onChange={(e) => setAnswer(e.target.value)} />
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button className="admin-mini" onClick={() => setOpen(null)}>닫기</button>
              <button className="btn-ink" onClick={send} disabled={busy || !answer.trim()}>{busy ? '보내는 중…' : '답변 저장'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ══════════════════════════════════════════════════════════════
// 게시판 관리 > 의견함
// ══════════════════════════════════════════════════════════════
// FAB 패널의 빨간 '의견 보내기'(/feedback)로 들어온 것들.
// ⛔ Q&A(1:1 문의)와 **다른 표**다 — 여기엔 답변 경로가 없다. 관리자가 하는 일은 읽기·엑셀·삭제 셋뿐이다.
//    답변 칸을 붙이고 싶어지면 그건 Q&A 로 옮길 일이다(의견을 쓴 사람은 계정이 없을 수도 있어 보낼 곳이 없다).
interface FeedbackRow {
  id: string
  org: string
  name: string
  path: string
  body: string
  /** 로그인 상태로 썼을 때의 계정 이름. 본인이 적은 name 과 다를 수 있어 **덮어쓰지 않고 따로** 보여준다. */
  account: string | null
  /** 첨부. 여는 URL 은 **누를 때** 따로 받는다(서명 URL 이라 목록에 실어두면 눌렀을 때 이미 만료다). */
  files: { path: string; name: string; size: number }[]
  createdAt: string
}

function fbSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`
  return `${Math.max(1, Math.round(n / 1024))}KB`
}

/** 엑셀 파일명에 못 쓰는 글자를 턴다(문항 내보내기와 같은 규칙). */
function fbFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_')
}

function exportFeedbackXlsx(rows: FeedbackRow[]) {
  // ⚠️ 첨부는 **이름만** 담는다 — 링크를 적어도 서명 URL 은 10분이면 죽어서 파일 안에서는
  //    쓸모가 없다. 파일을 봐야 하면 관리자 화면에서 연다.
  const header = ['등록일시', '소속', '이름', '경로', '내용', '계정', '첨부']
  const body = rows.map((r) => [
    fmtDT(r.createdAt), r.org, r.name, r.path, r.body, r.account ?? '',
    (r.files ?? []).map((f) => f.name).join(', '),
  ])
  const ws = XLSX.utils.aoa_to_sheet([header, ...body])
  // 기본 폭이면 '내용' 칸이 한 글자 폭으로 서서 파일을 열자마자 손으로 늘려야 한다.
  ws['!cols'] = [{ wch: 18 }, { wch: 18 }, { wch: 10 }, { wch: 26 }, { wch: 70 }, { wch: 14 }, { wch: 28 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '의견')
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(/-/g, '')
  XLSX.writeFile(wb, fbFileName(`의견함_${day}.xlsx`))
}

export function FeedbackAdmin() {
  // 검색어는 입력할 때마다 서버를 부르지 않는다 — 엔터/버튼으로 확정한 값(q)만 조회에 쓴다.
  const [draftQ, setDraftQ] = useState('')
  const [q, setQ] = useState('')
  const { data, loading, err, reload } = useAdminData<{ feedbacks: FeedbackRow[]; total: number; limit: number }>('feedbackList', { q })
  const [open, setOpen] = useState<FeedbackRow | null>(null)
  const rows = data?.feedbacks ?? []
  const total = data?.total ?? rows.length
  // ⚠️ 잘림을 반드시 말한다 — 엑셀이 이 목록을 그대로 쓰기 때문에, 조용히 자르면
  //    "전부 받았다" 고 믿고 일부만 든 파일이 나간다.
  const truncated = !!data && total > rows.length

  /** 첨부 열기.
   *  ⚠️ 빈 탭을 **먼저** 연다 — await 뒤에 window.open 을 부르면 사용자 클릭과 끊겨 팝업 차단에 걸린다. */
  async function openFile(path: string) {
    const w = window.open('', '_blank')
    try {
      const { url } = await callFunction<{ url: string }>('admin', { action: 'feedbackFileUrl', path })
      // 팝업이 막혔으면 이 탭에서 연다(빈손으로 두지 않는다).
      if (w) w.location.href = url
      else window.location.assign(url)
    } catch (e) {
      w?.close()
      alert(e instanceof Error ? e.message : '첨부를 열지 못했습니다.')
    }
  }

  async function remove(r: FeedbackRow) {
    if (!confirm(`${r.name}(${r.org}) 님의 의견을 지웁니다. 되돌릴 수 없습니다.`)) return
    try {
      await callFunction('admin', { action: 'feedbackDelete', id: r.id })
      setOpen(null)
      await reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : '삭제 실패')
    }
  }

  return (
    <>
      <AdminHead title="게시판 관리 · 의견함" count={`전체 ${total}건`} onReload={reload} loading={loading}>
        <button className="admin-mini" onClick={() => exportFeedbackXlsx(rows)} disabled={!rows.length}>
          엑셀 내려받기
        </button>
      </AdminHead>
      <ErrBox msg={err} />
      <p className="admin-hint" style={{ marginBottom: 12, lineHeight: 1.7 }}>
        화면 왼쪽 아래 <b>CARIS 버튼 → 의견 보내기</b> 로 들어온 의견입니다. <b>답변 기능이 없습니다</b> —
        회신이 필요한 문의는 <b>고객센터 · Q&amp;A</b> 로 옵니다. 로그인하지 않은 사람도 쓸 수 있어
        소속·이름은 <b>본인이 적은 값</b>입니다.
      </p>
      <div className="admin-toolbar">
        <input
          style={{ ...inp, maxWidth: 260 }}
          placeholder="소속·이름·경로·내용 검색"
          value={draftQ}
          onChange={(e) => setDraftQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') setQ(draftQ.trim()) }}
        />
        <button className="admin-mini" onClick={() => setQ(draftQ.trim())}>검색</button>
        {q ? <button className="admin-mini" onClick={() => { setDraftQ(''); setQ('') }}>초기화</button> : null}
        <span className="admin-hint">{rows.length}건 표시</span>
      </div>
      {truncated ? (
        <div className="admin-section admin-empty">
          최근 {rows.length}건만 불러왔습니다(전체 {total}건). 엑셀도 이 {rows.length}건만 담깁니다 — 검색으로 좁혀 주세요.
        </div>
      ) : null}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>등록</th><th>소속</th><th>이름</th><th>경로</th><th>내용</th><th>첨부</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{fmtDT(r.createdAt)}</td>
                <td>{r.org}</td>
                <td>
                  {r.name}
                  {/* 계정 이름이 적어낸 이름과 다를 때만 덧붙인다 — 같으면 같은 말을 두 번 쓰는 것이다. */}
                  {r.account && r.account !== r.name
                    ? <span className="admin-hint" style={{ marginLeft: 6 }}>({r.account})</span>
                    : null}
                </td>
                <td>{r.path}</td>
                {/* 목록에서는 한 줄만 — 내용이 길어 그대로 두면 표가 아니라 문서가 된다. 전문은 모달. */}
                <td style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.body}</td>
                {/* 목록에서는 개수만 — 파일은 모달에서 연다. 없으면 빈칸이라 붙은 건만 눈에 띈다. */}
                <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>
                  {r.files?.length ? `📎 ${r.files.length}` : ''}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="admin-mini" onClick={() => setOpen(r)}>보기</button>
                </td>
              </tr>
            ))}
            {!loading && !rows.length ? (
              <tr><td colSpan={7} className="admin-empty">{q ? '검색 결과가 없습니다.' : '아직 들어온 의견이 없습니다.'}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {open ? (
        <div className="admin-modal-bg">
          {/* 읽기 전용 모달이라 바깥 클릭으로 닫아도 잃을 게 없다(Q&A 는 답변을 쓰던 중이라 안 닫는다). */}
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <button className="admin-modal-x" onClick={() => setOpen(null)}>✕</button>
            <h2 style={{ margin: 0 }}>{open.org} · {open.name}</h2>
            <p className="admin-modal-meta">
              {fmtDT(open.createdAt)} · 경로 <b>{open.path}</b>
              {open.account ? <> · 계정 <b>{open.account}</b></> : <> · 비로그인</>}
            </p>
            {/* 줄바꿈을 살린다 — 의견은 문단으로 적는 글이라 한 줄로 접으면 읽는 순서가 무너진다. */}
            <div className="admin-section" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.75 }}>{open.body}</div>
            {open.files?.length ? (
              /* 첨부는 비공개 버킷이라 누를 때마다 10분짜리 서명 URL 을 새로 받는다 —
                 그래서 <a href> 가 아니라 버튼이다. */
              <div className="admin-section" style={{ marginTop: 10 }}>
                <div className="admin-hint" style={{ marginBottom: 6 }}>첨부 {open.files.length}개</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {open.files.map((f) => (
                    <button key={f.path} className="admin-mini" onClick={() => openFile(f.path)}>
                      📎 {f.name} <span style={{ color: 'var(--muted)' }}>({fbSize(f.size)})</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button className="admin-mini danger" onClick={() => remove(open)}>삭제</button>
              <button className="admin-mini" onClick={() => setOpen(null)}>닫기</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

// ══════════════════════════════════════════════════════════════
// 게시판 관리 > 협회소개 · 개인정보처리방침 · 이용약관
// ══════════════════════════════════════════════════════════════
interface PolicyRow { id: string; doc: string; version: number; body: string; change_note: string; effective_at: string; created_at: string }
const POLICY_TITLE: Record<string, string> = { terms: '이용약관', privacy: '개인정보처리방침', about: '협회소개' }

/**
 * 지금 사이트에 떠 있는 문서를 글로 펼친다.
 * ⚠️ 이게 없으면 관리자 화면이 **빈 칸**으로 열려 "새로 쓰라"는 화면이 된다 —
 *    실제로는 이미 게시 중인 문서를 **고치는** 일이라 현재 내용이 먼저 들어와 있어야 한다.
 *    (약관·방침은 지금 코드에 박혀 있어 DB 에 아직 아무 판도 없다.)
 */
async function currentDocText(doc: 'terms' | 'privacy' | 'about'): Promise<string> {
  if (doc === 'terms') {
    const { ARTICLES } = await import('./Terms')
    return ARTICLES.map((a) => [a.title, a.lead ?? '', ...(a.items ?? [])].filter(Boolean).join('\n')).join('\n\n')
  }
  if (doc === 'privacy') {
    const { ARTICLES } = await import('./Privacy')
    return ARTICLES.map((a) => {
      const items = (a.items ?? []).map((it) =>
        typeof it === 'string' ? it : [it.text, ...it.sub.map((s) => `  - ${s}`)].join('\n'))
      return [a.title, a.lead ?? '', ...items].filter(Boolean).join('\n')
    }).join('\n\n')
  }
  return '' // 협회소개는 문구가 다국어 사전(i18n)에 있어 여기서 펼치지 않는다.
}

export function PolicyAdmin({ doc }: { doc: 'terms' | 'privacy' | 'about' }) {
  const { data, loading, err, reload } = useAdminData<{ docs: PolicyRow[] }>('policyList', { doc })
  const [body, setBody] = useState('')
  const [note, setNote] = useState('')
  const [effective, setEffective] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [seeded, setSeeded] = useState(false)
  const docs = data?.docs ?? []
  const latest = docs[0]

  // 임시저장 — 본문이 제일 긴 화면이라 여기가 제일 급하다(수천 자를 날리면 되돌릴 방법이 없다).
  const draft = useDraft({
    kind: `policy:${doc}`,
    value: { body, note, effective },
    title: POLICY_TITLE[doc],
    enabled: !loading,
  })

  // 편집 시작점 = 마지막 판. 아직 한 판도 없으면 **지금 사이트에 떠 있는 내용**을 깔아준다.
  useEffect(() => {
    if (loading || seeded) return
    setSeeded(true)
    if (latest) { setBody(latest.body); return }
    currentDocText(doc).then((t) => { if (t) setBody(t) })
  }, [loading, seeded, latest, doc])

  async function publish() {
    setBusy(true); setMsg('')
    try {
      const r = await callFunction<{ version: number }>('admin', {
        action: 'policyUpsert', doc, body, changeNote: note, effectiveAt: effective,
      })
      setMsg(`✅ 제${r.version}판으로 저장했습니다`)
      setNote('')
      draft.clear() // 저장됐으니 초안은 더 필요 없다
      await reload()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '저장 실패')
    } finally { setBusy(false) }
  }

  return (
    <>
      <AdminHead
        title={POLICY_TITLE[doc]}
        count={latest ? `현재 제${latest.version}판 · 시행 ${latest.effective_at}` : '지금 게시 중인 내용(코드) · 아직 개정판 없음'}
        onReload={reload}
        loading={loading}
      >
        <DraftBar
          status={draft.status}
          savedAt={draft.savedAt}
          drafts={draft.drafts}
          onRefresh={draft.refresh}
          onRestore={(p: { body: string; note: string; effective: string }) => {
            setBody(p.body ?? '')
            setNote(p.note ?? '')
            setEffective(p.effective ?? '')
          }}
        />
      </AdminHead>
      <ErrBox msg={err} />
      <p className="admin-hint" style={{ marginBottom: 12, lineHeight: 1.7 }}>
        지금 사이트에 올라와 있는 본문입니다. 고치고 저장하면 바로 반영되고, 이전 내용은 아래 이력에 남습니다.
      </p>

      <div className="admin-section">
        <div style={{ display: 'grid', gap: 12 }}>
          <textarea
            style={{ ...inp, minHeight: 460, fontFamily: 'inherit', lineHeight: 1.8, fontSize: 'var(--fs-md)' }}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {/* 메모·시행일은 선택이다 — 저장할 때마다 날짜를 고르게 하면 글 고치는 흐름이 끊긴다. */}
            <input style={{ ...inp, maxWidth: 320 }} placeholder="무엇을 고쳤는지 (선택)" value={note} onChange={(e) => setNote(e.target.value)} />
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>
              시행일
              <input style={{ ...inp, width: 160 }} type="date" value={effective} onChange={(e) => setEffective(e.target.value)} />
            </label>
            {msg && <span className="admin-msg">{msg}</span>}
            <button className="btn-ink" onClick={publish} disabled={busy || !body.trim()}>
              {busy ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
      </div>

      <div className="admin-section">
        <h3>수정 이력 <span className="admin-hint">{docs.length}건</span></h3>
        <table className="admin-table">
          <thead><tr><th>판</th><th>시행일</th><th>메모</th><th>저장</th><th></th></tr></thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td><b>제{d.version}판</b></td>
                <td style={{ whiteSpace: 'nowrap' }}>{d.effective_at}</td>
                <td style={{ color: 'var(--muted)' }}>{d.change_note || '-'}</td>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{fmtDT(d.created_at)}</td>
                <td><button className="admin-mini" onClick={() => setBody(d.body)}>이 내용으로 되돌리기</button></td>
              </tr>
            ))}
            {!docs.length && !loading && <tr><td colSpan={5} className="admin-empty">아직 저장한 적이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ══════════════════════════════════════════════════════════════
// CARIS 현황 > 시험환경 점검 — 미점검자 골라서 독려 메일
//   ⚠️ 메일 기능은 사이트 정보가 아니라 **여기** 있어야 한다. 보낼 대상이 이 화면에 있기 때문이다
//      (사이트 정보에 두면 "누구에게 보낼지" 를 고를 방법이 없다).
// ══════════════════════════════════════════════════════════════
interface EnvPerson {
  ticketId: string; userId: string; name: string | null; email: string | null
  roundId: string; roundTitle: string; examDate: string | null; tier: string
  ticketStatus: string; checked: boolean
}
interface EnvCheckResp { rounds: { id: string; title: string; examDate: string | null }[]; people: EnvPerson[] }

export function EnvCheckAdmin() {
  const [roundId, setRoundId] = useState('')
  const [onlyPending, setOnlyPending] = useState(true)
  const { data, loading, err, reload } = useAdminData<EnvCheckResp>('envCheckList', { roundId })
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [compose, setCompose] = useState(false)
  const tierNames = Object.fromEntries(getTracks('ko').flatMap((tr) => tr.tiers.map((ti) => [ti.key, ti.name])))

  const people = (data?.people ?? []).filter((p) => !onlyPending || !p.checked)
  // 시험(회차 × 급수)으로 묶는다 — 한 표에 다 펴놓으면 누구에게 보낼지 고를 수가 없다.
  const groups = new Map<string, EnvPerson[]>()
  for (const p of people) {
    const k = `${p.roundTitle} · ${tierNames[p.tier] ?? p.tier}`
    ;(groups.get(k) ?? groups.set(k, []).get(k)!).push(p)
  }

  const toggle = (id: string) => setPicked((s) => {
    const n = new Set(s)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })
  const toggleGroup = (items: EnvPerson[]) => setPicked((s) => {
    const n = new Set(s)
    const allOn = items.every((p) => n.has(p.ticketId))
    for (const p of items) allOn ? n.delete(p.ticketId) : n.add(p.ticketId)
    return n
  })
  const pickedPeople = (data?.people ?? []).filter((p) => picked.has(p.ticketId))
  const total = data?.people.length ?? 0
  const done = (data?.people ?? []).filter((p) => p.checked).length

  return (
    <>
      <div className="admin-toolbar">
        <select value={roundId} onChange={(e) => { setRoundId(e.target.value); setPicked(new Set()) }}>
          <option value="">전체 회차</option>
          {(data?.rounds ?? []).map((r) => <option key={r.id} value={r.id}>{r.title}{r.examDate ? ` (${r.examDate})` : ''}</option>)}
        </select>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--fs-sm)' }}>
          <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} />
          점검 안 한 사람만
        </label>
        <span className="admin-hint">응시권 {total}장 · 점검 완료 {done} · 미점검 {total - done}{loading ? ' · 불러오는 중…' : ''}</span>
        <button className="admin-mini" onClick={reload} disabled={loading}>새로고침</button>
        <button className="btn-ink" onClick={() => setCompose(true)} disabled={!picked.size}>
          {picked.size ? `${picked.size}명에게 메일 보내기` : '메일 보내기'}
        </button>
      </div>
      <ErrBox msg={err} />

      {[...groups.entries()].map(([k, items]) => {
        const allOn = items.every((p) => picked.has(p.ticketId))
        return (
          <div key={k} className="admin-section">
            <div className="admin-section-head">
              <h3>{k} <span className="admin-hint">{items.length}명</span></h3>
              <button className="admin-mini" onClick={() => toggleGroup(items)}>{allOn ? '전체 해제' : '전체 선택'}</button>
            </div>
            <table className="admin-table">
              <thead><tr><th style={{ width: 44 }} /><th>이름</th><th>이메일</th><th>시험일</th><th>환경 점검</th></tr></thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.ticketId}>
                    <td><input type="checkbox" checked={picked.has(p.ticketId)} onChange={() => toggle(p.ticketId)} /></td>
                    <td><b>{p.name || '-'}</b></td>
                    <td style={{ color: p.email ? 'var(--muted)' : 'var(--dim)' }}>{p.email || '이메일 없음 — 보낼 수 없음'}</td>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{p.examDate ?? '-'}</td>
                    <td>{p.checked ? <span className="badge ok">완료</span> : <span className="badge low">안 함</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
      {!groups.size && !loading && (
        <div className="admin-section admin-empty">
          {onlyPending ? '점검을 안 한 사람이 없습니다.' : '응시권을 가진 사람이 없습니다.'}
        </div>
      )}

      {compose && <MailComposeModal targets={pickedPeople} roundId={roundId} onClose={() => setCompose(false)} />}
    </>
  )
}

// 메일 작성 — 사이트 정보에 저장해둔 제목·본문을 불러와 고칠 수 있게 하고, 고른 사람 전체에게 한 번에 보낸다.
function MailComposeModal({ targets, roundId, onClose }: { targets: EnvPerson[]; roundId: string; onClose: () => void }) {
  const { data } = useAdminData<{ settings: Record<string, string> }>('siteSettings')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [seeded, setSeeded] = useState(false)
  const draft = useDraft({ kind: 'mail-nudge', value: { subject, body }, title: subject || '독려 메일' })
  useEffect(() => {
    if (!data || seeded) return
    setSeeded(true)
    setSubject(data.settings.mail_nudge_subject ?? '')
    setBody(data.settings.mail_nudge_body ?? '')
  }, [data, seeded])

  const sendable = targets.filter((t) => t.email && t.email.includes('@'))
  const first = targets[0]
  const sample: Record<string, string> = {
    '{name}': first?.name ?? '홍길동',
    '{round}': first?.roundTitle ?? '제 5회 CARIS',
    '{tier}': first?.tier ?? 'beginner',
    '{examDate}': first?.examDate ?? '2026-11-28',
    '{link}': `${location.origin}/exam`,
  }
  const fill = (s: string) => Object.entries(sample).reduce((acc, [k, v]) => acc.split(k).join(v), s ?? '')

  async function send() {
    setBusy(true); setMsg('')
    try {
      const r = await callFunction<{ sent: boolean; queued: number; skipped: number }>('admin', {
        action: 'mailNudge', roundId: roundId || null, subject, body,
        targets: targets.map((t) => ({ userId: t.userId, email: t.email })),
      })
      setMsg(r.sent
        ? `✅ ${r.queued}명에게 보냈습니다`
        : `내용과 대상 ${r.queued}명을 기록했습니다 — 발송 서비스가 아직 안 붙어 실제로 나가진 않았습니다`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '실패')
    } finally { setBusy(false) }
  }

  return (
    <div className="admin-modal-bg">
    {/* ⚠️ 바깥을 눌러도 닫지 않는다 — 입력하던 내용이 통째로 날아간다(닫기는 ✕·취소 버튼으로). */}
      <div className="admin-modal admin-modal-wide" onClick={(e) => e.stopPropagation()}>
        <button className="admin-modal-x" onClick={onClose}>✕</button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>독려 메일 보내기</h2>
          <DraftBar status={draft.status} savedAt={draft.savedAt} drafts={draft.drafts} onRefresh={draft.refresh}
            onRestore={(p: { subject: string; body: string }) => { setSubject(p.subject); setBody(p.body) }} />
        </div>
        <p className="admin-modal-meta">
          받는 사람 {sendable.length}명
          {targets.length - sendable.length > 0 && ` · 이메일이 없어 제외 ${targets.length - sendable.length}명`}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px,1fr) minmax(300px,1fr)', gap: 18, alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 12 }}>
            <label style={fld}>제목
              <input style={inp} value={subject} onChange={(e) => setSubject(e.target.value)} />
            </label>
            <label style={fld}>본문
              <textarea style={{ ...inp, minHeight: 220, fontFamily: 'inherit', lineHeight: 1.7 }} value={body} onChange={(e) => setBody(e.target.value)} />
            </label>
            <p className="admin-hint" style={{ margin: 0, lineHeight: 1.7 }}>
              치환자: {MAIL_VARS.map(([k, d]) => `${k} ${d}`).join(' · ')} — 사람마다 값이 채워집니다.
            </p>
          </div>
          <div style={{ border: '1px solid var(--line2)', borderRadius: 10, padding: 14, background: 'var(--soft)' }}>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', marginBottom: 8 }}>
              미리보기 {first?.name ? `— ${first.name}님이 받는 모습` : ''}
            </div>
            <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>{fill(subject) || '(제목 없음)'}</div>
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.8, color: 'var(--muted)' }}>{fill(body) || '(본문 없음)'}</div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'flex-end', marginTop: 16 }}>
          {msg && <span className="admin-msg">{msg}</span>}
          <button className="admin-mini" onClick={onClose}>닫기</button>
          <button className="btn-ink" onClick={send} disabled={busy || !sendable.length || !subject.trim()}>
            {busy ? '처리 중…' : `${sendable.length}명에게 보내기`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// 홈페이지 관리 > 사이트 정보
// ══════════════════════════════════════════════════════════════
// ⚠️ 라벨만 있으면 "사이트 설명이 어디 나오는 건데?" 가 된다 — **어디에 보이는지**를 항목마다 적는다.
//    `where` = 그 값이 실제로 나타나는 자리. 화면 오른쪽 미리보기가 같은 자리를 그림으로 보여준다.
type SiteField = { key: string; label: string; where: string; multiline?: boolean; image?: boolean }
const SITE_GROUPS: { title: string; note?: string; preview: 'browser' | 'footer' | 'mail' | 'none'; keys: SiteField[] }[] = [
  {
    title: '기본 — 브라우저 탭·검색 결과',
    preview: 'browser',
    keys: [
      { key: 'site_name', label: '사이트 이름', where: '브라우저 탭에 뜨는 글자 · 즐겨찾기 이름' },
      { key: 'site_desc', label: '사이트 설명', where: '구글 검색 결과에서 제목 아래 나오는 두 줄' },
      // ⚠️ 주소를 손으로 적게 하면 그 사람 컴퓨터의 파일을 가리키게 되거나 남의 서버에 의존하게 된다 → 업로드.
      { key: 'logo_url', label: '로고 이미지', where: '푸터 왼쪽 로고', image: true },
      { key: 'favicon_url', label: '파비콘', where: '브라우저 탭 왼쪽의 작은 아이콘', image: true },
    ],
  },
  {
    title: '사업자 정보 — 모든 페이지 맨 아래(푸터)',
    note: '결제를 받는 사이트는 전자상거래법상 아래 항목을 표기해야 합니다. 토스 실계약 심사에서도 봅니다.',
    preview: 'footer',
    keys: [
      { key: 'company_name', label: '상호', where: '푸터 첫 줄' },
      { key: 'company_ceo', label: '대표자', where: '푸터 첫 줄' },
      { key: 'company_reg_no', label: '사업자등록번호', where: '푸터 둘째 줄' },
      { key: 'company_sales_no', label: '통신판매업 신고번호', where: '푸터 둘째 줄' },
      { key: 'company_addr', label: '주소', where: '푸터 셋째 줄' },
      { key: 'company_tel', label: '대표 전화', where: '푸터 셋째 줄 · 문의 안내' },
      { key: 'company_email', label: '대표 이메일', where: '푸터 셋째 줄 · 문의 안내' },
      { key: 'privacy_officer', label: '개인정보보호책임자', where: '푸터 넷째 줄 · 개인정보처리방침' },
    ],
  },
  // ⚠️ 메일은 여기 없다 — 발신자·제목·본문 모두 `CARIS 현황 > 시험환경 점검` 의 메일 작성창에 있다.
  //    보낼 대상을 고르는 화면과 보낼 내용을 쓰는 화면이 갈라져 있으면 둘 다 안 쓰게 된다.
  {
    title: '운영 값',
    note: '지금까지 코드에 박혀 있어 바꾸려면 배포가 필요했던 값들입니다.',
    preview: 'none',
    keys: [
      { key: 'leveltest_per_day', label: '레벨테스트 하루 응시 횟수', where: '레벨테스트 시작 화면 · 남은 횟수' },
      { key: 'leveltest_promote_bonus', label: '승급 시 추가 응시 횟수', where: '승급하면 그날 응시 횟수가 늘어남' },
      { key: 'result_release_days', label: 'CARIS 결과 공개(응시 후 N일)', where: '응시 안내 화면 · 결과 화면' },
    ],
  },
]

/**
 * 이미지 입력 — 파일을 골라 올린다.
 * ⚠️ 주소를 손으로 적게 하면 안 된다. 관리자가 자기 PC 경로를 넣거나(그 사람만 보임) 남의 서버 링크를
 *    걸게 되고(내려가면 우리 화면이 깨짐), 둘 다 나중에 원인을 찾기 어렵다.
 * 저장 위치는 이북 표지와 같은 **공개 버킷**이다(로고·파비콘은 로그인 없이 보여야 한다).
 */
function ImageField({ value, onChange, hint, dir = 'site' }: { value: string; onChange: (url: string) => void; hint?: string; dir?: string }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function pick(file: File | null) {
    if (!file) return
    if (!file.type.startsWith('image/')) { setErr('이미지 파일만 올릴 수 있습니다.'); return }
    if (file.size > 2 * 1024 * 1024) { setErr('2MB 이하로 올려주세요.'); return }
    setBusy(true); setErr('')
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase()
      // dir 로 용도를 가른다(site=로고·파비콘 / lecture=강의 썸네일) — 한 폴더에 섞으면 나중에
      // 어느 그림이 어디 쓰이는지 못 가려서 지우지도 못한다.
      const path = `${dir}/${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('ebook-covers').upload(path, file, { upsert: true, contentType: file.type })
      if (error) throw error
      const { data } = supabase.storage.from('ebook-covers').getPublicUrl(path)
      onChange(data.publicUrl)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '업로드 실패')
    } finally { setBusy(false) }
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <div style={{ width: 48, height: 48, borderRadius: 8, border: '1px solid var(--line2)', background: 'var(--soft)', display: 'grid', placeItems: 'center', overflow: 'hidden', flex: 'none' }}>
          {value ? <img src={value} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 11, color: 'var(--dim)' }}>없음</span>}
        </div>
        <label className="admin-mini" style={{ cursor: busy ? 'default' : 'pointer' }}>
          {busy ? '올리는 중…' : value ? '다른 파일로 바꾸기' : '파일 올리기'}
          <input type="file" accept="image/*" style={{ display: 'none' }} disabled={busy}
            onChange={(e) => { pick(e.target.files?.[0] ?? null); e.target.value = '' }} />
        </label>
        {value && <button className="admin-mini" onClick={() => onChange('')}>지우기</button>}
      </div>
      {err && <span style={{ color: 'var(--k-amber, #d98a00)', fontWeight: 400 }}>{err}</span>}
      {hint && <span style={{ fontWeight: 400, color: 'var(--dim)' }}>{hint}</span>}
    </div>
  )
}

// 치환자 — 메일 본문에 쓰면 사람마다 값이 채워진다. 목록을 화면에 보여줘야 관리자가 쓸 수 있다.
const MAIL_VARS: [string, string][] = [
  ['{name}', '응시자 이름'], ['{round}', '회차명'], ['{tier}', '급수'],
  ['{examDate}', '시험일'], ['{link}', '응시 안내 주소'],
]

/** 입력한 값이 실제로 어떻게 보이는지 — 글로만 적어두면 감이 안 온다. */
function SitePreview({ kind, v }: { kind: 'browser' | 'footer' | 'mail'; v: Record<string, string> }) {
  const box: CSSProperties = { border: '1px solid var(--line2)', borderRadius: 10, padding: 14, background: 'var(--soft)' }
  if (kind === 'browser') {
    return (
      <div style={box}>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', marginBottom: 8 }}>브라우저 탭</div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--bg)', border: '1px solid var(--line2)', borderRadius: '8px 8px 0 0', padding: '8px 14px', maxWidth: '100%' }}>
          {v.favicon_url
            ? <img src={v.favicon_url} alt="" style={{ width: 16, height: 16, borderRadius: 3 }} />
            : <span style={{ width: 16, height: 16, borderRadius: 3, background: 'var(--line2)', display: 'inline-block' }} />}
          <span style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.site_name || '(사이트 이름 없음)'}</span>
        </div>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', margin: '16px 0 8px' }}>구글 검색 결과</div>
        <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 12 }}>
          <div style={{ color: '#7aa7ff', fontSize: 17 }}>{v.site_name || '(사이트 이름 없음)'}</div>
          <div style={{ color: 'var(--dim)', fontSize: 12, margin: '2px 0 4px' }}>https://gara-cbt.airobotassn.workers.dev</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
            {v.site_desc || '(사이트 설명이 비어 있어 검색 결과에 아무 소개도 안 나옵니다)'}
          </div>
        </div>
      </div>
    )
  }
  if (kind === 'footer') {
    const line = (...xs: (string | undefined)[]) => xs.filter((x) => x && x.trim()).join(' · ')
    const l1 = line(v.company_name && `상호 ${v.company_name}`, v.company_ceo && `대표 ${v.company_ceo}`)
    const l2 = line(v.company_reg_no && `사업자등록번호 ${v.company_reg_no}`, v.company_sales_no && `통신판매업신고 ${v.company_sales_no}`)
    const l3 = line(v.company_addr, v.company_tel, v.company_email)
    const l4 = line(v.privacy_officer && `개인정보보호책임자 ${v.privacy_officer}`)
    const any = l1 || l2 || l3 || l4
    return (
      <div style={box}>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', marginBottom: 8 }}>모든 페이지 맨 아래</div>
        <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 14, fontSize: 13, color: 'var(--muted)', lineHeight: 1.9 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--line2)', display: 'inline-block' }} />
            <b style={{ color: 'var(--ink)' }}>CARIS</b>
          </div>
          {any ? <>{[l1, l2, l3, l4].filter(Boolean).map((l, i) => <div key={i}>{l}</div>)}</>
            : <div style={{ color: 'var(--dim)' }}>(아직 아무것도 안 채워서 푸터에 사업자 정보가 나오지 않습니다)</div>}
        </div>
      </div>
    )
  }
  // 메일 — 치환자가 실제 값으로 바뀐 모습까지 보여준다.
  const sample: Record<string, string> = {
    '{name}': '홍길동', '{round}': '제 5회 CARIS', '{tier}': 'Beginner',
    '{examDate}': '2026-11-28', '{link}': 'https://gara-cbt.airobotassn.workers.dev/exam',
  }
  const fill = (s: string) => Object.entries(sample).reduce((acc, [k, val]) => acc.split(k).join(val), s ?? '')
  return (
    <div style={box}>
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', marginBottom: 8 }}>받는 사람에게 이렇게 갑니다</div>
      <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 14 }}>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          보낸사람 <b style={{ color: 'var(--ink)' }}>{v.sender_name || '(이름 없음)'}</b> &lt;{v.sender_email || '(주소 없음)'}&gt;
        </div>
        <div style={{ fontWeight: 700, margin: '8px 0 10px' }}>{fill(v.mail_nudge_subject) || '(제목 없음)'}</div>
        <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.8, color: 'var(--muted)' }}>
          {fill(v.mail_nudge_body) || '(본문 없음 — 이대로면 빈 메일이 나갑니다)'}
        </div>
      </div>
      <p className="admin-hint" style={{ margin: '10px 0 0', lineHeight: 1.7 }}>
        본문에 쓸 수 있는 치환자: {MAIL_VARS.map(([k, d]) => `${k} ${d}`).join(' · ')}
      </p>
    </div>
  )
}

export function SiteInfoAdmin() {
  const { data, loading, err, reload } = useAdminData<{ settings: Record<string, string> }>('siteSettings')
  const [form, setForm] = useState<Record<string, string> | null>(null)
  const draft = useDraft({ kind: 'site-settings', value: form, title: '사이트 정보', enabled: !!form })
  const [msg, setMsg] = useState('')
  useEffect(() => { if (data) setForm(data.settings) }, [data])

  // 이 화면은 **지금 쓰이고 있는 값을 고치는** 곳이다(새로 만드는 곳이 아니다).
  //   그래서 ① 저장된 값이 먼저 칸에 들어가 있고 ② 바꾼 칸만 표시하고 ③ 아직 안 채운 칸을 세어 알려준다.
  const saved = data?.settings ?? {}
  const dirty = form ? Object.keys(form).filter((k) => (form[k] ?? '') !== (saved[k] ?? '')) : []
  const allKeys = SITE_GROUPS.flatMap((g) => g.keys.map((f) => f.key))
  const empty = allKeys.filter((k) => !(form?.[k] ?? '').trim())

  // ⚠️ 저장은 **블록마다** 따로다. 맨 위에 하나만 두면 한참 스크롤한 뒤 저장하러 다시 올라가야 하고,
  //    어디까지가 이번에 저장되는 범위인지도 안 보인다.
  const [savingKey, setSavingKey] = useState('')
  async function saveKeys(keys: string[], groupName: string) {
    if (!form) return
    const changed = keys.filter((k) => dirty.includes(k))
    if (!changed.length) return
    setSavingKey(groupName); setMsg('')
    try {
      // 바뀐 것만 보낸다 — 다른 블록이나 화면에 없는 키를 통째로 덮어쓰지 않기 위해서다.
      const patch: Record<string, string> = {}
      for (const k of changed) patch[k] = form[k]
      await callFunction('admin', { action: 'siteSettingsSave', settings: patch })
      setMsg(`✅ ${groupName} 저장했습니다`)
      draft.clear()
      await reload()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '저장 실패')
    } finally { setSavingKey('') }
  }
  const SaveBtn = ({ keys, name }: { keys: string[]; name: string }) => {
    const n = keys.filter((k) => dirty.includes(k)).length
    return (
      <button className="btn-ink" onClick={() => saveKeys(keys, name)} disabled={!form || !n || !!savingKey}>
        {savingKey === name ? '저장 중…' : n ? `변경한 ${n}개 저장` : '변경 없음'}
      </button>
    )
  }

  const locked = form?.exam_start_locked === '1'
  return (
    <>
      <AdminHead
        title="사이트 정보"
        count={loading ? '' : empty.length ? `아직 안 채운 항목 ${empty.length}개` : '모두 채워져 있습니다'}
        onReload={reload}
        loading={loading}
      >
        {msg && <span className="admin-msg">{msg}</span>}
        <DraftBar status={draft.status} savedAt={draft.savedAt} drafts={draft.drafts} onRefresh={draft.refresh}
          onRestore={(p: Record<string, string>) => setForm(p)} />
      </AdminHead>
      <ErrBox msg={err} />
      <p className="admin-hint" style={{ marginBottom: 14, lineHeight: 1.7 }}>
        지금 사이트에 쓰이고 있는 값입니다. 고칠 칸만 고치고 저장하면 됩니다 —
        <b> 저장한 값이 곧바로 화면에 반영</b>되고, 안 건드린 칸은 그대로 둡니다.
      </p>

      {/* 응시 시작 잠금 — 배포·DB 작업 중 사고를 막는 스위치.
          ⛔ 팝업 안내로는 못 막는다(닫고 시작할 수 있고, 배포 중 시작한 응시는 날아간다). */}
      <div className="admin-section" style={locked ? { borderColor: 'var(--k-amber, #d98a00)' } : undefined}>
        <div className="admin-section-head">
          <h3>응시 시작 잠금</h3>
          <SaveBtn keys={['exam_start_locked', 'exam_start_lock_note']} name="응시 시작 잠금" />
        </div>
        <p className="admin-hint" style={{ marginTop: -6, marginBottom: 12, lineHeight: 1.7 }}>
          켜면 <b>새 응시만</b> 막힙니다. 이미 보고 있는 사람은 계속 풀고 제출도 됩니다.
          배포나 DB 작업 전에 켜 두세요 — 작업 도중 시작된 응시는 날아갑니다.
        </p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 700 }}>
            <input type="checkbox" checked={locked} onChange={(e) => setForm({ ...(form ?? {}), exam_start_locked: e.target.checked ? '1' : '0' })} />
            {locked ? '잠금 중' : '잠금 꺼짐'}
          </label>
          <input style={{ ...inp, maxWidth: 420 }} placeholder="응시자에게 보일 안내 문구"
            value={form?.exam_start_lock_note ?? ''} onChange={(e) => setForm({ ...(form ?? {}), exam_start_lock_note: e.target.value })} />
        </div>
      </div>

      {SITE_GROUPS.map((g) => (
        <div key={g.title} className="admin-section">
          <div className="admin-section-head">
            <h3>{g.title}</h3>
            <SaveBtn keys={g.keys.map((f) => f.key)} name={g.title.split('—')[0].trim()} />
          </div>
          {g.note && <p className="admin-hint" style={{ marginTop: -6, marginBottom: 12, lineHeight: 1.7 }}>{g.note}</p>}
          {/* 왼쪽 = 입력, 오른쪽 = 그 값이 실제로 어떻게 보이는지. 글로만 적으면 감이 안 온다. */}
          <div style={{ display: 'grid', gridTemplateColumns: g.preview === 'none' ? '1fr' : 'minmax(320px, 1fr) minmax(320px, 1fr)', gap: 18, alignItems: 'start' }}>
            <div style={{ display: 'grid', gap: 12 }}>
              {g.keys.map((f) => {
                const changed = dirty.includes(f.key)
                const blank = !(form?.[f.key] ?? '').trim()
                const style = changed ? { ...inp, borderColor: 'var(--blue)' } : inp
                return (
                  <label key={f.key} style={fld}>
                    <span>
                      {f.label}
                      {changed && <span style={{ color: 'var(--blue)' }}> · 변경함</span>}
                      {!changed && blank && <span style={{ color: 'var(--dim)', fontWeight: 400 }}> · 미입력</span>}
                    </span>
                    {f.image
                      ? <ImageField value={form?.[f.key] ?? ''} onChange={(url) => setForm({ ...(form ?? {}), [f.key]: url })} hint={f.where} />
                      : f.multiline
                        ? <textarea style={{ ...style, minHeight: 150, fontFamily: 'inherit', lineHeight: 1.7 }}
                            value={form?.[f.key] ?? ''} onChange={(e) => setForm({ ...(form ?? {}), [f.key]: e.target.value })} />
                        : <input style={style} value={form?.[f.key] ?? ''} onChange={(e) => setForm({ ...(form ?? {}), [f.key]: e.target.value })} />}
                    {!f.image && <span style={{ fontWeight: 400, color: 'var(--dim)' }}>{f.where}</span>}
                  </label>
                )
              })}
            </div>
            {g.preview !== 'none' && <SitePreview kind={g.preview} v={form ?? {}} />}
          </div>
        </div>
      ))}
      <p className="admin-hint" style={{ lineHeight: 1.7 }}>
        도메인은 여기서 바꿀 수 없습니다 — 실제 주소는 Cloudflare 설정이라 값을 고쳐도 주소가 바뀌지 않습니다.
      </p>
    </>
  )
}

// ══════════════════════════════════════════════════════════════
// 홈페이지 관리 > 팝업 관리
// ══════════════════════════════════════════════════════════════
interface PopupRow {
  id: string; title: string; body: string; image_url: string | null; link_url: string | null
  device: 'pc' | 'mobile' | 'both'; placements: string[]
  starts_at: string; ends_at: string; active: boolean; sort_order: number
}
type PopupDraft = Partial<PopupRow> & { _new?: boolean }
/** 노출 위치 = [값, 이름, **운영자에게 보여줄 설명**].
 *  ⚠️ 설명은 `components/SitePopups.tsx` 의 placementOf 가 실제로 매칭하는 주소와 **한 쌍**이다 —
 *     그쪽 조건을 고치면 이 문장도 같이 고칠 것. 운영자가 볼 화면이므로 주소(`/exam` 같은 것)를 쓰지 않는다.
 *     여기 적힌 곳 말고는 어디에도 안 뜬다(아래 안내문). */
const PLACEMENTS: [string, string, string][] = [
  ['main', '메인', '사이트에 들어오면 가장 먼저 보이는 홈 화면 한 곳'],
  ['caris', 'CARIS', 'CARIS 자격검정을 소개하는 안내 페이지. 시험 일정·원서접수·자격증 발급 화면에는 뜨지 않습니다'],
  ['arena', 'WORLD ARENA', '무료 레벨테스트 쪽 전부 — 세계지도, 레벨 선택과 응시, 결과, 캐릭터 허브, 미니게임, 랭킹, DAILY QUIZ'],
  ['library', '러닝 라이브러리', '교재·강의를 고르는 목록 화면. 이북을 펼쳐 읽는 중에는 뜨지 않습니다'],
]
const DEVICES: [string, string][] = [['both', 'PC + 모바일'], ['pc', 'PC'], ['mobile', '모바일']]
// ⚠️ `datetime-local` 은 **그 사람 컴퓨터의 시간대**로 읽고 쓴다.
//    `new Date(iso).toISOString()` 으로 값을 만들면 UTC 문자열이 칸에 들어가 한국 시간과 9시간 어긋난다
//    (저장 → 다시 열면 시각이 제멋대로 바뀌어 보였다). 그래서 로컬 시간대로 변환해 넣고, 읽을 땐 그대로 Date 로 만든다.
const toLocalInput = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const off = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - off).toISOString().slice(0, 16)
}
/** 입력칸 값(로컬 시각) → 저장용 ISO. 빈 값이면 건드리지 않는다. */
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : undefined)

export function PopupAdmin() {
  const { data, loading, err, reload } = useAdminData<{ popups: PopupRow[] }>('popupList')
  const [edit, setEdit] = useState<PopupDraft | null>(null)
  const draft = useDraft({ kind: 'popup', refId: edit?.id, value: edit, title: edit?.title?.trim() || '새 팝업', enabled: !!edit })
  const [busy, setBusy] = useState(false)
  const rows = data?.popups ?? []

  // 팝업 그림 — 예전엔 '이미지 주소'를 손으로 적는 칸이었다. 운영자에게 없는 값을 요구하는 칸이라
  //   파일 업로드로 바꿨다(2026-08-13). 공지 에디터와 같은 방식: 스토리지에 올리고 공개 주소만 들고 있는다.
  //   ⚠️ DB 컬럼(image_url)은 그대로다 — 예전에 주소를 적어 저장한 팝업도 계속 그대로 뜬다.
  //   ⚠️ '클릭 시 이동할 주소'(link_url)와 헷갈리지 말 것. 그건 누르면 가는 곳이라 손으로 적는 게 맞다.
  const imgInputRef = useRef<HTMLInputElement>(null)
  const [imgBusy, setImgBusy] = useState(false)
  const [imgErr, setImgErr] = useState('')
  async function pickImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // 같은 파일을 다시 골라도 change 가 다시 오게
    if (!file || !edit) return
    setImgErr('')
    if (!file.type.startsWith('image/')) { setImgErr('이미지 파일만 올릴 수 있습니다.'); return }
    if (file.size > 5 * 1024 * 1024) { setImgErr('이미지는 5MB 이하만 올릴 수 있습니다.'); return }
    setImgBusy(true)
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase()
      const path = `${crypto.randomUUID()}.${ext}`
      const { error } = await supabase.storage.from('popup-images').upload(path, file, { contentType: file.type, upsert: false })
      if (error) throw error
      const { data: pub } = supabase.storage.from('popup-images').getPublicUrl(path)
      setEdit((p) => (p ? { ...p, image_url: pub.publicUrl } : p))
    } catch (e2) {
      setImgErr(e2 instanceof Error ? e2.message : '업로드에 실패했습니다.')
    } finally { setImgBusy(false) }
  }

  async function save() {
    if (!edit) return
    setBusy(true)
    try {
      await callFunction('admin', {
        action: 'popupUpsert',
        popup: {
          id: edit._new ? undefined : edit.id,
          title: edit.title ?? '', body: edit.body ?? '',
          imageUrl: edit.image_url ?? '', linkUrl: edit.link_url ?? '',
          device: edit.device ?? 'both', placements: edit.placements ?? ['main'],
          startsAt: edit.starts_at, endsAt: edit.ends_at,
          active: edit.active !== false, sortOrder: edit.sort_order ?? 0,
        },
      })
      draft.clear()
      setEdit(null)
      await reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : '저장 실패')
    } finally { setBusy(false) }
  }
  async function del(id: string) {
    if (!confirm('이 팝업을 삭제할까요?')) return
    try { await callFunction('admin', { action: 'popupDelete', id }); await reload() }
    catch (e) { alert(e instanceof Error ? e.message : '삭제 실패') }
  }
  // ⚠️ 현재 시각을 렌더 중에 읽지 않는다 — 렌더가 매번 달라져 결과를 예측할 수 없다.
  //    대신 1분마다 갱신한다(노출 시작·종료 시각이 지나면 배지가 저절로 바뀌어야 한다).
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  const state = (p: PopupRow) => {
    if (!p.active) return <span className="badge low">미사용</span>
    if (new Date(p.ends_at).getTime() < now) return <span className="badge low">종료</span>
    if (new Date(p.starts_at).getTime() > now) return <span className="badge">예약</span>
    return <span className="badge ok">노출 중</span>
  }

  const blank: PopupDraft = { _new: true, device: 'both', placements: ['main'], active: true, sort_order: rows.length }
  return (
    <>
      <AdminHead title="팝업 관리" count={`총 ${rows.length}개`} onReload={reload} loading={loading}>
        <button className="admin-mini" onClick={() => setEdit(blank)}>+ 새 팝업</button>
      </AdminHead>
      <ErrBox msg={err} />
      <p className="admin-hint" style={{ marginBottom: 12, lineHeight: 1.7 }}>
        노출 기간이 지나면 저절로 내려갑니다. ⛔ <b>응시 화면에는 어떤 팝업도 뜨지 않습니다</b> — 잠금 브라우저에서
        팝업을 닫으려다 화면을 벗어나면 응시가 무효 처리되기 때문입니다(설정으로 열 수 없습니다).
      </p>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>제목</th><th>기기</th><th>노출 위치</th><th>노출 기간</th><th>상태</th><th></th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td><b>{p.title}</b></td>
                <td style={{ whiteSpace: 'nowrap' }}>{DEVICES.find(([k]) => k === p.device)?.[1]}</td>
                <td>{(p.placements ?? []).map((k) => PLACEMENTS.find(([x]) => x === k)?.[1] ?? k).join(' · ')}</td>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{fmtDT(p.starts_at)} ~ {fmtDT(p.ends_at)}</td>
                <td>{state(p)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="admin-mini" onClick={() => setEdit({ ...p })}>수정</button>{' '}
                  <button className="admin-mini" onClick={() => del(p.id)}>삭제</button>
                </td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>등록된 팝업이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {edit && (
        <div className="admin-modal-bg">
        {/* ⚠️ 바깥을 눌러도 닫지 않는다 — 입력하던 내용이 통째로 날아간다(닫기는 ✕·취소 버튼으로). */}
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <button className="admin-modal-x" onClick={() => setEdit(null)}>✕</button>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0 }}>{edit._new ? '새 팝업' : '팝업 수정'}</h2>
              <DraftBar status={draft.status} savedAt={draft.savedAt} drafts={draft.drafts} onRefresh={draft.refresh} onRestore={(p: PopupDraft) => setEdit(p)} />
            </div>
            <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
              <label style={fld}>제목
                <input style={inp} value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
              </label>
              <label style={fld}>내용
                <textarea style={{ ...inp, minHeight: 100 }} value={edit.body ?? ''} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
              </label>
              {/* 이미지 — 파일을 고르면 바로 올라가고 미리보기가 뜬다. 주소를 적는 칸은 없앴다. */}
              <div style={fld}>
                이미지 (선택)
                {edit.image_url ? (
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', fontWeight: 400 }}>
                    <img src={edit.image_url} alt=""
                      style={{ width: 132, borderRadius: 10, border: '1px solid var(--line2)', display: 'block' }} />
                    <div style={{ display: 'grid', gap: 6 }}>
                      <button className="admin-mini" type="button" disabled={imgBusy} onClick={() => imgInputRef.current?.click()}>
                        {imgBusy ? '올리는 중…' : '다른 이미지로 바꾸기'}
                      </button>
                      <button className="admin-mini" type="button" onClick={() => setEdit({ ...edit, image_url: '' })}>
                        이미지 빼기
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontWeight: 400 }}>
                    <button className="admin-mini" type="button" disabled={imgBusy} onClick={() => imgInputRef.current?.click()}>
                      {imgBusy ? '올리는 중…' : '이미지 선택'}
                    </button>
                    <span style={{ marginLeft: 10 }}>PNG·JPG 등, 5MB 이하. 넣지 않으면 글자만 있는 팝업이 됩니다.</span>
                  </div>
                )}
                {imgErr && <span style={{ color: 'var(--danger-fg)', fontWeight: 400 }}>{imgErr}</span>}
                <input ref={imgInputRef} type="file" accept="image/*" hidden onChange={pickImage} />
              </div>
              <label style={fld}>클릭 시 이동할 주소 (선택)
                <input style={inp} value={edit.link_url ?? ''} onChange={(e) => setEdit({ ...edit, link_url: e.target.value })} />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={fld}>시작
                  <input style={inp} type="datetime-local" value={toLocalInput(edit.starts_at)}
                    onChange={(e) => setEdit({ ...edit, starts_at: fromLocalInput(e.target.value) })} />
                </label>
                <label style={fld}>종료
                  <input style={inp} type="datetime-local" value={toLocalInput(edit.ends_at)}
                    onChange={(e) => setEdit({ ...edit, ends_at: fromLocalInput(e.target.value) })} />
                </label>
              </div>
              <label style={fld}>기기
                <select style={inp} value={edit.device ?? 'both'} onChange={(e) => setEdit({ ...edit, device: e.target.value as PopupRow['device'] })}>
                  {DEVICES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              {/* 노출 위치 — 이름만 보면 어디까지 포함인지 알 수 없어서(예: 'CARIS' 가 원서접수까지인지)
                  항목마다 설명을 함께 보여준다. 한 줄에 나란히 두면 설명이 들어갈 자리가 없어 세로로 세운다. */}
              <div style={fld}>
                노출 위치
                <div style={{ display: 'grid', gap: 10, fontWeight: 400 }}>
                  {PLACEMENTS.map(([k, v, desc]) => (
                    <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
                      <input type="checkbox" style={{ marginTop: 3, flex: 'none' }} checked={(edit.placements ?? []).includes(k)}
                        onChange={(e) => {
                          const set = new Set(edit.placements ?? [])
                          if (e.target.checked) set.add(k); else set.delete(k)
                          setEdit({ ...edit, placements: [...set] })
                        }} />
                      <span>
                        <b style={{ color: 'var(--ink)' }}>{v}</b>
                        <span style={{ display: 'block', marginTop: 2, lineHeight: 1.6, wordBreak: 'keep-all' }}>{desc}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="admin-hint" style={{ margin: '4px 0 0', lineHeight: 1.7, fontWeight: 400 }}>
                  위에 적힌 곳에만 뜹니다. <b>마이페이지 · 공지사항 · 고객센터 · 협회 소개 · 약관 · 결제 · 로그인</b> 화면에는
                  어느 것을 골라도 뜨지 않습니다.
                </p>
              </div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--fs-sm)' }}>
                <input type="checkbox" checked={edit.active !== false} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />
                사용
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
              <button className="admin-mini" onClick={() => setEdit(null)}>취소</button>
              <button className="btn-ink" onClick={save} disabled={busy}>{busy ? '저장 중…' : '저장'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ══════════════════════════════════════════════════════════════
// WORLD ARENA > 꾸미기 관리 (캐릭터 · 스킨 · 가구 가격표)
//
// ⚠️ **여기서 만지는 건 가격·판매여부·진열순서 셋뿐이다**(2026-08-20 결정).
//    그림과 9패치 자르는 값(`--skin-mission-slice: 45 145 40 145 fill` 같은 줄 15개)은
//    코드/에셋에 있다 — 그림을 보면서 맞추는 값이라 폼에 칠 수가 없고, 한 칸만 틀려도 판이 찌그러진다.
//    캐릭터·스킨을 **새로 추가**하는 것도 여기가 아니라 배포다(에셋 + hub.css 값 블록 + shop_catalog 한 행).
// ⚠️ 가격 0 = **첫 선택 무료 대상**이다. 값을 매기면 그 캐릭터는 신규 회원 선택 화면에서 빠지고
//    상점에만 뜬다. 무료 캐릭터를 전부 없애면 신규 회원이 첫 화면에서 갇히므로 서버가 저장을 거절한다.
// ══════════════════════════════════════════════════════════════
interface CosmeticRow {
  part_key: string; price: number; kind: string; surface: string | null
  active: boolean; sort_order: number; owners: number; worn: number
}
const COSMETIC_KIND_LABEL: Record<string, string> = {
  character: '캐릭터', skin: '배경·UI 스킨', furniture: '가구', part: '아이템',
}
// 진열 순서와 같은 순서로 묶어 보여준다.
const COSMETIC_KIND_ORDER = ['character', 'skin', 'furniture', 'part']

export function HubCosmeticAdmin() {
  const { data, loading, err, reload } = useAdminData<{ items: CosmeticRow[] }>('hubCosmetics')
  const [rows, setRows] = useState<CosmeticRow[] | null>(null)
  const draft = useDraft({ kind: 'hub-cosmetics', value: rows, title: '허브 꾸미기 가격표', enabled: !!rows })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => { if (data) setRows(data.items) }, [data])

  const patch = (key: string, p: Partial<CosmeticRow>) =>
    setRows((prev) => (prev ? prev.map((r) => (r.part_key === key ? { ...r, ...p } : r)) : prev))

  // 첫 선택 후보 수 — 0이 되면 저장이 막힌다. 저장을 누르기 전에 화면에서 먼저 보이게 한다.
  //   ⚠️ 값(price)은 보지 않는다 — 첫 선택은 값과 무관하게 공짜다(20260824120000).
  //      서버 가드(hubCosmeticsSave)와 같은 조건이어야 한다. 어긋나면 화면은 되는 줄 알고
  //      저장을 눌렀는데 서버가 거절하거나, 반대로 갇히는 값을 통과시킨다.
  const starters = (rows ?? []).filter((r) => r.kind === 'character' && r.active)

  async function save() {
    if (!rows) return
    setBusy(true); setMsg('')
    try {
      await callFunction('admin', {
        action: 'hubCosmeticsSave',
        rows: rows.map((r) => ({ partKey: r.part_key, price: r.price, active: r.active, sortOrder: r.sort_order })),
      })
      setMsg('✅ 저장했습니다')
      draft.clear()
      await reload()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '저장 실패')
    } finally { setBusy(false) }
  }

  const table = (kind: string) => {
    const list = (rows ?? []).filter((r) => r.kind === kind)
    if (!list.length) return null
    const isChar = kind === 'character'
    return (
      <div className="admin-section" key={kind}>
        <h3>{COSMETIC_KIND_LABEL[kind] ?? kind}</h3>
        {isChar && (
          <p className="admin-hint" style={{ marginTop: -6, marginBottom: 12 }}>
            신규 회원은 <b>첫 캐릭터 선택 화면</b>에서 <b>진열 중인 캐릭터 아무거나 한 종을 공짜로</b> 받습니다 —
            가격은 <b>두 번째 캐릭터부터</b> 붙습니다. 진열을 내리면 그 화면에서도 빠집니다.
            {' '}현재 첫 선택 후보 <b>{starters.length}종</b>
            {starters.length === 0 && <b style={{ color: 'var(--danger, #d33)' }}> — 최소 1종은 있어야 저장됩니다</b>}
          </p>
        )}
        <table className="admin-table">
          <thead>
            <tr>
              <th>키</th>
              <th style={{ width: 130 }}>가격(코인)</th>
              <th style={{ width: 110 }}>진열순서</th>
              <th style={{ width: 120 }}>진열</th>
              <th style={{ width: 150 }}>보유 / 착용</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.part_key}>
                <td>
                  <b>{r.part_key}</b>
                  {r.surface && <span className="admin-hint"> · {r.surface}</span>}
                </td>
                <td>
                  <input style={inp} type="number" min={0} step={1} value={r.price}
                    onChange={(e) => patch(r.part_key, { price: Math.max(0, Math.floor(+e.target.value || 0)) })} />
                </td>
                <td>
                  <input style={inp} type="number" step={1} value={r.sort_order}
                    onChange={(e) => patch(r.part_key, { sort_order: Math.floor(+e.target.value || 0) })} />
                </td>
                <td>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input type="checkbox" checked={r.active}
                      onChange={(e) => patch(r.part_key, { active: e.target.checked })} />
                    {r.active ? '진열' : '내림'}
                  </label>
                </td>
                {/* 보유자는 값을 올리기 전에, 착용자는 진열을 내리기 전에 봐야 하는 숫자다. */}
                <td className="admin-hint">{r.owners}명 / {r.worn}명</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <>
      <AdminHead title="꾸미기 관리" onReload={reload} loading={loading}>
        {msg && <span className="admin-msg">{msg}</span>}
        <DraftBar status={draft.status} savedAt={draft.savedAt} drafts={draft.drafts} onRefresh={draft.refresh}
          onRestore={(p: CosmeticRow[]) => setRows(p)} />
        <button className="btn-ink" onClick={save} disabled={busy || !rows}>{busy ? '저장 중…' : '저장'}</button>
      </AdminHead>
      <ErrBox msg={err} />
      {COSMETIC_KIND_ORDER.map(table)}
      <p className="admin-hint" style={{ lineHeight: 1.7 }}>
        ⚠️ <b>진열을 내려도(“내림”) 이미 산 사람은 계속 씁니다.</b> 상점 목록에서만 사라지고 보관함에는 남습니다 —
        돈을 낸 물건을 뺏지 않기 위해서입니다.<br />
        ⚠️ 캐릭터 그림과 스킨 이미지는 이 화면에서 올리지 않습니다. 새 캐릭터·스킨을 추가하려면 개발자에게 요청하세요
        (에셋 파일 + 화면 배포가 함께 필요합니다).
      </p>
    </>
  )
}
