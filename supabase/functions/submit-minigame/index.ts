// submit-minigame: 미니게임(자립형 iframe HTML) 클리어 후 활동점수 적립.
//  · 인증 유저 전용(익명 거부). 클라 HTML 은 신뢰경계 밖 — 원점수를 곧이곧대로 믿지 않는다:
//    (1) 서버 clamp — game_id 별 선언된 상한(GAME_MAX)으로 [0, max] 자름.
//    (2) 하루 기여 cap — activity_ledger 부분 unique(user_id, day, source_ref) 로 게임별 1행/일.
//        같은 날 재제출은 그 행을 "하루 최고"로만 갱신(낮은 점수로는 깎이지 않음, GREATEST).
//    (3) rate-limit — 짧은 시간에 반복 제출을 인스턴스 단위로 저지(아래 한계 주석 참조).
//  · 정규화: delta = round(activityDelta('minigame') * clamp(raw,0,max)/max) — 상한은 _shared/scoring.ts
//    (activityDelta) 소관, 여기는 게임별 raw→[0,1] 비율만 담당.
//  · activity_ledger insert/update 가 트리거(activity_ledger_apply, STAGE1b)를 태워 user_progress.activity_score 를
//    원자 증분한다. 그 트리거는 AFTER INSERT OR UPDATE 로 걸려있고 new.delta − old.delta 차분을 증분하므로,
//    하루 두 번째 이후 제출(= upsert 의 UPDATE 경로, "하루 최고" 갱신)도 개선분만큼 activity_score 에 정상 반영된다
//    (이 헤더는 과거 AFTER INSERT 전용이라 개선분 미반영이라 적혀 있었으나 실제 DDL 은 이미 차분 트리거였다 — 정정).
//  · 코인/젬 등 cosmetic 재화는 전혀 적립하지 않는다(활동점수 전용 — 게이지/티어에만 영향).
//  ⚠️ anti-cheat 게이트(명시): rawScore 는 클라(게임 iframe HTML)가 그대로 보내는 값이라 위조 가능하고, 서버는
//    GAME_MAX clamp(placeholder 상한, 위 GAME_MAX 주석 참조) 외에 원점수를 검증할 방법이 없다 — 즉 authed 유저가
//    rawScore=GAME_MAX 로 위조 제출하면 무플레이로 만점을 적립받을 수 있다. 근본 해결(HMAC 서명 스코어 토큰 또는
//    게임 내 텔레메트리 검증)은 클라 게임 HTML(자립형, postMessage 계약 없음)이 신뢰 채널을 아직 배선하지 않아
//    이 슬라이스에서는 구현하지 않는다(후속 스테이지 과제). 현재는 다음으로 blast radius 를 제한한다:
//    (a) 익명 유저 거부(리더보드 자체가 익명 전면 제외), (b) 게임별 하루 1행만 유지되는 "하루 최고" upsert(반복
//    위조 제출도 하루 누적 상한을 넘지 못함), (c) delta 갱신은 GREATEST 부등호라 낮은 값으로는 깎이지 않지만
//    높은 값으로만 올라간다 — 이 세 방어선을 신뢰 스코어 채널 도입 전까지의 임시 게이트로 문서화한다.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser, getActiveSeasonId, activityDelta } from '../_shared/scoring.ts'
import { kstDay } from '../_shared/kst.ts'

// 게임별 서버 clamp 상한(declared max). src/lib/minigames.ts 의 레지스트리와 id 를 동기 유지할 것(수동 동기 —
//   그 파일엔 maxScore 필드가 없다: 클라 HTML 이 자체 점수 체계를 갖고 있어 postMessage 계약이 아직 없음).
//   ⚠️ 가정(assumption): 실측 텔레메트리가 없어 두 게임 모두 잠정값(placeholder)이다 — 실제 플레이 분포를 보고
//     레벨업된 이후 재조정할 것. 신규 게임 추가 시 이 맵에도 항목을 추가해야 한다(없는 id 는 400 거부).
const GAME_MAX: Record<string, number> = {
  'beat-cari': 5000, // score += level*10, 레벨업 없이도 장시간 생존하면 커짐 — 넉넉한 잠정 상한.
  'shoot-cari': 5000, // 동일 계열 슈팅 게임, 잠정 동일 상한.
}

// rate-limit: 짧은 시간(WINDOW_MS) 내 반복 제출 저지. ⚠️ 한계: 이 상태는 Edge Function 인스턴스 메모리에만
//   있어(코드 재사용 시 유지, 콜드스타트/멀티 인스턴스에선 리셋·미공유) 완전한 분산 rate-limit 이 아니다 —
//   1차 방어선(클라 실수/버스트)일 뿐, 진짜 남용 방지는 하루 cap(activity_ledger unique)이 최종 방어선.
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 5
const recentSubmits = new Map<string, number[]>()
function rateLimited(userId: string): boolean {
  const now = Date.now()
  const arr = (recentSubmits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS)
  arr.push(now)
  recentSubmits.set(userId, arr)
  return arr.length > MAX_PER_WINDOW
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    // (1) 인증: 로그인 필수 + 익명 유저 불가(랭킹 전면 제외 정책과 동일).
    const user = await getUser(req)
    if (!user || user.is_anonymous) return json({ error: 'unauthorized' }, 401)

    if (rateLimited(user.id)) return json({ error: 'rate_limited' }, 429)

    const { gameId, rawScore } = (await req.json().catch(() => ({}))) as {
      gameId?: string
      rawScore?: number
    }
    const gameMax = typeof gameId === 'string' ? GAME_MAX[gameId] : undefined
    if (!gameId || !gameMax) return json({ error: 'unknown_game' }, 400)

    // (2) 서버 clamp — 신뢰 불가 원점수를 [0, gameMax] 로 자른다.
    const raw = typeof rawScore === 'number' && isFinite(rawScore) ? rawScore : 0
    const clamped = Math.max(0, Math.min(gameMax, raw))
    const delta = Math.round(activityDelta('minigame') * (clamped / gameMax))

    const admin = adminClient()
    const seasonId = await getActiveSeasonId(admin)
    if (seasonId == null) return json({ error: 'no_active_season' }, 409)

    const today = kstDay()

    // (3) 하루 최고만 유지 — 기존 행보다 낮으면 갱신하지 않는다(트리거 재발화 방지 목적도 겸함, 상단 주석 참조).
    const { data: existing } = await admin
      .from('activity_ledger')
      .select('delta')
      .eq('user_id', user.id)
      .eq('day', today)
      .eq('source_ref', gameId)
      .maybeSingle()
    const prevDelta = (existing?.delta as number) ?? 0
    const finalDelta = Math.max(prevDelta, delta)

    if (!existing || finalDelta > prevDelta) {
      const { error } = await admin.from('activity_ledger').upsert(
        { user_id: user.id, season_id: seasonId, kind: 'minigame', delta: finalDelta, day: today, source_ref: gameId },
        { onConflict: 'user_id,day,source_ref' },
      )
      if (error) return json({ error: error.message }, 500)
    }

    await admin
      .from('daily_activity')
      .upsert({ user_id: user.id, day: today, did_minigame: true }, { onConflict: 'user_id,day' })

    return json({ ok: true, gameId, clamped, delta: finalDelta, isNewBest: finalDelta > prevDelta })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
