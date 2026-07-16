// get-hub: 캐릭터 허브 첫 로드용 상태 하이드레이트.
//  · RLS 정책 미부여(=service-role 전용) 테이블들(user_currency·user_cosmetics·user_characters·
//    user_stamps·user_gacha_pity·daily_activity·user_coupons)의 유일한 클라 읽기 경로.
//    클라는 이 함수를 통해서만 자기 상태를 읽는다(직접 select 불가).
//  · cosmetic-only 읽기: user_progress 는 HUD 표시(레벨·랭킹점수)용으로만 읽고 쓰지 않는다.
//    실력/진화(user_progress·user_level_skill) 데이터를 절대 변형하지 않는다.
//  · 비로그인/익명: authed=false + 공개 카탈로그(shop_catalog)만. 경제·쿠폰·칭호는 로그인 필요.
//  · econ 상수는 DB plpgsql 하드코딩(gacha_shop.sql · complete_daily_fn.sql)과 동일하게 유지(표시 전용).
//    DB 수치를 바꾸면 여기도 같이 고칠 것.
// ⚠️ _shared 를 import 하므로 대시보드 편집 불가 → CLI 배포 전용: `supabase functions deploy get-hub`.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/lib.ts'
import { kstDay } from '../_shared/kst.ts'

// DB 하드코딩 상수(gacha_draw: 100/20/50 · complete_daily: 10)와 동일하게 유지 — 표시 전용.
const ECON = { drawCost: 100, dupeRefund: 20, pityCeiling: 50, dailyPoints: 10 }
const POOL_KEY = 'default'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const admin = adminClient()

    // 상점 카탈로그(공개 select) + 뽑기풀 희귀 플래그 — 비로그인도 가격/희귀 열람 가능.
    const [{ data: catRows }, { data: poolRows }] = await Promise.all([
      admin.from('shop_catalog').select('part_key, price').eq('active', true),
      admin.from('gacha_pool').select('part_key, is_rare').eq('pool_key', POOL_KEY),
    ])
    const rareSet = new Set((poolRows ?? []).filter((p) => p.is_rare).map((p) => p.part_key))
    const catalog = (catRows ?? [])
      .map((c) => ({ partKey: c.part_key as string, price: c.price as number, rare: rareSet.has(c.part_key) }))
      .sort((a, b) => a.price - b.price || a.partKey.localeCompare(b.partKey))

    // 인증: 비로그인/익명은 공개 정보만.
    const user = await getUser(req)
    if (!user || user.is_anonymous) {
      return json({ authed: false, econ: ECON, catalog })
    }

    const uid = user.id
    const today = kstDay() // KST 캘린더일 — daily_activity(day) 경계와 동일.

    const [
      { data: currency },
      { data: cosmetics },
      { data: character },
      { data: stamp },
      { data: pity },
      { data: daily },
      { data: coupons },
      { data: progress },
      { data: titles },
    ] = await Promise.all([
      admin.from('user_currency').select('points').eq('user_id', uid).maybeSingle(),
      admin.from('user_cosmetics').select('part_key').eq('user_id', uid),
      admin.from('user_characters').select('base_key, equipped').eq('user_id', uid).maybeSingle(),
      admin.from('user_stamps').select('count').eq('user_id', uid).eq('stamp_kind', 'daily').maybeSingle(),
      admin.from('user_gacha_pity').select('counter').eq('user_id', uid).eq('pool_key', POOL_KEY).maybeSingle(),
      admin.from('daily_activity').select('day').eq('user_id', uid).eq('day', today).maybeSingle(),
      admin
        .from('user_coupons')
        .select('issued_for_level, coupon_code, issued_at, used_at, coupons(discount)')
        .eq('user_id', uid)
        .order('issued_for_level', { ascending: false }),
      admin.from('user_progress').select('rank, points').eq('user_id', uid).maybeSingle(),
      admin.rpc('user_titles', { p_uid: uid }),
    ])

    const couponList = (coupons ?? []).map((c) => ({
      level: c.issued_for_level as number,
      code: c.coupon_code as string,
      discount: (c.coupons as { discount?: number } | null)?.discount ?? 0,
      used: !!c.used_at,
      issuedAt: c.issued_at as string,
    }))
    const titleList = Array.isArray(titles) ? titles : []

    return json({
      authed: true,
      level: progress?.rank ?? null,
      rankPoints: progress?.points ?? null,
      points: Number(currency?.points ?? 0),
      cosmetics: (cosmetics ?? []).map((c) => c.part_key as string),
      baseKey: (character?.base_key as string) ?? 'default',
      equipped: (character?.equipped as Record<string, string>) ?? {},
      stamps: (stamp?.count as number) ?? 0,
      pity: (pity?.counter as number) ?? 0,
      dailyDone: !!daily,
      catalog,
      coupons: couponList,
      titles: titleList,
      econ: ECON,
    })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
