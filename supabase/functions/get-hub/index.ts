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

// DB 하드코딩 상수(gacha_draw: 20/천장15/가루10~20/즉시5%/교환250 · complete_daily: 10)와 동일하게 유지 — 표시 전용.
const ECON = { drawCost: 20, pityCeiling: 15, dailyPoints: 10, dustMin: 10, dustMax: 20 }
const POOL_KEY = 'default'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const admin = adminClient()

    // 상점 카탈로그(코인 기본템) + 뽑기풀 희귀 + 뽑기 전용 한정템(가루 교환가) — 비로그인도 열람 가능.
    const [{ data: catRows }, { data: poolRows }, { data: exRows }] = await Promise.all([
      admin.from('shop_catalog').select('part_key, price').eq('active', true),
      admin.from('gacha_pool').select('part_key, is_rare').eq('pool_key', POOL_KEY),
      admin.from('gacha_exclusive').select('part_key, dust_price').eq('active', true),
    ])
    const rareSet = new Set((poolRows ?? []).filter((p) => p.is_rare).map((p) => p.part_key))
    const catalog = (catRows ?? [])
      .map((c) => ({ partKey: c.part_key as string, price: c.price as number, rare: rareSet.has(c.part_key) }))
      .sort((a, b) => a.price - b.price || a.partKey.localeCompare(b.partKey))
    const exclusives = (exRows ?? [])
      .map((e) => ({ partKey: e.part_key as string, dustPrice: e.dust_price as number }))
      .sort((a, b) => a.dustPrice - b.dustPrice || a.partKey.localeCompare(b.partKey))

    // 인증: 비로그인/익명은 공개 정보만.
    const user = await getUser(req)
    if (!user || user.is_anonymous) {
      return json({ authed: false, econ: ECON, catalog, exclusives })
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
      { data: rankCtx },
    ] = await Promise.all([
      admin.from('user_currency').select('points, dust').eq('user_id', uid).maybeSingle(),
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
      // HUD 표시(레벨·랭킹점수·실력/활동 분해)용 읽기 전용 — 이 함수는 user_progress 를 절대 쓰지 않는다(cosmetic-only).
      admin.from('user_progress').select('rank, points, skill_score, activity_score, season_total').eq('user_id', uid).maybeSingle(),
      admin.rpc('user_titles', { p_uid: uid }),
      // 다음 순위 게이지(티어·백분위·points_to_pass) — season_total 기반 read-시점 파생, 실패해도 무시(back-compat).
      admin.rpc('my_rank_context', { p_uid: uid }),
    ])

    const couponList = (coupons ?? []).map((c) => ({
      level: c.issued_for_level as number,
      code: c.coupon_code as string,
      discount: (c.coupons as { discount?: number } | null)?.discount ?? 0,
      used: !!c.used_at,
      issuedAt: c.issued_at as string,
    }))
    const titleList = Array.isArray(titles) ? titles : []
    const rc = (rankCtx ?? null) as { tier?: string | null; percentile?: number | null; points_to_pass?: number | null } | null
    // TODO(#5 미구현): 응답에 일별 활동 breakdown(잔디 dominant 색)이 없다 — 잔디는 현재 프론트가
    //   list-attempts(레벨테스트) 응시일만으로 채워 leveltest(금색) 활동만 표시한다. attendance/learn/
    //   minigame 색을 살리려면 여기서 activity_ledger(day,kind,delta)+daily_activity(day,did_*) 를
    //   조인/집계해 유저별 일별 dominant kind + total 을 반환하는 생산자를 배선해야 한다(범위 제외, 후속).

    return json({
      authed: true,
      level: progress?.rank ?? null,
      rankPoints: progress?.points ?? null,
      skillScore: (progress?.skill_score as number) ?? null,
      activityScore: (progress?.activity_score as number) ?? null,
      seasonTotal: (progress?.season_total as number) ?? null,
      tier: rc?.tier ?? null,
      percentile: rc?.percentile ?? null,
      pointsToPass: rc?.points_to_pass ?? null,
      points: Number(currency?.points ?? 0),
      dust: Number(currency?.dust ?? 0),
      cosmetics: (cosmetics ?? []).map((c) => c.part_key as string),
      baseKey: (character?.base_key as string) ?? 'default',
      equipped: (character?.equipped as Record<string, string>) ?? {},
      stamps: (stamp?.count as number) ?? 0,
      pity: (pity?.counter as number) ?? 0,
      dailyDone: !!daily,
      catalog,
      exclusives,
      coupons: couponList,
      titles: titleList,
      econ: ECON,
    })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
