-- 방문 로그 IP — 마스킹 해제 (2026-09-09 지시)
--
-- 몇 시간 전(`20260909120000`)에 "뒷자리를 가려서만 담는다" 로 넣었던 것을 **원문 그대로** 담도록 연다.
-- 지시가 바뀐 것이라 코드가 아니라 결정이 바뀐 자리다 — 되돌리려면 다시 지시가 필요하다.
--
-- ⛔ **개인정보처리방침과 한 벌이다.** 방침 7판에 *"뒷자리를 가린 대역 형태로만 보관합니다"* 라고
--    이미 공개했으므로, 이 마이그레이션만 적용하고 방침을 안 고치면 **공개한 문서가 거짓이 된다.**
--    (방침 8판에서 그 괄호를 지웠다. 다시 가리는 쪽으로 되돌릴 때도 같이 고쳐야 한다.)
-- ⚠️ **보유기간·파기는 그대로 살아 있다** — `purge_visit_history` 크론(180일/400일)이 그대로 돈다.
--    가리지 않으니 오히려 그게 유일한 방어다. 크론을 끄지 말 것.
-- ⚠️ 이미 쌓인 행은 **가려진 채로 남는다**(되살릴 원문이 없다). 그래서 표에는 `1.2.3.*` 와
--    `1.2.3.4` 가 한동안 섞여 보인다 — 고장이 아니다.

-- 형태 검사(끝이 `*`)를 먼저 뗀다. 안 떼면 원문이 들어오는 순간 insert 가 통째로 막힌다.
alter table public.visit_log drop constraint if exists visit_log_ip_masked_chk;

-- 이름이 내용과 어긋나면 다음 사람이 "가려진 값이겠지" 하고 읽는다.
alter table public.visit_log rename column ip_masked to ip;

drop index if exists public.visit_log_ip_idx;
create index if not exists visit_log_ip_idx on public.visit_log (day, ip);

-- ── 적재 ────────────────────────────────────────────────────
-- ⚠️ 마스킹 걸러내기(`case when p_ip ~ '\*$'`)를 뺀다 — 이제 원문이 정상 값이다.
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

  insert into public.visit_log (visitor_id, user_id, path, country, device, browser, os, ref_host, ref_url, is_entry, ip)
  values (p_visitor, p_user, p_path, p_country, p_device, p_browser, p_os, p_ref_host, p_ref_url, coalesce(p_entry, false), p_ip);
end;
$$;

-- ── IP주소별 ────────────────────────────────────────────────
-- ⚠️ 못 알아낸 방문(ip null)은 **한 줄로 남긴다**. 조용히 빼면 합계가 왜 안 맞는지 아무도 못 찾는다.
create or replace function public.visit_ip_stats(p_from date, p_to date)
returns json
language plpgsql
stable
as $$
declare
  v_rows json; v_kinds bigint; v_visits bigint;
begin
  select count(distinct ip), count(*) into v_kinds, v_visits
    from public.visit_log where day between p_from and p_to;

  select coalesce(json_agg(json_build_object('key', k, 'visits', vs, 'visitors', vr) order by vs desc, k), '[]'::json)
    into v_rows from (
      select coalesce(ip, '') k, count(*) vs, count(distinct visitor_id) vr
        from public.visit_log where day between p_from and p_to
        group by 1 order by count(*) desc limit 100) t;

  return json_build_object('from', p_from, 'to', p_to, 'kinds', v_kinds, 'visits', v_visits, 'rows', v_rows);
end;
$$;

-- ── 방문자 로그 ─────────────────────────────────────────────
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
           'device', device, 'browser', browser, 'os', os, 'country', country, 'ip', ip) order by at desc), '[]'::json)
    into v_rows from (
      select * from public.visit_log where day between p_from and p_to
       order by at desc limit v_lim offset greatest(coalesce(p_offset, 0), 0)) t;
  return json_build_object('from', p_from, 'to', p_to, 'total', v_total, 'limit', v_lim, 'rows', v_rows);
end;
$$;

revoke execute on function public.visit_log_add(uuid, uuid, text, text, text, text, text, text, text, boolean, text) from public, anon, authenticated;
revoke execute on function public.visit_ip_stats(date, date) from public, anon, authenticated;
revoke execute on function public.visit_log_list(date, date, int, int) from public, anon, authenticated;
