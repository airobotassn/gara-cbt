// submit-test: TTL/상태 검증 → 채점 → 축별 perf →
//   영구유저면 그 레벨 누적(user_level_skill) 갱신 + 등급(user_progress) 이동(멱등 가드) / 익명이면 총점만+claimToken
import { corsHeaders, json } from '../_shared/cors.ts'
import {
  adminClient,
  getUser,
  axisPerf,
  applyAttempt,
  claimApply,
  fullResult,
  lockedResult,
  ATTEMPT_TTL_MINUTES,
  type AxisMap,
} from '../_shared/scoring.ts'
import { kstDay } from '../_shared/kst.ts'

interface InAnswer {
  questionId: string
  selectedIndex: number | null
  timeSpent?: number
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { attemptId, answers, violationCount, voided } = await req.json()
    if (!attemptId || (!voided && !Array.isArray(answers))) {
      return json({ error: '잘못된 요청입니다.' }, 400)
    }

    const user = await getUser(req)
    if (!user) return json({ error: '인증이 필요합니다.' }, 401)

    const admin = adminClient()

    const { data: attempt } = await admin
      .from('test_attempts')
      .select('*')
      .eq('id', attemptId)
      .single()
    if (!attempt) return json({ error: '시험을 찾을 수 없습니다.' }, 404)
    if (attempt.user_id !== user.id) return json({ error: '권한이 없습니다.' }, 403)
    if (attempt.status !== 'in_progress') {
      return json({ error: '이미 종료된 시험입니다.' }, 409)
    }
    const ageMin = (Date.now() - new Date(attempt.started_at).getTime()) / 60000
    if (ageMin > ATTEMPT_TTL_MINUTES) {
      await admin.from('test_attempts').update({ status: 'expired' }).eq('id', attemptId)
      return json({ error: '시험 제한시간이 만료되었습니다. 다시 시작해주세요.' }, 410)
    }

    // 부정행위(경고 누적)로 무효 처리 — 채점 없이 voided 기록
    if (voided) {
      await admin
        .from('test_attempts')
        .update({
          status: 'voided',
          submitted_at: new Date().toISOString(),
          violation_count: Math.max(0, Math.floor(violationCount ?? 0)),
        })
        .eq('id', attemptId)
      return json({ ok: true, voided: true })
    }

    // 출제된(고정된) 문항 + 정답
    const { data: assigned } = await admin
      .from('test_answers')
      .select('id, question_id, category, test_questions(correct_index)')
      .eq('attempt_id', attemptId)
    if (!assigned || assigned.length === 0) {
      return json({ error: '채점할 문항이 없습니다.' }, 400)
    }

    // 실제 출제 문항 수 = 승급컷/강등선(비율) 판정의 분모.
    const totalQuestions = assigned.length

    const submittedMap = new Map<string, InAnswer>()
    for (const a of answers as InAnswer[]) submittedMap.set(a.questionId, a)

    // 축별 정답/총계 집계(출제된 축만)
    const correctByCat: Record<string, number> = {}
    const totalByCat: Record<string, number> = {}
    let totalCorrect = 0

    for (const row of assigned as any[]) {
      const cat = row.category as string
      totalByCat[cat] = (totalByCat[cat] ?? 0) + 1
      correctByCat[cat] = correctByCat[cat] ?? 0
      const sub = submittedMap.get(row.question_id)
      const selected = sub?.selectedIndex ?? null
      const correctIndex = row.test_questions?.correct_index ?? -1
      const isCorrect = selected !== null && selected === correctIndex
      if (isCorrect) {
        totalCorrect += 1
        correctByCat[cat] += 1
      }
      await admin
        .from('test_answers')
        .update({
          selected_index: selected,
          is_correct: isCorrect,
          time_spent: Math.max(0, Math.floor(sub?.timeSpent ?? 0)),
        })
        .eq('id', row.id)
    }

    // 이 시험의 축별 perf (출제된 축만, 0~100)
    const perf: AxisMap = {}
    for (const cat of Object.keys(totalByCat)) {
      const ratio = totalByCat[cat] > 0 ? correctByCat[cat] / totalByCat[cat] : 0
      perf[cat] = Math.round(axisPerf(ratio) * 100) / 100
    }

    // 제출 확정 + perf 저장
    const submittedAt = new Date().toISOString()
    await admin
      .from('test_attempts')
      .update({
        status: 'submitted',
        submitted_at: submittedAt,
        total_correct: totalCorrect,
        axis_perf: perf,
        violation_count: Math.max(0, Math.floor(violationCount ?? 0)),
      })
      .eq('id', attemptId)

    const finalAttempt = { ...attempt, status: 'submitted', submitted_at: submittedAt, total_correct: totalCorrect, axis_perf: perf }

    // 익명은 누적 미반영(총점만 + claimToken).
    if (user.is_anonymous) {
      return json(lockedResult(finalAttempt, true))
    }

    // 멱등 가드: 최초 1회만 반영
    if (await claimApply(admin, attemptId)) {
      // 승급컷/강등선이 비율이라 실제 출제 문항 수를 판정 분모로 넘긴다.
      const applied = await applyAttempt(admin, user.id, attempt.level, perf, totalCorrect, totalQuestions)
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
      finalAttempt.deltas = applied.deltas
      finalAttempt.rating_after = applied.ratings
      finalAttempt.rank_before = applied.rankBefore
      finalAttempt.rank_after = applied.rankAfter
      finalAttempt.rank_dir = applied.rankDir
      finalAttempt.warn_strikes = warnStrikes
      // 레벨테스트 = 실력점수 전용(활동점수 미적립) — 활동잔디엔 did_leveltest 플래그로만 금색 표시.
      await admin
        .from('daily_activity')
        .upsert({ user_id: user.id, day: kstDay(), did_leveltest: true }, { onConflict: 'user_id,day' })
    }

    return json(await fullResult(admin, finalAttempt))
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
