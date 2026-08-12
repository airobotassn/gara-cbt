-- 국가·지역 1회 변경 + 지역 없는 나라 허용 (2026-08-12)
--
-- 배경: 온보딩이 한국 전용이었다. 국가 칸은 지역코드(KR-11)에서 파생된 읽기 전용이라 외국 사용자는
--   자기 나라를 고를 방법이 없었고, 서버도 `country == region 접두어`를 요구해 한국 밖 조합을 전부 거절했다.
--   이제 국가는 전 세계에서 고르고, **지역은 목록을 가진 나라(현재 한국)만** 묻는다 → region_code 는 null 가능.
--
-- 그리고 잠금은 유지하되 **평생 1회**의 정정 기회를 준다(닉네임 1회 변경과 같은 성격).
-- ⚠️ 국가·지역은 enforce_region_lock 트리거가 막고 있어서 service role 로도 그냥은 못 고친다.
--    그래서 admin_set_region 과 같은 방식(트랜잭션 로컬 GUC)으로 우회하는 전용 함수를 둔다.
alter table public.profiles add column if not exists region_changed_at timestamptz;

-- 1회 변경. **판정을 UPDATE 의 where 에 넣는 것이 핵심**이다 —
--   먼저 select 로 확인하고 나중에 update 하면, 두 번 눌린 요청이 나란히 통과해 2회 변경이 된다.
--   region_locked_at 은 손대지 않는다(최초 확정 시각이라 그대로 남아야 한다).
create or replace function public.change_region_once(p_uid uuid, p_country text, p_region text)
returns text language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform set_config('app.allow_region_change', 'on', true);
  update profiles
     set country_code = p_country,
         region_code = p_region,
         region_changed_at = now()
   where id = p_uid
     and region_locked_at is not null   -- 아직 확정 전이면 이 경로가 아니라 온보딩(set-region)이 처리한다
     and region_changed_at is null;     -- 변경권 소진
  get diagnostics n = row_count;
  if n = 0 then return 'unavailable'; end if;
  return 'ok';
end $$;
-- 엣지 함수(service role)만 부른다. 사용자가 직접 부르면 1회 제한을 우회할 길이 열린다.
revoke all on function public.change_region_once(uuid, text, text) from public, anon, authenticated;
