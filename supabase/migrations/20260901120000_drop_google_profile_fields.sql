-- 구글에서 실명·프로필 사진을 안 받는다 (2026-09-01)
--
-- 프론트가 `scopes: 'email'` 로 바뀌어서 raw_user_meta_data 에 full_name·avatar_url 이 더는 안 들어온다.
-- 그런데 옛 트리거는 full_name 이 없으면 `new.email` 로 폴백했다 —
-- ⛔ 그대로 두면 실명 대신 **이메일 주소 전체**가 profiles.display_name 에 박힌다.
--    실명을 안 받으려고 한 일이 이메일을 심는 일이 된다(더 나쁘다).
--    display_name 은 nullable 이고, 닉네임 게이트는 display_name 이 아니라
--    nickname_set_at 으로 판정하므로(AuthProvider) 비워도 게이트는 그대로 돈다.
--
-- ⚠️ 카카오는 그대로 둔다 — scopes 가 profile_nickname 이라 여기 오는 값은 실명이 아니라
--    사용자가 고른 닉네임이다. 그건 받아도 되는 값이라 coalesce 의 첫 항은 남긴다.
--
-- ⚠️ 이미 가입한 회원의 auth.users.raw_user_meta_data 에 남아 있는 옛 실명·사진은 건드리지 않는다.
--    지우려면 별도 지시로 할 것(되돌릴 수 없고, 옛 자격증 진위확인 화면의 소지자 이름이 같이 바뀐다).

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url, is_anonymous)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',   -- 구글은 이제 null. 카카오 닉네임만 들어온다
    new.raw_user_meta_data->>'avatar_url',  -- 구글은 이제 null (사진은 원래도 화면에서 안 읽었다)
    coalesce(new.is_anonymous, false)
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
