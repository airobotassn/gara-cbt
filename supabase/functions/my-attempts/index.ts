// my-attempts: 로그인 유저 본인의 응시 내역 + 보유 응시권. 점수/합격은 결과 공개일 이후에만 노출.
//   - 조회 시점에 TTL(240분) 지나도록 미제출인 진행중 응시는 만료(expired) 처리.
//   - body { issue: attemptId, nameRoman } 로 인증서 발급 기록(공개 후 + 합격만, 재발급은 시각 갱신).
//     nameRoman = 인증서에 각인할 영문 성명(발급 신청 화면에서 입력). 발급 시점 스냅샷이라 응시 기록에 저장한다.
//   - body { lang } 은 응시권의 회차명(다국어 JSONB) 투영에만 쓴다.
//   ⚠️ _shared 사용 → CLI 로만 배포할 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser, pickLang, projText } from '../_shared/lib.ts'
import { makeCertNo, subjectOf, gradeOfTitle } from '../_shared/cert.ts'
import { examWindowOpen, ticketSourceAlive } from '../_shared/exam-tickets.ts'

const PASS_RATIO = 0.6
// submit-exam 의 ATTEMPT_TTL_MINUTES 와 동일 기준 — 이 시간이 지나도록 미제출이면 만료
const ATTEMPT_TTL_MINUTES = 240
// 응시권 목록 상한. 한 사람이 회차×급수로 몇 장 사는 물건이라 응시 내역(50)과 같은 값이면 충분하다.
const TICKET_LIMIT = 50

interface TicketRow {
  id: string
  round_id: string
  tier: string
  status: string
  source: string
  price_paid: number | null
  expires_at: string | null
  issued_at: string | null
  consumed_at: string | null
}

interface RoundRow {
  id: string
  kind: string
  title_i18n: Record<string, string> | null
  exam_date: string | null
  exam_start_at: string | null
  exam_end_at: string | null
  apply_start_at: string | null
  apply_end_at: string | null
  published: boolean
}

interface TicketAttemptRow {
  id: string
  ticket_id: string | null
  status: string
  started_at: string | null
}

// 한 응시권에 응시가 여러 개 붙을 수 있다(TTL 만료 후 재시작). 화면이 가리킬 값은 하나뿐이라
// 우선순위를 매겨 고른다. 여기 없는 상태(expired)는 0 = 가리키지 않는다.
const ATTEMPT_RANK: Record<string, number> = { submitted: 3, voided: 3, in_progress: 2 }

// 응시 창의 시작 시각(ms).
// ⚠️ 열렸는지/닫혔는지의 정본은 examWindowOpen 이다(start-exam 도 같은 함수로 거른다).
//    이 헬퍼는 "닫혀 있을 때 아직 전인지, 이미 지났는지"만 가른다 — 안내 문구가 갈리기 때문이고,
//    판정을 여기서 다시 하는 게 아니다.
// ⚠️ exam_date 는 bare date 라 그냥 파싱하면 UTC 자정이 된다(= KST 로 9시간 어긋난다).
//    응시 창은 KST 기준이므로 오프셋을 명시해서 박는다.
function examWindowStart(round: RoundRow): number {
  if (round.exam_start_at) return Date.parse(round.exam_start_at)
  if (round.exam_date) return Date.parse(`${round.exam_date}T00:00:00+09:00`)
  return Number.NEGATIVE_INFINITY // 시험일이 없는 회차(상시) — 시작 경계가 없다
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const user = await getUser(req)
    if (!user) return json({ error: '인증이 필요합니다.' }, 401)

    const body = await req.json().catch(() => ({}))
    const admin = adminClient()
    const now = Date.now()

    // ── 접속 기록 ──
    // 관리자 대시보드의 "오늘 접속자 · 휴면 회원"의 유일한 출처. 이걸 안 남기면 그 두 값은 영원히 0이다.
    // ⚠️ 이력 테이블이 아니라 `profiles` 의 컬럼 하나다 — 접속마다 행을 쌓으면 금방 수십만 줄이 된다.
    // ⚠️ 익명 세션은 세지 않는다(게스트는 회원이 아니다).
    if (body?.action === 'seen') {
      if (user.is_anonymous) return json({ ok: true })
      await admin.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', user.id)
      return json({ ok: true })
    }

    // 방치된 진행중 응시 만료 — 제한시간을 훌쩍 넘긴 것(TTL)만
    const cutoff = new Date(now - ATTEMPT_TTL_MINUTES * 60000).toISOString()
    await admin
      .from('exam_attempts')
      .update({ status: 'expired' })
      .eq('user_id', user.id)
      .eq('status', 'in_progress')
      .lt('started_at', cutoff)

    // 인증서 발급 기록 — 결과 공개 후 + 합격만 가능. 발급 완료여도 재발급 허용(시각 갱신).
    // 최초 발급 시 진위확인용 토큰·자격번호를 확정 저장(재발급은 기존 값 유지 → QR 불변).
    let issued: { verifyToken: string; certNo: string; nameRoman: string | null } | null = null
    if (body?.issue) {
      const { data: a } = await admin
        .from('exam_attempts')
        .select('id, user_id, exam_id, ticket_id, status, result_release_at, submitted_at, total_correct, total_questions, verify_token, cert_no, cert_name_roman')
        .eq('id', body.issue)
        .maybeSingle()
      if (!a || a.user_id !== user.id) return json({ error: '권한이 없습니다.' }, 403)
      const released =
        a.status === 'submitted' &&
        !!a.result_release_at &&
        now >= new Date(a.result_release_at).getTime()
      const passed =
        released && a.total_correct != null && a.total_questions
          ? a.total_correct >= Math.ceil(a.total_questions * PASS_RATIO)
          : false
      if (!passed) return json({ error: '인증서는 결과 공개 후 합격한 응시만 발급할 수 있습니다.' }, 409)

      // 결제·응시권 생존 재확인 — start-exam 은 응시 시작 때 강제하지만, 그 뒤 환불(차지백)·관리자
      // 회수(void)는 시간상 더 뒤라 발급 시점에 다시 본다. 자격번호는 한번 나가면 회수 불가라 여기서 막는다.
      // ⚠️ 같은 판정을 payments/create(발급비 결제)도 쓴다 — 판정이 갈리면 "결제는 됐는데 발급만 거절"이 생긴다.
      const alive = await ticketSourceAlive(admin, (a.ticket_id as string | null) ?? null)
      if (!alive.ok) return json({ error: alive.error }, 409)

      // 자격증 발급비 — 최초 발급은 발급비 결제(cert paid)가 있어야 한다. 재발급(이미 cert_no·토큰 있음)은 무료.
      //   결제 우회로 발급하지 못하게, 채번 전에 이 응시(product_ref = attempt id)의 paid cert 주문을 확인한다.
      if (!(a.verify_token && a.cert_no)) {
        const { data: certPaid } = await admin
          .from('payments')
          .select('id')
          .eq('user_id', user.id)
          .eq('product_type', 'cert')
          .eq('product_ref', a.id)
          .eq('status', 'paid')
          .maybeSingle()
        // ⚠️ 프론트(Certificate.tsx)가 이 문자열로 결제 화면 전환을 판단한다 — 같은 핸들러의
        //    invalid_name_roman·name_roman_required 와 같은 기계 코드 관례다. 문구로 바꾸지 말 것.
        if (!certPaid) return json({ error: 'cert_fee_required', needsPayment: true }, 402)
      }

      // 영문 성명 검증 — 채번보다 먼저 통과시킨다. 검증 실패(400)가 자격번호 시퀀스를 소각하면 안 된다.
      // 규칙: 라틴 문자·공백·하이픈·아포스트로피·마침표만(여권 표기 관행), 2~40자.
      const stored = (a.cert_name_roman as string | null) ?? null
      const input = typeof body.nameRoman === 'string' ? body.nameRoman.trim().replace(/\s+/g, ' ') : ''
      let nameRoman = stored
      if (input) {
        if (input.length < 2 || input.length > 40 || !/^[A-Za-z][A-Za-z .'-]*$/.test(input)) {
          return json({ error: 'invalid_name_roman' }, 400)
        }
        nameRoman = input
      }
      if (!nameRoman) return json({ error: 'name_roman_required' }, 400)

      // 이미 발급된 건 = 재발급: 채번을 다시 부르지 않고(시퀀스 안 새게) 시각·이름만 갱신, 번호·토큰 불변.
      if (a.verify_token && a.cert_no) {
        const { error: reErr } = await admin
          .from('exam_attempts')
          .update({ cert_issued_at: new Date().toISOString(), cert_name_roman: nameRoman })
          .eq('id', a.id)
        if (reErr) return json({ error: reErr.message }, 400)
        issued = { verifyToken: a.verify_token as string, certNo: a.cert_no as string, nameRoman }
      } else {
        // 최초 발급 — 위 검증(소유·합격·생존·이름)을 전부 통과한 뒤에만 채번한다.
        // 시험명으로 트랙 추정 → 자격번호. 연도는 취득(제출) 연도.
        let title: string | null = null
        if (a.exam_id) {
          const { data: ex } = await admin.from('exams').select('title').eq('id', a.exam_id).maybeSingle()
          title = (ex as { title?: string } | null)?.title ?? null
        }
        const year = a.submitted_at ? new Date(a.submitted_at).getFullYear() : new Date().getFullYear()
        const grade = gradeOfTitle(title)
        // 일련번호는 DB 가 채번한다(종목·등급·연도별 원자 증가). 여기서 만들어내면 중복이 나간다.
        const { data: seq, error: seqErr } = await admin.rpc('next_cert_seq', {
          p_subject: subjectOf(grade),
          p_grade: grade,
          p_year: year,
        })
        // 채번 실패 시 임시 번호로 때우지 않는다 — 자격번호는 한번 나가면 회수가 안 된다.
        if (seqErr || typeof seq !== 'number') return json({ error: 'cert_seq_failed' }, 500)
        const verifyToken = crypto.randomUUID()
        const certNo = makeCertNo(grade, year, seq)

        // 선점형 UPDATE — cert_no 가 아직 비어 있을 때만 내 값을 박는다. 동시 발급이 먼저 채웠으면
        // 0행이 돌아오고, 그땐 이미 확정된 값을 재조회해 반환한다(응답=저장 보장, 중복 번호·죽은 QR 방지).
        const { data: won, error: issueErr } = await admin
          .from('exam_attempts')
          .update({ cert_issued_at: new Date().toISOString(), verify_token: verifyToken, cert_no: certNo, cert_name_roman: nameRoman })
          .eq('id', a.id)
          .is('cert_no', null)
          .select('cert_no, verify_token, cert_name_roman')
        if (issueErr) return json({ error: issueErr.message }, 400)
        if (won && won.length > 0) {
          issued = { verifyToken, certNo, nameRoman }
        } else {
          // 경쟁에서 짐 — 내 seq 는 갭이 되지만(무해), 발급 번호는 이미 확정된 하나로 통일한다.
          const { data: fin } = await admin
            .from('exam_attempts')
            .select('cert_no, verify_token, cert_name_roman')
            .eq('id', a.id)
            .maybeSingle()
          issued = {
            verifyToken: (fin?.verify_token as string) ?? verifyToken,
            certNo: (fin?.cert_no as string) ?? certNo,
            nameRoman: (fin?.cert_name_roman as string | null) ?? nameRoman,
          }
        }
      }
    }

    const { data } = await admin
      .from('exam_attempts')
      .select('id, exam_id, status, started_at, submitted_at, result_release_at, total_correct, total_questions, cert_issued_at, verify_token, cert_no, cert_name_roman')
      .eq('user_id', user.id)
      .order('submitted_at', { ascending: false, nullsFirst: false })
      .order('started_at', { ascending: false })
      .limit(50)

    const rows = data ?? []
    const examIds = [...new Set(rows.map((r) => r.exam_id).filter(Boolean))]
    const titleMap: Record<string, string> = {}
    if (examIds.length) {
      const { data: exams } = await admin.from('exams').select('id, title').in('id', examIds)
      for (const e of exams ?? []) titleMap[(e as { id: string }).id] = (e as { title: string }).title
    }

    const attempts = rows.map((r) => {
      const released =
        r.status === 'submitted' &&
        !!r.result_release_at &&
        now >= new Date(r.result_release_at).getTime()
      const total = r.total_questions ?? 0
      const correct = released ? r.total_correct : null
      const passed = released && correct != null ? correct >= Math.ceil(total * PASS_RATIO) : null
      return {
        attemptId: r.id,
        examTitle: r.exam_id ? titleMap[r.exam_id] ?? null : null,
        status: r.status,
        startedAt: r.started_at,
        submittedAt: r.submitted_at,
        resultReleaseAt: r.result_release_at,
        released,
        totalCorrect: correct,
        totalQuestions: total,
        passed,
        certIssuedAt: passed ? r.cert_issued_at : null,
        certNo: passed ? r.cert_no ?? null : null,
        verifyToken: passed ? r.verify_token ?? null : null,
        certNameRoman: passed ? r.cert_name_roman ?? null : null,
      }
    })

    // ---------- 보유 응시권 ----------
    // 마이페이지 응시 탭이 이 함수 하나만 부르므로 여기에 얹는다(왕복이 안 늘고, '이 응시권은 이미
    // 소진됐다'는 판정을 서버가 한 번에 확정할 수 있다).
    // void 는 내려주지 않는다 — 회수된 응시권을 사용자 화면에 남길 이유가 없고, 회수 사유는 관리자 소관이다.
    // 컬럼을 _shared/exam-tickets.ts 의 공용 COLS 로 받지 않는 이유: 이 응답이 어느 컬럼에 기대는지가
    // 여기서 바로 보여야 한다. 반대로 '응시 가능한가' 판정은 examWindowOpen 하나로 묶는다 —
    // start-exam 이 같은 함수로 거르므로, 여기서 따로 계산하면 화면은 '응시 가능'인데 서버는 403 을
    // 주는 조합이 생긴다.
    const lang = pickLang(body?.lang)
    const { data: tRows } = await admin
      .from('exam_tickets')
      .select('id, round_id, tier, status, source, price_paid, expires_at, issued_at, consumed_at')
      .eq('user_id', user.id)
      .in('status', ['issued', 'consumed', 'expired'])
      .order('issued_at', { ascending: false })
      .limit(TICKET_LIMIT)
    const ticketRows = (tRows ?? []) as TicketRow[]

    // 시험환경 점검 여부 — 응시권 카드가 "점검 먼저" 게이트를 그리는 데 쓴다.
    //   ⚠️ 응시권에 묶인 기록이 우선이고, 없으면 그 사람이 어떤 식으로든 점검을 마친 적이 있는지 본다
    //      (응시권 없이 체험만 한 경우도 점검은 점검이다 — 두 번 시키지 않는다).
    const envDone = new Set<string>()
    let envAny = false
    {
      const { data: checks } = await admin
        .from('exam_env_checks')
        .select('ticket_id')
        .eq('user_id', user.id)
        .limit(500)
      for (const c of (checks ?? []) as { ticket_id: string | null }[]) {
        envAny = true
        if (c.ticket_id) envDone.add(c.ticket_id)
      }
    }

    const roundMap: Record<string, RoundRow> = {}
    const roundIds = [...new Set(ticketRows.map((t) => t.round_id).filter(Boolean))]
    if (roundIds.length) {
      const { data: rounds } = await admin
        .from('exam_rounds')
        .select('id, kind, title_i18n, exam_date, exam_start_at, exam_end_at, apply_start_at, apply_end_at, published')
        .in('id', roundIds)
      for (const r of (rounds ?? []) as RoundRow[]) roundMap[r.id] = r
    }

    // 응시권 → 응시 역조회. 살아있는 응시(제출·무효·진행중)만 담는다 —
    // 만료된 응시는 결과도 없고 이어할 수도 없어서 화면이 가리킬 대상이 아니다.
    const attemptByTicket: Record<string, TicketAttemptRow> = {}
    if (ticketRows.length) {
      const { data: used } = await admin
        .from('exam_attempts')
        .select('id, ticket_id, status, started_at')
        .in('ticket_id', ticketRows.map((t) => t.id))
        .order('started_at', { ascending: false })
      for (const a of (used ?? []) as TicketAttemptRow[]) {
        const rank = ATTEMPT_RANK[a.status] ?? 0
        if (!a.ticket_id || rank === 0) continue
        const prev = attemptByTicket[a.ticket_id]
        if (!prev || rank > (ATTEMPT_RANK[prev.status] ?? 0)) attemptByTicket[a.ticket_id] = a
      }
    }

    const tickets = ticketRows.map((t) => {
      const round = roundMap[t.round_id] ?? null
      const at = attemptByTicket[t.id] ?? null
      const taken = !!at && (at.status === 'submitted' || at.status === 'voided')
      const running = !!at && at.status === 'in_progress'

      const windowOpen = !!round && examWindowOpen(round)
      const beforeWindow = !!round && now < examWindowStart(round)
      // 만료 = 응시권 override(expires_at) 또는 회차 응시 창의 끝 — 먼저 오는 쪽.
      //   expires_at 이 null 이면 회차의 응시 창이 만료를 정한다(override 는 수기 발급분에서만 쓴다).
      //   아직 안 쓴(issued) 응시권에만 건다 — 이미 소진된 응시권을 '만료'로 뒤집으면 응시한 사람에게
      //   안 산 것처럼 보인다.
      // ⚠️ 조회 시점에 판정만 하고 DB 는 눕히지 않는다(크론도 없다). 실제 차단은 start-exam 이 같은
      //    examWindowOpen 으로 하므로 행 상태를 바꿔야 막히는 게 아니고, 조회가 쓰기를 하면
      //    관리자 회수(void)와 같은 행을 놓고 경합한다.
      const overrideExpired = !!t.expires_at && now >= new Date(t.expires_at).getTime()
      const expired =
        t.status === 'expired' ||
        (t.status === 'issued' && (overrideExpired || (!windowOpen && !beforeWindow)))

      let usable = false
      let usableReason: string | null = null
      if (taken) {
        usableReason = 'already_taken'
      } else if (expired) {
        usableReason = 'expired'
      } else if (!windowOpen) {
        usableReason = beforeWindow ? 'before_exam_day' : 'window_closed'
      } else {
        // consumed 인데 그 응시가 만료된 경우도 여기로 온다 — 새로고침·끊김으로 응시권이 증발하면
        // 안 되므로 재진입은 허용이다(start-exam 도 같은 규칙).
        usable = true
        // 진행 중이면 '이어서' 다. 막는 게 아니라 상태만 알려준다 — 문구·CTA 는 프론트 i18n 소관.
        usableReason = running ? 'in_progress' : null
      }

      return {
        ticketId: t.id,
        roundId: t.round_id,
        roundTitle: round ? projText(round.title_i18n, lang) : '',
        roundKind: round?.kind ?? null,
        examDate: round?.exam_date ?? null,
        examStartAt: round?.exam_start_at ?? null,
        examEndAt: round?.exam_end_at ?? null,
        tier: t.tier,
        // DB 값이 아니라 조회 시점 판정을 내려준다(위 lazy 만료) — 화면이 다시 계산하지 않게.
        status: expired ? 'expired' : t.status,
        source: t.source,
        issuedAt: t.issued_at,
        consumedAt: t.consumed_at,
        expiresAt: t.expires_at,
        pricePaid: t.price_paid ?? 0,
        attemptId: at?.id ?? null,
        usable,
        usableReason,
        // 시험환경 점검을 마쳤는가 — 마치기 전에는 응시 버튼을 열지 않는다.
        envChecked: envDone.has(t.id) || envAny,
      }
    })

    return json({ attempts, tickets, issued })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
