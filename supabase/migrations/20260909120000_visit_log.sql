-- 방문 로그 (2026-09-09 지시 · 레퍼런스 = 그누보드식 접속통계 10종)
--
-- 여태 방문 기록은 `visit_events` 요약 한 벌뿐이었다 — PK 가 `(day, visitor_id, path)` 라
-- **같은 사람이 같은 날 같은 화면을 100번 봐도 한 줄**이고 `views` 만 오른다. 그 구조로는
-- 레퍼런스가 요구하는 넷을 만들 수가 없다:
--   · 시간별 통계        — 몇 시에 왔는지가 안 남는다(하루 한 줄이라 시각이 뭉개진다)
--   · 링크된 서버·주소   — 어디서 왔는지(referrer)를 아예 안 받는다
--   · 최초 접속 페이지   — 그 방문에서 **처음** 닿은 화면이 무엇인지 표시가 없다
--   · 방문자 로그        — 한 건 한 건이 줄로 남아야 하는데 합쳐져 있다
-- 그래서 **페이지뷰 한 건 = 한 줄** 인 표를 따로 둔다.
--
-- ⛔ **`visit_events` 를 대체하는 표가 아니다.** 둘은 역할이 다르다 —
--    요약(`visit_events`)은 "몇 명이 왔나"(방문자=브라우저 수)를 싸게 세는 자리고,
--    로그(여기)는 "한 건 한 건이 무엇이었나"를 보는 자리다. 요약을 지우고 로그에서 다 뽑으면
--    홈 대시보드가 열릴 때마다 수십만 줄을 스캔하게 된다.
--
-- ⛔ **행 수에 바닥이 없다 — 그래서 상한을 코드가 아니라 이 표의 함수가 건다.**
--    `visit_events` 머리 주석의 "행이 무한히 늘지 않는 게 설계다" 는 **여기엔 적용되지 않는다**
--    (로그는 원래 늘어나는 물건이다). 대신 이 표는 **로그인 없이 부를 수 있는 쓰기 경로**라
--    (anon 키로 엣지 함수를 부른다) 방어가 두 겹이다:
--      ① `visit_log_add` 안에서 **한 방문자가 하루에 남길 수 있는 줄 수**를 막는다(하루 1000줄).
--      ② 180일이 지나면 지운다 — 이 파일 아래쪽의 `purge_visit_history` 크론(하루 1회).
--
-- ⚠️ **IP 는 뒷자리를 가려서 담는다**(`185.93.89.147` → `185.93.89.*`, IPv6 는 앞 3그룹만).
--    2026-08-31 의 "IP 를 저장하지 않는다" 는 2026-09-09 지시로 **여기까지만 바뀌었다** —
--    ⛔ **국가는 여전히 브라우저가 알아낸 값이다.** `cf-ipcountry` 로 국가를 정하는 쪽으로 바꾸지 말 것
--       (`src/lib/geo.ts` 의 그 결정은 그대로 살아 있다).
--    ⛔ **원문을 담지 말 것.** 마스킹은 엣지 함수(`track-visit`)가 하고 이 표는 이미 가려진 문자열만 받는다.
--       가려도 대역(어느 통신사·회사망에서 몰려오나)은 그대로 읽히고, 개인 특정만 빠진다.
--    ⚠️ 가려도 **보유기간·파기 의무는 그대로다** — 그래서 아래 크론이 같이 있다(그게 이 표의 조건이었다).
-- ⚠️ referrer 는 **그 방문의 첫 요청에서만** 받는다. SPA 라 화면을 옮겨도 `document.referrer` 는
--    안 바뀌어서, 매번 보내면 외부 유입 1건이 그 사람이 본 화면 수만큼 뻥튀기된다.

create table if not exists public.visit_log (
  id         bigserial   primary key,
  at         timestamptz not null default now(),
  -- KST 기준. 클라 시계를 믿으면 시차를 조작해 그래프를 흔들 수 있다.
  day        date        not null default ((now() at time zone 'Asia/Seoul')::date),
  hour       smallint    not null default (extract(hour from (now() at time zone 'Asia/Seoul'))::smallint),
  visitor_id uuid        not null,
  user_id    uuid        references auth.users(id) on delete set null,
  path       text        not null,
  -- 링크된 서버 = referrer 의 호스트. null = 주소창에 직접 입력하거나 즐겨찾기로 들어온 방문.
  ref_host   text,
  ref_url    text,
  -- 그 방문(브라우저 탭)에서 처음 닿은 화면인가 = '최초 접속 페이지' 표의 모수.
  is_entry   boolean     not null default false,
  device     text        not null,
  browser    text        not null,
  os         text        not null,
  country    text,
  -- 뒷자리를 가린 IP. `185.93.89.*` / `2001:db8:1:*`. ⛔ 원문을 담는 컬럼이 아니다.
  ip_masked  text,
  constraint visit_log_hour_chk    check (hour between 0 and 23),
  -- ⛔ **가려지지 않은 IP 는 아예 못 들어온다.** 마스킹을 빠뜨린 코드가 조용히 원문을 쌓는 것이
  --    이 기능에서 제일 위험한 사고라, 형태 검사를 표에 박는다(끝이 `*` 가 아니면 거절).
  constraint visit_log_ip_masked_chk check (ip_masked is null or ip_masked ~ '\*$'),
  constraint visit_log_country_chk check (country is null or country ~ '^[A-Z]{2}$'),
  constraint visit_log_device_chk  check (device in ('mobile', 'tablet', 'desktop'))
);

-- 조회는 전부 기간(day)으로 시작한다. 나머지는 그 안에서 묶는 열이다.
create index if not exists visit_log_day_idx     on public.visit_log (day);
create index if not exists visit_log_day_hour_idx on public.visit_log (day, hour);
create index if not exists visit_log_ref_idx     on public.visit_log (day, ref_host);
create index if not exists visit_log_entry_idx   on public.visit_log (day) where is_entry;
create index if not exists visit_log_ip_idx      on public.visit_log (day, ip_masked);
-- 하루 상한 검사가 매 요청 도는 쿼리다 — 이 인덱스가 없으면 로그가 쌓일수록 기록이 느려진다.
create index if not exists visit_log_visitor_idx on public.visit_log (visitor_id, day);

-- 잠금 표 — 클라 직접 SELECT 금지(RLS 켜고 정책 0개 = service role 전용).
alter table public.visit_log enable row level security;

-- ── 적재 ────────────────────────────────────────────────────
-- 엣지 함수 `track-visit` 만 부른다(service role). 요약표(`visit_track`)와 **같이** 불린다 —
-- 한쪽만 부르면 두 화면의 숫자가 갈린다.
--   ⚠️ 상한에 걸리면 **조용히 넘긴다**(오류가 아니다). 사용자에게는 아무 일도 안 일어나야 한다.
create or replace function public.visit_log_add(
  p_visitor  uuid,
  p_user     uuid,
  p_path     text,
  p_country  text,
  p_device   text,
  p_browser  text,
  p_os       text,
  p_ref_host text,
  p_ref_url  text,
  p_entry    boolean,
  p_ip       text
) returns void
language plpgsql
as $$
declare
  v_day date := (now() at time zone 'Asia/Seoul')::date;
  v_n   integer;
begin
  -- 한 브라우저가 하루에 남길 수 있는 줄 수. 사람은 여기 못 닿는다(실측 하루 최대 수십 건).
  select count(*) into v_n from public.visit_log where visitor_id = p_visitor and day = v_day;
  if v_n >= 1000 then return; end if;

  insert into public.visit_log (visitor_id, user_id, path, country, device, browser, os, ref_host, ref_url, is_entry, ip_masked)
  values (p_visitor, p_user, p_path, p_country, p_device, p_browser, p_os, p_ref_host, p_ref_url, coalesce(p_entry, false),
          -- ⛔ 여기서 한 번 더 거른다. 표의 CHECK 가 있어도 **거절이 아니라 버리는 쪽**이라야 한다 —
          --    마스킹이 빠진 값 하나 때문에 방문 기록 전체가 안 쌓이면 그게 더 큰 사고다.
          case when p_ip ~ '\*$' then p_ip else null end);
end;
$$;

-- ── 기간별 (시간별 · 일별 · 월별) ────────────────────────────
-- 레퍼런스의 세 메뉴는 **같은 표에 묶는 단위만 다른 것**이라 함수 하나로 낸다.
--   ⚠️ 시간별은 **0~23 을 전부 돌려준다**(기록이 없는 시각은 0). 빠뜨리면 새벽이 통째로 사라져
--      "몇 시에 오는가" 를 못 읽는다.
--   ⚠️ '방문수' 는 페이지뷰, '방문자' 는 브라우저 수다. 레퍼런스가 세는 건 앞의 것이지만 둘을 같이
--      돌려준다 — 하나만 주면 "총 17,637건" 이 사람 수로 읽힌다.
create or replace function public.visit_period_stats(p_from date, p_to date, p_unit text)
returns json
language plpgsql
stable
as $$
declare
  v_rows json; v_visits bigint; v_visitors bigint;
begin
  select count(*), count(distinct visitor_id) into v_visits, v_visitors
    from public.visit_log where day between p_from and p_to;

  if p_unit = 'hour' then
    select coalesce(json_agg(json_build_object('key', k, 'visits', vs, 'visitors', vr) order by k::int), '[]'::json)
      into v_rows from (
        select h::text k,
               count(l.id) vs,
               count(distinct l.visitor_id) vr
          from generate_series(0, 23) h
          left join public.visit_log l on l.hour = h and l.day between p_from and p_to
         group by h) t;
  elsif p_unit = 'month' then
    select coalesce(json_agg(json_build_object('key', k, 'visits', vs, 'visitors', vr) order by k), '[]'::json)
      into v_rows from (
        select to_char(day, 'YYYY-MM') k, count(*) vs, count(distinct visitor_id) vr
          from public.visit_log where day between p_from and p_to group by 1) t;
  else
    select coalesce(json_agg(json_build_object('key', k, 'visits', vs, 'visitors', vr) order by k), '[]'::json)
      into v_rows from (
        select day::text k, count(*) vs, count(distinct visitor_id) vr
          from public.visit_log where day between p_from and p_to group by 1) t;
  end if;

  return json_build_object('from', p_from, 'to', p_to, 'unit', p_unit,
                           'visits', v_visits, 'visitors', v_visitors, 'rows', v_rows);
end;
$$;

-- ── 유입경로 (링크된 서버 · 링크된 주소 · 최초 접속 페이지) ──
-- ⚠️ 세 표의 모수가 서로 다르다 — 앞의 둘은 **referrer 가 있는 방문**만, 마지막은 **그 방문의 첫 화면**만.
--    한 함수가 같이 내는 이유는 화면이 한 장이라서고, 합계를 서로 대조하면 안 된다.
create or replace function public.visit_source_stats(p_from date, p_to date)
returns json
language plpgsql
stable
as $$
declare
  v_hosts json; v_urls json; v_entries json; v_total bigint; v_direct bigint;
begin
  select count(*), count(*) filter (where ref_host is null)
    into v_total, v_direct
    from public.visit_log where day between p_from and p_to and is_entry;

  -- 호스트는 **첫 요청(is_entry)만** 센다 — 화면을 옮길 때마다 세면 외부 유입 1건이 뻥튀기된다.
  select coalesce(json_agg(json_build_object('key', k, 'visits', vs, 'visitors', vr) order by vs desc, k), '[]'::json)
    into v_hosts from (
      select coalesce(ref_host, '') k, count(*) vs, count(distinct visitor_id) vr
        from public.visit_log where day between p_from and p_to and is_entry
        group by 1 order by count(*) desc limit 50) t;

  select coalesce(json_agg(json_build_object('key', k, 'visits', vs, 'visitors', vr) order by vs desc, k), '[]'::json)
    into v_urls from (
      select ref_url k, count(*) vs, count(distinct visitor_id) vr
        from public.visit_log where day between p_from and p_to and is_entry and ref_url is not null
        group by 1 order by count(*) desc limit 50) t;

  select coalesce(json_agg(json_build_object('key', k, 'visits', vs, 'visitors', vr) order by vs desc, k), '[]'::json)
    into v_entries from (
      select path k, count(*) vs, count(distinct visitor_id) vr
        from public.visit_log where day between p_from and p_to and is_entry
        group by 1 order by count(*) desc limit 50) t;

  return json_build_object('from', p_from, 'to', p_to, 'entries_total', v_total, 'direct', v_direct,
                           'hosts', v_hosts, 'urls', v_urls, 'entries', v_entries);
end;
$$;

-- ── IP주소별 (뒷자리를 가린 대역) ───────────────────────────
-- ⚠️ 레퍼런스는 IP 원문을 줄로 세우지만 우리는 **대역**이다(`185.93.89.*`). 그래서 "이 회사/이 통신사에서
--    몰려온다" 는 그대로 읽히고, "그 집이 누구냐" 는 안 나온다 — 그게 2026-09-09 에 고른 선이다.
-- ⚠️ 못 알아낸 방문(ip_masked null)은 **한 줄로 남긴다**. 조용히 빼면 합계가 왜 안 맞는지 아무도 못 찾는다.
create or replace function public.visit_ip_stats(p_from date, p_to date)
returns json
language plpgsql
stable
as $$
declare
  v_rows json; v_kinds bigint; v_visits bigint;
begin
  select count(distinct ip_masked), count(*) into v_kinds, v_visits
    from public.visit_log where day between p_from and p_to;

  select coalesce(json_agg(json_build_object('key', k, 'visits', vs, 'visitors', vr) order by vs desc, k), '[]'::json)
    into v_rows from (
      select coalesce(ip_masked, '') k, count(*) vs, count(distinct visitor_id) vr
        from public.visit_log where day between p_from and p_to
        group by 1 order by count(*) desc limit 100) t;

  return json_build_object('from', p_from, 'to', p_to, 'kinds', v_kinds, 'visits', v_visits, 'rows', v_rows);
end;
$$;

-- ── 방문자 로그 ─────────────────────────────────────────────
-- ⚠️ 페이지를 넘겨서 본다. 한 번에 다 주면 하루치가 수천 줄이라 화면이 멈춘다.
create or replace function public.visit_log_list(p_from date, p_to date, p_limit int, p_offset int)
returns json
language plpgsql
stable
as $$
declare
  v_rows json; v_total bigint; v_lim int := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  select count(*) into v_total from public.visit_log where day between p_from and p_to;
  select coalesce(json_agg(json_build_object(
           'at', at, 'visitor', visitor_id, 'member', (user_id is not null), 'path', path,
           'refHost', ref_host, 'refUrl', ref_url, 'entry', is_entry,
           'device', device, 'browser', browser, 'os', os, 'country', country, 'ip', ip_masked) order by at desc), '[]'::json)
    into v_rows from (
      select * from public.visit_log where day between p_from and p_to
       order by at desc limit v_lim offset greatest(coalesce(p_offset, 0), 0)) t;
  return json_build_object('from', p_from, 'to', p_to, 'total', v_total, 'limit', v_lim, 'rows', v_rows);
end;
$$;

-- ── 보존기간 · 파기 ─────────────────────────────────────────
-- ⛔ **이 크론은 IP 를 담기 시작한 대가다.** 개인정보처리방침에 "N일 보관 후 파기" 라고 적어놓고 실제로
--    안 지우면 그 자체가 위반이다. 방침의 숫자와 여기 숫자는 **한 벌**이라 한쪽만 고치면 안 된다.
--    (여태 방문 통계에 정리 크론이 없었던 건 IP 도 원문도 안 담았기 때문이다.)
-- ⚠️ 요약표(`visit_events`)도 같이 정리한다 — 그쪽 마이그레이션 머리 주석에 적어만 두고 아무도 안 돌리던
--    한 줄이 이것이다. 로그(180일)보다 길게(400일) 두는 이유는 개인을 좁힐 값이 없는 집계라서다.
create or replace function public.purge_visit_history()
returns void
language sql
as $$
  delete from public.visit_log    where day < (current_date - 180);
  delete from public.visit_events where day < (current_date - 400);
$$;

-- 하루 한 번. 18:40 UTC = 03:40 KST — 활동이 가장 적은 시간대(다른 일일 크론과 10분씩 벌려 둔다).
select cron.unschedule('visit-history-purge') where exists (select 1 from cron.job where jobname = 'visit-history-purge');
select cron.schedule('visit-history-purge', '40 18 * * *', 'select public.purge_visit_history();');

-- 전부 service role 전용. 익명이 직접 부르면 통계를 부풀리거나(add) 방문 기록을 통째로 읽는다.
revoke execute on function public.visit_log_add(uuid, uuid, text, text, text, text, text, text, text, boolean, text) from public, anon, authenticated;
revoke execute on function public.visit_period_stats(date, date, text) from public, anon, authenticated;
revoke execute on function public.visit_source_stats(date, date) from public, anon, authenticated;
revoke execute on function public.visit_ip_stats(date, date) from public, anon, authenticated;
revoke execute on function public.visit_log_list(date, date, int, int) from public, anon, authenticated;
revoke execute on function public.purge_visit_history() from public, anon, authenticated;
