-- ============================================================
-- 닉네임 — 최초 1회 설정(가입 직후) + 이후 1회만 변경. 지역(region) 잠금과 동일한 3중 방어 패턴.
--   ① 컬럼 GRANT 회수: authenticated 는 display_name 을 못 쓴다 → 쓰기는 set-nickname(service role)만.
--      ⚠️ 테이블 REVOKE 후 허용 컬럼만 재부여(컬럼-only revoke 는 Supabase 기본 grant 에 무력화됨).
--   ② 상태 컬럼: nickname_set_at(최초 설정) · nickname_changed_at(1회 변경 소진).
--      nickname_set_at is null = 미설정 → 프론트 게이트가 /onboarding/nickname 으로 보낸다.
--      가입 트리거가 구글 실명을 display_name 에 넣지만 set_at 이 null 이라 '미설정'으로 취급된다.
--   ③ 트리거: 변경권을 다 쓴 뒤의 display_name 변경 차단(GUC 로만 우회 = 어드민 CS).
--   + 유니크: 대소문자·공백을 지운 정규화 키로 중복 금지(사칭·혼란 방지).
--     확정(nickname_set_at not null)된 이름만 대상 — 가입 트리거가 넣은 구글 실명끼리는 충돌시키지 않는다.
--   멱등(재실행 안전).
-- ============================================================

alter table profiles add column if not exists nickname_set_at     timestamptz;
alter table profiles add column if not exists nickname_changed_at timestamptz;

-- ① 컬럼 권한 — display_name 을 authenticated 쓰기 목록에서 뺀다(기존 목록에서 이것만 제거).
revoke update on public.profiles from authenticated, anon;
grant  update (avatar_url, school_id, deactivated_at) on public.profiles to authenticated;

-- ④ 중복 금지 — lower(공백제거) 정규화 키. 탈퇴자·미확정은 제외.
create unique index if not exists profiles_nickname_key_uniq
  on profiles (lower(regexp_replace(display_name, '\s+', '', 'g')))
  where nickname_set_at is not null and deactivated_at is null;

-- ③ 방어심층 — 변경권 소진 후 display_name 변경 차단.
create or replace function enforce_nickname_lock() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if OLD.nickname_changed_at is not null
     and NEW.display_name is distinct from OLD.display_name
     and coalesce(current_setting('app.allow_nickname_change', true), 'off') <> 'on' then
    raise exception 'nickname is locked';
  end if;
  return NEW;
end $$;
drop trigger if exists trg_nickname_lock on profiles;
create trigger trg_nickname_lock before update on profiles
  for each row execute function enforce_nickname_lock();

-- 어드민 CS — 잠긴 닉네임 강제 정정(사칭·부적절 신고 처리). 트랜잭션-로컬 GUC 로 트리거 우회.
-- SECURITY DEFINER + revoke: service-role 엣지fn(admin) 만 호출.
create or replace function admin_set_nickname(p_uid uuid, p_name text)
  returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.allow_nickname_change', 'on', true);
  update profiles
     set display_name = p_name,
         nickname_set_at = coalesce(nickname_set_at, now())
   where id = p_uid;
end $$;
revoke all on function admin_set_nickname(uuid, text) from public, anon, authenticated;
