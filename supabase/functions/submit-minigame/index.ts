// submit-minigame: 미니게임(자립형 iframe HTML) 클리어 후 활동점수 적립.
//  · 인증 유저 전용(익명 거부). 클라 HTML 은 신뢰경계 밖 — 원점수를 곧이곧대로 믿지 않는다:
//    (1) 서버 clamp — game_id 별 선언된 상한(GAME_MAX)으로 [0, max] 자름.
//    (2) 하루 기여 cap — activity_ledger unique(user_id, day, source_ref) 를 **회차 슬롯**으로 써서 하루 N회.
//    (3) rate-limit — 짧은 시간에 반복 제출을 인스턴스 단위로 저지(아래 한계 주석 참조).
//  · 적립(2026-08-04 원안 반영): **참여 횟수당 고정 +2, 하루 3회까지**. 성적은 활동점수에 반영되지 않는다
//    (값·횟수는 _shared/scoring.ts 의 ACTIVITY_DELTA/ACTIVITY_PER_DAY 소관).
//    ⚠️ 예전엔 delta = round(activityDelta('minigame') × clamp(raw,0,max)/max) 로 **성적 비례**였고 하루 cap 도
//       게임별 1행/일("하루 최고" 갱신)이었다 — 원안 채택으로 둘 다 바뀌었다. 게임 실력은 이제 활동점수가 아니라
//       게임별 랭킹(minigame_scores, 아래 (4))에만 반영된다.
//  · activity_ledger insert/update 가 트리거(activity_ledger_apply, STAGE1b)를 태워 user_progress.activity_score 를
//    원자 증분한다. 그 트리거는 AFTER INSERT OR UPDATE 로 걸려있고 new.delta − old.delta 차분을 증분하므로,
//    하루 두 번째 이후 제출(= upsert 의 UPDATE 경로, "하루 최고" 갱신)도 개선분만큼 activity_score 에 정상 반영된다
//    (이 헤더는 과거 AFTER INSERT 전용이라 개선분 미반영이라 적혀 있었으나 실제 DDL 은 이미 차분 트리거였다 — 정정).
//  · 코인/젬 등 cosmetic 재화는 전혀 적립하지 않는다(활동점수 전용 — 게이지/티어에만 영향).
//  ⚠️ anti-cheat 게이트(명시): rawScore 는 클라(게임 iframe HTML)가 보내는 값이라 여전히 위조 가능하다.
//    게임별 랭킹(minigame_scores)이 붙으면서 위조 유인이 커졌으므로 방어선을 다음까지 올렸다:
//    (a) 익명 유저 거부(리더보드 전면 제외), (b) **제출 티켓** — 부모 앱이 action:'start' 로 HMAC 서명 티켓을
//        받고 제출 시 동봉한다. 서명·소유자·게임·나이(3초~6시간)를 검증해 티켓 없는 생 제출·남의 티켓 재사용·
//        발급 직후 즉시 제출을 막는다(../_shared/minigames.ts), (c) **플레이 시간 대비 상한** — 티켓 나이 ×
//        게임별 perSec 로 점수를 한 번 더 깎는다(거부가 아니라 clamp: 정상 플레이 오차를 죽이지 않기 위해),
//    (d) 레벨형 게임의 clamp 상한은 실제 LEVELS.length 와 일치시켜 존재하지 않는 레벨 신고를 막는다,
//    (e) 활동점수는 하루 회차 슬롯(play:1..N) unique 로 하루 누적 상한을 넘지 못한다 — 점수를 위조해도
//        활동점수는 참여 고정값이라 이득이 없다(위조 유인은 게임별 랭킹 쪽에만 남는다).
//    ⚠️ 남은 구멍: 게임을 오래 켜둔 뒤 큰 점수를 신고하면 (c) 를 통과한다. 완전 방어는 게임 내 텔레메트리
//      서명(플레이 이벤트 자체를 서버가 검증)이 필요하고 자립형 게임 HTML 로직을 다 손봐야 해서 후속 과제로 둔다.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser, getActiveSeasonId, activityDelta, activityPerDay } from '../_shared/scoring.ts'
import { kstDay } from '../_shared/kst.ts'
import { gameSpec, issueTicket, verifyTicket, plausibleCap } from '../_shared/minigames.ts'

// 게임 스펙(상한·지표·초당 상한)과 제출 티켓은 ../_shared/minigames.ts 소관 — 랭킹 조회 함수(minigame-rank)와 공용.
//   · action:'start' → 티켓 발급(부모 앱이 게임 띄울 때).
//   · 기본(action 없음) → 점수 제출: 티켓 검증 → clamp → 활동점수 적립 + minigame_scores 최고기록 갱신.

// rate-limit: 짧은 시간(WINDOW_MS) 내 반복 제출 저지. ⚠️ 한계: 이 상태는 Edge Function 인스턴스 메모리에만
//   있어(코드 재사용 시 유지, 콜드스타트/멀티 인스턴스에선 리셋·미공유) 완전한 분산 rate-limit 이 아니다 —
//   1차 방어선(클라 실수/버스트)일 뿐, 진짜 남용 방지는 하루 cap(activity_ledger unique)이 최종 방어선.
//   ⚠️ 레벨형 게임(닿아라·프로그램해라·지어라·골라라)은 **레벨 클리어마다 1회 제출**한다. 5회로 두면 빠르게
//     연달아 깨는 정상 플레이에서 마지막(=가장 높은 레벨) 제출이 막혀 랭킹이 누락된다 → 12회로 잡았다.
//     티켓 없는 제출은 애초에 400 이라 남용 한도는 하루 cap(activity_ledger unique)이 최종 방어선이다.
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 12
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

    const { gameId, rawScore, action, ticket, tieMs } = (await req.json().catch(() => ({}))) as {
      gameId?: string
      rawScore?: number
      action?: string
      ticket?: string
      tieMs?: number
    }
    const spec = gameSpec(gameId)
    if (!gameId || !spec) return json({ error: 'unknown_game' }, 400)

    // action:'start' — 플레이 시작 티켓 발급. rate-limit 대상 아님(화면 진입마다 1회).
    if (action === 'start') {
      return json({ ok: true, gameId, ticket: await issueTicket(user.id, gameId) })
    }

    if (rateLimited(user.id)) return json({ error: 'rate_limited' }, 429)

    // (2a) 티켓 검증 — 서명·소유자·게임·나이. 없거나 위조면 거부(랭킹에 생 제출이 들어오는 것을 막는다).
    const tk = await verifyTicket(ticket, user.id, gameId)
    if (!tk.ok) return json({ error: tk.reason ?? 'ticket_invalid' }, 400)

    // (2b) 서버 clamp — 신뢰 불가 원점수를 [0, spec.max] 로 자르고, 플레이 시간 대비 상한으로 한 번 더 깎는다.
    const raw = typeof rawScore === 'number' && isFinite(rawScore) ? rawScore : 0
    const hardMax = spec.max
    // clamped 는 이제 활동점수와 무관하다 — 게임별 랭킹(minigame_scores) 기록용으로만 쓴다.
    const clamped = Math.max(0, Math.min(hardMax, Math.min(raw, plausibleCap(spec, tk.ageSec))))
    // 퍼즐(레벨형) 동률 해소용 소요시간. 점수형은 저장하지 않는다(achieved_at 으로만 갈림).
    const tie =
      spec.metric === 'level' && typeof tieMs === 'number' && isFinite(tieMs) && tieMs >= 0
        ? Math.min(Math.round(tieMs), 24 * 60 * 60 * 1000)
        : null

    const admin = adminClient()
    const seasonId = await getActiveSeasonId(admin)
    if (seasonId == null) return json({ error: 'no_active_season' }, 409)

    const today = kstDay()

    // (3) 활동점수 — 참여 횟수당 고정 적립, 하루 perDay 회까지(성적 무관, 게임 종류도 무관).
    //     하루 캡은 activity_ledger 의 unique(user_id, day, source_ref) 를 **회차 슬롯**으로 재사용해서 건다
    //     (source_ref = 'play:1' … 'play:N'). 예전엔 source_ref = gameId 라 게임 종수만큼 적립됐다.
    //     오늘 찍힌 행 수를 세어 그다음 빈 슬롯부터 insert 하고, 동시 제출로 이미 찬 슬롯이면(23505) 다음 슬롯으로
    //     넘어간다 → 레이스가 나도 하루 적립 행은 N개를 넘지 못한다(unique 인덱스가 최종 방어선).
    //     ⚠️ 옛 source_ref=gameId 행도 오늘치 카운트에 포함된다(전환기 과적립 방지 — 의도된 동작).
    const perDay = activityPerDay('minigame')
    const delta = activityDelta('minigame')
    const { count: playsToday } = await admin
      .from('activity_ledger')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('day', today)
      .eq('kind', 'minigame')

    let credited = 0
    for (let slot = (playsToday ?? 0) + 1; slot <= perDay; slot++) {
      const { error } = await admin.from('activity_ledger').insert({
        user_id: user.id,
        season_id: seasonId,
        kind: 'minigame',
        delta,
        day: today,
        source_ref: `play:${slot}`,
      })
      if (!error) {
        credited = delta
        break
      }
      if (error.code !== '23505') return json({ error: error.message }, 500)
    }

    await admin
      .from('daily_activity')
      .upsert({ user_id: user.id, day: today, did_minigame: true }, { onConflict: 'user_id,day' })

    // (4) 랭킹용 통산 최고기록 — activity_ledger 는 정규화 delta 라 줄 세우기에 못 쓴다(minigame_scores 참조).
    //     더 좋은 기록일 때만 갱신하고, plays 는 항상 증가시킨다. 동률(레벨형)은 소요시간이 짧으면 갱신.
    const { data: prevBest } = await admin
      .from('minigame_scores')
      .select('best_score,tie_ms,plays')
      .eq('user_id', user.id)
      .eq('game_id', gameId)
      .maybeSingle()

    const prevScore = Number(prevBest?.best_score ?? -1)
    const prevTie = (prevBest?.tie_ms as number | null) ?? null
    const better =
      clamped > prevScore ||
      (clamped === prevScore && tie != null && (prevTie == null || tie < prevTie))
    const isRankBest = !prevBest || better

    const row: Record<string, unknown> = {
      user_id: user.id,
      game_id: gameId,
      plays: (prevBest?.plays ?? 0) + 1,
      season_id: seasonId,
      updated_at: new Date().toISOString(),
    }
    if (isRankBest) {
      row.best_score = clamped
      row.tie_ms = tie
      row.achieved_at = new Date().toISOString()
    } else {
      row.best_score = prevScore
      row.tie_ms = prevTie
    }
    const { error: bestErr } = await admin
      .from('minigame_scores')
      .upsert(row, { onConflict: 'user_id,game_id' })
    if (bestErr) return json({ error: bestErr.message }, 500)

    // (5) 매 판 기록 — 관리자 통계(평균 플레이 시간·실제 이용 시간대)의 유일한 출처.
    //     ⚠️ 최고기록 테이블로는 그 두 값을 낼 수 없다(거긴 사람당 한 줄이고 '최고기록 세운 판'만 안다).
    //     ⚠️ 실패해도 제출을 막지 않는다 — 통계 때문에 게임이 안 되면 안 된다.
    await admin.from('minigame_plays').insert({
      user_id: user.id, game_id: gameId, score: clamped, duration_ms: tie ?? null,
    }).then(undefined, () => { /* 통계 기록 실패는 삼킨다 */ })

    return json({
      ok: true,
      gameId,
      clamped,
      delta: credited, // 이번 제출로 실제 적립된 활동점수(하루 캡이 찼으면 0)
      playsToday: Math.min((playsToday ?? 0) + (credited > 0 ? 1 : 0), perDay),
      perDay,
      isRankBest,
      metric: spec.metric,
    })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
