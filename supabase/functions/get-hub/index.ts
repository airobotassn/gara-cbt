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
    // 출석 달력이 거슬러 올라갈 수 있는 하한(1년). today 가 'YYYY-MM-DD' 라 문자열 비교로 충분하지만 날짜로 계산한다.
    const yearAgo = new Date(new Date(`${today}T00:00:00Z`).getTime() - 365 * 86400000)
      .toISOString()
      .slice(0, 10)

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
      { data: attendance },
      { data: referralCode },
      { data: referredRow },
      { data: giftRows },
    ] = await Promise.all([
      admin.from('user_currency').select('points, dust').eq('user_id', uid).maybeSingle(),
      admin.from('user_cosmetics').select('part_key').eq('user_id', uid),
      admin.from('user_characters').select('base_key, equipped').eq('user_id', uid).maybeSingle(),
      admin.from('user_stamps').select('count').eq('user_id', uid).eq('stamp_kind', 'daily').maybeSingle(),
      admin.from('user_gacha_pity').select('counter').eq('user_id', uid).eq('pool_key', POOL_KEY).maybeSingle(),
      // ⚠️ 행 존재 여부로 '완료'를 판정하면 안 된다 — 이 행은 레벨테스트(did_leveltest)·미니게임(did_minigame)도
      //    만든다. 출석/오늘의 학습 완료는 반드시 각 종류 플래그로 판정할 것(2026-07-27 버그 수정).
      admin
        .from('daily_activity')
        .select('day, did_attendance, did_learn, did_minigame, did_leveltest')
        .eq('user_id', uid)
        .eq('day', today)
        .maybeSingle(),
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
      // 마이페이지 활동 기록(달력)용 출석 이력 — 최근 1년, 출석한 날만. 출석은 하루 1회 플래그라 날짜 배열이면 충분하다.
      admin
        .from('daily_activity')
        .select('day')
        .eq('user_id', uid)
        .eq('did_attendance', true)
        .gte('day', yearAgo)
        .order('day', { ascending: false })
        .limit(400),
      // 친구 초대 코드 — 없으면 최초 1회 발급하고 이후 고정(ensure_referral_code, 20260804150000).
      //   ⚠️ cosmetic-only 불변식 예외 아님: profiles 는 실력/진척 테이블이 아니다(user_progress·user_level_skill 은 여전히 읽기 전용).
      admin.rpc('ensure_referral_code', { p_uid: uid }),
      // 초대코드를 이미 등록했는지 — 허브 모달의 입력칸 잠금 판정(계정당 1회, 되돌릴 수 없음).
      admin.from('profiles').select('referred_by').eq('id', uid).maybeSingle(),
      // 아직 확인 안 한 받은 선물(coin_transfers). 코인 선물은 **즉시 이체**라 받는 사람은 아무 동작도
      // 안 했는데 잔액이 늘어난다 — 이 목록이 없으면 원인 불명의 숫자 변화로만 보인다.
      //   ⚠️ 여기서 '오늘'로 자르지 않는다. 하루 안 들어온 사람의 알림이 통째로 사라지기 때문이다.
      //     자르는 건 화면 쪽 일이고(오늘치만 상세, 그 이전은 건수만), 서버는 미확인 전부를 준다.
      //   limit 200 = 도배 상한. 10초 쿨다운(coin_gift)이 있어 정상 사용으로는 닿지 않는다.
      admin
        .from('coin_transfers')
        .select('sender_name, amount, created_at')
        .eq('recipient_id', uid)
        .is('seen_at', null)
        .order('created_at', { ascending: false })
        .limit(200),
    ])

    const couponList = (coupons ?? []).map((c) => ({
      level: c.issued_for_level as number,
      code: c.coupon_code as string,
      discount: (c.coupons as { discount?: number } | null)?.discount ?? 0,
      used: !!c.used_at,
      issuedAt: c.issued_at as string,
    }))
    const titleList = Array.isArray(titles) ? titles : []
    const rc = (rankCtx ?? null) as { rank?: number | null; total?: number | null; tier?: string | null; percentile?: number | null; points_to_pass?: number | null } | null
    // 마이페이지 '활동 기록' 달력은 **출석만** 표시한다(2026-07-29 결정) — 학습·게임·응시는 잔디에 안 찍는다.
    //   그래서 dominant kind 집계(activity_ledger)는 필요 없고 출석일 배열 하나면 된다.
    const attendanceDays = (attendance ?? []).map((r) => r.day as string)

    // 받은 선물 — 저장은 건별, **표시는 사람별 합산**이다.
    //   같은 사람이 10번 보내면 원장에는 10행이 남지만 화면에 10줄이 뜨면 도배가 된다.
    //   오늘 것만 상세(이름 + 합계)로 주고, 그 이전 미확인은 건수만 준다(허브는 오늘치만 보여주고
    //   나머지는 '이력'으로 넘긴다는 결정). 이렇게 해야 하루 안 들어와도 받은 사실이 사라지지 않는다.
    const todayStart = Date.parse(`${today}T00:00:00.000+09:00`) // KST 하루 경계 — daily_activity 와 같은 기준
    const giftAgg = new Map<string, { name: string; amount: number; count: number }>()
    let giftsOlderCount = 0
    for (const g of (giftRows ?? []) as { sender_name: string; amount: number; created_at: string }[]) {
      if (Date.parse(g.created_at) < todayStart) { giftsOlderCount += 1; continue }
      const name = g.sender_name || 'CARI'
      const cur = giftAgg.get(name) ?? { name, amount: 0, count: 0 }
      cur.amount += Number(g.amount ?? 0)
      cur.count += 1
      giftAgg.set(name, cur)
    }
    const giftsToday = [...giftAgg.values()].sort((a, b) => b.amount - a.amount)

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
      // 공유 카드(ShareCardModal)의 "#127 / 3,410명 중" — total 은 my_rank_context 가 준다
      // (20260723100000_my_rank_context_total.sql 미적용 DB 에서는 total 이 없어 null → 카드는 '집계 대기' 표기).
      rank: rc?.rank ?? null,
      rankTotal: rc?.total ?? null,
      points: Number(currency?.points ?? 0),
      dust: Number(currency?.dust ?? 0),
      cosmetics: (cosmetics ?? []).map((c) => c.part_key as string),
      baseKey: (character?.base_key as string) ?? 'default',
      equipped: (character?.equipped as Record<string, string>) ?? {},
      stamps: (stamp?.count as number) ?? 0,
      pity: (pity?.counter as number) ?? 0,
      // dailyDone = 허브 '출석' 완료(did_attendance). learnDone = /daily 오늘의 학습 완료(did_learn).
      // 레벨테스트·미니게임 여부는 별도 플래그로 노출(잠금 근거 아님).
      // 활동 기록 달력(마이페이지) — 출석한 날짜('YYYY-MM-DD') 목록, 최근 1년.
      attendanceDays,
      referralCode: (referralCode as string | null) ?? null,
      referralUsed: !!referredRow?.referred_by,
      // 코인 선물 — 오늘 받은 것(사람별 합산) · 그 이전 미확인 건수 · 뱃지용 총 미확인 건수.
      giftsToday,
      giftsOlder: giftsOlderCount,
      giftsUnseen: (giftRows ?? []).length,
      dailyDone: !!daily?.did_attendance,
      learnDone: !!daily?.did_learn,
      minigameDone: !!daily?.did_minigame,
      leveltestDone: !!daily?.did_leveltest,
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
