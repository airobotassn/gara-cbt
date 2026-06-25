-- 회원 탈퇴(soft delete): 비활성 플래그 + 랭킹 제외 + 보관 후 일괄 삭제 함수.
--  - 탈퇴: profiles.deactivated_at 세팅(본인 RLS update 정책으로 클라가 직접). 데이터는 보존.
--  - 복구: 보관기간 내 재로그인 시 클라가 deactivated_at = null 로 해제.
--  - 삭제: purge_deactivated_accounts() 가 보관기간 지난 계정을 auth.users 에서 삭제(→ cascade).

-- 1) 비활성 플래그
alter table profiles add column if not exists deactivated_at timestamptz;
create index if not exists profiles_deactivated_idx on profiles (deactivated_at) where deactivated_at is not null;

-- 2) 랭킹(global_top)에서 탈퇴(비활성) 유저 제외
create or replace function public.global_top(p_uid uuid, p_limit int default 10)
returns jsonb
language sql
stable
as $$
with ranked as (
  select p.user_id, p.rank as lvl, p.points,
         row_number() over (order by p.points desc, p.updated_at asc) as grank,
         count(*) over () as gtotal
  from user_progress p
  join profiles pr0 on pr0.id = p.user_id and pr0.deactivated_at is null
)
select jsonb_build_object(
  'top', coalesce((
    select jsonb_agg(jsonb_build_object(
      'rank', r.grank,
      'name', coalesce(nullif(pr.display_name, ''), '익명'),
      'level', r.lvl,
      'rating', r.points,
      'avatar', pr.avatar_url,
      'me', (r.user_id = p_uid)
    ) order by r.grank)
    from ranked r left join profiles pr on pr.id = r.user_id
    where r.grank <= p_limit
  ), '[]'::jsonb),
  'total', coalesce((select gtotal from ranked limit 1), 0),
  'me', (
    select jsonb_build_object(
      'rank', r.grank, 'level', r.lvl, 'rating', r.points,
      'name', coalesce(nullif(pr.display_name, ''), '익명'), 'avatar', pr.avatar_url
    )
    from ranked r left join profiles pr on pr.id = r.user_id
    where r.user_id = p_uid
  )
);
$$;

-- 3) 보관기간(기본 90일) 지난 비활성 계정 완전 삭제. auth.users 삭제 → 관련 데이터 cascade.
--    반환값 = 삭제한 계정 수. (스케줄러/수동 호출: select purge_deactivated_accounts();)
create or replace function public.purge_deactivated_accounts(retention_days int default 90)
returns int
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  n int;
begin
  with del as (
    delete from auth.users u
    using profiles p
    where p.id = u.id
      and p.deactivated_at is not null
      and p.deactivated_at < now() - make_interval(days => retention_days)
    returning u.id
  )
  select count(*) into n from del;
  return n;
end;
$$;
revoke all on function public.purge_deactivated_accounts(int) from public, anon, authenticated;
