-- ============================================================
-- minigame_scores — 게임별 개인 최고기록 + minigame_top RPC (게임별 전체유저 랭킹)
--   · 왜 새 테이블인가: activity_ledger 는 "활동점수 delta"(게임별 하루 1행 · GAME_MAX 로 정규화·clamp)만
--     담아서 줄 세우기에 못 쓴다. 랭킹은 원점수 원본이 필요하다 → 별도 저장.
--   · 정렬 = best_score desc → tie_ms asc(있을 때) → achieved_at asc(먼저 도달한 사람이 위, 프로젝트 관례).
--     tie_ms 는 퍼즐 게임(닿아라·프로그램해라·지어라) 전용 동률 해소용 소요시간(ms).
--     그 3종은 레벨이 5·3·6개뿐이어서 '도달 레벨'만으로는 전원 만점 → 시간으로 갈라야 보드가 의미를 갖는다.
--     점수형(버텨라·쏴라·골라라)은 tie_ms=null 이고 achieved_at 으로만 갈린다.
--   · 시즌 스코프 아님(통산 최고). 아케이드 하이스코어 관례이고, 시즌 리셋 함수를 건드리지 않아도 된다.
--     season_id 는 그 기록이 세워진 시즌 참고용으로만 남긴다.
--   · RLS 켜고 **정책 없음** = service_role(엣지 함수) 전용. 프로젝트 보안 모델과 동일(랭킹 원천은 클라 직접
--     SELECT 금지). anon 이 minigame_top 을 직접 호출하면 빈 결과.
--   멱등(재실행 안전).
-- ============================================================
create table if not exists minigame_scores (
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id text not null,
  best_score numeric not null check (best_score >= 0),
  tie_ms int check (tie_ms is null or tie_ms >= 0),
  plays int not null default 1 check (plays >= 0),
  season_id int,
  achieved_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, game_id)
);
alter table minigame_scores enable row level security;

-- 보드 조회 인덱스 — 정렬 3키를 그대로 태운다.
create index if not exists minigame_scores_board_idx
  on minigame_scores (game_id, best_score desc, tie_ms asc nulls last, achieved_at asc);

-- ============================================================
-- minigame_top(p_game, p_uid, p_limit) → { top[], total, me }
--   scoped_top 과 같은 응답 골격(rank·name·avatar·me + total + me.rank)이라 프론트가 같은 방식으로 그린다.
--   탈퇴자(deactivated_at)·익명 게스트는 모수에서 제외 — 다른 리더보드와 동일 정책.
-- ============================================================
create or replace function public.minigame_top(
  p_game text,
  p_uid uuid default null,
  p_limit int default 20
)
returns jsonb language sql stable as $$
with ranked as (
  select s.user_id, s.best_score, s.tie_ms, s.plays, s.achieved_at,
         row_number() over (order by s.best_score desc, s.tie_ms asc nulls last, s.achieved_at asc) as grank,
         count(*) over ()                                                                            as gtotal,
         cume_dist() over (order by s.best_score desc)::numeric                                      as pct
  from minigame_scores s
  join profiles pr0 on pr0.id = s.user_id and pr0.deactivated_at is null and pr0.is_anonymous = false
  where s.game_id = p_game
),
me as (select * from ranked where user_id = p_uid),
above as (select r.best_score from ranked r join me on r.grank = me.grank - 1)
select jsonb_build_object(
  'top', coalesce((
    select jsonb_agg(jsonb_build_object(
      'rank', r.grank,
      'name', coalesce(nullif(pr.display_name, ''), '익명'),
      'score', r.best_score,
      'tieMs', r.tie_ms,
      'avatar', pr.avatar_url,
      'achievedAt', r.achieved_at,
      'me', (r.user_id = p_uid)
    ) order by r.grank)
    from ranked r left join profiles pr on pr.id = r.user_id
    where r.grank <= p_limit
  ), '[]'::jsonb),
  'total', coalesce((select gtotal from ranked limit 1), 0),
  'me', (
    select jsonb_build_object(
      'rank', r.grank,
      'name', coalesce(nullif(pr.display_name, ''), '익명'),
      'score', r.best_score,
      'tieMs', r.tie_ms,
      'plays', r.plays,
      'avatar', pr.avatar_url,
      'achievedAt', r.achieved_at,
      'percentile', round(r.pct, 4),
      'scoreToPass', (select best_score from above) - r.best_score,
      'me', true
    )
    from ranked r left join profiles pr on pr.id = r.user_id
    where r.user_id = p_uid
  )
);
$$;
