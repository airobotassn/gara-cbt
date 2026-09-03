// 관리자페이지 재편(PPT `관리자 페이지 수정사항`)으로 새로 생긴 액션들 — 2026-08-11.
//   index.ts 가 이미 2.6k줄이라 여기로 분리했다. 게이트(관리자 여부)는 index.ts 가 이미 통과시킨 뒤 부른다.
//   ⚠️ 돈·자격을 만드는 액션(자격증 수동 발급)은 루트 전용이다 — index.ts 의 기존 구분과 같은 규칙.
import { json } from '../_shared/cors.ts'
import { bunnyConfigured, bunnyPullzone, bunnyThumbUrl } from '../_shared/bunny.ts'

interface Ctx { email: string; isRoot: boolean; uid: string | null }

/**
 * 한국어 → 5개국어 번역기. **index.ts 가 들고 있는 것을 그대로 받아 쓴다**(2026-08-26).
 *
 * ⚠️ import 로 가져올 수 없다 — index.ts 가 이 파일을 import 하므로 반대 방향이 순환이 된다.
 *    공용 모듈로 빼는 방법도 있지만, 그 블록(Gemini 호출·조각 나누기·이어붙이기 200여 줄)은
 *    공지·FAQ·회차가 매일 쓰는 살아 있는 코드라 옮기다 어긋나면 그쪽이 조용히 한국어로만 저장된다.
 *    받아 쓰면 단일 출처는 그대로고 옮길 코드가 0줄이다.
 * @returns `{ <필드>: { ko, en, ja, zh, hi, vi } }`
 */
export interface ReformDeps {
  translateKoFields: (koFields: Record<string, string>) => Promise<Record<string, Record<string, string>>>
  /** 번역 키가 꽂혀 있나. 없으면 한국어로만 저장되므로 화면에 그 사실을 알린다. */
  hasTranslateKey: boolean
}

/** 번역 대상 언어 — 한국어는 원본 컬럼이 단일 출처라 대상이 아니다(`translateKoFields` 의 ko 는 버린다). */
const TRANSLATED_LANGS = ['en', 'ja', 'zh', 'hi', 'vi'] as const

/** `translateKoFields` 결과 한 필드 → 저장할 jsonb. **ko 는 담지 않는다**(위 마이그레이션 주석의 규칙). */
function i18nOf(field: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const lg of TRANSLATED_LANGS) {
    const v = (field?.[lg] ?? '').trim()
    if (v) out[lg] = v
  }
  return out
}

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
/** Bunny 영상 GUID 로 접는다 — 관리자가 대시보드에서 임베드 주소를 통째로 복사해 오는 게 자연스럽다.
 *  (`https://iframe.mediadelivery.net/embed/12345/<guid>` · `https://…/play/12345/<guid>` · GUID 단독) */
function bunnyVideoId(raw: string): string | null {
  const s = raw.trim()
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  const m = s.match(uuid)
  return m ? m[0].toLowerCase() : null
}
async function lectureList(admin: any, body: any) {
  const catalog = body?.catalog === 'caris' ? 'caris' : 'leveltest'
  const { data, error } = await admin.from('lectures').select('*').eq('catalog', catalog)
    .order('sort_order').order('created_at')
  if (error) return json({ error: error.message }, 500)
  // Bunny 썸네일 주소는 **풀존 호스트를 알아야** 만들 수 있고 그건 서버 시크릿이다 —
  //   관리자 화면이 목록·미리보기에 쓰도록 여기서 완성해 붙여 준다(사용자 화면의 shapeLecture 와 같은 규칙).
  const rows = (data ?? []).map((l: any) => ({
    ...l,
    bunnyThumbUrl: l.bunny_video_id ? bunnyThumbUrl(l.bunny_video_id) : null,
  }))
  // 폼에서 **방금 붙여넣은** id 의 미리보기를 그리려면 화면도 풀존 호스트를 알아야 한다(서버는 아직 그 행을 모른다).
  //   ⚠️ 비밀이 아니다 — 썸네일·영상 주소에 그대로 들어 있는 값이다. 비밀인 토큰 키는 안 나간다.
  // bunnyReady = 시크릿이 다 꽂혔나. 안 꽂혔는데 Bunny 강의를 등록하면 사용자가 재생을 못 한다 → 화면이 미리 경고한다.
  return json({ lectures: rows, pullzone: bunnyPullzone(), bunnyReady: bunnyConfigured() })
}
async function lectureUpsert(admin: any, body: any, deps: ReformDeps) {
  const l = body?.lecture ?? {}
  // ⛔ **출처는 정확히 하나다**(DB CHECK lectures_source_chk 와 같은 규칙) — 반대편은 반드시 null 로 비운다.
  //    둘 다 차면 어느 쪽으로 재생할지 모호해지고, 그 모호함은 화면 어디에도 안 드러난다.
  const isBunny = l.source === 'bunny'
  const ytVid = isBunny ? null : youtubeId(String(l.youtubeId ?? ''))
  const bnVid = isBunny ? bunnyVideoId(String(l.bunnyVideoId ?? '')) : null
  if (!isBunny && !ytVid) return json({ error: '유튜브 주소(또는 영상 ID)를 확인해 주세요.' }, 400)
  if (isBunny && !bnVid) return json({ error: 'Bunny 영상 ID(GUID) 를 확인해 주세요.' }, 400)
  if (!String(l.title ?? '').trim()) return json({ error: '제목을 입력하세요.' }, 400)
  const catalog = l.catalog === 'caris' ? 'caris' : 'leveltest'
  const row: Record<string, unknown> = {
    catalog,
    // 한 강의는 한 카탈로그에만 속한다(DB CHECK 과 같은 규칙) — 반대편 분류는 반드시 비운다.
    target_level: catalog === 'leveltest' ? (l.targetLevel ?? null) : null,
    target_tier: catalog === 'caris' ? (l.targetTier ?? null) : null,
    youtube_id: ytVid, bunny_video_id: bnVid, title: String(l.title),
    // ⚠️ 채널은 관리자 화면에서 뺐다(2026-08-25) — 우리가 만든 강의를 파는 것이라 '어느 채널 영상인가'가
    //    쓸 정보가 아니다. 화면이 안 보내므로 저장할 때마다 빈 값이 되고, 사용자 화면은 비면 그 줄을 안 그린다.
    //    ⛔ 컬럼은 남겨둔다 — 지우면 옛 행의 값까지 사라져 되돌릴 수 없다.
    channel: String(l.channel ?? ''),
    description: String(l.description ?? ''),
    // 정가 — **달러 센트**(100 = $1.00). 이북과 같은 단위다. 0 = 무료(결제창을 안 타고 바로 지급).
    //   ⚠️ 음수·소수·NaN 을 그대로 넣지 않는다 — DB CHECK 이 막아주지만 여기서 접어야 오류가 안 뜬다.
    price_usd_cents: Math.max(0, Math.round(Number(l.priceUsdCents ?? 0)) || 0),
    // 목록 썸네일. 비우면 출처가 주는 그림으로 폴백한다.
    //   ⚠️ **유튜브 폴백은 영상 id 를 노출한다** — 그 주소에 id 가 박혀 있어 미소유자도 보게 되고,
    //      유튜브는 id 만 알면 재생되므로 유료 강의라면 자체 썸네일이 사실상 필수다.
    //   Bunny 폴백은 그 문제가 없다 — id 를 알아도 서명 없이는 재생이 안 된다.
    thumb_url: String(l.thumbUrl ?? '').trim() || null,
    published: l.published !== false, sort_order: Number(l.sortOrder ?? 0),
  }

  // ── 제목·소개 자동 번역 (2026-08-26) ─────────────────────────────
  // 관리자는 한국어만 쓴다 — 공지·FAQ·게시판 분류·회차와 **같은 방식**이고, 여기서도 버튼이 없다.
  //   ⚠️ 번역 실패로 저장을 막지 않는다(best-effort). 막으면 관리자가 강의를 아예 못 올린다 —
  //      번역이 비면 사용자 화면은 한국어 원문으로 폴백하므로 잃는 것이 없다.
  //   ⚠️ 저장할 때마다 다시 번역한다. 필드가 둘뿐이라 호출 1회고, "바뀌었나" 를 따로 기억하면
  //      그 판정이 어긋나는 순간 제목만 옛 번역으로 남아 조용히 틀린다(이북에서 실제로 겪은 자리다).
  let translateWarning = ''
  if (!deps.hasTranslateKey) translateWarning = '번역 키(GEMINI_API_KEY_NOTICE) 미설정 — 한국어로만 저장됨'
  else {
    try {
      const tr = await deps.translateKoFields({
        title: String(l.title ?? '').trim(),
        description: String(l.description ?? '').trim(),
      })
      row.title_i18n = i18nOf(tr.title)
      row.description_i18n = i18nOf(tr.description)
    } catch (e) {
      translateWarning = e instanceof Error ? e.message : '번역 실패'
    }
  }

  const q = l.id ? admin.from('lectures').update(row).eq('id', l.id) : admin.from('lectures').insert(row)
  const { error } = await q
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true, translateWarning: translateWarning || undefined })
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

// ── 미니게임·DAILY QUIZ 현황 ────────────────────────────────
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
 * DAILY QUIZ 참여 현황 — 기간을 지정해 일/주/월로 묶어 본다.
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

// ── 허브 캐릭터 업로드 ───────────────────────────────────────
// 캐릭터 한 종 = **완제품 7장 + 비율 + 이름 + 상점 한 행**. 여태 앞의 셋이 코드/에셋이라 그림이
// 도착할 때마다 배포였다(2026-08-20 에 "그림은 코드, 가격은 DB" 로 가른 그 선). 여기가 그 선을 옮긴다.
//
// ⛔ **시트를 자르지 않는다.** 올리는 건 `tools/build-char-art.mjs` 가 뽑아 놓은 **완제품 7장**이다.
//    흰 배경 빼기·Lv.7 후광 역산은 판단이 섞인 일이고 Deno 엣지에는 그 이미지 처리기도 없다.
// ⛔ **브라우저가 버킷에 직접 올리지 않는다.** 서명 업로드 URL 을 여기서 구워 준다 —
//    버킷 정책이 0개라 토큰 없이는 아무도 못 올리고, 관리자 판정은 이 함수가 이미 통과시킨 뒤다.
//    (스토리지 정책으로 관리자를 가리려면 정책 안에서 admin_users 를 뒤져야 한다 — 게이트가 두 벌이 된다.)
const CHAR_BUCKET = 'hub-char'
const CHAR_PUBLIC_MARK = `/storage/v1/object/public/${CHAR_BUCKET}/`
const CHAR_KEY_RE = /^char_[a-z0-9_]+$/
const CHAR_EXT_MIME: Record<string, string> = { webp: 'image/webp', png: 'image/png' }

/**
 * 새 캐릭터 키 — **사람에게 보여주지 않는다**(2026-08-31 지시: "키는 서버에서 정해").
 *
 * ⛔ **이름으로 키를 만들 수 없다.** 키가 그대로 스토리지 경로(`<키>/lv1-….webp`)가 되는데
 *    Supabase Storage 는 키를 ASCII 로만 받는다 — 한글 이름을 그대로 쓰면 서명 URL 은 200 이고
 *    **올릴 때만** InvalidKey 400 이 난다(의견함 첨부에서 이미 겪은 그 함정).
 *    로마자로 옮기려면 romanizer 가 필요하고, 그건 이름이 바뀔 때마다 키가 흔들린다는 뜻이다.
 * ⚠️ 그래서 순번이다. 표시 이름은 `name_ko` 가 따로 들고 있으므로 키가 무의미해도 아무도 안 아쉽다.
 */
async function nextCharKey(admin: any): Promise<string> {
  const [art, cat] = await Promise.all([
    admin.from('hub_char_art').select('part_key'),
    admin.from('shop_catalog').select('part_key').eq('kind', 'character'),
  ])
  let max = 0
  for (const r of [...(art.data ?? []), ...(cat.data ?? [])] as any[]) {
    const m = /^char_(\d+)$/.exec(String(r.part_key ?? ''))
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `char_${String(max + 1).padStart(3, '0')}`
}

/**
 * 이 품목을 **가진 사람 / 입고 있는 사람** 목록. 값을 올리거나 진열을 내리기 전에 보는 화면이다.
 * ⚠️ 착용은 두 자리에서 나온다 — 캐릭터는 `user_characters.base_key`, 파츠는 같은 행의 `equipped` 안.
 *    한쪽만 보면 "보유 12명 / 착용 0명" 같은 거짓말이 나온다.
 */
async function cosmeticOwners(admin: any, body: any) {
  const partKey = String(body?.partKey ?? '')
  if (!partKey) return json({ error: '품목 키가 없습니다.' }, 400)

  const [own, chars] = await Promise.all([
    admin.from('user_cosmetics').select('user_id, acquired_at, source').eq('part_key', partKey).limit(1000),
    admin.from('user_characters').select('user_id, base_key, equipped').limit(50000),
  ])
  const wearing = new Set<string>()
  for (const c of (chars.data ?? []) as any[]) {
    if (c.base_key === partKey) wearing.add(c.user_id)
    const eq = (c.equipped ?? {}) as Record<string, string>
    for (const v of Object.values(eq)) if (v === partKey) wearing.add(c.user_id)
  }
  const byUser = new Map<string, { userId: string; name: string; acquiredAt: string | null; source: string | null; worn: boolean }>()
  for (const o of (own.data ?? []) as any[]) {
    byUser.set(o.user_id, { userId: o.user_id, name: '', acquiredAt: o.acquired_at ?? null, source: o.source ?? null, worn: wearing.has(o.user_id) })
  }
  // ⚠️ 산 기록 없이 입고 있는 사람도 세운다 — 첫 선택 무료 캐릭터가 그렇다(user_cosmetics 에 안 남는다).
  //    빼면 "착용 30명인데 목록엔 2명" 이 된다.
  for (const uid of wearing) {
    if (!byUser.has(uid)) byUser.set(uid, { userId: uid, name: '', acquiredAt: null, source: null, worn: true })
  }
  const ids = [...byUser.keys()]
  if (ids.length) {
    const { data: profs } = await admin.from('profiles').select('id, display_name').in('id', ids)
    for (const p of (profs ?? []) as any[]) {
      const row = byUser.get(p.id)
      if (row) row.name = p.display_name ?? ''
    }
  }
  const users = [...byUser.values()].sort((a, b) => Number(b.worn) - Number(a.worn) || (b.acquiredAt ?? '').localeCompare(a.acquiredAt ?? ''))
  return json({ partKey, users, owners: (own.data ?? []).length, worn: wearing.size })
}

/** 캐릭터 목록 — 상점 행(있으면)과 업로드된 그림을 한 줄로 합쳐 돌려준다. */
async function charArtList(admin: any) {
  const [cat, art] = await Promise.all([
    admin.from('shop_catalog').select('part_key, price, kind, active, sort_order').eq('kind', 'character'),
    admin.from('hub_char_art').select('part_key, ar, urls, name_ko, name_i18n, scales, updated_at'),
  ])
  const byKey = new Map<string, any>()
  for (const r of (cat.data ?? []) as any[]) {
    byKey.set(r.part_key, {
      partKey: r.part_key, price: r.price ?? 0, active: r.active !== false,
      sortOrder: r.sort_order ?? 0, ar: null, urls: {}, nameKo: '', scales: {}, uploaded: 0, updatedAt: null,
    })
  }
  for (const a of (art.data ?? []) as any[]) {
    // ⚠️ 상점 행이 아직 없는 키도 줄을 세운다 — 그림만 올리고 값을 안 정한 상태가 실제로 생긴다.
    const row = byKey.get(a.part_key) ?? {
      partKey: a.part_key, price: 0, active: false, sortOrder: 0, ar: null, urls: {}, nameKo: '', scales: {}, uploaded: 0, updatedAt: null,
    }
    row.ar = a.ar === null || a.ar === undefined ? null : Number(a.ar)
    row.urls = (a.urls ?? {}) as Record<string, string>
    row.nameKo = a.name_ko ?? ''
    row.scales = (a.scales ?? {}) as Record<string, number>
    row.uploaded = Object.keys(row.urls).length
    row.updatedAt = a.updated_at ?? null
    byKey.set(a.part_key, row)
  }
  const items = [...byKey.values()].sort((x, y) => x.sortOrder - y.sortOrder || x.partKey.localeCompare(y.partKey))
  return json({ items })
}

/**
 * 그림 한 장의 서명 업로드 URL. 브라우저는 이 토큰으로만 올린다.
 * ⚠️ 파일 이름에 타임스탬프를 박는다 — 같은 경로에 덮어쓰면 공개 URL 이 그대로라 CDN·브라우저가
 *    옛 그림을 계속 준다("올렸는데 안 바뀐다"). 옛 파일은 남지만 그건 눈에 보이는 사고가 아니다.
 */
async function charArtUploadUrl(admin: any, body: any) {
  const raw = String(body?.partKey ?? '')
  const level = Number(body?.level)
  const ext = String(body?.ext ?? 'webp').toLowerCase()
  // ⚠️ 새 캐릭터는 아직 키가 없다(화면이 안 묻는다) — 여기서 만들어 **돌려준다**.
  //    화면은 그 값을 숨겨 들고 있다가 저장할 때 같이 보낸다. 안 돌려주면 7장이 각각 다른 키로 흩어진다.
  const partKey = raw || (await nextCharKey(admin))
  if (!CHAR_KEY_RE.test(partKey)) return json({ error: '캐릭터 키가 올바르지 않습니다.' }, 400)
  if (!Number.isInteger(level) || level < 1 || level > 7) return json({ error: '레벨은 1~7 입니다.' }, 400)
  if (!CHAR_EXT_MIME[ext]) return json({ error: 'webp 또는 png 만 올릴 수 있습니다.' }, 400)

  const path = `${partKey}/lv${level}-${Date.now()}.${ext}`
  const { data, error } = await admin.storage.from(CHAR_BUCKET).createSignedUploadUrl(path)
  if (error) return json({ error: error.message }, 500)
  const pub = admin.storage.from(CHAR_BUCKET).getPublicUrl(path)
  return json({ partKey, path, token: data?.token ?? null, signedUrl: data?.signedUrl ?? null, publicUrl: pub.data.publicUrl })
}

/**
 * 캐릭터 한 종 저장 — 그림 주소·비율·이름 + 상점 행(가격·판매여부)을 같이 쓴다.
 * ⛔ 상점 행을 같이 만들지 않으면 화면에 **영영 안 나온다** — 허브의 첫 선택 후보도 상점 목록도
 *    `shop_catalog` 에서 나온다(get-hub 가 active 만 내려준다).
 * ⚠️ 그림 주소는 **우리 버킷의 공개 주소인지 확인**한다. 안 보면 남의 서버 주소를 그대로 심을 수 있고,
 *    그러면 그쪽이 그림을 갈아치우는 순간 우리 허브 캐릭터가 바뀐다.
 */
async function charArtSave(admin: any, body: any, ctx: Ctx, deps: ReformDeps) {
  // 키는 사람이 안 정한다 — 그림을 먼저 올렸으면 그때 받은 키가 오고, 아니면 여기서 만든다.
  const partKey = String(body?.partKey ?? '') || (await nextCharKey(admin))
  if (!CHAR_KEY_RE.test(partKey)) return json({ error: '캐릭터 키가 올바르지 않습니다.' }, 400)

  const nameKo = String(body?.nameKo ?? '').trim()
  if (!nameKo) return json({ error: '캐릭터 이름(한국어)을 입력하세요.' }, 400)

  const price = Number(body?.price ?? 0)
  if (!Number.isInteger(price) || price < 0) return json({ error: '가격은 0 이상의 정수여야 합니다.' }, 400)
  const active = body?.active !== false
  // 표시 순서는 화면이 안 보낸다(만드는 중엔 몇 번째인지 알 수가 없다) → **맨 뒤**로 붙인다.
  //   ⚠️ 기존 캐릭터를 다시 저장할 땐 그 값을 유지한다. 0 으로 덮으면 저장할 때마다 맨 앞으로 튄다.
  let sortOrder = Number.isInteger(Number(body?.sortOrder)) ? Number(body.sortOrder) : null
  if (sortOrder === null) {
    const { data: cur } = await admin.from('shop_catalog').select('part_key, sort_order').eq('kind', 'character')
    const mine = (cur ?? []).find((r: any) => r.part_key === partKey)
    sortOrder = mine
      ? (mine.sort_order ?? 0)
      : Math.max(-1, ...((cur ?? []) as any[]).map((r) => r.sort_order ?? 0)) + 1
  }

  // 레벨별 크기 배율 — 범위 밖은 거절한다. 0.01 이나 50 이 들어가면 캐릭터가 사라지거나 화면을 덮는다.
  //   ⚠️ 1 인 레벨은 담지 않는다. 기본값이 1 이라 담아봐야 같은 뜻이고, 담으면 표만 커진다.
  const scalesIn = (body?.scales ?? {}) as Record<string, unknown>
  const scales: Record<string, number> = {}
  for (let lv = 1; lv <= 7; lv++) {
    const v = Number(scalesIn[String(lv)])
    if (!Number.isFinite(v)) continue
    if (v < 0.4 || v > 2) return json({ error: `Lv.${lv} 크기는 0.4 ~ 2.0 사이여야 합니다.` }, 400)
    if (Math.abs(v - 1) > 0.0001) scales[String(lv)] = Number(v.toFixed(3))
  }

  const arRaw = body?.ar
  const ar = arRaw === null || arRaw === undefined || arRaw === '' ? null : Number(arRaw)
  if (ar !== null && (!Number.isFinite(ar) || ar <= 0 || ar > 10)) return json({ error: '비율 값이 이상합니다.' }, 400)

  const urlsIn = (body?.urls ?? {}) as Record<string, unknown>
  const urls: Record<string, string> = {}
  for (let lv = 1; lv <= 7; lv++) {
    const u = urlsIn[String(lv)]
    if (typeof u !== 'string' || !u) continue
    if (!u.includes(CHAR_PUBLIC_MARK)) return json({ error: `Lv.${lv} 그림 주소가 우리 저장소의 것이 아닙니다.` }, 400)
    urls[String(lv)] = u
  }

  // 이름 번역 — 한국어가 원본이고 i18n 에는 번역본만 담는다(공지·강의와 같은 규칙).
  //   ⚠️ 번역이 실패해도 저장은 한다. 이름이 한국어로만 뜨는 것과 캐릭터가 아예 안 들어가는 것은 무게가 다르다.
  let nameI18n: Record<string, string> = {}
  if (deps.hasTranslateKey) {
    try {
      const t = await deps.translateKoFields({ name: nameKo })
      nameI18n = i18nOf(t.name)
    } catch { /* 한국어로만 저장 */ }
  }

  const { error: artErr } = await admin.from('hub_char_art').upsert({
    part_key: partKey, ar, urls, name_ko: nameKo, name_i18n: nameI18n, scales, updated_at: new Date().toISOString(),
  }, { onConflict: 'part_key' })
  if (artErr) return json({ error: artErr.message }, 500)

  const { error: shopErr } = await admin.from('shop_catalog').upsert({
    part_key: partKey, price, kind: 'character', active, sort_order: sortOrder,
  }, { onConflict: 'part_key' })
  if (shopErr) return json({ error: shopErr.message }, 500)

  await audit(admin, ctx, 'charArtSave', partKey, { nameKo, price, active, levels: Object.keys(urls).length })
  return json({ ok: true, partKey, translated: Object.keys(nameI18n).length })
}

/**
 * 캐릭터 한 종 삭제 — 표 두 행 + 올린 그림 파일까지 지운다.
 *
 * ⛔ **가진 사람이 하나라도 있으면 지우지 않는다.** 키가 사라지면 그 사람의 보유·착용 기록이
 *    이름도 그림도 없는 유령이 된다("돈 낸 물건을 뺏지 않는다"와 같은 자리다).
 *    그 경우엔 삭제가 아니라 **상점에서 숨김**이 맞고, 화면이 그렇게 안내한다.
 * ⚠️ 파일은 마지막에 지운다. 먼저 지우면 표가 남았는데 그림만 없는 상태가 생긴다.
 *    파일 삭제가 실패해도 본 작업은 성공으로 친다 — 남는 건 아무도 안 부르는 파일뿐이다.
 */
async function charArtDelete(admin: any, body: any, ctx: Ctx) {
  const partKey = String(body?.partKey ?? '')
  if (!CHAR_KEY_RE.test(partKey)) return json({ error: '캐릭터 키가 올바르지 않습니다.' }, 400)

  const [own, chars] = await Promise.all([
    admin.from('user_cosmetics').select('user_id').eq('part_key', partKey).limit(1),
    admin.from('user_characters').select('user_id, base_key, equipped').eq('base_key', partKey).limit(1),
  ])
  const owners = (own.data ?? []).length
  const worn = (chars.data ?? []).length
  if (owners || worn) {
    return json({ error: '이미 가지고 있는 회원이 있어 지울 수 없습니다. 상점에서 숨김으로 내려 주세요.' }, 409)
  }

  const { error: aErr } = await admin.from('hub_char_art').delete().eq('part_key', partKey)
  if (aErr) return json({ error: aErr.message }, 500)
  const { error: sErr } = await admin.from('shop_catalog').delete().eq('part_key', partKey)
  if (sErr) return json({ error: sErr.message }, 500)

  try {
    const { data: files } = await admin.storage.from(CHAR_BUCKET).list(partKey)
    const paths = (files ?? []).map((f: any) => `${partKey}/${f.name}`)
    if (paths.length) await admin.storage.from(CHAR_BUCKET).remove(paths)
  } catch { /* 남은 파일은 아무도 안 부른다 */ }

  await audit(admin, ctx, 'charArtDelete', partKey, {})
  return json({ ok: true })
}

// ── 방문 통계 ────────────────────────────────────────────────
// 홈 대시보드의 "방문 통계" 섹션 하나가 쓰는 전부(일별 추이 · 국가 · 지역 · 기기 · 브라우저 · OS · 인기 화면).
//   ⚠️ 집계는 SQL(`visit_stats` RPC)이 한다 — 행을 다 끌어와 TS 에서 세는 방식(homeStats 가 그렇다)은
//      방문이 쌓이면 limit 에 먼저 걸려 **조용히 틀린 숫자**를 내놓는다.
//   ⚠️ 날짜 경계는 KST 다. 표의 `day` 도 KST 기준으로 서버가 찍는다(마이그레이션 기본값).
async function visitStats(admin: any, body: any) {
  const days = Math.min(365, Math.max(7, Number(body?.days ?? 90) || 90))
  const kstNow = new Date(Date.now() + 9 * 3600e3)
  const dayKey = (d: Date) => d.toISOString().slice(0, 10)
  const to = dayKey(kstNow)
  const from = dayKey(new Date(kstNow.getTime() - (days - 1) * 86400e3))

  const { data, error } = await admin.rpc('visit_stats', { p_from: from, p_to: to })
  if (error) return json({ error: error.message }, 500)
  return json({ from, to, ...((data ?? {}) as Record<string, unknown>) })
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

// ── 용어 문제은행 (레벨테스트/CARIS 문항관리와 같은 방식) ────
//
// 구조: term_questions(문항) 하나뿐. **은행 = 게임에 나가는 문제 전부**다.
//
// ⛔ **게임별로 문항을 고르는 기능은 없앴다(2026-09-03 지시).** 원래 CARIS(은행→시험→세트)를 본떠
//    `minigame_question_sets` 로 게임마다 담을 문항을 고르게 해뒀는데, 쓸 이유가 없었다 —
//    네 곳(버텨라·쏴라·골라라·DAILY)은 **같은 용어 문제를 보여주는 방식만 다르고**, 실제로도 50문항이
//    4곳에 통째로 들어가 있었다. 안 쓰는 선택 UI 가 화면 한복판에 있으니 "이게 뭔지 모르겠다"가 됐다.
//    (시험은 회차마다 세트가 달라야 하지만, 게임은 매판 섞이고 누구나 전 문항을 본다.)
//    문항 하나를 빼고 싶으면 **'사용' 토글을 끄면 전부에서 빠진다** — 그 버튼이 이미 있다.
// ⚠️ 표(`minigame_question_sets`)는 **지우지 않고 둔다** — 나중에 진짜 갈라야 할 일이 생기면 되살린다.
//    다만 그때는 문항 하나씩 체크가 아니라 **분야(AI·로봇·피지컬AI)로 거는 쪽**이 맞다.
//    지금은 읽는 곳이 없다(term-pool 도 안 본다).
//
// 레벨테스트(admin-test/handlers/questions.ts)와 **같은 규칙**을 그대로 옮겼다:
//   · 목록은 활성·미삭제만 (비활성/삭제는 '문항 이력' 탭에서 되돌린다)
//   · 삭제는 되돌릴 수 있다(deleted_at) — 하드 삭제 금지
//   · 변경은 한 줄씩 이력에 남는다(term_question_events)
//   · 번역은 화면이 translate-questions 로 돌려 여기로 넘긴다(서버는 검증·저장만)

/** 번역이 덜 찬 언어. 설명·정답·오답3 이 **모두** 있어야 그 언어가 채워진 것이다. */
function termMissing(r: any): string[] {
  const miss: string[] = []
  for (const lg of TRANSLATED_LANGS) {
    const d = (r.desc_i18n?.[lg] ?? '').trim?.() ?? ''
    const a = (r.answer_i18n?.[lg] ?? '').trim?.() ?? ''
    const ds = r.distractors_i18n?.[lg]
    if (!d || !a || !Array.isArray(ds) || ds.length !== 3 || ds.some((x: unknown) => !String(x ?? '').trim())) miss.push(lg)
  }
  return miss
}

/** 다음 문항 번호(T-001…). 지워진 문항의 번호는 재사용하지 않는다 — 이력이 그 번호로 남아 있다. */
function nextTermCodes(existing: (string | null)[], n: number): string[] {
  let max = 0
  for (const c of existing) {
    const m = /^T-(\d+)$/.exec(String(c ?? ''))
    if (m) max = Math.max(max, Number(m[1]))
  }
  return Array.from({ length: n }, (_, i) => `T-${String(max + 1 + i).padStart(3, '0')}`)
}

/** 문항 변경 이력 한 줄. 실패해도 본 작업은 막지 않는다(레벨테스트 logEvent 와 같은 규칙). */
async function termLog(
  admin: any,
  e: { question_id: string | null; code: string | null; action: string; actor: string; detail?: unknown },
) {
  try {
    await admin.from('term_question_events').insert({
      question_id: e.question_id, code: e.code, action: e.action, actor: e.actor || null, detail: e.detail ?? null,
    })
  } catch { /* 로그 실패는 무시 */ }
}

/** 저장할 번역만 골라낸다. 한 언어라도 덜 찼으면 **그 언어만** 버린다(다른 언어는 살린다). */
function sanitizeTermI18n(t: any): { D: Record<string, string>; A: Record<string, string>; X: Record<string, string[]>; dropped: string[] } {
  const D: Record<string, string> = {}
  const A: Record<string, string> = {}
  const X: Record<string, string[]> = {}
  const dropped: string[] = []
  for (const lg of TRANSLATED_LANGS) {
    const d = String(t.descI18n?.[lg] ?? '').trim()
    const a = String(t.answerI18n?.[lg] ?? '').trim()
    const xs = (t.distractorsI18n?.[lg] ?? []).map((s: unknown) => String(s ?? '').trim())
    if (!d && !a && !xs.some(Boolean)) continue // 아예 비어 있으면 조용히 생략(미번역)
    // ⚠️ 오답 개수는 3개로 맞춘다 — 게임이 '정답 1 + 오답 3 = 보기 4개'로 그린다.
    //    개수가 어긋난 번역을 담으면 그 언어에서만 보기가 빈 칸으로 뜬다.
    if (!d || !a || xs.length !== 3 || xs.some((s: string) => !s)) { dropped.push(lg); continue }
    D[lg] = d; A[lg] = a; X[lg] = xs
  }
  return { D, A, X, dropped }
}

/**
 * 문항 목록 + **어떤 게임이 이 문항을 쓰는지** + 언어별 번역 완료율.
 * ⚠️ 완료율 분모는 **활성 문항**이다(CARIS 와 같은 규칙) — 비활성은 게임에 안 나가니 번역할 이유가 없는데
 *    분모에 넣으면 영영 100%가 안 돼서 "다 됐다"를 아무도 판단 못 한다.
 */
async function termList(admin: any) {
  const { data, error } = await admin.from('term_questions').select('*')
    .is('deleted_at', null).eq('active', true).order('sort_order').order('created_at')
  if (error) return json({ error: error.message }, 500)
  const rows = ((data ?? []) as any[]).map((t) => ({ ...t, missing: termMissing(t) }))
  const coverage: Record<string, number> = {}
  for (const r of rows) for (const lg of TRANSLATED_LANGS) if (!r.missing.includes(lg)) coverage[lg] = (coverage[lg] ?? 0) + 1
  return json({ terms: rows, coverage, total: rows.length })
}

/** '문항 이력' 탭 — 되돌릴 수 있는 것들(비활성 · 삭제). */
async function termRestorable(admin: any) {
  const [inactive, deleted] = await Promise.all([
    admin.from('term_questions').select('*').is('deleted_at', null).eq('active', false).order('sort_order'),
    admin.from('term_questions').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }),
  ])
  return json({ inactive: inactive.data ?? [], deleted: deleted.data ?? [] })
}

/** '문항 이력' 탭 — 변경 로그. */
async function termEvents(admin: any, body: any) {
  let q = admin.from('term_question_events').select('*').order('created_at', { ascending: false }).limit(500)
  if (body?.code) q = q.eq('code', String(body.code))
  const { data, error } = await q
  if (error) return json({ error: error.message }, 500)
  return json({ rows: data ?? [] })
}

/**
 * 문항 추가/수정.
 * ⛔ **한국어 원문이 바뀌면 옛 번역을 그 자리에서 비운다**(CARIS questionUpsert 의 koChanged 와 같은 이유).
 *    안 비우면 설명만 고쳐도 번역본은 옛 문장 그대로라 **외국어로 하는 사람만 다른 문제를 푼다** —
 *    화면에는 아무 표시도 안 남는 종류의 사고다.
 */
async function termUpsert(admin: any, body: any, ctx: Ctx) {
  const t = body?.term ?? {}
  const ko = String(t.answerKo ?? '').trim()
  const desc = String(t.descKo ?? '').trim()
  const dis = (t.distractorsKo ?? []).map((s: unknown) => String(s ?? '').trim()).filter(Boolean)
  if (!ko || !desc) return json({ error: '설명과 정답 용어를 모두 입력하세요.' }, 400)
  if (dis.length < 3) return json({ error: '오답 용어 3개가 필요합니다(보기 4개).' }, 400)

  const { D, A, X, dropped } = sanitizeTermI18n(t)
  let before: any = null
  if (t.id) {
    const { data } = await admin.from('term_questions').select('*').eq('id', t.id).maybeSingle()
    before = data
  }
  // 한국어가 바뀌었나 — 설명·정답·오답 중 하나라도 달라지면 옛 번역은 전부 버린다.
  const koChanged = !!before && (
    (before.desc_i18n?.ko ?? '') !== desc ||
    (before.answer_i18n?.ko ?? '') !== ko ||
    JSON.stringify(before.distractors_i18n?.ko ?? []) !== JSON.stringify(dis.slice(0, 3))
  )
  // 한국어가 바뀌었으면 번역을 통째로 버리고 한국어만 남긴다.
  const tr = koChanged ? { D: {}, A: {}, X: {} } : { D, A, X }
  const row: Record<string, unknown> = {
    field: String(t.field ?? 'AI'),
    desc_i18n: { ...tr.D, ko: desc },
    answer_i18n: { ...tr.A, ko },
    distractors_i18n: { ...tr.X, ko: dis.slice(0, 3) },
    active: t.active !== false,
    sort_order: Number(t.sortOrder ?? 0),
    updated_at: new Date().toISOString(),
  }
  if (!t.id) {
    const { data: codes } = await admin.from('term_questions').select('code')
    row.code = nextTermCodes(((codes ?? []) as any[]).map((r) => r.code), 1)[0]
  }
  const q = t.id
    ? admin.from('term_questions').update(row).eq('id', t.id).select('id, code').maybeSingle()
    : admin.from('term_questions').insert(row).select('id, code').maybeSingle()
  const { data: saved, error } = await q
  // 같은 정답이 이미 있으면 유일 인덱스가 막는다 — 사람 말로 옮긴다.
  if (error) return json({ error: /term_questions_answer_uniq/.test(error.message) ? '같은 정답 용어가 이미 있습니다.' : error.message }, 400)
  await termLog(admin, {
    question_id: saved?.id ?? t.id ?? null, code: saved?.code ?? before?.code ?? null,
    action: t.id ? 'update' : 'create', actor: ctx.email,
    detail: { answer: ko, ...(koChanged ? { koChanged: true, clearedTranslations: true } : {}) },
  })
  return json({ ok: true, id: saved?.id, code: saved?.code, dropped, clearedTranslations: koChanged })
}

/** 사용/중지 토글. 중지된 문항은 게임에 안 나가고 목록에서도 빠진다('문항 이력 > 비활성'). */
async function termSetActive(admin: any, body: any, ctx: Ctx) {
  const id = String(body?.id ?? '')
  const active = body?.active !== false
  const { data, error } = await admin.from('term_questions').update({ active, updated_at: new Date().toISOString() })
    .eq('id', id).select('id, code').maybeSingle()
  if (error) return json({ error: error.message }, 500)
  await termLog(admin, { question_id: id, code: data?.code ?? null, action: active ? 'activate' : 'deactivate', actor: ctx.email })
  return json({ ok: true })
}

/**
 * 삭제 — 되돌릴 수 있게 표시만 한다.
 * ⚠️ `active=false` 를 같이 찍는다: 정답 유일 인덱스가 `where active` 라, 안 그러면 지운 용어를 다시 못 넣는다.
 */
async function termDelete(admin: any, body: any, ctx: Ctx) {
  const id = String(body?.id ?? '')
  const { data, error } = await admin.from('term_questions')
    .update({ deleted_at: new Date().toISOString(), active: false }).eq('id', id).select('id, code').maybeSingle()
  if (error) return json({ error: error.message }, 500)
  await termLog(admin, { question_id: id, code: data?.code ?? null, action: 'delete', actor: ctx.email })
  await audit(admin, ctx, 'termDelete', id)
  return json({ ok: true })
}

/** 삭제·중지된 문항을 목록으로 되돌린다. */
async function termRestore(admin: any, body: any, ctx: Ctx) {
  const id = String(body?.id ?? '')
  const { data, error } = await admin.from('term_questions')
    .update({ deleted_at: null, active: true, updated_at: new Date().toISOString() })
    .eq('id', id).select('id, code').maybeSingle()
  if (error) return json({ error: /term_questions_answer_uniq/.test(error.message) ? '같은 정답 용어가 이미 있어 되돌릴 수 없습니다.' : error.message }, 400)
  await termLog(admin, { question_id: id, code: data?.code ?? null, action: 'restore', actor: ctx.email })
  return json({ ok: true })
}

/**
 * 일괄 등록 — 엑셀 업로드와 '기본 문항 불러오기'가 같이 쓴다.
 * ⚠️ **방금 넣은 행의 id·번호를 돌려준다**(`inserted`). 화면은 그걸로 번역을 이어붙인다 —
 *    안 돌려주면 어느 문항인지 모르는 채 순서로 추측하게 되고, 남의 문항에 번역이 박힌다(CARIS 에서 겪은 함정).
 * 이미 있는 정답은 건너뛴다(여러 번 눌러도 안전).
 */
async function termImport(admin: any, body: any, ctx: Ctx) {
  const items = (body?.items ?? []) as any[]
  if (!Array.isArray(items) || !items.length) return json({ error: '가져올 문항이 없습니다.' }, 400)
  const { data: exist } = await admin.from('term_questions').select('code, answer_i18n')
  const have = new Set(((exist ?? []) as any[]).map((r) => r.answer_i18n?.ko).filter(Boolean))
  const picked: any[] = []
  for (const it of items) {
    const answer = String(it?.answer ?? '').trim()
    const desc = String(it?.desc ?? '').trim()
    const dis = (it?.distractors ?? []).map((s: unknown) => String(s ?? '').trim()).filter(Boolean).slice(0, 3)
    if (!answer || !desc || dis.length < 3 || have.has(answer)) continue
    have.add(answer) // 파일 안에서 같은 정답이 두 번 나오는 경우도 막는다
    picked.push({ answer, desc, field: String(it?.field ?? 'AI'), dis })
  }
  if (!picked.length) return json({ ok: true, added: 0, inserted: [] })
  const codes = nextTermCodes(((exist ?? []) as any[]).map((r) => r.code), picked.length)
  const base = ((exist ?? []) as any[]).length
  const rows = picked.map((p, i) => ({
    code: codes[i], field: p.field,
    desc_i18n: { ko: p.desc }, answer_i18n: { ko: p.answer }, distractors_i18n: { ko: p.dis },
    active: true, sort_order: base + i,
  }))
  const { data: ins, error } = await admin.from('term_questions').insert(rows).select('id, code, answer_i18n')
  if (error) return json({ error: error.message }, 500)
  for (const r of (ins ?? []) as any[]) {
    await termLog(admin, { question_id: r.id, code: r.code, action: 'import', actor: ctx.email, detail: { answer: r.answer_i18n?.ko } })
  }
  await audit(admin, ctx, 'termImport', null, { added: rows.length })
  return json({
    ok: true, added: rows.length,
    inserted: ((ins ?? []) as any[]).map((r) => ({ id: r.id, code: r.code, answer: r.answer_i18n?.ko })),
  })
}

/**
 * 번역만 따로 저장한다(엑셀 업로드 직후·「미번역 번역」이 배치마다 부른다).
 * ⛔ **배치마다 저장한다 — 전부 끝난 뒤 한 번에 저장하지 말 것.** 모아서 저장하면 도중에 창을 닫을 때
 *    그때까지의 Gemini 호출이 통째로 버려진다(CARIS 에서 그렇게 만들었다가 고쳤다).
 */
async function termTransSave(admin: any, body: any) {
  const rows = (body?.rows ?? []) as any[]
  if (!Array.isArray(rows) || !rows.length) return json({ error: '저장할 번역이 없습니다.' }, 400)
  let saved = 0
  const dropped: string[] = []
  for (const r of rows) {
    const id = String(r?.id ?? '')
    if (!id) continue
    const { data: cur } = await admin.from('term_questions').select('desc_i18n, answer_i18n, distractors_i18n').eq('id', id).maybeSingle()
    if (!cur) continue
    const { D, A, X, dropped: bad } = sanitizeTermI18n(r)
    for (const lg of bad) if (!dropped.includes(lg)) dropped.push(lg)
    if (!Object.keys(D).length) continue
    const { error } = await admin.from('term_questions').update({
      desc_i18n: { ...(cur.desc_i18n ?? {}), ...D },
      answer_i18n: { ...(cur.answer_i18n ?? {}), ...A },
      distractors_i18n: { ...(cur.distractors_i18n ?? {}), ...X },
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (!error) saved++
  }
  return json({ ok: true, saved, dropped })
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

export async function handleReform(admin: any, action: string, body: any, ctx: Ctx, deps: ReformDeps): Promise<Response | null> {
  switch (action) {
    case 'envCheckList': return await envCheckList(admin, body)
    case 'mailNudge': return await mailNudge(admin, body, ctx)
    case 'mailLog': return await mailLog(admin)
    case 'termList': return await termList(admin)
    case 'termUpsert': return await termUpsert(admin, body, ctx)
    case 'termSetActive': return await termSetActive(admin, body, ctx)
    case 'termDelete': return await termDelete(admin, body, ctx)
    case 'termRestore': return await termRestore(admin, body, ctx)
    case 'termRestorable': return await termRestorable(admin)
    case 'termEvents': return await termEvents(admin, body)
    case 'termImport': return await termImport(admin, body, ctx)
    case 'termTransSave': return await termTransSave(admin, body)
  }
  return await handleReform2(admin, action, body, ctx, deps)
}

async function handleReform2(admin: any, action: string, body: any, ctx: Ctx, deps: ReformDeps): Promise<Response | null> {
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
    case 'lectureUpsert': return await lectureUpsert(admin, body, deps)
    case 'lectureDelete': return await lectureDelete(admin, body, ctx)
    case 'rewardPolicy': return await rewardPolicy(admin)
    case 'rewardPolicySave': return await rewardPolicySave(admin, body, ctx)
    case 'hubCosmetics': return await hubCosmetics(admin)
    case 'hubCosmeticsSave': return await hubCosmeticsSave(admin, body, ctx)
    case 'charArtList': return await charArtList(admin)
    case 'charArtUploadUrl': return await charArtUploadUrl(admin, body)
    case 'charArtSave': return await charArtSave(admin, body, ctx, deps)
    case 'cosmeticOwners': return await cosmeticOwners(admin, body)
    case 'charArtDelete': return await charArtDelete(admin, body, ctx)
    case 'minigameStats': return await minigameStats(admin, body)
    case 'dailyStats': return await dailyStats(admin, body)
    case 'homeStats': return await homeStats(admin)
    case 'visitStats': return await visitStats(admin, body)
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
