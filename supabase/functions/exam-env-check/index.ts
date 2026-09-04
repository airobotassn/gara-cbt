// exam-env-check: 시험환경 점검 완료를 기록한다.
//
// 왜 필요한가: `/exam/check` 는 브라우저에서 즉석 판정만 하고 **아무것도 남기지 않았다** →
//   ① 응시권 카드가 "점검 먼저" 게이트를 걸 수 없고
//   ② 관리자가 "누가 아직 점검을 안 했는지" 를 볼 수 없다(독려 메일 대상이 안 뽑힌다).
//
// ⚠️ 완료 판정에 **SEB 감지를 넣지 않는다** — 일반 브라우저에서는 항상 실패라 아무도 통과 못 한다.
//    기준은 "모의 응시를 끝냈다" 하나다(실제로 응시 화면을 띄워 봤다는 뜻).
// ⚠️ 응시권당 최신 1건만 남긴다(`exam_env_checks_ticket_uniq`) — 여러 번 점검해도 줄이 쌓이지 않는다.
// ⚠️ 응시권 없이 체험만 한 경우도 받는다(ticket_id = null). 그건 "이 PC 는 된다"는 사실이라 버릴 이유가 없다.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const user = await getUser(req)
    if (!user || user.is_anonymous) return json({ error: '로그인이 필요합니다.' }, 401)

    // ⚠️ 2026-09-04 에 ua·screen·detail 을 안 받는다(컬럼도 드롭). 쓰기만 하고 **읽는 곳이 0곳**이었다 —
    //    이 표를 조회하는 두 자리(admin/reform 의 환경점검 목록, my-attempts 의 '점검했나' 판정)가
    //    ticket_id·user_id·checked_at 만 뽑는다. UA 원문은 방문 통계에서 일부러 안 남기기로 한 값이라
    //    여기만 남기면 규칙이 두 벌이 된다. 옛 클라가 계속 보내와도 무시하면 그만이라 호환 문제도 없다.
    const body = (await req.json().catch(() => ({}))) as {
      ticketId?: string | null
    }
    const admin = adminClient()

    // 남의 응시권 번호를 넣어도 내 것이 아니면 무시한다(그 값은 화면에 노출되는 값이다).
    let ticketId: string | null = null
    if (body.ticketId) {
      const { data: own } = await admin
        .from('exam_tickets')
        .select('id')
        .eq('id', body.ticketId)
        .eq('user_id', user.id)
        .maybeSingle()
      ticketId = own ? String((own as { id: string }).id) : null
    }

    const row = {
      user_id: user.id,
      ticket_id: ticketId,
      checked_at: new Date().toISOString(),
    }

    // 응시권이 있으면 그 응시권의 기록을 갱신(유일 인덱스), 없으면 그냥 한 줄 남긴다.
    const { error } = ticketId
      ? await admin.from('exam_env_checks').upsert(row, { onConflict: 'ticket_id' })
      : await admin.from('exam_env_checks').insert(row)
    if (error) return json({ error: error.message }, 500)

    return json({ ok: true })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
