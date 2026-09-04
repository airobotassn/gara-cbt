// character: 허브 캐릭터 선택 · 꾸미기 장착 · 칭호 장착 · 튜토리얼 완료.
//   원자 RPC(hub_choose_character · hub_equip · hub_equip_title · hub_tutorial_done)의 얇은 래퍼다 —
//   소유·첫선택무료·종류·합격 검증은 전부 DB 함수가 한 트랜잭션에서 한다.
//
//  · action:'choose'   — { key }              캐릭터 선택. 첫 선택이면 무료 지급 + 장착.
//  · action:'equip'    — { kind, key }        스킨 등 장착. 소유한 것만.
//  · action:'title'    — { tier }             칭호(자격증 배지) 장착. 합격한 급수만.
//  · action:'tutorial' — 없음                 튜토리얼 완료 표시(건너뛰기도 완료).
//  · action:'levelSeen'— { level }            레벨업 연출을 다 보여줬다고 표시(워터마크 상승).
//
// ⚠️ cosmetic-only 불변식: user_progress · user_level_skill 을 절대 만지지 않는다.
//    그래서 _shared/scoring.ts 가 아니라 lib.ts 에서 가져온다(shop-buy 와 같은 규칙).
//    ⚠️ levelSeen 도 이 불변식 안에 있다 — 워터마크는 user_characters.arena_level_seen 이고
//       (chosen_at·tutorial_done_at 과 같은 성질의 UI 플래그) user_progress 는 RPC 안에서 **읽기만** 한다.
//       워터마크를 user_progress 에 뒀다면 이 함수가 실력 테이블을 쓰게 되어 불변식이 깨졌을 것이다.
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
  level?: number
  tier?: string
}

/** RPC 예외 메시지 → 프론트가 사전 키로 옮길 수 있는 기계 코드 + HTTP 상태. */
const ERRORS: [string, number][] = [
  ['invalid_character', 400],
  ['invalid_kind', 400],
  ['invalid_part', 400],
  ['invalid_title', 400],
  ['not_earned', 403],
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

    if (action === 'title') {
      // 칭호(자격증 배지) 장착 — 합격한 급수만. 파는 물건이 아니라 equip 과 경로가 갈린다
      // (hub_equip 은 shop_catalog 에서 종류를 확인한다 = 상점에 없는 칭호는 통과할 수 없다).
      //   ⚠️ 검증은 RPC 안에 있다(user_earned_tiers). 화면의 잠금 배지는 안내지 방어선이 아니다.
      const tier = typeof body.tier === 'string' ? body.tier : ''
      if (!tier) return json({ error: 'invalid_title' }, 400)
      const { data, error } = await admin.rpc('hub_equip_title', { p_uid: user.id, p_tier: tier })
      if (error) return mapError(error.message)
      return json(data, 200)
    }

    if (action === 'tutorial') {
      const { data, error } = await admin.rpc('hub_tutorial_done', { p_uid: user.id })
      if (error) return mapError(error.message)
      return json(data, 200)
    }

    if (action === 'levelSeen') {
      // 레벨업 연출을 끝까지 본 뒤 화면이 부른다. RPC 가 지금 레벨로 상한을 걸고(least)
      // 되돌아가지도 않게(greatest) 하므로, 여기서는 정수인지만 본다.
      //   ⚠️ 클라가 보낸 level 을 신뢰하지 않는다 — 아직 오르지도 않은 레벨을 '봤다'고 찍으면
      //      진짜 레벨업 때 축하가 통째로 사라진다(되돌릴 방법이 없다). 상한 판정은 RPC 안에 있다.
      const level = Number(body.level)
      if (!Number.isFinite(level)) return json({ error: 'invalid' }, 400)
      const { data, error } = await admin.rpc('hub_level_seen', { p_uid: user.id, p_level: Math.floor(level) })
      if (error) return mapError(error.message)
      return json(data, 200)
    }

    return json({ error: 'invalid_action' }, 400)
  } catch {
    return json({ error: 'server' }, 500)
  }
})
