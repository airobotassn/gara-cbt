-- ============================================================
-- my_rank_context — 전세계 순위에서 랭킹 더미가 빠져 있던 것 (2026-08-25)
--
-- 증상: 공유 카드가 "World 4위 · 대한민국 174위 · 경기도 11위" 를 나란히 찍었다.
--       모수가 큰 쪽 순위가 더 앞선다는 건 어느 쪽이 틀렸다는 뜻이다.
--
-- 원인: 20260821130000 에서 랭킹 더미(3.5만)를 넣으며 **더미가 합류할 자리를 손으로 열었는데**
--       (scoped_top · room view · leaderboard) 이 함수만 빠졌다. 그래서 여기만 계속
--       실회원(user_progress ⨝ profiles)만 세어 "실회원 8명 중 4위" 를 내려주고 있었다.
--       국가·지역 순위는 scoped_top 이 주므로 더미 포함 — 한 카드 안에서 두 기준이 섞였다.
--       (실측: 같은 계정이 여기선 4위/8명, /ranking 월드 탭에선 8,591위/35,048명.)
--
-- ⛔ **scoped_top 에 위임하지 않는다 — 재보고 되돌렸다.** 위임하면 계산이 한 곳이 되어 좋지만
--    scoped_top 은 3.5만 행에 윈도 함수 3개(정렬이 temp 로 흘러넘친다)라 **실측 700ms** 다.
--    이 함수는 /hub 를 열 때마다 불리는 자리라 그 값을 첫 그림 앞에 세울 수 없다.
--    지금 판은 **세기(count)만** 한다 — 같은 DB 에서 **24ms**(29배). 더미 표엔 (season_total desc)
--    색인이 있어 "나보다 위" 세기가 색인 스캔으로 끝난다.
--
-- ⚠️ **그 대가로 순위 계산이 두 곳이 됐다 — 이 버그를 만든 바로 그 구조다.**
--    막는 장치는 테스트다: `tests/db/t-ranking-dummies.mjs` 가 두 구현의 답이 **같은지**
--    대조한다(상위·하위·동점 구간). 한쪽만 고치면 거기서 깨진다.
--    ⚠️ 정렬 기준(-season_total, updated_at, user_id)과 백분위 정의(cume_dist = 나 이상 / 전체)를
--       scoped_top 과 글자 그대로 맞출 것. 다르면 화면 두 곳이 다른 순위를 말한다.
--    ⚠️ 티어는 **반올림 전** 백분위로 낸다(scoped_top 이 그렇다). 반올림한 값으로 내면
--       경계(0.05·0.20·0.45·0.75)에 걸친 사람의 티어가 두 화면에서 갈린다.
--
-- 소비처(get-hub)의 응답 키는 그대로라 **엣지 함수 재배포가 필요 없다.**
-- 사용자가 겪는 변화: 허브 HUD 의 '상위 N%' 와 공유 카드의 World 순위가 /ranking 월드 탭과 같아진다.
--
-- 멱등(재실행 안전).
-- ⚠️ schema.sql 은 손대지 않았다 — 거기 있는 scoped_top 은 더미 도입(20260821130000) 전 판이고,
--    그 뒤 랭킹 작업은 전부 마이그레이션에만 쌓여 있다. 한쪽만 최신으로 만들면 schema.sql 이
--    "옛 판을 최신인 척" 하게 된다.
-- ============================================================
create or replace function public.my_rank_context(p_uid uuid)
returns jsonb language sql stable as $$
-- 나 — 실회원이거나 더미다(더미는 updated_at 자리에 created_at 을 쓴다. scoped_top 의 pool 과 같다).
with m as (
  select p.season_total as st, p.updated_at as at, p.user_id as id
  from user_progress p
  join profiles pr on pr.id = p.user_id and pr.deactivated_at is null and pr.is_anonymous = false
  where p.user_id = p_uid
  union all
  select d.season_total, d.created_at, d.id from ranking_dummies d where d.id = p_uid
),
n as (
  select (select count(*) from user_progress p
            join profiles pr on pr.id = p.user_id and pr.deactivated_at is null and pr.is_anonymous = false)
       + (select count(*) from ranking_dummies) as total
),
-- 나보다 점수가 높은 사람 수. 순위의 몸통이고 백분위의 분자 절반이다.
gt as (
  select (select count(*) from user_progress p
            join profiles pr on pr.id = p.user_id and pr.deactivated_at is null and pr.is_anonymous = false
           where p.season_total > (select st from m))
       + (select count(*) from ranking_dummies d where d.season_total > (select st from m)) as c
),
-- 나와 점수가 같은 사람 수(나 포함) — cume_dist 는 '나 이상'을 세므로 이게 필요하다.
eq as (
  select (select count(*) from user_progress p
            join profiles pr on pr.id = p.user_id and pr.deactivated_at is null and pr.is_anonymous = false
           where p.season_total = (select st from m))
       + (select count(*) from ranking_dummies d where d.season_total = (select st from m)) as c
),
-- 동점자 중 **나보다 앞에 서는** 사람 수. 동점 해소 = updated_at 오름 → user_id 오름(scoped_top 과 동일).
tie as (
  select (select count(*) from user_progress p
            join profiles pr on pr.id = p.user_id and pr.deactivated_at is null and pr.is_anonymous = false
           where p.season_total = (select st from m)
             and (p.updated_at, p.user_id) < ((select at from m), (select id from m)))
       + (select count(*) from ranking_dummies d
           where d.season_total = (select st from m)
             and (d.created_at, d.id) < ((select at from m), (select id from m))) as c
),
-- 바로 윗사람의 점수 = 나보다 높은 점수 중 가장 낮은 것. least 는 null 을 건너뛴다.
nxt as (
  select least(
    (select min(p.season_total) from user_progress p
       join profiles pr on pr.id = p.user_id and pr.deactivated_at is null and pr.is_anonymous = false
      where p.season_total > (select st from m)),
    (select min(d.season_total) from ranking_dummies d where d.season_total > (select st from m))
  ) as s
)
select case when (select count(*) from m) = 0
  -- 아직 집계 전(내 행이 없다) — 옛 판과 같은 모양으로 total 만 채워 내보낸다.
  then jsonb_build_object('rank', null, 'total', (select total from n), 'season_total', null,
                          'tier', null, 'percentile', null, 'points_to_pass', null)
  else jsonb_build_object(
    'rank',           (select c from gt) + (select c from tie) + 1,
    'total',          (select total from n),
    'season_total',   (select st from m),
    'tier',           ranking_tier(((select c from gt) + (select c from eq))::numeric / (select total from n)),
    'percentile',     round(((select c from gt) + (select c from eq))::numeric / (select total from n), 4),
    -- 1위면 null(옛 판과 같다), 동점자가 위에 있으면 0, 아니면 윗점수와의 차.
    'points_to_pass', case
        when (select c from gt) + (select c from tie) = 0 then null
        when (select c from tie) > 0 then 0
        else (select s from nxt) - (select st from m) end
  ) end;
$$;
