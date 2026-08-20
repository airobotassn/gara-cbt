// submit-exam: 소유/상태/TTL 검증 → (voided 면 무효 기록) → 서버 채점 → 제출 확정
//   결과 공개 시각 = 회차의 합격자 조회 시작일(그 달 25일 10시 KST). 옛 회차·상시는 제출 +7일 폴백.
//   ⚠️ 점수는 반환하지 않는다(공개일 이후 get-exam-result 로만).
//   ⚠️ _shared 사용 → CLI 로만 배포할 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient } from '../_shared/lib.ts'
import { getExamActor } from '../_shared/exam-token.ts'
import { sebCheckFailed } from '../_shared/seb.ts'
import { matchShort, parseAcceptedAnswers } from '../_shared/normalize.ts'
import { monthOfWindow, scheduleForMonth } from '../_shared/exam-schedule.ts'

// 응시 TTL(분) — 전역 상한/안전망. 실제 제한시간은 시험별 exams.duration_minutes 로 강제한다.
const ATTEMPT_TTL_MINUTES = 240
// 제출 왕복·네트워크 지연 흡수용 유예(분). 표기 제한시간에 이만큼만 더 허용.
const GRACE_MIN = 1
// 결과(점수/오답) 공개까지 대기(일) — 시크릿 RESULT_RELEASE_DAYS 로 조정(테스트 0=즉시 공개)
const RESULT_RELEASE_DAYS = Number(Deno.env.get('RESULT_RELEASE_DAYS') ?? 7)

interface InAnswer {
  questionId: string
  selectedIndex: number | null
  answerText?: string | null
  timeSpent?: number
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const sebErr = await sebCheckFailed(req)
    if (sebErr) return json({ error: sebErr }, 403)
    const { attemptId, answers, voided } = await req.json()
    if (!attemptId || (!voided && !Array.isArray(answers))) {
      return json({ error: '잘못된 요청입니다.' }, 400)
    }

    // 평소엔 로그인 세션, SEB 안에서는 시험 전용 토큰(_shared/exam-token.ts).
    // ⚠️ 토큰의 응시권 묶임은 여기서 다시 확인하지 않는다 — 아래 소유자 검사(attempt.user_id)가
    //    이미 "내 응시만" 으로 좁히고, 응시권↔응시 짝은 start-exam 이 만들 때 확정했다.
    const actor = await getExamActor(req)
    if (!actor) return json({ error: '인증이 필요합니다.' }, 401)
    const user = actor.user

    const admin = adminClient()

    const { data: attempt } = await admin
      .from('exam_attempts')
      .select('*')
      .eq('id', attemptId)
      .single()
    if (!attempt) return json({ error: '시험을 찾을 수 없습니다.' }, 404)
    if (attempt.user_id !== user.id) return json({ error: '권한이 없습니다.' }, 403)
    if (attempt.status !== 'in_progress') {
      return json({ error: '이미 종료된 시험입니다.' }, 409)
    }
    // 제한시간은 시험별 duration_minutes 를 서버가 강제한다(클라 카운트다운·240 상수 단독 신뢰 금지).
    //   전역 TTL(240)은 상한이고, 시험이 표방한 시간(exams.duration_minutes)이 실제 강제선이다.
    let limitMin = ATTEMPT_TTL_MINUTES
    if (attempt.exam_id) {
      const { data: ex } = await admin
        .from('exams')
        .select('duration_minutes')
        .eq('id', attempt.exam_id)
        .maybeSingle()
      const dur = (ex as { duration_minutes?: number } | null)?.duration_minutes
      if (typeof dur === 'number' && dur > 0) limitMin = Math.min(ATTEMPT_TTL_MINUTES, dur + GRACE_MIN)
    }
    const ageMin = (Date.now() - new Date(attempt.started_at).getTime()) / 60000
    if (ageMin > limitMin) {
      await admin.from('exam_attempts').update({ status: 'expired' }).eq('id', attemptId)
      return json({ error: '시험 제한시간이 만료되었습니다.' }, 410)
    }

    const submittedAt = new Date().toISOString()

    // 응시자가 스스로 종료(포기)하거나 부정행위로 무효 처리 — 채점 없이 voided 기록.
    // ⚠️ 사유를 반드시 남긴다. 관리자 복구 화면에서 '스스로 그만둔 것(quit)' 과
    //    '나갔다 와서 무효된 것(reentry)' 은 판단이 정반대라, 사유 없이 voided 만 보면 구분이 안 된다.
    if (voided) {
      await admin
        .from('exam_attempts')
        .update({
          status: 'voided',
          void_reason: 'quit',
          submitted_at: submittedAt,
        })
        .eq('id', attemptId)
      return json({ ok: true, voided: true, submittedAt })
    }

    // 출제된(고정된) 문항 + 정답/유형
    const { data: assigned } = await admin
      .from('attempt_answers')
      .select('id, question_id, questions(kind, correct_index, answer_key)')
      .eq('attempt_id', attemptId)
    if (!assigned || assigned.length === 0) {
      return json({ error: '채점할 문항이 없습니다.' }, 400)
    }

    const submittedMap = new Map<string, InAnswer>()
    for (const a of answers as InAnswer[]) submittedMap.set(a.questionId, a)

    // 서버 채점: 출제된 각 문항만(클라가 보낸 임의 문항은 무시)
    //  · 객관식: 정답 비교 자동채점(review_status=auto)
    //  · 주관식: 허용답안(answer_key, 줄바꿈 목록) 있으면 정규화 정확일치 자동채점(auto).
    //           허용답안이 없으면(미큐레이션) 기존대로 보류(pending) → 관리자 수동검수 폴백.
    let totalCorrect = 0
    for (const row of assigned as any[]) {
      const sub = submittedMap.get(row.question_id)
      const kind = row.questions?.kind ?? 'mc'
      const timeSpent = Math.max(0, Math.floor(sub?.timeSpent ?? 0))
      if (kind === 'short') {
        const answerKey: string | null = row.questions?.answer_key ?? null
        const auto = parseAcceptedAnswers(answerKey).length > 0
        const ok = auto && matchShort(sub?.answerText, answerKey)
        if (ok) totalCorrect += 1
        await admin
          .from('attempt_answers')
          .update({
            answer_text: sub?.answerText ?? null,
            selected_index: null,
            is_correct: auto ? ok : null,
            review_status: auto ? 'auto' : 'pending',
            time_spent: timeSpent,
          })
          .eq('id', row.id)
        continue
      }
      const selected = sub?.selectedIndex ?? null
      const correctIndex = row.questions?.correct_index ?? -1
      const isCorrect = selected !== null && selected === correctIndex
      if (isCorrect) totalCorrect += 1
      await admin
        .from('attempt_answers')
        .update({
          selected_index: selected,
          is_correct: isCorrect,
          review_status: 'auto',
          time_spent: timeSpent,
        })
        .eq('id', row.id)
    }

    // 결과 공개 시각.
    //   정기시험(월 규칙)은 **회차가 정한다** — 그 달 25일 10:00 KST(exam_rounds.result_release_at).
    //   ⚠️ 응시자별 '제출 +7일' 로 두면 11일에 본 사람이 18일에 점수를 보는데, 그건 채점 기간(21~24)이
    //      시작도 안 한 때다. 같은 회차인데 사람마다 공개일이 다른 것도 안 맞는다.
    //   회차가 없거나(상시·미배정) 월 규칙 밖인 옛 회차면 예전대로 +N일 폴백 — 이미 팔린 응시권의
    //   규칙을 바꾸지 않기 위해서다. RESULT_RELEASE_DAYS<=0 (테스트 즉시공개)은 언제나 이긴다.
    // ⚠️ 회차에 공개 시각을 저장해두지 않는다 — 달이 정해지면 언제나 그 달 25일 10시라 **계산으로 나온다**.
    //    월 규칙 회차인지는 응시 창이 그 달 11~20일인지로 가른다(monthOfWindow).
    const roundReleaseAt = await (async () => {
      if (!attempt.round_id) return null
      const { data: rd } = await admin
        .from('exam_rounds')
        .select('exam_start_at, exam_end_at')
        .eq('id', attempt.round_id)
        .maybeSingle()
      const month = monthOfWindow(rd?.exam_start_at, rd?.exam_end_at)
      return month ? scheduleForMonth(month).resultReleaseAt : null
    })()
    const resultReleaseAt = (() => {
      if (RESULT_RELEASE_DAYS <= 0) return new Date().toISOString()
      if (roundReleaseAt) return roundReleaseAt
      const kst = new Date(Date.now() + RESULT_RELEASE_DAYS * 864e5 + 9 * 3600e3)
      // 01:00 UTC = 10:00 KST
      return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), 1, 0, 0)).toISOString()
    })()

    await admin
      .from('exam_attempts')
      .update({
        status: 'submitted',
        submitted_at: submittedAt,
        result_release_at: resultReleaseAt,
        total_correct: totalCorrect,
      })
      .eq('id', attemptId)

    // ⚠️ 점수 비노출 — 공개 시각만 안내
    return json({ ok: true, submittedAt, resultReleaseAt })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
