// list-attempts: 로그인(영구) 유저의 제출 기록 + 현재 등급 + 레벨별 누적 레이더. 익명은 빈 값.
import { corsHeaders, json } from '../_shared/cors.ts'
import {
  adminClient,
  getUser,
  toAxisMap,
  axisKeysForLevel,
} from '../_shared/lib.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const user = await getUser(req)
    if (!user) return json({ error: '인증이 필요합니다.' }, 401)
    if (user.is_anonymous)
      return json({ attempts: [], currentRank: null, currentPoints: 0, demotionStrikes: 0, levelSkills: [] })

    const admin = adminClient()

    const { data, error } = await admin
      .from('test_attempts')
      .select('id, level, total_correct, total_questions, rank_after, rank_dir, deltas, submitted_at')
      .eq('user_id', user.id)
      .eq('status', 'submitted')
      .order('submitted_at', { ascending: false })
    if (error) return json({ error: error.message }, 500)

    const attempts = (data ?? []).map((a) => ({
      attemptId: a.id,
      level: a.level,
      totalCorrect: a.total_correct,
      totalQuestions: a.total_questions,
      rankAfter: a.rank_after ?? null,
      rankDir: (a.rank_dir as 'up' | 'down' | 'stay' | null) ?? null,
      deltas: a.deltas ? toAxisMap(a.deltas, axisKeysForLevel(a.level)) : null,
      submittedAt: a.submitted_at,
    }))

    // 현재 등급/점수/경고 (user_progress 한 줄). 응시 기록 없으면 등급 null.
    const { data: prog } = await admin
      .from('user_progress')
      .select('rank, points, demotion_strikes')
      .eq('user_id', user.id)
      .maybeSingle()
    const currentRank = attempts.length > 0 ? ((prog?.rank as number) ?? 1) : null
    const currentPoints = (prog?.points as number) ?? 0
    const demotionStrikes = (prog?.demotion_strikes as number) ?? 0

    // 레벨별 누적 레이더
    const { data: skills } = await admin
      .from('user_level_skill')
      .select('level, ratings, attempts_count, placed')
      .eq('user_id', user.id)
      .order('level', { ascending: true })
    const levelSkills = (skills ?? [])
      .filter((s) => s.placed)
      .map((s) => ({
        level: s.level as number,
        ratings: toAxisMap(s.ratings, axisKeysForLevel(s.level as number)),
        attemptsCount: s.attempts_count as number,
      }))

    return json({ attempts, currentRank, currentPoints, demotionStrikes, levelSkills })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
