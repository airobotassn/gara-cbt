// 관리자페이지 재편(PPT `관리자 페이지 수정사항`)으로 새로 생긴 액션들 — 2026-08-11.
//   index.ts 가 이미 2.6k줄이라 여기로 분리했다. 게이트(관리자 여부)는 index.ts 가 이미 통과시킨 뒤 부른다.
//   ⚠️ 돈·자격을 만드는 액션(자격증 수동 발급)은 루트 전용이다 — index.ts 의 기존 구분과 같은 규칙.
import { json } from '../_shared/cors.ts'

interface Ctx { email: string; isRoot: boolean; uid: string | null }

/** 되돌릴 수 없는 조작을 남긴다. 실패해도 본 작업을 막지 않는다(로그 때문에 운영이 멈추면 안 된다). */
async function audit(admin: any, ctx: Ctx, action: string, target: string | null, detail: unknown = {}) {
  try {
    await admin.from('admin_audit').insert({
      actor: ctx.uid, actor_email: ctx.email, action, target, detail,
    })
  } catch { /* 로그 실패는 삼킨다 */ }
}

// ── 사이트 정보 ──────────────────────────────────────────────
async function siteSettings(admin: any) {
  const { data, error } = await admin.from('site_settings').select('key, value, updated_at')
  if (error) return json({ error: error.message }, 500)
  const map: Record<string, string> = {}
  for (const r of data ?? []) map[(r as any).key] = (r as any).value ?? ''
  return json({ settings: map })
}
async function siteSettingsSave(admin: any, body: any, ctx: Ctx) {
  const patch = (body?.settings ?? {}) as Record<string, unknown>
  const rows = Object.entries(patch).map(([key, value]) => ({
    key, value: String(value ?? ''), updated_at: new Date().toISOString(), updated_by: ctx.uid,
  }))
  if (!rows.length) return json({ ok: true })
  const { error } = await admin.from('site_settings').upsert(rows, { onConflict: 'key' })
  if (error) return json({ error: error.message }, 500)
  await audit(admin, ctx, 'siteSettingsSave', null, { keys: rows.map((r) => r.key) })
  return json({ ok: true })
}

// ── 팝업 ────────────────────────────────────────────────────
async function popupList(admin: any) {
  const { data, error } = await admin.from('popups').select('*').order('sort_order').order('created_at', { ascending: false })
  if (error) return json({ error: error.message }, 500)
  return json({ popups: data ?? [] })
}
async function popupUpsert(admin: any, body: any, ctx: Ctx) {
  const p = body?.popup ?? {}
  if (!String(p.title ?? '').trim()) return json({ error: '제목을 입력하세요.' }, 400)
  if (!p.startsAt || !p.endsAt) return json({ error: '노출 기간을 정하세요.' }, 400)
  if (new Date(p.endsAt) <= new Date(p.startsAt)) return json({ error: '종료가 시작보다 빨라요.' }, 400)
  const row = {
    title: String(p.title), body: String(p.body ?? ''),
    image_url: p.imageUrl || null, link_url: p.linkUrl || null,
    device: ['pc', 'mobile', 'both'].includes(p.device) ? p.device : 'both',
    // 위치를 비워두면 아무 데도 안 뜬다 — 그건 실수일 가능성이 높으니 메인으로 접는다.
    placements: Array.isArray(p.placements) && p.placements.length ? p.placements : ['main'],
    starts_at: p.startsAt, ends_at: p.endsAt,
    active: p.active !== false, sort_order: Number(p.sortOrder ?? 0),
  }
  const q = p.id ? admin.from('popups').update(row).eq('id', p.id) : admin.from('popups').insert(row)
  const { error } = await q
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true })
}
async function popupDelete(admin: any, body: any, ctx: Ctx) {
  const id = String(body?.id ?? '')
  const { error } = await admin.from('popups').delete().eq('id', id)
  if (error) return json({ error: error.message }, 500)
  await audit(admin, ctx, 'popupDelete', id)
  return json({ ok: true })
}

// ── 정책 문서(약관·개인정보·협회소개) ────────────────────────
// ⚠️ 수정이 아니라 **새 판을 쌓는다.** 과거 버전이 남아야 약관 제3조(개정 공지)를 지킬 수 있다.
async function policyList(admin: any, body: any) {
  const doc = String(body?.doc ?? '')
  if (!['terms', 'privacy', 'about'].includes(doc)) return json({ error: '문서 종류가 잘못됐습니다.' }, 400)
  const { data, error } = await admin.from('policy_docs').select('*').eq('doc', doc).order('version', { ascending: false })
  if (error) return json({ error: error.message }, 500)
  return json({ docs: data ?? [] })
}
async function policyUpsert(admin: any, body: any, ctx: Ctx) {
  const doc = String(body?.doc ?? '')
  if (!['terms', 'privacy', 'about'].includes(doc)) return json({ error: '문서 종류가 잘못됐습니다.' }, 400)
  // 시행일은 안 넣으면 오늘(KST)이다 — 저장할 때마다 날짜를 고르게 하면 글 고치는 흐름이 끊긴다.
  const raw = String(body?.effectiveAt ?? '')
  const effective = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
  const { data: last } = await admin.from('policy_docs').select('version').eq('doc', doc)
    .order('version', { ascending: false }).limit(1).maybeSingle()
  const version = ((last as any)?.version ?? 0) + 1
  const { error } = await admin.from('policy_docs').insert({
    doc, version, body: String(body?.body ?? ''), change_note: String(body?.changeNote ?? ''),
    effective_at: effective, created_by: ctx.uid,
  })
  if (error) return json({ error: error.message }, 500)
  await audit(admin, ctx, 'policyUpsert', `${doc}#${version}`, { effective })
  return json({ ok: true, version })
}

// ── 1:1 문의 ────────────────────────────────────────────────
async function inquiryList(admin: any, body: any) {
  const status = String(body?.status ?? '')
  let sel = admin.from('inquiries').select('*', { count: 'exact' })
  if (status) sel = sel.eq('status', status)
  const { data, count, error } = await sel.order('created_at', { ascending: false }).limit(200)
  if (error) return json({ error: error.message }, 500)
  const rows = (data ?? []) as any[]
  // 작성자 이름·이메일 — 문의는 사람이 읽고 답하는 것이라 누구 것인지가 필요하다.
  const ids = [...new Set(rows.map((r) => r.user_id))]
  const nameMap: Record<string, string> = {}
  const emailMap: Record<string, string> = {}
  if (ids.length) {
    const { data: profs } = await admin.from('profiles').select('id, display_name').in('id', ids)
    for (const p of profs ?? []) nameMap[(p as any).id] = (p as any).display_name
    try {
      const { data: au } = await admin.rpc('admin_user_emails')
      for (const x of au ?? []) emailMap[(x as any).id] = (x as any).email ?? ''
    } catch { /* 이메일만 빈칸 */ }
  }
  return json({
    inquiries: rows.map((r) => ({
      id: r.id, userId: r.user_id, name: nameMap[r.user_id] ?? null, email: emailMap[r.user_id] ?? null,
      category: r.category, title: r.title, body: r.body, status: r.status,
      answer: r.answer, answeredAt: r.answered_at, createdAt: r.created_at,
    })),
    total: count ?? rows.length,
  })
}
async function inquiryAnswer(admin: any, body: any, ctx: Ctx) {
  const id = String(body?.id ?? '')
  const answer = String(body?.answer ?? '').trim()
  if (!id || !answer) return json({ error: '답변 내용을 입력하세요.' }, 400)
  // ⚠️ answer_seen_at 을 null 로 되돌린다 — 답변을 **고쳐 쓰면** 사용자 화면에 빨간 점이 다시 떠야 한다.
  //    안 그러면 한 번 읽은 문의는 답이 바뀌어도 영영 조용하다.
  const { error } = await admin.from('inquiries').update({
    answer, status: 'answered', answered_at: new Date().toISOString(), answered_by: ctx.uid,
    answer_seen_at: null,
  }).eq('id', id)
  if (error) return json({ error: error.message }, 500)
  await audit(admin, ctx, 'inquiryAnswer', id)
  return json({ ok: true })
}

// ── 이북 미리보기 ────────────────────────────────────────────
/**
 * 관리자가 **구매 없이** 이북 본문을 연다.
 * ⚠️ 사용자용 `ebooks read` 는 구매 여부를 보므로 관리자가 자기가 올린 책도 못 연다 —
 *    그래서 관리자 전용 경로가 따로 필요하다(게이트는 index.ts 가 이미 통과시켰다).
 * ⚠️ 서명 URL 을 그대로 iframe 에 물리면 안 된다 — Supabase Storage 가 HTML 을 text/plain 으로 주기 때문에
 *    소스가 그대로 보인다. 화면에서 받아 srcdoc 으로 넣는다(사용자 뷰어와 같은 방식).
 */
async function ebookPreview(admin: any, body: any) {
  const id = String(body?.id ?? '').trim()
  if (!id) return json({ error: '이북을 지정하세요.' }, 400)
  const langWant = String(body?.lang ?? 'ko')
  const { data: book } = await admin.from('ebooks')
    .select('id, title, author, storage_path, translations').eq('id', id).maybeSingle()
  if (!book) return json({ error: '이북을 찾을 수 없습니다.' }, 404)
  const tr = ((book as any).translations ?? {}) as Record<string, { path?: string }>
  const path = tr[langWant]?.path || (book as any).storage_path
  if (!path) return json({ error: '아직 본문 파일이 올라가지 않았습니다.' }, 400)
  const { data: signed, error } = await admin.storage.from('ebooks').createSignedUrl(path, 60 * 30)
  if (error || !signed?.signedUrl) return json({ error: error?.message ?? '본문을 불러올 수 없습니다.' }, 400)
  return json({
    id: (book as any).id, title: (book as any).title, url: signed.signedUrl,
    langs: ['ko', ...Object.keys(tr)].filter((v, i, a) => a.indexOf(v) === i),
    lang: tr[langWant]?.path ? langWant : 'ko',
  })
}

// ── 강의(콘텐츠) ────────────────────────────────────────────
/** 유튜브 주소/ID 무엇을 넣어도 ID 로 접는다 — 관리자가 주소를 그대로 붙여넣는 게 자연스럽다. */
function youtubeId(raw: string): string | null {
  const s = raw.trim()
  if (/^[\w-]{11}$/.test(s)) return s
  const m = s.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/)
  return m ? m[1] : null
}
async function lectureList(admin: any, body: any) {
  const catalog = body?.catalog === 'caris' ? 'caris' : 'leveltest'
  const { data, error } = await admin.from('lectures').select('*').eq('catalog', catalog)
    .order('sort_order').order('created_at')
  if (error) return json({ error: error.message }, 500)
  return json({ lectures: data ?? [] })
}
async function lectureUpsert(admin: any, body: any) {
  const l = body?.lecture ?? {}
  const vid = youtubeId(String(l.youtubeId ?? ''))
  if (!vid) return json({ error: '유튜브 주소(또는 영상 ID)를 확인해 주세요.' }, 400)
  if (!String(l.title ?? '').trim()) return json({ error: '제목을 입력하세요.' }, 400)
  const catalog = l.catalog === 'caris' ? 'caris' : 'leveltest'
  const row = {
    catalog,
    // 한 강의는 한 카탈로그에만 속한다(DB CHECK 과 같은 규칙) — 반대편 분류는 반드시 비운다.
    target_level: catalog === 'leveltest' ? (l.targetLevel ?? null) : null,
    target_tier: catalog === 'caris' ? (l.targetTier ?? null) : null,
    youtube_id: vid, title: String(l.title), channel: String(l.channel ?? ''),
    description: String(l.description ?? ''),
    published: l.published !== false, sort_order: Number(l.sortOrder ?? 0),
  }
  const q = l.id ? admin.from('lectures').update(row).eq('id', l.id) : admin.from('lectures').insert(row)
  const { error } = await q
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true })
}
async function lectureDelete(admin: any, body: any, ctx: Ctx) {
  const id = String(body?.id ?? '')
  const { error } = await admin.from('lectures').delete().eq('id', id)
  if (error) return json({ error: error.message }, 500)
  await audit(admin, ctx, 'lectureDelete', id)
  return json({ ok: true })
}

// ── 적립 정책(코인·시즌 점수) ────────────────────────────────
async function rewardPolicy(admin: any) {
  const { data, error } = await admin.from('reward_policy').select('*').order('wallet').order('sort_order')
  if (error) return json({ error: error.message }, 500)
  return json({ policy: data ?? [] })
}
async function rewardPolicySave(admin: any, body: any, ctx: Ctx) {
  const rows = (body?.rows ?? []) as any[]
  if (!Array.isArray(rows) || !rows.length) return json({ error: '저장할 값이 없습니다.' }, 400)
  for (const r of rows) {
    if (Number(r.amount) < 0 || Number(r.perDay) < 0) return json({ error: '음수는 넣을 수 없습니다.' }, 400)
    const { error } = await admin.from('reward_policy').update({
      amount: Number(r.amount), per_day: Number(r.perDay), active: r.active !== false,
      updated_at: new Date().toISOString(),
    }).eq('wallet', r.wallet).eq('kind', r.kind)
    if (error) return json({ error: error.message }, 500)
  }
  await audit(admin, ctx, 'rewardPolicySave', null, { n: rows.length })
  return json({ ok: true })
}

// ── 허브 꾸미기(캐릭터·스킨·가구) 가격표 ─────────────────────
//
// ⚠️ 여기서 다루는 건 **가격·판매여부·진열순서 셋뿐**이다(2026-08-20 결정).
//    그림과 9패치 자르는 값은 코드/에셋에 있다(`src/lib/hubCosmetics.ts` · `hub.css`) —
//    스킨 한 벌이 `--skin-*-slice` 같은 숫자 15줄을 달고 다녀서, 그걸 관리자 폼으로 만들면
//    입력칸 수십 개짜리 화면이 되고 한 칸만 틀려도 판이 찌그러진다.
//    새 캐릭터·스킨을 **추가**하는 것도 여기가 아니라 배포다.
async function hubCosmetics(admin: any) {
  const { data, error } = await admin
    .from('shop_catalog')
    .select('part_key, price, kind, surface, active, sort_order')
    .order('kind')
    .order('sort_order')
  if (error) return json({ error: error.message }, 500)

  // 보유자 수 — "이 물건을 몇 명이 갖고 있나". 값을 올리기 전에 알아야 하는 숫자다.
  const owners: Record<string, number> = {}
  const { data: owned } = await admin.from('user_cosmetics').select('part_key')
  for (const o of owned ?? []) owners[(o as any).part_key] = (owners[(o as any).part_key] ?? 0) + 1

  // 장착 수 — 지금 실제로 입고 있는 사람. 보유자와 다르다(사놓고 안 입을 수 있다).
  const worn: Record<string, number> = {}
  const { data: chars } = await admin.from('user_characters').select('base_key, equipped')
  for (const c of chars ?? []) {
    const base = (c as any).base_key as string
    if (base && base !== 'default') worn[base] = (worn[base] ?? 0) + 1
    const eq = ((c as any).equipped ?? {}) as Record<string, string>
    for (const v of Object.values(eq)) if (v) worn[v] = (worn[v] ?? 0) + 1
  }

  const items = (data ?? []).map((r: any) => ({
    part_key: r.part_key, price: r.price, kind: r.kind ?? 'part',
    surface: r.surface ?? null, active: r.active !== false, sort_order: r.sort_order ?? 0,
    owners: owners[r.part_key] ?? 0, worn: worn[r.part_key] ?? 0,
  }))
  return json({ items })
}

async function hubCosmeticsSave(admin: any, body: any, ctx: Ctx) {
  const rows = (body?.rows ?? []) as any[]
  if (!Array.isArray(rows) || !rows.length) return json({ error: '저장할 값이 없습니다.' }, 400)

  const { data: current, error: readErr } = await admin.from('shop_catalog').select('part_key, price, kind, active')
  if (readErr) return json({ error: readErr.message }, 500)
  const byKey = new Map<string, any>((current ?? []).map((r: any) => [r.part_key, r]))

  // 저장 뒤의 모습을 미리 만들어 검사한다 — 한 줄씩 쓰면서 검사하면 절반만 반영된 상태로 막힌다.
  const after = new Map<string, { price: number; kind: string; active: boolean }>()
  for (const [k, r] of byKey) after.set(k, { price: r.price, kind: r.kind ?? 'part', active: r.active !== false })
  for (const r of rows) {
    const key = String(r.partKey ?? '')
    const cur = byKey.get(key)
    if (!cur) return json({ error: `없는 품목입니다: ${key}` }, 400)
    const price = Number(r.price)
    if (!Number.isInteger(price) || price < 0) return json({ error: '가격은 0 이상의 정수여야 합니다.' }, 400)
    after.set(key, { price, kind: cur.kind ?? 'part', active: r.active !== false })
  }

  // ⛔ **첫 선택 후보를 0개로 만들 수 없다.** 신규 가입자는 캐릭터를 고르기 전에는 허브를 못 쓰는데,
  //    판매 중인 캐릭터가 하나도 없으면 고를 게 없어서 **첫 화면에서 갇힌다.**
  //    진열을 잘못 내린 걸 사용자가 갇혀서야 알게 되면 늦다 → 저장 자체를 막는다.
  //    ⚠️ 값(price)은 보지 않는다 — 첫 선택은 값과 무관하게 공짜다(20260824120000).
  //       여기서 '무료 1종 이상'을 요구하면 캐릭터에 값을 매기는 것 자체가 막힌다.
  const starters = [...after.values()].filter((v) => v.kind === 'character' && v.active)
  if (!starters.length) {
    return json({ error: '판매 중인 캐릭터가 최소 1종은 있어야 합니다. 신규 회원이 첫 화면에서 캐릭터를 고를 수 없게 됩니다.' }, 400)
  }

  for (const r of rows) {
    const { error } = await admin.from('shop_catalog').update({
      price: Number(r.price),
      active: r.active !== false,
      sort_order: Number.isFinite(Number(r.sortOrder)) ? Number(r.sortOrder) : 0,
    }).eq('part_key', String(r.partKey))
    if (error) return json({ error: error.message }, 500)
  }
  await audit(admin, ctx, 'hubCosmeticsSave', null, { n: rows.length })
  return json({ ok: true })
}

// ── 미니게임·오늘의 학습 현황 ────────────────────────────────
// 데이터는 이미 쌓여 있다(minigame_scores 통산 최고 · daily_activity 일별 플래그 + 첫 접속 시각). 집계만 한다.
// ⚠️ 컬럼명은 `game_id`·`best_score`·`plays` 다(`game`·`score` 아님 — 실제로 그렇게 틀려서 500 이 났다).
/**
 * 게임별 현황 — "이 게임을 몇 명이 · 몇 번 · 언제 · 얼마나 오래 하고, 점수는 어떤가".
 * ⚠️ 전체를 뭉갠 일별 막대는 뜻이 없다(어느 게임인지 안 갈리고, 봐도 할 일이 안 생긴다) → 게임별로 쪼갠다.
 * ⚠️ 데이터 한계는 숨기지 말고 이름으로 드러낸다:
 *   · `minigame_scores` 는 **사람×게임당 최고기록 1행**이다 → 평균은 '최고기록의 평균'이지 매판 평균이 아니다.
 *   · `achieved_at` 은 **최고기록을 세운 시각**이라 시간대는 근사다(매 플레이 시각은 안 남긴다).
 *   · `tie_ms` 는 그 기록을 낼 때 걸린 시간이다 → 플레이 길이의 대용값.
 */
async function minigameStats(admin: any, body: any) {
  const days = Math.min(Math.max(1, Math.floor(Number(body?.days ?? 30))), 365)
  const since = new Date(Date.now() - days * 86400e3).toISOString()

  // 랭킹 값(최고기록·평균·참여자)은 최고기록 표에서.
  const { data: scores, error } = await admin
    .from('minigame_scores')
    .select('game_id, user_id, best_score, plays')
    .limit(50000)
  if (error) return json({ error: error.message }, 500)

  // 이용 값(평균 플레이 시간·시간대·일별)은 **매 판 기록**에서. 최고기록 표로는 낼 수 없는 값들이다.
  const { data: plays } = await admin
    .from('minigame_plays')
    .select('game_id, user_id, duration_ms, played_at')
    .gte('played_at', since)
    .limit(100000)

  type Acc = {
    players: Set<string>; n: number; sum: number; best: number; plays: number
    msSum: number; msN: number; hours: number[]; days: Record<string, number>; recent: number
  }
  const acc: Record<string, Acc> = {}
  const blank = (): Acc => ({ players: new Set(), n: 0, sum: 0, best: 0, plays: 0, msSum: 0, msN: 0, hours: Array(24).fill(0), days: {}, recent: 0 })

  for (const s of (scores ?? []) as any[]) {
    const a = (acc[s.game_id] ??= blank())
    const v = Number(s.best_score ?? 0)
    a.players.add(s.user_id); a.n++; a.sum += v
    a.best = Math.max(a.best, v)
    a.plays += Number(s.plays ?? 0)
  }
  for (const p of (plays ?? []) as any[]) {
    const a = (acc[p.game_id] ??= blank())
    a.recent++
    if (p.duration_ms != null && Number(p.duration_ms) > 0) { a.msSum += Number(p.duration_ms); a.msN++ }
    // 시간대·일별은 한국 시간 기준. UTC 로 세면 한국 저녁이 다음 날 새벽으로 잡혀 그래프가 통째로 어긋난다.
    const kst = new Date(new Date(p.played_at).getTime() + 9 * 3600e3)
    a.hours[kst.getUTCHours()]++
    const d = kst.toISOString().slice(0, 10)
    a.days[d] = (a.days[d] ?? 0) + 1
  }

  // ⛔ 일별도 요청한 기간 전체를 0으로 깔아둔다 — 기록이 있는 날만 주면 기간을 바꿔도 그래프가 안 변한다.
  const allDays: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    allDays.push(new Date(Date.now() - i * 86400e3 + 9 * 3600e3).toISOString().slice(0, 10))
  }

  const games = Object.entries(acc).map(([gameId, a]) => ({
    gameId,
    players: a.players.size,
    plays: a.plays,
    playsPerPlayer: Math.round((a.plays / Math.max(1, a.players.size)) * 10) / 10,
    best: Math.round(a.best),
    avgBest: Math.round(a.sum / Math.max(1, a.n)),
    // 평균 플레이 시간 — 기간 내 실제 판들의 평균. 기록이 아직 없으면 null(0으로 속이지 않는다).
    avgSec: a.msN ? Math.round(a.msSum / a.msN / 1000) : null,
    recentPlays: a.recent,
    hours: a.hours,
    days: Object.fromEntries(allDays.map((d) => [d, a.days[d] ?? 0])),
  })).sort((x, y) => y.players - x.players)

  return json({ games, days, hasPlayLog: (plays ?? []).length > 0 })
}

/**
 * 오늘의 학습 참여 현황 — 기간을 지정해 일/주/월로 묶어 본다.
 * ⚠️ 막대만 그려놓으면 "몇 명인지 하나도 모르겠다" 가 된다 → 구간별 **숫자**를 같이 내려준다.
 * ⚠️ 시간대는 `daily_activity.first_seen_at`(그날 처음 들어온 시각)에서 뽑는다. KST 기준으로 시프트한다 —
 *    UTC 로 세면 한국 저녁이 다음 날 새벽으로 잡혀 그래프가 통째로 어긋난다.
 */
async function dailyStats(admin: any, body: any) {
  const to = String(body?.to ?? '').match(/^\d{4}-\d{2}-\d{2}$/) ? String(body.to) : new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
  const days = Math.min(Math.max(1, Math.floor(Number(body?.days ?? 30))), 730)
  const bucket = ['day', 'week', 'month'].includes(String(body?.bucket)) ? String(body.bucket) : 'day'
  const from = new Date(new Date(to + 'T00:00:00Z').getTime() - (days - 1) * 86400e3).toISOString().slice(0, 10)

  const { data, error } = await admin.from('daily_activity')
    .select('day, user_id, first_seen_at, did_attendance, did_learn, did_minigame, did_leveltest')
    .gte('day', from).lte('day', to).limit(50000)
  if (error) return json({ error: error.message }, 500)
  const rows = (data ?? []) as any[]

  // 구간 키: 일=YYYY-MM-DD · 주=그 주 월요일 · 월=YYYY-MM
  const keyOf = (day: string) => {
    if (bucket === 'month') return day.slice(0, 7)
    if (bucket === 'week') {
      const d = new Date(day + 'T00:00:00Z')
      const dow = (d.getUTCDay() + 6) % 7 // 월요일 시작
      return new Date(d.getTime() - dow * 86400e3).toISOString().slice(0, 10)
    }
    return day
  }

  const series: Record<string, { learn: number; attend: number; minigame: number; leveltest: number }> = {}
  // ⛔ **요청한 기간 전체**를 미리 0으로 깔아둔다. 기록이 있는 날만 그리면 기간을 7일→1년으로 바꿔도
  //    가로축이 그대로라 "눌러도 아무것도 안 바뀐다"가 된다(실제로 그렇게 보였다).
  for (let t = new Date(from + 'T00:00:00Z').getTime(); t <= new Date(to + 'T00:00:00Z').getTime(); t += 86400e3) {
    series[keyOf(new Date(t).toISOString().slice(0, 10))] ??= { learn: 0, attend: 0, minigame: 0, leveltest: 0 }
  }
  const hours = Array.from({ length: 24 }, () => 0)
  const learners = new Set<string>()
  let learnTotal = 0, attendTotal = 0
  for (const r of rows) {
    const k = keyOf(r.day)
    const s = (series[k] ??= { learn: 0, attend: 0, minigame: 0, leveltest: 0 })
    if (r.did_learn) { s.learn++; learnTotal++; learners.add(r.user_id) }
    if (r.did_attendance) { s.attend++; attendTotal++ }
    if (r.did_minigame) s.minigame++
    if (r.did_leveltest) s.leveltest++
    // 시간대 — 학습을 한 사람만 센다(전체를 세면 '언제 학습하나'를 못 본다).
    if (r.did_learn && r.first_seen_at) {
      const kstHour = new Date(new Date(r.first_seen_at).getTime() + 9 * 3600e3).getUTCHours()
      hours[kstHour]++
    }
  }
  return json({
    from, to, bucket,
    series: Object.entries(series).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => ({ key: k, ...v })),
    hours,
    totals: { learn: learnTotal, attend: attendTotal, people: learners.size, days },
  })
}

// ── 홈 대시보드 ──────────────────────────────────────────────
// PPT 1페이지가 요구한 6가지. 데이터가 아직 없는 것(인기 콘텐츠)은 0/빈 배열로 내려간다.
async function homeStats(admin: any) {
  const now = Date.now()
  const todayKst = new Date(now + 9 * 3600e3).toISOString().slice(0, 10)
  const d30 = new Date(now - 30 * 86400e3).toISOString()
  const d7 = new Date(now - 7 * 86400e3).toISOString()
  const dormantSince = new Date(now - 90 * 86400e3).toISOString() // 휴면 = 90일 미접속

  const [profs, pays, ebooks, alerts, inqs] = await Promise.all([
    admin.from('profiles').select('id, created_at, last_seen_at, is_anonymous').eq('is_anonymous', false).limit(20000),
    admin.from('payments').select('amount, status, created_at, fulfilled_at').gte('created_at', d30).limit(20000),
    admin.from('ebook_purchases').select('ebook_id').limit(20000),
    admin.from('system_alerts').select('id, severity, source, message, link, occurred_at').eq('status', 'open')
      .order('occurred_at', { ascending: false }).limit(10),
    admin.from('inquiries').select('id, title, status, created_at').order('created_at', { ascending: false }).limit(5),
  ])

  const people = (profs.data ?? []) as any[]
  const todayVisitors = people.filter((p) => (p.last_seen_at ?? '').slice(0, 10) === todayKst).length
  const newUsers7d = people.filter((p) => (p.created_at ?? '') >= d7).length
  // ⚠️ 한 번도 접속 기록이 없는 계정(기록 도입 전 가입자)은 휴면으로 세지 않는다 — 판단할 근거가 없다.
  const dormant = people.filter((p) => p.last_seen_at && p.last_seen_at < dormantSince).length

  let revenue = 0, paidN = 0, refundN = 0, unfulfilled = 0
  for (const p of (pays.data ?? []) as any[]) {
    if (p.status === 'paid') { revenue += p.amount ?? 0; paidN++; if (!p.fulfilled_at) unfulfilled++ }
    if (p.status === 'refunded') refundN++
  }

  const cnt: Record<string, number> = {}
  for (const b of (ebooks.data ?? []) as any[]) cnt[b.ebook_id] = (cnt[b.ebook_id] ?? 0) + 1
  const topIds = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 5)
  let topEbooks: { id: string; title: string; n: number }[] = []
  if (topIds.length) {
    const { data: bs } = await admin.from('ebooks').select('id, title').in('id', topIds.map(([id]) => id))
    const tmap: Record<string, string> = {}
    for (const b of bs ?? []) tmap[(b as any).id] = (b as any).title
    topEbooks = topIds.map(([id, n]) => ({ id, title: tmap[id] ?? '(삭제된 책)', n }))
  }

  return json({
    users: people.length, todayVisitors, newUsers7d, dormant,
    revenue30d: revenue, paid30d: paidN, refund30d: refundN, unfulfilled,
    topEbooks,
    alerts: ((alerts.data ?? []) as any[]).map((a) => ({
      id: a.id, severity: a.severity, source: a.source, message: a.message, link: a.link, at: a.occurred_at,
    })),
    inquiries: ((inqs.data ?? []) as any[]).map((i) => ({ id: i.id, title: i.title, status: i.status, at: i.created_at })),
  })
}

// ── 시스템 알림 ──────────────────────────────────────────────
async function alertList(admin: any, body: any) {
  const status = String(body?.status ?? 'open')
  let sel = admin.from('system_alerts').select('*')
  if (status !== 'all') sel = sel.eq('status', status)
  const { data, error } = await sel.order('occurred_at', { ascending: false }).limit(200)
  if (error) return json({ error: error.message }, 500)
  return json({ alerts: data ?? [] })
}
async function alertUpdate(admin: any, body: any) {
  const id = String(body?.id ?? '')
  const status = String(body?.status ?? '')
  if (!['open', 'ack', 'resolved'].includes(status)) return json({ error: '상태가 잘못됐습니다.' }, 400)
  const { error } = await admin.from('system_alerts').update({
    status, resolved_at: status === 'resolved' ? new Date().toISOString() : null,
  }).eq('id', id)
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true })
}

// ── 관리자 활동 로그 · 금지어 · 계정 정지 ────────────────────
async function auditList(admin: any) {
  const { data, error } = await admin.from('admin_audit').select('*').order('at', { ascending: false }).limit(300)
  if (error) return json({ error: error.message }, 500)
  return json({ rows: data ?? [] })
}
async function bannedWordList(admin: any) {
  const { data, error } = await admin.from('banned_words').select('*').order('created_at', { ascending: false })
  if (error) return json({ error: error.message }, 500)
  return json({ words: data ?? [] })
}
async function bannedWordSave(admin: any, body: any, ctx: Ctx) {
  const word = String(body?.word ?? '').trim().toLowerCase()
  if (!word) return json({ error: '단어를 입력하세요.' }, 400)
  if (body?.remove) {
    const { error } = await admin.from('banned_words').delete().eq('word', word)
    if (error) return json({ error: error.message }, 500)
    await audit(admin, ctx, 'bannedWordRemove', word)
  } else {
    const { error } = await admin.from('banned_words').upsert({ word, active: true, added_by: ctx.uid }, { onConflict: 'word' })
    if (error) return json({ error: error.message }, 500)
    await audit(admin, ctx, 'bannedWordAdd', word)
  }
  return json({ ok: true })
}
async function suspendUser(admin: any, body: any, ctx: Ctx) {
  const uid = String(body?.userId ?? '')
  if (!uid) return json({ error: '유저를 지정하세요.' }, 400)
  const days = Number(body?.days ?? 0)
  // days=0 이면 정지 해제. 사유는 정지할 때만 필수다.
  if (days > 0 && !String(body?.reason ?? '').trim()) return json({ error: '정지 사유를 적어주세요.' }, 400)
  const until = days > 0 ? new Date(Date.now() + days * 86400e3).toISOString() : null
  const { error } = await admin.from('profiles').update({
    suspended_until: until, suspended_reason: days > 0 ? String(body.reason) : null,
  }).eq('id', uid)
  if (error) return json({ error: error.message }, 500)
  await audit(admin, ctx, days > 0 ? 'suspendUser' : 'unsuspendUser', uid, { days, reason: body?.reason ?? '' })
  return json({ ok: true })
}

// ── 인증서(자격증) 관리 ──────────────────────────────────────
// 발급 현황 = 합격한 응시. 자격번호가 있으면 발급 완료, 없으면 미발급.
async function certList(admin: any, body: any) {
  const onlyPending = !!body?.pendingOnly
  const { data: atts, error } = await admin.from('exam_attempts')
    .select('id, user_id, exam_id, status, total_correct, total_questions, submitted_at, result_release_at, cert_no, cert_issued_at, cert_name_roman, pass_ratio_snapshot')
    .eq('status', 'submitted').order('submitted_at', { ascending: false }).limit(2000)
  if (error) return json({ error: error.message }, 500)
  const rows = (atts ?? []) as any[]
  const examIds = [...new Set(rows.map((r) => r.exam_id).filter(Boolean))]
  const titleMap: Record<string, string> = {}
  if (examIds.length) {
    const { data: ex } = await admin.from('exams').select('id, title').in('id', examIds)
    for (const e of ex ?? []) titleMap[(e as any).id] = (e as any).title
  }
  const uids = [...new Set(rows.map((r) => r.user_id))]
  const nameMap: Record<string, string> = {}
  if (uids.length) {
    const { data: profs } = await admin.from('profiles').select('id, display_name').in('id', uids)
    for (const p of profs ?? []) nameMap[(p as any).id] = (p as any).display_name
  }
  const out = rows
    .map((r) => {
      // 합격 판정은 **응시 시점 스냅샷**이 있으면 그걸 쓴다. 없으면 기본 60%.
      const ratio = r.pass_ratio_snapshot ?? 0.6
      const passed = r.total_questions && r.total_correct != null
        ? r.total_correct >= Math.ceil(r.total_questions * ratio) : null
      return {
        attemptId: r.id, userId: r.user_id, name: nameMap[r.user_id] ?? null,
        examTitle: r.exam_id ? titleMap[r.exam_id] ?? null : null,
        submittedAt: r.submitted_at, releasedAt: r.result_release_at,
        score: r.total_correct, total: r.total_questions, passRatio: ratio, passed,
        certNo: r.cert_no ?? null, certIssuedAt: r.cert_issued_at ?? null, nameRoman: r.cert_name_roman ?? null,
      }
    })
    .filter((r) => r.passed === true)
  return json({ certs: onlyPending ? out.filter((r) => !r.certNo) : out })
}

// 발급 조건 = **급수(티어)별**. 회차마다 다르게 두면 "이번 달 비기너 60%, 다음 달 55%" 가 되어
// 자격의 뜻이 흔들린다. 바꾸는 단위는 급수 그 자체다.
// ⛔ 과거 판정을 지키는 장치는 그대로 — 응시 시점 값을 exam_attempts.pass_ratio_snapshot 에 박는다.
async function certConditions(admin: any) {
  const { data, error } = await admin.from('exam_tiers')
    .select('tier, sort, pass_ratio, cert_available_after_days, cert_fee_override')
    .order('sort')
  if (error) return json({ error: error.message }, 500)
  return json({ tiers: data ?? [] })
}
async function certConditionsSave(admin: any, body: any, ctx: Ctx) {
  const tier = String(body?.tier ?? '')
  if (!tier) return json({ error: '급수를 지정하세요.' }, 400)
  const ratio = body?.passRatio == null || body.passRatio === '' ? null : Number(body.passRatio)
  if (ratio != null && (!(ratio > 0) || ratio > 1)) return json({ error: '합격선은 0 초과 1 이하로 넣어주세요(0.6 = 60%).' }, 400)
  const days = body?.days == null || body.days === '' ? null : Number(body.days)
  if (days != null && days < 0) return json({ error: '발급 가능 시점은 0일 이상이어야 합니다.' }, 400)
  const fee = body?.fee == null || body.fee === '' ? null : Number(body.fee)
  if (fee != null && fee < 0) return json({ error: '발급비는 0원 이상이어야 합니다.' }, 400)
  const { error } = await admin.from('exam_tiers')
    .update({ pass_ratio: ratio, cert_available_after_days: days, cert_fee_override: fee }).eq('tier', tier)
  if (error) return json({ error: error.message }, 500)
  await audit(admin, ctx, 'certConditionsSave', tier, { ratio, days, fee })
  return json({ ok: true })
}

// ── 용어 문제은행 (CARIS 방식: 은행 → 문항 → 게임별 세트) ────
/**
 * 문항 목록 + **어떤 게임이 이 문항을 쓰는지**.
 * ⚠️ CARIS 와 같은 구조다 — 은행에 문항을 쌓아두고, 게임(=시험)마다 담을 것을 고른다.
 *    다른 점은 뽑기(draw)가 없다는 것뿐이다(게임은 세트를 고정할 이유가 없다).
 */
async function termList(admin: any) {
  const [q, banks, sets] = await Promise.all([
    admin.from('term_questions').select('*').order('sort_order').order('created_at'),
    admin.from('term_banks').select('*').order('sort_order'),
    admin.from('minigame_question_sets').select('game_id, question_id'),
  ])
  if (q.error) return json({ error: q.error.message }, 500)
  // 문항 → 그 문항을 쓰는 게임 목록
  const byQ: Record<string, string[]> = {}
  for (const s of (sets.data ?? []) as any[]) (byQ[s.question_id] ??= []).push(s.game_id)
  // 게임 → 담긴 문항 수(0이면 "아직 안 고름" = 은행 전체를 쓴다)
  const counts: Record<string, number> = {}
  for (const s of (sets.data ?? []) as any[]) counts[s.game_id] = (counts[s.game_id] ?? 0) + 1
  return json({
    terms: ((q.data ?? []) as any[]).map((t) => ({ ...t, games: byQ[t.id] ?? [] })),
    banks: banks.data ?? [],
    counts,
  })
}

/** 게임에 문항을 담거나 뺀다. `games` 가 그 문항이 들어갈 게임 목록의 **전체**다. */
async function termSetGames(admin: any, body: any) {
  const questionId = String(body?.questionId ?? '')
  const games = (body?.games ?? []) as string[]
  if (!questionId) return json({ error: '문항을 지정하세요.' }, 400)
  const { error: delErr } = await admin.from('minigame_question_sets').delete().eq('question_id', questionId)
  if (delErr) return json({ error: delErr.message }, 500)
  if (games.length) {
    const { error } = await admin.from('minigame_question_sets')
      .insert(games.map((g, i) => ({ game_id: g, question_id: questionId, sort_order: i })))
    if (error) return json({ error: error.message }, 500)
  }
  return json({ ok: true })
}

/** 한 게임의 세트를 통째로 바꾼다(전체 선택/해제용). */
async function termSetBulk(admin: any, body: any) {
  const gameId = String(body?.gameId ?? '')
  const questionIds = (body?.questionIds ?? []) as string[]
  if (!gameId) return json({ error: '게임을 지정하세요.' }, 400)
  const { error: delErr } = await admin.from('minigame_question_sets').delete().eq('game_id', gameId)
  if (delErr) return json({ error: delErr.message }, 500)
  if (questionIds.length) {
    const { error } = await admin.from('minigame_question_sets')
      .insert(questionIds.map((q, i) => ({ game_id: gameId, question_id: q, sort_order: i })))
    if (error) return json({ error: error.message }, 500)
  }
  return json({ ok: true })
}
async function termUpsert(admin: any, body: any) {
  const t = body?.term ?? {}
  const ko = String(t.answerKo ?? '').trim()
  const desc = String(t.descKo ?? '').trim()
  const dis = (t.distractorsKo ?? []).map((s: unknown) => String(s ?? '').trim()).filter(Boolean)
  if (!ko || !desc) return json({ error: '설명과 정답 용어를 모두 입력하세요.' }, 400)
  if (dis.length < 3) return json({ error: '오답 용어 3개가 필요합니다(보기 4개).' }, 400)
  const row = {
    field: String(t.field ?? 'AI'),
    desc_i18n: { ...(t.descI18n ?? {}), ko: desc },
    answer_i18n: { ...(t.answerI18n ?? {}), ko },
    distractors_i18n: { ...(t.distractorsI18n ?? {}), ko: dis.slice(0, 3) },
    active: t.active !== false,
    sort_order: Number(t.sortOrder ?? 0),
    updated_at: new Date().toISOString(),
  }
  const q = t.id ? admin.from('term_questions').update(row).eq('id', t.id) : admin.from('term_questions').insert(row)
  const { error } = await q
  // 같은 정답이 이미 있으면 유일 인덱스가 막는다 — 사람 말로 옮긴다.
  if (error) return json({ error: /term_questions_answer_uniq/.test(error.message) ? '같은 정답 용어가 이미 있습니다.' : error.message }, 400)
  return json({ ok: true })
}
async function termDelete(admin: any, body: any, ctx: Ctx) {
  const id = String(body?.id ?? '')
  const { error } = await admin.from('term_questions').delete().eq('id', id)
  if (error) return json({ error: error.message }, 500)
  await audit(admin, ctx, 'termDelete', id)
  return json({ ok: true })
}
/**
 * 코드(`src/lib/terms.ts`)에 박혀 있던 기본 문항을 DB 로 옮기는 1회용 통로.
 * ⚠️ 마이그레이션 SQL 에 50문항을 박지 않은 이유: 원본이 TS 배열이라 SQL 로 옮겨 적으면
 *    그 순간 **다섯 번째 사본**이 된다. 화면에서 한 번 밀어넣고 코드 쪽은 시드로만 남긴다.
 * 이미 있는 정답은 건너뛴다(여러 번 눌러도 안전).
 */
async function termImport(admin: any, body: any, ctx: Ctx) {
  const items = (body?.items ?? []) as any[]
  if (!Array.isArray(items) || !items.length) return json({ error: '가져올 문항이 없습니다.' }, 400)
  const { data: exist } = await admin.from('term_questions').select('answer_i18n')
  const have = new Set(((exist ?? []) as any[]).map((r) => r.answer_i18n?.ko).filter(Boolean))
  const rows = items
    .filter((it) => it?.answer && !have.has(String(it.answer)))
    .map((it, i) => ({
      field: String(it.field ?? 'AI'),
      desc_i18n: { ko: String(it.desc ?? '') },
      answer_i18n: { ko: String(it.answer) },
      distractors_i18n: { ko: (it.distractors ?? []).slice(0, 3).map((s: unknown) => String(s)) },
      active: true, sort_order: i,
    }))
  if (!rows.length) return json({ ok: true, added: 0 })
  const { error } = await admin.from('term_questions').insert(rows)
  if (error) return json({ error: error.message }, 500)
  await audit(admin, ctx, 'termImport', null, { added: rows.length })
  return json({ ok: true, added: rows.length })
}

// ── CARIS 현황 > 시험환경 점검 ────────────────────────────────
/**
 * 회차·급수별 응시권 보유자와 **시험환경 점검 여부**. 독려 메일 대상이 여기서 나온다.
 * ⚠️ 점검 기록(exam_env_checks)이 없는 사람이 '미점검'이다 — `/exam/check` 가 지금은 아무것도 안 남기므로
 *    그 기록을 남기기 전까지는 전원이 미점검으로 나온다(그게 사실이다).
 */
async function envCheckList(admin: any, body: any) {
  const roundId = String(body?.roundId ?? '')
  let sel = admin.from('exam_tickets')
    .select('id, user_id, round_id, tier, status')
    .in('status', ['issued', 'consumed'])
    .limit(5000)
  if (roundId) sel = sel.eq('round_id', roundId)
  const { data: tickets, error } = await sel
  if (error) return json({ error: error.message }, 500)
  const rows = (tickets ?? []) as any[]

  const [rounds, checks, profs] = await Promise.all([
    admin.from('exam_rounds').select('id, title_i18n, exam_date').order('exam_date', { ascending: false }),
    admin.from('exam_env_checks').select('ticket_id, user_id, checked_at').limit(20000),
    rows.length
      ? admin.from('profiles').select('id, display_name').in('id', [...new Set(rows.map((r) => r.user_id))])
      : Promise.resolve({ data: [] }),
  ])
  const nameMap: Record<string, string> = {}
  for (const p of (profs as any).data ?? []) nameMap[p.id] = p.display_name
  const emailMap: Record<string, string> = {}
  try {
    const { data: au } = await admin.rpc('admin_user_emails')
    for (const x of au ?? []) emailMap[(x as any).id] = (x as any).email ?? ''
  } catch { /* 이메일만 빈칸 */ }
  const doneByTicket = new Set(((checks as any).data ?? []).map((c: any) => c.ticket_id).filter(Boolean))
  const doneByUser = new Set(((checks as any).data ?? []).map((c: any) => c.user_id))

  const roundMap: Record<string, { title: string; date: string | null }> = {}
  for (const r of (rounds as any).data ?? []) roundMap[r.id] = { title: r.title_i18n?.ko ?? '(회차명 없음)', date: r.exam_date }

  return json({
    rounds: ((rounds as any).data ?? []).map((r: any) => ({ id: r.id, title: r.title_i18n?.ko ?? '(회차명 없음)', examDate: r.exam_date })),
    people: rows.map((t) => ({
      ticketId: t.id, userId: t.user_id, name: nameMap[t.user_id] ?? null, email: emailMap[t.user_id] ?? null,
      roundId: t.round_id, roundTitle: roundMap[t.round_id]?.title ?? '-', examDate: roundMap[t.round_id]?.date ?? null,
      tier: t.tier, ticketStatus: t.status,
      // 응시권에 묶인 기록이 우선, 없으면 그 사람이 어떤 식으로든 점검한 적이 있는지 본다.
      checked: doneByTicket.has(t.id) || doneByUser.has(t.user_id),
    })),
  })
}

/**
 * 독려 메일 발송 — **고른 사람 전체에게 한 번에** 보낸다(한 명씩 쓰는 게 아니다).
 * ⚠️ 지금은 실제 발송 수단이 없다. 보낼 내용을 확정하고 **이력만** 남긴다 —
 *    발송 서비스가 붙기 전에 "보냈다" 고 표시하면 안 보낸 걸 보냈다고 믿게 된다. 그래서 응답에 sent:false 를 준다.
 */
async function mailNudge(admin: any, body: any, ctx: Ctx) {
  const targets = (body?.targets ?? []) as { userId: string; email: string | null }[]
  if (!Array.isArray(targets) || !targets.length) return json({ error: '보낼 대상을 고르세요.' }, 400)
  const subject = String(body?.subject ?? '').trim()
  if (!subject) return json({ error: '메일 제목이 비어 있습니다.' }, 400)
  const withEmail = targets.filter((t) => t.email && t.email.includes('@'))
  const { error } = await admin.from('mail_log').insert({
    kind: 'nudge_env_check',
    round_id: body?.roundId || null,
    recipients: withEmail.length,
    subject,
    sent_by: ctx.uid,
  })
  if (error) return json({ error: error.message }, 500)
  await audit(admin, ctx, 'mailNudge', body?.roundId ?? null, { n: withEmail.length })
  return json({
    ok: true,
    sent: false, // ⚠️ 아직 진짜로 나가지 않았다
    queued: withEmail.length,
    skipped: targets.length - withEmail.length,
  })
}
async function mailLog(admin: any) {
  const { data, error } = await admin.from('mail_log').select('*').order('sent_at', { ascending: false }).limit(100)
  if (error) return json({ error: error.message }, 500)
  return json({ rows: data ?? [] })
}

export async function handleReform(admin: any, action: string, body: any, ctx: Ctx): Promise<Response | null> {
  switch (action) {
    case 'envCheckList': return await envCheckList(admin, body)
    case 'mailNudge': return await mailNudge(admin, body, ctx)
    case 'mailLog': return await mailLog(admin)
    case 'termList': return await termList(admin)
    case 'termSetGames': return await termSetGames(admin, body)
    case 'termSetBulk': return await termSetBulk(admin, body)
    case 'termUpsert': return await termUpsert(admin, body)
    case 'termDelete': return await termDelete(admin, body, ctx)
    case 'termImport': return await termImport(admin, body, ctx)
  }
  return await handleReform2(admin, action, body, ctx)
}

async function handleReform2(admin: any, action: string, body: any, ctx: Ctx): Promise<Response | null> {
  switch (action) {
    case 'siteSettings': return await siteSettings(admin)
    case 'siteSettingsSave': return await siteSettingsSave(admin, body, ctx)
    case 'popupList': return await popupList(admin)
    case 'popupUpsert': return await popupUpsert(admin, body, ctx)
    case 'popupDelete': return await popupDelete(admin, body, ctx)
    case 'policyList': return await policyList(admin, body)
    case 'policyUpsert': return await policyUpsert(admin, body, ctx)
    case 'inquiryList': return await inquiryList(admin, body)
    case 'inquiryAnswer': return await inquiryAnswer(admin, body, ctx)
    case 'ebookPreview': return await ebookPreview(admin, body)
    case 'lectureList': return await lectureList(admin, body)
    case 'lectureUpsert': return await lectureUpsert(admin, body)
    case 'lectureDelete': return await lectureDelete(admin, body, ctx)
    case 'rewardPolicy': return await rewardPolicy(admin)
    case 'rewardPolicySave': return await rewardPolicySave(admin, body, ctx)
    case 'hubCosmetics': return await hubCosmetics(admin)
    case 'hubCosmeticsSave': return await hubCosmeticsSave(admin, body, ctx)
    case 'minigameStats': return await minigameStats(admin, body)
    case 'dailyStats': return await dailyStats(admin, body)
    case 'homeStats': return await homeStats(admin)
    case 'alertList': return await alertList(admin, body)
    case 'alertUpdate': return await alertUpdate(admin, body)
    case 'auditList': return await auditList(admin)
    case 'bannedWordList': return await bannedWordList(admin)
    case 'bannedWordSave': return await bannedWordSave(admin, body, ctx)
    case 'suspendUser': return await suspendUser(admin, body, ctx)
    case 'certList': return await certList(admin, body)
    case 'certConditions': return await certConditions(admin)
    case 'certConditionsSave': return await certConditionsSave(admin, body, ctx)
    default: return null
  }
}
