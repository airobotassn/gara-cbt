// 환불 — 우리 서버가 PG 환불 API 를 불러 돈을 돌려주고, 원장(payment_refunds)에 적고, 줬던 것을 걷는다.
//
// 왜 이제야 있나 — 2026-08-21 에 원장 표(payment_refunds · payments.refunded_amount)만 만들고 위는 비워 뒀다.
// 그동안 환불은 PG 관리자 화면에서 사람이 하고 우리 DB 엔 관리자가 손으로 'refunded' 한 글자를 남겼다.
// 엑심베이는 환불을 결제의 '취소 상태' 로 알려주지 않아서(잔액만 준다) 웹훅으로 자동 반영되는 길이 사실상
// 없었다 — 우리가 직접 API 를 부르는 것이 환불 사실을 확실히 아는 유일한 길이다(2026-09-14).
//
// 이 파일이 지키는 것:
//   ① 금액은 저장된 원장에서만 만든다 — 관리자는 "어느 줄을 돌려줄지" 만 고르고 숫자를 치지 않는다.
//   ② 되돌릴 수 없는 호출이라 **같은 결제에 두 요청이 겹치지 못하게** 잠근 뒤 PG 를 부른다(낙관적 잠금).
//   ③ 원장(payment_refunds)은 PG 가 성공을 확정한 뒤에만 적고, 합계(refunded_amount)는 그 표의 합과 같다.
//   ④ 걷는 건 **돌려준 줄만** — 부분 환불에서 다른 줄의 지급물은 건드리지 않는다.
//
// 📌 대사·웹훅과 무관하다. 대시보드에서 직접 환불한 건은 settleFromProvider 의 잔액 안전망이 따로 잡는다.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { getProvider } from './payment-provider.ts'
import { PAYMENT_COLS, PURCHASE_TABLE, chargeOf, revokeForRefund, roundMinor, type BundleKind, type PaymentRow } from './payments.ts'
import { voidTicket } from './exam-tickets.ts'

/** 환불 줄 하나 — 결제를 이루는 항목. 화면이 이 목록에서 고르고, 같은 키가 원장 lines 에 남는다. */
export interface RefundLine {
  /** 'exam' · 'cert' · 'ebook:<id>' · 'lecture:<id>' — 결제 안에서 유일하다. */
  key: string
  name: string
  /** 정가 몫(달러 센트). 표시용. */
  listCents: number
  /** 이 줄에 배분된 청구액(청구 통화 · 주요 단위). 합이 정확히 청구액이다(마지막 줄이 잔액을 받는다). */
  amount: number
  /** 이미 돌려준 줄인가(원장 lines 에 같은 키가 있다). */
  refunded: boolean
}

export interface RefundPreview {
  paymentId: string
  orderId: string
  orderName: string
  status: string
  currency: string
  chargeAmount: number
  refundedAmount: number
  /** 지금 돌려줄 수 있는 최대 = 청구액 − 돌려준 합. */
  balance: number
  lines: RefundLine[]
  /** 이 결제의 환불 이력(최근 순). */
  history: { id: string; amount: number; currency: string; reason: string; lines: unknown; providerRef: string | null; createdAt: string; actorId: string | null }[]
}

/**
 * 결제를 줄 단위로 펼친다. 줄마다 청구액을 **정가 비례**로 배분하고 마지막 줄에 잔액을 몰아 합이 정확히 맞게 한다
 * (묶음 주문의 payment_items 배분과 같은 규칙 — 줄마다 반올림하면 1원이 남거나 모자란다).
 */
async function splitLines(admin: SupabaseClient, row: PaymentRow): Promise<Omit<RefundLine, 'refunded'>[]> {
  const chg = chargeOf(row)
  const parts: { key: string; name: string; listCents: number }[] = []

  if (row.product_type === 'exam') {
    const examCents = Math.max(0, row.amount - (row.addon_amount ?? 0))
    parts.push({ key: 'exam', name: '응시료', listCents: examCents })
    if (row.addon_ebook_id) {
      const { data: b } = await admin.from('ebooks').select('title').eq('id', row.addon_ebook_id).maybeSingle()
      parts.push({ key: `ebook:${row.addon_ebook_id}`, name: `교재 · ${(b?.title as string | undefined) ?? ''}`.trim(), listCents: row.addon_amount ?? 0 })
    }
  } else if (row.product_type === 'bundle') {
    const { data } = await admin.from('payment_items').select('product_type, product_ref, list_amount, amount').eq('payment_id', row.id)
    const items = (data ?? []) as { product_type: string; product_ref: string; list_amount: number; amount: number }[]
    const titles: Record<string, string> = {}
    for (const kind of ['ebook', 'lecture'] as const) {
      const mine = items.filter((i) => i.product_type === kind).map((i) => i.product_ref)
      if (!mine.length) continue
      const { data: rows } = await admin.from(kind === 'ebook' ? 'ebooks' : 'lectures').select('id, title').in('id', mine)
      for (const r of rows ?? []) titles[(r as { id: string }).id] = (r as { title: string }).title
    }
    for (const i of items) {
      parts.push({ key: `${i.product_type}:${i.product_ref}`, name: titles[i.product_ref] ?? i.product_ref, listCents: i.amount })
    }
  } else if (row.product_type === 'ebook' || row.product_type === 'lecture') {
    parts.push({ key: `${row.product_type}:${row.product_ref}`, name: row.order_name, listCents: row.amount })
  } else {
    // cert — 지급물이 없는 결제. 줄 하나(전액)뿐이다.
    parts.push({ key: 'cert', name: row.order_name, listCents: row.amount })
  }

  const totalCents = parts.reduce((s, p) => s + p.listCents, 0) || 1
  let acc = 0
  return parts.map((p, i) => {
    const amount = i === parts.length - 1
      ? roundMinor(chg.currency, chg.amount - acc)
      : roundMinor(chg.currency, (chg.amount * p.listCents) / totalCents)
    acc += amount
    return { ...p, amount }
  })
}

async function loadRow(admin: SupabaseClient, paymentId: string): Promise<PaymentRow | null> {
  const { data } = await admin.from('payments').select(PAYMENT_COLS).eq('id', paymentId).maybeSingle()
  return (data as PaymentRow | null) ?? null
}

/** 관리자 화면이 환불 창을 열 때 — 줄 목록·잔액·이력. 여기선 아무것도 바꾸지 않는다. */
export async function refundPreview(admin: SupabaseClient, paymentId: string): Promise<RefundPreview | { error: string; status: number }> {
  const row = await loadRow(admin, paymentId)
  if (!row) return { error: '결제를 찾을 수 없습니다.', status: 404 }
  const chg = chargeOf(row)
  const { data: hist } = await admin
    .from('payment_refunds')
    .select('id, amount, currency, reason, lines, provider_ref, created_at, actor_id')
    .eq('payment_id', row.id)
    .order('created_at', { ascending: false })
  const history = ((hist ?? []) as Record<string, unknown>[]).map((h) => ({
    id: h.id as string,
    amount: Number(h.amount),
    currency: h.currency as string,
    reason: h.reason as string,
    lines: h.lines,
    providerRef: (h.provider_ref as string | null) ?? null,
    createdAt: h.created_at as string,
    actorId: (h.actor_id as string | null) ?? null,
  }))
  const doneKeys = new Set<string>()
  for (const h of history) for (const l of (Array.isArray(h.lines) ? h.lines : []) as { key?: string }[]) if (l?.key) doneKeys.add(l.key)
  const refunded = Number(row.refunded_amount ?? 0)
  const lines = (await splitLines(admin, row)).map((l) => ({ ...l, refunded: doneKeys.has(l.key) }))
  return {
    paymentId: row.id,
    orderId: row.order_id,
    orderName: row.order_name,
    status: row.status,
    currency: chg.currency,
    chargeAmount: chg.amount,
    refundedAmount: refunded,
    balance: roundMinor(chg.currency, chg.amount - refunded),
    lines,
    history,
  }
}

/** 돌려준 줄의 지급물을 걷는다. 응시권은 미사용일 때만(응시 후 건은 사람 판단 — revokeForRefund 와 같은 방침). */
async function revokeLines(admin: SupabaseClient, row: PaymentRow, keys: string[]): Promise<string[]> {
  const notes: string[] = []
  for (const key of keys) {
    if (key === 'exam') {
      const { data: t } = await admin.from('exam_tickets').select('id, status').eq('payment_id', row.id).maybeSingle()
      const ticket = t as { id: string; status: string } | null
      if (!ticket) notes.push('응시권 없음')
      else if (ticket.status === 'issued') { await voidTicket(admin, ticket.id, '결제 환불로 자동 회수'); notes.push('미사용 응시권 회수') }
      else if (ticket.status === 'consumed') notes.push('응시 후 건 — 응시권 자동 회수 안 함(사람 판단)')
      else notes.push(`응시권 이미 ${ticket.status}`)
      continue
    }
    if (key === 'cert') { notes.push('자격증은 회수하지 않음'); continue }
    const [kind, id] = key.split(':', 2) as [BundleKind, string]
    const tbl = PURCHASE_TABLE[kind]
    if (!tbl || !id) { notes.push(`알 수 없는 줄 ${key}`); continue }
    await admin.from(tbl.table).delete().eq('payment_id', row.id).eq('user_id', row.user_id).eq(tbl.col, id)
    notes.push(kind === 'lecture' ? '시청권 회수' : '열람권 회수')
  }
  return notes
}

export interface RefundInput {
  paymentId: string
  /** 돌려줄 줄의 키 목록. 'all' 이면 남은 전부. */
  lines: string[] | 'all'
  reason: string
  actorId: string | null
}

export type RefundResult =
  | { ok: true; refundId: string; amount: number; currency: string; balance: number; status: string; providerRef: string | null; notes: string[] }
  | { ok: false; error: string; status: number }

/**
 * 환불 실행. 순서가 중요하다:
 *   검증 → **잠금(refunded_amount 를 예상값으로만 올림)** → PG 호출 → 성공이면 원장 기록 + 회수, 실패면 잠금 되돌림.
 * 잠금을 먼저 거는 이유 — 두 관리자가 동시에 누르면 둘 다 PG 로 나가 두 번 환불된다. PG 의 refund_id 중복 거절은
 * **같은 키** 에만 걸리고, 우리 요청은 키가 매번 새로 나오므로 그걸로는 못 막는다.
 */
export async function refundPayment(admin: SupabaseClient, input: RefundInput): Promise<RefundResult> {
  const reason = input.reason.trim()
  if (!reason) return { ok: false, error: '환불 사유를 적어주세요(원장과 PG 양쪽에 남습니다).', status: 400 }
  const row = await loadRow(admin, input.paymentId)
  if (!row) return { ok: false, error: '결제를 찾을 수 없습니다.', status: 404 }
  if (row.status !== 'paid') return { ok: false, error: `환불할 수 있는 상태가 아닙니다(현재 ${row.status}).`, status: 409 }
  if (!row.payment_key) return { ok: false, error: 'PG 거래번호가 없어 환불 API 를 부를 수 없습니다.', status: 409 }

  const preview = await refundPreview(admin, row.id)
  if ('error' in preview) return { ok: false, error: preview.error, status: preview.status }
  const chg = { currency: preview.currency }

  // 어느 줄을 돌려줄지 — 이미 돌려준 줄은 다시 못 고른다.
  const pickable = preview.lines.filter((l) => !l.refunded)
  const chosen = input.lines === 'all' ? pickable : pickable.filter((l) => (input.lines as string[]).includes(l.key))
  if (chosen.length === 0) return { ok: false, error: '돌려줄 항목이 없습니다(이미 전부 환불됐거나 잘못 골랐습니다).', status: 400 }
  if (input.lines !== 'all') {
    const bad = (input.lines as string[]).filter((k) => !pickable.some((l) => l.key === k))
    if (bad.length) return { ok: false, error: `이미 환불됐거나 없는 항목입니다: ${bad.join(', ')}`, status: 400 }
  }
  // 남은 줄을 전부 고르면 반올림 찌꺼기까지 정확히 잔액이다.
  const allRemaining = chosen.length === pickable.length
  const amount = allRemaining ? preview.balance : roundMinor(chg.currency, chosen.reduce((s, l) => s + l.amount, 0))
  if (amount <= 0 || amount > preview.balance + 1e-9) {
    return { ok: false, error: `환불 금액이 잔액을 넘습니다(요청 ${amount} · 잔액 ${preview.balance}).`, status: 400 }
  }

  // ② 잠금 — refunded_amount 가 아직 예상값일 때만 올린다. 0행이면 누가 먼저 움직였다 → 다시 열어 보게 한다.
  const before = preview.refundedAmount
  const after = roundMinor(chg.currency, before + amount)
  const { data: locked } = await admin
    .from('payments')
    .update({ refunded_amount: after, updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .eq('status', 'paid')
    .eq('refunded_amount', before)
    .select('id')
  if (!locked || locked.length === 0) {
    return { ok: false, error: '다른 환불이 방금 처리됐습니다. 창을 닫고 다시 열어 확인해 주세요.', status: 409 }
  }
  const unlock = () => admin.from('payments').update({ refunded_amount: before, updated_at: new Date().toISOString() }).eq('id', row.id)

  // ③ PG 호출
  // ⚠️ 엑심베이 refund_id 는 **30자 이하**다(실측 2026-09-15: `rf-<uuid>` 39자로 보냈다가 REQUIRED_PARAMETER_MISSING
  //    "refund.refundid size must be between 0 and 30" 으로 거절). uuid 의 하이픈을 빼고 28자만 쓴다 — 112비트라 충돌 걱정 없다.
  const refundKey = `rf${crypto.randomUUID().replace(/-/g, '').slice(0, 28)}`
  let res
  try {
    res = await getProvider(row.provider).refund({
      providerKey: row.payment_key,
      orderId: row.order_id,
      currency: chg.currency,
      original: preview.chargeAmount,
      balance: preview.balance,
      amount,
      refundKey,
      reason,
    })
  } catch (e) {
    await unlock()
    return { ok: false, error: e instanceof Error ? e.message : 'PG 호출 실패', status: 502 }
  }
  if (!res.ok) {
    await unlock()
    return { ok: false, error: `PG 가 환불을 거절했습니다 (${res.error.code}) ${res.error.message}`, status: 502 }
  }

  // ④ 원장 — PG 가 확정한 금액으로 적는다(우리가 보낸 값과 다르면 그게 사실이다).
  const finalAmount = roundMinor(chg.currency, res.data.amount)
  const { error: insErr } = await admin.from('payment_refunds').insert({
    payment_id: row.id,
    refund_key: refundKey,
    amount: finalAmount,
    currency: chg.currency,
    lines: chosen.map((l) => ({ key: l.key, name: l.name, amount: l.amount })),
    reason,
    actor_id: input.actorId,
    provider_ref: res.data.providerRef,
  })
  const notes: string[] = []
  if (insErr) notes.push(`원장 기록 실패(돈은 나갔다 · 환불키 ${refundKey}): ${insErr.message}`)
  if (finalAmount !== amount) {
    // PG 확정액이 우리 계산과 다르면 합계를 사실에 맞춘다.
    await admin.from('payments').update({ refunded_amount: roundMinor(chg.currency, before + finalAmount) }).eq('id', row.id)
    notes.push(`PG 확정액 ${finalAmount} ≠ 요청 ${amount} — 합계를 확정액으로 맞춤`)
  }

  // ⑤ 회수 + 상태
  const newBalance = roundMinor(chg.currency, preview.chargeAmount - (before + finalAmount))
  let status = 'paid'
  if (newBalance <= 0) {
    // 전액 — 결제를 refunded 로 눕히고 이 결제로 나간 것 전부를 걷는다(revokeForRefund 가 payment_id 로만 짚는다).
    status = 'refunded'
    await admin.from('payments').update({ status, updated_at: new Date().toISOString() }).eq('id', row.id).eq('status', 'paid')
    if (row.fulfilled_at) {
      const r = await revokeForRefund(admin, { ...row, status, refunded_amount: before + finalAmount })
      notes.push(r.note)
    }
  } else {
    notes.push(...(await revokeLines(admin, row, chosen.map((l) => l.key))))
  }

  return { ok: true, refundId: refundKey, amount: finalAmount, currency: chg.currency, balance: newBalance, status, providerRef: res.data.providerRef, notes }
}
