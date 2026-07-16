-- ============================================================
-- 어드민: 지역 오배정 정정 (Phase 1 · T9)
--   · admin_set_region(p_uid, p_country, p_region): 락된 profiles 의 국가/지역을
--     어드민 CS 경로로 강제 정정. enforce_region_lock 트리거를 함수-내부 GUC 로 우회.
--   · set_config(..., is_local=true) → GUC 는 트랜잭션-로컬(pgbouncer 세션풀 누수 X).
--     UPDATE 와 원자적(같은 함수 = 같은 트랜잭션). region_code 는 regions FK 로 유효성 보장.
--   · region_locked_at 은 coalesce 로 보존(최초 락 시각 유지).
--   · SECURITY DEFINER + revoke: service-role 엣지fn(admin) 만 호출(anon/authenticated 차단).
--   멱등(재실행 안전). schema.sql 의 동명 블록과 DDL 동일.
-- ============================================================

create or replace function admin_set_region(p_uid uuid, p_country text, p_region text)
  returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.allow_region_change', 'on', true);
  update profiles
     set country_code = p_country,
         region_code = p_region,
         region_locked_at = coalesce(region_locked_at, now())
   where id = p_uid;
end $$;

revoke all on function admin_set_region(uuid, text, text) from public, anon, authenticated;
