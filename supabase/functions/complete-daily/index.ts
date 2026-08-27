// complete-daily: 로그인 유저가 '오늘의 완료'를 1/일(KST) 로 확정하고 cosmetic 재화·스탬프를 적립한다.
//  · 1/day 가드는 daily_activity 의 **종류 플래그**(did_attendance / did_learn) 다. 행 존재로 판정하면 안 된다 —
//    그 행은 레벨테스트·미니게임도 만들기 때문(그 버그로 레벨테스트한 날 출석/학습이 잠겼다, 2026-07-27 수정).
//    재화·스탬프는 출석·학습 통틀어 하루 1회(RPC 응답 first), 활동점수는 종류별로 각각 적립.
//  · 적립은 원자 SECURITY DEFINER SQL fn(complete_daily_kind) 로 위임 — 기존 JS select→절대값 upsert(read-modify-write)
//    는 동시 호출 시 적립을 유실할 수 있어, 증분(points = points + p_points)을 하나의 트랜잭션으로 처리한다.
//  · cosmetic-only 하드 불변식: 실력 진척/스킬 레벨 테이블을 절대 읽거나 쓰지 않고,
//    _shared/scoring.ts(applyAttempt/computeRankChange) 도 import 하지 않는다. 수치는 config-driven 상수.
//  · body.kind = 'attendance'(기본, 출석) | 'daily_learn'(DAILY QUIZ 완료) — 코인 재화(위 RPC)와 별개로
//    activity_ledger(kind, delta) 를 적립한다(트리거 activity_ledger_apply, STAGE1b 가 user_progress.activity_score
//    를 원자 증분 — 이 함수는 user_progress 를 직접 쓰지 않는다, cosmetic-gate 유지).
//    ⚠️ ACTIVITY_ATTENDANCE_DELTA/ACTIVITY_DAILY_LEARN_DELTA 는 _shared/scoring.ts 의 ACTIVITY_DELTA 와 값이
//    같아야 한다(수동 동기) — cosmetic-only-gate 가 이 파일의 _shared/scoring.ts import 를 금지하므로 직접 참조가
//    불가능하다. get-hub 의 ECON 상수(DB 하드코딩과 수동 동기)와 동일한 기존 컨벤션.
// ⚠️ _shared 를 import 하므로 대시보드 편집 불가 → CLI 배포 전용: `supabase functions deploy complete-daily`.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser, getActiveSeasonId } from '../_shared/lib.ts'
import { kstDay } from '../_shared/kst.ts'

// 일일 완료 적립 재화(추후 config 로 이관). 스탬프는 종류별 1 카운트씩 누적.
const DAILY_POINTS = 10

// _shared/scoring.ts ACTIVITY_DELTA 와 동일값 유지(수동 동기, 위 주석 참조).
type LedgerKind = 'attendance' | 'daily_learn'
const ACTIVITY_DELTA_SYNCED: Record<LedgerKind, number> = { attendance: 5, daily_learn: 2 }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    // (1) 인증: 로그인 필수 + 익명 유저 불가.
    const user = await getUser(req)
    if (!user || user.is_anonymous) return json({ error: 'unauthorized' }, 401)

    const body = (await req.json().catch(() => ({}))) as { kind?: string }
    const kind: LedgerKind = body.kind === 'daily_learn' ? 'daily_learn' : 'attendance'

    const admin = adminClient()

    // (2) 원자 적립: 종류별 1/일 가드 + 플래그 세팅 + 재화/스탬프 증분을 하나의 SQL 트랜잭션으로.
    //     ⚠️ 잠금 판정은 daily_activity 행 존재가 아니라 종류 플래그(did_attendance/did_learn) 다 —
    //        행 자체는 레벨테스트·미니게임도 만들기 때문(20260727010000 마이그레이션). RPC 반환 jsonb 를 그대로 전달.
    //     ⚠️ 활성 시즌 조회(아래 3번에서 쓴다)는 user 도 이 RPC 결과도 안 쓴다 → 같이 내보낸다.
    //        적립 순서는 그대로다 — 쓰기는 여전히 RPC 가 먼저 끝난 뒤에 일어난다.
    const [{ data, error }, seasonId] = await Promise.all([
      admin.rpc('complete_daily_kind', {
        p_uid: user.id,
        p_points: DAILY_POINTS,
        p_kind: kind,
      }),
      getActiveSeasonId(admin),
    ])
    if (error) return json({ error: error.message }, 500)

    // (3) 활동점수 적립 — 코인 재화(위)와 별개 원장. 하루-cap 은 activity_ledger 부분 unique(user_id,kind,day)
    //     가 보장한다. ⚠️ 그 인덱스는 partial(where kind in ('attendance','daily_learn')) 이라 PostgREST
    //     의 upsert(onConflict)는 조건절을 실을 수 없어 42P10(no unique/exclusion constraint matching)로 죽는다
    //     (minigame 쪽 daycap 은 non-partial 이라 upsert 가 가능하나, daycap 을 non-partial 로 바꾸면 minigame
    //     이 1/일로 잘못 제한되므로 인덱스는 partial 유지가 필수 — 대신 여기를 insert 로 바꾼다).
    //     insert 로 시도하고 23505(unique_violation = 오늘 이미 적립됨)는 무시(멱등), 그 외 에러는 로깅 후 표면화.
    //     활성 시즌이 없으면(운영 사고) 스킵 — 코인 적립은 이미 끝났으므로 응답은 그대로 성공 반환.
    if (seasonId != null) {
      const today = kstDay()
      const { error: ledgerError } = await admin.from('activity_ledger').insert({
        user_id: user.id,
        season_id: seasonId,
        kind,
        delta: ACTIVITY_DELTA_SYNCED[kind],
        day: today,
        source_ref: null,
      })
      if (ledgerError && ledgerError.code !== '23505') {
        console.error('complete-daily: activity_ledger insert 실패', ledgerError)
        return json({ error: ledgerError.message }, 500)
      }
    }
    // ⚠️ daily_activity 의 종류 플래그는 위 RPC 가 세팅한다(예전엔 여기서 upsert 했는데, 활성 시즌이 없으면
    //    이 블록을 통째로 스킵해 플래그가 영영 안 찍히는 구멍이 있었다).

    return json(data)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
