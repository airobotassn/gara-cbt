// leaderboard:
//  - scope 'global'(기본) | 'my-country' | 'my-region': **개인** 리더보드 TOP N + 내 순위/총원. RPC scoped_top.
//      /ranking 의 세 탭(전세계 · 내 국가 · 내 지역)이 이걸 쓴다. 모수만 다르고 응답 형태는 같다
//      → { top, total, me, scope, code }. code = 적용된 국가/지역 코드(전세계는 null).
//      'my-*' 는 호출자 프로필(country_code·region_code)로 범위를 정한다 — 클라가 임의 범위를 지정할 수 없다.
//      비로그인 → { needsAuth: true }, 지역/국가 미설정 → { needsRegion: true }(빈 보드).
//  - scope 'trend': 내 순위 추이(ranking_history). 보고 있는 탭(board)의 순위 + 그날 점수.
//      → { points: [{day, rank, score}], scope } · 비로그인 { points: [], needsAuth }.
//  - scope 'region'|'country'|'school': 집계 버킷 리더보드(/arena 지도 · 랜딩 지구본용).
//      RPC region_/country_/school_leaderboard — **스냅샷 테이블 arena_bucket_scores 를 select 만** 한다
//      (2026-08-18. 예전엔 호출마다 profiles ⨝ user_progress 를 두 번 훑었는데, 이걸 부르는 자리가
//       랜딩이라 첫 화면 방문자 전원이 전 회원 집계를 돌리고 있었다. 갱신은 pg_cron 5분).
//      개인 식별 필드 없이 집계값만(code·member_count·avg_level·active_today·participation·score·has_real,
//      학교는 label 추가). 응답 { buckets, scope, window }. member_count<5 프라이버시 floor 는 갱신 때 이미 적용.
//      ⚠️ 값은 **시드 더미(arena_seed_buckets) + 실집계가 가중평균으로 합쳐진 것**이다. 진짜 사람이
//         있는 버킷인지는 `has_real` 만 말해 준다 — member_count 에는 가상 회원이 섞여 있다.
//  - 정렬(개인): season_total(실력+활동 통합 랭킹점수) desc → 동점 먼저 도달. rating 필드에 season_total.
//  - 닉네임·레벨·점수·아바타만 공개(이메일 비공개).
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/scoring.ts'
// 티어 key → 표시 이름. 칭호가 key 만 오므로 여기서 이름을 붙인다(프론트 짝 = src/lib/caris.ts 의 tierName).
import { TIER_LABEL } from '../_shared/exam-tickets.ts'

const TOP_N = 10

interface RpcUser {
  rank: number
  /** top 행에만 있다(scoped_top, 20260814100000). 방(/room/:handle) 진입용 — me 행에는 없다. */
  uid?: string
  name: string
  level: number
  rating: number
  avatar: string | null
  /** top 행에만 있다(scoped_top, 20260818130000). 시상대 이름 뒤 국기용 — me 행에는 없다. */
  country?: string | null
  tier?: string
  percentile?: number
  me?: boolean
}

// 아바타 문자열 해석: 'gem:#hex'=젬색 · 'img:url'=이미지 · 'mascot:<n>'=관리자 마스코트 · 'char:<id>'=캐릭터(image·color 모두 없음 → 클라 시드젬 폴백) · 그 외/NULL=색 없음(시드 젬)
// char: 를 소유 파츠로 해석하는 서버 resolveAvatar 는 이후 슬라이스(user_characters/user_cosmetics 조인); 지금은 안전 폴백.
function mapUser(u: RpcUser, me = false) {
  const av = u.avatar ?? ''
  return {
    rank: u.rank,
    // 방 진입용. 방은 공개(room 함수 view)고, uid 로 열 수 있는 건 그 방뿐이다 —
    // 잠금 테이블은 전부 RLS 미부여라 uid 를 안다고 읽히지 않는다.
    uid: u.uid ?? null,
    name: u.name,
    level: u.level,
    rating: u.rating,
    color: av.startsWith('gem:') ? av.slice(4) : null,
    image: av.startsWith('img:') ? av.slice(4) : null,
    mascot: av.startsWith('mascot:') ? av.slice(7) : null,
    character: av.startsWith('char:') ? av.slice(5) : null,
    // 시상대 이름 뒤 국기. 온보딩 전이면 null 이고, 그때는 프론트가 국기를 아예 안 그린다.
    country: u.country ?? null,
    tier: u.tier ?? null,
    percentile: u.percentile ?? null,
    me: me || !!u.me,
  }
}

/**
 * 장착한 캐릭터·스킨을 행에 붙인다 — 공유 카드가 그 사람의 캐릭터와 배경으로 그려지게 하려는 것.
 *
 * ⚠️ **`scoped_top` 이 아니라 여기서 조인한다.** RPC 를 고치면 그 RPC 를 쓰는 다른 화면
 *    (/arena 지도·랭킹 세 탭·아레나 채팅)이 전부 같이 흔들린다. 여기서 붙이면 한 함수만 바뀐다.
 * ⚠️ 노출값 기준은 기존과 같다 — 캐릭터·스킨은 **랭킹 시상대와 남의 방에 이미 보이는 그림**이라
 *    새로 새는 정보가 없다(국가·지역·가입일 같은 건 여전히 안 붙인다).
 * ⚠️ 소유하지 않은 것을 장착할 길이 없으므로(hub_equip 이 막는다) 여기서 소유를 다시 보지 않는다.
 */
async function attachCosmetics(
  admin: ReturnType<typeof adminClient>,
  rows: { uid?: string | null; [k: string]: unknown }[],
) {
  const ids = [...new Set(rows.map((r) => r.uid).filter((v): v is string => !!v))]
  if (!ids.length) return
  // 실회원(user_characters)과 **랭킹 더미**(ranking_dummies — profiles 에 행이 없다)를 같이 물어본다.
  //   ⚠️ 예전엔 실회원을 먼저 받고 '못 찾은 uid' 로만 더미를 물어 **두 번 줄 서 있었다**. 더미가
  //      3만5천 명이라 보드에는 거의 항상 섞여서, 그 두 번째 조회가 사실상 매번 실행된다 —
  //      즉 순차 2왕복이 기본값이었다. 같은 id 집합으로 동시에 던지고 실회원을 우선 채택하면 결과가 같다.
  //   ⚠️ 안 붙여도 화면은 안 깨진다(폴백 그림). 붙이는 건 시상대에 선 사람들이 전부 같은 그림이면
  //      보드가 밋밋해서다.
  const [{ data }, { data: dm }] = await Promise.all([
    admin.from('user_characters').select('user_id, base_key, equipped').in('user_id', ids),
    admin.from('ranking_dummies').select('id, character_key, skin').in('id', ids),
  ])
  const byUid = new Map<string, { character: string | null; skin: string | null }>()
  // 더미를 먼저 깔고 실회원으로 덮는다 — 실회원 값이 이긴다(옛 순서와 같은 결과).
  for (const d of dm ?? []) {
    byUid.set(d.id as string, {
      character: ((d.character_key as string | null) ?? null),
      skin: ((d.skin as string | null) ?? null),
    })
  }
  for (const c of data ?? []) {
    const eq = (c.equipped as Record<string, string> | null) ?? {}
    const base = (c.base_key as string) ?? 'default'
    byUid.set(c.user_id as string, {
      // 'default' 는 아직 안 고른 상태 = 폴백 그림을 쓰라는 뜻이라 null 로 눕힌다(프론트 분기가 하나로 준다).
      character: base && base !== 'default' ? base : null,
      skin: eq.skin ?? null,
    })
  }

  for (const r of rows) {
    const c = r.uid ? byUid.get(r.uid) : null
    r.character = c?.character ?? null
    r.skin = c?.skin ?? null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const body = (await req.json().catch(() => ({}))) as {
      scope?: 'global' | 'my-country' | 'my-region' | 'region' | 'country' | 'school' | 'user' | 'page' | 'trend'
      window?: 'daily' | 'season'
      country?: string
      uid?: string
      // scope 'page'(무한 스크롤) · 'trend'(랭킹 추이) 공용 — 어느 보드냐.
      board?: 'global' | 'my-country' | 'my-region'
      // scope 'trend' 전용 — 며칠치.
      days?: number
      cursor?: { score?: number; at?: string; id?: string } | null
      startRank?: number
      limit?: number
    }
    const scope = body.scope ?? 'global'
    const admin = adminClient()

    // 한 사람의 전세계 순위 — /arena 채팅에서 아바타를 누르면 그 사람 카드를 그리는 데 쓴다.
    //   · scoped_top 은 p_uid 를 **인자로** 받으므로 호출자 본인이 아니어도 된다. p_limit=0 이면 top 은 빈 배열,
    //     me 칸만 채워져 내려온다 → 목록을 통째로 받지 않고 한 사람만 집어 온다.
    //   · 노출값은 /ranking TOP10 이 이미 공개하는 것과 동일(이름·아바타·순위·백분위·시즌점수)이고
    //     me 행에는 uid 가 없다(scoped_top 이 top 행에만 넣는다) → 이 경로의 응답에도 uid 는 안 실린다.
    //     애초에 호출자가 uid 를 인자로 준 것이라 새로 새는 정보가 없다.
    //   ⚠️ 익명·탈퇴 계정은 scoped_top 의 base 가 이미 걸러서(is_anonymous=false, deactivated_at is null)
    //      me=null 로 나온다 → { user: null }. 익명 채팅글의 신원이 카드로 새지 않는다.
    if (scope === 'user') {
      const uid = String(body.uid ?? '')
      if (!/^[0-9a-f-]{36}$/i.test(uid)) return json({ error: 'bad_uid' }, 400)
      const { data, error } = await admin.rpc('scoped_top', { p_uid: uid, p_limit: 0, p_country: null, p_region: null })
      if (error) return json({ error: error.message }, 500)
      const d = (data ?? {}) as { total?: number; me?: RpcUser | null }
      if (!d.me) return json({ user: null, total: d.total ?? 0 })
      // me 행에는 uid 가 없다(scoped_top 이 top 행에만 넣는다) → **호출자가 인자로 준 uid** 로 붙인다.
      // 그 uid 는 애초에 요청에 실려 온 값이라 새로 새는 정보가 없다.
      const one: Record<string, unknown> = { ...mapUser(d.me), uid }
      await attachCosmetics(admin, [one])
      // uid 는 도로 null 로 되돌린다 — 이 경로의 응답에 uid 가 실린 적이 없다(mapUser 가 늘 null 로 준다).
      // 잠깐 넣은 건 위 조회 때문이다.
      one.uid = null

      // 국가·지역 순위 — 남의 카드에도 넣는다(2026-08-20 요청).
      // ⚠️ 범위는 **그 사람 프로필에서** 읽는다. 요청 파라미터로 받으면 남의 카드에 아무 국가·지역이나
      //    지정해 "그 사람이 그 지역에서 몇 위인지" 를 캐낼 수 있다.
      // ⚠️ **코드**를 같이 준다(이름이 아니라 'KR'·'KR-11'). 카드가 '대한민국 6위'·'서울특별시 2위' 로
      //    쓰기 때문이다(2026-08-21 요청). 이름표는 클라가 이미 갖고 있으므로(249개국 × 6개국어 +
      //    지도 파일의 지역명) 서버가 6개국어 이름을 만들어 내려보내지 않는다.
      //   ⚠️ 랭킹 더미는 profiles 에 행이 없다 → 여기서 못 찾으면 더미 표를 본다.
      //      안 보면 더미 카드에서만 '대한민국 —위' 처럼 그 칸이 비어 진짜와 티가 난다.
      const { data: pr } = await admin
        .from('profiles')
        .select('country_code,region_code')
        .eq('id', uid)
        .maybeSingle()
      const { data: dpr } = pr
        ? { data: null }
        : await admin.from('ranking_dummies').select('country_code,region_code').eq('id', uid).maybeSingle()
      const src = (pr ?? dpr) as { country_code?: string | null; region_code?: string | null } | null
      const cc = (src?.country_code as string | null) ?? null
      const rc = (src?.region_code as string | null) ?? null
      const scoped = async (country: string | null, region: string | null) => {
        if (!country) return { rank: null as number | null, total: null as number | null }
        const { data: sd } = await admin.rpc('scoped_top', { p_uid: uid, p_limit: 0, p_country: country, p_region: region })
        const r = (sd ?? {}) as { total?: number; me?: RpcUser | null }
        return { rank: (r.me?.rank as number | undefined) ?? null, total: r.total ?? null }
      }
      const [inCountry, inRegion] = await Promise.all([scoped(cc, null), scoped(cc && rc ? cc : null, rc)])

      return json({
        user: one,
        total: d.total ?? 0,
        countryRank: inCountry.rank,
        countryTotal: inCountry.total,
        regionRank: inRegion.rank,
        regionTotal: inRegion.total,
        countryCode: cc,
        regionCode: rc,
      })
    }

    // 이어보기(무한 스크롤) — 첫 화면 다음 구간을 커서로 떠온다.
    //   ⚠️ **총원·내 순위·백분위를 다시 계산하지 않는다.** 그게 랭킹 조회가 285ms 인 이유고,
    //      스크롤할 때마다 되풀이하면 페이지마다 그 시간이 붙는다. 첫 화면이 이미 받은 값이다.
    //   ⚠️ 커서는 클라가 앞 응답에서 받은 것을 **그대로** 돌려준다(점수·시각·id 세 값이 한 벌).
    //      점수만 보내면 동점자가 통째로 건너뛰어진다 — 실측 3만5천 명 중 7,419명이 빠졌다.
    //   ⚠️ 범위(국가·지역)는 여기서도 **서버가 호출자 프로필에서** 읽는다. 클라가 지정하게 하면
    //      남의 국가·지역 보드를 훑을 수 있다(위 첫 화면 경로와 같은 이유).
    if (scope === 'page') {
      const user = await getUser(req)
      const board = body.board === 'my-country' || body.board === 'my-region' ? body.board : 'global'
      let pCountry: string | null = null
      let pRegion: string | null = null
      if (board !== 'global') {
        if (!user?.id) return json({ rows: [], cursor: null, needsAuth: true })
        const { data: pr } = await admin
          .from('profiles').select('country_code,region_code').eq('id', user.id).maybeSingle()
        pCountry = (pr?.country_code as string | null) ?? null
        if (board === 'my-region') pRegion = (pr?.region_code as string | null) ?? null
        if (board === 'my-region' ? !pRegion : !pCountry) return json({ rows: [], cursor: null, needsRegion: true })
      }
      const cur = (body.cursor ?? null) as { score?: number; at?: string; id?: string } | null
      const { data, error } = await admin.rpc('scoped_page', {
        p_uid: user?.id ?? null,
        p_after_score: cur?.score ?? null,
        p_after_at: cur?.at ?? null,
        p_after_id: cur?.id ?? null,
        p_start_rank: Math.max(1, Math.floor(Number(body.startRank ?? 1))),
        // 한 번에 50명 — 쿼리 비용은 20명과 같은데 함수 왕복이 실제 지연의 절반이라 왕복을 줄인다.
        p_limit: Math.min(100, Math.max(10, Math.floor(Number(body.limit ?? 50)))),
        p_country: pCountry,
        p_region: pRegion,
      })
      if (error) return json({ error: error.message }, 500)
      const d = (data ?? {}) as { rows?: RpcUser[]; cursor?: unknown }
      const rows = (d.rows ?? []).map((u) => mapUser(u))
      await attachCosmetics(admin, rows)
      return json({ rows, cursor: d.cursor ?? null })
    }

    // 랭킹 추이 — 내 순위가 날짜별로 어떻게 움직였나(ranking_history). 순위 한 줄 + 툴팁용 점수.
    //   ⚠️ **본인 것만** 준다. 남의 uid 를 인자로 받지 않는다 — /ranking 이 공개하는 건 '지금 순위'
    //      한 값이지 그 사람이 언제 오르내렸는지가 아니다(활동 패턴은 별개의 정보다).
    //   ⚠️ 범위는 보고 있는 탭을 따라가되 국가·지역은 **서버가 호출자 프로필에서** 읽는다
    //      (위 두 경로와 같은 이유 — 클라가 지정하면 남의 보드를 훑는 길이 된다).
    if (scope === 'trend') {
      const user = await getUser(req)
      if (!user?.id) return json({ points: [], needsAuth: true })
      const board = body.board === 'my-country' || body.board === 'my-region' ? body.board : 'global'
      let pScope: 'global' | 'country' | 'region' = 'global'
      if (board !== 'global') {
        const { data: pr } = await admin
          .from('profiles').select('country_code,region_code').eq('id', user.id).maybeSingle()
        const cc = (pr?.country_code as string | null) ?? null
        const rc = (pr?.region_code as string | null) ?? null
        if (board === 'my-region' ? !rc : !cc) return json({ points: [], needsRegion: true })
        pScope = board === 'my-region' ? 'region' : 'country'
      }
      const { data, error } = await admin.rpc('ranking_trend', {
        p_uid: user.id,
        p_scope: pScope,
        // 화면 기간 탭(1주/3개월/시즌=180일)의 상한. 그 이상은 표에도 없다(백필 400일).
        p_days: Math.min(400, Math.max(1, Math.floor(Number(body.days ?? 180)))),
      })
      if (error) return json({ error: error.message }, 500)
      return json({ points: (data ?? []) as unknown[], scope: pScope })
    }

    // 개인 리더보드 — 전세계 / 내 국가 / 내 지역. 세 탭 모두 같은 RPC(scoped_top), 모수만 다르다.
    if (scope === 'global' || scope === 'my-country' || scope === 'my-region') {
      // 랭킹은 공개 — 비로그인도 전세계 보드는 열람 가능. 'me'(내 순위)는 로그인 시에만 채워진다.
      const user = await getUser(req)

      // 범위 결정: 'my-*' 는 **서버가 호출자 프로필에서** 읽는다(클라가 남의 국가/지역을 지정할 수 없게).
      let pCountry: string | null = null
      let pRegion: string | null = null
      if (scope !== 'global') {
        if (!user?.id) return json({ top: [], total: 0, me: null, scope, code: null, needsAuth: true })
        const { data: pr } = await admin
          .from('profiles')
          .select('country_code,region_code')
          .eq('id', user.id)
          .maybeSingle()
        pCountry = (pr?.country_code as string | null) ?? null
        if (scope === 'my-region') pRegion = (pr?.region_code as string | null) ?? null
        // 온보딩 미완(국가·지역 미확정) → 빈 보드 + 안내 플래그. 지역 탭은 country 도 같이 걸어 안전하게 좁힌다.
        if (scope === 'my-region' ? !pRegion : !pCountry) {
          return json({ top: [], total: 0, me: null, scope, code: null, needsRegion: true })
        }
      }

      const { data, error } = await admin.rpc('scoped_top', {
        p_uid: user?.id ?? null,
        p_limit: TOP_N,
        p_country: pCountry,
        p_region: pRegion,
      })
      if (error) return json({ error: error.message }, 500)

      const d = (data ?? {}) as { top?: RpcUser[]; total?: number; cursor?: unknown; me?: (RpcUser & { points_to_pass?: number | null }) | null }
      const top = (d.top ?? []).map((u) => mapUser(u))
      const me: Record<string, unknown> | null = d.me ? mapUser(d.me, true) : null
      // 시상대·목록에서 사람을 누르면 그 사람 카드가 뜬다 → 캐릭터·스킨이 필요하다.
      // me 행에는 uid 가 없으므로 로그인한 본인 id 로 잠깐 채워 **top 과 한 번에** 조회한다.
      //   ⚠️ 예전엔 attachCosmetics 를 top 용·me 용으로 **두 번** 불러서 user_characters 를
      //      한 요청에 두 번 쳤다. 같은 표를 두 번 볼 이유가 없다.
      const withMe: Record<string, unknown>[] = [...top]
      if (me && user?.id) {
        me.uid = user.id
        withMe.push(me)
      }
      // 칭호(인증서 트랙·급수): 개인 응답 me 에만 부착. exam_attempts 합격에서 ON READ 파생(user_titles).
      //   · 로그인 사용자만 조회(비로그인 me=null). 실패 시 무시(back-compat: title 미포함).
      //   · top 행은 user_id 를 노출하지 않으므로(프라이버시) 칭호 미부착. me(본인)만 노출.
      //   ⚠️ user_titles 는 p_uid 만 쓴다 — 캐릭터 조회 결과를 안 보므로 같이 내보낸다.
      const [, titlesRes] = await Promise.all([
        attachCosmetics(admin, withMe),
        me && user?.id ? admin.rpc('user_titles', { p_uid: user.id }) : Promise.resolve({ data: null }),
      ])
      if (me && user?.id) {
        // ⚠️ 도로 null 로 되돌린다 — me 행에 uid 가 없는 건 기존 계약이다(랭킹 '내 순위' 바가
        //    그 null 을 보고 방 링크를 안 그린다). 조회하려고 잠깐 넣었을 뿐이다.
        me.uid = null
        // ⚠️ 급수(1급~4급)는 없다 — 2026-07 체계 개편으로 티어 6개가 각각 독립 자격이 됐고
        //    user_titles 도 그에 맞게 티어 key 만 돌려준다(20260807130000). 표시 이름은 TIER_LABEL 이 단일 출처.
        //    RPC 가 exam_tiers.sort 내림차순으로 주므로 [0] 이 최상위 자격이다.
        const titles = (titlesRes as { data: unknown }).data
        const arr = Array.isArray(titles) ? (titles as Array<{ tier: string; exam_title?: string }>) : []
        if (arr.length) {
          me.title = `CARIS ${TIER_LABEL[arr[0].tier] ?? arr[0].tier}`
          me.titles = arr
        }
        // 다음 순위 게이지: 그 **보드 안에서** 바로 윗사람과의 점수차(scoped_top 이 같이 내려준다).
        me.pointsToPass = d.me?.points_to_pass ?? null
      }
      // 이어보기 시작점 — 프론트가 이 커서를 그대로 되돌려주면 11위부터 온다(scope 'page').
      return json({ top, total: d.total ?? 0, me, scope, code: pRegion ?? pCountry, cursor: d.cursor ?? null })
    }

    // 집계 버킷 리더보드 — 개인정보 없이 집계값만. RPC 가 프라이버시 floor(member_count<5) 를 이미 제외.
    const window = body.window === 'season' ? 'season' : 'daily'
    const country = (body.country ?? 'KR').slice(0, 8)
    const rpcName =
      scope === 'region' ? 'region_leaderboard' : scope === 'country' ? 'country_leaderboard' : 'school_leaderboard'
    // country_leaderboard 는 국가 파라미터가 없다(국가 자체가 버킷).
    const params: Record<string, string> = { p_window: window }
    if (scope !== 'country') params.p_country = country
    const { data, error } = await admin.rpc(rpcName, params)
    if (error) return json({ error: error.message }, 500)

    const buckets = Array.isArray(data) ? data : []
    return json({ buckets, scope, window })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
