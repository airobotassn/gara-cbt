// list-attempts: 로그인(영구) 유저의 제출 기록 + 현재 등급 + 레벨별 누적 레이더 + 인증서 발자취. 익명은 빈 값.
//
// 발자취(milestones) = 레벨별 **최초 도달일**. 레벨테스트 인증서(/test/certificate)의 북두칠성 노드에
// 찍히는 날짜다. Lv.2~7 은 승급 기록(rank_dir='up' → rank_after)의 가장 이른 제출일,
// Lv.1 은 승급이라는 사건이 없으므로(모두 Lv.1 에서 시작) **첫 응시 제출일**을 여정의 시작으로 쓴다.
// ⚠️ 클라가 보낸 값으로 인증서를 그리지 않는다 — 레벨·날짜는 전부 여기서 계산해 내려준다(위조 차단).
import { corsHeaders, json } from '../_shared/cors.ts'
import {
  adminClient,
  getUser,
  toAxisMap,
  axisKeysForLevel,
  dailyAttemptsLeft,
} from '../_shared/scoring.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const user = await getUser(req)
    if (!user) return json({ error: '인증이 필요합니다.' }, 401)
    // 게스트는 일일 제한 대상이 아니라 dailyLeft=null(화면에서 표시 생략).
    if (user.is_anonymous)
      return json({ attempts: [], currentRank: null, currentPoints: 0, levelSkills: [], dailyLeft: null, certificate: null })

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
      // 강등 제거 전 기록의 'down' 은 'stay' 로 접는다(옛 이력에서도 강등이 안 보이게).
      rankDir: a.rank_dir == null ? null : a.rank_dir === 'up' ? 'up' : 'stay',
      deltas: a.deltas ? toAxisMap(a.deltas, axisKeysForLevel(a.level)) : null,
      submittedAt: a.submitted_at,
    }))

    // 현재 등급/점수 (user_progress 한 줄). 응시 기록 없으면 등급 null.
    const { data: prog } = await admin
      .from('user_progress')
      .select('rank, points')
      .eq('user_id', user.id)
      .maybeSingle()
    const currentRank = attempts.length > 0 ? ((prog?.rank as number) ?? 1) : null
    const currentPoints = (prog?.points as number) ?? 0

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

    // 레벨 선택 화면의 '오늘 N회 남음' 표시용. 강제는 start-test 가 같은 헬퍼로 한다.
    const { left: dailyLeft } = await dailyAttemptsLeft(admin, user.id)

    // ── 인증서 발자취 ──────────────────────────────────────────────
    // data 는 submitted_at 내림차순이라 덮어쓰며 훑으면 각 레벨의 '가장 이른' 날짜가 남는다.
    const milestones: Record<number, string> = {}
    for (const a of data ?? []) {
      if (!a.submitted_at) continue
      if (a.rank_dir === 'up' && a.rank_after) milestones[a.rank_after as number] = a.submitted_at as string
    }
    const firstAt = (data ?? []).filter((a) => a.submitted_at).at(-1)?.submitted_at as string | undefined
    if (firstAt) milestones[1] = firstAt // Lv.1 = 여정의 시작(첫 응시)

    const { data: prof } = await admin
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle()

    const certificate = currentRank
      ? {
          displayName: ((prof?.display_name as string | null) ?? '').trim(),
          level: currentRank,
          milestones,
        }
      : null

    return json({ attempts, currentRank, currentPoints, levelSkills, dailyLeft, certificate })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
