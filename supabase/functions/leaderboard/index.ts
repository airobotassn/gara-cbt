// leaderboard:
//  - scope 'global'(기본): 전체(모든 레벨) TOP N + 내 순위/총원. RPC global_top. 응답 { top, total, me } (기존 호출자 호환).
//  - scope 'region'|'country'|'school': 집계 버킷 리더보드. RPC region_/country_/school_leaderboard.
//      개인 식별 필드 없이 집계값만(code·member_count·avg_level·active_today·participation·score, 학교는 label 추가).
//      응답 { buckets, scope, window }. member_count<5 프라이버시 floor 버킷은 RPC 가 이미 제외.
//  - 정렬(global): 랭킹 점수(user_progress.points) desc → 동점 먼저 도달. rating 필드에 points.
//  - 닉네임·레벨·점수·아바타만 공개(이메일 비공개).
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/scoring.ts'

const TOP_N = 10

interface RpcUser {
  rank: number
  name: string
  level: number
  rating: number
  avatar: string | null
  me?: boolean
}

// 아바타 문자열 해석: 'gem:#hex'=젬색 · 'img:url'=이미지 · 'mascot:<n>'=관리자 마스코트 · 'char:<id>'=캐릭터(image·color 모두 없음 → 클라 시드젬 폴백) · 그 외/NULL=색 없음(시드 젬)
// char: 를 소유 파츠로 해석하는 서버 resolveAvatar 는 이후 슬라이스(user_characters/user_cosmetics 조인); 지금은 안전 폴백.
function mapUser(u: RpcUser, me = false) {
  const av = u.avatar ?? ''
  return {
    rank: u.rank,
    name: u.name,
    level: u.level,
    rating: u.rating,
    color: av.startsWith('gem:') ? av.slice(4) : null,
    image: av.startsWith('img:') ? av.slice(4) : null,
    mascot: av.startsWith('mascot:') ? av.slice(7) : null,
    character: av.startsWith('char:') ? av.slice(5) : null,
    me: me || !!u.me,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const body = (await req.json().catch(() => ({}))) as {
      scope?: 'global' | 'region' | 'country' | 'school'
      window?: 'daily' | 'season'
      country?: string
    }
    const scope = body.scope ?? 'global'
    const admin = adminClient()

    // 기본 경로 — 명예의 전당(개인 TOP N + 내 순위). 기존 호출자 호환.
    if (scope === 'global') {
      // 랭킹(명예의 전당)은 공개 — 비로그인도 열람 가능. 'me'(내 순위)는 로그인 시에만 채워진다.
      const user = await getUser(req)
      const { data, error } = await admin.rpc('global_top', { p_uid: user?.id ?? null, p_limit: TOP_N })
      if (error) return json({ error: error.message }, 500)

      const d = (data ?? {}) as { top?: RpcUser[]; total?: number; me?: RpcUser | null }
      const top = (d.top ?? []).map((u) => mapUser(u))
      const me: Record<string, unknown> | null = d.me ? mapUser(d.me, true) : null
      // 칭호(자격증 트랙·급수): 개인 응답 me 에만 부착. exam_attempts 합격에서 ON READ 파생(user_titles).
      //   · 로그인 사용자만 조회(비로그인 me=null). 실패 시 무시(back-compat: title 미포함).
      //   · top 행은 user_id 를 노출하지 않으므로(프라이버시) 칭호 미부착. me(본인)만 노출.
      if (me && user?.id) {
        const { data: titles } = await admin.rpc('user_titles', { p_uid: user.id })
        const arr = Array.isArray(titles) ? (titles as Array<{ track: string; grade: string; exam_title?: string }>) : []
        if (arr.length) {
          me.title = `CARIS ${arr[0].track} ${arr[0].grade}`
          me.titles = arr
        }
      }
      return json({ top, total: d.total ?? 0, me })
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
