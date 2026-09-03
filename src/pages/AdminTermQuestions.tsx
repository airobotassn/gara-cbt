// 관리자 > WORLD ARENA > 미니게임 > 게임 문항 / DAILY QUIZ > 문항 관리
//
// 용어 문항(term_questions) 관리 — **레벨테스트(AdminLevelTest 의 문항 탭)와 같은 모양**이다:
//   문항 목록 · 문항 이력 · 문항 추가 & 번역(엑셀) 서브탭 + 한국어로 쓰고 🌐 자동 번역.
//
// ⛔ 여기서 고친 문항이 **바로 게임에 나간다**(서버 term-pool → 게임 iframe · DAILY QUIZ).
//    예전엔 게임 HTML 안 POOL 이 진짜였고 이 화면은 저장만 되고 아무 데도 안 나갔다(2026-09-03 연결).
// ⛔ **게임별로 문항을 고르는 기능은 없다(2026-09-03 지시).** 은행에 '사용' 상태로 있는 문항이
//    네 곳(버텨라·쏴라·골라라·DAILY) 전부에 나간다 — 셋은 같은 문제를 보여주는 방식만 다르다.
//    한 문항을 빼려면 '중지'를 누른다(네 곳에서 같이 빠진다).
// ⚠️ 게임 HTML(public/games/*.html)과 src/lib/terms.ts 의 문항 배열은 **폴백**으로 남아 있다 —
//    거기를 고쳐도 서비스에는 안 나간다. 문항을 바꾸는 자리는 이 화면 하나다.
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import * as XLSX from 'xlsx'
import { callFunction } from '../lib/supabase'
import { useDraft } from '../lib/adminDraft'
import DraftBar from '../components/DraftBar'
import { runTranslation, type TransItem, type TransResult } from '../lib/adminTranslate'
import { TERM_GAME_IDS } from '../lib/minigames'
import { AdminHead } from './AdminReform'

const inp: CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 10,
  border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--ink)', fontSize: 'var(--fs-sm)',
}
const fld: CSSProperties = { display: 'grid', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--muted)' }
const ErrBox = ({ msg }: { msg: string }) => (msg ? <div className="admin-section admin-empty">{msg}</div> : null)

// 번역 대상 5개국어 — 서버 sanitizeTermI18n 의 TRANSLATED_LANGS 와 한 쌍이다(ko 제외).
const LANGS = ['en', 'ja', 'zh', 'hi', 'vi'] as const
const LANG_LABEL: Record<string, string> = { ko: '한국어', en: '영어', ja: '일본어', zh: '중국어', hi: '힌디어', vi: '베트남어' }
const TERM_FIELDS = ['AI', '로봇', '피지컬AI']

// 이 은행을 쓰는 게임 — 제목 옆에 적는다(어디로 나가는 문항인지 화면에서 바로 읽히게).
//   ⚠️ 게임 목록의 단일 출처는 `lib/minigames.ts` 의 TERM_GAME_IDS 다 — 여기선 이름만 붙인다.
//   ⚠️ 퍼즐형(닿아라·지어라·프로그램해라)·판단형(막아라·시켜라)은 용어 문제를 안 써서 여기 없다.
const GAME_LABEL: Record<string, string> = {
  'beat-cari': '버텨라 CARI', 'shoot-cari': '쏴라 CARI', 'pick-cari': '골라라 CARI',
}
const USED_BY = TERM_GAME_IDS.map((g) => GAME_LABEL[g] ?? g).join(' · ')


export interface TermRow {
  id: string
  code: string | null
  field: string
  active: boolean
  sort_order: number
  desc_i18n: Record<string, string>
  answer_i18n: Record<string, string>
  distractors_i18n: Record<string, string[]>
  /** 번역이 덜 찬 언어(서버가 계산). ⚠️ 화면에서 다시 세지 말 것 — 목록 배지와 완료율이 서로 다른 말을 한다. */
  missing: string[]
}
interface TermListResp {
  terms: TermRow[]
  coverage: Record<string, number>
  total: number
}
interface TermEvent {
  id: string; code: string | null; action: string; actor: string | null
  detail: Record<string, unknown> | null; created_at: string
}

const ACTION_LABEL: Record<string, string> = {
  create: '추가', update: '수정', deactivate: '중지', activate: '사용', delete: '삭제', restore: '되돌림', import: '일괄 등록',
}
const fmtDT = (s: string) => new Date(s).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })
const koOf = (r: TermRow) => r.answer_i18n?.ko ?? ''

// ══════════════════════════════════════════════════════════════
// 껍데기 — 서브탭(목록 · 이력 · 추가&번역)
// ══════════════════════════════════════════════════════════════
type Sub = 'list' | 'events' | 'upload'

// ⚠️ 메뉴 두 곳(미니게임 › 게임 문항, DAILY QUIZ › 문항 관리)이 **같은 화면**을 연다 — 은행이 하나라서다.
//    그래서 제목도 같은 이름으로 둔다: 어디로 들어와도 "아, 아까 그 은행" 으로 읽혀야 한다.
//    (scope 는 어느 메뉴로 들어왔는지일 뿐, 보이는 내용은 같다.)
export function TermPoolAdmin({ scope: _scope }: { scope: 'minigame' | 'daily' }) {
  const [sub, setSub] = useState<Sub>('list')
  // 방금 올린 문항 — '문항 추가 & 번역' 이 넘겨주고 '문항 목록' 이 받아 그것만 걸러 보여준다.
  const [justAdded, setJustAdded] = useState<{ codes: string[]; at: number } | null>(null)
  const SUBS: [Sub, string][] = [['list', '문항 목록'], ['events', '문항 이력'], ['upload', '문항 추가 & 번역']]
  return (
    <>
      <AdminHead
        title={<>용어 문제은행 <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--muted)' }}>{USED_BY}</span></>}
      />
      <div className="admin-tabs" style={{ marginBottom: 16 }}>
        {SUBS.map(([k, label]) => (
          <button key={k} className={sub === k ? 'on' : ''} onClick={() => setSub(k)}>{label}</button>
        ))}
      </div>
      {sub === 'list' && <ListTab justAdded={justAdded} clearJustAdded={() => setJustAdded(null)} />}
      {sub === 'events' && <EventsTab />}
      {sub === 'upload' && (
        <UploadTab onApplied={(codes) => { setJustAdded({ codes, at: Date.now() }); setSub('list') }} />
      )}
    </>
  )
}

// ══════════════════════════════════════════════════════════════
// 문항 목록
// ══════════════════════════════════════════════════════════════
const PAGE = 50

function ListTab({ justAdded, clearJustAdded }: {
  justAdded: { codes: string[]; at: number } | null
  clearJustAdded: () => void
}) {
  const [data, setData] = useState<TermListResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [onlyNew, setOnlyNew] = useState(!!justAdded)
  const [page, setPage] = useState(0)
  const [edit, setEdit] = useState<TermRow | 'new' | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())

  async function load() {
    setLoading(true)
    setErr('')
    try { setData(await callFunction<TermListResp>('admin', { action: 'termList' })) }
    catch (e) { setErr(e instanceof Error ? e.message : '불러오기 실패') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  const all = useMemo(() => data?.terms ?? [], [data])
  const filtered = useMemo(() => all.filter((t) => {
    if (onlyNew && justAdded && !justAdded.codes.includes(t.code ?? '')) return false
    if (onlyMissing && !t.missing.length) return false
    if (!q.trim()) return true
    const s = q.trim()
    return (t.code ?? '').includes(s) || koOf(t).includes(s) || (t.desc_i18n?.ko ?? '').includes(s)
  }), [all, q, onlyMissing, onlyNew, justAdded])
  const pageMax = Math.max(1, Math.ceil(filtered.length / PAGE))
  const pageSafe = Math.min(page, pageMax - 1)
  const shown = filtered.slice(pageSafe * PAGE, pageSafe * PAGE + PAGE)

  // ⚠️ 완료율 분모는 **활성 문항**이다(CARIS 와 같은 규칙) — 비활성은 게임에 안 나가니 번역할 이유가 없다.
  const total = data?.total ?? 0

  async function act(t: TermRow, kind: 'deactivate' | 'delete') {
    const word = kind === 'delete' ? '삭제' : '중지'
    if (!confirm(`${t.code ?? '이 문항'} 을(를) ${word}할까요?\n목록에서 빠지고 '문항 이력' 탭으로 이동합니다. (거기서 되돌리기 가능)`)) return
    try {
      await callFunction('admin', kind === 'delete'
        ? { action: 'termDelete', id: t.id }
        : { action: 'termSetActive', id: t.id, active: false })
      await load()
    } catch (e) { alert(e instanceof Error ? e.message : `${word} 실패`) }
  }

  /** 선택한(또는 미번역 전부) 문항의 빈 언어를 채운다. 배치마다 저장한다 — 중간에 끊겨도 한 것은 남는다. */
  async function translateMissing() {
    const targets = (sel.size ? all.filter((t) => sel.has(t.id)) : all).filter((t) => t.missing.length)
    if (!targets.length) { setMsg('번역할 문항이 없습니다(선택분이 모두 번역 완료).'); return }
    if (!confirm(`${targets.length}개 문항의 빈 언어를 번역할까요?\n번역된 것부터 순서대로 저장됩니다.`)) return
    setBusy(true)
    setMsg(`번역 중… 0/${targets.length}`)
    const items: TransItem[] = targets.map((t) => ({
      prompt: t.desc_i18n?.ko ?? '',
      // 보기 = [정답, 오답×3]. 순서를 지켜야 저장할 때 정답/오답을 다시 가를 수 있다.
      options: [koOf(t), ...((t.distractors_i18n?.ko ?? []).slice(0, 3))],
      explanation: '',
    }))
    let saveChain: Promise<unknown> = Promise.resolve()
    const savedIdx = new Set<number>()
    const saveBatch = (results: TransResult[]) => {
      const rows: Record<string, unknown>[] = []
      results.forEach((r, i) => {
        if (!r || !('tr' in r) || savedIdx.has(i)) return
        savedIdx.add(i)
        const descI18n: Record<string, string> = {}
        const answerI18n: Record<string, string> = {}
        const distractorsI18n: Record<string, string[]> = {}
        for (const l of LANGS) {
          const tr = r.tr[l]
          // ⚠️ 보기 개수가 어긋난 언어는 버린다 — 정답/오답을 못 가른다(그 언어만 보기가 빈다).
          if (!tr?.prompt || !Array.isArray(tr.options) || tr.options.length !== 4) continue
          descI18n[l] = tr.prompt
          answerI18n[l] = tr.options[0]
          distractorsI18n[l] = tr.options.slice(1, 4)
        }
        if (!Object.keys(descI18n).length) return
        rows.push({ id: targets[i].id, descI18n, answerI18n, distractorsI18n })
      })
      if (!rows.length) return
      // ⛔ 배치마다 저장한다 — 전부 끝난 뒤 몰아 저장하면 도중에 창을 닫을 때 그때까지의 호출이 통째로 버려진다.
      saveChain = saveChain.then(() => callFunction('admin', { action: 'termTransSave', rows })).catch(() => {})
    }
    try {
      const results = await runTranslation(items, [...LANGS], (done, totalN) => setMsg(`번역 중… ${done}/${totalN}`), {
        onBatch: saveBatch,
      })
      saveBatch(results)
      await saveChain
      const failed = results.filter((r) => !r || 'error' in r).length
      setMsg(failed ? `⚠️ ${targets.length - failed}개 저장, ${failed}개 실패 — 다시 눌러 남은 것만 이어서 하세요.` : `✅ ${targets.length}개 번역 완료`)
      await load()
    } catch (e) {
      setMsg('번역 실패: ' + (e instanceof Error ? e.message : String(e)))
    } finally { setBusy(false); setSel(new Set()) }
  }

  return (
    <>
      <ErrBox msg={err} />
      {justAdded && onlyNew && (
        <div className="admin-section" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <b>✅ 문항 {justAdded.codes.length}개 추가됨</b>
          <span style={{ color: 'var(--muted)' }}>{justAdded.codes[0]} ~ {justAdded.codes[justAdded.codes.length - 1]}</span>
          <button className="admin-mini" onClick={() => { setOnlyNew(false); clearJustAdded() }}>전체 보기</button>
        </div>
      )}

      {/* 언어별 번역 완료율 — 분모는 활성 문항. 여기가 100%가 아니면 그 언어로 하는 사람은 한국어 문제를 본다. */}
      <div className="admin-section">
        <h3>번역 완료율 <span className="admin-hint">활성 {total}문항 기준</span></h3>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 'var(--fs-sm)' }}>
          {LANGS.map((l) => {
            const c = data?.coverage?.[l] ?? 0
            const pct = total ? Math.round((c / total) * 100) : 0
            return (
              <span key={l} style={{ fontWeight: 700, color: pct === 100 ? 'var(--muted)' : 'var(--ink)' }}>
                {LANG_LABEL[l]} <b style={{ color: pct === 100 ? '#2e9e6b' : '#d08a1a' }}>{pct}%</b>
                <span style={{ color: 'var(--dim)' }}> ({c}/{total})</span>
              </span>
            )
          })}
        </div>
      </div>


      <div className="admin-section">
        <div className="admin-toolbar">
          <input className="admin-search" placeholder="번호(T-012)·용어·설명 검색" value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} />
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={onlyMissing} onChange={(e) => { setOnlyMissing(e.target.checked); setPage(0) }} />
            미번역만 보기
          </label>
          <button className="admin-mini" onClick={() => setEdit('new')}>+ 문항 추가</button>
          <button className="admin-mini" disabled={busy} onClick={translateMissing}>
            🌐 {sel.size ? `선택 ${sel.size}개 번역` : '미번역 번역'}
          </button>
          <button className="admin-mini" onClick={load} disabled={loading}>새로고침</button>
          <span className="admin-hint">{filtered.length}문항{loading ? ' · 불러오는 중…' : ''}</span>
        </div>
        {msg && <div className="admin-toolbar"><span className="admin-msg">{msg}</span></div>}

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <input
                    type="checkbox"
                    checked={!!shown.length && shown.every((t) => sel.has(t.id))}
                    onChange={(e) => {
                      const n = new Set(sel)
                      for (const t of shown) e.target.checked ? n.add(t.id) : n.delete(t.id)
                      setSel(n)
                    }}
                    title="전체 선택"
                  />
                </th>
                <th>번호</th><th>분야</th><th>정답 용어</th><th>설명</th><th>미번역</th><th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id} className={t.missing.length ? 'prob' : ''}>
                  <td>
                    <input type="checkbox" checked={sel.has(t.id)} onChange={() => {
                      const n = new Set(sel); n.has(t.id) ? n.delete(t.id) : n.add(t.id); setSel(n)
                    }} />
                  </td>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 700, color: '#3f8fd6' }}>{t.code ?? '-'}</td>
                  <td><span className="badge">{t.field}</span></td>
                  <td><b>{koOf(t)}</b></td>
                  {/* ⚠️ maxWidth 만으로는 안 잘린다 — 표 셀은 내용에 맞춰 늘어나서 옆 열 글자와 겹친다. */}
                  <td title={t.desc_i18n?.ko} style={{ maxWidth: 300, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.desc_i18n?.ko}
                  </td>
                  <td className="admin-status">{t.missing.length ? t.missing.map((l) => LANG_LABEL[l] ?? l).join(', ') : '완료'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="admin-mini" onClick={() => setEdit(t)}>수정</button>{' '}
                    <button className="admin-mini" onClick={() => act(t, 'deactivate')}>중지</button>{' '}
                    <button className="admin-mini danger" onClick={() => act(t, 'delete')}>삭제</button>
                  </td>
                </tr>
              ))}
              {!shown.length && !loading && (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                  조건에 맞는 문항이 없습니다.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        {pageMax > 1 && (
          <div className="admin-pager">
            <button className="admin-mini" disabled={pageSafe === 0} onClick={() => setPage(Math.max(0, pageSafe - 1))}>‹ 이전</button>
            <span>{pageSafe + 1} / {pageMax}</span>
            <button className="admin-mini" disabled={pageSafe + 1 >= pageMax} onClick={() => setPage(pageSafe + 1)}>다음 ›</button>
          </div>
        )}
        <p className="admin-hint" style={{ marginTop: 8 }}>
          여기 <b>사용 중인 문항이 곧 게임에 나가는 문항</b>입니다 — 버텨라·쏴라·골라라·DAILY QUIZ 가 같이 씁니다.
          한 문항을 빼려면 <b>중지</b>를 누르세요. 중지·삭제한 문항은 <b>문항 이력</b> 탭에서 되돌릴 수 있습니다.
        </p>
      </div>

      {edit && (
        <TermEdit
          row={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); void load() }}
        />
      )}
    </>
  )
}

// ══════════════════════════════════════════════════════════════
// 문항 추가/수정 — 한국어로 쓰고 '자동 번역'으로 나머지 5개 언어를 채운다
// ══════════════════════════════════════════════════════════════
function TermEdit({ row, onClose, onSaved }: { row: TermRow | null; onClose: () => void; onSaved: () => void }) {
  const isNew = !row
  const [field, setField] = useState(row?.field ?? 'AI')
  const [active, setActive] = useState(row?.active ?? true)
  const [lang, setLang] = useState('ko')
  const [di, setDi] = useState<Record<string, string>>({ ...(row?.desc_i18n ?? {}) })
  const [ai, setAi] = useState<Record<string, string>>({ ...(row?.answer_i18n ?? {}) })
  const [xi, setXi] = useState<Record<string, string[]>>({ ...(row?.distractors_i18n ?? { ko: ['', '', ''] }) })
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const draft = useDraft({
    kind: 'term-question', refId: row?.id, value: { field, active, di, ai, xi },
    title: (ai.ko ?? '').trim() || (row?.code ?? '새 용어 문항'),
  })

  const ALL = ['ko', ...LANGS]
  const koDesc = (di.ko ?? '').trim()
  const koAns = (ai.ko ?? '').trim()
  const koDis = (xi.ko ?? ['', '', '']).map((s) => (s ?? '').trim())
  const koReady = !!koDesc && !!koAns && koDis.filter(Boolean).length === 3
  const trDone = LANGS.filter((l) => !!(di[l] ?? '').trim())
  // 한국어를 고쳤나 — 고쳤으면 저장할 때 번역이 버려진다(서버가 그렇게 한다). 미리 알린다.
  const koChanged = !!row && (
    (row.desc_i18n?.ko ?? '') !== koDesc || (row.answer_i18n?.ko ?? '') !== koAns ||
    JSON.stringify((row.distractors_i18n?.ko ?? []).map((s) => (s ?? '').trim())) !== JSON.stringify(koDis)
  )

  function setDis(l: string, i: number, v: string) {
    setXi((o) => { const arr = [...(o[l] ?? ['', '', ''])]; arr[i] = v; return { ...o, [l]: arr } })
  }

  async function translate() {
    if (!koReady) { setMsg('한국어(설명·정답·오답 3개)를 먼저 채우세요.'); return }
    setBusy(true)
    setMsg('번역 중… (영어·일본어·중국어·힌디어·베트남어)')
    const [res] = await runTranslation([{ prompt: koDesc, options: [koAns, ...koDis], explanation: '' }], [...LANGS])
    if (!res || 'error' in res) { setMsg('번역 실패: ' + (res ? res.error : '빈 응답')); setBusy(false); return }
    const ok: string[] = []; const bad: string[] = []
    const nD = { ...di }, nA = { ...ai }, nX = { ...xi }
    for (const l of LANGS) {
      const t = res.tr[l]
      // ⚠️ 보기가 4개가 아니면 버린다 — 정답/오답을 못 가른다.
      if (!t?.prompt || !Array.isArray(t.options) || t.options.length !== 4) { bad.push(l); continue }
      nD[l] = t.prompt; nA[l] = t.options[0]; nX[l] = t.options.slice(1, 4)
      ok.push(l)
    }
    setDi(nD); setAi(nA); setXi(nX)
    setMsg(bad.length
      ? `⚠️ ${bad.map((l) => LANG_LABEL[l]).join('·')} 실패 — 다시 시도하세요. (${ok.length}개 완료)`
      : `✅ ${ok.length}개 언어 번역 완료. 언어 탭에서 확인 후 저장하세요.`)
    setBusy(false)
  }

  async function save() {
    if (!koReady) { setMsg('설명·정답 용어·오답 3개(한국어)를 모두 채우세요.'); return }
    setBusy(true)
    setMsg('저장 중…')
    try {
      const r = await callFunction<{ dropped?: string[]; clearedTranslations?: boolean }>('admin', {
        action: 'termUpsert',
        term: {
          id: row?.id, field, active,
          descKo: koDesc, answerKo: koAns, distractorsKo: koDis,
          descI18n: di, answerI18n: ai, distractorsI18n: xi,
          sortOrder: row?.sort_order ?? 0,
        },
      })
      if (r.dropped?.length) alert(`${r.dropped.map((l) => LANG_LABEL[l] ?? l).join('·')} 은(는) 덜 채워져 저장에서 제외했습니다.`)
      if (r.clearedTranslations) alert('한국어를 고쳐서 옛 번역을 비웠습니다. 🌐 자동 번역으로 다시 채워주세요.')
      draft.clear()
      onSaved()
    } catch (e) {
      setMsg('실패: ' + (e instanceof Error ? e.message : String(e)))
      setBusy(false)
    }
  }

  return (
    <div className="admin-modal-bg">
      {/* ⚠️ 바깥을 눌러도 닫지 않는다 — 입력하던 내용이 통째로 날아간다(닫기는 ✕·취소 버튼으로). */}
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <button className="admin-modal-x" onClick={onClose}>✕</button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>{isNew ? '문항 추가' : `문항 수정 ${row?.code ?? ''}`}</h2>
          <DraftBar status={draft.status} savedAt={draft.savedAt} drafts={draft.drafts} onRefresh={draft.refresh} onRestore={(p: any) => { setField(p.field); setActive(p.active); setDi(p.di); setAi(p.ai); setXi(p.xi) }} />
        </div>

        <div className="admin-toolbar" style={{ marginTop: 12 }}>
          {ALL.map((l) => (
            <button key={l} className={`admin-mini${lang === l ? ' on' : ''}`} onClick={() => setLang(l)}>
              {LANG_LABEL[l]}{l !== 'ko' && (trDone.includes(l as typeof LANGS[number]) ? ' ✓' : ' —')}
            </button>
          ))}
          <button className="admin-mini" disabled={busy || !koReady} onClick={translate}>🌐 자동 번역</button>
        </div>
        {koChanged && (
          <p className="admin-hint" style={{ color: '#d08a1a', marginTop: 8 }}>
            ⚠️ 한국어를 고쳤습니다 — 저장하면 옛 번역 5개국어가 비워집니다(옛 문장이 그대로 남으면 외국어로 하는 사람만 다른 문제를 풉니다).
          </p>
        )}

        <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
          {lang === 'ko' && (
            <label style={fld}>분야
              <select style={inp} value={field} onChange={(e) => setField(e.target.value)}>
                {TERM_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
          )}
          <label style={fld}>설명(문제문) · {LANG_LABEL[lang]}
            <textarea style={{ ...inp, minHeight: 72 }} value={di[lang] ?? ''}
              onChange={(e) => setDi({ ...di, [lang]: e.target.value })} />
          </label>
          <label style={fld}>정답 용어 · {LANG_LABEL[lang]}
            <input style={inp} value={ai[lang] ?? ''} onChange={(e) => setAi({ ...ai, [lang]: e.target.value })} />
          </label>
          {[0, 1, 2].map((i) => (
            <label key={i} style={fld}>오답 {i + 1} · {LANG_LABEL[lang]}
              <input style={inp} value={xi[lang]?.[i] ?? ''} onChange={(e) => setDis(lang, i, e.target.value)} />
            </label>
          ))}
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--fs-sm)' }}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            사용(끄면 게임에 안 나갑니다)
          </label>
        </div>

        {msg && <p className="admin-msg" style={{ marginTop: 10 }}>{msg}</p>}
        <div className="admin-modal-btns" style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="admin-mini" onClick={onClose}>취소</button>
          <button className="btn-ink" disabled={busy} onClick={save}>{busy ? '처리 중…' : '저장'}</button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// 문항 이력 — 변경 로그 + 중지/삭제된 문항 되돌리기
// ══════════════════════════════════════════════════════════════
function EventsTab() {
  const [tab, setTab] = useState<'history' | 'inactive' | 'deleted'>('history')
  const [events, setEvents] = useState<TermEvent[]>([])
  const [inactive, setInactive] = useState<TermRow[]>([])
  const [deleted, setDeleted] = useState<TermRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')

  async function load() {
    setLoading(true); setErr('')
    try {
      const [e, r] = await Promise.all([
        callFunction<{ rows: TermEvent[] }>('admin', { action: 'termEvents' }),
        callFunction<{ inactive: TermRow[]; deleted: TermRow[] }>('admin', { action: 'termRestorable' }),
      ])
      setEvents(e.rows ?? []); setInactive(r.inactive ?? []); setDeleted(r.deleted ?? [])
    } catch (ex) { setErr(ex instanceof Error ? ex.message : '불러오기 실패') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  async function restore(t: TermRow) {
    if (!confirm(`${t.code ?? '이 문항'} 을(를) 문항 목록으로 되돌릴까요?`)) return
    try { await callFunction('admin', { action: 'termRestore', id: t.id }); await load() }
    catch (e) { alert(e instanceof Error ? e.message : '되돌리기 실패') }
  }

  const match = (s: string) => !q.trim() || s.includes(q.trim())
  const evView = events.filter((e) => match(e.code ?? '') || match(String(e.detail?.answer ?? '')))
  const rows = (tab === 'inactive' ? inactive : deleted).filter((t) => match(t.code ?? '') || match(koOf(t)))
  const TABS: [typeof tab, string][] = [['history', '히스토리'], ['inactive', '중지'], ['deleted', '삭제']]

  return (
    <>
      <ErrBox msg={err} />
      <div className="admin-section">
        <div className="admin-toolbar">
          <div className="admin-tabs admin-tabs-sub">
            {TABS.map(([f, label]) => (
              <button key={f} className={tab === f ? 'on' : ''} onClick={() => setTab(f)}>
                {label} <span style={{ opacity: 0.6 }}>{f === 'history' ? events.length : f === 'inactive' ? inactive.length : deleted.length}</span>
              </button>
            ))}
          </div>
          <input className="admin-search" placeholder="번호·용어 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="admin-mini" onClick={load} disabled={loading}>새로고침</button>
        </div>

        {tab === 'history' ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>시각</th><th>번호</th><th>한 일</th><th>용어</th><th>관리자</th></tr></thead>
              <tbody>
                {evView.map((e) => (
                  <tr key={e.id}>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{fmtDT(e.created_at)}</td>
                    <td style={{ whiteSpace: 'nowrap', fontWeight: 700, color: '#3f8fd6' }}>{e.code ?? '-'}</td>
                    <td>{ACTION_LABEL[e.action] ?? e.action}</td>
                    <td>{String(e.detail?.answer ?? '')}</td>
                    <td style={{ color: 'var(--muted)' }}>{e.actor ?? '-'}</td>
                  </tr>
                ))}
                {!evView.length && !loading && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>기록이 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>번호</th><th>분야</th><th>정답 용어</th><th>설명</th><th></th></tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td style={{ whiteSpace: 'nowrap', fontWeight: 700, color: '#3f8fd6' }}>{t.code ?? '-'}</td>
                    <td><span className="badge">{t.field}</span></td>
                    <td><b>{koOf(t)}</b></td>
                    <td style={{ maxWidth: 380, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t.desc_i18n?.ko}
                    </td>
                    <td><button className="admin-mini" onClick={() => restore(t)}>되돌리기</button></td>
                  </tr>
                ))}
                {!rows.length && !loading && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                    {tab === 'inactive' ? '중지된 문항이 없습니다.' : '삭제된 문항이 없습니다.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

// ══════════════════════════════════════════════════════════════
// 문항 추가 & 번역 — 엑셀 일괄 등록
// ══════════════════════════════════════════════════════════════
// 헤더 자동 인식. 레벨테스트 업로드 탭과 같은 방식(별칭 목록 → 컬럼 위치).
const HEAD_ALIAS: Record<string, string[]> = {
  field: ['분야', '영역', '카테고리', '분류', 'field'],
  desc: ['설명', '문제', '문항', '질문', 'desc', 'question'],
  answer: ['정답', '정답용어', '용어', 'answer', 'term'],
}
const normKey = (s: string) => String(s ?? '').replace(/\s/g, '').toLowerCase()
function findCol(header: string[], aliases: string[]): number {
  const h = header.map(normKey)
  for (const a of aliases) { const i = h.indexOf(normKey(a)); if (i >= 0) return i }
  for (let i = 0; i < h.length; i++) if (h[i] && aliases.some((a) => h[i].includes(normKey(a)))) return i
  return -1
}

interface UpRow { field: string; desc: string; answer: string; distractors: string[] }

function UploadTab({ onApplied }: { onApplied: (codes: string[]) => void }) {
  const [rows, setRows] = useState<UpRow[]>([])
  const [fileName, setFileName] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [progress, setProgress] = useState('')

  function ingest(aoa: string[][]) {
    // 머리글 행 찾기 — 앞 15줄에서 '정답'·'설명'이 같이 있는 줄.
    let hr = 0
    for (let i = 0; i < Math.min(15, aoa.length); i++) {
      if (findCol(aoa[i] ?? [], HEAD_ALIAS.answer) >= 0 && findCol(aoa[i] ?? [], HEAD_ALIAS.desc) >= 0) { hr = i; break }
    }
    const head = aoa[hr] ?? []
    const cField = findCol(head, HEAD_ALIAS.field)
    const cDesc = findCol(head, HEAD_ALIAS.desc)
    const cAns = findCol(head, HEAD_ALIAS.answer)
    // 오답 = '오답'/'보기' 로 시작하는 열 전부. 없으면 정답 바로 오른쪽 3칸.
    let cDis = head.map((x, i) => ({ x: normKey(x), i })).filter((o) => /오답|보기|선택지|distractor|option/.test(o.x)).map((o) => o.i)
    if (cDis.length < 3 && cAns >= 0) cDis = [cAns + 1, cAns + 2, cAns + 3]
    if (cDesc < 0 || cAns < 0) { setMsg('머리글에서 「설명」·「정답」 열을 못 찾았습니다. 열 이름을 확인해주세요.'); setRows([]); return }
    const out: UpRow[] = []
    for (const r of aoa.slice(hr + 1)) {
      const desc = String(r[cDesc] ?? '').trim()
      const answer = String(r[cAns] ?? '').trim()
      const dis = cDis.map((c) => String(r[c] ?? '').trim()).filter(Boolean).slice(0, 3)
      if (!desc || !answer || dis.length < 3) continue
      out.push({ field: String(r[cField] ?? 'AI').trim() || 'AI', desc, answer, distractors: dis })
    }
    setRows(out)
    setMsg(out.length ? `${out.length}문항을 읽었습니다. 아래에서 확인하고 「등록 + 번역」을 누르세요.` : '읽을 수 있는 문항이 없습니다(설명·정답·오답3이 모두 있어야 합니다).')
  }

  function handleFile(file: File) {
    setFileName(file.name)
    const r = new FileReader()
    r.onload = (e) => {
      const wb = XLSX.read(e.target?.result, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '', raw: false })
        .filter((row) => row.some((c) => String(c).trim() !== ''))
      ingest(aoa)
    }
    r.readAsArrayBuffer(file)
  }

  /**
   * ⛔ **문항을 먼저 저장하고 번역을 이어서 돌린다**(CARIS 업로드와 같은 순서).
   *    번역 중에 창을 닫아도 문항은 DB 에 있고, 남은 번역은 목록의 「🌐 미번역 번역」이 그대로 이어받는다.
   * ⚠️ 번역에서 터져도 "업로드 실패"로 띄우지 않는다 — 관리자가 문항까지 안 들어간 줄 알고 같은 파일을
   *    다시 올려 **중복 문항**을 만든다.
   */
  async function apply() {
    if (!rows.length) return
    setBusy(true)
    setMsg('등록 중…')
    let inserted: { id: string; code: string; answer: string }[] = []
    try {
      const r = await callFunction<{ added: number; inserted?: typeof inserted }>('admin', { action: 'termImport', items: rows })
      inserted = r.inserted ?? []
      if (!r.added) { setMsg('새로 추가된 문항이 없습니다(이미 있는 용어는 건너뜁니다).'); setBusy(false); return }
      setMsg(`✅ ${r.added}문항 등록됨. 이어서 번역합니다…`)
    } catch (e) {
      setMsg('등록 실패: ' + (e instanceof Error ? e.message : String(e)))
      setBusy(false)
      return
    }
    // ── 번역(등록된 것만) ──
    try {
      const byAnswer = new Map(rows.map((r) => [r.answer, r]))
      const targets = inserted.filter((i) => byAnswer.has(i.answer))
      const items: TransItem[] = targets.map((i) => {
        const src = byAnswer.get(i.answer)!
        return { prompt: src.desc, options: [src.answer, ...src.distractors], explanation: '' }
      })
      let chain: Promise<unknown> = Promise.resolve()
      const done = new Set<number>()
      const saveBatch = (results: TransResult[]) => {
        const out: Record<string, unknown>[] = []
        results.forEach((res, i) => {
          if (!res || !('tr' in res) || done.has(i)) return
          done.add(i)
          const descI18n: Record<string, string> = {}, answerI18n: Record<string, string> = {}, distractorsI18n: Record<string, string[]> = {}
          for (const l of LANGS) {
            const t = res.tr[l]
            if (!t?.prompt || !Array.isArray(t.options) || t.options.length !== 4) continue
            descI18n[l] = t.prompt; answerI18n[l] = t.options[0]; distractorsI18n[l] = t.options.slice(1, 4)
          }
          if (Object.keys(descI18n).length) out.push({ id: targets[i].id, descI18n, answerI18n, distractorsI18n })
        })
        if (out.length) chain = chain.then(() => callFunction('admin', { action: 'termTransSave', rows: out })).catch(() => {})
      }
      const results = await runTranslation(items, [...LANGS], (d, total) => setProgress(`번역 ${d}/${total}`), { onBatch: saveBatch })
      saveBatch(results)
      await chain
      setProgress('')
      onApplied(targets.map((t) => t.code))
    } catch {
      // 번역 실패해도 문항은 들어갔다 — 목록에서 이어서 번역하면 된다.
      setProgress('')
      setMsg('문항은 등록됐지만 번역이 끊겼습니다. 「문항 목록 > 🌐 미번역 번역」으로 이어서 하세요.')
      setBusy(false)
    }
  }

  return (
    <>
      <div className="admin-section">
        <h3>엑셀로 문항 올리기</h3>
        <p className="admin-hint" style={{ lineHeight: 1.7 }}>
          열 이름에 <b>설명 · 정답 · 오답1~3</b>(과 선택적으로 <b>분야</b>)이 있으면 자동으로 인식합니다.
          <br />등록하면 <b>5개국어 번역이 이어서 돕니다</b> — 도중에 창을 닫아도 문항은 남고, 남은 번역은 목록에서 이어서 할 수 있습니다.
          <br />⚠️ 이미 있는 정답 용어는 건너뜁니다(같은 파일을 두 번 올려도 중복되지 않습니다).
        </p>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f) }}
          style={{
            border: `2px dashed ${dragOver ? '#3f8fd6' : 'var(--line)'}`, borderRadius: 14, padding: '26px 18px',
            textAlign: 'center', background: dragOver ? 'rgba(63,143,214,.06)' : 'transparent', marginTop: 10,
          }}
        >
          <p style={{ margin: '0 0 10px', color: 'var(--muted)', fontSize: 'var(--fs-sm)' }}>
            {fileName ? `📄 ${fileName}` : '엑셀 파일(.xlsx)을 여기로 끌어놓거나'}
          </p>
          <label className="admin-mini" style={{ cursor: 'pointer' }}>
            파일 선택
            <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
          </label>
        </div>
        {msg && <p className="admin-msg" style={{ marginTop: 10 }}>{msg}{progress && ` · ${progress}`}</p>}
      </div>

      {rows.length > 0 && (
        <div className="admin-section">
          <div className="admin-toolbar">
            <b>미리보기 {rows.length}문항</b>
            <button className="btn-ink" disabled={busy} onClick={apply}>{busy ? '처리 중…' : '등록 + 번역'}</button>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>분야</th><th>정답 용어</th><th>설명</th><th>오답 3개</th></tr></thead>
              <tbody>
                {rows.slice(0, 100).map((r, i) => (
                  <tr key={i}>
                    <td><span className="badge">{r.field}</span></td>
                    <td><b>{r.answer}</b></td>
                    <td style={{ maxWidth: 340, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.desc}</td>
                    <td style={{ color: 'var(--muted)', fontSize: 'var(--fs-sm)' }}>{r.distractors.join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 100 && <p className="admin-hint">…앞 100개만 미리 보여줍니다(등록은 전부 됩니다).</p>}
        </div>
      )}
    </>
  )
}
