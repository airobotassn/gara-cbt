-- 첫 진입 상태로 되돌리기 — 신규 가입 흐름(닉네임 → 국가·지역·연령대)을 **실제 경로 그대로** 다시 태운다.
--
-- 왜 필요한가 (2026-08-19)
--   "처음 들어온 사용자가 뭘 보는지" 를 확인할 방법이 없었다. 게스트(익명) 로그인은 대안이 못 된다 —
--   닉네임 게이트도 온보딩 게이트도 `isFullUser` 일 때만 도는 설계라, 게스트는 그 화면을 아예 안 만난다.
--   그래서 **정식 계정을 가입 직후 상태로 되돌리는** 쪽이 맞다(계정을 새로 만들 필요가 없다).
--
-- 무엇을 비우나 — AuthProvider 가 게이트 판정에 쓰는 값 그대로다:
--   nickname_set_at   → 닉네임 게이트가 다시 뜬다(⚠️ display_name 은 **안 건드린다** — 가입 트리거가
--                       넣은 구글 실명이 들어 있는 게 가입 직후의 진짜 상태다)
--   region_locked_at · country_code · region_code · age_band → 온보딩 화면이 다시 뜬다
--   region_changed_at → 1회 변경권도 되돌린다(안 지우면 초기화 후 국가를 못 바꾼다)
--
-- ⚠️ **트리거(enforce_region_lock)가 service role 로도 막는다.** admin_set_region 과 똑같이
--    트랜잭션-로컬 GUC(app.allow_region_change)로 함수 안에서만 연다. set_config 의 is_local=true 라
--    pgbouncer 세션풀로 새지 않고, UPDATE 와 같은 트랜잭션이라 원자적이다.
-- ⛔ 지우는 건 **온보딩 값뿐**이다. 코인·아바타·응시 이력·자격증은 건드리지 않는다 —
--    "테스트하려고 눌렀는데 그 사람 자격증이 사라졌다" 가 되면 안 된다.
-- · SECURITY DEFINER + revoke: service-role 엣지fn(admin) 만 호출(anon/authenticated 차단).
--   멱등(두 번 눌러도 같은 상태).

create or replace function admin_reset_onboarding(p_uid uuid)
  returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.allow_region_change', 'on', true);
  update profiles
     set nickname_set_at  = null,
         region_locked_at = null,
         region_changed_at = null,
         country_code     = null,
         region_code      = null,
         age_band         = null
   where id = p_uid;
end $$;

revoke all on function admin_reset_onboarding(uuid) from public, anon, authenticated;
