// start-exam: **응시권(exam_tickets)만 믿는** 응시 게이트.
//   본인 응시권 조회 → (회차 공개·결제 유효·응시 창) 로 거르기 → 회차·급수 확정 →
//   1인1회 검사 → 응시 생성(ticket_id 포함) → 응시권 소진.
//
// ⚠️ body 의 tier·roundId 는 더 이상 읽지 않는다. 옛 코드는 클라가 준 tier 를 그대로 믿고 기본값 'pro' 를 썼다
//    = curl 로 tier 문자열만 바꾸면 활성 exams 행이 있는 급수는 누구나 무료로 응시됐다.
//    exam_attempts 는 RLS 정책 0개라 이 함수가 유일한 생성 경로다 — 여기만 막으면 우회로가 없다.
// ⚠️ _shared 사용 → CLI 로만 배포할 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, pickLang, projKoOptions, projKoText, projText } from '../_shared/lib.ts'
import { getExamActor } from '../_shared/exam-token.ts'
import { sebCheckFailed } from '../_shared/seb.ts'
import { EXAM_TICKET_COLS, consumeTicket, examWindowOpen } from '../_shared/exam-tickets.ts'
import { blockOnReentry } from '../_shared/exam-reentry.ts'
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

    // ── 읽기 한 파 ────────────────────────────────────────────────────────
    // 아래 ⓪·①·④ 와 '다 쓴 응시권'·'복구 유예' 는 **상수 키 또는 user 만** 쓰고 서로의 결과를
    // 인자·조건으로 쓰지 않는다. 예전엔 줄 세워서, 시험 시작 버튼을 누른 사람이 문항을 보기까지
    // 이 다섯 왕복을 차례로 기다렸다.
    //   ⚠️ **판정 순서는 아래 그대로다** — 잠금이면 여전히 제일 먼저 503 이 나간다.
    //      잠금 중에도 나머지 조회가 같이 나가지만 전부 읽기라 아무것도 바꾸지 않는다.
    //   ⚠️ 여기서 묶는 건 **읽기뿐**이다. 아래 ⑥부터의 쓰기(다른 응시 만료 → 응시 생성 → 답안 깔기 →
    //      응시권 소진)는 순서가 곧 정확성이라(⑥ 주석 참고) 손대지 않는다.
    //   ⚠️ admin_users 는 user.email 이 있을 때만 던진다 — 빈 값으로 조회하면 조건이 무의미해진다.
    const [lockRes, ticketRes, adminRowRes, spentRes] = await Promise.all([
      admin.from('site_settings').select('key, value').in('key', ['exam_start_locked', 'exam_start_lock_note']),
      // ⚠️ ticketId 로 먼저 좁히지 않는다. 남의 ticketId 를 넣어도 이 user_id 스코프 밖으로 나가지 못해야 한다 —
      //    ticketId 는 마이페이지 응답·응시 준비 화면 등 클라 표면에 상시 노출되는 값이라
      //    "알면 곧 소진 권한" 이 되는 순간 남의 응시권을 태워버릴 수 있다.
      admin
        .from('exam_tickets')
        .select(EXAM_TICKET_COLS)
        .eq('user_id', user.id)
        .in('status', ['issued', 'consumed'])
        .order('issued_at', { ascending: true }),
      user.email
        ? admin.from('admin_users').select('email').eq('email', user.email).maybeSingle()
        : Promise.resolve({ data: null }),
      // 이미 다 쓴(제출·무효) 응시권 — 후보에서 빼야 자동선택이 남은 응시권을 정확히 고른다.
      admin
        .from('exam_attempts')
        .select('ticket_id')
        .eq('user_id', user.id)
        .in('status', ['submitted', 'voided'])
        .not('ticket_id', 'is', null),
    ])

    // ---------- ⓪ 응시 시작 잠금 ----------
    // 배포·DB 작업 중에 새 응시가 시작되면 그 사람 시험이 날아간다. 관리자가 켜면 **새 응시만** 막는다.
    // ⚠️ 이미 보고 있는 사람은 막지 않는다 — 아래 재진입 경로(같은 응시로 돌아가기)는 이 검사보다 뒤에 있고,
    //    여기서 걸리는 건 '새로 시작'뿐이다. 잠금 때문에 시험 중인 사람이 제출을 못 하면 더 큰 사고다.
    {
      const map: Record<string, string> = {}
      for (const r of (lockRes.data ?? []) as { key: string; value: string }[]) map[r.key] = r.value
      if (map.exam_start_locked === '1') {
        return json(
          {
            error: map.exam_start_lock_note?.trim() || '지금은 시스템 점검 중이라 응시를 시작할 수 없습니다. 잠시 후 다시 시도해 주세요.',
            code: 'exam_locked',
          },
          503,
        )
      }
    }

    // ---------- ① 내 응시권 ----------
    // ⚠️ ticketId 로 먼저 좁히지 않는다. 남의 ticketId 를 넣어도 이 user_id 스코프 밖으로 나가지 못해야 한다 —
    //    ticketId 는 마이페이지 응답·응시 준비 화면 등 클라 표면에 상시 노출되는 값이라
    //    "알면 곧 소진 권한" 이 되는 순간 남의 응시권을 태워버릴 수 있다.
    if (ticketRes.error) return json({ error: ticketRes.error.message }, 500)
    const owned = (ticketRes.data ?? []) as unknown as TicketRow[]
    if (owned.length === 0) {
      return json(
        { error: '응시권이 없습니다. 원서접수(결제) 후 응시할 수 있습니다.', code: 'no_ticket' },
        403,
      )
    }

    // ---------- ② 회차 ----------
    const roundIds = [...new Set(owned.map((t) => t.round_id))]
    const roundMap = new Map<string, RoundRow>()
    const payIds = [
      ...new Set(
        owned.filter((t) => t.source === 'pg' && t.payment_id).map((t) => t.payment_id as string),
      ),
    ]
    const paidSet = new Set<string>()
    // ⚠️ 둘 다 위 응시권 목록에서 뽑은 id 배열만 쓰고 서로를 참조하지 않는다 → 한 파로 던진다.
    const [roundsRes, paysRes] = await Promise.all([
      admin
        .from('exam_rounds')
        .select('id, kind, published, exam_date, exam_start_at, exam_end_at, title_i18n')
        .in('id', roundIds),
      payIds.length > 0
        ? admin.from('payments').select('id, status').in('id', payIds).eq('status', 'paid')
        : Promise.resolve({ data: null }),
    ])
    for (const r of (roundsRes.data ?? []) as unknown as RoundRow[]) roundMap.set(r.id, r)
    for (const p of (paysRes.data ?? []) as { id: string }[]) paidSet.add(p.id)

    // ---------- ③ 결제가 살아있는지 ----------
    // 환불은 응시권을 자동으로 죽이지 않는다(회수는 사람이 하는 목록으로만 남는 방침).
    // 여기서 안 보면 "돈은 돌려받고 시험은 치른" 상태가 그대로 통과하고, 합격하면 자격번호까지 채번된다
    // (자격번호는 한번 나가면 회수가 안 된다). 조회 한 번으로 막는다.

    // ---------- ④ 재응시 예외 계정 ----------
    // 관리자(루트/admin_users) 또는 RETAKE_ALLOW_EMAILS — 테스트/감독용.
    // ⚠️ 이 플래그는 **1인1회만** 우회한다. 응시권 검사는 절대 우회하지 않는다 —
    //    우회시키면 환경변수 한 줄이 곧 무료 응시권이 된다. 검수가 필요하면 관리자 수기 발급(source='admin')으로 받는다.
    const email = (user.email ?? '').toLowerCase()
    const isAdmin =
      (!!email && email === ROOT_ADMIN.toLowerCase()) ||
      (!!user.email && adminRowRes.data != null)
    const allowList = (Deno.env.get('RETAKE_ALLOW_EMAILS') ?? '')
      .toLowerCase()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const canRetake = isAdmin || allowList.includes(email)

    // 이미 다 쓴(제출·무효) 응시권 — 후보에서 빼야 자동선택이 남은 응시권을 정확히 고른다.
    // 안 빼면 응시권 2장 중 1장을 쓴 사람이 pick_ticket 으로 튕기고, 골라도 409 를 받는다.
    const spent = new Set<string>()
    for (const r of (spentRes.data ?? []) as { ticket_id: string | null }[]) {
      if (r.ticket_id) spent.add(r.ticket_id)
    }

    // ⛔ **복구해도 응시 기간(10일) 밖에서는 못 들어간다(2026-08-13 결정).**
    //    예전엔 복구할 때 관리자가 별도 기한을 줘서 회차가 닫혀도 들어갈 수 있었는데, 규칙을
    //    "10일 안에만" 으로 정리하면서 걷어냈다. 마지막 날 저녁에 끊겨 다음 날 처리되는 사람은
    //    응시를 못 한다 — 열흘을 줬는데 마지막 날 밤에 시작한 쪽의 몫이라는 판단이다.
    //    ⚠️ 그래서 관리자 화면은 **기간이 이미 끝났으면 그렇게 보여줘야 한다**. 안 그러면
    //       복구를 눌러놓고 왜 안 되냐가 된다(Admin.tsx 의 InterruptionPanel).

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
      // ⚠️ 진행 중이던 응시가 있는데 기간이 닫혀 못 들어가는 경우를 '응시권 없음' 으로 끝내면 안 된다.
      //    (마지막 날 저녁에 PC 가 뻗은 사람이 정확히 여기로 온다.) 그냥 '기간이 지났습니다' 를 보면
      //    응시자는 자기 응시가 어떻게 됐는지 모른 채 끝나고, 무효 판정도 안 나서 관리자가 복구할 대상도 없다.
      //    사유와 문의 경로를 주고, 관리자가 이 응시를 집어 복구할 수 있게 id 를 같이 내려준다.
      const { data: stuck } = await admin
        .from('exam_attempts')
        .select('id')
        .eq('user_id', user.id)
        .in('status', ['in_progress', 'expired'])
        .not('ticket_id', 'is', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (stuck) {
        return json(
          {
            error:
              '진행 중이던 응시가 있으나 지금은 들어갈 수 없습니다(응시 기간 종료 등). 기기·네트워크 문제로 중단되셨다면 문의해 주세요 — 중단 기록을 확인해 남은 시간 그대로 다시 응시하실 수 있게 처리해 드립니다.',
            code: 'resume_blocked',
            attemptId: stuck.id,
          },
          403,
        )
      }
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
      .select('number, questions(id, subject, topic, prompt, prompt_i18n, kind, choices, choices_i18n, active)')
      .eq('exam_id', exam.id)
      .order('number', { ascending: true })
    if (qErr) return json({ error: qErr.message }, 500)
    const setRows = (set ?? []).filter((r: any) => r.questions?.active !== false)
    if (setRows.length === 0) {
      return json({ error: '아직 문항이 출제되지 않은 시험입니다.' }, 400)
    }
    // ⚠️ 여기서는 **원문 그대로** 들고 있는다. 어느 언어로 투영할지는 ⑧ 에서 정해진다 —
    //    재개는 요청 언어가 아니라 **처음 응시한 언어**로 돌아가야 하기 때문이다(아래 effLang).
    let served = setRows.map((r: any) => ({
      id: r.questions.id, number: r.number, subject: r.questions.subject,
      topic: r.questions.topic, kind: r.questions.kind ?? 'mc',
      prompt: r.questions.prompt, promptI18n: r.questions.prompt_i18n ?? {},
      choices: r.questions.choices ?? [], choicesI18n: r.questions.choices_i18n ?? {},
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
      .select('id, started_at, status, last_seen_at, answered_count, entry_count, reinstated_at, lang')
      .eq('ticket_id', ticket.id)
      .eq('user_id', user.id)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    let attemptId: string
    let startedAt: string
    // 실제로 문항을 투영할 언어. 신규 응시는 요청 언어, **재개는 처음 응시한 언어**다.
    // ⚠️ 재개에서 요청 언어를 쓰면, 중단했다가 화면 언어를 바꿔 돌아온 사람에게 앞서 풀던 문항이
    //    통째로 다른 언어로 뒤바뀐다(답안은 번호로 남아 있으므로 보기 순서만 같고 글이 달라진다).
    let effLang = lang
    if (live) {
      // ⛔ 들어갈 수 없는 사유(제출 완료·이미 무효·재진입)는 전부 _shared/exam-reentry.ts 한 곳이 판정한다.
      //    응시 준비 화면(seb-handoff)이 **SEB 를 켜기 전에** 같은 함수로 먼저 잡고, 여기는
      //    준비 화면을 건너뛰고 옛 링크로 바로 들어온 경우의 **최후 방어선**이다.
      const entries = (live.entry_count as number) ?? 1
      const blocked = await blockOnReentry(admin, user.id, ticket.id, now)
      if (blocked) return json(blocked, 409)

      // 복구된 응시 — 그 응시로 돌아간다. 문항도 답안도 그대로고, **남은 시간도 그대로**다.
      //
      // ⛔ **시계를 끊긴 지점에서 다시 켠다.** 끊긴 시각(last_seen_at)까지 쓴 시간만 소비된 것으로 치고,
      //    started_at 을 `지금 − 그 시간` 으로 옮긴다. 그러면 나가 있던 시간은 안 깎이고 남은 시간이 보존된다.
      //    ⚠️ **재진입 시점에 계산해야 한다.** 복구를 눌러준 시점에 맞추면, 관리자가 승인해놓고
      //       응시자가 몇 시간 뒤에 들어올 때 그 사이가 전부 흘러가 복구가 무의미해진다.
      //    ⚠️ 이게 성립하는 건 답안이 하트비트로 저장되기 때문이다(exam-session). 답이 안 남으면
      //       시간만 깎인 백지가 되어 처음부터 다시보다 나쁘다 — 둘은 한 쌍이다.
      const startedMs = live.started_at ? Date.parse(live.started_at as string) : now
      const deadMs = live.last_seen_at ? Date.parse(live.last_seen_at as string) : startedMs
      const usedMs = Math.max(0, Math.min(now - startedMs, deadMs - startedMs))
      const resumedStart = new Date(now - usedMs).toISOString()
      await admin
        .from('exam_attempts')
        .update({
          status: 'in_progress',
          started_at: resumedStart,
          // 관리자가 승인한 **그 한 번의 복귀**만 통과시킨다. 또 끊기면 다시 문의 → 다시 복구다
          // (코드가 횟수를 세는 게 아니라, 매번 사람이 정한다).
          reinstated_at: null,
          entry_count: entries + 1,
        })
        .eq('id', live.id)
      attemptId = live.id as string
      startedAt = resumedStart
      // 옛 응시(lang 컬럼 생기기 전)는 값이 없다 — 그때는 요청 언어를 그대로 쓴다.
      if (live.lang) effLang = pickLang(live.lang)
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
          // 응시 언어 고정 — 결과창(오답노트)이 이 값으로 투영한다.
          lang: effLang,
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
      // 시작 시각을 이력에도 남긴다 — 나중에 중단·복귀를 시간순으로 읽으려면 기준점이 있어야 한다.
      await admin.from('exam_session_events').insert({
        attempt_id: attemptId,
        kind: 'start',
        detail: { totalQuestions: served.length, seb: Boolean(actor.ticketId) },
      })
    }

    // ---------- ⑨ 응시권 소진 ----------
    // ⚠️ 순서가 이렇게 된 이유: 응시권을 먼저 consumed 로 바꾸면 위 insert 가 실패했을 때 응시권만 날아간다.
    //    응시를 먼저 만들고 소진하면 소진이 실패해도 다음 진입에서 재개 경로로 이어져 멱등이다.
    //    이중 응시는 exam_attempts_ticket_live_uniq 가 막으므로 이 순서가 안전하다.
    // 0행이어도 실패로 보지 않는다 — 다른 요청이 먼저 소진한 것이고 응시는 이미 만들어져 있다.
    if (ticket.status === 'issued') await consumeTicket(admin, ticket.id, user.id)

    // 중간 저장된 답안 — 끊겼다 돌아온 사람이 **풀던 자리에서 이어가게** 하는 값이다.
    // 하트비트가 저장해 둔 것이고(exam-session), 처음 시작한 응시면 비어 있다.
    // ⚠️ 정답은 절대 싣지 않는다 — 여기에 is_correct·correct_index 를 얹으면 응시 중에 답이 새어나간다.
    // ⚠️ 읽는 곳이 **응시 행의 jsonb 한 칸**으로 바뀌었다(20260825170000). 예전엔 문항 행을 훑었는데,
    //    그 구조 때문에 하트비트가 30초마다 문항 수만큼 UPDATE 를 쐈다. 채점 결과는 그대로 문항 행에 있다.
    const { data: draftRow } = await admin
      .from('exam_attempts')
      .select('draft_answers')
      .eq('id', attemptId)
      .maybeSingle()
    const draft = Array.isArray(draftRow?.draft_answers)
      ? (draftRow.draft_answers as { number?: unknown; selectedIndex?: unknown; answerText?: unknown }[])
      : []

    // 정답(correct_index) 제외하고 반환
    return json({
      attemptId,
      saved: draft
        .map((r) => ({
          number: Number(r?.number),
          selectedIndex: typeof r?.selectedIndex === 'number' ? r.selectedIndex : null,
          answerText: typeof r?.answerText === 'string' ? r.answerText : null,
        }))
        .filter((r) => Number.isFinite(r.number))
        .sort((a, b) => a.number - b.number),
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
      // 이 응시가 고정된 언어. 화면이 나중에 언어를 바꿔도 문항은 이 언어 그대로다 —
      // 응시 화면이 "지금 보고 있는 문항의 언어" 를 알아야 안내 문구를 맞출 수 있다.
      lang: effLang,
      // ⚠️ 투영은 **여기 한 곳**에서만 한다. 위에서 원문을 들고 온 이유가 이것이다(effLang 확정이 ⑧ 이후).
      //    미번역 문항은 projKo* 가 한국어 원문으로 떨어뜨린다 — 그 문항만 한국어로 보인다.
      questions: served.map((q) => ({
        id: q.id,
        number: q.number,
        subject: q.subject,
        topic: q.topic,
        prompt: projKoText(q.prompt, q.promptI18n, effLang),
        kind: q.kind ?? 'mc',
        choices: projKoOptions(q.choices, q.choicesI18n, effLang),
      })),
    })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
