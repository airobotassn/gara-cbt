-- Phase2 경제 — 일일 완료(출석) 적립 원자화.
--  · 기존 edge fn 은 select→절대값 upsert(read-modify-write) 라 동시 호출 시 적립이 유실될 수 있었다.
--    daily_activity 1/일 가드 + 재화/스탬프 증분(points = points + p_points)을 하나의 plpgsql 호출로 원자화한다.
--  · cosmetic-only 하드 불변식: 이 함수는 user_progress / user_level_skill 을 절대 읽거나 쓰지 않는다.
--  · SECURITY DEFINER + set search_path=public + public/anon/authenticated 실행권 회수 + service_role 만 grant.
create or replace function complete_daily(p_uid uuid, p_points int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'Asia/Seoul')::date;
  v_first boolean;
begin
  -- (1) 1/일 가드: 오늘 최초 삽입이면 found=true → 이때만 증분 적립(멱등).
  insert into daily_activity (user_id, day) values (p_uid, v_day)
    on conflict (user_id, day) do nothing;
  v_first := found;
  if v_first then
    -- (2) 재화 증분 — 절대값이 아니라 원자 증분(points = points + p_points).
    insert into user_currency (user_id, points) values (p_uid, p_points)
      on conflict (user_id) do update
        set points = user_currency.points + p_points, updated_at = now();
    -- (3) 스탬프 증분 — daily 종류 count + 1.
    insert into user_stamps (user_id, stamp_kind, count) values (p_uid, 'daily', 1)
      on conflict (user_id, stamp_kind) do update
        set count = user_stamps.count + 1, updated_at = now();
  end if;
  return jsonb_build_object('ok', true, 'day', v_day, 'first', v_first);
end
$$;

-- 실행권한: public/anon/authenticated 회수 → service_role(Edge Function) 만 실행.
revoke all on function complete_daily(uuid, int) from public, anon, authenticated;
grant execute on function complete_daily(uuid, int) to service_role;
