// redeem-referral: 피초대자가 허브 '초대하기' 모달에서 친구의 초대코드를 등록한다.
//  · 계정당 1회, 되돌릴 수 없다(profiles.referred_by 가 비어있을 때만 박힌다).
//  · ⚠️ 이 함수는 **실패를 사용자에게 알려준다**(온보딩과 다른 점). 창구가 다시 열 수 있는 모달이라
//    오타를 조용히 삼키면 안 되고, 왜 안 됐는지 말해줘야 다시 칠 수 있다.
//    에러코드: not_found(없는 코드) · self(내 코드) · already(이미 등록) · invalid(형식) · unauthorized.
//  · 보상 = **양쪽 다 코인 50**(2026-08-24). 옛 보상(초대자에게만 시즌 점수 +5)은 제거됐다.
//    초대자 쪽은 상한이 없다 — 초대할수록 계속 받는다.
//  · ⛔ 판정·귀속·지급은 전부 RPC `redeem_referral` 안에서 **한 트랜잭션**으로 끝난다. 여기서 쪼개면
//    귀속만 되고 코인은 못 받는 상태가 만들어지는데, referred_by 가 1회용이라 되돌릴 방법이 없다.
// ⚠️ _shared 를 import 하므로 대시보드 편집 불가 → CLI 배포 전용: `supabase functions deploy redeem-referral`.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/scoring.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    // (1) 인증: 로그인 필수 + 익명 유저 불가(익명은 코드 발급 대상이 아니라 초대 보상도 성립하지 않는다).
    const user = await getUser(req)
    if (!user || user.is_anonymous) return json({ error: 'unauthorized' }, 401)

    // (2) 입력 정규화 — 발급 코드는 'CARI' + 알파벳/숫자 4자(대문자)라 대소문자·공백만 흡수한다.
    const body = (await req.json().catch(() => ({}))) as { code?: unknown }
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : ''
    if (!/^CARI[0-9A-Z]{4}$/.test(code)) return json({ error: 'not_found' }, 200)

    // (3) 나머지는 전부 DB 가 한다(원자 RPC).
    const admin = adminClient()
    const { data, error } = await admin.rpc('redeem_referral', { p_uid: user.id, p_code: code })
    if (error) {
      console.error('redeem-referral: rpc 실패', error)
      return json({ error: 'server' }, 500)
    }

    const res = (data ?? {}) as {
      ok?: boolean
      error?: string
      coin?: number
      balance?: number
      inviterName?: string | null
    }
    if (!res.ok) return json({ error: res.error ?? 'server' }, 200)

    return json({
      ok: true,
      coin: res.coin ?? 0, // 양쪽이 각각 받은 금액
      balance: res.balance ?? 0, // 등록한 사람(나)의 지급 후 잔액
      inviterName: res.inviterName ?? null,
    })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'server' }, 500)
  }
})
