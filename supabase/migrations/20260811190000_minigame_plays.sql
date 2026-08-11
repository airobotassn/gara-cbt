-- 미니게임 **매 판 기록** — 2026-08-11.
--
-- 왜 필요한가: 지금은 `minigame_scores`(사람×게임당 최고기록 1행)뿐이라
--   · "평균 플레이 시간" 을 낼 수 없다 — 남아 있는 `tie_ms` 는 **최고기록을 세운 그 판**의 소요시간이다.
--   · "언제 하는가" 도 최고기록을 세운 시각뿐이라 실제 이용 시간대와 다르다.
--   관리자 화면이 두 값을 물어보는데 데이터가 없어서 대충 근사하고 있었다 → 매 판을 남긴다.
--
-- ⚠️ 최고기록 테이블을 대체하지 않는다. 랭킹은 계속 `minigame_scores` 가 본다(줄 세우기는 최고기록 기준).
create table if not exists public.minigame_plays (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id text not null,
  score numeric not null default 0,
  -- 그 판에 걸린 시간(ms). 게임이 안 보내주면 null — 없다고 0으로 적으면 평균이 거짓말이 된다.
  duration_ms int check (duration_ms is null or duration_ms >= 0),
  played_at timestamptz not null default now()
);
create index if not exists minigame_plays_game_idx on public.minigame_plays (game_id, played_at desc);
create index if not exists minigame_plays_user_idx on public.minigame_plays (user_id, played_at desc);

-- ⚠️ 무한정 쌓게 두지 않는다 — 관리자 통계는 최근 구간만 보면 되고, 오래된 낱개 기록은 가치가 없다.
--    (정리는 나중에 크론으로. 지금은 인덱스만 걸어두고 조회 쪽에서 기간을 자른다.)
