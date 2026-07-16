// complete-daily: 로그인 유저가 '오늘의 완료(출석)'를 1/일(KST) 로 확정하고 cosmetic 재화·스탬프를 적립한다.
//  · daily_activity pk(user_id, day) = 1/day 가드. 오늘 최초 삽입일 때만 재화/스탬프 적립(멱등).
//  · 적립은 원자 SECURITY DEFINER SQL fn(complete_daily) 로 위임 — 기존 JS select→절대값 upsert(read-modify-write)
//    는 동시 호출 시 적립을 유실할 수 있어, 증분(points = points + p_points)을 하나의 트랜잭션으로 처리한다.
//  · cosmetic-only 하드 불변식: 실력 진척/스킬 레벨 테이블을 절대 읽거나 쓰지 않고,
//    _shared/scoring.ts(applyAttempt/computeRankChange) 도 import 하지 않는다. 수치는 config-driven 상수.
// ⚠️ _shared 를 import 하므로 대시보드 편집 불가 → CLI 배포 전용: `supabase functions deploy complete-daily`.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'

// 일일 완료 적립 재화(추후 config 로 이관). 스탬프는 종류별 1 카운트씩 누적.
const DAILY_POINTS = 10

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    // (1) 인증: 로그인 필수 + 익명 유저 불가.
    const user = await getUser(req)
    if (!user || user.is_anonymous) return json({ error: 'unauthorized' }, 401)

    // (2) 원자 적립: 1/일 가드 + 재화/스탬프 증분을 하나의 SQL 트랜잭션으로. RPC 반환 jsonb 를 그대로 전달.
    const { data, error } = await adminClient().rpc('complete_daily', {
      p_uid: user.id,
      p_points: DAILY_POINTS,
    })
    if (error) return json({ error: error.message }, 500)

    return json(data)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
