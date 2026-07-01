// leaderboard: 전체(모든 레벨) TOP N + 내 순위/총원. 순위 계산은 DB(RPC global_top)에서 윈도우 함수로.
//  - 정렬: 랭킹 점수(user_progress.points 0~10000) desc → 동점은 먼저 도달(updated_at asc). rating 필드에 points 를 담아 반환.
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

// 아바타 문자열 해석: 'gem:#hex'=젬색 · 'img:url'=이미지 · 그 외/NULL=색 없음(시드 젬)
function mapUser(u: RpcUser, me = false) {
  const av = u.avatar ?? ''
  return {
    rank: u.rank,
    name: u.name,
    level: u.level,
    rating: u.rating,
    color: av.startsWith('gem:') ? av.slice(4) : null,
    image: av.startsWith('img:') ? av.slice(4) : null,
    me: me || !!u.me,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    // 랭킹(명예의 전당)은 공개 — 비로그인도 열람 가능. 'me'(내 순위)는 로그인 시에만 채워진다.
    const user = await getUser(req)

    const admin = adminClient()
    const { data, error } = await admin.rpc('global_top', { p_uid: user?.id ?? null, p_limit: TOP_N })
    if (error) return json({ error: error.message }, 500)

    const d = (data ?? {}) as { top?: RpcUser[]; total?: number; me?: RpcUser | null }
    const top = (d.top ?? []).map((u) => mapUser(u))
    const me = d.me ? mapUser(d.me, true) : null
    return json({ top, total: d.total ?? 0, me })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
