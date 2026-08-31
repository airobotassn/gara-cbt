-- 방문 통계 (2026-08-31)
-- 관리자 홈 대시보드의 "방문 통계" 섹션이 읽는 유일한 출처.
--   · 일별 방문자·페이지뷰 추이
--   · 국가별 (브라우저가 알아낸 국가코드 — 아래 ⛔ 참고)
--   · 지역별 (회원의 profiles.region_code — 조회 시점 조인)
--   · 기기 / 브라우저 / OS
--
-- ⛔ **IP 를 저장하지 않는다. 서버가 IP 로 국가를 정하지도 않는다.**
--    `src/lib/geo.ts` 의 2026-08-24 결정이 그대로 여기에도 적용된다 — IP 조회는 **브라우저가
--    제3자(ipwho.is)에게 직접** 하고, 우리 서버는 그 결과인 **두 글자 국가코드만** 받는다.
--    엣지 함수에서 `x-forwarded-for` / `cf-ipcountry` 를 읽어 국가를 정하는 쪽으로 바꾸지 말 것 —
--    그 순간 "우리가 위치정보를 수집한다"로 성격이 바뀐다(geo.ts 머리 주석의 그 이유 그대로).
--
-- ⛔ **지역(시도)은 이 표에 담지 않는다.** 지역은 `user_id → profiles.region_code` 를 **조회할 때**
--    조인해서 얻는다. 담아버리면 (a) IP 로 알아낸 적도 없는 위치가 이벤트에 박히고,
--    (b) 사용자가 나중에 지역을 정정해도 옛 기록이 옛 지역으로 남는다.
--    그래서 지역 그래프의 모수는 **지역을 설정한 로그인 회원**뿐이다(국가 그래프와 모수가 다르다 —
--    화면이 그 사실을 글자로 밝힌다).
--
-- ⚠️ **행이 무한히 늘지 않는다.** PK 가 `(day, visitor_id, path)` 라 같은 사람이 같은 날 같은 화면을
--    100번 봐도 행은 하나고 `views` 만 오른다. 페이지뷰마다 행을 쌓는 설계로 되돌리지 말 것 —
--    이 표는 **로그인 없이 쓸 수 있는 쓰기 경로**라(anon 키로 부르는 엣지 함수) 행 수에 바닥이 있어야 한다.
--
-- ⚠️ visitor_id 는 브라우저 localStorage 의 난수다. 사람이 아니라 **브라우저**를 센다 —
--    같은 사람이 폰·PC 로 오면 둘로 세고, 기록을 지우면 새 사람이 된다.
--
-- 보존기간 정리는 크론이 없다. 필요해지면 이 한 줄이 그 작업이다:
--    delete from public.visit_events where day < (current_date - 400);

create table if not exists public.visit_events (
  -- KST 기준 날짜. 기본값으로 서버가 정한다 — 클라 시계를 믿으면 시차 조작으로 그래프가 흔들린다.
  day        date        not null default ((now() at time zone 'Asia/Seoul')::date),
  visitor_id uuid        not null,
  path       text        not null,
  user_id    uuid        references auth.users(id) on delete set null,
  -- ISO 3166-1 alpha-2 대문자. 못 알아냈으면 null = 화면의 '미상'.
  country    text,
  device     text        not null,
  browser    text        not null,
  os         text        not null,
  views      integer     not null default 1,
  first_at   timestamptz not null default now(),
  last_at    timestamptz not null default now(),
  primary key (day, visitor_id, path),
  constraint visit_events_country_chk check (country is null or country ~ '^[A-Z]{2}$'),
  constraint visit_events_device_chk  check (device in ('mobile', 'tablet', 'desktop'))
);

create index if not exists visit_events_day_idx     on public.visit_events (day);
create index if not exists visit_events_country_idx on public.visit_events (day, country);
create index if not exists visit_events_user_idx    on public.visit_events (user_id) where user_id is not null;

-- 잠금 표 — 클라 직접 SELECT 금지(RLS 켜고 정책 0개 = service role 전용). 보안 모델 그대로.
alter table public.visit_events enable row level security;

-- ── 적재 ────────────────────────────────────────────────────
-- 엣지 함수 `track-visit` 만 부른다(service role). 하루·방문자·화면 조합당 한 행, 재방문은 views 증분.
--   ⚠️ user_id / country 는 `coalesce(excluded, 기존)` 이다 — 방문 도중에 로그인한 사람의 첫 행이
--      user_id 를 나중에 얻는데, 그냥 덮으면 다음 익명 요청이 그걸 다시 null 로 지운다.
create or replace function public.visit_track(
  p_visitor uuid,
  p_user    uuid,
  p_path    text,
  p_country text,
  p_device  text,
  p_browser text,
  p_os      text
) returns void
language sql
as $$
  insert into public.visit_events as v (visitor_id, path, user_id, country, device, browser, os)
  values (p_visitor, p_path, p_user, p_country, p_device, p_browser, p_os)
  on conflict (day, visitor_id, path) do update
    set views   = v.views + 1,
        last_at = now(),
        user_id = coalesce(excluded.user_id, v.user_id),
        country = coalesce(excluded.country, v.country),
        device  = excluded.device,
        browser = excluded.browser,
        os      = excluded.os;
$$;

-- ── 집계 ────────────────────────────────────────────────────
-- 관리자 홈 대시보드 한 화면이 필요한 것을 **한 번에** 돌려준다(왕복 6번이 되면 화면이 계단으로 채워진다).
--   방문자 = distinct visitor_id · 조회수 = sum(views).
--   ⚠️ 국가·기기·브라우저의 '방문자' 합은 전체 방문자와 다를 수 있다 — 같은 브라우저가 하루 중
--      다른 화면을 볼 때 값이 바뀌는 일은 없지만, 여러 날을 합치면 한 방문자가 두 나라에 셀 수 있다.
create or replace function public.visit_stats(p_from date, p_to date)
returns json
language plpgsql
stable
as $$
declare
  v_visitors bigint; v_views bigint; v_members bigint;
  v_daily json; v_countries json; v_regions json;
  v_devices json; v_browsers json; v_os json; v_paths json;
begin
  select count(distinct visitor_id), coalesce(sum(views), 0), count(distinct user_id)
    into v_visitors, v_views, v_members
    from public.visit_events where day between p_from and p_to;

  select coalesce(json_agg(json_build_object('day', d, 'visitors', vi, 'views', vw) order by d), '[]'::json)
    into v_daily from (
      select day::text d, count(distinct visitor_id) vi, sum(views) vw
        from public.visit_events where day between p_from and p_to group by day) t;

  select coalesce(json_agg(json_build_object('key', k, 'visitors', vi, 'views', vw) order by vi desc, k), '[]'::json)
    into v_countries from (
      select country k, count(distinct visitor_id) vi, sum(views) vw
        from public.visit_events where day between p_from and p_to
        group by country order by count(distinct visitor_id) desc limit 30) t;

  -- 지역 — 회원만. 코드 모양이 나라마다 달라서(KR-11 · ES.CE · Est) 나라를 같이 돌려줘야
  -- 화면이 지도 파일에서 이름을 찾을 수 있다(regionCatalog 의 그 규칙).
  select coalesce(json_agg(json_build_object('country', c, 'key', k, 'visitors', vi) order by vi desc, k), '[]'::json)
    into v_regions from (
      select p.country_code c, p.region_code k, count(distinct e.visitor_id) vi
        from public.visit_events e
        join public.profiles p on p.id = e.user_id
       where e.day between p_from and p_to and p.region_code is not null
       group by p.country_code, p.region_code
       order by count(distinct e.visitor_id) desc limit 30) t;

  select coalesce(json_agg(json_build_object('key', k, 'visitors', vi, 'views', vw) order by vi desc, k), '[]'::json)
    into v_devices from (
      select device k, count(distinct visitor_id) vi, sum(views) vw
        from public.visit_events where day between p_from and p_to group by device) t;

  select coalesce(json_agg(json_build_object('key', k, 'visitors', vi, 'views', vw) order by vi desc, k), '[]'::json)
    into v_browsers from (
      select browser k, count(distinct visitor_id) vi, sum(views) vw
        from public.visit_events where day between p_from and p_to group by browser) t;

  select coalesce(json_agg(json_build_object('key', k, 'visitors', vi, 'views', vw) order by vi desc, k), '[]'::json)
    into v_os from (
      select os k, count(distinct visitor_id) vi, sum(views) vw
        from public.visit_events where day between p_from and p_to group by os) t;

  select coalesce(json_agg(json_build_object('key', k, 'visitors', vi, 'views', vw) order by vw desc, k), '[]'::json)
    into v_paths from (
      select path k, count(distinct visitor_id) vi, sum(views) vw
        from public.visit_events where day between p_from and p_to
        group by path order by sum(views) desc limit 15) t;

  return json_build_object(
    'visitors', v_visitors, 'views', v_views, 'members', v_members,
    'daily', v_daily, 'countries', v_countries, 'regions', v_regions,
    'devices', v_devices, 'browsers', v_browsers, 'os', v_os, 'paths', v_paths
  );
end;
$$;

-- 둘 다 service role 전용. 익명이 직접 부르면 통계를 부풀리거나(track) 통째로 읽는다(stats).
revoke execute on function public.visit_track(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.visit_stats(date, date) from public, anon, authenticated;
