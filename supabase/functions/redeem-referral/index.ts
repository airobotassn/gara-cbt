// redeem-referral: 피초대자가 허브 '초대하기' 모달에서 친구의 초대코드를 등록한다.
//  · 계정당 1회, 되돌릴 수 없다(profiles.referred_by 가 비어있을 때만 박힌다).
//  · ⚠️ 이 함수는 **실패를 사용자에게 알려준다**(온보딩과 다른 점). 창구가 다시 열 수 있는 모달이라
//    오타를 조용히 삼키면 안 되고, 왜 안 됐는지 말해줘야 다시 칠 수 있다.
//    에러코드: not_found(없는 코드) · self(내 코드) · already(이미 등록) · invalid(형식) · unauthorized.
//  · 보상은 **초대자에게만** +5(원안). 피초대자 보상은 없다 — 넣으려면 아래 insert 를 하나 더 추가하면 된다.
//  · 하루 1회 캡과 같은 사람 중복 계산은 코드로 짜지 않는다 — activity_ledger 의 두 unique 인덱스가
//    이미 건다(daycap: user_id+kind+day / 중복: user_id+day+source_ref). 걸리면 23505 라 그냥 버린다:
//    귀속 자체는 이미 성립했으므로 점수만 안 들어갈 뿐 등록은 성공으로 응답한다.
// ⚠️ _shared 를 import 하므로 대시보드 편집 불가 → CLI 배포 전용: `supabase functions deploy redeem-referral`.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser, getActiveSeasonId, activityDelta } from '../_shared/scoring.ts'
import { kstDay } from '../_shared/kst.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    // (1) 인증: 로그인 필수 + 익명 유저 불가(익명은 랭킹 대상이 아니라 초대 보상도 의미 없다).
    const user = await getUser(req)
    if (!user || user.is_anonymous) return json({ error: 'unauthorized' }, 401)

    // (2) 입력 정규화 — 발급 코드는 'CARI' + 32자 알파벳 4자(대문자)라 대소문자·공백만 흡수한다.
    const body = (await req.json().catch(() => ({}))) as { code?: unknown }
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : ''
    if (!/^CARI[0-9A-Z]{4}$/.test(code)) return json({ error: 'not_found' }, 200)

    const admin = adminClient()

    // (3) 이미 등록했으면 여기서 끝. 되돌릴 수 없다.
    const { data: me } = await admin
      .from('profiles')
      .select('referred_by')
      .eq('id', user.id)
      .maybeSingle()
    if (me?.referred_by) return json({ error: 'already' }, 200)

    // (4) 코드 → 초대자. 없는 코드와 자기 코드는 구분해서 알려준다.
    const { data: inviter } = await admin
      .from('profiles')
      .select('id, display_name')
      .eq('referral_code', code)
      .maybeSingle()
    const inviterId = (inviter?.id as string | undefined) ?? null
    if (!inviterId) return json({ error: 'not_found' }, 200)
    if (inviterId === user.id) return json({ error: 'self' }, 200)

    // (5) 귀속 — referred_by 가 비어있는 행만 갱신(경합 시 한 번만 성립).
    const { data: claimed, error: claimErr } = await admin
      .from('profiles')
      .update({ referred_by: inviterId })
      .eq('id', user.id)
      .is('referred_by', null)
      .select('id')
    if (claimErr) return json({ error: 'server' }, 500)
    if (!claimed || claimed.length === 0) return json({ error: 'already' }, 200)

    // (6) 초대자 보상 — 캡에 걸리면(23505) 점수만 안 들어가고 등록은 성공이다.
    const seasonId = await getActiveSeasonId(admin)
    let credited = false
    if (seasonId != null) {
      const { error: ledgerErr } = await admin.from('activity_ledger').insert({
        user_id: inviterId,
        season_id: seasonId,
        kind: 'referral',
        delta: activityDelta('referral'),
        day: kstDay(),
        source_ref: user.id,
      })
      if (ledgerErr && ledgerErr.code !== '23505') {
        console.error('redeem-referral: activity_ledger insert 실패', ledgerErr)
      }
      credited = !ledgerErr
    }

    return json({
      ok: true,
      credited, // 초대자에게 실제 적립됐는지(하루 캡에 걸리면 false — 등록 자체는 성공)
      delta: activityDelta('referral'),
      inviterName: (inviter?.display_name as string | null) ?? null,
    })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'server' }, 500)
  }
})
