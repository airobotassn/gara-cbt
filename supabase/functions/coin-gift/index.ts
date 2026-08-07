// coin-gift: 유저끼리 CARI 코인을 선물한다. 원자 RPC(coin_gift)의 얇은 래퍼다.
//  · 잠금 순서(데드락 방지)·멱등(client_nonce)·잔액 검사·원장 기록은 전부 DB 함수가 한다.
//    여기서 잔액을 읽어 판단하지 않는다 — 읽고 판단하는 사이에 다른 창에서 쓸 수 있다.
//  · 액션 4개: lookup(코드→닉네임) · send(이체) · history(이력) · seen(받은 선물 확인 처리)
//  · cosmetic-only 하드 불변식: user_progress / user_level_skill 을 절대 만지지 않는다.
//    코인은 시즌 점수·랭킹과 완전히 별개 지갑이라 이 기능은 순위에 영향을 주지 않는다.
//
// ⚠️ **금액은 되돌릴 수 없다.** 즉시 이체라 취소·회수 경로가 없다. 방어선은 프론트의 닉네임 확인과
//    client_nonce 재사용 규약뿐이다 — nonce 를 호출마다 새로 만들면 재시도가 곧 두 번 보내기다.
// ⚠️ _shared 를 import 하므로 대시보드 편집 불가 → CLI 배포 전용: `supabase functions deploy coin-gift`.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'

// 토스가 아니라 우리 규격 — int4 상한을 넘는 값이 RPC 인자 캐스팅에서 죽지 않게 여기서 먼저 자른다.
const MAX_AMOUNT = 1_000_000_000

interface Body {
  action?: string
  code?: string
  amount?: number
  client_nonce?: string
  limit?: number
  before?: string
}

/** RPC 가 raise 한 사유를 그대로 프론트 코드로 옮긴다. 조용히 삼키지 않는다 —
 *  다시 열 수 있는 모달이라 왜 안 됐는지 말해줘야 사용자가 고쳐 칠 수 있다(redeem-referral 과 같은 판단). */
function giftError(message: string): { code: string; status: number } {
  if (message.includes('insufficient_points')) return { code: 'insufficient', status: 402 }
  if (message.includes('recipient_not_found')) return { code: 'not_found', status: 404 }
  if (message.includes('self_transfer')) return { code: 'self', status: 400 }
  if (message.includes('invalid_amount')) return { code: 'invalid_amount', status: 400 }
  if (message.includes('too_fast')) return { code: 'too_fast', status: 429 }
  return { code: 'server', status: 500 }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    // (1) 인증: 로그인 필수 + 익명 유저 불가.
    //     익명은 보낼 수도 받을 수도 없다 — 받는 쪽은 referral_code 가 없어서 자연히 막힌다(get-hub 가 익명을 먼저 컷).
    const user = await getUser(req)
    if (!user || user.is_anonymous) return json({ error: 'unauthorized' }, 401)

    const body = (await req.json().catch(() => ({}))) as Body
    const action = String(body.action ?? '')
    const admin = adminClient()
    const uid = user.id

    // ---------- 코드 → 닉네임 ----------
    // 오타로 엉뚱한 사람에게 보내는 걸 막는 유일한 장치라 반드시 이름을 돌려준다.
    // 쿼터(10분 30회)는 RPC 안에 있다 — 코드 공간이 100만이라 무제한이면 긁어서 수집할 수 있다.
    if (action === 'lookup') {
      const { data, error } = await admin.rpc('coin_gift_lookup', {
        p_uid: uid,
        p_code: String(body.code ?? ''),
      })
      if (error) return json({ error: 'server' }, 500)
      return json(data, 200)
    }

    // ---------- 이체 ----------
    if (action === 'send') {
      const amount = Math.floor(Number(body.amount))
      const nonce = typeof body.client_nonce === 'string' ? body.client_nonce.trim() : ''
      if (!nonce) return json({ error: 'invalid' }, 400)
      if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
        return json({ error: 'invalid_amount' }, 400)
      }

      const { data, error } = await admin.rpc('coin_gift', {
        p_uid: uid,
        p_code: String(body.code ?? ''),
        p_amount: amount,
        p_nonce: nonce,
      })
      if (error) {
        const mapped = giftError(error.message ?? '')
        return json({ error: mapped.code }, mapped.status)
      }
      return json(data, 200)
    }

    // ---------- 이력(보낸 것 + 받은 것) ----------
    // 허브는 '오늘 받은 것'만 보여주고, 그 이전은 전부 여기로 온다.
    // 발신자가 탈퇴해도 닉네임 스냅샷이 남아 "이 코인 어디서 왔는지"는 계속 답할 수 있다.
    if (action === 'history') {
      const limit = Math.min(Math.max(Number(body.limit ?? 30), 1), 100)
      let q = admin
        .from('coin_transfers')
        .select('id, sender_id, recipient_id, sender_name, recipient_name, amount, created_at')
        .or(`sender_id.eq.${uid},recipient_id.eq.${uid}`)
        .order('created_at', { ascending: false })
        .limit(limit)
      // 커서 페이지네이션 — offset 은 행이 계속 늘어나는 목록에서 경계가 흔들린다.
      if (typeof body.before === 'string' && body.before) q = q.lt('created_at', body.before)

      const { data, error } = await q
      if (error) return json({ error: 'server' }, 500)
      const rows = (data ?? []).map((r) => ({
        id: r.id as string,
        // 방향 판정은 서버가 한다 — 클라가 uid 를 비교하게 두면 화면마다 규칙이 갈린다.
        dir: (r.sender_id as string | null) === uid ? 'out' : 'in',
        name: (r.sender_id as string | null) === uid ? (r.recipient_name as string) : (r.sender_name as string),
        amount: r.amount as number,
        at: r.created_at as string,
      }))
      return json({ rows, next: rows.length === limit ? rows[rows.length - 1].at : null }, 200)
    }

    // ---------- 받은 선물 확인 처리 ----------
    // 모달을 열면 부른다. 멱등이라 몇 번 불려도 결과가 같다.
    if (action === 'seen') {
      const { error } = await admin
        .from('coin_transfers')
        .update({ seen_at: new Date().toISOString() })
        .eq('recipient_id', uid)
        .is('seen_at', null)
      if (error) return json({ error: 'server' }, 500)
      return json({ ok: true }, 200)
    }

    return json({ error: 'invalid' }, 400)
  } catch {
    return json({ error: 'server' }, 500)
  }
})
