-- ============================================================
-- 온보딩: 국가·지역·학교 + 지역 락 (Phase 1 · T1)
--   · profiles 확장: country_code / region_code / school_id / region_locked_at
--   · 지역 = ISO 3166-2 (regions 참조테이블 FK) · 학교 = schools(정규화, 공개 read)
--   · 락(불변식): country_code / region_code / region_locked_at 는 service-role
--     (set-region 함수)만 쓰기. RLS profiles_update_own 이 병렬 쓰기경로이므로
--     UI 숨김이 아니라 컬럼 권한으로 강제한다.
--     ⚠️ 컬럼-only REVOKE 는 Supabase 기본 테이블 UPDATE grant 에 무력화되므로
--        반드시 [테이블 REVOKE] + [허용 컬럼만 GRANT] 로 emit 한다.
--     ⚠️ 트리거는 방어심층: 락 이후 지역 컬럼 변경을 차단(GUC 로만 우회 = 어드민 CS).
--   멱등(재실행 안전). schema.sql 의 동명 블록과 DDL 동일.
-- ============================================================

-- (1) pg_trgm: 학교명 자동완성(유사도 검색)
create extension if not exists pg_trgm;

-- (2) schools (정규화 — 학교 대항 순위 대비, 목록은 공개 read)
create table if not exists schools (
  id          text primary key,   -- 공공데이터 학교ID(학교코드) or 자체 slug
  name        text not null,
  kind        text,               -- university | college
  region_code text,               -- 학교 소재 시도(선택)
  active      boolean not null default true
);
alter table schools enable row level security;
drop policy if exists "schools_select_all" on schools;
create policy "schools_select_all" on schools for select using (true);
create index if not exists schools_name_trgm on schools using gin (name gin_trgm_ops);

-- (3) regions (ISO 3166-2:KR 17 시도 — 지역 코드 유효성의 단일출처 = FK 대상)
create table if not exists regions (
  code text primary key
);
insert into regions (code) values
  ('KR-11'),('KR-26'),('KR-27'),('KR-28'),('KR-29'),('KR-30'),('KR-31'),
  ('KR-41'),('KR-42'),('KR-43'),('KR-44'),('KR-45'),('KR-46'),('KR-47'),
  ('KR-48'),('KR-49'),('KR-50')
on conflict (code) do nothing;
alter table regions enable row level security;
drop policy if exists "regions_select_all" on regions;
create policy "regions_select_all" on regions for select using (true);

-- (4) profiles 확장 — regions/schools 생성 이후에 FK 추가
alter table profiles add column if not exists country_code     text;
alter table profiles add column if not exists region_code      text references regions(code);
alter table profiles add column if not exists school_id        text references schools(id) on delete set null;
alter table profiles add column if not exists region_locked_at timestamptz;

-- (5) 부분 인덱스 (탈퇴자 제외)
create index if not exists profiles_region_idx  on profiles (region_code)  where deactivated_at is null;
create index if not exists profiles_country_idx on profiles (country_code) where deactivated_at is null;
create index if not exists profiles_school_idx  on profiles (school_id)    where deactivated_at is null;

-- (6) 락 1차 — 컬럼 권한. set-region(service role)만 지역 3컬럼 쓰기.
--   ⚠️ school_id 컬럼 추가(4) 이후에 emit (GRANT 목록이 school_id 를 참조).
--   ⚠️ 테이블 REVOKE 후 허용 컬럼만 재부여 (컬럼-only revoke 는 무력화됨).
--   service_role 은 revoke 대상이 아니므로 여전히 전 컬럼 쓰기 가능.
revoke update on public.profiles from authenticated, anon;
grant  update (display_name, avatar_url, school_id, deactivated_at) on public.profiles to authenticated;

-- (7) 락 방어심층 — 트리거. 락 이후 지역 컬럼이 실제 변경될 때만 차단(GUC 우회).
--   deactivated_at 등 비지역 컬럼만 바뀌는 update(재활성/탈퇴)는 통과.
create or replace function enforce_region_lock() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if OLD.region_locked_at is not null
     and (NEW.country_code       is distinct from OLD.country_code
          or NEW.region_code     is distinct from OLD.region_code
          or NEW.region_locked_at is distinct from OLD.region_locked_at)
     and coalesce(current_setting('app.allow_region_change', true), 'off') <> 'on' then
    raise exception 'region is locked';
  end if;
  return NEW;
end $$;
drop trigger if exists trg_region_lock on profiles;
create trigger trg_region_lock before update on profiles
  for each row execute function enforce_region_lock();
