// character: 허브 캐릭터 선택 · 꾸미기 장착 · 튜토리얼 완료.
//   원자 RPC(hub_choose_character · hub_equip · hub_tutorial_done)의 얇은 래퍼다 —
//   소유·첫선택무료·종류 검증은 전부 DB 함수가 한 트랜잭션에서 한다.
//
//  · action:'choose'   — { key }              캐릭터 선택. 첫 선택이면 무료 지급 + 장착.
//  · action:'equip'    — { kind, key }        스킨 등 장착. 소유한 것만.
//  · action:'tutorial' — 없음                 튜토리얼 완료 표시(건너뛰기도 완료).
//
// ⚠️ cosmetic-only 불변식: user_progress · user_level_skill 을 절대 만지지 않는다.
//    그래서 _shared/scoring.ts 가 아니라 lib.ts 에서 가져온다(shop-buy 와 같은 규칙).
// ⚠️ 왜 화면이 직접 테이블을 못 쓰나 — user_characters·user_cosmetics 는 RLS 정책 미부여
//    (service role 전용)다. 쓰기를 열면 사지 않은 캐릭터를 장착할 수 있고, 그 캐릭터는
//    랭킹 카드·남의 방으로 남들에게까지 보인다.
// ⚠️ _shared 를 import 하므로 대시보드 편집 불가 → CLI 배포 전용: `supabase functions deploy character`.
//    verify_jwt 는 **켠 채로** 배포한다(로그인 전용 기능이라 공개 예외가 필요 없다).
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'

interface Body {
  action?: string
  key?: string
  kind?: string
}

/** RPC 예외 메시지 → 프론트가 사전 키로 옮길 수 있는 기계 코드 + HTTP 상태. */
const ERRORS: [string, number][] = [
  ['invalid_character', 400],
  ['invalid_kind', 400],
  ['invalid_part', 400],
  ['not_owned', 403],
  ['unauthorized', 401],
]
function mapError(message: string | undefined) {
  for (const [code, status] of ERRORS) {
    if (message?.includes(code)) return json({ error: code }, status)
  }
  return json({ error: 'server' }, 500)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    // 로그인 필수 + 익명 불가 — 게스트는 애초에 허브에 못 들어온다(Hub.tsx 가 막는다).
    const user = await getUser(req)
    if (!user || user.is_anonymous) return json({ error: 'unauthorized' }, 401)

    const body = (await req.json().catch(() => ({}))) as Body
    const action = typeof body.action === 'string' ? body.action : ''
    const admin = adminClient()

    if (action === 'choose') {
      const key = typeof body.key === 'string' ? body.key : ''
      if (!key) return json({ error: 'invalid' }, 400)
      // 첫 선택 무료 / 갈아입기 소유검사 / 장착이 한 트랜잭션에 들어 있다.
      const { data, error } = await admin.rpc('hub_choose_character', { p_uid: user.id, p_key: key })
      if (error) return mapError(error.message)
      return json(data, 200)
    }

    if (action === 'equip') {
      const kind = typeof body.kind === 'string' ? body.kind : ''
      const key = typeof body.key === 'string' ? body.key : ''
      if (!kind || !key) return json({ error: 'invalid' }, 400)
      // 캐릭터는 여기로 못 온다(RPC 가 'character' 를 invalid_kind 로 거절) — 첫 선택 무료 규칙 때문에
      // 전용 경로(choose)로만 바꾼다.
      const { data, error } = await admin.rpc('hub_equip', { p_uid: user.id, p_kind: kind, p_key: key })
      if (error) return mapError(error.message)
      return json(data, 200)
    }

    if (action === 'tutorial') {
      const { data, error } = await admin.rpc('hub_tutorial_done', { p_uid: user.id })
      if (error) return mapError(error.message)
      return json(data, 200)
    }

    return json({ error: 'invalid_action' }, 400)
  } catch {
    return json({ error: 'server' }, 500)
  }
})
