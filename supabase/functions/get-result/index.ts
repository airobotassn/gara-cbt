// get-result: 결과 재조회 + (claimToken 있으면) 익명 attempt를 현재 로그인 user로 이관
//  - 이관 시 미반영(applied=false) attempt를 그 계정의 그 레벨 누적·등급에 1회 적용(멱등 가드)
//  - 응답: 요청자가 익명이면 총점만, 영구유저면 그 레벨 누적·변동·등급변동·해설(응시 언어) 전부
import { corsHeaders, json } from '../_shared/cors.ts'
import {
  adminClient,
  getUser,
  hasRecentSubmission,
  isCooldownExempt,
  applyAttempt,
  claimApply,
  fullResult,
  lockedResult,
  type AxisMap,
} from '../_shared/scoring.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { attemptId, claimToken } = await req.json()
    if (!attemptId) return json({ error: '잘못된 요청입니다.' }, 400)

    const user = await getUser(req)
    if (!user) return json({ error: '인증이 필요합니다.' }, 401)

    const admin = adminClient()

    const { data: attempt } = await admin
      .from('test_attempts')
      .select('*')
      .eq('id', attemptId)
      .single()
    if (!attempt) return json({ error: '결과를 찾을 수 없습니다.' }, 404)

    let owned = attempt.user_id === user.id

    // 이관 시도: 내 것이 아니고 토큰이 일치하면
    if (!owned && claimToken && attempt.claim_token === claimToken) {
      const { data: ownerProfile } = await admin
        .from('profiles')
        .select('is_anonymous')
        .eq('id', attempt.user_id)
        .single()
      const ownerIsAnon = ownerProfile?.is_anonymous ?? true
      if (!ownerIsAnon) return json({ error: '이미 연결된 결과입니다.' }, 409)

      // farming 차단: 대상 계정이 최근 3일 내 제출 있으면 이관 거부(테스트계정 면제)
      if (
        !user.is_anonymous &&
        !isCooldownExempt(user.email) &&
        (await hasRecentSubmission(admin, user.id, attemptId))
      ) {
        const locked = lockedResult(attempt, false) as Record<string, unknown>
        locked.cooldownBlocked = true
        return json(locked)
      }

      // 이관: user_id 변경 + 토큰 무효화(재사용 방지)
      const { error: tErr } = await admin
        .from('test_attempts')
        .update({ user_id: user.id, claim_token: crypto.randomUUID() })
        .eq('id', attemptId)
        .eq('claim_token', claimToken)
      if (tErr) return json({ error: tErr.message }, 500)
      attempt.user_id = user.id
      owned = true
    }

    if (!owned) return json({ error: '권한이 없습니다.' }, 403)

    // 익명이면 잠금
    if (user.is_anonymous) return json(lockedResult(attempt, false))

    // 미반영 attempt면 이관된 perf를 1회 적용(멱등 가드)
    if (!attempt.applied && attempt.axis_perf) {
      if (await claimApply(admin, attemptId)) {
        const applied = await applyAttempt(
          admin,
          user.id,
          attempt.level,
          attempt.axis_perf as AxisMap, // 출제된 축만 담긴 객체
          attempt.total_correct ?? 0,
        )
        const warnStrikes = applied.warned ? applied.demotionStrikes : 0
        await admin
          .from('test_attempts')
          .update({
            deltas: applied.deltas,
            rating_after: applied.ratings,
            rank_before: applied.rankBefore,
            rank_after: applied.rankAfter,
            rank_dir: applied.rankDir,
            warn_strikes: warnStrikes,
          })
          .eq('id', attemptId)
        attempt.deltas = applied.deltas
        attempt.rating_after = applied.ratings
        attempt.rank_before = applied.rankBefore
        attempt.rank_after = applied.rankAfter
        attempt.rank_dir = applied.rankDir
        attempt.warn_strikes = warnStrikes
      }
    }

    return json(await fullResult(admin, attempt))
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
