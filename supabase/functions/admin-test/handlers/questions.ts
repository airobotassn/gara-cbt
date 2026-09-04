// 문항: 목록 · 통계 · upsert(추가/수정) · 활성토글 · 삭제 · 복구 · 변경이력
//  변경(수정/비활성/활성/삭제)은 세 제도 공용 이력 표(question_history)에 kind='leveltest' 로 한 줄씩
//  적재 → "문항 이력" 탭의 원천. 옛 전용 표 question_events 의 code→label · level→scope 자리다.
//  CARIS ARENA 이관: questions→test_questions.
import { json } from '../../_shared/cors.ts'
import { axisKeysForLevel, SUPPORTED_LANGS, MAX_LEVEL, VISIBLE_OPTIONS_BY_LEVEL } from '../../_shared/scoring.ts'
import { logQuestionEvent, readQuestionHistory } from '../../_shared/question-history.ts'

interface QRow {
  id?: string
  level: number
  category: string
  correct_index: number
  prompt_i18n: Record<string, string>
  options_i18n: Record<string, string[]>
  explanation_i18n?: Record<string, string>
  active?: boolean
}

// 어떤 언어가 비었는지(번역 누락) 계산
function missingLangs(row: { prompt_i18n: any; options_i18n: any }): string[] {
  const miss: string[] = []
  for (const lang of SUPPORTED_LANGS) {
    const p = row.prompt_i18n?.[lang]
    const o = row.options_i18n?.[lang]
    if (!p || !Array.isArray(o) || o.length === 0) miss.push(lang)
  }
  return miss
}

// 이벤트 한 줄 적재(실패해도 본 작업은 막지 않음)
async function logEvent(
  admin: any,
  e: { question_id: string | null; code: string | null; level: number | null; action: string; actor: string; detail?: unknown },
) {
  await logQuestionEvent(admin, 'leveltest', {
    question_id: e.question_id,
    label: e.code,
    scope: e.level,
    action: e.action,
    actor: e.actor,
    detail: e.detail,
  })
}

// 메인 목록 = 활성 & 미삭제만 (= 손 안 댄 것 + 수정된 것). 비활성/삭제는 이력 탭에서.
export async function listQuestions(admin: any, body: any) {
  let q = admin
    .from('test_questions')
    .select('id, code, level, category, correct_index, prompt_i18n, options_i18n, explanation_i18n, active')
    .is('deleted_at', null)
    .eq('active', true)
    .order('level', { ascending: true })
    .order('code', { ascending: true })
    .limit(2000)
  if (typeof body.level === 'number') q = q.eq('level', body.level)
  const { data, error } = await q
  if (error) return json({ error: error.message }, 500)
  const rows = (data ?? []).map((r: any) => ({ ...r, missing: missingLangs(r) }))
  return json({ rows })
}

export async function statsQuestions(admin: any) {
  const { data, error } = await admin
    .from('test_questions')
    .select('level, category, active, prompt_i18n, options_i18n')
    .is('deleted_at', null)
    .limit(5000)
  if (error) return json({ error: error.message }, 500)
  const pool: Record<string, { total: number; active: number }> = {}
  const cov: Record<string, number> = {} // lang → 채워진 문항 수
  let total = 0
  for (const r of data ?? []) {
    total++
    const key = `${r.level}/${r.category}`
    pool[key] ??= { total: 0, active: 0 }
    pool[key].total++
    if (r.active) pool[key].active++
    for (const lang of SUPPORTED_LANGS) {
      const p = (r as any).prompt_i18n?.[lang]
      if (p) cov[lang] = (cov[lang] ?? 0) + 1
    }
  }
  return json({ total, pool, coverage: cov })
}

// 수정 전/후 변경 필드 추출
function diffFields(before: any, after: QRow): Record<string, { before: unknown; after: unknown }> {
  const d: Record<string, { before: unknown; after: unknown }> = {}
  const eq = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  if (before.category !== after.category) d.category = { before: before.category, after: after.category }
  if (before.correct_index !== after.correct_index) d.correct_index = { before: before.correct_index, after: after.correct_index }
  if (!eq(before.prompt_i18n, after.prompt_i18n)) d.prompt_i18n = { before: before.prompt_i18n, after: after.prompt_i18n }
  if (!eq(before.options_i18n, after.options_i18n)) d.options_i18n = { before: before.options_i18n, after: after.options_i18n }
  if (!eq(before.explanation_i18n ?? {}, after.explanation_i18n ?? {})) d.explanation_i18n = { before: before.explanation_i18n ?? {}, after: after.explanation_i18n ?? {} }
  if (!!before.active !== (after.active ?? true)) d.active = { before: !!before.active, after: after.active ?? true }
  return d
}

export async function upsertQuestions(admin: any, body: any, actor: string) {
  const rows: QRow[] = Array.isArray(body.rows) ? body.rows : []
  if (!rows.length) return json({ error: 'rows 비어있음' }, 400)
  // 검증
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (typeof r.level !== 'number' || r.level < 1 || r.level > MAX_LEVEL) {
      return json({ error: `#${i + 1}: level 오류` }, 400)
    }
    if (!axisKeysForLevel(r.level).includes(r.category)) {
      return json({ error: `#${i + 1}: 카테고리 코드(${r.category})가 레벨 ${r.level}에 없음` }, 400)
    }
    const koOpts = r.options_i18n?.ko
    if (!Array.isArray(koOpts) || koOpts.length < 2) {
      return json({ error: `#${i + 1}: 보기(ko)가 2개 미만` }, 400)
    }
    if (typeof r.correct_index !== 'number' || r.correct_index < 0 || r.correct_index >= koOpts.length) {
      return json({ error: `#${i + 1}: 정답 인덱스 범위 오류` }, 400)
    }
    // 보기 개수는 레벨이 정한다(Lv.1~4 4개 / Lv.5~7 5개). 개수가 어긋나면 응시 화면에서
    // 잘려 나가고, 정답이 잘린 자리에 있으면 아무도 못 맞히는 문항이 된다.
    const cap = VISIBLE_OPTIONS_BY_LEVEL[r.level]
    if (typeof cap === 'number' && koOpts.length !== cap) {
      return json({ error: `#${i + 1}: 레벨 ${r.level}은 보기 ${cap}개 고정입니다(받은 값 ${koOpts.length}개).` }, 400)
    }
    for (const lang of SUPPORTED_LANGS) {
      const o = r.options_i18n?.[lang]
      if (o && o.length !== koOpts.length) {
        return json({ error: `#${i + 1}: ${lang} 보기 개수 불일치` }, 400)
      }
    }
  }

  // 수정(id 있음) 전 상태 조회 — 변경 이력 diff 용
  const idRows = rows.filter((r) => r.id)
  const beforeById: Record<string, any> = {}
  if (idRows.length) {
    const ids = idRows.map((r) => r.id as string)
    const { data: prev } = await admin
      .from('test_questions')
      .select('id, code, level, category, correct_index, prompt_i18n, options_i18n, explanation_i18n, active')
      .in('id', ids)
    for (const p of prev ?? []) beforeById[p.id] = p
  }

  // 새 문항(id 없음)에 사람용 번호(code) 자동 부여: L{level}-{NNN}
  //
  // ⛔ **같은 지문이 이미 있으면 그 줄은 넣지 않는다(2026-09-02).** 여기엔 중복 검사가 없어서
  //    같은 엑셀을 두 번 반영하면 글이 글자까지 같은 문항이 번호만 다르게 한 벌 더 생겼고,
  //    출제는 **행 번호로만** 중복을 거르므로 한 응시에 같은 문제가 두 번 나왔다
  //    (2026-09-02 Lv.1 실제 사고 — 8초 간격으로 29개가 두 번 들어갔다. 7월 Lv.4 도 같은 사고).
  //    ⚠️ **통째로 거절하지 않고 줄 단위로 건너뛴다** — 30개 중 3개만 새로 넣는 정상 작업을 막으면 안 된다.
  //    ⚠️ 비교는 **공백만 정리한 완전일치**다. 비슷한 문장까지 잡으면 멀쩡한 새 문항이 조용히 사라진다 —
  //       그건 사람이 판단할 일이라 화면에 남겨 둔다.
  //    ⚠️ 판정 대상은 **활성 문항**뿐이다. 비활성·삭제분까지 보면 예전에 내렸던 문항을 다시 못 올린다.
  //    ⚠️ 동시 요청 둘이 같이 통과하는 틈은 남는다(2026-09-02 지시 — 관리자가 소수라 DB 유니크는 안 건다).
  const newRows = rows.filter((r) => !r.id)
  const seqByLevel: Record<number, number> = {}
  const koSeen: Record<number, Set<string>> = {} // 레벨 → 이미 있는(또는 이번에 넣기로 한) 한국어 지문
  if (newRows.length) {
    const levels = [...new Set(newRows.map((r) => r.level))]
    // 번호를 매기려고 어차피 그 레벨을 통째로 읽는다 — 지문 컬럼만 얹으면 조회는 그대로 한 번이다.
    const { data: ex } = await admin
      .from('test_questions')
      .select('level, code, active, prompt_i18n')
      .in('level', levels)
    for (const lv of levels) {
      seqByLevel[lv] = maxCodeSeq(ex ?? [], lv)
      koSeen[lv] = new Set<string>()
    }
    for (const e of ex ?? []) {
      if (!e.active) continue
      const k = normKo(e.prompt_i18n?.ko)
      if (k && koSeen[e.level]) koSeen[e.level].add(k)
    }
  }

  // 걸러낸 줄 — 화면이 "몇 개가 이미 있어서 빠졌는지" 를 말해줄 수 있게 번호를 모아 돌려준다.
  const skipped: { num: number; ko: string }[] = []
  const kept = rows.filter((r, i) => {
    if (r.id) return true // 수정은 대상이 아니다
    const k = normKo(r.prompt_i18n?.ko)
    if (!k) return true
    const seen = koSeen[r.level]
    if (seen?.has(k)) {
      skipped.push({ num: i + 1, ko: k.slice(0, 60) })
      return false
    }
    seen?.add(k) // 같은 파일 안에서 두 번 나온 것도 여기서 걸린다
    return true
  })
  if (!kept.length) {
    return json({ ok: true, count: 0, skipped: skipped.length, skippedRows: skipped, codes: [] })
  }

  const payload = kept.map((r) => {
    const base = {
      level: r.level,
      category: r.category,
      correct_index: r.correct_index,
      prompt_i18n: r.prompt_i18n,
      options_i18n: r.options_i18n,
      explanation_i18n: r.explanation_i18n ?? {},
      active: r.active ?? true,
    }
    if (r.id) return { id: r.id, ...base }
    const n = (seqByLevel[r.level] = (seqByLevel[r.level] ?? 0) + 1)
    return { code: `L${r.level}-${String(n).padStart(3, '0')}`, ...base }
  })
  const { data, error } = await admin.from('test_questions').upsert(payload).select('id, code, level')
  if (error) return json({ error: error.message }, 500)

  // 수정 이벤트 기록(실제로 바뀐 필드가 있을 때만)
  for (const r of kept) {
    if (!r.id) continue
    const before = beforeById[r.id]
    if (!before) continue
    const detail = diffFields(before, r)
    if (Object.keys(detail).length === 0) continue
    await logEvent(admin, { question_id: r.id, code: before.code ?? null, level: r.level, action: 'edit', actor, detail })
  }

  // ⛔ **문항 추가도 이력에 남긴다(2026-09-02).** 여태 delete·edit·activate·deactivate 만 남고 추가는
  //    한 줄도 안 남아서, 같은 파일이 두 번 들어가도 **나중에 알아볼 방법이 자체가 없었다**
  //    (Lv.1 사고를 엣지 함수 로그로 겨우 찾았다 — 그건 보존 기간이 짧아 며칠 뒤면 사라진다).
  //    ⚠️ 새 화면 배지(EvBadge)에 'add' 를 안 넣으면 추가가 **빨간 '삭제'로 뜬다**(모르는 값은 그리로 떨어진다).
  //    ⚠️ `in` 으로 좁힌다 — payload 는 위 upsert 분기 때문에 **두 모양의 유니온**이다
  //       ({ id, …base } = 기존 문항 / { code, …base } = 새 문항). `{ id?: string }` 같은 인라인
  //       주석으로는 두 번째 멤버와 공통 속성이 0개라 어느 오버로드에도 안 맞아 deno check 가 깨진다.
  //       ⛔ `supabase functions deploy` 는 타입체크를 안 하므로 배포는 그냥 통과한다 — 안 보고 지나가기 쉽다.
  const newCodes = new Set(payload.flatMap((p) => ('id' in p ? [] : [p.code])))
  const added = (data ?? []).filter((d: { code: string | null }) => d.code && newCodes.has(d.code))
  for (const a of added) {
    await logEvent(admin, { question_id: a.id, code: a.code, level: a.level, action: 'add', actor })
  }

  return json({
    ok: true,
    count: data?.length ?? 0,
    skipped: skipped.length,
    skippedRows: skipped,
    // 화면이 "방금 넣은 것만 보기" 를 걸 수 있게 번호를 돌려준다.
    //   ⚠️ 정렬해서 준다 — upsert 가 돌려주는 순서는 보장이 없는데, 화면은 이걸로 "L1-142 ~ L1-171"
    //      처럼 범위를 그린다(안 맞추면 시작·끝이 뒤죽박죽으로 뜬다).
    codes: added.map((a: { code: string | null }) => a.code).filter(Boolean).sort(),
  })
}

/** 지문 비교용 정규화 — 앞뒤 공백과 연속 공백만 정리한다(그 이상은 사람이 판단할 몫). */
function normKo(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''
}

// 코드 목록에서 그 레벨의 최대 일련번호 (L{lv}-NNN 의 NNN)
function maxCodeSeq(rows: { level: number; code: string | null }[], level: number): number {
  let max = 0
  for (const r of rows) {
    if (r.level !== level || !r.code) continue
    const m = /-(\d+)\s*$/.exec(r.code)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return max
}

export async function setActive(admin: any, body: any, actor: string) {
  if (!body.id) return json({ error: 'id 필요' }, 400)
  const active = !!body.active
  const { data: before } = await admin.from('test_questions').select('code, level').eq('id', body.id).maybeSingle()
  const { error } = await admin.from('test_questions').update({ active }).eq('id', body.id)
  if (error) return json({ error: error.message }, 500)
  await logEvent(admin, { question_id: body.id, code: before?.code ?? null, level: before?.level ?? null, action: active ? 'activate' : 'deactivate', actor })
  return json({ ok: true })
}

// 소프트 삭제 — deleted_at + active=false. 행 보존(결과창은 "삭제된 문항"으로 표시).
export async function deleteQuestion(admin: any, body: any, actor: string) {
  if (!body.id) return json({ error: 'id 필요' }, 400)
  const { data: before } = await admin.from('test_questions').select('code, level').eq('id', body.id).maybeSingle()
  const { error } = await admin
    .from('test_questions')
    .update({ deleted_at: new Date().toISOString(), active: false })
    .eq('id', body.id)
  if (error) return json({ error: error.message }, 500)
  await logEvent(admin, { question_id: body.id, code: before?.code ?? null, level: before?.level ?? null, action: 'delete', actor })
  return json({ ok: true })
}

// 되돌리기 — 비활성/삭제된 문항을 다시 활성 & 미삭제로.
export async function restoreQuestion(admin: any, body: any, actor: string) {
  if (!body.id) return json({ error: 'id 필요' }, 400)
  const { data: before } = await admin.from('test_questions').select('code, level').eq('id', body.id).maybeSingle()
  const { error } = await admin
    .from('test_questions')
    .update({ active: true, deleted_at: null })
    .eq('id', body.id)
  if (error) return json({ error: error.message }, 500)
  await logEvent(admin, { question_id: body.id, code: before?.code ?? null, level: before?.level ?? null, action: 'activate', actor })
  return json({ ok: true })
}

// 현재 "비활성"·"삭제" 상태인 문항 목록(이벤트 로그 아님). 되돌리기 관리용.
//  - 비활성: active=false & 미삭제 / 삭제: deleted_at 있음
export async function listRestorable(admin: any) {
  const { data, error } = await admin
    .from('test_questions')
    .select('id, code, level, category, prompt_i18n, active, deleted_at')
    .or('active.eq.false,deleted_at.not.is.null')
    .order('level', { ascending: true })
    .order('code', { ascending: true })
    .limit(2000)
  if (error) return json({ error: error.message }, 500)
  const inactive: any[] = []
  const deleted: any[] = []
  for (const r of data ?? []) {
    const item = {
      id: r.id, code: r.code, level: r.level, category: r.category,
      prompt: r.prompt_i18n?.ko ?? '', deleted_at: r.deleted_at,
    }
    if (r.deleted_at) deleted.push(item)
    else if (!r.active) inactive.push(item)
  }
  return json({ inactive, deleted })
}

// 변경 이력 로그(최신순). action 필터 가능.
//  각 이벤트에 그 문항의 *현재* 복구가능 여부(restorable)를 실어준다 —
//  과거 비활성/삭제 로그라도 문항이 이미 다시 활성이면 '되돌리기'를 숨기기 위함.
export async function listEvents(admin: any, body: any) {
  const { rows: events, error } = await readQuestionHistory(admin, 'leveltest', { action: body.filter ?? null })
  if (error) return json({ error }, 500)

  // 등장하는 문항들의 현재 상태(active/deleted) 한 번에 조회
  const ids = [...new Set(events.map((e: any) => e.question_id).filter(Boolean))]
  const statusById: Record<string, { active: boolean; deleted: boolean }> = {}
  if (ids.length) {
    const { data: qs } = await admin.from('test_questions').select('id, active, deleted_at').in('id', ids)
    for (const r of qs ?? []) statusById[r.id] = { active: !!r.active, deleted: r.deleted_at != null }
  }
  // 현재 비활성이거나 삭제 상태일 때만 되돌릴 수 있음(존재하지 않으면 false)
  const withStatus = events.map((e: any) => {
    const st = e.question_id ? statusById[e.question_id] : undefined
    return { ...e, restorable: !!st && (!st.active || st.deleted) }
  })
  return json({ events: withStatus })
}
