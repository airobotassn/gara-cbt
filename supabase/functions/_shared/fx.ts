// 환율 — 달러 정가를 다른 통화로 청구할 때 쓰는 값.
//
// 왜 있나: 정가는 달러 하나인데(2026-08-13 전환) 한국 사용자에게는 원화로 청구한다. 국내 카드가
//   달러로 결제되면 해외결제로 잡혀 카드사 수수료가 붙고, 해외결제를 꺼둔 카드는 아예 실패한다.
//
// ⚠️ **환율은 주문을 만들 때 한 번만 읽고 그 값을 주문 행에 박는다**(payments.fx_rate).
//    승인은 결제창을 다녀온 뒤라 그 사이 갱신될 수 있는데, 승인 때 다시 계산하면 화면에 뜬 금액과
//    청구액이 달라져 금액 대조가 통째로 깨진다(정상 결제가 전부 막힌다).
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

/** USD 1 당 얼마인가. 수집이 실패해도 결제를 멈추지 않기 위한 최후 폴백 — DB 씨앗값과 같은 값. */
const FALLBACK_KRW = 1417

/**
 * 무료·키 불필요·일 1회 갱신. 키가 필요한 곳(exchangerate.host 등)을 쓰면 시크릿이 하나 늘고
 * 그게 만료되는 날 결제가 멈춘다 — 환율은 그 정도 위험을 질 값이 아니다.
 */
const SOURCE_URL = 'https://open.er-api.com/v6/latest/USD'

/** 자동 수집 주기. 매일 받을 이유가 없다 — 정가는 사람이 정하는 값이고 환율은 청구 환산용이다. */
export const REFRESH_DAYS = 7

/**
 * 저장된 환율을 읽는다. **없으면 폴백을 쓴다 — 절대 실패시키지 않는다.**
 * 환율을 못 읽었다고 결제를 막으면, 고칠 수 있는 사람이 아무도 없는 시간(새벽·주말)에 매출이 0이 된다.
 */
export async function getRate(admin: SupabaseClient, currency = 'KRW'): Promise<number> {
  const { data } = await admin
    .from('exchange_rates')
    .select('rate')
    .eq('currency', currency)
    .maybeSingle()
  const rate = Number(data?.rate)
  return Number.isFinite(rate) && rate > 0 ? rate : FALLBACK_KRW
}

/**
 * 달러 센트 → 대상 통화 금액.
 * ⚠️ **올림이다.** 내림·반올림을 쓰면 건마다 몇 원씩 우리가 덜 받는다(작은 금액에서 비율이 커진다).
 * ⚠️ 원(KRW)은 소수가 없는 통화라 정수로 떨어뜨린다. 소수 통화를 쓰게 되면 여기서 자릿수를 갈라야 한다.
 */
export function convertFromUsdCents(cents: number, rate: number, currency = 'KRW'): number {
  const usd = Math.max(0, cents) / 100
  const raw = usd * rate
  return currency === 'KRW' || currency === 'JPY' ? Math.ceil(raw) : Math.ceil(raw * 100) / 100
}

/**
 * 환율을 새로 받아 저장한다. 주기가 안 됐으면 아무것도 하지 않는다(호출부가 매번 불러도 안전).
 *
 * ⚠️ **관리자가 손으로 넣은 값(source='manual')은 덮어쓰지 않는다.** 사람이 일부러 고정해 둔 값을
 *    자동 수집이 조용히 되돌리면, 왜 값이 원래대로 돌아갔는지 아무도 설명하지 못한다.
 * ⚠️ 수집에 실패해도 **기존 값을 지우거나 낮추지 않는다** — 옛 값이 최신값보다 낫다.
 */
export async function refreshRates(
  admin: SupabaseClient,
  opts: { force?: boolean } = {},
): Promise<{ updated: boolean; rate: number; reason?: string }> {
  const { data: row } = await admin
    .from('exchange_rates')
    .select('rate, source, fetched_at')
    .eq('currency', 'KRW')
    .maybeSingle()

  const current = Number(row?.rate) || FALLBACK_KRW

  if (!opts.force) {
    if (row?.source === 'manual') return { updated: false, rate: current, reason: 'manual' }
    const ageDays = row?.fetched_at
      ? (Date.now() - new Date(row.fetched_at as string).getTime()) / 86_400_000
      : Infinity
    if (ageDays < REFRESH_DAYS) return { updated: false, rate: current, reason: 'fresh' }
  }

  let fetched: number | null = null
  try {
    const res = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(10_000) })
    const json = (await res.json()) as { result?: string; rates?: Record<string, number> }
    const v = Number(json?.rates?.KRW)
    // 자릿수가 어긋난 값(예: 1.4)이 들어오면 정가가 통째로 무너진다 — 상식 범위 밖은 버린다.
    if (json?.result === 'success' && Number.isFinite(v) && v > 100 && v < 100_000) fetched = v
  } catch {
    /* 네트워크 실패 — 아래에서 기존 값 유지 */
  }

  if (fetched == null) return { updated: false, rate: current, reason: 'fetch_failed' }

  const now = new Date().toISOString()
  await admin
    .from('exchange_rates')
    .upsert({ currency: 'KRW', rate: fetched, source: 'auto', fetched_at: now, updated_at: now })
  return { updated: true, rate: fetched }
}
