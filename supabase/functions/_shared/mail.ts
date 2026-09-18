/**
 * 메일 발송 — Resend 한 곳(2026-09-18 결정).
 *
 * 부르는 자리는 관리자 함수의 `mailNudge` 하나다(시험환경 점검·레벨테스트·응시권 미사용자 독려가 전부 그리로 온다).
 *   · 설정은 둘: 서버 시크릿 `RESEND_API_KEY` + 보내는 주소(사이트 정보의 발신자 이름·주소 → 없으면 `MAIL_FROM`).
 *     둘 중 하나라도 없으면 `mailConfig` 가 null 을 주고 호출부가 그 자리에서 거절한다 — 안 보낸 걸 보냈다고 적지 않는다.
 *   · 100통씩 묶어 보낸다(Resend batch 상한). 묶음이 통째로 거절되면 그 묶음만 한 통씩 다시 보내
 *     **어느 주소가 왜 실패했는지** 를 사람별로 남긴다(묶음 응답은 성공 id 만 주고 실패를 안 가른다).
 *   · 받은 뒤 반송(주소 없음 등)은 여기서 모른다 — 그건 Resend 웹훅이 필요하고 아직 안 붙였다.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

export interface MailItem { to: string; subject: string; text: string }
export interface MailResult { ok: boolean; id?: string; error?: string }
export interface MailConfig { apiKey: string; from: string }

const RESEND_API = 'https://api.resend.com'
const BATCH = 100

/** 발신 설정 — 시크릿 + 사이트 정보(sender_name·sender_email). 없으면 null. */
export async function mailConfig(admin: SupabaseClient): Promise<MailConfig | null> {
  const apiKey = Deno.env.get('RESEND_API_KEY') ?? ''
  if (!apiKey) return null
  const { data } = await admin.from('site_settings').select('key, value').in('key', ['sender_name', 'sender_email'])
  const s: Record<string, string> = {}
  for (const r of (data ?? []) as { key: string; value: string }[]) s[r.key] = r.value
  const email = (s.sender_email ?? '').trim() || (Deno.env.get('MAIL_FROM') ?? '').trim()
  if (!email.includes('@')) return null
  const name = (s.sender_name ?? '').trim()
  // 이름에 따옴표·꺾쇠가 들어가면 주소 형식이 깨진다 — 빼고 보낸다.
  const safeName = name.replace(/["<>]/g, '')
  return { apiKey, from: safeName ? `${safeName} <${email}>` : email }
}

/** 평문 → 최소 HTML(줄바꿈만). 메일 앱마다 평문 표시가 달라서 HTML 도 같이 실어야 줄이 안 뭉친다. */
function textToHtml(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // 주소는 눌리게 — 본문의 {link} 가 그대로 글자로만 남으면 폰에서 못 연다.
  const linked = esc.replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`)
  return `<div style="font-family:sans-serif;font-size:15px;line-height:1.7;white-space:pre-wrap">${linked.replace(/\n/g, '<br>')}</div>`
}

async function post(cfg: MailConfig, path: string, payload: unknown): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(`${RESEND_API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  let body: any = null
  try { body = await res.json() } catch { /* 본문 없음 */ }
  return { ok: res.ok, status: res.status, body }
}

const errText = (r: { status: number; body: any }) =>
  String(r.body?.message ?? r.body?.error ?? `HTTP ${r.status}`).slice(0, 300)

/** 한 통씩 — 묶음이 거절됐을 때 어느 주소가 문제인지 가르는 용도. */
async function sendOne(cfg: MailConfig, m: MailItem): Promise<MailResult> {
  try {
    const r = await post(cfg, '/emails', { from: cfg.from, to: [m.to], subject: m.subject, text: m.text, html: textToHtml(m.text) })
    return r.ok ? { ok: true, id: r.body?.id } : { ok: false, error: errText(r) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 여러 통 — 결과는 입력과 같은 순서·같은 개수. */
export async function sendMails(cfg: MailConfig, items: MailItem[]): Promise<MailResult[]> {
  const out: MailResult[] = []
  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH)
    let r: { ok: boolean; status: number; body: any } | null = null
    try {
      r = await post(cfg, '/emails/batch', chunk.map((m) => ({
        from: cfg.from, to: [m.to], subject: m.subject, text: m.text, html: textToHtml(m.text),
      })))
    } catch { r = null }
    const ids = Array.isArray(r?.body?.data) ? r!.body.data : null
    if (r?.ok && ids && ids.length === chunk.length) {
      for (const d of ids) out.push({ ok: true, id: d?.id })
      continue
    }
    // 묶음이 거절됐다(주소 하나가 틀려도 통째로 4xx). 한 통씩 보내 실패한 주소만 실패로 남긴다.
    for (const m of chunk) {
      out.push(await sendOne(cfg, m))
      await new Promise((res) => setTimeout(res, 550)) // Resend 기본 한도 2req/s
    }
  }
  return out
}

/** 치환자 채우기 — `{name}` 같은 자리에 사람 값. 없는 키는 빈칸이 아니라 그대로 둔다(빠진 걸 화면에서 보게). */
export function fillVars(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{([a-zA-Z]+)\}/g, (m, k) => (k in vars ? vars[k] : m))
}

/**
 * 번역용 쪼개기 — 치환자와 줄바꿈을 경계로 자른다. 글자 조각만 번역기에 보내고 나머지는 자리를 지킨다.
 * 그래서 `{name}` 이 번역되거나 사라지지 않고, 줄 구조도 그대로다. `joinTemplate` 이 되돌린다.
 */
export function splitTemplate(s: string): string[] {
  return s.split(/(\{[a-zA-Z]+\}|\n)/)
}
export function isTextPart(x: string): boolean {
  return !!x.trim() && !/^\{[a-zA-Z]+\}$/.test(x) && x !== '\n'
}
/** 조각 배열 + (조각 인덱스 → 번역문) → 문장. 번역이 없는 조각은 원문. */
export function joinTemplate(parts: string[], translated: (i: number) => string | undefined): string {
  return parts.map((x, i) => (isTextPart(x) ? (translated(i) || x) : x)).join('')
}
