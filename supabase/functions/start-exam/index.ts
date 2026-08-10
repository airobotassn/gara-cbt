// start-exam: **응시권(exam_tickets)만 믿는** 응시 게이트.
//   본인 응시권 조회 → (회차 공개·결제 유효·응시 창) 로 거르기 → 회차·급수 확정 →
//   1인1회 검사 → 응시 생성(ticket_id 포함) → 응시권 소진.
//
// ⚠️ body 의 tier·roundId 는 더 이상 읽지 않는다. 옛 코드는 클라가 준 tier 를 그대로 믿고 기본값 'pro' 를 썼다
//    = curl 로 tier 문자열만 바꾸면 활성 exams 행이 있는 급수는 누구나 무료로 응시됐다.
//    exam_attempts 는 RLS 정책 0개라 이 함수가 유일한 생성 경로다 — 여기만 막으면 우회로가 없다.
// ⚠️ _shared 사용 → CLI 로만 배포할 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, pickLang, projText } from '../_shared/lib.ts'
import { getExamActor } from '../_shared/exam-token.ts'
import { sebCheckFailed } from '../_shared/seb.ts'
import { EXAM_TICKET_COLS, consumeTicket, examWindowOpen } from '../_shared/exam-tickets.ts'
import { ROOT_ADMIN } from '../admin/constants.ts'

// ⚠️ 여기엔 TTL 상수가 없다(예전엔 있었다). 응시 재개를 TTL 로 판단하던 걸 없앴기 때문이다 —
//    "TTL 넘었으면 새 응시 생성"이 곧 응시권 1장으로 세션을 무한히 새로 만드는 구멍이었다(2026-08-06).
//    지금은 exam_attempts_ticket_live_uniq(where ticket_id is not null)가 **DB 에서** 한 응시권당 응시 1개를
//    강제하고, 제한시간 판정은 submit-exam 의 TTL 이 그대로 한다(started_at 이 유지되므로 연장되지 않는다).

// 응시 창 경계 계산의 **폴백에서만** 쓰는 KST 오프셋.
// ⚠️ exam_date 는 bare date 라 그냥 파싱하면 UTC 자정이 되어 9시간 어긋난다.
const KST_OFFSET = '+09:00'

interface TicketRow {
  id: string
  user_id: string
  round_id: string
  tier: string
  status: string
  source: string
  payment_id: string | null
  expires_at: string | null
}

interface RoundRow {
  id: string
  kind: string
  published: boolean
  exam_date: string | null
  exam_start_at: string | null
  exam_end_at: string | null
  title_i18n: Record<string, string> | null
}

/**
 * 응시 창의 시작·끝(ms). **문구 선택에만** 쓴다 — "아직 안 열렸다" 와 "이미 지났다" 를 가르기 위한 값이다.
 * 열림/닫힘 판정의 정본은 _shared/exam-tickets.ts 의 examWindowOpen 이고, 여기서 다시 판정하지 않는다.
 */
function windowBounds(round: RoundRow): { start: number | null; end: number | null } {
  const start = round.exam_start_at
    ? Date.parse(round.exam_start_at)
    : round.exam_date
      ? Date.parse(`${round.exam_date}T00:00:00${KST_OFFSET}`)
      : null
  const end = round.exam_end_at
    ? Date.parse(round.exam_end_at)
    : round.exam_date
      ? Date.parse(`${round.exam_date}T23:59:59${KST_OFFSET}`)
      : null
  return { start, end }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    // ⚠️ 응시권 검증을 이 안에 얹지 말 것 — SEB 가드는 SEB_REQUIRED 가 꺼지면 통째로 통과한다(_shared/seb.ts).
    const sebErr = await sebCheckFailed(req)
    if (sebErr) return json({ error: sebErr }, 403)

    // body 에서 읽는 건 응시권 id(선택)와 표시 언어뿐이다.
    const body = await req.json().catch(() => ({}))
    const bodyTicketId: string | null =
      typeof body?.ticketId === 'string' && body.ticketId ? body.ticketId : null
    const lang = pickLang(body?.lang)

    // 평소엔 로그인 세션, SEB 안에서는 시험 전용 토큰(_shared/exam-token.ts).
    const actor = await getExamActor(req)
    if (!actor) return json({ error: '인증이 필요합니다.' }, 401)
    const user = actor.user
    // ⚠️ SEB 토큰으로 들어왔으면 **토큰에 박힌 응시권만** 쓴다. body 값을 우선하면 토큰 하나로
    //    그 계정의 다른 응시권까지 태울 수 있어, "표는 이 응시권 하나로 묶인다"는 전제가 무너진다.
    const reqTicketId: string | null = actor.ticketId ?? bodyTicketId
    // 익명 세션에는 응시권이 붙을 수 없다(결제가 익명을 403 으로 막는다).
    // "로그인이 필요합니다" 만 쓰면 이미 익명 세션이 있는 사용자는 로그인된 줄 알고 같은 화면을 맴돈다 —
    // **결제한 그 계정** 으로 들어와야 한다는 뜻이 전달돼야 한다.
    if (user.is_anonymous) {
      return json(
        {
          error: '응시권을 결제한 계정으로 로그인해야 응시할 수 있습니다. 구글 로그인 후 다시 시도해 주세요.',
          code: 'login_required',
        },
        403,
      )
    }

    const admin = adminClient()
    const now = Date.now()

    // ---------- ① 내 응시권 ----------
    // ⚠️ ticketId 로 먼저 좁히지 않는다. 남의 ticketId 를 넣어도 이 user_id 스코프 밖으로 나가지 못해야 한다 —
    //    ticketId 는 마이페이지 응답·응시 준비 화면 등 클라 표면에 상시 노출되는 값이라
    //    "알면 곧 소진 권한" 이 되는 순간 남의 응시권을 태워버릴 수 있다.
    const { data: tRows, error: tErr } = await admin
      .from('exam_tickets')
      .select(EXAM_TICKET_COLS)
      .eq('user_id', user.id)
      .in('status', ['issued', 'consumed'])
      .order('issued_at', { ascending: true })
    if (tErr) return json({ error: tErr.message }, 500)
    const owned = (tRows ?? []) as unknown as TicketRow[]
    if (owned.length === 0) {
      return json(
        { error: '응시권이 없습니다. 원서접수(결제) 후 응시할 수 있습니다.', code: 'no_ticket' },
        403,
      )
    }

    // ---------- ② 회차 ----------
    const roundIds = [...new Set(owned.map((t) => t.round_id))]
    const roundMap = new Map<string, RoundRow>()
    {
      const { data: rRows } = await admin
        .from('exam_rounds')
        .select('id, kind, published, exam_date, exam_start_at, exam_end_at, title_i18n')
        .in('id', roundIds)
      for (const r of (rRows ?? []) as unknown as RoundRow[]) roundMap.set(r.id, r)
    }

    // ---------- ③ 결제가 살아있는지 ----------
    // 환불은 응시권을 자동으로 죽이지 않는다(회수는 사람이 하는 목록으로만 남는 방침).
    // 여기서 안 보면 "돈은 돌려받고 시험은 치른" 상태가 그대로 통과하고, 합격하면 자격번호까지 채번된다
    // (자격번호는 한번 나가면 회수가 안 된다). 조회 한 번으로 막는다.
    const payIds = [
      ...new Set(
        owned.filter((t) => t.source === 'pg' && t.payment_id).map((t) => t.payment_id as string),
      ),
    ]
    const paidSet = new Set<string>()
    if (payIds.length > 0) {
      const { data: pRows } = await admin
        .from('payments')
        .select('id, status')
        .in('id', payIds)
        .eq('status', 'paid')
      for (const p of (pRows ?? []) as { id: string }[]) paidSet.add(p.id)
    }

    // ---------- ④ 재응시 예외 계정 ----------
    // 관리자(루트/admin_users) 또는 RETAKE_ALLOW_EMAILS — 테스트/감독용.
    // ⚠️ 이 플래그는 **1인1회만** 우회한다. 응시권 검사는 절대 우회하지 않는다 —
    //    우회시키면 환경변수 한 줄이 곧 무료 응시권이 된다. 검수가 필요하면 관리자 수기 발급(source='admin')으로 받는다.
    const email = (user.email ?? '').toLowerCase()
    const isAdmin =
      (!!email && email === ROOT_ADMIN.toLowerCase()) ||
      (!!user.email &&
        (await admin.from('admin_users').select('email').eq('email', user.email).maybeSingle()).data != null)
    const allowList = (Deno.env.get('RETAKE_ALLOW_EMAILS') ?? '')
      .toLowerCase()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const canRetake = isAdmin || allowList.includes(email)

    // 이미 다 쓴(제출·무효) 응시권 — 후보에서 빼야 자동선택이 남은 응시권을 정확히 고른다.
    // 안 빼면 응시권 2장 중 1장을 쓴 사람이 pick_ticket 으로 튕기고, 골라도 409 를 받는다.
    const spent = new Set<string>()
    {
      const { data: usedRows } = await admin
        .from('exam_attempts')
        .select('ticket_id')
        .eq('user_id', user.id)
        .in('status', ['submitted', 'voided'])
        .not('ticket_id', 'is', null)
      for (const r of (usedRows ?? []) as { ticket_id: string | null }[]) {
        if (r.ticket_id) spent.add(r.ticket_id)
      }
    }

    // ---------- ⑤ 지금 쓸 수 있는 응시권만 남기기 ----------
    const usable: { ticket: TicketRow; round: RoundRow }[] = []
    let blocked: string | null = null // 후보가 0장일 때 사용자에게 보여줄 첫 번째 사유
    for (const t of owned) {
      const round = roundMap.get(t.round_id)
      if (!round) continue
      // 회차를 비공개로 내린 것 = 사실상 취소다. 판매 쪽(resolveExamOffer)만 published 를 보면
      // 이미 팔린 응시권은 그대로 살아서 취소된 회차의 시험이 열린다.
      if (!round.published) {
        blocked ??= '해당 회차가 공개 중이 아닙니다. 운영팀에 문의해 주세요.'
        continue
      }
      if (t.source === 'pg' && t.payment_id && !paidSet.has(t.payment_id)) {
        blocked ??= '결제가 취소·환불된 응시권입니다. 운영팀에 문의해 주세요.'
        continue
      }
      if (t.expires_at && Date.parse(t.expires_at) < now) {
        blocked ??= '응시권 유효기간이 지났습니다.'
        continue
      }
      if (!canRetake && spent.has(t.id)) {
        blocked ??= '이미 응시를 완료한 응시권입니다.'
        continue
      }
      // 응시 창(KST) 판정의 정본. 여기서 직접 날짜를 비교하지 않는다.
      const open: boolean = examWindowOpen(round)
      if (!open) {
        const b = windowBounds(round)
        // 경계가 아예 없는 회차(일정 미정·상시)는 '아직/지남' 어느 쪽도 아니다 — 뭉뚱그리지 말고 따로 말한다.
        if (b.start != null && now < b.start) blocked ??= '아직 응시 기간이 아닙니다.'
        else if (b.end != null && now > b.end) blocked ??= '응시 기간이 지났습니다.'
        else blocked ??= '지금은 응시할 수 없는 회차입니다.'
        continue
      }
      usable.push({ ticket: t, round })
    }

    if (usable.length === 0) {
      return json({ error: blocked ?? '사용할 수 있는 응시권이 없습니다.', code: 'no_ticket' }, 403)
    }

    let picked = usable[0]
    if (reqTicketId) {
      // ⚠️ 원본(owned)이 아니라 **거른 목록(usable)** 에서 찾는다.
      //    원본에서 찾으면 본인 응시권으로 시험 기간 밖 응시가 열린다.
      const found = usable.find((u) => u.ticket.id === reqTicketId)
      if (!found) return json({ error: '지금 사용할 수 있는 응시권이 아닙니다.', code: 'no_ticket' }, 403)
      picked = found
    } else if (usable.length > 1) {
      // SEB 진입로는 파라미터를 실어 보내지 못한다 → 1장이면 자동 선택, 여러 장이면 골라달라고 한다.
      return json(
        {
          error: '응시할 시험을 선택해 주세요.',
          code: 'pick_ticket',
          tickets: usable.map((u) => ({
            ticketId: u.ticket.id,
            roundId: u.round.id,
            roundTitle: projText(u.round.title_i18n, lang),
            tier: u.ticket.tier,
          })),
        },
        409,
      )
    }
    const ticket = picked.ticket
    // 방어적 단언 — 어떤 경로로 들어와도 응시 행이 응시권 소유자 아닌 계정으로 만들어지지 않게.
    if (ticket.user_id !== user.id) return json({ error: '권한이 없습니다.' }, 403)

    // ---------- ⑥ 등록시험 = (응시권의 회차 × 급수) ----------
    const { data: exam, error: examErr } = await admin
      .from('exams')
      .select('id, slug, title, duration_minutes, round_id, tier')
      .eq('round_id', ticket.round_id)
      .eq('tier', ticket.tier)
      .eq('active', true)
      .maybeSingle()
    if (examErr) return json({ error: examErr.message }, 500)
    // 응시권을 팔아놓고 관리자가 그 급수를 해제하면 여기로 떨어진다 = 돈은 받고 응시는 못 하는 상태.
    // 사용자가 스스로 풀 수 없으므로 문의 경로를 문구에 넣는다.
    if (!exam) {
      return json(
        { error: '해당 회차의 시험이 준비되지 않았습니다. 운영팀에 문의해 주세요.', code: 'exam_missing' },
        400,
      )
    }

    // 이미 제출(또는 무효)한 응시가 있으면 재응시 불가 — 1인 1회 (예외 계정 제외).
    // 응시권 단위 검사(spent)와 별개로 남겨둔다 — ticket_id 가 없는 옛 응시 기록은 그쪽에 안 잡힌다.
    if (!canRetake) {
      const { data: done } = await admin
        .from('exam_attempts')
        .select('id')
        .eq('user_id', user.id)
        .eq('exam_id', exam.id)
        .in('status', ['submitted', 'voided'])
        .limit(1)
        .maybeSingle()
      if (done) {
        return json(
          {
            error: '이미 응시를 완료하셨습니다. 자격검정은 1회만 응시할 수 있습니다.',
            alreadyDone: true,
            code: 'already_taken',
          },
          409,
        )
      }
    }

    // ---------- ⑦ 출제 문항 ----------
    // 이 등록시험의 뽑힌 세트(exam_questions) 조인, 세트 번호순.
    // ⚠️ 응시자에게 나가는 페이로드 — correct_index·answer_key·explanation(해설)은 절대 select 금지.
    const { data: set, error: qErr } = await admin
      .from('exam_questions')
      .select('number, questions(id, subject, topic, prompt, kind, choices, active)')
      .eq('exam_id', exam.id)
      .order('number', { ascending: true })
    if (qErr) return json({ error: qErr.message }, 500)
    const setRows = (set ?? []).filter((r: any) => r.questions?.active !== false)
    if (setRows.length === 0) {
      return json({ error: '아직 문항이 출제되지 않은 시험입니다.' }, 400)
    }
    let served = setRows.map((r: any) => ({
      id: r.questions.id, number: r.number, subject: r.questions.subject,
      topic: r.questions.topic, prompt: r.questions.prompt, kind: r.questions.kind ?? 'mc', choices: r.questions.choices ?? [],
    }))

    // (테스트용) 환경변수 EXAM_QUESTION_LIMIT 가 있으면 앞에서 그만큼만 출제
    const limit = Math.max(0, Math.floor(Number(Deno.env.get('EXAM_QUESTION_LIMIT') ?? 0)))
    if (limit > 0) served = served.slice(0, limit)

    // ---------- ⑧ 응시: 재개 or 생성 ----------
    // 재개가 먼저다. 새 attempt 를 만들면 started_at 이 초기화되는데, 문항 세트는 exam_questions 고정이라
    // "제출만 안 하고 나갔다 다시 들어오기" 로 제한시간을 무한 연장할 수 있다.
    // 응시권은 이미 consumed 라 아무것도 소모되지 않으므로 코드에서 막지 않으면 그대로 뚫린다.
    // ⛔ **상태를 가리지 않고** 이 응시권으로 만들어진 응시를 찾는다.
    //    예전엔 TTL(240분) 안의 in_progress 만 재개 대상으로 봤는데, 그러면 TTL 을 넘긴 응시는
    //    expired 로 눕히고 **같은 응시권으로 새 응시를 또 만들었다.** 문항 세트는 고정이라
    //    "문제 다 보고 제출 안 하고 나갔다가 4시간 뒤 재진입" 을 시험창(10일) 내내 반복할 수 있었다.
    //    이제 exam_attempts_ticket_live_uniq 가 `where ticket_id is not null` 이라 DB 가 두 번째 insert 를 막는다.
    //    즉 응시권 1장으로는 **끝까지 같은 응시 하나**만 존재한다 — 재개는 그 응시로 돌아가는 것이다.
    const { data: live } = await admin
      .from('exam_attempts')
      .select('id, started_at, status')
      .eq('ticket_id', ticket.id)
      .eq('user_id', user.id)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    let attemptId: string
    let startedAt: string
    if (live) {
      // 이미 끝난(제출·무효) 응시면 재개가 아니라 거절이다 — 1인 1회.
      if (live.status === 'submitted' || live.status === 'voided') {
        return json(
          { error: '이미 응시를 완료하셨습니다. 자격검정은 1회만 응시할 수 있습니다.', alreadyDone: true },
          409,
        )
      }
      // in_progress / expired 어느 쪽이든 **그 응시로 돌아간다.** 새로 만들지 않으므로 started_at 이 유지되고
      // 제한시간이 초기화되지 않는다(TTL 을 넘겼으면 submit-exam 이 제출을 거부한다 — 그게 정상 동작이다).
      if (live.status === 'expired') {
        await admin.from('exam_attempts').update({ status: 'in_progress' }).eq('id', live.id).eq('status', 'expired')
      }
      attemptId = live.id as string
      startedAt = live.started_at as string
    } else {
      // 이 응시권으로 만든 응시가 아직 없다. 다른 응시권으로 진행중인 응시가 있으면 정리한다(동시 1개 강제).
      await admin
        .from('exam_attempts')
        .update({ status: 'expired' })
        .eq('user_id', user.id)
        .eq('exam_id', exam.id)
        .eq('status', 'in_progress')

      const { data: attempt, error: aErr } = await admin
        .from('exam_attempts')
        .insert({
          exam_id: exam.id,
          round_id: ticket.round_id,
          user_id: user.id,
          ticket_id: ticket.id,
          status: 'in_progress',
          total_questions: served.length,
        })
        .select('id, started_at')
        .single()
      // 23505 = exam_attempts_ticket_live_uniq = 같은 응시권으로 요청이 동시에 두 개 들어왔다.
      if (aErr && (aErr as { code?: string }).code === '23505') {
        return json(
          { error: '이미 응시가 시작되었습니다. 잠시 후 다시 시도해 주세요.', code: 'attempt_exists' },
          409,
        )
      }
      if (aErr || !attempt) return json({ error: aErr?.message ?? '응시 생성 실패' }, 500)

      // 출제 문항 고정(부정 제출 방지) — 한 문항당 한 행. 주관식은 채점 보류(pending)로 시작.
      const answerRows = served.map((q) => ({
        attempt_id: attempt.id,
        question_id: q.id,
        number: q.number,
        selected_index: null,
        is_correct: null,
        review_status: q.kind === 'short' ? 'pending' : 'auto',
      }))
      const { error: insErr } = await admin.from('attempt_answers').insert(answerRows)
      if (insErr) {
        // 문항이 안 박힌 응시는 껍데기다. 그대로 두면 다음 진입에서 '재개' 대상이 되어 빈 시험이 열린다.
        // 만료로 눕히고 응시권은 소진하지 않는다(아직 issued 라 사용자가 다시 시도할 수 있다).
        await admin.from('exam_attempts').update({ status: 'expired' }).eq('id', attempt.id)
        return json({ error: insErr.message }, 500)
      }
      attemptId = attempt.id as string
      startedAt = attempt.started_at as string
    }

    // ---------- ⑨ 응시권 소진 ----------
    // ⚠️ 순서가 이렇게 된 이유: 응시권을 먼저 consumed 로 바꾸면 위 insert 가 실패했을 때 응시권만 날아간다.
    //    응시를 먼저 만들고 소진하면 소진이 실패해도 다음 진입에서 재개 경로로 이어져 멱등이다.
    //    이중 응시는 exam_attempts_ticket_live_uniq 가 막으므로 이 순서가 안전하다.
    // 0행이어도 실패로 보지 않는다 — 다른 요청이 먼저 소진한 것이고 응시는 이미 만들어져 있다.
    if (ticket.status === 'issued') await consumeTicket(admin, ticket.id, user.id)

    // 정답(correct_index) 제외하고 반환
    return json({
      attemptId,
      exam: {
        slug: exam.slug,
        title: exam.title,
        durationMinutes: exam.duration_minutes,
        totalQuestions: served.length,
        // 실제로 산 급수 — 준비/결과 화면이 'CARIS-Ⅰ Pro' 로 고정 표시하지 않으려면 필요하다.
        tier: exam.tier,
      },
      ticket: { id: ticket.id, roundId: ticket.round_id, tier: ticket.tier },
      startedAt,
      questions: served.map((q) => ({
        id: q.id,
        number: q.number,
        subject: q.subject,
        topic: q.topic,
        prompt: q.prompt,
        kind: q.kind ?? 'mc',
        choices: q.choices,
      })),
    })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
