// seb-handoff: 일반 브라우저의 로그인을 SEB(잠금 브라우저) 안으로 넘긴다.
//
//   issue  (로그인 필요) — 응시 준비 화면이 SEB 를 열기 직전에 부른다. 일회용 nonce 를 준다.
//   redeem (세션 없음)   — SEB 안의 /exam/seb 가 부른다. nonce 를 태우고 **시험 전용 토큰**을 준다.
//
// 왜 두 단계인가: nonce 는 SEB 실행 링크의 쿼리스트링을 타고 startURL 로 넘어가므로
//   **주소창·접속 로그에 남는다.** 그래서 주소에 싣는 값은 수 분짜리 1회용으로 두고,
//   실제 인증수단(시험 전용 토큰)은 SEB 안에서만 존재하게 한다. 설계 배경은
//   migrations/20260810120000_seb_handoff.sql · _shared/exam-token.ts 머리말.
//
// ⚠️ verify_jwt 는 **켜둔 채로** 배포한다. redeem 은 세션이 없어도 anon 키가 실려 오므로 통과한다
//    (`callFunction` 이 세션 없으면 anon 키를 Authorization 에 넣는다) — 공개 함수 예외를 늘리지 않는다.
// ⚠️ _shared 사용 → CLI 로만 배포할 것.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'
import { issueExamToken } from '../_shared/exam-token.ts'
import { LIVE_TICKET_STATUSES } from '../_shared/exam-tickets.ts'
import { blockOnReentry } from '../_shared/exam-reentry.ts'

/** nonce 수명. 버튼을 누르고 SEB 가 떠서 첫 화면을 부르기까지의 시간만 덮으면 된다.
 *  ⚠️ 길게 잡을 이유가 없다 — 만료돼도 일반 브라우저에서 버튼을 다시 누르면 그만이다(복구가 싸다). */
const NONCE_TTL_SEC = 5 * 60

/** 만료분 청소 유예 — 지난 지 이만큼 된 행은 발급 때 같이 지운다(크론 안 만드는 관례). */
const SWEEP_AFTER_SEC = 24 * 60 * 60

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** 주소에 실려 다니는 값이라 추측 불가능해야 한다 — 32바이트 난수를 base64url 로. */
function newNonce(): string {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const body = await req.json().catch(() => ({}))
    const action = String(body?.action ?? '')
    const admin = adminClient()

    // ---------- 발급 (일반 브라우저 · 로그인 상태) ----------
    if (action === 'issue') {
      const user = await getUser(req)
      if (!user) return json({ error: '로그인이 필요합니다.' }, 401)
      // 익명 계정엔 응시권이 붙을 수 없다(결제가 익명을 막는다) — 넘길 자격 자체가 없다.
      if ((user as { is_anonymous?: boolean }).is_anonymous) {
        return json({ error: '응시권을 결제한 계정으로 로그인해야 합니다.', code: 'login_required' }, 403)
      }

      // 용도 — 실제 응시(exam)와 환경 점검(envcheck). 점검은 응시권이 없어도 한다
      // ("이 PC 는 된다"는 사실은 응시권과 무관하다). 실제 응시는 응시권이 필수다.
      const purpose = body?.purpose === 'envcheck' ? 'envcheck' : 'exam'
      const ticketId = String(body?.ticketId ?? '').trim()
      if (purpose === 'exam' && !ticketId) {
        return json({ error: '응시권이 지정되지 않았습니다.', code: 'no_ticket' }, 400)
      }

      // ⚠️ 소유자 술어(user_id)를 빼면 안 된다. ticketId 는 마이페이지 응답·준비 화면 등 클라 표면에
      //    상시 노출되는 값이라, 소유 확인 없이 표를 끊어주면 **남의 응시권으로 들어가는 표**가 된다.
      // consumed 도 통과시킨다 — 시험 도중 SEB 가 죽어 다시 들어오는 경로(재진입)가 있다.
      //    "그 응시권을 지금 쓸 수 있나"는 start-exam 이 판정한다(여기서 겹쳐 보면 판정이 두 벌이 된다).
      let ticketRowId: string | null = null
      if (ticketId) {
        const { data: ticket } = await admin
          .from('exam_tickets')
          .select('id')
          .eq('id', ticketId)
          .eq('user_id', user.id)
          .in('status', LIVE_TICKET_STATUSES)
          .maybeSingle()
        // 실제 응시는 응시권이 없으면 진행 불가. 점검은 남의 응시권 번호를 넣었어도 그냥 무시하고 계속한다
        // (점검 결과가 그 응시권에 안 붙을 뿐, 이 PC 가 되는지는 여전히 확인할 수 있다).
        if (!ticket && purpose === 'exam') {
          return json({ error: '사용할 수 있는 응시권이 아닙니다.', code: 'no_ticket' }, 403)
        }
        ticketRowId = ticket ? (ticket.id as string) : null
      }

      // ⛔ **SEB 를 켜기 전에** 재진입을 잡는다. 시험 시작(start-exam)에서만 잡으면 SEB 가 켜지고,
      //    잠긴 화면 안에서 "무효입니다" 를 본 뒤 다시 SEB 를 빠져나와야 한다 — 헛걸음이다.
      //    판정 자체는 _shared/exam-reentry.ts 한 곳에 있다(start-exam 도 같은 함수를 쓴다).
      if (purpose === 'exam' && ticketRowId) {
        const blocked = await blockOnReentry(admin, user.id, ticketRowId)
        if (blocked) return json(blocked, 409)
      }

      // 만료된 옛 행 청소(best-effort) — 실패해도 발급은 계속한다.
      await admin
        .from('seb_handoff')
        .delete()
        .lt('expires_at', new Date(Date.now() - SWEEP_AFTER_SEC * 1000).toISOString())

      const nonce = newNonce()
      const { error } = await admin.from('seb_handoff').insert({
        nonce_hash: await sha256Hex(nonce), // 원문은 저장하지 않는다 — DB 가 새어도 그것만으론 못 들어간다
        user_id: user.id,
        ticket_id: ticketRowId,
        purpose,
        expires_at: new Date(Date.now() + NONCE_TTL_SEC * 1000).toISOString(),
      })
      if (error) return json({ error: error.message }, 500)

      return json({ nonce, expiresInSec: NONCE_TTL_SEC })
    }

    // ---------- 교환 (SEB 안 · 세션 없음) ----------
    // ⚠️ 여기엔 레이트리밋이 없다. 일부러다 — nonce 가 32바이트 난수라 찍어 맞히는 건 불가능하고,
    //    호출 횟수를 계정 단위로 셀 수도 없다(세션이 없는 게 이 경로의 전제다). IP 로 세면 같은 시험장·
    //    같은 NAT 뒤의 정상 응시자들이 서로를 막는다. 방어는 "추측 불가 + 1회용 + 단명" 세 가지다.
    if (action === 'redeem') {
      const nonce = String(body?.nonce ?? '').trim()
      if (!nonce) return json({ error: 'handoff_missing' }, 400)

      // 1회용의 본체 — **조건부 UPDATE 한 문장**이라 두 번 들어와도 한 번만 성공한다.
      //   (읽고 나서 쓰면 그 사이에 다른 요청이 끼어들어 같은 nonce 로 표가 두 장 나간다.)
      const { data: claimed } = await admin
        .from('seb_handoff')
        .update({ redeemed_at: new Date().toISOString() })
        .eq('nonce_hash', await sha256Hex(nonce))
        .is('redeemed_at', null)
        .gt('expires_at', new Date().toISOString())
        .select('user_id, ticket_id, purpose')
        .maybeSingle()
      // 없음·만료·이미 사용을 한 문구로 접는다 — 어느 쪽인지 알려주면 유효한 nonce 를 떠보는 데 쓰인다.
      if (!claimed) return json({ error: 'handoff_invalid' }, 403)

      // ⛔ 환경 점검 표는 **아무 자격도 주지 않는다.** 여기서 시험 토큰을 주면 점검하러 온 사람이
      //    그대로 시험을 시작할 수 있게 된다. 대신 점검 기록만 남긴다 — 이 요청이 SEB 안에서
      //    왔다는 것 자체가 "이 PC 에서 SEB 가 떴다" 는 증거이고, 그게 점검이 확인하려던 전부다.
      if (claimed.purpose === 'envcheck') {
        const row = {
          user_id: claimed.user_id as string,
          ticket_id: (claimed.ticket_id as string | null) ?? null,
          checked_at: new Date().toISOString(),
          ua: String(body?.ua ?? '').slice(0, 400),
          screen: String(body?.screen ?? '').slice(0, 40),
          detail: (body?.detail ?? {}) as Record<string, unknown>,
        }
        // 응시권이 있으면 그 응시권의 기록을 갱신(유일 인덱스), 없으면 한 줄 남긴다.
        const { error: envErr } = row.ticket_id
          ? await admin.from('exam_env_checks').upsert(row, { onConflict: 'ticket_id' })
          : await admin.from('exam_env_checks').insert(row)
        if (envErr) return json({ error: envErr.message }, 500)
        return json({ ok: true, envcheck: true })
      }

      const token = await issueExamToken(claimed.user_id as string, claimed.ticket_id as string)
      return json({ token, ticketId: claimed.ticket_id })
    }

    return json({ error: '알 수 없는 action' }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
