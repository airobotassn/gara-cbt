-- 레벨테스트 '응시자' 탭 (2026-09-21 지시)
--
-- 독려 메일이 '응시 기록'(시험 한 건 = 한 줄) 탭에 버튼으로 붙어 있었는데, 메일은 **사람 단위**라 자리가 어색했다.
-- 레벨테스트 밑에 3단 '응시자'(사람 = 한 줄)를 맨 앞에 두고 거기서 고른다. 그 목록이 쓰는 함수에
-- **응시 횟수**를 더한다 — 사람 목록이면 "몇 번 봤나" 가 옆에 있어야 한다.
-- 반환 칸이 늘어나므로 drop 후 다시 만든다(create or replace 는 반환형이 다르면 거절한다).

drop function if exists public.leveltest_nudge_candidates(int);

create or replace function public.leveltest_nudge_candidates(p_days int)
returns table (user_id uuid, display_name text, rank int, last_at timestamptz, days_since int, attempts int)
language sql
stable
security definer
set search_path = public
as $$
  with last as (
    select a.user_id, max(a.submitted_at) as submitted_at, count(*)::int as attempts
    from test_attempts a
    where a.status = 'submitted' and a.submitted_at is not null
    group by a.user_id
  )
  select l.user_id, p.display_name, coalesce(up.rank, 1) as rank, l.submitted_at as last_at,
         floor(extract(epoch from (now() - l.submitted_at)) / 86400)::int as days_since,
         l.attempts
  from last l
  join profiles p on p.id = l.user_id
  left join user_progress up on up.user_id = l.user_id
  where coalesce(p.is_anonymous, false) = false
    and p.deactivated_at is null
    and l.submitted_at <= now() - make_interval(days => greatest(p_days, 0))
  order by l.submitted_at desc
$$;

revoke all on function public.leveltest_nudge_candidates(int) from public;
revoke all on function public.leveltest_nudge_candidates(int) from anon;
revoke all on function public.leveltest_nudge_candidates(int) from authenticated;
grant execute on function public.leveltest_nudge_candidates(int) to service_role;
