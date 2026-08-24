// room: 남의 방 열람(공개).
//
//  · action:'view' — **아무나** 볼 수 있다. 로그인 없이도 열린다(SNS 링크가 목적이라 그래야 한다).
//
// ⚠️ 2026-08-20: **가구·미니룸은 제거됐다.** 배치 저장(action:'save')·슬롯·좌표가 통째로 사라지고,
//   이 화면은 그 사람이 꾸민 **배경 + 캐릭터**를 보여주는 자리가 됐다.
//   걷어낼 때 산 사람이 한 명도 없었다(보유 0 · 구매 0 · 쓴 코인 0) → 몰수 문제가 없었다.
//
// ⚠️ view 가 내주는 건 **랭킹 화면에 이미 공개된 것 + 방 배치**뿐이다.
//   국가·지역·가입일·코인·미션 같은 건 넣지 않는다(공유 카드가 publicOnly 로 거르는 것과 같은 기준).
//   특히 referral_code(초대·선물 코드)는 절대 내보내지 않는다.
//
// ⚠️ _shared 를 import 하므로 대시보드 편집 불가 → CLI 배포 전용: `supabase functions deploy room`.
//   verify_jwt 는 **켠 채로** 배포한다 — 비로그인도 anon 키는 실려 오므로 공개 예외가 필요 없다.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient } from '../_shared/lib.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const admin = adminClient()
    const body = await req.json().catch(() => ({})) as { action?: string; handle?: string }
    const action = body.action ?? 'view'

    // ── 남의 방 보기 — 공개. 로그인도, 온보딩도 요구하지 않는다. ──
    if (action === 'view') {
      const handle = String(body.handle ?? '')
      // 지금 handle = uid 다. 짧은 공개 코드로 바꾸고 싶으면 **여기 한 곳**만 고치면 된다
      // (프론트는 handle 을 문자열로만 다루고 라우트도 그대로다).
      if (!UUID_RE.test(handle)) return json({ error: 'bad_handle' }, 400)

      const [{ data: profile }, { data: progress }, { data: titles }, { data: character }] = await Promise.all([
        admin.from('profiles').select('display_name, avatar_url, is_anonymous').eq('id', handle).maybeSingle(),
        admin.from('user_progress').select('season_total').eq('user_id', handle).maybeSingle(),
        admin.rpc('user_titles', { p_uid: handle }),
        // 장착한 캐릭터·스킨 — 방에 그 사람 캐릭터가 서고 배경이 그 사람 스킨으로 깔린다.
        //   ⚠️ 새로 새는 정보가 아니다: 같은 그림이 랭킹 시상대와 공유 카드에 이미 나온다.
        admin.from('user_characters').select('base_key, equipped').eq('user_id', handle).maybeSingle(),
      ])

      // 실회원이 아니면 **랭킹 더미**인지 본다 — /ranking 시상대의 '방 보기' 는 진짜와 더미를
      // 구분하지 않고 같은 주소로 들어오기 때문이다. 여기서 안 받으면 더미만 404 가 뜨고,
      // "지도엔 사람이 있다는데 방은 없네" 라는 어긋남이 이 자리에서 다시 생긴다.
      //   ⚠️ 실회원 경로를 먼저 태우고 못 찾았을 때만 더미를 조회한다(대부분은 실회원이다).
      //   ⚠️ 칭호는 비운다 — 자격증은 실제 응시 기록에서 나오는 것이라 더미가 가질 수 없다.
      if (!profile || profile.is_anonymous) {
        const { data: dummy } = await admin
          .from('ranking_dummies')
          .select('display_name, avatar_url, season_total, character_key, skin')
          .eq('id', handle)
          .maybeSingle()
        if (!dummy) return json({ error: 'not_found' }, 404)
        return json({
          handle,
          name: (dummy.display_name as string | null) ?? null,
          avatarUrl: (dummy.avatar_url as string | null) ?? null,
          seasonTotal: (dummy.season_total as number) ?? null,
          title: null,
          character: (dummy.character_key as string | null) ?? null,
          skin: (dummy.skin as string | null) ?? null,
        })
      }

      const titleList = Array.isArray(titles) ? titles : []
      return json({
        handle,
        name: (profile.display_name as string | null) ?? null,
        avatarUrl: (profile.avatar_url as string | null) ?? null,
        seasonTotal: (progress?.season_total as number) ?? null,
        // 칭호는 랭킹·허브에 이미 노출되는 값이라 방에도 띄운다(합격한 티어 그 자체).
        title: (titleList[0] as { tier?: string } | undefined)?.tier ?? null,
        // 'default'(아직 안 고름)는 null 로 눕힌다 — 프론트가 폴백 그림 하나로 처리한다.
        character: (() => { const b = (character?.base_key as string) ?? 'default'; return b && b !== 'default' ? b : null })(),
        skin: ((character?.equipped as Record<string, string> | null) ?? {}).skin ?? null,
      })
    }

    return json({ error: 'bad_action' }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
