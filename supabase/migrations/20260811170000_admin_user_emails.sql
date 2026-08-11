-- 관리자 화면에서 회원 이메일이 전부 빈칸으로 나오던 문제 — 2026-08-11.
--
-- 원인: 여러 관리자 액션이 `auth.admin.listUsers({ perPage: 2000 })` 로 이메일을 모으는데,
--   그 호출이 실패해도 `try { } catch { }` 로 조용히 삼켜져 **이메일만 빈칸**인 채로 화면이 정상처럼 보였다.
--   (auth.users 에는 실제로 73개의 이메일이 들어 있다.)
--
-- 해결: 페이지네이션에 기대는 관리 API 대신 **필요한 두 컬럼만** 주는 함수를 둔다.
--   ⛔ auth.users 를 뷰로 public 에 노출하면 PostgREST 를 통해 밖에서 읽힐 수 있다 →
--      SECURITY DEFINER 함수로 두고 실행 권한을 service_role 에만 준다(엣지 함수만 호출 가능).
create or replace function public.admin_user_emails()
returns table (id uuid, email text)
language sql
security definer
set search_path = auth, public
as $$
  select u.id, u.email::text from auth.users u where u.email is not null and u.email <> ''
$$;

revoke all on function public.admin_user_emails() from public;
revoke all on function public.admin_user_emails() from anon;
revoke all on function public.admin_user_emails() from authenticated;
grant execute on function public.admin_user_emails() to service_role;
