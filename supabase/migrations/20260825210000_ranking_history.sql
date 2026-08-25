-- 랭킹 추이 — 사람×날짜 순위 스냅샷 (2026-08-25)
--
-- 왜 필요한가: 옛 마이페이지 '학습 대시보드'에 `랭킹 추이` 라는 그래프가 있었는데, 그 그래프가
--   실제로 그리던 값은 **레벨테스트 점수**(클리어 레벨 × 1,000 계단)였다. 이름과 내용이 달랐고,
--   진짜 순위 추이를 그릴 재료가 DB 에 아예 없었다 — `user_progress` 는 **지금 값**만 들고 있다.
--   그래서 그 화면을 찢으면서(레벨테스트 몫 → /test/record, 활동 달력 → /hub) 이 그래프만
--   "이름대로 진짜 순위 추이로 다시 만든다" 로 정하고 이 표를 판다.
--
-- 무엇을 그리나: **순위 한 줄**(1위가 위로 오게 축을 뒤집는다). 그날 점수는 툴팁으로만 준다.
--   범위는 보고 있는 탭을 따라간다(전세계 / 내 국가 / 내 지역) → 순위 칸이 세 개다.
--
-- ⚠️ 지금은 순위선과 점수선이 사실상 같은 그림이다 — 상대인 `ranking_dummies` 3만5천은 점수가
--    변하지 않는 상수라, 내 순위를 움직이는 건 사실상 내 점수뿐이다. 사람이 모이면 그때 갈린다.
-- ⚠️ 시즌이 리셋되면(`reset_season()`) 활동 점수가 0이 되므로 선이 한 번 끊긴다. 그게 맞는 동작이다
--    (시즌 추이니까). 그래서 `season_id` 를 같이 적어 둔다.

-- ── 표 ──────────────────────────────────────────────────────────────────────
-- 실회원만 쌓는다. 더미는 점수가 안 변해서 이력이랄 게 없고, 3만5천 × 365 행을 만들 이유도 없다.
create table if not exists public.ranking_history (
  user_id      uuid    not null references auth.users(id) on delete cascade,
  day          date    not null,
  season_id    int,
  season_total numeric not null,
  rank_global  int     not null,
  -- 국가·지역 미설정(온보딩 전)이면 null — 그 사람은 그 보드에 아예 없다.
  rank_country int,
  rank_region  int,
  primary key (user_id, day)
);

-- ⚠️ RLS 켜고 정책 없음 = service role(엣지 함수) 전용. user_progress·ranking_dummies 와 같은 취급이다.
alter table public.ranking_history enable row level security;

comment on table public.ranking_history is
  '사람×날짜 순위 스냅샷(랭킹 추이용). 실회원만. 하루 1회 크론이 쌓고, 과거는 backfill_ranking_history() 가 한 번 채운다.';

-- 더미 쪽 조회는 "이 점수보다 높은 사람이 몇 명이냐" 하나뿐이다. 국가·지역 보드도 같은 질문이라
-- 코드만 걸린 기존 인덱스로는 점수까지 못 좁힌다 → 복합으로 하나씩 더 판다.
create index if not exists ranking_dummies_country_score_idx
  on public.ranking_dummies (country_code, season_total desc);
create index if not exists ranking_dummies_region_score_idx
  on public.ranking_dummies (region_code, season_total desc);

-- ── 오늘 스냅샷 (정확하다 — 공식을 한 벌도 안 베낀다) ────────────────────────
-- 오늘의 `season_total` 은 `user_progress` 에 **권위값으로** 들어 있다(generated 컬럼).
-- 그래서 이 함수는 점수를 계산하지 않고 줄만 세운다.
--
-- ⛔ 풀·정렬은 `scoped_top` 과 **글자 그대로 같아야** 한다. 다르면 추이 마지막 점과 화면 아래
--    '내 순위 바'가 서로 다른 숫자를 말한다(같은 순간의 같은 순위인데).
--    · 풀 = 실회원(탈퇴·익명 제외) + ranking_dummies
--    · 정렬 = (점수 내림, 시각 오름, id 오름) — 동점자도 순위가 하나씩 매겨진다(row_number).
create or replace function public.snapshot_ranking_history(
  p_day date default ((now() at time zone 'Asia/Seoul')::date)
)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with pool as (
    select p.user_id as id, p.season_total, p.updated_at, pr.country_code, pr.region_code
    from user_progress p
    join profiles pr on pr.id = p.user_id and pr.deactivated_at is null and pr.is_anonymous = false
    union all
    select d.id, d.season_total, d.created_at, d.country_code, d.region_code
    from ranking_dummies d
  ),
  ranked as (
    select pool.*,
      row_number() over (order by -season_total, updated_at, id) as rg,
      case when country_code is null then null else
        row_number() over (partition by country_code order by -season_total, updated_at, id) end as rc,
      case when region_code is null then null else
        row_number() over (partition by region_code  order by -season_total, updated_at, id) end as rr
    from pool
  )
  insert into ranking_history (user_id, day, season_id, season_total, rank_global, rank_country, rank_region)
  select r.id, p_day, up.season_id, r.season_total, r.rg, r.rc, r.rr
  from ranked r
  -- 실회원만. (더미 id 는 auth.users 에 없어서 FK 로도 못 들어온다.)
  join user_progress up on up.user_id = r.id
  on conflict (user_id, day) do update set
    season_id    = excluded.season_id,
    season_total = excluded.season_total,
    rank_global  = excluded.rank_global,
    rank_country = excluded.rank_country,
    rank_region  = excluded.rank_region;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.snapshot_ranking_history(date) from public, anon, authenticated;
grant execute on function public.snapshot_ranking_history(date) to service_role;

-- ── 과거 채우기 (한 번만 · 되풀이해도 안전) ──────────────────────────────────
-- 과거는 `user_progress` 로 못 푼다(지금 값만 있다). 대신 **일어난 일이 다 남아 있다**:
--   · 활동 트랙 = `activity_ledger` 의 일별 적립액 → 날짜별 누적합. **저장된 값이라 정확하다.**
--   · 실력 트랙 = `test_attempts` 의 등급 스냅샷 → 그날까지 클리어한 레벨 수 × 1,000.
--   · 상대(= 더미 3만5천)는 애초에 점수가 안 변하는 상수라 **그날의 판이 그대로 재현된다.**
--
-- ⚠️ **여기 박힌 세 상수는 src/lib/scoring.ts 의 값이다 — 그쪽을 고치면 여기도 고쳐야 한다.**
--    (1,000 = LEVELTEST_CLEAR_POINTS · 7 = MAX_LEVEL · 0.8 = PROMOTE_RATE_HIGH)
--    스코어링 단일 출처 규칙상 공식을 SQL 로 옮기는 건 원래 하면 안 되는 일이라, **과거를 한 번
--    채우는 이 함수 안에만** 둔다. 앞으로 쌓는 건 위 snapshot 함수가 하고 거긴 공식이 없다.
-- ⚠️ 천장 예외를 빼먹지 말 것 — 이미 Lv.7 인 사람이 Lv.7 을 통과하면 **등급은 그대로인데**
--    클리어 수만 6 → 7 이 된다(_shared/scoring.ts 의 `clearedTop`). 이 줄이 없으면 그 사람의
--    과거 점수가 통째로 1,000 낮게 재현된다.
create or replace function public.backfill_ranking_history(p_days int default 400)
returns int language plpgsql security definer set search_path = public as $$
declare n int; v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  with me as (   -- 실회원 = 이력을 만들 대상
    select p.user_id, p.season_id
    from user_progress p
    join profiles pr on pr.id = p.user_id and pr.deactivated_at is null and pr.is_anonymous = false
  ),
  -- 사람마다 "언제부터" — 첫 응시/첫 적립일. 신호가 하나도 없으면 이력을 안 만든다.
  span as (
    select me.user_id, me.season_id,
           greatest(v_today - p_days, least(
             coalesce((select min(a.submitted_at at time zone 'Asia/Seoul')::date
                       from test_attempts a where a.user_id = me.user_id and a.status = 'submitted'), v_today),
             coalesce((select min(l.day) from activity_ledger l
                       where l.user_id = me.user_id and l.season_id = me.season_id), v_today)
           )) as from_day
    from me
  ),
  days as (
    select s.user_id, s.season_id, d::date as day
    from span s, generate_series(s.from_day, v_today - 1, interval '1 day') d
  ),
  -- 그날까지의 실력 트랙 = 클리어한 레벨 수 × 1,000 의 **누적 최대**(낮아지지 않는다).
  skill as (
    select d.user_id, d.day,
      coalesce((
        select max(case
          when a.rank_before >= 7 and a.level >= 7
               and a.total_correct >= ceil(a.total_questions * 0.8) then 7
          else greatest(coalesce(a.rank_after, a.level) - 1, 0) end) * 1000
        from test_attempts a
        where a.user_id = d.user_id and a.status = 'submitted'
          and (a.submitted_at at time zone 'Asia/Seoul')::date <= d.day
      ), 0) as v
    from days d
  ),
  act as (
    select d.user_id, d.day,
      coalesce((select sum(l.delta) from activity_ledger l
                where l.user_id = d.user_id and l.season_id = d.season_id and l.day <= d.day), 0) as v
    from days d
  ),
  totals as (
    select d.user_id, d.day, d.season_id, (s.v + a.v)::numeric as season_total
    from days d join skill s on s.user_id = d.user_id and s.day = d.day
                join act   a on a.user_id = d.user_id and a.day = d.day
  ),
  -- 그 사람의 국가·지역(지금 값). 과거 국가 이력은 없다 — 1회 변경뿐이라 흔들려도 한 번이다.
  who as (select id, country_code, region_code from profiles)
  insert into ranking_history (user_id, day, season_id, season_total, rank_global, rank_country, rank_region)
  select t.user_id, t.day, t.season_id, t.season_total,
    -- 순위 = 나보다 점수가 높은 사람 수 + 1. (동점자는 같은 순위 — 과거 날짜에는 동점을 가를
    --  '누가 먼저 갱신했나'가 없다. 오늘 값은 위 snapshot 이 덮어써서 화면과 정확히 맞는다.)
    1 + (select count(*) from ranking_dummies x where x.season_total > t.season_total)
      + (select count(*) from totals o where o.day = t.day and o.season_total > t.season_total),
    case when w.country_code is null then null else
      1 + (select count(*) from ranking_dummies x
           where x.country_code = w.country_code and x.season_total > t.season_total)
        + (select count(*) from totals o join who w2 on w2.id = o.user_id
           where o.day = t.day and w2.country_code = w.country_code and o.season_total > t.season_total) end,
    case when w.region_code is null then null else
      1 + (select count(*) from ranking_dummies x
           where x.region_code = w.region_code and x.season_total > t.season_total)
        + (select count(*) from totals o join who w2 on w2.id = o.user_id
           where o.day = t.day and w2.region_code = w.region_code and o.season_total > t.season_total) end
  from totals t join who w on w.id = t.user_id
  on conflict (user_id, day) do nothing;   -- ⚠️ 이미 쌓인 스냅샷(정확한 값)을 덮지 않는다
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.backfill_ranking_history(int) from public, anon, authenticated;
grant execute on function public.backfill_ranking_history(int) to service_role;

-- ── 읽기 ────────────────────────────────────────────────────────────────────
-- 화면이 그리는 건 순위 한 줄이고 점수는 툴팁이라, 한 번에 둘 다 준다.
--   p_scope: 'global' | 'country' | 'region' — 보고 있는 탭.
--   ⚠️ 그 보드에 속하지 않는 날(국가 미설정 시절 등)은 순위가 null 이라 **행을 뺀다** —
--      0으로 내려보내면 화면이 그날 1위 근처로 그린다.
create or replace function public.ranking_trend(
  p_uid uuid,
  p_scope text default 'global',
  p_days int default 180
)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'day', h.day, 'rank', r.rk, 'score', h.season_total
         ) order by h.day), '[]'::jsonb)
  from ranking_history h
  cross join lateral (select case p_scope
      when 'country' then h.rank_country
      when 'region'  then h.rank_region
      else h.rank_global end as rk) r
  where h.user_id = p_uid
    and h.day >= ((now() at time zone 'Asia/Seoul')::date - p_days)
    and r.rk is not null;
$$;

revoke all on function public.ranking_trend(uuid, text, int) from public, anon, authenticated;
grant execute on function public.ranking_trend(uuid, text, int) to service_role;

-- ── 크론 ────────────────────────────────────────────────────────────────────
-- 하루 한 번. 18:10 UTC = 03:10 KST — 그날(KST) 이 아니라 **어제**를 찍지 않도록 기본 인자
-- (KST 오늘)를 그대로 쓴다. 03시대는 활동이 가장 적어 스냅샷이 하루치를 온전히 담는다.
--   ⚠️ 아레나 버킷 크론(5분)에 얹지 않는다 — 이건 하루 1회면 충분하고, 5분마다 3만5천 행을
--      줄 세우면 그 비용이 하루 288배가 된다.
select cron.unschedule('ranking-history') where exists (select 1 from cron.job where jobname = 'ranking-history');
select cron.schedule('ranking-history', '10 18 * * *', 'select public.snapshot_ranking_history();');

-- 지금 한 번 채워 둔다 — 안 하면 크론이 처음 돌 때까지 추이가 통째로 비어 보인다.
select public.backfill_ranking_history();
select public.snapshot_ranking_history();
