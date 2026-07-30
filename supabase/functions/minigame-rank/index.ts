// minigame-rank: 게임별 **전체 유저** 랭킹 TOP N + 내 순위. RPC minigame_top.
//   · /games/:id 의 게임 인트로·아웃트로 우상단 '랭킹' 버튼이 부모(MiniGame.tsx)를 통해 이걸 호출한다.
//   · 랭킹은 공개 — 비로그인도 보드 열람 가능하고 me(내 순위)만 로그인 시 채워진다(leaderboard 와 동일 정책).
//   · 노출 필드는 닉네임·점수·아바타뿐(이메일·user_id 비공개). 탈퇴자·익명 게스트는 RPC 가 모수에서 제외.
//   · 정렬 = 점수 desc → (레벨형만) 소요시간 asc → 먼저 도달한 순. 지표 종류는 GAMES[gameId].metric.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, getUser } from '../_shared/scoring.ts'
import { gameSpec } from '../_shared/minigames.ts'

const TOP_N = 20

interface RankRow {
  rank: number
  name: string
  score: number
  tieMs: number | null
  avatar: string | null
  achievedAt: string
  me?: boolean
}

// 아바타 문자열 해석 — leaderboard 함수와 동일 규칙(gem:색 · img:URL · mascot: · char:).
function mapRow(r: RankRow) {
  const av = r.avatar ?? ''
  return {
    rank: r.rank,
    name: r.name,
    score: Number(r.score),
    tieMs: r.tieMs ?? null,
    achievedAt: r.achievedAt,
    color: av.startsWith('gem:') ? av.slice(4) : null,
    image: av.startsWith('img:') ? av.slice(4) : null,
    mascot: av.startsWith('mascot:') ? av.slice(7) : null,
    character: av.startsWith('char:') ? av.slice(5) : null,
    me: !!r.me,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { gameId } = (await req.json().catch(() => ({}))) as { gameId?: string }
    const spec = gameSpec(gameId)
    if (!gameId || !spec) return json({ error: 'unknown_game' }, 400)

    const user = await getUser(req)
    const admin = adminClient()

    const { data, error } = await admin.rpc('minigame_top', {
      p_game: gameId,
      p_uid: user?.id ?? null,
      p_limit: TOP_N,
    })
    if (error) return json({ error: error.message }, 500)

    const d = (data ?? {}) as { top?: RankRow[]; total?: number; me?: (RankRow & { plays?: number; percentile?: number; scoreToPass?: number | null }) | null }
    return json({
      gameId,
      metric: spec.metric,
      max: spec.max,
      top: (d.top ?? []).map(mapRow),
      total: d.total ?? 0,
      me: d.me
        ? {
            ...mapRow({ ...d.me, me: true }),
            plays: d.me.plays ?? 0,
            percentile: d.me.percentile ?? null,
            scoreToPass: d.me.scoreToPass ?? null,
          }
        : null,
      needsAuth: !user?.id,
    })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
