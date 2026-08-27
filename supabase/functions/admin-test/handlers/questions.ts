// 문항: 목록 · 통계 · upsert(추가/수정) · 활성토글 · 삭제 · 복구 · 변경이력
//  변경(수정/비활성/활성/삭제)은 question_events 에 한 줄씩 적재 → "문항 이력" 탭의 원천.
//  CARIS ARENA 이관: questions→test_questions (question_events 는 유지).
import { json } from '../../_shared/cors.ts'
import { axisKeysForLevel, SUPPORTED_LANGS, MAX_LEVEL, VISIBLE_OPTIONS_BY_LEVEL } from '../../_shared/scoring.ts'

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
  try {
    await admin.from('question_events').insert({
      question_id: e.question_id,
      code: e.code,
      level: e.level,
      action: e.action,
      actor: e.actor || null,
      detail: e.detail ?? null,
    })
  } catch { /* 로그 실패는 무시 */ }
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
  const newRows = rows.filter((r) => !r.id)
  const seqByLevel: Record<number, number> = {}
  if (newRows.length) {
    const levels = [...new Set(newRows.map((r) => r.level))]
    const { data: ex } = await admin.from('test_questions').select('level, code').in('level', levels)
    for (const lv of levels) seqByLevel[lv] = maxCodeSeq(ex ?? [], lv)
  }

  const payload = rows.map((r) => {
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
  const { data, error } = await admin.from('test_questions').upsert(payload).select('id')
  if (error) return json({ error: error.message }, 500)

  // 수정 이벤트 기록(실제로 바뀐 필드가 있을 때만)
  for (const r of rows) {
    if (!r.id) continue
    const before = beforeById[r.id]
    if (!before) continue
    const detail = diffFields(before, r)
    if (Object.keys(detail).length === 0) continue
    await logEvent(admin, { question_id: r.id, code: before.code ?? null, level: r.level, action: 'edit', actor, detail })
  }
  return json({ ok: true, count: data?.length ?? 0 })
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
  let q = admin
    .from('question_events')
    .select('id, question_id, code, level, action, actor, detail, created_at')
    .order('created_at', { ascending: false })
    .limit(1000)
  if (body.filter && body.filter !== 'all') q = q.eq('action', body.filter)
  const { data, error } = await q
  if (error) return json({ error: error.message }, 500)
  const events = data ?? []

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
