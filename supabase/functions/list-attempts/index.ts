// list-attempts: 로그인(영구) 유저의 제출 기록 + 현재 등급 + 레벨별 누적 레이더 + 인증서 발자취. 익명은 빈 값.
//
// ⚠️ 인증서의 레벨은 rank 가 **아니다**. rank 는 '지금 서 있는 칸(= 응시 가능한 최고 레벨)' 이라
//    Lv.1 을 깨면 곧바로 2가 된다. 인증서가 증명하는 건 **깬 레벨**이므로 한 칸 낮다(취득 = rank − 1).
//    예외는 천장뿐 — 이미 Lv.7 인 사람이 Lv.7 을 통과하면 등급은 그대로지만 7을 깬 것이다.
//    (같은 규칙을 _shared/scoring.ts 의 skill_score 가 쓴다 — 고치면 양쪽 같이.)
// 발자취(milestones) = 레벨별 **최초 취득일**. 인증서(/test/certificate)의 북두칠성 노드에 찍힌다.
//    Lv.N 취득 = 그 응시로 등급이 N+1 로 오른 순간(rank_dir='up', rank_after=N+1).
//    Lv.7 만 승급 기록이 안 남으므로(천장) Lv.7 시험을 승급컷 넘겨 통과한 응시로 잡는다.
// ⚠️ 클라가 보낸 값으로 인증서를 그리지 않는다 — 레벨·날짜는 전부 여기서 계산해 내려준다(위조 차단).
import { corsHeaders, json } from '../_shared/cors.ts'
import {
  adminClient,
  getUser,
  toAxisMap,
  axisKeysForLevel,
  dailyAttemptsLeft,
  promoteCut,
  MAX_LEVEL,
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
    let clearedTop7 = false
    for (const a of data ?? []) {
      if (!a.submitted_at) continue
      if (a.rank_dir === 'up' && a.rank_after) {
        // 등급이 N+1 로 올랐다 = 레벨 N 을 깼다. (한 번에 한 칸씩만 오르므로 1:1 대응)
        const got = (a.rank_after as number) - 1
        if (got >= 1) milestones[got] = a.submitted_at as string
      } else if (
        // 천장 통과 — 이미 Lv.7 이라 등급이 안 움직인다(dir='stay'). 승급 기록이 없으니 직접 판정한다.
        a.level === MAX_LEVEL &&
        a.rank_after === MAX_LEVEL &&
        // 문항 수는 레벨 구간별(10/20/30)이라 컷이 비율이다. 옛 기록에 total_questions 가 비면 레벨 기준값으로 폴백.
        ((a.total_correct as number | null) ?? 0) >=
          promoteCut(a.level as number, (a.total_questions as number | null) ?? undefined)
      ) {
        milestones[MAX_LEVEL] = a.submitted_at as string
        clearedTop7 = true
      }
    }
    // 켜지는 별의 개수는 user_progress.rank 에서 뽑는다(승급 기록이 없는 옛 응시가 섞여도 안 흔들리게).
    // 날짜가 비는 레벨은 별만 켜지고 날짜가 안 찍힌다 — 화면이 null 을 이미 처리한다.
    const clearedTop = Math.max((currentRank ?? 1) - 1, clearedTop7 ? MAX_LEVEL : 0)

    const { data: prof } = await admin
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle()

    // 한 레벨도 못 깼으면 인증서 자체가 없다(응시만 했다고 발급하지 않는다).
    const certificate = clearedTop >= 1
      ? {
          displayName: ((prof?.display_name as string | null) ?? '').trim(),
          level: clearedTop,
          milestones,
        }
      : null

    return json({ attempts, currentRank, currentPoints, levelSkills, dailyLeft, certificate })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
