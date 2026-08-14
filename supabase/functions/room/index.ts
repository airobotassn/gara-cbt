// room: 미니룸 저장(본인) · 열람(공개).
//
//  · action:'save' — 본인 방 배치 저장. 소유·면 검증은 _shared/room.ts 가 한다.
//  · action:'view' — **아무나** 볼 수 있는 남의 방. 로그인 없이도 열린다(SNS 링크가 목적이라 그래야 한다).
//
// ⚠️ user_rooms 는 RLS 정책 미부여(service role 전용)라 클라가 직접 읽고 쓸 수 없다.
//   특히 쓰기를 열면 소유하지 않은 가구를 꽂을 수 있고, 방은 공개라 남들이 그걸 본다.
//
// ⚠️ view 가 내주는 건 **랭킹 화면에 이미 공개된 것 + 방 배치**뿐이다.
//   국가·지역·가입일·코인·미션 같은 건 넣지 않는다(공유 카드가 publicOnly 로 거르는 것과 같은 기준).
//   특히 referral_code(초대·선물 코드)는 절대 내보내지 않는다.
//
// ⚠️ _shared 를 import 하므로 대시보드 편집 불가 → CLI 배포 전용: `supabase functions deploy room`.
//   verify_jwt 는 **켠 채로** 배포한다 — 비로그인도 anon 키는 실려 오므로 공개 예외가 필요 없다.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'
import { ROOM_LAYOUT, sanitizeSlots, validateSlots, type Surface } from '../_shared/room.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 가구 카탈로그(part_key → 면). 상점에서 내린 한정템도 포함해야 한다 — 이미 가진 사람은 계속 놓을 수 있어야 하므로. */
async function furnitureMap(admin: ReturnType<typeof adminClient>): Promise<Map<string, Surface>> {
  const { data } = await admin.from('shop_catalog').select('part_key, surface').eq('kind', 'furniture')
  return new Map((data ?? []).map((r) => [r.part_key as string, r.surface as Surface]))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const admin = adminClient()
    const body = await req.json().catch(() => ({})) as { action?: string; slots?: unknown; handle?: string }
    const action = body.action ?? 'view'

    // ── 남의 방 보기 — 공개. 로그인도, 온보딩도 요구하지 않는다. ──
    if (action === 'view') {
      const handle = String(body.handle ?? '')
      // 지금 handle = uid 다. 짧은 공개 코드로 바꾸고 싶으면 **여기 한 곳**만 고치면 된다
      // (프론트는 handle 을 문자열로만 다루고 라우트도 그대로다).
      if (!UUID_RE.test(handle)) return json({ error: 'bad_handle' }, 400)

      const [{ data: profile }, { data: room }, { data: progress }, { data: titles }] = await Promise.all([
        admin.from('profiles').select('display_name, avatar_url, is_anonymous').eq('id', handle).maybeSingle(),
        admin.from('user_rooms').select('slots').eq('user_id', handle).maybeSingle(),
        admin.from('user_progress').select('season_total').eq('user_id', handle).maybeSingle(),
        admin.rpc('user_titles', { p_uid: handle }),
      ])

      // 익명(게스트) 계정은 방이 없다 — 이름도 없고 남에게 보여줄 것도 없다.
      if (!profile || profile.is_anonymous) return json({ error: 'not_found' }, 404)

      const titleList = Array.isArray(titles) ? titles : []
      return json({
        handle,
        name: (profile.display_name as string | null) ?? null,
        avatarUrl: (profile.avatar_url as string | null) ?? null,
        seasonTotal: (progress?.season_total as number) ?? null,
        // 칭호는 랭킹·허브에 이미 노출되는 값이라 방에도 띄운다(합격한 티어 그 자체).
        title: (titleList[0] as { tier?: string } | undefined)?.tier ?? null,
        slots: sanitizeSlots(room?.slots),
        layout: ROOM_LAYOUT,
      })
    }

    // ── 여기부터는 본인만 ──
    const user = await getUser(req)
    if (!user || user.is_anonymous) return json({ error: 'unauthorized' }, 401)
    const uid = user.id

    if (action === 'save') {
      const [{ data: owned }, furniture] = await Promise.all([
        admin.from('user_cosmetics').select('part_key').eq('user_id', uid),
        furnitureMap(admin),
      ])
      const ownedSet = new Set((owned ?? []).map((r) => r.part_key as string))

      const check = validateSlots(body.slots, ownedSet, furniture)
      if (!check.ok) return json({ error: check.error }, 400)

      const { error } = await admin
        .from('user_rooms')
        .upsert({ user_id: uid, slots: check.slots, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      if (error) return json({ error: error.message }, 500)

      return json({ ok: true, slots: check.slots })
    }

    return json({ error: 'bad_action' }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
